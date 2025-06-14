const emailProcessingService = require('../services/email-processing.service');
const gmailService = require('../services/gmail.service');
const dailySummaryJob = require('../jobs/daily-summary.job');
const Email = require('../models/email.model');
const Summary = require('../models/summary.model');
const Persona = require('../models/persona.model');
const logger = require('../utils/logger');
const { successResponse, errorResponse, validationErrorResponse } = require('../utils/response');
const { asyncHandler } = require('../middleware/error.middleware');

class EmailController {
  /**
   * Process daily emails for the authenticated user
   * @route POST /emails/process-daily
   * @access Private
   */
  processDailyEmails = asyncHandler(async (req, res) => {
    try {
      const { maxResults, includeRead, excludePromotions } = req.body;

      logger.info('Processing daily emails requested', {
        userId: req.user.id,
        maxResults,
        includeRead,
        excludePromotions,
      });

      // Check if already processing
      const processingStatus = emailProcessingService.getProcessingStatus(req.user.id);
      if (processingStatus) {
        return successResponse(res, processingStatus, 'Email processing already in progress');
      }

      // Process emails
      const result = await emailProcessingService.processDailyEmails(req.user.id, {
        maxResults: maxResults || 20,
        includeRead: includeRead !== false,
        excludePromotions: excludePromotions !== false,
      });

      return successResponse(res, result, 'Daily email processing completed');

    } catch (error) {
      logger.error('Daily email processing failed:', error);
      return errorResponse(res, 'Failed to process daily emails', 500);
    }
  });

  /**
   * Process emails on-demand (smaller batch)
   * @route POST /emails/process-now
   * @access Private
   */
  processEmailsNow = asyncHandler(async (req, res) => {
    try {
      const { maxResults = 5 } = req.body;

      const result = await emailProcessingService.processEmailsOnDemand(req.user.id, {
        maxResults,
      });

      return successResponse(res, result, 'On-demand email processing completed');

    } catch (error) {
      logger.error('On-demand email processing failed:', error);
      return errorResponse(res, 'Failed to process emails', 500);
    }
  });

