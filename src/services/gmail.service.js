const gmailConfig = require('../config/gmail.config');
const logger = require('../utils/logger');
const User = require('../models/User.model.js'); // Ensure .js extension and correct casing

/**
 * @file Gmail Service
 * @module services/gmail
 * @requires ../config/gmail.config
 * @requires ../utils/logger
 * @requires ../models/user.model
 */

/**
 * Service class for interacting with the Gmail API.
 * Handles fetching emails, parsing them, and other Gmail-related operations.
 * @class GmailService
 */
class GmailService {
  /**
   * Initializes the GmailService.
   * Sets default batch sizes for fetching emails.
   * @constructor
   */
  constructor() {
    /** @member {number} maxEmailsPerBatch - Default maximum number of emails to fetch in a single API call. */
    this.maxEmailsPerBatch = 50;
    // this.maxThreadsPerBatch = 20; // Potentially for thread-based operations in future
  }

  /**
   * Fetches recent emails for a specified user from their Gmail account.
   * Handles token refresh if necessary.
   * @async
   * @param {string} userId - The ID of the user.
   * @param {object} [options={}] - Options to filter and limit email fetching.
   * @param {Date} [options.after] - Fetch emails after this date.
   * @param {Date} [options.before] - Fetch emails before this date.
   * @param {number} [options.maxResults] - Maximum number of emails to fetch.
   * @param {boolean} [options.includeRead=true] - Whether to include read emails.
   * @param {boolean} [options.includeSent=false] - Whether to include sent emails.
   * @param {boolean} [options.excludePromotions=true] - Whether to exclude promotions.
   * @param {boolean} [options.excludeSocial=true] - Whether to exclude social emails.
   * @param {boolean} [options.excludeForums=true] - Whether to exclude forum emails.
   * @param {string} [options.query] - Custom Gmail query string.
   * @returns {Promise<Array<object>>} A promise that resolves to an array of parsed email objects.
   * @throws {Error} If user is not found, Gmail not connected, or fetch fails.
   */
  async fetchRecentEmails(userId, options = {}) {
    try {
      const user = await User.findById(userId).lean(); // Use lean if not modifying user doc here
      if (!user) throw new Error('User not found.');
      
      const gmailProvider = user.providers?.find(p => p.provider === 'google' && p.isActive);
      if (!gmailProvider) throw new Error('Active Gmail provider not connected for this user.');

      // Check and refresh token if expired
      // Note: User model methods like isTokenExpired or updateProviderTokens would need the full User document, not a lean one,
      // or these methods need to be adapted, or token refresh handled before calling this service method.
      // For simplicity here, assuming token refresh is handled by a dedicated mechanism or is checked by caller.
      // If User.findById(userId) was not .lean(), this would work:
      // if (user.isTokenExpired('google', gmailProvider.providerId)) {
      //   await this._refreshUserToken(user); // Pass full user document
      // }
      // For now, we'll assume tokens are valid or refreshed by a separate process/check.


      const gmail = gmailConfig.createGmailClient(gmailProvider.accessToken, gmailProvider.refreshToken);
      const query = this._buildGmailQuery(options);
      const maxResults = options.maxResults || this.maxEmailsPerBatch;
      
      logger.info('Fetching recent emails from Gmail API.', { userId, query, maxResults });

      const listResponse = await gmail.users.messages.list({
        userId: 'me', // 'me' refers to the authenticated user
        q: query,
        maxResults,
      });

      if (!listResponse.data.messages || listResponse.data.messages.length === 0) {
        logger.info('No emails found matching criteria for user.', { userId, query });
        return [];
      }

      const emails = await this._fetchEmailDetailsInBatches(gmail, listResponse.data.messages, userId);
      
      // Update last sync timestamp (if user object was not lean)
      // Example: await User.updateOne({ _id: userId, 'providers.providerId': gmailProvider.providerId }, { $set: { 'providers.$.lastSyncAt': new Date() }});
      // Or, if full user doc fetched: await user.updateProviderLastSync('google', gmailProvider.providerId);


      logger.info(`Successfully fetched ${emails.length} emails from Gmail.`, { userId });
      return emails;

    } catch (error) {
      logger.error('Failed to fetch emails from Gmail:', { userId, message: error.message, stack: error.stack });
      // Handle specific errors, e.g., token errors might require re-authentication
      if (error.message.includes('token') || error.response?.status === 401) {
        throw new Error('Gmail authentication error. Please reconnect your account.');
      }
      throw new Error(`Failed to fetch emails from Gmail: ${error.message}`);
    }
  }

