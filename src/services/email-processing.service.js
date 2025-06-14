const gmailService = require('./gmail.service');
const aiService = require('./ai.service');
const logger = require('../utils/logger');
const User = require('../models/User.model.js'); // Ensure .js extension and correct casing
const Email = require('../models/email.model.js'); // Ensure .js extension
const Summary = require('../models/summary.model.js'); // Ensure .js extension

/**
 * @file Email Processing Service
 * @module services/email-processing
 * @requires ./gmail.service
 * @requires ./ai.service
 * @requires ../utils/logger
 * @requires ../models/user.model
 * @requires ../models/email.model
 * @requires ../models/summary.model
 */

/**
 * Service class for orchestrating the email processing workflow.
 * This includes fetching emails, filtering, generating summaries, and storing data.
 * @class EmailProcessingService
 */
class EmailProcessingService {
  /**
   * Initializes the EmailProcessingService.
   * Sets up an in-memory queue to track processing status for users.
   * @constructor
   */
  constructor() {
    /**
     * @member {Map<string, {startedAt: Date}>} processingQueue
     * In-memory map to track users whose emails are currently being processed.
     * Key: userId, Value: { startedAt: Date }
     * Note: For a scalable solution, a distributed queue (e.g., Redis, RabbitMQ) would be preferable.
     */
    this.processingQueue = new Map();
  }

  /**
   * Orchestrates the daily processing of emails for a given user.
   * Fetches emails, filters them based on persona, stores them,
   * generates individual and daily summaries, and updates user statistics.
   * @async
   * @param {string} userId - The ID of the user whose emails are to be processed.
   * @param {object} [options={}] - Options for email fetching and processing.
   * @param {Date} [options.after] - Fetch emails received after this date. Defaults to yesterday.
   * @param {number} [options.maxResults=50] - Maximum number of emails to fetch.
   * @param {boolean} [options.includeRead=true] - Whether to include read emails.
   * @param {boolean} [options.excludePromotions=true] - Whether to exclude promotion category emails.
   * @param {boolean} [options.excludeSocial=true] - Whether to exclude social category emails.
   * @returns {Promise<object>} An object detailing the outcome of the processing.
   * @throws {Error} If a critical error occurs during processing.
   */
  async processDailyEmails(userId, options = {}) {
    // Check if processing is already in progress for this user.
    if (this.processingQueue.has(userId)) {
      logger.warn('Email processing is already in progress for user.', { userId });
      return { status: 'already_processing', message: 'Processing already in progress.', details: this.processingQueue.get(userId) };
    }

    try {
      this.processingQueue.set(userId, { startedAt: new Date(), stage: 'initiating' });
      logger.info('Starting daily email processing workflow.', { userId, options });

      // 1. Fetch recent emails
      this.processingQueue.set(userId, { startedAt: this.processingQueue.get(userId).startedAt, stage: 'fetching_emails' });
      const fetchOptions = {
        after: options.after || this._getYesterdayDate(),
        maxResults: options.maxResults || 50,
        includeRead: options.includeRead !== false, // Default true
        excludePromotions: options.excludePromotions !== false, // Default true
        excludeSocial: options.excludeSocial !== false, // Default true
      };
      const rawEmails = await gmailService.fetchRecentEmails(userId, fetchOptions);

      if (rawEmails.length === 0) {
        logger.info('No new emails found for daily processing.', { userId });
        this.processingQueue.delete(userId);
        return { status: 'no_emails_found', processedCount: 0, summarizedCount: 0 };
      }
      logger.info(`Fetched ${rawEmails.length} raw emails.`, { userId });

      // 2. Filter emails based on user's persona (if available)
      this.processingQueue.set(userId, { ...this.processingQueue.get(userId), stage: 'filtering_emails' });
      const user = await User.findById(userId).populate('persona').lean(); // Use lean if user object not modified
      if (!user) throw new Error(`User not found: ${userId}`);

      const filteredEmails = await this._filterEmailsByPersona(rawEmails, user);
      logger.info(`Filtered emails down to ${filteredEmails.length} based on persona/rules.`, { userId });

      if (filteredEmails.length === 0) {
        logger.info('No emails passed filtering for daily processing.', { userId });
        this.processingQueue.delete(userId);
        return { status: 'no_relevant_emails', processedCount: 0, summarizedCount: 0, rawEmailCount: rawEmails.length };
      }

      // 3. Process and store the filtered emails, generate individual summaries
      this.processingQueue.set(userId, { ...this.processingQueue.get(userId), stage: 'processing_and_summarizing_individual_emails' });
      const { processedAndStoredEmails, individualSummaries } = await this._processAndSummarizeEmails(userId, filteredEmails, user);

      // 4. Generate daily summary from individual summaries
      let dailySummaryDocument = null;
      if (individualSummaries.length > 0) {
        this.processingQueue.set(userId, { ...this.processingQueue.get(userId), stage: 'generating_daily_summary' });
        dailySummaryDocument = await this._generateAndStoreDailySummary(userId, individualSummaries, user);
      } else {
        logger.info('No individual summaries generated, skipping daily summary.', { userId });
      }

      // 5. Update user statistics
      this.processingQueue.set(userId, { ...this.processingQueue.get(userId), stage: 'updating_stats' });
      await this._updateUserStats(userId, processedAndStoredEmails.length, individualSummaries.length);

      const result = {
        status: 'completed',
        processedEmailCount: processedAndStoredEmails.length,
        individualSummariesCount: individualSummaries.length,
        dailySummaryId: dailySummaryDocument?._id,
        processedAt: new Date().toISOString(),
      };
      logger.info('Daily email processing completed successfully.', { userId, ...result });
      return result;

    } catch (error) {
      logger.error('Critical error during daily email processing for user:', { userId, message: error.message, stack: error.stack });
      throw error; // Re-throw to be caught by higher-level error handlers
    } finally {
      this.processingQueue.delete(userId); // Ensure user is removed from queue regardless of outcome
    }
  }

