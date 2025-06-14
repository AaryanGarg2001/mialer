const aiService = require('../services/ai.service.js');
const logger = require('../utils/logger');
const { successResponse, errorResponse, validationErrorResponse } = require('../utils/response');
const { asyncHandler } = require('../middleware/error.middleware');
const aiConfig = require('../config/ai.config');
const User = require('../models/User.model.js'); // Ensure .js extension and correct casing

/**
 * @file AI Controller
 * @module controllers/ai
 * @requires ../services/ai.service
 * @requires ../utils/logger
 * @requires ../utils/response
 * @requires ../middleware/error.middleware
 * @requires ../config/ai.config
 * @requires ../models/user.model
 */

/**
 * Controller for AI-related operations.
 * Handles requests for health checks, email summarization, daily summaries,
 * question answering, service info, testing, and usage statistics.
 * All methods are wrapped with `asyncHandler` for error handling.
 * @class AIController
 */
class AIController {
  /**
   * Tests AI service connectivity and capabilities.
   * @method healthCheck
   * @route GET /api/v1/ai/health
   * @access Private (Requires authentication)
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with AI service health status.
   */
  healthCheck = asyncHandler(async (req, res) => {
    try {
      const healthData = await aiService.healthCheck();
      
      logger.info('AI service health check performed', { // Changed log message for clarity
        userId: req.user?.id, // Assumes req.user is populated by auth middleware
        provider: healthData.provider,
        isHealthy: healthData.healthy, // Standardized to isHealthy
      });

      if (healthData.healthy) {
        return successResponse(res, healthData, 'AI service is healthy and operational.');
      } else {
        // Use a more specific status code if the service is unhealthy (e.g., 503 Service Unavailable)
        return errorResponse(res, 'AI service is currently unhealthy or unavailable.', 503, healthData);
      }
    } catch (error) {
      logger.error('AI health check controller failed:', { message: error.message, stack: error.stack });
      return errorResponse(res, 'An error occurred during the AI health check.', 500);
    }
  });

  /**
   * Generates a summary for a single email provided in the request body.
   * @method summarizeEmail
   * @route POST /api/v1/ai/summarize-email
   * @access Private
   * @param {import('express').Request} req - Express request object. Expects `req.body` to contain `subject`, `body`, `sender`, `receivedAt`, `snippet`.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with the generated email summary.
   */
  summarizeEmail = asyncHandler(async (req, res) => {
    try {
      const { subject, body, sender, receivedAt, snippet } = req.body;

      // Basic validation for essential email content
      if (!subject && !body && !snippet) {
        return validationErrorResponse(res, [{ field: 'emailContent', message: 'Email subject, body, or snippet is required to generate a summary.' }]);
      }

      // Fetch user and their persona (if exists) to tailor the summary
      const user = await User.findById(req.user.id).populate('persona'); // Populate persona details
      const persona = user?.persona || null; // Use null if no persona

      const emailData = {
        subject: subject || 'No Subject Provided',
        body: body || snippet || '', // Ensure body is not undefined
        sender: sender || 'Unknown Sender',
        receivedAt: receivedAt ? new Date(receivedAt) : new Date(), // Ensure valid date
        snippet: snippet || '',
      };

      const summary = await aiService.generateEmailSummary(emailData, persona, 'individual');

      // Increment usage counter for the user
      if (user) { // Ensure user object exists
        await user.incrementUsage('emailsProcessed');
        await user.incrementUsage('apiCallsThisMonth'); // Also count as a general API call
      }

      logger.info('Single email summary generated successfully', {
        userId: req.user.id,
        emailSubjectPreview: emailData.subject.substring(0, 50), // Log a preview
        summaryLength: summary.content?.length || 0,
      });

      return successResponse(res, {
        summary,
        originalEmail: { subject: emailData.subject, sender: emailData.sender }, // Provide some context
        generatedAt: new Date().toISOString(),
      }, 'Email summary generated successfully.');

    } catch (error) {
      logger.error('Email summarization controller failed:', { message: error.message, userId: req.user?.id });
      if (error.message.toLowerCase().includes('rate limit')) {
        return errorResponse(res, 'AI service rate limit exceeded. Please try again later.', 429);
      } else if (error.message.toLowerCase().includes('authentication') || error.message.toLowerCase().includes('api key')) {
        return errorResponse(res, 'AI service configuration error. Please contact support.', 500);
      }
      return errorResponse(res, 'Failed to generate email summary due to an internal error.', 500);
    }
  });