  /**
   * Fetches detailed information for a list of Gmail message IDs in batches.
   * @async
   * @private
   * @param {import('googleapis').gmail_v1.Gmail} gmail - Authenticated Gmail API client.
   * @param {Array<{id: string, threadId: string}>} messages - Array of message objects (with id and threadId).
   * @param {string} userId - For logging context.
   * @returns {Promise<Array<object>>} A promise that resolves to an array of parsed email details.
   */
  async _fetchEmailDetailsInBatches(gmail, messages, userId) {
    const detailedEmails = [];
    const batchSize = 10; // Gmail API best practices suggest batching, but direct batch GET isn't standard for messages.
                         // Individual GETs are common. Rate limiting is handled by delay.

    for (let i = 0; i < messages.length; i += batchSize) {
      const batchMessageIds = messages.slice(i, i + batchSize);
      const batchPromises = batchMessageIds.map(message =>
        this._fetchSingleEmailDetails(gmail, message.id, userId) // Pass userId for logging
      );
      
      const settledResults = await Promise.allSettled(batchPromises);
      
      settledResults.forEach((result, index) => {
        if (result.status === 'fulfilled' && result.value) {
          detailedEmails.push(result.value);
        } else if (result.status === 'rejected') {
          logger.warn('Failed to fetch details for one email in batch.', {
            userId,
            messageId: batchMessageIds[index].id,
            error: result.reason?.message || result.reason,
          });
        }
      });

      // Optional: Implement a delay if hitting rate limits frequently.
      if (i + batchSize < messages.length) {
        await this._delay(200); // e.g., 200ms delay between batches of 10
      }
    }
    return detailedEmails;
  }

  /**
   * Fetches and parses full details for a single Gmail message.
   * @async
   * @private
   * @param {import('googleapis').gmail_v1.Gmail} gmail - Authenticated Gmail API client.
   * @param {string} messageId - The ID of the Gmail message.
   * @param {string} userId - For logging context.
   * @returns {Promise<object|null>} Parsed email object or null if fetching fails.
   */
  async _fetchSingleEmailDetails(gmail, messageId, userId) {
    try {
      const response = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full', // Request full message payload
      });

      const gmailMessage = response.data;
      const headers = this._parseEmailHeaders(gmailMessage.payload.headers);
      const bodyParts = this._extractEmailBodyParts(gmailMessage.payload);
      
