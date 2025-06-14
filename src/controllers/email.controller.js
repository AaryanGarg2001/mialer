const emailProcessingService = require('../services/email-processing.service');
const gmailService = require('../services/gmail.service');
const dailySummaryJob = require('../jobs/daily-summary.job');
const Email = require('../models/email.model');
const Summary = require('../models/summary.model');
const Persona = require('../models/persona.model');
const logger = require('../utils/logger');
const { successResponse, errorResponse, validationErrorResponse } = require('../utils/response');
const { asyncHandler } = require('../middleware/error.middleware');

/**
 * @file Email Controller
 * @module controllers/email
 * @requires ../services/email-processing.service
 * @requires ../services/gmail.service
 * @requires ../jobs/daily-summary.job // Though not directly used by routes, conceptually related
 * @requires ../models/email.model
 * @requires ../models/summary.model
 * @requires ../models/persona.model
 * @requires ../utils/logger
 * @requires ../utils/response
 * @requires ../middleware/error.middleware
 */

/**
 * Controller for managing email processing, retrieval, summaries, and related actions.
 * @class EmailController
 */
class EmailController {
  /**
   * Initiates daily email processing for the authenticated user.
   * This can involve fetching new emails and generating summaries based on user persona.
   * @method processDailyEmails
   * @route POST /api/v1/emails/process-daily
   * @access Private
   * @param {import('express').Request} req - Express request object. Body may contain `maxResults`, `includeRead`, `excludePromotions`.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response indicating the initiation or status of processing.
   */
  processDailyEmails = asyncHandler(async (req, res) => {
    try {
      const { maxResults, includeRead, excludePromotions } = req.body;
      const userId = req.user.id; // Assumes auth middleware populates req.user.id

      logger.info('Daily email processing request received.', { userId, maxResults, includeRead, excludePromotions });

      // Check if processing is already underway for this user to prevent duplicates
      const currentStatus = emailProcessingService.getProcessingStatus(userId);
      if (currentStatus && currentStatus.status === 'processing') {
        logger.warn(`Daily email processing attempt while already in progress for user ${userId}.`);
        return successResponse(res, currentStatus, 'Email processing is already in progress for your account.');
      }

      // Offload the actual processing to the service, potentially running it as a background task
      // This keeps the API responsive.
      emailProcessingService.processDailyEmails(userId, {
        maxResults: parseInt(maxResults, 10) || 20, // Default to 20 if not specified
        includeRead: includeRead !== undefined ? Boolean(includeRead) : true, // Default to true
        excludePromotions: excludePromotions !== undefined ? Boolean(excludePromotions) : true, // Default to true
      }).catch(err => {
        // Log errors from the asynchronous processing task
        logger.error('Background daily email processing encountered an error for user:', { userId, message: err.message, stack: err.stack });
      });

      return successResponse(res,
        { status: 'initiated', message: 'Daily email processing has been initiated. You will be notified upon completion, or you can check the status endpoint.' },
        'Daily email processing initiated successfully.'
      );

    } catch (error) {
      logger.error('Failed to initiate daily email processing:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to start daily email processing due to an internal error.', 500);
    }
  });

  /**
   * Processes a small batch of recent emails on-demand for the user.
   * Useful for quick updates or testing.
   * @method processEmailsNow
   * @route POST /api/v1/emails/process-now
   * @access Private
   * @param {import('express').Request} req - Express request object. Body may contain `maxResults`.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with the result of the on-demand processing.
   */
  processEmailsNow = asyncHandler(async (req, res) => {
    try {
      const { maxResults = 5 } = req.body; // Default to a small batch for on-demand
      const userId = req.user.id;

      logger.info('On-demand email processing request received.', { userId, maxResults });
      const result = await emailProcessingService.processEmailsOnDemand(userId, {
        maxResults: parseInt(maxResults, 10),
      });

      return successResponse(res, result, 'On-demand email processing completed successfully.');
    } catch (error) {
      logger.error('On-demand email processing controller failed:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to process emails on-demand due to an internal error.', 500);
    }
  });

