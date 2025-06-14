const gmailService = require('./gmail.service');
const aiService = require('./ai.service');
const logger = require('../utils/logger');
const User = require('../models/user.model');
const Email = require('../models/email.model');
const Summary = require('../models/summary.model');

class EmailProcessingService {
  constructor() {
    this.processingQueue = new Map(); // Simple in-memory queue
  }

  /**
   * Process daily emails for a user
   * @param {string} userId - User ID
   * @param {Object} options - Processing options
   */
  async processDailyEmails(userId, options = {}) {
    try {
      // Prevent duplicate processing
      if (this.processingQueue.has(userId)) {
        logger.warn('Email processing already in progress for user', { userId });
        return { status: 'already_processing' };
      }

      this.processingQueue.set(userId, { startedAt: new Date() });

      logger.info('Starting daily email processing', { userId });

      // 1. Fetch recent emails from Gmail
      const fetchOptions = {
        after: options.after || this.getYesterday(),
        maxResults: options.maxResults || 50,
        includeRead: options.includeRead !== false,
        excludePromotions: options.excludePromotions !== false,
        excludeSocial: options.excludeSocial !== false,
      };

      const rawEmails = await gmailService.fetchRecentEmails(userId, fetchOptions);

      if (rawEmails.length === 0) {
        logger.info('No emails found for processing', { userId });
        this.processingQueue.delete(userId);
        return { status: 'no_emails', processedCount: 0 };
      }

      // 2. Filter and prioritize emails based on user persona
      const user = await User.findById(userId).populate('persona');
      const filteredEmails = await this.filterEmailsByPersona(rawEmails, user);

      logger.info('Filtered emails by persona', {
        userId,
        originalCount: rawEmails.length,
        filteredCount: filteredEmails.length,
      });

      // 3. Process and store emails
      const processedEmails = [];
      for (const emailData of filteredEmails) {
        try {
          const processedEmail = await this.processAndStoreEmail(userId, emailData);
          if (processedEmail) {
            processedEmails.push(processedEmail);
          }
        } catch (error) {
          logger.error('Failed to process individual email', {
            userId,
            messageId: emailData.messageId,
            error: error.message,
          });
        }
      }

      // 4. Generate individual summaries for important emails
      const emailSummaries = [];
      for (const email of processedEmails) {
        if (this.shouldSummarizeEmail(email, user)) {
          try {
            const summary = await this.generateEmailSummary(email, user);
            emailSummaries.push(summary);
          } catch (error) {
            logger.error('Failed to generate email summary', {
              userId,
              emailId: email._id,
              error: error.message,
            });
          }
        }
      }

      // 5. Generate daily summary if we have individual summaries
      let dailySummary = null;
      if (emailSummaries.length > 0) {
        try {
          dailySummary = await this.generateDailySummary(userId, emailSummaries, user);
        } catch (error) {
          logger.error('Failed to generate daily summary', {
            userId,
            error: error.message,
          });
        }
      }

      // 6. Update user statistics
      await this.updateUserStats(userId, processedEmails.length, emailSummaries.length);

      this.processingQueue.delete(userId);

      const result = {
        status: 'completed',
        processedCount: processedEmails.length,
        summarizedCount: emailSummaries.length,
        dailySummary: dailySummary ? {
          id: dailySummary._id,
          content: dailySummary.content.substring(0, 200) + '...',
          actionItemsCount: dailySummary.actionItems?.length || 0,
        } : null,
        processedAt: new Date(),
      };

      logger.info('Daily email processing completed', { userId, ...result });
      return result;

    } catch (error) {
      this.processingQueue.delete(userId);
      logger.error('Daily email processing failed', { userId, error: error.message });
      throw error;
    }
  }

  /**
   * Filter emails based on user persona
   */
  async filterEmailsByPersona(emails, user) {
    const persona = user.persona;
    
    if (!persona) {
      // No persona - use basic filtering
      return this.basicEmailFilter(emails);
    }

    const filtered = [];
    
    for (const email of emails) {
      const score = this.calculateEmailScore(email, persona);
      
      if (score >= this.getMinimumScore(user)) {
        email.personalityScore = score;
        filtered.push(email);
      }
    }

    // Sort by score (highest first) and limit
    filtered.sort((a, b) => (b.personalityScore || 0) - (a.personalityScore || 0));
    
    const maxEmails = this.getMaxEmailsForUser(user);
    return filtered.slice(0, maxEmails);
  }

