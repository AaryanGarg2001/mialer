const express = require('express');
const aiController = require('../controllers/ai.controller');
const { 
  authenticate, 
  checkUsageLimit, 
  trackUsage,
  requireSubscription 
} = require('../middleware/auth.middleware');

const router = express.Router();

/**
 * @route GET /ai/health
 * @description Check AI service health and capabilities
 * @access Private
 */
router.get('/health', 
  authenticate, 
  aiController.healthCheck
);

/**
 * @route GET /ai/info
 * @description Get AI service information and capabilities
 * @access Private
 */
router.get('/info', 
  authenticate, 
  aiController.getServiceInfo
);

/**
 * @route POST /ai/test
 * @description Test AI service with sample email
 * @access Private
 */
router.post('/test', 
  authenticate,
  checkUsageLimit('apiCallsThisMonth', 10), // Allow 10 test calls per month for free users
  trackUsage('apiCallsThisMonth'),
  aiController.testService
);

/**
 * @route POST /ai/summarize-email
 * @description Generate summary for a single email
 * @access Private
 */
router.post('/summarize-email', 
  authenticate,
  checkUsageLimit('emailsProcessed', 100), // Free tier limit
  trackUsage('emailsProcessed'),
  trackUsage('apiCallsThisMonth'),
  aiController.summarizeEmail
);

/**
 * @route POST /ai/daily-summary
 * @description Generate daily summary from multiple email summaries
 * @access Private
 */
router.post('/daily-summary', 
  authenticate,
  checkUsageLimit('summariesGenerated', 30), // Free tier limit
  trackUsage('summariesGenerated'),
  trackUsage('apiCallsThisMonth'),
  aiController.generateDailySummary
);

/**
 * @route POST /ai/ask
 * @description Answer questions about emails using AI
 * @access Private
 */
router.post('/ask', 
  authenticate,
  checkUsageLimit('apiCallsThisMonth', 500), // Free tier limit
  trackUsage('apiCallsThisMonth'),
  aiController.askQuestion
);

/**
 * @route GET /ai/usage
 * @description Get AI service usage statistics
 * @access Private
 */
router.get('/usage', 
  authenticate, 
  aiController.getUsageStats
);

// Pro tier endpoints (higher limits)
/**
 * @route POST /ai/pro/summarize-email
 * @description Generate summary for a single email (Pro tier)
 * @access Private - Pro subscription required
 */
router.post('/pro/summarize-email', 
  authenticate,
  requireSubscription('pro'),
  checkUsageLimit('emailsProcessed', 1000), // Pro tier limit
  trackUsage('emailsProcessed'),
  trackUsage('apiCallsThisMonth'),
  aiController.summarizeEmail
);

/**
 * @route POST /ai/pro/daily-summary
 * @description Generate daily summary (Pro tier)
 * @access Private - Pro subscription required
 */
router.post('/pro/daily-summary', 
  authenticate,
  requireSubscription('pro'),
  checkUsageLimit('summariesGenerated', 300), // Pro tier limit
  trackUsage('summariesGenerated'),
  trackUsage('apiCallsThisMonth'),
  aiController.generateDailySummary
);

/**
 * @route POST /ai/pro/ask
 * @description Answer questions about emails (Pro tier)
 * @access Private - Pro subscription required
 */
router.post('/pro/ask', 
  authenticate,
  requireSubscription('pro'),
  checkUsageLimit('apiCallsThisMonth', 5000), // Pro tier limit
  trackUsage('apiCallsThisMonth'),
  aiController.askQuestion
);

// Enterprise tier endpoints (unlimited)
/**
 * @route POST /ai/enterprise/summarize-email
 * @description Generate summary for a single email (Enterprise tier)
 * @access Private - Enterprise subscription required
 */
router.post('/enterprise/summarize-email', 
  authenticate,
  requireSubscription('enterprise'),
  // No usage limits for enterprise
  trackUsage('emailsProcessed'),
  aiController.summarizeEmail
);

/**
 * @route POST /ai/enterprise/daily-summary
 * @description Generate daily summary (Enterprise tier)
 * @access Private - Enterprise subscription required
 */
router.post('/enterprise/daily-summary', 
  authenticate,
  requireSubscription('enterprise'),
  // No usage limits for enterprise
  trackUsage('summariesGenerated'),
  aiController.generateDailySummary
);

/**
 * @route POST /ai/enterprise/ask
 * @description Answer questions about emails (Enterprise tier)
 * @access Private - Enterprise subscription required
 */
router.post('/enterprise/ask', 
  authenticate,
  requireSubscription('enterprise'),
  // No usage limits for enterprise
  aiController.askQuestion
);

module.exports = router;