  /**
   * Retrieves a paginated list of processed emails for the authenticated user.
   * Supports filtering by read status, importance, date range, and search query.
   * @method getEmails
   * @route GET /api/v1/emails
   * @access Private
   * @param {import('express').Request} req - Express request object. Query params: `page`, `limit`, `unreadOnly`, `importantOnly`, `after`, `before`, `search`, `isArchived`.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with emails and pagination details.
   */
  getEmails = asyncHandler(async (req, res) => {
    try {
      const { page = 1, limit = 20, unreadOnly, importantOnly, after, before, search, isArchived } = req.query;
      const userId = req.user.id;

      const options = { // Options for Email.findByUser or Email.searchEmails
        limit: Math.min(parseInt(limit, 10), 100), // Cap limit
        page: parseInt(page, 10),
        unreadOnly: unreadOnly === 'true',
        importantOnly: importantOnly === 'true',
        isArchived: isArchived === undefined ? undefined : (isArchived === 'true'),
        after: after ? new Date(after) : null,
        before: before ? new Date(before) : null,
      };
      
      let data;
      const baseQuery = { userId };
      if (options.unreadOnly) baseQuery.isRead = false;
      if (options.importantOnly) baseQuery.isImportant = true;
      if (options.isArchived !== undefined) baseQuery.isArchived = options.isArchived;
      if (options.after) baseQuery.receivedAt = { ...baseQuery.receivedAt, $gte: options.after };
      if (options.before) baseQuery.receivedAt = { ...baseQuery.receivedAt, $lte: options.before };

      if (search && typeof search === 'string' && search.trim() !== '') {
        // For search, pagination might be handled differently or simplified
        const searchResults = await Email.find(
            { ...baseQuery, $text: { $search: search.trim() } },
            { score: { $meta: 'textScore' } }
          )
          .sort({ score: { $meta: 'textScore' } })
          .limit(options.limit) // Apply limit for search results
          .lean();
        data = { emails: searchResults, searchPerformed: true, pagination: { totalItems: searchResults.length, itemsPerPage: options.limit, currentPage: 1, totalPages: 1} }; // Simplified pagination for search
      } else {
        const totalEmails = await Email.countDocuments(baseQuery);
        const emails = await Email.find(baseQuery)
            .sort({ receivedAt: -1 })
            .skip((options.page - 1) * options.limit)
            .limit(options.limit)
            .lean();

        const pagination = {
            currentPage: options.page,
            totalPages: Math.ceil(totalEmails / options.limit) || 1,
            totalItems: totalEmails,
            itemsPerPage: options.limit,
            hasNextPage: options.page * options.limit < totalEmails,
            hasPrevPage: options.page > 1,
        };
        data = { emails, pagination };
      }
      return successResponse(res, data, 'Emails retrieved successfully.');
    } catch (error) {
      logger.error('Failed to retrieve emails:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve emails.', 500);
    }
  });

  /**
   * Retrieves a single email by its ID for the authenticated user.
   * @method getEmailById
   * @route GET /api/v1/emails/:emailId
   * @access Private
   * @param {import('express').Request} req - Express request object, with `emailId` in params.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with the email details.
   */
  getEmailById = asyncHandler(async (req, res) => {
    try {
      const { emailId } = req.params;
      const userId = req.user.id;

      const email = await Email.findOne({ _id: emailId, userId }).lean(); // Use .lean() for read-only operations

      if (!email) {
        return errorResponse(res, 'Email not found or access denied.', 404);
      }
      return successResponse(res, { email }, 'Email retrieved successfully.');
    } catch (error) {
      logger.error('Failed to get email by ID:', { message: error.message, emailId: req.params.emailId, userId: req.user?.id });
      if (error.name === 'CastError') { // Handle invalid ObjectId format
        return errorResponse(res, 'Invalid email ID format.', 400);
      }
      return errorResponse(res, 'Failed to retrieve email details.', 500);
    }
  });