  /**
   * Get processed emails for the user
   * @route GET /emails
   * @access Private
   */
  getEmails = asyncHandler(async (req, res) => {
    try {
      const {
        page = 1,
        limit = 20,
        unreadOnly,
        importantOnly,
        after,
        before,
        search,
      } = req.query;

      const options = {
        limit: Math.min(parseInt(limit), 100),
        unreadOnly: unreadOnly === 'true',
        importantOnly: importantOnly === 'true',
        after: after ? new Date(after) : null,
        before: before ? new Date(before) : null,
      };

      let emails;
      
      if (search) {
        emails = await Email.searchEmails(req.user.id, search);
      } else {
        emails = await Email.findByUser(req.user.id, options);
      }

      // Pagination info
      const total = await Email.countDocuments({ userId: req.user.id });
      const pagination = {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / options.limit),
        totalItems: total,
        hasNext: page * options.limit < total,
        hasPrev: page > 1,
      };

      return successResponse(res, {
        emails,
        pagination,
      }, 'Emails retrieved successfully');

    } catch (error) {
      logger.error('Failed to get emails:', error);
      return errorResponse(res, 'Failed to retrieve emails', 500);
    }
  });

  /**
   * Get a specific email by ID
   * @route GET /emails/:emailId
   * @access Private
   */
  getEmailById = asyncHandler(async (req, res) => {
    try {
      const { emailId } = req.params;

      const email = await Email.findOne({
        _id: emailId,
        userId: req.user.id,
      });

      if (!email) {
        return errorResponse(res, 'Email not found', 404);
      }

      return successResponse(res, { email }, 'Email retrieved successfully');

    } catch (error) {
      logger.error('Failed to get email by ID:', error);
      return errorResponse(res, 'Failed to retrieve email', 500);
    }
  });

  /**
   * Get daily summaries for the user
   * @route GET /emails/summaries
   * @access Private
   */
  getSummaries = asyncHandler(async (req, res) => {
    try {
      const {
        type = 'daily',
        limit = 10,
        after,
        before,
        archived,
      } = req.query;

      const options = {
        type,
        limit: Math.min(parseInt(limit), 50),
        after: after ? new Date(after) : null,
        before: before ? new Date(before) : null,
        archived: archived !== undefined ? archived === 'true' : false,
      };

      const summaries = await Summary.findByUser(req.user.id, options);

      return successResponse(res, {
        summaries,
        count: summaries.length,
      }, 'Summaries retrieved successfully');

    } catch (error) {
      logger.error('Failed to get summaries:', error);
      return errorResponse(res, 'Failed to retrieve summaries', 500);
    }
  });

  /**
   * Get the latest daily summary
   * @route GET /emails/summaries/latest
   * @access Private
   */
  getLatestSummary = asyncHandler(async (req, res) => {
    try {
      const summary = await Summary.getLatestDailySummary(req.user.id);

      if (!summary) {
        return successResponse(res, null, 'No recent summary found');
      }

      return successResponse(res, { summary }, 'Latest summary retrieved successfully');

    } catch (error) {
      logger.error('Failed to get latest summary:', error);
      return errorResponse(res, 'Failed to retrieve latest summary', 500);
    }
  });

  /**
   * Get pending action items
   * @route GET /emails/action-items
   * @access Private
   */
  getActionItems = asyncHandler(async (req, res) => {
    try {
      const actionItems = await Summary.getPendingActionItems(req.user.id);

      return successResponse(res, {
        actionItems,
        count: actionItems.length,
      }, 'Action items retrieved successfully');

    } catch (error) {
      logger.error('Failed to get action items:', error);
      return errorResponse(res, 'Failed to retrieve action items', 500);
    }
  });

  /**
   * Mark action item as completed
   * @route PUT /emails/action-items/:summaryId/:actionItemId
   * @access Private
   */
  completeActionItem = asyncHandler(async (req, res) => {
    try {
      const { summaryId, actionItemId } = req.params;

      const summary = await Summary.findOne({
        _id: summaryId,
        userId: req.user.id,
      });

      if (!summary) {
        return errorResponse(res, 'Summary not found', 404);
      }

      await summary.markActionItemCompleted(actionItemId);

      return successResponse(res, null, 'Action item marked as completed');

    } catch (error) {
      logger.error('Failed to complete action item:', error);
      return errorResponse(res, 'Failed to complete action item', 500);
    }
  });

  /**
   * Get email statistics
   * @route GET /emails/stats
   * @access Private
   */
  getEmailStats = asyncHandler(async (req, res) => {
    try {
      const { days = 7 } = req.query;

      const emailStats = await Email.getEmailStats(req.user.id, parseInt(days));
      const summaryStats = await Summary.getSummaryStats(req.user.id, parseInt(days));

      const stats = {
        emailStats,
        summaryStats,
        period: {
          days: parseInt(days),
          startDate: new Date(Date.now() - (parseInt(days) * 24 * 60 * 60 * 1000)),
          endDate: new Date(),
        },
      };

      return successResponse(res, stats, 'Email statistics retrieved successfully');

    } catch (error) {
      logger.error('Failed to get email stats:', error);
      return errorResponse(res, 'Failed to retrieve email statistics', 500);
    }
  });

  /**
   * Sync emails from Gmail manually
   * @route POST /emails/sync
   * @access Private
   */
  syncEmails = asyncHandler(async (req, res) => {
    try {
      const { maxResults = 10 } = req.body;

      const emails = await gmailService.fetchRecentEmails(req.user.id, {
        maxResults: Math.min(parseInt(maxResults), 50),
      });

      return successResponse(res, {
        emails: emails.map(email => ({
          messageId: email.messageId,
          subject: email.subject,
          sender: email.sender,
          receivedAt: email.receivedAt,
          isUnread: email.isUnread,
        })),
        count: emails.length,
      }, 'Emails synced successfully');

    } catch (error) {
      logger.error('Failed to sync emails:', error);
      return errorResponse(res, 'Failed to sync emails', 500);
    }
  });

  /**
   * Test Gmail connection
   * @route POST /emails/test-connection
   * @access Private
   */
  testConnection = asyncHandler(async (req, res) => {
    try {
      const profile = await gmailService.getUserProfile(req.user.id);

      return successResponse(res, {
        connected: true,
        profile,
        testedAt: new Date(),
      }, 'Gmail connection test successful');

    } catch (error) {
      logger.error('Gmail connection test failed:', error);
      return errorResponse(res, 'Gmail connection test failed', 500);
    }
  });

  /**
   * Get processing status
   * @route GET /emails/processing-status
   * @access Private
   */
  getProcessingStatus = asyncHandler(async (req, res) => {
    try {
      const status = emailProcessingService.getProcessingStatus(req.user.id);

      if (!status) {
        return successResponse(res, {
          status: 'idle',
          isProcessing: false,
        }, 'No processing in progress');
      }

      return successResponse(res, {
        ...status,
        isProcessing: true,
      }, 'Processing status retrieved');

    } catch (error) {
      logger.error('Failed to get processing status:', error);
      return errorResponse(res, 'Failed to get processing status', 500);
    }
  });

  /**
   * Archive a summary
   * @route PUT /emails/summaries/:summaryId/archive
   * @access Private
   */
  archiveSummary = asyncHandler(async (req, res) => {
    try {
      const { summaryId } = req.params;

      const summary = await Summary.findOne({
        _id: summaryId,
        userId: req.user.id,
      });

      if (!summary) {
        return errorResponse(res, 'Summary not found', 404);
      }

      await summary.archive();

      return successResponse(res, null, 'Summary archived successfully');

    } catch (error) {
      logger.error('Failed to archive summary:', error);
      return errorResponse(res, 'Failed to archive summary', 500);
    }
  });

  /**
   * Provide feedback on a summary
   * @route POST /emails/summaries/:summaryId/feedback
   * @access Private
   */
  provideSummaryFeedback = asyncHandler(async (req, res) => {
    try {
      const { summaryId } = req.params;
      const { rating, helpful, comment } = req.body;

      // Validate input
      if (rating !== undefined && (rating < 1 || rating > 5)) {
        return validationErrorResponse(res, [
          { field: 'rating', message: 'Rating must be between 1 and 5' }
        ]);
      }

      const summary = await Summary.findOne({
        _id: summaryId,
        userId: req.user.id,
      });

      if (!summary) {
        return errorResponse(res, 'Summary not found', 404);
      }

      await summary.addFeedback({
        rating,
        helpful,
        comment,
      });

      // Update persona metrics if persona exists
      const persona = await Persona.findByUser(req.user.id);
      if (persona) {
        await persona.updateMetrics(rating);
      }

      return successResponse(res, null, 'Feedback submitted successfully');

    } catch (error) {
      logger.error('Failed to provide summary feedback:', error);
      return errorResponse(res, 'Failed to submit feedback', 500);
    }
  });

  /**
   * Search across emails and summaries
   * @route GET /emails/search
   * @access Private
   */
  searchContent = asyncHandler(async (req, res) => {
    try {
      const { q, type = 'all' } = req.query;

      if (!q || q.trim().length < 2) {
        return validationErrorResponse(res, [
          { field: 'q', message: 'Search query must be at least 2 characters long' }
        ]);
      }

      const results = {
        emails: [],
        summaries: [],
      };

      if (type === 'all' || type === 'emails') {
        results.emails = await Email.searchEmails(req.user.id, q);
      }

      if (type === 'all' || type === 'summaries') {
        results.summaries = await Summary.searchSummaries(req.user.id, q);
      }

      return successResponse(res, {
        ...results,
        query: q,
        totalResults: results.emails.length + results.summaries.length,
      }, 'Search completed successfully');

    } catch (error) {
      logger.error('Search failed:', error);
      return errorResponse(res, 'Search failed', 500);
    }
  });
}

module.exports = new EmailController();