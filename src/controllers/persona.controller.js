const Persona = require('../models/persona.model');
const logger = require('../utils/logger');
const { successResponse, errorResponse, validationErrorResponse } = require('../utils/response');
const { asyncHandler } = require('../middleware/error.middleware');

/**
 * @file Persona Controller
 * @module controllers/persona
 * @requires ../models/persona.model
 * @requires ../utils/logger
 * @requires ../utils/response
 * @requires ../middleware/error.middleware
 */

/**
 * Controller for managing user personas.
 * Allows users to create, retrieve, update, and delete their persona,
 * provide feedback, and get persona-related metrics and recommendations.
 * @class PersonaController
 */
class PersonaController {
  /**
   * Retrieves the persona for the authenticated user.
   * @method getPersona
   * @route GET /api/v1/persona
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with the user's persona or null if not found.
   */
  getPersona = asyncHandler(async (req, res) => {
    try {
      const persona = await Persona.findByUser(req.user.id).lean(); // .lean() for read-only

      if (!persona) {
        logger.info(`No persona found for user ${req.user.id}. Suggesting creation.`);
        return successResponse(res, { persona: null, message: 'No persona found. You can create one to personalize your experience.' }, 'Persona not found.');
      }

      return successResponse(res, { persona }, 'Persona retrieved successfully.');
    } catch (error) {
      logger.error('Failed to retrieve persona:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve your persona due to an internal error.', 500);
    }
  });

  /**
   * Creates a new persona or updates an existing one for the authenticated user.
   * @method createOrUpdatePersona
   * @route POST /api/v1/persona
   * @access Private
   * @param {import('express').Request} req - Express request object. Body contains persona fields.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with the created or updated persona.
   */
  createOrUpdatePersona = asyncHandler(async (req, res) => {
    try {
      const personaData = req.body; // Contains all fields for persona
      const userId = req.user.id;

      const validationErrors = this.validatePersonaInput(personaData);
      if (validationErrors.length > 0) {
        logger.warn(`Persona validation failed for user ${userId}:`, { errors: validationErrors });
        return validationErrorResponse(res, validationErrors, 'Persona data validation failed.');
      }

      let persona = await Persona.findOne({ userId }); // Use findOne instead of custom static if it's simple
      let messageAction = 'updated';

      if (persona) {
        // Update existing persona by merging new data
        // Ensure only valid fields are updated from personaData
        Object.keys(personaData).forEach(key => {
          if (personaSchema.paths[key] || key === 'emailCategories') { // Check if key is part of schema or a known complex field
             // For nested objects like emailCategories, ensure deep merge or specific handling if needed
            if (key === 'emailCategories' && typeof personaData.emailCategories === 'object') {
              persona.emailCategories = { ...persona.emailCategories, ...personaData.emailCategories };
            } else {
              persona[key] = personaData[key];
            }
          }
        });
        // Mark emailCategories as modified if it was part of the update
        if (personaData.emailCategories) {
          persona.markModified('emailCategories');
        }
      } else {
        // Create new persona
        messageAction = 'created';
        persona = new Persona({ ...personaData, userId });
      }

      await persona.save();
      logger.info(`Persona ${messageAction} successfully for user ${userId}.`, { personaId: persona._id });
      return successResponse(res, { persona: persona.toJSON() }, `Persona ${messageAction} successfully.`);

    } catch (error) {
      logger.error(`Failed to ${persona ? 'update' : 'create'} persona:`, { message: error.message, userId: req.user?.id });
      if (error.name === 'ValidationError') {
        return validationErrorResponse(res, Object.values(error.errors).map(e => ({ field: e.path, message: e.message })), 'Persona validation failed.');
      }
      return errorResponse(res, `Failed to save your persona due to an internal error.`, 500);
    }
  });

  /**
   * Creates a default persona for the authenticated user if one doesn't already exist.
   * @method createDefaultPersona
   * @route POST /api/v1/persona/default
   * @access Private
   * @param {import('express').Request} req - Express request object. Body may contain `role`, `timezone` for seeding.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with the newly created default persona.
   */
  createDefaultPersona = asyncHandler(async (req, res) => {
    try {
      const userId = req.user.id;
      const existingPersona = await Persona.findOne({ userId });
      
      if (existingPersona) {
        return errorResponse(res, 'A persona already exists for this user. Cannot create a default one.', 409); // 409 Conflict
      }

      const { role, timezone } = req.body; // Optional initial data from user profile or client
      const userForPersona = await mongoose.model('User').findById(userId).select('preferences').lean(); // Fetch user preferences

      const persona = await Persona.createDefault(userId, {
        role: role || userForPersona?.preferences?.professionalRole, // Example of using user data
        timezone: timezone || userForPersona?.preferences?.timezone,
      });

      logger.info('Default persona created successfully.', { userId, personaId: persona._id });
      return successResponse(res, { persona: persona.toJSON() }, 'Default persona created successfully.');
    } catch (error) {
      logger.error('Failed to create default persona:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to create default persona.', 500);
    }
  });

