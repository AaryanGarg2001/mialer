const Persona = require('../models/persona.model');
const logger = require('../utils/logger');
const { successResponse, errorResponse, validationErrorResponse } = require('../utils/response');
const { asyncHandler } = require('../middleware/error.middleware');

class PersonaController {
  /**
   * Get user's persona
   * @route GET /persona
   * @access Private
   */
  getPersona = asyncHandler(async (req, res) => {
    try {
      const persona = await Persona.findByUser(req.user.id);

      if (!persona) {
        return successResponse(res, null, 'No persona found for user');
      }

      return successResponse(res, { persona }, 'Persona retrieved successfully');

    } catch (error) {
      logger.error('Failed to get persona:', error);
      return errorResponse(res, 'Failed to retrieve persona', 500);
    }
  });

  /**
   * Create or update user's persona
   * @route POST /persona
   * @access Private
   */
  createOrUpdatePersona = asyncHandler(async (req, res) => {
    try {
      const {
        role,
        company,
        department,
        importantContacts,
        importantDomains,
        keywords,
        interests,
        summaryStyle,
        summaryLength,
        focusAreas,
        emailCategories,
        dailySummaryTime,
        timezone,
        excludePatterns,
        minimumEmailLength,
        maxEmailsPerSummary,
        learningEnabled,
      } = req.body;

      // Validate input
      const validationErrors = this.validatePersonaInput(req.body);
      if (validationErrors.length > 0) {
        return validationErrorResponse(res, validationErrors);
      }

      // Find existing persona or create new one
      let persona = await Persona.findByUser(req.user.id);

      if (persona) {
        // Update existing persona
        Object.assign(persona, {
          role: role || persona.role,
          company: company || persona.company,
          department: department || persona.department,
          importantContacts: importantContacts || persona.importantContacts,
          importantDomains: importantDomains || persona.importantDomains,
          keywords: keywords || persona.keywords,
          interests: interests || persona.interests,
          summaryStyle: summaryStyle || persona.summaryStyle,
          summaryLength: summaryLength || persona.summaryLength,
          focusAreas: focusAreas || persona.focusAreas,
          emailCategories: emailCategories || persona.emailCategories,
          dailySummaryTime: dailySummaryTime || persona.dailySummaryTime,
          timezone: timezone || persona.timezone,
          excludePatterns: excludePatterns || persona.excludePatterns,
          minimumEmailLength: minimumEmailLength !== undefined ? minimumEmailLength : persona.minimumEmailLength,
          maxEmailsPerSummary: maxEmailsPerSummary !== undefined ? maxEmailsPerSummary : persona.maxEmailsPerSummary,
          learningEnabled: learningEnabled !== undefined ? learningEnabled : persona.learningEnabled,
        });

        await persona.save();

        logger.info('Persona updated successfully', {
          userId: req.user.id,
          personaId: persona._id,
        });

        return successResponse(res, { persona }, 'Persona updated successfully');

      } else {
        // Create new persona
        persona = new Persona({
          userId: req.user.id,
          role,
          company,
          department,
          importantContacts: importantContacts || [],
          importantDomains: importantDomains || [],
          keywords: keywords || [],
          interests: interests || [],
          summaryStyle: summaryStyle || 'balanced',
          summaryLength: summaryLength || 'medium',
          focusAreas: focusAreas || ['tasks', 'deadlines'],
          emailCategories: emailCategories || {
            work: { priority: 5, keywords: [] },
            personal: { priority: 3, keywords: [] },
            newsletters: { priority: 1, keywords: [] },
            social: { priority: 2, keywords: [] },
            promotions: { priority: 1, keywords: [] },
          },
          dailySummaryTime: dailySummaryTime || '08:00',
          timezone: timezone || 'UTC',
          excludePatterns: excludePatterns || [],
          minimumEmailLength: minimumEmailLength || 100,
          maxEmailsPerSummary: maxEmailsPerSummary || 20,
          learningEnabled: learningEnabled !== undefined ? learningEnabled : true,
        });

        await persona.save();

        logger.info('Persona created successfully', {
          userId: req.user.id,
          personaId: persona._id,
        });

        return successResponse(res, { persona }, 'Persona created successfully');
      }

    } catch (error) {
      logger.error('Failed to create/update persona:', error);
      return errorResponse(res, 'Failed to save persona', 500);
    }
  });

  /**
   * Create default persona for user
   * @route POST /persona/default
   * @access Private
   */
  createDefaultPersona = asyncHandler(async (req, res) => {
    try {
      // Check if persona already exists
      const existingPersona = await Persona.findByUser(req.user.id);
      
      if (existingPersona) {
        return errorResponse(res, 'Persona already exists for this user', 400);
      }

      const { role, timezone } = req.body;

      const persona = await Persona.createDefault(req.user.id, {
        role,
        timezone,
      });

      logger.info('Default persona created', {
        userId: req.user.id,
        personaId: persona._id,
      });

      return successResponse(res, { persona }, 'Default persona created successfully');

    } catch (error) {
      logger.error('Failed to create default persona:', error);
      return errorResponse(res, 'Failed to create default persona', 500);
    }
  });