  /**
   * Processes a batch of emails: stores them and generates individual summaries if applicable.
   * @private
   */
  async _processAndSummarizeEmails(userId, emailsToProcess, user) {
    const processedAndStoredEmails = [];
    const individualSummaries = [];

    for (const emailData of emailsToProcess) {
      try {
        const storedEmail = await this._processAndStoreSingleEmail(userId, emailData);
        if (storedEmail) {
          processedAndStoredEmails.push(storedEmail);
          if (this._shouldSummarizeEmail(storedEmail, user)) { // Pass the Mongoose document
            const summaryData = await this._generateIndividualEmailSummary(storedEmail, user); // Pass Mongoose doc
            if (summaryData) {
              // Attach summary to the email document and save
              storedEmail.summary = summaryData;
              await storedEmail.save();
              individualSummaries.push({ ...summaryData, emailId: storedEmail._id, subject: storedEmail.subject, sender: storedEmail.sender }); // For daily summary context
            }
          }
        }
      } catch (err) {
        logger.error('Error processing one email in batch:', { userId, messageId: emailData.messageId, error: err.message });
      }
    }
    return { processedAndStoredEmails, individualSummaries };
  }


  /**
   * Filters a list of raw emails based on the user's persona or default rules.
   * @private
   * @param {Array<object>} emails - Raw emails fetched from Gmail.
   * @param {User} user - The user document, potentially with populated persona.
   * @returns {Promise<Array<object>>} Filtered and scored list of emails.
   */
  async _filterEmailsByPersona(emails, user) {
    const persona = user?.persona;
    
    if (!persona) {
      logger.debug(`No persona found for user ${user._id}, using basic filter.`, { userId: user._id });
      return this._basicEmailFilter(emails);
    }

    const scoredEmails = emails.map(email => {
      const score = persona.getEmailScore ? persona.getEmailScore(email) : this._calculateEmailScore(email, persona); // Fallback if method not on lean object
      return { ...email, personalityScore: score };
    });
    
    // Filter out emails that don't meet persona criteria (e.g., minimum score, exclude patterns)
    const relevantEmails = scoredEmails.filter(email =>
        persona.shouldIncludeEmail ? persona.shouldIncludeEmail(email) : (email.personalityScore >= (this._getMinimumScoreForUser(user) || 0))
    );

    // Sort by score (highest first) and then by date (newest first for tie-breaking)
    relevantEmails.sort((a, b) => {
      if (b.personalityScore !== a.personalityScore) {
        return (b.personalityScore || 0) - (a.personalityScore || 0);
      }
      return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
    });
    
    const maxEmails = persona.maxEmailsPerSummary || this._getMaxEmailsForUser(user);
    return relevantEmails.slice(0, maxEmails);
  }