  /**
   * Deletes the persona for the authenticated user.
   * @method deletePersona
   * @route DELETE /api/v1/persona
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response confirming deletion.
   */
  deletePersona = asyncHandler(async (req, res) => {
    try {
      const userId = req.user.id;
      const result = await Persona.deleteOne({ userId }); // Use deleteOne for direct deletion

      if (result.deletedCount === 0) {
        logger.warn(`Attempted to delete non-existent persona for user ${userId}.`);
        return errorResponse(res, 'Persona not found to delete.', 404);
      }

      logger.info('Persona deleted successfully.', { userId });
      return successResponse(res, null, 'Persona deleted successfully.');
    } catch (error) {
      logger.error('Failed to delete persona:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to delete persona.', 500);
    }
  });

  /**
   * Adds feedback to the user's persona, which can be used for learning and optimization.
   * @method addPersonaFeedback
   * @route POST /api/v1/persona/feedback
   * @access Private
   * @param {import('express').Request} req - Express request object. Body: `action`, `emailId`, `summaryId`, `feedbackText`.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response confirming feedback addition.
   */
  addPersonaFeedback = asyncHandler(async (req, res) => {
    try {
      const { action, emailId, summaryId, feedbackText } = req.body; // Renamed feedback to feedbackText
      const userId = req.user.id;

      const validActions = ['liked_summary', 'disliked_summary', 'changed_priority', 'marked_irrelevant', 'marked_important'];
      if (!action || !validActions.includes(action)) {
        return validationErrorResponse(res, [{ field: 'action', message: `Invalid action type. Must be one of: ${validActions.join(', ')}.` }]);
      }
      // Optional: Validate emailId and summaryId format if provided
      if (emailId && !mongoose.Types.ObjectId.isValid(emailId)) return validationErrorResponse(res, [{field: 'emailId', message: 'Invalid emailId format.'}]);
      if (summaryId && !mongoose.Types.ObjectId.isValid(summaryId)) return validationErrorResponse(res, [{field: 'summaryId', message: 'Invalid summaryId format.'}]);


      const persona = await Persona.findOne({ userId });
      if (!persona) {
        return errorResponse(res, 'Persona not found. Please create a persona first.', 404);
      }

      await persona.addFeedback({ action, emailId, summaryId, feedbackText });

      // Conditionally trigger optimization, e.g., after a certain number of feedback entries
      const FEEDBACK_OPTIMIZATION_THRESHOLD = 10; // Example threshold
      if (persona.learningEnabled && persona.feedbackHistory.length % FEEDBACK_OPTIMIZATION_THRESHOLD === 0) {
        logger.info(`Sufficient feedback received, attempting persona optimization for user ${userId}.`);
        // Run optimization asynchronously to not block the response
        persona.optimizeBasedOnFeedback().catch(optError => {
          logger.error('Background persona optimization failed:', { message: optError.message, userId });
        });
      }

      logger.info('Persona feedback added successfully.', { userId, personaId: persona._id, action });
      return successResponse(res, { feedbackEntry: persona.feedbackHistory.slice(-1)[0] }, 'Feedback added successfully to persona.');
    } catch (error) {
      logger.error('Failed to add persona feedback:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to add feedback to persona.', 500);
    }
  });

  /**
   * Retrieves metrics and statistics related to the user's persona performance.
   * @method getPersonaMetrics
   * @route GET /api/v1/persona/metrics
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with persona metrics.
   */
  getPersonaMetrics = asyncHandler(async (req, res) => {
    try {
      const persona = await Persona.findOne({ userId: req.user.id }).lean();
      if (!persona) {
        return errorResponse(res, 'Persona not found.', 404);
      }

      // Construct a more structured metrics response
      const metricsResponse = {
        effectiveness: persona.metrics, // Metrics stored on the persona document
        preferencesSummary: {
          summaryStyle: persona.summaryStyle,
          summaryLength: persona.summaryLength,
          focusAreas: persona.focusAreas,
          learningEnabled: persona.learningEnabled,
        },
        feedbackOverview: {
          totalFeedbackEntries: persona.feedbackHistory?.length || 0,
          // Could add counts of specific feedback actions if needed
        },
        highPriorityCategories: persona.highPriorityCategories, // Example of using a virtual
      };

      return successResponse(res, { metrics: metricsResponse }, 'Persona metrics retrieved successfully.');
    } catch (error) {
      logger.error('Failed to retrieve persona metrics:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve persona metrics.', 500);
    }
  });