  /**
   * Calculate email importance score based on persona
   */
  calculateEmailScore(email, persona) {
    let score = 0;

    // Base score for unread emails
    if (email.isUnread) score += 2;

    // Important label from Gmail
    if (email.isImportant) score += 3;

    // Check important contacts
    if (persona.importantContacts && persona.importantContacts.length > 0) {
      const senderLower = email.sender.toLowerCase();
      const isImportantContact = persona.importantContacts.some(contact => 
        senderLower.includes(contact.toLowerCase())
      );
      if (isImportantContact) score += 5;
    }

    // Check keywords in subject and body
    if (persona.keywords && persona.keywords.length > 0) {
      const text = `${email.subject} ${email.body}`.toLowerCase();
      const keywordMatches = persona.keywords.filter(keyword => 
        text.includes(keyword.toLowerCase())
      ).length;
      score += keywordMatches * 2;
    }

    // Check interests
    if (persona.interests && persona.interests.length > 0) {
      const text = `${email.subject} ${email.body}`.toLowerCase();
      const interestMatches = persona.interests.filter(interest => 
        text.includes(interest.toLowerCase())
      ).length;
      score += interestMatches * 1.5;
    }

    // Penalize promotional/newsletter emails
    const subject = email.subject.toLowerCase();
    const body = email.body.toLowerCase();
    
    const promotionalKeywords = ['unsubscribe', 'newsletter', 'promotion', 'offer', 'deal', 'sale'];
    const hasPromotionalContent = promotionalKeywords.some(keyword => 
      subject.includes(keyword) || body.includes(keyword)
    );
    
    if (hasPromotionalContent) score -= 2;

    // Boost for recent emails
    const hoursOld = (Date.now() - email.receivedAt.getTime()) / (1000 * 60 * 60);
    if (hoursOld < 6) score += 1;

    return Math.max(0, score);
  }

  /**
   * Basic email filtering when no persona is available
   */
  basicEmailFilter(emails) {
    return emails
      .filter(email => {
        // Exclude obvious promotional content
        const subject = email.subject.toLowerCase();
        const promotionalKeywords = ['unsubscribe', 'newsletter', 'no-reply'];
        return !promotionalKeywords.some(keyword => subject.includes(keyword));
      })
      .sort((a, b) => {
        // Sort by importance, then by date
        if (a.isImportant && !b.isImportant) return -1;
        if (!a.isImportant && b.isImportant) return 1;
        return new Date(b.receivedAt) - new Date(a.receivedAt);
      })
      .slice(0, 20); // Limit to 20 emails
  }