  /**
   * Delete user's persona
   * @route DELETE /persona
   * @access Private
   */
  deletePersona = asyncHandler(async (req, res) => {
    try {
      const persona = await Persona.findByUser(req.user.id);

      if (!persona) {
        return errorResponse(res, 'Persona not found', 404);
      }

      await Persona.findByIdAndDelete(persona._id);

      logger.info('Persona deleted', {
        userId: req.user.id,
        personaId: persona._id,
      });

      return successResponse(res, null, 'Persona deleted successfully');

    } catch (error) {
      logger.error('Failed to delete persona:', error);
      return errorResponse(res, 'Failed to delete persona', 500);
    }
  });

  /**
   * Add feedback to persona for learning
   * @route POST /persona/feedback
   * @access Private
   */
  addPersonaFeedback = asyncHandler(async (req, res) => {
    try {
      const { action, emailId, summaryId, feedback } = req.body;

      // Validate input
      const validActions = ['liked', 'disliked', 'ignored', 'starred', 'archived'];
      if (!validActions.includes(action)) {
        return validationErrorResponse(res, [
          { field: 'action', message: 'Invalid action type' }
        ]);
      }

      const persona = await Persona.findByUser(req.user.id);

      if (!persona) {
        return errorResponse(res, 'Persona not found', 404);
      }

      await persona.addFeedback({
        action,
        emailId,
        summaryId,
        feedback,
      });

      // Trigger optimization if enough feedback collected
      if (persona.feedbackHistory.length >= 20) {
        await persona.optimizeBasedOnFeedback();
      }

      logger.info('Persona feedback added', {
        userId: req.user.id,
        personaId: persona._id,
        action,
      });

      return successResponse(res, null, 'Feedback added successfully');

    } catch (error) {
      logger.error('Failed to add persona feedback:', error);
      return errorResponse(res, 'Failed to add feedback', 500);
    }
  });

  /**
   * Get persona metrics and statistics
   * @route GET /persona/metrics
   * @access Private
   */
  getPersonaMetrics = asyncHandler(async (req, res) => {
    try {
      const persona = await Persona.findByUser(req.user.id);

      if (!persona) {
        return errorResponse(res, 'Persona not found', 404);
      }

      const metrics = {
        basic: {
          totalSummariesGenerated: persona.metrics.totalSummariesGenerated,
          averageRating: persona.metrics.averageRating,
          emailsCorrectlyPrioritized: persona.metrics.emailsCorrectlyPrioritized,
          emailsMissed: persona.metrics.emailsMissed,
          lastOptimizedAt: persona.metrics.lastOptimizedAt,
        },
        feedback: {
          totalFeedback: persona.feedbackHistory.length,
          recentFeedback: persona.feedbackHistory.slice(-10),
        },
        configuration: {
          summaryStyle: persona.summaryStyle,
          maxEmailsPerSummary: persona.maxEmailsPerSummary,
          focusAreas: persona.focusAreas,
          highPriorityCategories: persona.highPriorityCategories,
          learningEnabled: persona.learningEnabled,
        },
      };

      return successResponse(res, { metrics }, 'Persona metrics retrieved successfully');

    } catch (error) {
      logger.error('Failed to get persona metrics:', error);
      return errorResponse(res, 'Failed to retrieve persona metrics', 500);
    }
  });

  /**
   * Optimize persona based on feedback
   * @route POST /persona/optimize
   * @access Private
   */
  optimizePersona = asyncHandler(async (req, res) => {
    try {
      const persona = await Persona.findByUser(req.user.id);

      if (!persona) {
        return errorResponse(res, 'Persona not found', 404);
      }

      if (!persona.learningEnabled) {
        return errorResponse(res, 'Learning is disabled for this persona', 400);
      }

      if (persona.feedbackHistory.length < 10) {
        return errorResponse(res, 'Not enough feedback for optimization', 400);
      }

      await persona.optimizeBasedOnFeedback();

      logger.info('Persona optimized', {
        userId: req.user.id,
        personaId: persona._id,
        feedbackCount: persona.feedbackHistory.length,
      });

      return successResponse(res, {
        optimizedAt: persona.metrics.lastOptimizedAt,
        feedbackUsed: persona.feedbackHistory.length,
      }, 'Persona optimized successfully');

    } catch (error) {
      logger.error('Failed to optimize persona:', error);
      return errorResponse(res, 'Failed to optimize persona', 500);
    }
  });