  /**
   * Manually triggers the optimization process for the user's persona based on collected feedback.
   * @method optimizePersona
   * @route POST /api/v1/persona/optimize
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response confirming optimization.
   */
  optimizePersona = asyncHandler(async (req, res) => {
    try {
      const persona = await Persona.findOne({ userId: req.user.id });
      if (!persona) return errorResponse(res, 'Persona not found.', 404);

      if (!persona.learningEnabled) {
        return errorResponse(res, 'Learning is disabled for this persona. Optimization cannot be performed.', 400);
      }

      const MIN_FEEDBACK_FOR_OPTIMIZATION = 5; // Example threshold
      if (!persona.feedbackHistory || persona.feedbackHistory.length < MIN_FEEDBACK_FOR_OPTIMIZATION) {
        return errorResponse(res, `Not enough feedback (${persona.feedbackHistory?.length || 0}/${MIN_FEEDBACK_FOR_OPTIMIZATION}) collected for optimization. Please provide more feedback.`, 400);
      }

      await persona.optimizeBasedOnFeedback(); // This method should save the persona

      logger.info('Persona optimization process completed.', { userId: req.user.id, personaId: persona._id });
      return successResponse(res, {
        message: 'Persona optimization process completed.',
        lastOptimizedAt: persona.metrics.lastOptimizedAt,
        feedbackEntriesUsed: persona.feedbackHistory.length,
      }, 'Persona optimized successfully.');
    } catch (error) {
      logger.error('Failed to optimize persona:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to optimize persona due to an internal error.', 500);
    }
  });

  /**
   * Allows testing the current persona's scoring logic against a list of sample emails.
   * @method testPersonaScoring
   * @route POST /api/v1/persona/test-scoring
   * @access Private
   * @param {import('express').Request} req - Express request object. Body: `sampleEmails` (array of email objects).
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with scored sample emails.
   */
  testPersonaScoring = asyncHandler(async (req, res) => {
    try {
      const { sampleEmails } = req.body; // Expects an array of email-like objects
      if (!Array.isArray(sampleEmails) || sampleEmails.length === 0) {
        return validationErrorResponse(res, [{ field: 'sampleEmails', message: 'An array of sample emails is required.' }]);
      }
      // Basic validation for sample email structure could be added here

      const persona = await Persona.findOne({ userId: req.user.id });
      if (!persona) return errorResponse(res, 'Persona not found. Please create one to test scoring.', 404);

      const scoredEmails = sampleEmails.map(email => ({
        originalEmail: { subject: email.subject, sender: email.sender, snippet: email.body?.substring(0,100) }, // Keep original identifiable info
        score: persona.getEmailScore(email),
        category: persona.categorizeEmail(email),
        shouldBeIncluded: persona.shouldIncludeEmail(email),
      }));

      scoredEmails.sort((a, b) => b.score - a.score); // Sort by score descending

      return successResponse(res, {
        scoredEmails,
        testSummary: {
          totalSampleEmails: sampleEmails.length,
          emailsScoredAboveThreshold: scoredEmails.filter(e => e.score >= (persona.emailCategories?.work?.priority || 5)).length, // Example threshold
          emailsIncludedInSummary: scoredEmails.filter(e => e.shouldBeIncluded).length,
          categoryDistribution: this.getCategoryCounts(scoredEmails.map(e => ({category: e.category}))), // Adapt getCategoryCounts if needed
        },
      }, 'Persona scoring test completed successfully.');
    } catch (error) {
      logger.error('Failed to test persona scoring:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to test persona scoring due to an internal error.', 500);
    }
  });

  /**
   * Generates recommendations for improving the user's persona configuration.
   * @method getPersonaRecommendations
   * @route GET /api/v1/persona/recommendations
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends JSON response with persona improvement recommendations.
   */
  getPersonaRecommendations = asyncHandler(async (req, res) => {
    try {
      const persona = await Persona.findOne({ userId: req.user.id }).lean();
      if (!persona) return errorResponse(res, 'Persona not found. Cannot generate recommendations.', 404);

      const recommendations = this.generateRecommendations(persona); // Helper method
      return successResponse(res, { recommendations }, 'Persona recommendations generated successfully.');
    } catch (error) {
      logger.error('Failed to generate persona recommendations:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to generate persona recommendations.', 500);
    }
  });

