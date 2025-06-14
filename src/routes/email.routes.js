const express = require('express');
const emailController = require('../controllers/email.controller');
const { 
  authenticate, 
  requireGmail,
  checkUsageLimit, 
  trackUsage,
  ensureValidGmailToken 
} = require('../middleware/auth.middleware');

const router = express.Router();

// All email routes require authentication and Gmail connection
router.use(authenticate);
router.use(requireGmail);
router.use(ensureValidGmailToken);

/**
 * @route POST /emails/process-daily
 * @description Process daily emails and generate summaries
 * @access Private
 */
router.post('/process-daily',
  checkUsageLimit('emailsProcessed', 100), // Free tier limit
  trackUsage('emailsProcessed'),
  emailController.processDailyEmails
);

/**
 * @route POST /emails/process-now
 * @description Process emails on-demand (smaller batch)
 * @access Private
 */
router.post('/process-now',
  checkUsageLimit('apiCallsThisMonth', 50), // Limit on-demand processing
  trackUsage('apiCallsThisMonth'),
  emailController.processEmailsNow
);

/**
 * @route GET /emails
 * @description Get processed emails for the user
 * @access Private
 */
router.get('/',
  emailController.getEmails
);

/**
 * @route GET /emails/:emailId
 * @description Get a specific email by ID
 * @access Private
 */
router.get('/:emailId',
  emailController.getEmailById
);

/**
 * @route GET /emails/summaries
 * @description Get daily summaries for the user
 * @access Private
 */
router.get('/summaries',
  emailController.getSummaries
);

/**
 * @route GET /emails/summaries/latest
 * @description Get the latest daily summary
 * @access Private
 */
router.get('/summaries/latest',
  emailController.getLatestSummary
);

/**
 * @route GET /emails/action-items
 * @description Get pending action items
 * @access Private
 */
router.get('/action-items',
  emailController.getActionItems
);

/**
 * @route PUT /emails/action-items/:summaryId/:actionItemId
 * @description Mark action item as completed
 * @access Private
 */
router.put('/action-items/:summaryId/:actionItemId',
  emailController.completeActionItem
);

/**
 * @route GET /emails/stats
 * @description Get email statistics
 * @access Private
 */
router.get('/stats',
  emailController.getEmailStats
);

/**
 * @route POST /emails/sync
 * @description Sync emails from Gmail manually
 * @access Private
 */
router.post('/sync',
  checkUsageLimit('apiCallsThisMonth', 100),
  trackUsage('apiCallsThisMonth'),
  emailController.syncEmails
);

/**
 * @route POST /emails/test-connection
 * @description Test Gmail connection
 * @access Private
 */
router.post('/test-connection',
  emailController.testConnection
);

/**
 * @route GET /emails/processing-status
 * @description Get processing status
 * @access Private
 */
router.get('/processing-status',
  emailController.getProcessingStatus
);

/**
 * @route PUT /emails/summaries/:summaryId/archive
 * @description Archive a summary
 * @access Private
 */
router.put('/summaries/:summaryId/archive',
  emailController.archiveSummary
);

/**
 * @route POST /emails/summaries/:summaryId/feedback
 * @description Provide feedback on a summary
 * @access Private
 */
router.post('/summaries/:summaryId/feedback',
  emailController.provideSummaryFeedback
);

/**
 * @route GET /emails/search
 * @description Search across emails and summaries
 * @access Private
 */
router.get('/search',
  checkUsageLimit('apiCallsThisMonth', 200),
  trackUsage('apiCallsThisMonth'),
  emailController.searchContent
);

module.exports = router;