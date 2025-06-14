const aiService = require('../services/ai.service.js');
const logger = require('../utils/logger');
const { successResponse, errorResponse, validationErrorResponse } = require('../utils/response');
const { asyncHandler } = require('../middleware/error.middleware');
const aiConfig = require('../config/ai.config');
const User = require('../models/user.model');

class AIController {
  /**
   * Test AI service connectivity and capabilities
   * @route GET /ai/health
   * @access Private
   */
  healthCheck = asyncHandler(async (req, res) => {
    try {
      const healthData = await aiService.healthCheck();
      
      logger.info('AI service health check requested', {
        userId: req.user?.id,
        provider: healthData.provider,
        healthy: healthData.healthy,
      });

      if (healthData.healthy) {
        return successResponse(res, healthData, 'AI service is healthy');
      } else {
        return errorResponse(res, 'AI service is unhealthy', 503, healthData);
      }
    } catch (error) {
      logger.error('AI health check failed:', error);
      return errorResponse(res, 'AI health check failed', 500);
    }
  });

  /**
   * Generate summary for a single email
   * @route POST /ai/summarize-email
   * @access Private
   */
  summarizeEmail = asyncHandler(async (req, res) => {
    try {
      const { subject, body, sender, receivedAt, snippet } = req.body;

      // Validate required fields
      if (!subject && !body && !snippet) {
        return validationErrorResponse(res, [
          { field: 'content', message: 'Email subject, body, or snippet is required' }
        ]);
      }

      // Get user persona if available
      const user = await User.findById(req.user.id).populate('persona');
      const persona = user.persona || null;

      // Prepare email data
      const emailData = {
        subject: subject || 'No subject',
        body: body || snippet || '',
        sender: sender || 'Unknown sender',
        receivedAt: receivedAt || new Date(),
        snippet: snippet || '',
      };

      // Generate summary
      const summary = await aiService.generateEmailSummary(emailData, persona, 'individual');

      // Track usage
      await user.incrementUsage('emailsProcessed');

      logger.info('Email summary generated', {
        userId: req.user.id,
        subject: subject?.substring(0, 50),
        summaryLength: summary.content?.length || 0,
        actionItems: summary.actionItems?.length || 0,
      });

      return successResponse(res, {
        summary,
        emailData: {
          subject: emailData.subject,
          sender: emailData.sender,
          receivedAt: emailData.receivedAt,
        },
        generatedAt: new Date(),
      }, 'Email summary generated successfully');

    } catch (error) {
      logger.error('Email summarization failed:', error);
      
      if (error.message.includes('rate limit')) {
        return errorResponse(res, 'AI service rate limit exceeded. Please try again later.', 429);
      } else if (error.message.includes('authentication')) {
        return errorResponse(res, 'AI service configuration error', 500);
      }
      
      return errorResponse(res, 'Failed to generate email summary', 500);
    }
  });

  /**
   * Generate daily summary from multiple email summaries
   * @route POST /ai/daily-summary
   * @access Private
   */
  generateDailySummary = asyncHandler(async (req, res) => {
    try {
      const { summaries, date } = req.body;

      // Validate input
      if (!Array.isArray(summaries) || summaries.length === 0) {
        return validationErrorResponse(res, [
          { field: 'summaries', message: 'Array of email summaries is required' }
        ]);
      }

      // Get user persona
      const user = await User.findById(req.user.id).populate('persona');
      const persona = user.persona || null;

      // Generate daily summary
      const dailySummary = await aiService.generateDailySummary(summaries, persona);

      // Add date information
      dailySummary.date = date || new Date().toISOString().split('T')[0];
      dailySummary.generatedAt = new Date();

      // Track usage
      await user.incrementUsage('summariesGenerated');

      logger.info('Daily summary generated', {
        userId: req.user.id,
        emailCount: summaries.length,
        summaryLength: dailySummary.content?.length || 0,
        actionItems: dailySummary.actionItems?.length || 0,
      });

      return successResponse(res, {
        dailySummary,
        processedEmails: summaries.length,
        date: dailySummary.date,
      }, 'Daily summary generated successfully');

    } catch (error) {
      logger.error('Daily summary generation failed:', error);
      
      if (error.message.includes('rate limit')) {
        return errorResponse(res, 'AI service rate limit exceeded. Please try again later.', 429);
      }
      
      return errorResponse(res, 'Failed to generate daily summary', 500);
    }
  });

  /**
   * Answer questions about emails using AI
   * @route POST /ai/ask
   * @access Private
   */
  askQuestion = asyncHandler(async (req, res) => {
    try {
      const { question, emailContext } = req.body;

      // Validate input
      if (!question || typeof question !== 'string') {
        return validationErrorResponse(res, [
          { field: 'question', message: 'Question is required and must be a string' }
        ]);
      }

      if (!Array.isArray(emailContext)) {
        return validationErrorResponse(res, [
          { field: 'emailContext', message: 'Email context must be an array' }
        ]);
      }

      // Get user persona
      const user = await User.findById(req.user.id).populate('persona');
      const persona = user.persona || null;

      // Generate answer
      const answer = await aiService.answerEmailQuestion(question, emailContext, persona);

      // Track usage
      await user.incrementUsage('apiCallsThisMonth');

      logger.info('Email question answered', {
        userId: req.user.id,
        question: question.substring(0, 100),
        contextCount: emailContext.length,
        answerLength: answer.length,
      });

      return successResponse(res, {
        question,
        answer,
        contextCount: emailContext.length,
        answeredAt: new Date(),
      }, 'Question answered successfully');

    } catch (error) {
      logger.error('Question answering failed:', error);
      
      if (error.message.includes('rate limit')) {
        return errorResponse(res, 'AI service rate limit exceeded. Please try again later.', 429);
      }
      
      return errorResponse(res, 'Failed to answer question', 500);
    }
  });