  // ----- Helper Methods (Private) -----

  /**
   * Validates the input data for creating or updating a persona.
   * @private
   * @param {object} data - The persona data from the request body.
   * @returns {Array<{field: string, message: string}>} An array of validation error objects. Empty if valid.
   */
  validatePersonaInput(data) {
    const errors = [];
    // Example validations (can be expanded significantly or use a validation library like Joi/Zod)
    if (data.summaryStyle && !['brief', 'detailed', 'action-focused', 'balanced'].includes(data.summaryStyle)) {
      errors.push({ field: 'summaryStyle', message: 'Invalid summary style. Allowed: brief, detailed, action-focused, balanced.' });
    }
    if (data.summaryLength && !['short', 'medium', 'long'].includes(data.summaryLength)) {
      errors.push({ field: 'summaryLength', message: 'Invalid summary length. Allowed: short, medium, long.' });
    }
    if (data.dailySummaryTime && !/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(data.dailySummaryTime)) {
      errors.push({ field: 'dailySummaryTime', message: 'Invalid time format for dailySummaryTime. Use HH:MM.' });
    }
    if (data.minimumEmailLength && (parseInt(data.minimumEmailLength,10) < 50 || parseInt(data.minimumEmailLength,10) > 10000)) {
      errors.push({ field: 'minimumEmailLength', message: 'Minimum email length must be between 50 and 10000.' });
    }
    if (data.maxEmailsPerSummary && (parseInt(data.maxEmailsPerSummary,10) < 1 || parseInt(data.maxEmailsPerSummary,10) > 100)) {
      errors.push({ field: 'maxEmailsPerSummary', message: 'Max emails per summary must be between 1 and 100.' });
    }
    ['importantContacts', 'importantDomains', 'keywords', 'interests', 'focusAreas', 'excludePatterns'].forEach(field => {
      if (data[field] && !Array.isArray(data[field])) {
        errors.push({ field, message: `${field} must be an array of strings.` });
      } else if (data[field]) {
        if(!data[field].every(item => typeof item === 'string')) {
           errors.push({ field, message: `All items in ${field} must be strings.` });
        }
      }
    });
    // Add more validation for emailCategories structure if necessary
    return errors;
  }

  /**
   * Helper to count email categories from a list of emails (assuming each email has a 'category' field).
   * @private
   * @param {Array<object>} emailsWithCategory - Array of objects, each with a 'category' property.
   * @returns {object} An object mapping category names to their counts.
   */
  getCategoryCounts(emailsWithCategory) {
    return emailsWithCategory.reduce((acc, email) => {
      acc[email.category] = (acc[email.category] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Generates actionable recommendations for improving the persona configuration.
   * @private
   * @param {Persona} persona - The user's persona document.
   * @returns {Array<object>} An array of recommendation objects.
   */
  generateRecommendations(persona) {
    const recommendations = [];
    if (!persona.importantContacts || persona.importantContacts.length === 0) {
      recommendations.push({ id: 'add_contacts', priority: 'high', title: 'Define Important Contacts', description: 'Specify key contacts (e.g., your manager, key clients) to ensure their emails are always prioritized and highlighted.' });
    }
    if (!persona.keywords || persona.keywords.length < 3) {
      recommendations.push({ id: 'add_keywords', priority: 'medium', title: 'Expand Your Keywords', description: 'Add more keywords related to your projects, responsibilities, or urgent topics to improve filtering accuracy.' });
    }
    if (!persona.learningEnabled && persona.feedbackHistory?.length > 5) { // Suggest enabling if there's some feedback
      recommendations.push({ id: 'enable_learning', priority: 'medium', title: 'Enable Persona Learning', description: 'Allow the system to learn from your feedback to automatically refine your persona settings over time.' });
    }
    if (persona.emailCategories && Object.values(persona.emailCategories).every(cat => cat.priority === (persona.emailCategories.work?.priority || 3))) {
      recommendations.push({ id: 'tune_categories', priority: 'low', title: 'Customize Category Priorities', description: 'Fine-tune the priority levels for different email categories (e.g., work, personal, newsletters) to better match your focus.' });
    }
    if (!persona.focusAreas || persona.focusAreas.length === 0) {
       recommendations.push({ id: 'define_focus_areas', priority: 'medium', title: 'Specify Focus Areas', description: 'Select focus areas like "deadlines" or "tasks" to tailor summaries to highlight what matters most to you.' });
    }
    // Add more recommendation logic based on persona state
    return recommendations;
  }
}

module.exports = new PersonaController();