  /**
   * Retrieves summaries (e.g., daily, weekly) for the authenticated user.
   * Supports filtering by type, date range, and archived status, with pagination.
   * @method getSummaries
   * @route GET /api/v1/emails/summaries
   * @access Private
   * @param {import('express').Request} req - Express request object. Query params: `type`, `limit`, `page`, `after`, `before`, `archived`, `sortBy`, `sortOrder`.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with summaries and pagination.
   */
  getSummaries = asyncHandler(async (req, res) => {
    try {
      const { type = 'daily', limit = 10, page = 1, after, before, archived, sortBy = 'createdAt', sortOrder = '-1' } = req.query;
      const userId = req.user.id;

      const queryOptions = {
        type,
        limit: Math.min(parseInt(limit, 10), 50),
        page: parseInt(page, 10),
        after: after ? new Date(after) : null,
        before: before ? new Date(before) : null,
        archived: archived !== undefined ? (archived === 'true') : undefined,
        sortBy,
        sortOrder: parseInt(sortOrder, 10) === 1 ? 1 : -1,
      };

      const query = { userId, type: queryOptions.type };
      if (queryOptions.archived !== undefined) query.isArchived = queryOptions.archived;

      const dateField = queryOptions.sortBy === 'dateRange.start' ? 'dateRange.start' : 'createdAt';
      if (queryOptions.after) query[dateField] = { ...query[dateField], $gte: queryOptions.after };
      if (queryOptions.before) query[dateField] = { ...query[dateField], $lte: queryOptions.before };

      const totalSummaries = await Summary.countDocuments(query);
      const summaries = await Summary.find(query)
        .sort({ [queryOptions.sortBy]: queryOptions.sortOrder })
        .skip((queryOptions.page - 1) * queryOptions.limit)
        .limit(queryOptions.limit)
        .populate('emailIds', 'subject sender receivedAt isImportant snippet') // Populate relevant email fields
        .lean();

      const pagination = {
        currentPage: queryOptions.page,
        totalPages: Math.ceil(totalSummaries / queryOptions.limit) || 1,
        totalItems: totalSummaries,
        itemsPerPage: queryOptions.limit,
        hasNextPage: queryOptions.page * queryOptions.limit < totalSummaries,
        hasPrevPage: queryOptions.page > 1,
      };

      return successResponse(res, { summaries, pagination }, 'Summaries retrieved successfully.');
    } catch (error) {
      logger.error('Failed to retrieve summaries:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve summaries.', 500);
    }
  });

  /**
   * Retrieves the latest non-archived daily summary for the authenticated user.
   * @method getLatestSummary
   * @route GET /api/v1/emails/summaries/latest
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with the latest daily summary.
   */
  getLatestSummary = asyncHandler(async (req, res) => {
    try {
      const summary = await Summary.getLatestDailySummary(req.user.id).lean(); // Use lean for performance

      if (!summary) {
        return successResponse(res, { summary: null }, 'No recent daily summary found for your account.');
      }
      return successResponse(res, { summary }, 'Latest daily summary retrieved successfully.');
    } catch (error) {
      logger.error('Failed to retrieve latest summary:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve the latest summary.', 500);
    }
  });

  /**
   * Retrieves all pending (non-completed) action items for the authenticated user.
   * @method getActionItems
   * @route GET /api/v1/emails/action-items
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with a list of pending action items.
   */
  getActionItems = asyncHandler(async (req, res) => {
    try {
      const actionItems = await Summary.getPendingActionItems(req.user.id); // Static method from Summary model
      return successResponse(res, { actionItems, count: actionItems.length }, 'Pending action items retrieved successfully.');
    } catch (error) {
      logger.error('Failed to retrieve action items:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve action items.', 500);
    }
  });

  /**
   * Marks a specific action item as completed.
   * @method completeActionItem
   * @route PUT /api/v1/emails/action-items/:summaryId/:actionItemId
   * @access Private
   * @param {import('express').Request} req - Express request object with `summaryId` and `actionItemId` in params.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response confirming completion.
   */
  completeActionItem = asyncHandler(async (req, res) => {
    try {
      const { summaryId, actionItemId } = req.params;
      const userId = req.user.id;

      const summary = await Summary.findOne({ _id: summaryId, userId });
      if (!summary) {
        return errorResponse(res, 'Summary not found or access denied.', 404);
      }

      await summary.markActionItemCompleted(actionItemId); // Instance method
      return successResponse(res, null, 'Action item successfully marked as completed.');
    } catch (error) {
      logger.error('Failed to complete action item:', { message: error.message, params: req.params, userId: req.user?.id });
      if (error.message.includes('Action item not found')) {
        return errorResponse(res, error.message, 404); // Specific error from model method
      }
      if (error.name === 'CastError') return errorResponse(res, 'Invalid ID format for summary or action item.', 400);
      return errorResponse(res, 'Failed to mark action item as completed.', 500);
    }
  });