  /**
   * Get AI service information and capabilities
   * @route GET /ai/info
   * @access Private
   */
  getServiceInfo = asyncHandler(async (req, res) => {
    try {
      const provider = aiConfig.getCurrentProvider();
      const capabilities = aiConfig.getProviderCapabilities();
      const rateLimit = aiConfig.getRateLimit();
      const availableModels = await aiConfig.getAvailableModels();

      const serviceInfo = {
        provider: {
          name: provider.name,
          models: provider.models,
          defaultModel: provider.defaultModel,
          maxTokens: provider.maxTokens,
        },
        capabilities,
        rateLimit,
        availableModels: availableModels.slice(0, 5), // Limit to first 5 models
        features: {
          emailSummarization: true,
          dailySummaryGeneration: true,
          questionAnswering: true,
          multiLanguageSupport: capabilities.conversational,
          streaming: capabilities.streaming,
        },
      };

      logger.info('AI service info requested', {
        userId: req.user.id,
        provider: provider.name,
      });

      return successResponse(res, serviceInfo, 'AI service information retrieved');

    } catch (error) {
      logger.error('Failed to get AI service info:', error);
      return errorResponse(res, 'Failed to retrieve AI service information', 500);
    }
  });

  /**
   * Test AI service with sample email
   * @route POST /ai/test
   * @access Private
   */
  testService = asyncHandler(async (req, res) => {
    try {
      // Sample email for testing
      const sampleEmail = {
        subject: 'Test Email - Weekly Team Meeting',
        body: `Hi Team,
        
        I hope everyone is doing well. I wanted to remind you about our weekly team meeting scheduled for Thursday at 2 PM.
        
        Agenda:
        1. Project updates from each team member
        2. Discussion about the new client requirements
        3. Review of next week's priorities
        4. Q&A session
        
        Please come prepared with your project status updates. If you can't attend, please send your updates via email.
        
        Looking forward to seeing everyone there!
        
        Best regards,
        John Manager`,
        sender: 'john.manager@company.com',
        receivedAt: new Date(),
      };

      // Generate test summary
      const summary = await aiService.generateEmailSummary(sampleEmail, null, 'individual');

      logger.info('AI service test completed', {
        userId: req.user.id,
        success: true,
      });

      return successResponse(res, {
        testEmail: {
          subject: sampleEmail.subject,
          sender: sampleEmail.sender,
        },
        generatedSummary: summary,
        testStatus: 'success',
        testedAt: new Date(),
      }, 'AI service test completed successfully');

    } catch (error) {
      logger.error('AI service test failed:', error);
      
      return errorResponse(res, {
        testStatus: 'failed',
        error: error.message,
        testedAt: new Date(),
      }, 'AI service test failed', 500);
    }
  });

  /**
   * Get usage statistics for AI service
   * @route GET /ai/usage
   * @access Private
   */
  getUsageStats = asyncHandler(async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      
      const usageStats = {
        currentMonth: {
          emailsProcessed: user.usage.emailsProcessed || 0,
          summariesGenerated: user.usage.summariesGenerated || 0,
          apiCalls: user.usage.apiCallsThisMonth || 0,
        },
        subscription: {
          plan: user.subscription.plan,
          status: user.subscription.status,
        },
        limits: this.getUsageLimits(user.subscription.plan),
        resetDate: user.usage.lastResetAt,
      };

      // Calculate usage percentages
      const limits = usageStats.limits;
      usageStats.percentages = {
        emailsProcessed: limits.emailsProcessed ? 
          Math.round((usageStats.currentMonth.emailsProcessed / limits.emailsProcessed) * 100) : 0,
        summariesGenerated: limits.summariesGenerated ? 
          Math.round((usageStats.currentMonth.summariesGenerated / limits.summariesGenerated) * 100) : 0,
        apiCalls: limits.apiCalls ? 
          Math.round((usageStats.currentMonth.apiCalls / limits.apiCalls) * 100) : 0,
      };

      return successResponse(res, usageStats, 'Usage statistics retrieved');

    } catch (error) {
      logger.error('Failed to get usage stats:', error);
      return errorResponse(res, 'Failed to retrieve usage statistics', 500);
    }
  });

  /**
   * Get usage limits based on subscription plan
   */
  getUsageLimits(plan) {
    const limits = {
      free: {
        emailsProcessed: 100,
        summariesGenerated: 30,
        apiCalls: 500,
      },
      pro: {
        emailsProcessed: 1000,
        summariesGenerated: 300,
        apiCalls: 5000,
      },
      enterprise: {
        emailsProcessed: null, // unlimited
        summariesGenerated: null, // unlimited
        apiCalls: null, // unlimited
      },
    };

    return limits[plan] || limits.free;
  }
}

module.exports = new AIController();