      return {
        messageId: gmailMessage.id,
        threadId: gmailMessage.threadId,
        subject: headers.subject || '(No Subject)',
        sender: headers.from || 'Unknown Sender',
        recipients: this._parseRecipientsFromHeaders(headers),
        body: bodyParts.text || '',
        htmlBody: bodyParts.html || '',
        snippet: gmailMessage.snippet || '',
        labels: gmailMessage.labelIds || [],
        isImportant: gmailMessage.labelIds?.includes('IMPORTANT') || false,
        isUnread: gmailMessage.labelIds?.includes('UNREAD') || false,
        receivedAt: new Date(parseInt(gmailMessage.internalDate, 10)), // internalDate is ms timestamp
        sizeEstimateBytes: gmailMessage.sizeEstimate || 0,
        attachments: this._parseAttachmentsFromPayload(gmailMessage.payload),
      };
    } catch (error) {
      logger.error('Failed to fetch or parse single email details:', { userId, messageId, errorMessage: error.message });
      return null; // Allow batch processing to continue for other emails
    }
  }

  /**
   * Builds a Gmail API query string based on provided filter options.
   * @private
   * @param {object} options - Filtering options.
   * @returns {string} The constructed Gmail query string.
   */
  _buildGmailQuery(options) {
    const queryParts = [];
    if (options.after) queryParts.push(`after:${Math.floor(new Date(options.after).getTime() / 1000)}`);
    if (options.before) queryParts.push(`before:${Math.floor(new Date(options.before).getTime() / 1000)}`);

    // Default to last 24-48 hours if no specific date range
    if (!options.after && !options.before) {
      const defaultStartDate = new Date();
      defaultStartDate.setDate(defaultStartDate.getDate() - 2); // Default to last 2 days
      queryParts.push(`after:${Math.floor(defaultStartDate.getTime() / 1000)}`);
    }

    if (options.includeRead === false) queryParts.push('is:unread');
    if (options.includeSent === false) queryParts.push('-in:sent'); // Exclude sent items by default unless specified

    // Always exclude spam and trash unless explicitly included (which is rare)
    if (options.includeSpam !== true) queryParts.push('-in:spam');
    if (options.includeTrash !== true) queryParts.push('-in:trash');

    if (options.excludePromotions !== false) queryParts.push('-category:promotions');
    if (options.excludeSocial !== false) queryParts.push('-category:social');
    if (options.excludeForums !== false) queryParts.push('-category:forums'); // Gmail uses 'forums'
    if (options.query) queryParts.push(options.query); // Append custom query parts

    return queryParts.join(' ').trim();
  }

  /**
   * Parses relevant email headers from the Gmail API response.
   * @private
   * @param {Array<object>} headersArray - Array of header objects from Gmail payload.
   * @returns {object} An object containing key email headers (subject, from, to, etc.).
   */
  _parseEmailHeaders(headersArray) {
    const headersMap = {};
    if (Array.isArray(headersArray)) {
      headersArray.forEach(header => {
        headersMap[header.name.toLowerCase()] = header.value;
      });
    }
    return {
      subject: headersMap.subject,
      from: headersMap.from,
      to: headersMap.to,
      cc: headersMap.cc,
      bcc: headersMap.bcc,
      date: headersMap.date,
      messageId: headersMap['message-id'], // Corrected: message-id not messageId
      inReplyTo: headersMap['in-reply-to'],
      references: headersMap.references,
    };
  }

  /**
   * Extracts plain text and HTML body parts from the Gmail message payload.
   * Handles multi-part messages recursively.
   * @private
   * @param {object} payload - The payload object from a Gmail message.
   * @returns {{text: string, html: string}} An object with `text` and `html` body content.
   */
  _extractEmailBodyParts(payload) {
    const body = { text: '', html: '' };
    // Base case: if payload itself has body data (typical for non-multipart)
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      body.text = this._decodeBase64UrlSafe(payload.body.data);
    } else if (payload.mimeType === 'text/html' && payload.body?.data) {
      body.html = this._decodeBase64UrlSafe(payload.body.data);
    }

    // Recursive extraction from parts for multipart messages
    if (payload.parts && payload.parts.length > 0) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          body.text += this._decodeBase64UrlSafe(part.body.data) + '\n'; // Add newline for concatenated parts
        } else if (part.mimeType === 'text/html' && part.body?.data) {
          body.html += this._decodeBase64UrlSafe(part.body.data) + '\n';
        } else if (part.parts && part.parts.length > 0) {
          // Handle nested multipart (e.g., multipart/alternative within multipart/mixed)
          const nestedBodyParts = this._extractEmailBodyParts(part);
          body.text += nestedBodyParts.text;
          body.html += nestedBodyParts.html;
        }
      }
    }
    // If text body is empty but HTML is present, a text version could be generated from HTML (complex, not done here)
    body.text = body.text.trim();
    body.html = body.html.trim();
    return body;
  }

  /**
   * Parses recipient email addresses from 'To', 'Cc', and 'Bcc' headers.
   * @private
   * @param {object} headers - Parsed headers object from `_parseEmailHeaders`.
   * @returns {Array<string>} A flat array of unique recipient email addresses.
   */
  _parseRecipientsFromHeaders(headers) {
    const recipientSet = new Set();
    ['to', 'cc', 'bcc'].forEach(field => {
      if (headers[field]) {
        this._parseEmailAddressesFromString(headers[field]).forEach(email => recipientSet.add(email));
      }
    });
    return Array.from(recipientSet);
  }

  /**
   * Extracts email addresses from a string (e.g., a 'To' or 'Cc' header value).
   * @private
   * @param {string} headerValue - The string containing email addresses.
   * @returns {Array<string>} An array of extracted email addresses.
   */
  _parseEmailAddressesFromString(headerValue) {
    if (!headerValue || typeof headerValue !== 'string') return [];
    // Regex to extract email addresses, handles "Name <email@example.com>" format and plain emails
    const emailRegex = /([\w.-]+@[\w.-]+\.\w+)/g;
    return headerValue.match(emailRegex) || [];
  }

  /**
   * Parses attachment details from the Gmail message payload.
   * @private
   * @param {object} payload - The payload object from a Gmail message.
   * @returns {Array<object>} An array of attachment objects with filename, mimeType, size, and attachmentId.
   */
  _parseAttachmentsFromPayload(payload) {
    const attachments = [];
    function findAttachmentsRecursive(parts) {
      if (!parts) return;
      for (const part of parts) {
        if (part.filename && part.body?.attachmentId) {
          attachments.push({
            filename: part.filename,
            mimeType: part.mimeType || 'application/octet-stream',
            sizeBytes: part.body.size || 0,
            attachmentId: part.body.attachmentId,
          });
        }
        // Recursively check nested parts
        if (part.parts) {
          findAttachmentsRecursive(part.parts);
        }
      }
    }
    if (payload.parts) {
      findAttachmentsRecursive(payload.parts);
    }
    return attachments;
  }

  /**
   * Decodes a base64url encoded string safely.
   * @private
   * @param {string} data - The base64url encoded string.
   * @returns {string} The decoded UTF-8 string, or an empty string on error.
   */
  _decodeBase64UrlSafe(data) {
    if (!data || typeof data !== 'string') return '';
    try {
      const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
      return Buffer.from(padded, 'base64').toString('utf-8');
    } catch (error) {
      logger.warn('Failed to decode base64url data segment:', { errorMessage: error.message, dataPreview: data.substring(0, 20) });
      return ''; // Return empty string or placeholder for problematic segments
    }
  }

  /**
   * Refreshes the Gmail access token for a given user.
   * Assumes the full User Mongoose document is passed.
   * @async
   * @private
   * @param {User} user - The User Mongoose document.
   * @throws {Error} If token refresh fails.
   */
  async _refreshUserToken(user) { // Changed to private convention, takes full User doc
    try {
      const gmailProvider = user.getActiveProvider('google'); // Assumes getActiveProvider exists
      if (!gmailProvider || !gmailProvider.refreshToken) {
        throw new Error('No active Gmail provider with a refresh token found for user.');
      }
      
      const newTokens = await gmailConfig.refreshAccessToken(gmailProvider.refreshToken);
      await user.updateProviderTokens('google', gmailProvider.providerId, newTokens); // Assumes updateProviderTokens exists
      
      logger.info('Gmail token refreshed successfully via _refreshUserToken.', { userId: user._id });
    } catch (error) {
      logger.error('Failed to refresh Gmail token internally:', { userId: user._id, message: error.message });
      throw new Error(`Gmail token refresh failed: ${error.message}`); // Re-throw to be handled by caller
    }
  }

  /**
   * Marks a list of Gmail messages as read (removes the 'UNREAD' label).
   * @async
   * @param {string} userId - The ID of the user.
   * @param {Array<string>} messageIds - Array of Gmail message IDs to mark as read.
   * @returns {Promise<void>}
   * @throws {Error} If marking emails as read fails.
   */
  async markEmailsAsRead(userId, messageIds) {
    if (!messageIds || messageIds.length === 0) return;
    try {
      const user = await User.findById(userId).lean(); // Lean for read-only provider data
      if (!user) throw new Error('User not found.');
      const gmailProvider = user.providers?.find(p => p.provider === 'google' && p.isActive);
      if (!gmailProvider) throw new Error('Gmail not connected for user.');
      // Token refresh should be handled by a mechanism that updates the stored accessToken if needed.
      // Or, ensure createGmailClient handles potential token expiry if it's long-lived.

      const gmail = gmailConfig.createGmailClient(gmailProvider.accessToken, gmailProvider.refreshToken);
      await gmail.users.messages.batchModify({
        userId: 'me',
        requestBody: { ids: messageIds, removeLabelIds: ['UNREAD'] },
      });
      logger.info(`Marked ${messageIds.length} emails as read for user.`, { userId });
    } catch (error) {
      logger.error('Failed to mark emails as read:', { userId, messageCount: messageIds.length, message: error.message });
      throw error; // Re-throw for caller to handle
    }
  }

  /**
   * Retrieves the Gmail profile information for the user.
   * @async
   * @param {string} userId - The ID of the user.
   * @returns {Promise<object>} User's Gmail profile data.
   * @throws {Error} If fetching profile fails.
   */
  async getUserProfile(userId) {
    try {
      const user = await User.findById(userId).lean();
      if (!user) throw new Error('User not found.');
      const gmailProvider = user.providers?.find(p => p.provider === 'google' && p.isActive);
      if (!gmailProvider) throw new Error('Gmail not connected for user.');

      const gmail = gmailConfig.createGmailClient(gmailProvider.accessToken, gmailProvider.refreshToken);
      const response = await gmail.users.getProfile({ userId: 'me' });
      
      logger.info('Gmail user profile retrieved successfully.', { userId, emailAddress: response.data.emailAddress });
      return { // Return only necessary fields
        emailAddress: response.data.emailAddress,
        messagesTotal: response.data.messagesTotal,
        threadsTotal: response.data.threadsTotal,
        historyId: response.data.historyId,
      };
    } catch (error) {
      logger.error('Failed to get user Gmail profile:', { userId, message: error.message });
      throw error; // Re-throw for caller to handle
    }
  }

  /**
   * Utility function to introduce a delay.
   * @private
   * @param {number} ms - Milliseconds to delay.
   * @returns {Promise<void>}
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new GmailService();