  /**
   * Calculates an importance score for an email based on persona criteria.
   * This is a simplified scoring logic.
   * @private
   */
  _calculateEmailScore(email, persona) {
    // Fallback scoring logic if persona.getEmailScore is not available (e.g. persona is a plain object)
    let score = 0;
    if (email.isUnread) score += 2;
    if (email.isImportant) score += 3;
    // Add more basic scoring rules here if needed
    if (persona.importantContacts?.some(c => email.sender?.toLowerCase().includes(c.toLowerCase()))) score += 5;
    logger.silly('Calculated email score (fallback)', { score, emailSubject: email.subject, personaId: persona?._id });
    return score;
  }

  /**
   * Applies basic filtering rules if no persona is available.
   * @private
   */
  _basicEmailFilter(emails) {
    return emails
      .filter(email => {
        const subjectLower = email.subject?.toLowerCase() || '';
        const senderLower = email.sender?.toLowerCase() || '';
        const promotionalKeywords = ['unsubscribe', 'newsletter', 'promotion', 'offer'];
        if (promotionalKeywords.some(kw => subjectLower.includes(kw) || senderLower.includes('no-reply'))) {
          return false;
        }
        return true;
      })
      .sort((a, b) => (b.isImportant ? 1 : 0) - (a.isImportant ? 1 : 0) || new Date(b.receivedAt) - new Date(a.receivedAt))
      .slice(0, 20);
  }

  /**
   * Processes and stores a single email in the database.
   * Avoids duplicates based on messageId and userId.
   * @private
   * @param {string} userId - The user's ID.
   * @param {object} emailData - Raw email data from Gmail service.
   * @returns {Promise<Email|null>} The saved Email document or null if duplicate/error.
   */
  async _processAndStoreSingleEmail(userId, emailData) {
    try {
      const existingEmail = await Email.findOne({ userId, messageId: emailData.messageId });
      if (existingEmail) {
        logger.debug('Email already processed and stored, skipping.', { userId, messageId: emailData.messageId });
        return existingEmail; // Return existing if found
      }

      const email = new Email({
        userId,
        messageId: emailData.messageId,
        threadId: emailData.threadId,
        subject: emailData.subject,
        sender: emailData.sender,
        recipients: emailData.recipients,
        body: this._cleanEmailBody(emailData.body), // Clean body before storing
        htmlBody: emailData.htmlBody, // Store raw HTML, can be cleaned on display if needed
        snippet: emailData.snippet,
        labels: emailData.labels,
        isImportant: emailData.isImportant,
        isRead: !emailData.isUnread, // Gmail's isUnread vs our isRead
        receivedAt: new Date(emailData.receivedAt), // Ensure it's a Date object
        processedAt: new Date(),
        personalityScore: emailData.personalityScore || 0,
        attachments: emailData.attachments || [],
      });
      await email.save();
      logger.debug('Email stored successfully in DB.', { userId, emailId: email._id });
      return email;
    } catch (error) {
      logger.error('Failed to store email in DB:', { userId, messageId: emailData.messageId, error: error.message });
      return null; // Return null on error to allow batch processing to continue
    }
  }

  /**
   * Determines if a specific email should be summarized based on its properties and user persona.
   * @private
   * @param {Email} emailDoc - The processed Email Mongoose document.
   * @param {User} user - The user document with populated persona.
   * @returns {boolean} True if the email should be summarized.
   */
  _shouldSummarizeEmail(emailDoc, user) {
    const persona = user?.persona;
    if (persona && persona.shouldIncludeEmail && typeof persona.shouldIncludeEmail === 'function') {
        // If persona has its own logic (e.g. from Persona model methods if not lean())
        return persona.shouldIncludeEmail(emailDoc);
    }
    // Default logic if no specific persona method
    if (emailDoc.body.length < (persona?.minimumEmailLength || 100)) return false;
    if (emailDoc.isImportant) return true;
    if (emailDoc.personalityScore && emailDoc.personalityScore >= (this._getMinimumScoreForUser(user) || 3)) return true;
    if (!emailDoc.isRead && emailDoc.body.length > 300) return true; // Summarize longer unread emails
    return false;
  }

