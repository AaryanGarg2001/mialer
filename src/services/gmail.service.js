const gmailConfig = require('../config/gmail.config');
const logger = require('../utils/logger');
const User = require('../models/user.model');

class GmailService {
  constructor() {
    this.maxEmailsPerBatch = 50;
    this.maxThreadsPerBatch = 20;
  }

  /**
   * Fetch recent emails for a user
   * @param {string} userId - User ID
   * @param {Object} options - Fetch options
   * @returns {Array} Array of email objects
   */
  async fetchRecentEmails(userId, options = {}) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.gmailProvider) {
        throw new Error('User not found or Gmail not connected');
      }

      const gmailProvider = user.gmailProvider;
      
      // Check if token needs refresh
      if (user.isTokenExpired('google', gmailProvider.providerId)) {
        await this.refreshUserToken(user);
      }

      // Create Gmail client
      const gmail = gmailConfig.createGmailClient(
        gmailProvider.accessToken,
        gmailProvider.refreshToken
      );

      // Build query based on options
      const query = this.buildGmailQuery(options);
      
      logger.info('Fetching emails from Gmail', {
        userId,
        query,
        maxResults: options.maxResults || this.maxEmailsPerBatch,
      });

      // List messages
      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults: options.maxResults || this.maxEmailsPerBatch,
      });

      if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
        logger.info('No emails found for user', { userId });
        return [];
      }

      // Fetch full message details
      const emails = await this.fetchEmailDetails(gmail, listResponse.data.messages);
      
      // Update last sync time
      await user.updateProviderLastSync('google', gmailProvider.providerId);

      logger.info('Successfully fetched emails', {
        userId,
        emailCount: emails.length,
      });

      return emails;

    } catch (error) {
      logger.error('Failed to fetch emails from Gmail:', error);
      throw new Error(`Gmail fetch failed: ${error.message}`);
    }
  }

  /**
   * Fetch detailed information for messages
   */
  async fetchEmailDetails(gmail, messages) {
    const emails = [];
    
    // Process in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < messages.length; i += batchSize) {
      const batch = messages.slice(i, i + batchSize);
      const batchPromises = batch.map(message => 
        this.fetchSingleEmail(gmail, message.id)
      );
      
      const batchResults = await Promise.allSettled(batchPromises);
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          emails.push(result.value);
        } else {
          logger.warn('Failed to fetch email', {
            messageId: batch[index].id,
            error: result.reason?.message,
          });
        }
      });

      // Add delay between batches to respect rate limits
      if (i + batchSize < messages.length) {
        await this.delay(100);
      }
    }

    return emails;
  }

  /**
   * Fetch a single email with full details
   */
  async fetchSingleEmail(gmail, messageId) {
    try {
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full',
      });

      const message = response.data;
      
      // Parse email headers
      const headers = this.parseEmailHeaders(message.payload.headers);
      
      // Extract email body
      const body = this.extractEmailBody(message.payload);
      
      // Parse labels
      const labels = message.labelIds || [];
      
      return {
        messageId: message.id,
        threadId: message.threadId,
        subject: headers.subject || 'No subject',
        sender: headers.from || 'Unknown sender',
        recipients: this.parseRecipients(headers),
        body: body.text || '',
        htmlBody: body.html || '',
        snippet: message.snippet || '',
        labels,
        isImportant: labels.includes('IMPORTANT'),
        isUnread: labels.includes('UNREAD'),
        receivedAt: new Date(parseInt(message.internalDate)),
        size: message.sizeEstimate || 0,
        attachments: this.parseAttachments(message.payload),
      };

    } catch (error) {
      logger.error('Failed to fetch single email:', { messageId, error: error.message });
      return null;
    }
  }

  /**
   * Build Gmail API query string
   */
  buildGmailQuery(options) {
    const queryParts = [];

    // Date range
    if (options.after) {
      const afterDate = new Date(options.after);
      queryParts.push(`after:${Math.floor(afterDate.getTime() / 1000)}`);
    }

    if (options.before) {
      const beforeDate = new Date(options.before);
      queryParts.push(`before:${Math.floor(beforeDate.getTime() / 1000)}`);
    }

    // Default to last 24 hours if no date specified
    if (!options.after && !options.before) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      queryParts.push(`after:${Math.floor(yesterday.getTime() / 1000)}`);
    }

    // Include/exclude filters
    if (options.includeRead === false) {
      queryParts.push('is:unread');
    }

    if (options.includeSent === false) {
      queryParts.push('-in:sent');
    }

    // Exclude spam and trash by default
    if (options.includeSpam !== true) {
      queryParts.push('-in:spam');
    }

    if (options.includeTrash !== true) {
      queryParts.push('-in:trash');
    }

    // Categories to exclude (promotions, social, forums)
    if (options.excludePromotions !== false) {
      queryParts.push('-category:promotions');
    }

    if (options.excludeSocial !== false) {
      queryParts.push('-category:social');
    }

    if (options.excludeForums !== false) {
      queryParts.push('-category:forums');
    }

    // Custom query
    if (options.query) {
      queryParts.push(options.query);
    }

    return queryParts.join(' ');
  }

  /**
   * Parse email headers into key-value pairs
   */
  parseEmailHeaders(headers) {
    const parsed = {};
    
    headers.forEach(header => {
      const name = header.name.toLowerCase();
      parsed[name] = header.value;
    });

    return {
      subject: parsed.subject,
      from: parsed.from,
      to: parsed.to,
      cc: parsed.cc,
      bcc: parsed.bcc,
      date: parsed.date,
      messageId: parsed['message-id'],
      inReplyTo: parsed['in-reply-to'],
      references: parsed.references,
    };
  }

  /**
   * Extract email body from payload
   */
  extractEmailBody(payload) {
    const body = { text: '', html: '' };

    const extractFromPart = (part) => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        body.text += this.decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        body.html += this.decodeBase64Url(part.body.data);
      }

      // Recursively check parts
      if (part.parts) {
        part.parts.forEach(extractFromPart);
      }
    };

    if (payload.body?.data) {
      // Single part message
      if (payload.mimeType === 'text/plain') {
        body.text = this.decodeBase64Url(payload.body.data);
      } else if (payload.mimeType === 'text/html') {
        body.html = this.decodeBase64Url(payload.body.data);
      }
    } else if (payload.parts) {
      // Multi-part message
      payload.parts.forEach(extractFromPart);
    }

    return body;
  }

  /**
   * Parse recipients from headers
   */
  parseRecipients(headers) {
    const recipients = [];
    
    if (headers.to) recipients.push(...this.parseEmailAddresses(headers.to));
    if (headers.cc) recipients.push(...this.parseEmailAddresses(headers.cc));
    if (headers.bcc) recipients.push(...this.parseEmailAddresses(headers.bcc));
    
    return recipients;
  }

  /**
   * Parse email addresses from header string
   */
  parseEmailAddresses(headerValue) {
    // Simple email extraction - could be improved with a proper parser
    const emailRegex = /[\w\.-]+@[\w\.-]+\.\w+/g;
    return headerValue.match(emailRegex) || [];
  }

  /**
   * Parse attachments from payload
   */
  parseAttachments(payload) {
    const attachments = [];

    const extractAttachments = (part) => {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          filename: part.filename,
          mimeType: part.mimeType,
          size: part.body.size || 0,
          attachmentId: part.body.attachmentId,
        });
      }

      if (part.parts) {
        part.parts.forEach(extractAttachments);
      }
    };

    if (payload.parts) {
      payload.parts.forEach(extractAttachments);
    }

    return attachments;
  }

  /**
   * Decode base64url encoded string
   */
  decodeBase64Url(data) {
    try {
      // Convert base64url to base64
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      // Add padding if necessary
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
      // Decode base64
      return Buffer.from(padded, 'base64').toString('utf-8');
    } catch (error) {
      logger.warn('Failed to decode base64url data:', error.message);
      return '';
    }
  }

  /**
   * Refresh user's Gmail token
   */
  async refreshUserToken(user) {
    try {
      const gmailProvider = user.gmailProvider;
      const newTokens = await gmailConfig.refreshAccessToken(gmailProvider.refreshToken);
      
      await user.updateProviderTokens('google', gmailProvider.providerId, newTokens);
      
      logger.info('Gmail token refreshed for user', {
        userId: user._id,
        email: user.email,
      });
    } catch (error) {
      logger.error('Failed to refresh Gmail token:', error);
      throw new Error('Gmail token refresh failed');
    }
  }

  /**
   * Mark emails as read
   */
  async markEmailsAsRead(userId, messageIds) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.gmailProvider) {
        throw new Error('User not found or Gmail not connected');
      }

      const gmail = gmailConfig.createGmailClient(
        user.gmailProvider.accessToken,
        user.gmailProvider.refreshToken
      );

      await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: {
          ids: messageIds,
          removeLabelIds: ['UNREAD'],
        },
      });

      logger.info('Marked emails as read', {
        userId,
        messageCount: messageIds.length,
      });

    } catch (error) {
      logger.error('Failed to mark emails as read:', error);
      throw error;
    }
  }

  /**
   * Get user's Gmail profile
   */
  async getUserProfile(userId) {
    try {
      const user = await User.findById(userId);
      if (!user || !user.gmailProvider) {
        throw new Error('User not found or Gmail not connected');
      }

      const gmail = gmailConfig.createGmailClient(
        user.gmailProvider.accessToken,
        user.gmailProvider.refreshToken
      );

      const profile = await gmail.users.getProfile({ userId: 'me' });
      
      return {
        emailAddress: profile.data.emailAddress,
        messagesTotal: profile.data.messagesTotal,
        threadsTotal: profile.data.threadsTotal,
        historyId: profile.data.historyId,
      };

    } catch (error) {
      logger.error('Failed to get user profile:', error);
      throw error;
    }
  }

  /**
   * Simple delay utility
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new GmailService();