  /**
   * Process and store a single email
   */
  async processAndStoreEmail(userId, emailData) {
    try {
      // Check if email already exists
      const existingEmail = await Email.findOne({
        userId,
        messageId: emailData.messageId,
      });

      if (existingEmail) {
        logger.debug('Email already exists, skipping', {
          userId,
          messageId: emailData.messageId,
        });
        return existingEmail;
      }

      // Create new email record
      const email = new Email({
        userId,
        messageId: emailData.messageId,
        threadId: emailData.threadId,
        subject: emailData.subject,
        sender: emailData.sender,
        recipients: emailData.recipients,
        body: this.cleanEmailBody(emailData.body),
        htmlBody: emailData.htmlBody,
        snippet: emailData.snippet,
        labels: emailData.labels,
        isImportant: emailData.isImportant,
        isRead: !emailData.isUnread,
        receivedAt: emailData.receivedAt,
        processedAt: new Date(),
        personalityScore: emailData.personalityScore,
        attachments: emailData.attachments || [],
      });

      await email.save();
      
      logger.debug('Email stored successfully', {
        userId,
        emailId: email._id,
        messageId: emailData.messageId,
      });

      return email;

    } catch (error) {
      logger.error('Failed to store email', {
        userId,
        messageId: emailData.messageId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Determine if an email should be summarized
   */
  shouldSummarizeEmail(email, user) {
    // Don't summarize very short emails
    if (email.body.length < 100) return false;

    // Always summarize important emails
    if (email.isImportant) return true;

    // Summarize emails with high persona score
    if (email.personalityScore && email.personalityScore >= 5) return true;

    // Summarize unread emails above certain length
    if (!email.isRead && email.body.length > 300) return true;

    return false;
  }

  /**
   * Generate summary for a single email
   */
  async generateEmailSummary(email, user) {
    try {
      const emailData = {
        subject: email.subject,
        body: email.body,
        sender: email.sender,
        receivedAt: email.receivedAt,
        snippet: email.snippet,
      };

      const persona = user.persona;
      const summary = await aiService.generateEmailSummary(emailData, persona, 'individual');

      // Store the summary
      const emailSummary = {
        emailId: email._id,
        messageId: email.messageId,
        subject: email.subject,
        sender: email.sender,
        content: summary.content,
        actionItems: summary.actionItems || [],
        priority: summary.priority || 'medium',
        category: summary.category || 'general',
        sentiment: summary.sentiment || 'neutral',
        generatedAt: new Date(),
      };

      logger.debug('Email summary generated', {
        emailId: email._id,
        summaryLength: summary.content?.length || 0,
      });

      return emailSummary;

    } catch (error) {
      logger.error('Failed to generate email summary', {
        emailId: email._id,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Generate daily summary from individual email summaries
   */
  async generateDailySummary(userId, emailSummaries, user) {
    try {
      const persona = user.persona;
      const summaryData = emailSummaries.map(summary => ({
        subject: summary.subject,
        sender: summary.sender,
        content: summary.content,
        actionItems: summary.actionItems,
        priority: summary.priority,
        category: summary.category,
      }));

      const dailySummaryContent = await aiService.generateDailySummary(summaryData, persona);

      // Create daily summary record
      const dailySummary = new Summary({
        userId,
        type: 'daily',
        content: dailySummaryContent.content,
        emailIds: emailSummaries.map(s => s.emailId).filter(Boolean),
        actionItems: dailySummaryContent.actionItems || [],
        highlights: dailySummaryContent.highlights || [],
        categories: dailySummaryContent.categories || {},
        metadata: {
          emailCount: emailSummaries.length,
          generatedAt: new Date(),
          summaryType: 'daily',
          ...dailySummaryContent.metadata,
        },
        createdAt: new Date(),
      });

      await dailySummary.save();

      logger.info('Daily summary generated and stored', {
        userId,
        summaryId: dailySummary._id,
        emailCount: emailSummaries.length,
      });

      return dailySummary;

    } catch (error) {
      logger.error('Failed to generate daily summary', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update user statistics
   */
  async updateUserStats(userId, processedCount, summarizedCount) {
    try {
      const user = await User.findById(userId);
      if (user) {
        await user.incrementUsage('emailsProcessed', processedCount);
        await user.incrementUsage('summariesGenerated', summarizedCount);
      }
    } catch (error) {
      logger.error('Failed to update user stats', { userId, error: error.message });
    }
  }

  /**
   * Clean email body text
   */
  cleanEmailBody(body) {
    if (!body) return '';

    // Remove excessive whitespace
    let cleaned = body.replace(/\s+/g, ' ').trim();
    
    // Remove common email signatures and footers
    const signatureMarkers = [
      '-- ',
      'Sent from my',
      'Get Outlook for',
      'This email was sent from',
    ];
    
    for (const marker of signatureMarkers) {
      const index = cleaned.toLowerCase().indexOf(marker.toLowerCase());
      if (index > 0) {
        cleaned = cleaned.substring(0, index).trim();
      }
    }

    // Limit length
    if (cleaned.length > 5000) {
      cleaned = cleaned.substring(0, 5000) + '...';
    }

    return cleaned;
  }

  /**
   * Get yesterday's date for filtering
   */
  getYesterday() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
    return yesterday;
  }

  /**
   * Get minimum score for email filtering
   */
  getMinimumScore(user) {
    if (user.subscription.plan === 'enterprise') return 1;
    if (user.subscription.plan === 'pro') return 2;
    return 3; // Free tier - more selective
  }

  /**
   * Get maximum emails to process for user
   */
  getMaxEmailsForUser(user) {
    if (user.subscription.plan === 'enterprise') return 100;
    if (user.subscription.plan === 'pro') return 50;
    return 20; // Free tier
  }

  /**
   * Get processing status for user
   */
  getProcessingStatus(userId) {
    const processing = this.processingQueue.get(userId);
    if (!processing) return null;

    return {
      status: 'processing',
      startedAt: processing.startedAt,
      duration: Date.now() - processing.startedAt.getTime(),
    };
  }

  /**
   * Process emails on-demand (not scheduled)
   */
  async processEmailsOnDemand(userId, options = {}) {
    const result = await this.processDailyEmails(userId, {
      ...options,
      maxResults: options.maxResults || 10, // Smaller batch for on-demand
    });

    return result;
  }
}

module.exports = new EmailProcessingService();