  /**
   * Generates a daily summary from an array of individual email summaries.
   * @method generateDailySummary
   * @route POST /api/v1/ai/daily-summary
   * @access Private
   * @param {import('express').Request} req - Express request object. Expects `req.body` to contain `summaries` (array) and optional `date`.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with the generated daily summary.
   */
  generateDailySummary = asyncHandler(async (req, res) => {
    try {
      const { summaries, date } = req.body; // `summaries` is expected to be an array of pre-summarized email objects or full email data

      if (!Array.isArray(summaries) || summaries.length === 0) {
        return validationErrorResponse(res, [{ field: 'summaries', message: 'An array of email summaries or details is required.' }]);
      }

      const user = await User.findById(req.user.id).populate('persona');
      const persona = user?.persona || null;

      const dailySummary = await aiService.generateDailySummary(summaries, persona);

      // Enhance daily summary object
      dailySummary.date = date ? new Date(date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
      dailySummary.generatedAt = new Date().toISOString();
      dailySummary.sourceEmailCount = summaries.length;

      if (user) {
        await user.incrementUsage('summariesGenerated');
        await user.incrementUsage('apiCallsThisMonth');
      }

      logger.info('Daily summary generated successfully', {
        userId: req.user.id,
        emailCount: summaries.length,
        summaryDate: dailySummary.date,
      });

      return successResponse(res, { dailySummary }, 'Daily summary generated successfully.');

    } catch (error) {
      logger.error('Daily summary generation controller failed:', { message: error.message, userId: req.user?.id });
      if (error.message.toLowerCase().includes('rate limit')) {
        return errorResponse(res, 'AI service rate limit exceeded. Please try again later.', 429);
      }
      return errorResponse(res, 'Failed to generate daily summary due to an internal error.', 500);
    }
  });

  /**
   * Answers a user's question based on provided email context.
   * @method askQuestion
   * @route POST /api/v1/ai/ask
   * @access Private
   * @param {import('express').Request} req - Express request object. Expects `req.body` to contain `question` and `emailContext` (array).
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with the AI-generated answer.
   */
  askQuestion = asyncHandler(async (req, res) => {
    try {
      const { question, emailContext } = req.body;

      if (!question || typeof question !== 'string' || question.trim() === '') {
        return validationErrorResponse(res, [{ field: 'question', message: 'A non-empty question is required.' }]);
      }
      if (!Array.isArray(emailContext)) { // Could add more validation for context items
        return validationErrorResponse(res, [{ field: 'emailContext', message: 'Email context must be an array.' }]);
      }

      const user = await User.findById(req.user.id).populate('persona');
      const persona = user?.persona || null;

      const answer = await aiService.answerEmailQuestion(question, emailContext, persona);

      if (user) {
        await user.incrementUsage('apiCallsThisMonth'); // Consider a specific counter for Q&A if needed
      }

      logger.info('AI question answered successfully', {
        userId: req.user.id,
        questionPreview: question.substring(0, 100),
      });

      return successResponse(res, {
        question,
        answer,
        contextItemsProvided: emailContext.length,
        answeredAt: new Date().toISOString(),
      }, 'Question answered successfully.');

    } catch (error) {
      logger.error('AI question answering controller failed:', { message: error.message, userId: req.user?.id });
      if (error.message.toLowerCase().includes('rate limit')) {
        return errorResponse(res, 'AI service rate limit exceeded. Please try again later.', 429);
      }
      return errorResponse(res, 'Failed to answer question due to an internal error.', 500);
    }
  });

  /**
   * Retrieves information about the configured AI service, its capabilities, and models.
   * @method getServiceInfo
   * @route GET /api/v1/ai/info
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with AI service information.
   */
  getServiceInfo = asyncHandler(async (req, res) => {
    try {
      const currentProviderConfig = aiConfig.getCurrentProvider();
      const capabilities = aiConfig.getProviderCapabilities();
      const rateLimits = aiConfig.getRateLimit();
      const models = await aiConfig.getAvailableModels(); // This is an async function

      const serviceInfo = {
        provider: {
          name: currentProviderConfig.name,
          configuredModels: currentProviderConfig.models, // Models specifically configured for use cases
          defaultModel: currentProviderConfig.defaultModel,
          maxTokensOverall: currentProviderConfig.maxTokens,
        },
        detailedCapabilities: capabilities,
        currentRateLimits: rateLimits,
        availableModelsList: models.map(m => ({ id: m.id, contextWindow: m.contextWindow })).slice(0,10), // Show limited list
        supportedFeatures: { // Simplified feature list
          emailSummarization: true,
          dailySummaryGeneration: true,
          questionAnswering: true,
          multiLanguageSupport: !!capabilities.conversational,
          streamingResponses: !!capabilities.streaming,
        },
      };

      logger.info('AI service information retrieved', { userId: req.user.id, provider: currentProviderConfig.name });
      return successResponse(res, serviceInfo, 'AI service information retrieved successfully.');

    } catch (error) {
      logger.error('Failed to get AI service info:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve AI service information.', 500);
    }
  });

  /**
   * Performs a test of the AI summarization service using a sample email.
   * @method testService
   * @route POST /api/v1/ai/test
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with the test summary or an error.
   */
  testService = asyncHandler(async (req, res) => {
    try {
      const sampleEmail = {
        subject: 'Project Phoenix - Critical Update & Action Required',
        body: `Hi Team,\n\nFollowing our discussion on the new client feedback for Project Phoenix, we need to implement the revised UI mockups by EOD Wednesday. Resources are available in the shared drive.\n\nKey points:\n- Login page needs two-factor authentication.\n- Dashboard graphs must be interactive.\n- User profile section requires avatar uploads.\n\nPlease confirm your assigned tasks. Let's sync tomorrow at 10 AM for a quick huddle.\n\nBest,\nSarah (Project Lead)`,
        sender: 'sarah.lead@example.com',
        receivedAt: new Date(Date.now() - 24 * 60 * 60 * 1000), // Yesterday
      };

      // Fetch user persona to make the test more realistic, if available
      const user = await User.findById(req.user.id).populate('persona');
      const persona = user?.persona || null;

      const summary = await aiService.generateEmailSummary(sampleEmail, persona, 'individual');

      logger.info('AI service test summarization completed successfully', { userId: req.user.id });
      return successResponse(res, {
        testEmailDetails: { subject: sampleEmail.subject, sender: sampleEmail.sender },
        generatedTestSummary: summary,
        status: 'success',
        timestamp: new Date().toISOString(),
      }, 'AI service test completed successfully.');

    } catch (error) {
      logger.error('AI service test controller failed:', { message: error.message, userId: req.user?.id });
      return errorResponse(res,
        { status: 'failed', errorDetails: error.message, timestamp: new Date().toISOString() },
        'AI service test failed.',
        500
      );
    }
  });

  /**
   * Retrieves AI service usage statistics for the authenticated user.
   * @method getUsageStats
   * @route GET /api/v1/ai/usage
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with user's AI usage statistics.
   */
  getUsageStats = asyncHandler(async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) { // Should not happen if auth middleware is effective
        return errorResponse(res, 'User not found.', 404);
      }
      
      const planLimits = this.getUsageLimits(user.subscription.plan);
      const currentUsage = user.usage || {}; // Ensure usage object exists

      const usageStats = {
        currentCycleUsage: {
          emailsProcessed: currentUsage.emailsProcessed || 0,
          summariesGenerated: currentUsage.summariesGenerated || 0,
          apiCalls: currentUsage.apiCallsThisMonth || 0,
        },
        subscriptionPlan: user.subscription.plan,
        cycleLimits: planLimits,
        cycleResetsAt: user.usage?.lastResetAt ? new Date(user.usage.lastResetAt.setDate(user.usage.lastResetAt.getDate() + 30)).toISOString() : 'N/A', // Approximate next reset
      };

      // Calculate percentages if limits are defined (not null/unlimited)
      usageStats.usagePercentages = {
        emailsProcessed: planLimits.emailsProcessed ? Math.min(100, Math.round((usageStats.currentCycleUsage.emailsProcessed / planLimits.emailsProcessed) * 100)) : 'N/A',
        summariesGenerated: planLimits.summariesGenerated ? Math.min(100, Math.round((usageStats.currentCycleUsage.summariesGenerated / planLimits.summariesGenerated) * 100)) : 'N/A',
        apiCalls: planLimits.apiCalls ? Math.min(100, Math.round((usageStats.currentCycleUsage.apiCalls / planLimits.apiCalls) * 100)) : 'N/A',
      };

      return successResponse(res, usageStats, 'Usage statistics retrieved successfully.');

    } catch (error) {
      logger.error('Failed to get usage stats:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve usage statistics.', 500);
    }
  });

  /**
   * Helper method to get usage limits based on subscription plan.
   * This could be moved to a subscription service or config if it grows complex.
   * @private
   * @param {string} plan - The user's subscription plan (e.g., 'free', 'pro').
   * @returns {object} Object containing limits for emailsProcessed, summariesGenerated, apiCalls.
   */
  getUsageLimits(plan) {
    // These limits should ideally be stored in a configuration file or database
    const limitsByPlan = {
      free: { emailsProcessed: 100, summariesGenerated: 30, apiCalls: 500 },
      pro: { emailsProcessed: 1000, summariesGenerated: 300, apiCalls: 5000 },
      enterprise: { emailsProcessed: null, summariesGenerated: null, apiCalls: null }, // null indicates unlimited
    };
    return limitsByPlan[plan] || limitsByPlan.free; // Default to free plan limits if plan is unknown
  }
}

module.exports = new AIController();