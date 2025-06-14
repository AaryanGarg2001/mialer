const express = require('express');
const personaController = require('../controllers/persona.controller');
const { authenticate, trackUsage } = require('../middleware/auth.middleware');

const router = express.Router();

// All persona routes require authentication
router.use(authenticate);

/**
 * @route GET /persona
 * @description Get user's persona
 * @access Private
 */
router.get('/',
  personaController.getPersona
);

/**
 * @route POST /persona
 * @description Create or update user's persona
 * @access Private
 */
router.post('/',
  trackUsage('apiCallsThisMonth'),
  personaController.createOrUpdatePersona
);

/**
 * @route POST /persona/default
 * @description Create default persona for user
 * @access Private
 */
router.post('/default',
  personaController.createDefaultPersona
);

/**
 * @route DELETE /persona
 * @description Delete user's persona
 * @access Private
 */
router.delete('/',
  personaController.deletePersona
);

/**
 * @route POST /persona/feedback
 * @description Add feedback to persona for learning
 * @access Private
 */
router.post('/feedback',
  trackUsage('apiCallsThisMonth'),
  personaController.addPersonaFeedback
);

/**
 * @route GET /persona/metrics
 * @description Get persona metrics and statistics
 * @access Private
 */
router.get('/metrics',
  personaController.getPersonaMetrics
);

/**
 * @route POST /persona/optimize
 * @description Optimize persona based on feedback
 * @access Private
 */
router.post('/optimize',
  personaController.optimizePersona
);

/**
 * @route POST /persona/test-scoring
 * @description Test persona scoring on sample emails
 * @access Private
 */
router.post('/test-scoring',
  personaController.testPersonaScoring
);

/**
 * @route GET /persona/recommendations
 * @description Get persona recommendations
 * @access Private
 */
router.get('/recommendations',
  personaController.getPersonaRecommendations
);

module.exports = router;