  /**
   * Retrieves email and summary statistics for the authenticated user over a specified period.
   * @method getEmailStats
   * @route GET /api/v1/emails/stats
   * @access Private
   * @param {import('express').Request} req - Express request object. Query param `days` (e.g., 7, 30).
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with statistics.
   */
  getEmailStats = asyncHandler(async (req, res) => {
    try {
      const { days = '7' } = req.query; // Default to 7 days
      const numDays = parseInt(days, 10);

      if (isNaN(numDays) || numDays <= 0) {
        return validationErrorResponse(res, [{field: 'days', message: 'Query parameter "days" must be a positive integer.'}]);
      }

      const userId = req.user.id;
      const emailStats = await Email.getEmailStats(userId, numDays); // Static method from Email model
      const summaryStats = await Summary.getSummaryStats(userId, numDays); // Static method from Summary model

      const stats = {
        emailActivity: emailStats,
        summaryActivity: summaryStats,
        reportingPeriod: {
          days: numDays,
          startDate: new Date(Date.now() - numDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          endDate: new Date().toISOString().split('T')[0],
        },
      };
      return successResponse(res, stats, 'Email and summary statistics retrieved successfully.');
    } catch (error) {
      logger.error('Failed to retrieve email statistics:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve email statistics.', 500);
    }
  });

  /**
   * Manually triggers a synchronization of recent emails from Gmail for the user.
   * @method syncEmails
   * @route POST /api/v1/emails/sync
   * @access Private
   * @param {import('express').Request} req - Express request object. Body may contain `maxResults`.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with the result of the sync operation.
   */
  syncEmails = asyncHandler(async (req, res) => {
    try {
      const { maxResults = 10 } = req.body; // Default to syncing a small number of emails
      const userId = req.user.id;

      // This service method should handle fetching from Gmail and storing/updating in DB
      const syncedEmails = await gmailService.fetchAndStoreRecentEmails(userId, {
        maxResults: Math.min(parseInt(maxResults, 10), 50), // Cap maxResults for manual sync
      });

      return successResponse(res, {
        message: `Successfully initiated sync for up to ${maxResults} emails.`,
        syncedCount: syncedEmails.length, // Number of emails actually fetched/updated
        // Optionally return brief info about synced emails if useful for client
        // syncedEmails: syncedEmails.map(e => ({ id: e._id, subject: e.subject, receivedAt: e.receivedAt })),
      }, 'Email synchronization initiated successfully.');
    } catch (error) {
      logger.error('Manual email sync controller failed:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to sync emails from Gmail.', 500);
    }
  });

  /**
   * Tests the Gmail API connection for the authenticated user by fetching their profile.
   * @method testConnection
   * @route POST /api/v1/emails/test-connection
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response indicating connection status.
   */
  testConnection = asyncHandler(async (req, res) => {
    try {
      const userProfile = await gmailService.getUserProfile(req.user.id); // This method should use stored tokens
      return successResponse(res, {
        connectionStatus: 'connected',
        userProfile: { // Return only non-sensitive parts of the profile
          emailAddress: userProfile.emailAddress,
          messagesTotal: userProfile.messagesTotal,
          threadsTotal: userProfile.threadsTotal,
          historyId: userProfile.historyId,
        },
        testedAt: new Date().toISOString(),
      }, 'Gmail connection test successful.');
    } catch (error) {
      logger.error('Gmail connection test controller failed:', { message: error.message, userId: req.user?.id });
      if (error.message.includes('token') || error.message.includes('credentials') || error.statusCode === 401) {
        return errorResponse(res, 'Gmail connection test failed: Authentication issue. Please try reconnecting your Gmail account.', 401);
      }
      return errorResponse(res, 'Gmail connection test failed due to an internal or API error.', 500);
    }
  });

  /**
   * Retrieves the current status of any ongoing email processing for the user.
   * @method getProcessingStatus
   * @route GET /api/v1/emails/processing-status
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with the processing status.
   */
  getProcessingStatus = asyncHandler(async (req, res) => {
    try {
      const status = emailProcessingService.getProcessingStatus(req.user.id);
      if (!status) {
        return successResponse(res, { status: 'idle', message: 'No active email processing task.', isProcessing: false }, 'Processing status retrieved.');
      }
      return successResponse(res, { ...status, isProcessing: status.status === 'processing' }, 'Processing status retrieved.');
    } catch (error) {
      logger.error('Failed to get email processing status:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve email processing status.', 500);
    }
  });

  /**
   * Archives a specific summary for the authenticated user.
   * @method archiveSummary
   * @route PUT /api/v1/emails/summaries/:summaryId/archive
   * @access Private
   * @param {import('express').Request} req - Express request object, with `summaryId` in params.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response confirming archival.
   */
  archiveSummary = asyncHandler(async (req, res) => {
    try {
      const { summaryId } = req.params;
      const userId = req.user.id;

      const summary = await Summary.findOne({ _id: summaryId, userId });
      if (!summary) {
        return errorResponse(res, 'Summary not found or access denied.', 404);
      }
      if (summary.isArchived) { // Check if already archived
        return successResponse(res, { summary }, 'Summary is already archived.');
      }

      await summary.archive(); // Instance method
      return successResponse(res, { summary }, 'Summary archived successfully.');
    } catch (error) {
      logger.error('Failed to archive summary:', { message: error.message, summaryId: req.params.summaryId, userId: req.user?.id });
      if (error.name === 'CastError') return errorResponse(res, 'Invalid summary ID format.', 400);
      return errorResponse(res, 'Failed to archive summary.', 500);
    }
  });

  /**
   * Allows the authenticated user to provide feedback on a specific summary.
   * @method provideSummaryFeedback
   * @route POST /api/v1/emails/summaries/:summaryId/feedback
   * @access Private
   * @param {import('express').Request} req - Express request object with `summaryId` in params. Body: `rating`, `helpful`, `comment`.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response confirming feedback submission.
   */
  provideSummaryFeedback = asyncHandler(async (req, res) => {
    try {
      const { summaryId } = req.params;
      const { rating, helpful, comment } = req.body;
      const userId = req.user.id;

      // Input validation
      if (rating !== undefined && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
        return validationErrorResponse(res, [{ field: 'rating', message: 'Rating must be a number between 1 and 5.' }]);
      }
      if (helpful !== undefined && typeof helpful !== 'boolean') {
        return validationErrorResponse(res, [{ field: 'helpful', message: 'Helpful must be a boolean value.' }]);
      }
      if (comment !== undefined && (typeof comment !== 'string' || comment.length > 1000)) { // Max length for comments
        return validationErrorResponse(res, [{ field: 'comment', message: 'Comment must be a string and no more than 1000 characters.'}]);
      }

      const summary = await Summary.findOne({ _id: summaryId, userId });
      if (!summary) {
        return errorResponse(res, 'Summary not found or access denied.', 404);
      }

      await summary.addFeedback({ rating, helpful, comment }); // Instance method

      // Optionally, update persona metrics based on feedback
      const persona = await Persona.findOne({ userId }); // Use findOne for persona
      if (persona && rating !== undefined) { // Only update metrics if rating is provided
        await persona.updateMetrics({ summaryRating: rating });
      }

      return successResponse(res, { feedback: summary.feedback }, 'Feedback submitted successfully.');
    } catch (error) {
      logger.error('Failed to submit summary feedback:', { message: error.message, summaryId: req.params.summaryId, userId: req.user?.id });
      if (error.name === 'CastError') return errorResponse(res, 'Invalid summary ID format.', 400);
      return errorResponse(res, 'Failed to submit feedback.', 500);
    }
  });

  /**
   * Searches across the user's emails and summaries based on a query string.
   * @method searchContent
   * @route GET /api/v1/emails/search
   * @access Private
   * @param {import('express').Request} req - Express request object. Query params: `q` (search query), `type` ('all', 'emails', 'summaries').
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with search results.
   */
  searchContent = asyncHandler(async (req, res) => {
    try {
      const { q, type = 'all' } = req.query; // Default to searching all content types
      const userId = req.user.id;

      if (!q || typeof q !== 'string' || q.trim().length < 2) {
        return validationErrorResponse(res, [{ field: 'q', message: 'Search query must be a string and at least 2 characters long.' }]);
      }

      const searchResults = { emails: [], summaries: [] };
      const searchQuery = q.trim();

      if (type === 'all' || type === 'emails') {
        searchResults.emails = await Email.searchEmails(userId, searchQuery, 10); // Limit results per type
      }
      if (type === 'all' || type === 'summaries') {
        searchResults.summaries = await Summary.searchSummaries(userId, searchQuery, 10);
      }

      return successResponse(res, {
        query: searchQuery,
        results: searchResults,
        totalFound: searchResults.emails.length + searchResults.summaries.length,
      }, 'Search completed successfully.');
    } catch (error) {
      logger.error('Content search controller failed:', { message: error.message, query: req.query.q, userId: req.user?.id });
      return errorResponse(res, 'Search operation failed.', 500);
    }
  });
}

module.exports = new EmailController();