  /**
   * Generates an individual summary for a given email using the AI service.
   * @private
   * @param {Email} emailDoc - The Email Mongoose document.
   * @param {User} user - The user document with populated persona.
   * @returns {Promise<object|null>} The summary data object or null if generation fails.
   */
  async _generateIndividualEmailSummary(emailDoc, user) {
    try {
      const emailDataForAI = {
        subject: emailDoc.subject,
        body: emailDoc.body, // Use cleaned body
        sender: emailDoc.sender,
        receivedAt: emailDoc.receivedAt,
        snippet: emailDoc.snippet,
      };
      const summaryAIResult = await aiService.generateEmailSummary(emailDataForAI, user?.persona, 'individual');

      logger.debug('Individual email summary generated by AI.', { emailId: emailDoc._id, userId: user._id });
      return { // This structure should match the `summary` subdocument in Email model
        content: summaryAIResult.content,
        actionItems: summaryAIResult.actionItems || [],
        priority: summaryAIResult.priority || 'medium',
        category: summaryAIResult.category || 'general',
        sentiment: summaryAIResult.sentiment || 'neutral',
        generatedAt: new Date(),
      };
    } catch (error) {
      logger.error('Failed to generate individual email summary via AI service:', { emailId: emailDoc._id, error: error.message });
      return null;
    }
  }

  /**
   * Generates and stores a daily summary from a list of individual email summaries.
   * @private
   * @param {string} userId - User's ID.
   * @param {Array<object>} individualSummaries - Array of generated individual summaries.
   * @param {User} user - The user document with populated persona.
   * @returns {Promise<Summary|null>} The saved Daily Summary document or null.
   */
  async _generateAndStoreDailySummary(userId, individualSummaries, user) {
    try {
      const dailySummaryAIResult = await aiService.generateDailySummary(individualSummaries, user?.persona);

      const summaryDoc = new Summary({
        userId,
        type: 'daily',
        content: dailySummaryAIResult.content,
        emailIds: individualSummaries.map(s => s.emailId).filter(Boolean), // Link to original Email docs
        actionItems: dailySummaryAIResult.actionItems || [],
        highlights: dailySummaryAIResult.highlights || [],
        categories: dailySummaryAIResult.metadata?.categoriesAggregated || {},
        stats: { // Populate stats based on the day's emails
            totalEmails: individualSummaries.length,
            // Other stats like unread, important could be calculated if full email objects are passed
        },
        dateRange: { // For a daily summary, this would typically be the day it's generated for
            start: this._getYesterdayDate(), // Example: summary for "yesterday"
            end: new Date(this._getYesterdayDate().getTime() + 24 * 60 * 60 * 1000 -1) // End of yesterday
        },
        metadata: { // AI generation metadata
            aiProvider: aiService.provider?.name,
            modelUsed: aiConfig.getModelConfig('detailed', aiService.provider?.name).model,
            // processingTimeMs, tokenCount could be added if returned by aiService
        },
      });
      await summaryDoc.save();
      logger.info('Daily summary document stored successfully.', { userId, summaryId: summaryDoc._id });
      return summaryDoc;
    } catch (error) {
      logger.error('Failed to generate or store daily summary:', { userId, error: error.message });
      return null;
    }
  }

  /**
   * Updates user's usage statistics.
   * @private
   */
  async _updateUserStats(userId, processedEmailCount, generatedSummariesCount) {
    try {
      const user = await User.findById(userId);
      if (user) {
        if (processedEmailCount > 0) await user.incrementUsage('emailsProcessed', processedEmailCount);
        if (generatedSummariesCount > 0) await user.incrementUsage('summariesGenerated', generatedSummariesCount);
        // Could also increment a general 'dailyProcessingRuns' counter
        logger.info('User stats updated.', { userId, processedEmailCount, generatedSummariesCount });
      }
    } catch (error) {
      logger.error('Failed to update user statistics:', { userId, error: error.message });
    }
  }

