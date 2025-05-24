const express = require('express');
const healthController = require('../controllers/health.controller');

const router = express.Router();

/**
 * @route GET /health
 * @description Basic health check
 * @access Public
 */
router.get('/', healthController.healthCheck);

/**
 * @route GET /health/detailed
 * @description Detailed health check with system information
 * @access Public
 */
router.get('/detailed', healthController.detailedHealthCheck);

/**
 * @route GET /health/database
 * @description Database-specific health check
 * @access Public
 */
router.get('/database', healthController.databaseHealth);

/**
 * @route GET /health/ready
 * @description Kubernetes readiness probe
 * @access Public
 */
router.get('/ready', healthController.readinessProbe);

/**
 * @route GET /health/live
 * @description Kubernetes liveness probe
 * @access Public
 */
router.get('/live', healthController.livenessProbe);

module.exports = router;