  /**
   * Test persona scoring on sample emails
   * @route POST /persona/test-scoring
   * @access Private
   */
  testPersonaScoring = asyncHandler(async (req, res) => {
    try {
      const { sampleEmails } = req.body;

      if (!Array.isArray(sampleEmails) || sampleEmails.length === 0) {
        return validationErrorResponse(res, [
          { field: 'sampleEmails', message: 'Sample emails array is required' }
        ]);
      }

      const persona = await Persona.findByUser(req.user.id);

      if (!persona) {
        return errorResponse(res, 'Persona not found', 404);
      }

      const scoredEmails = sampleEmails.map(email => {
        const score = persona.getEmailScore(email);
        const category = persona.categorizeEmail(email);
        const shouldInclude = persona.shouldIncludeEmail(email);

        return {
          ...email,
          score,
          category,
          shouldInclude,
        };
      });

      // Sort by score
      scoredEmails.sort((a, b) => b.score - a.score);

      return successResponse(res, {
        scoredEmails,
        summary: {
          totalEmails: sampleEmails.length,
          highScoreEmails: scoredEmails.filter(e => e.score >= 5).length,
          includedEmails: scoredEmails.filter(e => e.shouldInclude).length,
          categories: this.getCategoryCounts(scoredEmails),
        },
      }, 'Persona scoring test completed');

    } catch (error) {
      logger.error('Failed to test persona scoring:', error);
      return errorResponse(res, 'Failed to test scoring', 500);
    }
  });

  /**
   * Get persona recommendations
   * @route GET /persona/recommendations
   * @access Private
   */
  getPersonaRecommendations = asyncHandler(async (req, res) => {
    try {
      const persona = await Persona.findByUser(req.user.id);

      if (!persona) {
        return errorResponse(res, 'Persona not found', 404);
      }

      // Generate basic recommendations based on current configuration
      const recommendations = this.generateRecommendations(persona);

      return successResponse(res, { recommendations }, 'Persona recommendations generated');

    } catch (error) {
      logger.error('Failed to get persona recommendations:', error);
      return errorResponse(res, 'Failed to generate recommendations', 500);
    }
  });

  /**
   * Validate persona input data
   */
  validatePersonaInput(data) {
    const errors = [];

    if (data.summaryStyle && !['brief', 'detailed', 'action-focused', 'balanced'].includes(data.summaryStyle)) {
      errors.push({ field: 'summaryStyle', message: 'Invalid summary style' });
    }

    if (data.summaryLength && !['short', 'medium', 'long'].includes(data.summaryLength)) {
      errors.push({ field: 'summaryLength', message: 'Invalid summary length' });
    }

    if (data.dailySummaryTime && !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(data.dailySummaryTime)) {
      errors.push({ field: 'dailySummaryTime', message: 'Invalid time format. Use HH:MM' });
    }

    if (data.minimumEmailLength && (data.minimumEmailLength < 50 || data.minimumEmailLength > 1000)) {
      errors.push({ field: 'minimumEmailLength', message: 'Minimum email length must be between 50 and 1000' });
    }

    if (data.maxEmailsPerSummary && (data.maxEmailsPerSummary < 5 || data.maxEmailsPerSummary > 100)) {
      errors.push({ field: 'maxEmailsPerSummary', message: 'Max emails per summary must be between 5 and 100' });
    }

    // Validate arrays
    const arrayFields = ['importantContacts', 'importantDomains', 'keywords', 'interests', 'excludePatterns'];
    arrayFields.forEach(field => {
      if (data[field] && !Array.isArray(data[field])) {
        errors.push({ field, message: `${field} must be an array` });
      }
    });

    return errors;
  }

  /**
   * Get category counts from scored emails
   */
  getCategoryCounts(scoredEmails) {
    const counts = {};
    scoredEmails.forEach(email => {
      counts[email.category] = (counts[email.category] || 0) + 1;
    });
    return counts;
  }

  /**
   * Generate recommendations for persona improvement
   */
  generateRecommendations(persona) {
    const recommendations = [];

    // Check if important contacts are defined
    if (!persona.importantContacts || persona.importantContacts.length === 0) {
      recommendations.push({
        type: 'contacts',
        priority: 'high',
        title: 'Add Important Contacts',
        description: 'Define important email contacts to ensure their messages are prioritized',
      });
    }

    // Check if keywords are defined
    if (!persona.keywords || persona.keywords.length < 3) {
      recommendations.push({
        type: 'keywords',
        priority: 'medium',
        title: 'Add More Keywords',
        description: 'Add project names, topics, or keywords relevant to your work for better email filtering',
      });
    }

    // Check if learning is enabled
    if (!persona.learningEnabled) {
      recommendations.push({
        type: 'learning',
        priority: 'medium',
        title: 'Enable Learning',
        description: 'Turn on learning to let your persona improve based on your feedback',
      });
    }

    // Check category priorities
    const hasHighPriorityCategory = Object.values(persona.emailCategories).some(cat => cat.priority >= 4);
    if (!hasHighPriorityCategory) {
      recommendations.push({
        type: 'categories',
        priority: 'low',
        title: 'Set Category Priorities',
        description: 'Adjust email category priorities to better match your needs',
      });
    }

    return recommendations;
  }
}

module.exports = new PersonaController();