  /**
   * Cleans email body text by removing excessive whitespace and common signature/footer patterns.
   * Limits the length of the cleaned body.
   * @private
   * @param {string} body - The raw email body text.
   * @returns {string} The cleaned email body text.
   */
  _cleanEmailBody(body) {
    if (!body || typeof body !== 'string') return '';
    let cleaned = body.replace(/\s+/g, ' ').trim(); // Normalize whitespace
    
    // Remove common disclaimers, signatures, marketing footers (examples)
    const patternsToRemove = [
      /Sent from my .*/gi,
      /Get Outlook for .*/gi,
      /This email was sent from .*/gi,
      /To unsubscribe, click here.*/gi,
      /View this email in your browser.*/gi,
      /If you wish to stop receiving our emails.*/gi,
      /All rights reserved.*/gi,
      /Copyright \d{4}.*/gi,
      /^-{2,}\s*Original Message\s*-{2,}$/gim, // Dashed lines around original message
      /^>{1,}\s?/gm, // Remove leading '>' from quoted replies
    ];
    patternsToRemove.forEach(pattern => {
      cleaned = cleaned.replace(pattern, '');
    });
    
    // More aggressive signature removal (common patterns)
    const signatureLines = cleaned.split(/\n-{2,}\n|\n_{2,}\n/); // Split by common signature dividers
    if (signatureLines.length > 1) {
      cleaned = signatureLines[0].trim(); // Take content before the first major signature line
    }

    // Limit length to avoid overly long bodies in DB / AI prompts
    const MAX_CLEANED_BODY_LENGTH = 15000; // Increased limit for cleaned body
    if (cleaned.length > MAX_CLEANED_BODY_LENGTH) {
      cleaned = cleaned.substring(0, MAX_CLEANED_BODY_LENGTH) + '... [body truncated]';
    }
    return cleaned.trim();
  }

  /**
   * Gets the Date object for the start of yesterday.
   * @private
   * @returns {Date}
   */
  _getYesterdayDate() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0); // Start of yesterday
    return yesterday;
  }

  /**
   * Determines the minimum relevance score for an email to be processed, based on user's plan.
   * @private
   * @param {User} user - The user document.
   * @returns {number} The minimum score.
   */
  _getMinimumScoreForUser(user) {
    // Example: Higher plans might process emails with lower scores (more inclusive)
    if (user?.subscription?.plan === 'enterprise') return 1;
    if (user?.subscription?.plan === 'pro') return 2;
    return 3; // Free tier is more selective
  }

  /**
   * Determines the maximum number of emails to process for a user, based on their plan.
   * @private
   * @param {User} user - The user document.
   * @returns {number} The maximum number of emails.
   */
  _getMaxEmailsForUser(user) {
    if (user?.subscription?.plan === 'enterprise') return 100;
    if (user?.subscription?.plan === 'pro') return 50;
    return 20; // Free tier
  }

  /**
   * Retrieves the current processing status for a given user.
   * @param {string} userId - The ID of the user.
   * @returns {{status: string, startedAt: Date, duration: number}|null} Processing status or null if not processing.
   */
  getProcessingStatus(userId) {
    const processingEntry = this.processingQueue.get(userId);
    if (!processingEntry) return null;

    return {
      status: 'processing', // Could be more granular e.g. 'fetching', 'summarizing'
      stage: processingEntry.stage || 'unknown',
      startedAt: processingEntry.startedAt,
      elapsedMilliseconds: Date.now() - processingEntry.startedAt.getTime(),
    };
  }

  /**
   * Processes emails on-demand. This is a wrapper around `processDailyEmails`
   * but typically uses a smaller `maxResults` for quicker processing.
   * @async
   * @param {string} userId - The user's ID.
   * @param {object} [options={}] - Options, particularly `maxResults`.
   * @returns {Promise<object>} Result of the on-demand processing.
   */
  async processEmailsOnDemand(userId, options = {}) {
    logger.info('Processing emails on-demand.', { userId, options });
    // Use a smaller default batch size for on-demand requests
    const onDemandOptions = {
      ...options,
      maxResults: options.maxResults || 10,
      // For on-demand, might want to fetch very recent emails, e.g., last few hours
      after: options.after || new Date(Date.now() - 6 * 60 * 60 * 1000), // Default to last 6 hours
    };
    return this.processDailyEmails(userId, onDemandOptions);
  }
}

module.exports = new EmailProcessingService();