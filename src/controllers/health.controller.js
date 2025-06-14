const database = require('../config/database');
const logger = require('../utils/logger');
const { successResponse, errorResponse } = require('../utils/response');
const aiService = require('../services/ai.service'); // Import AI Service

/**
 * @file Health Check Controller
 * @module controllers/health
 * @requires ../config/database
 * @requires ../utils/logger
 * @requires ../utils/response
 * @requires ../services/ai.service
 */

/**
 * Controller for handling application health checks.
 * Provides endpoints for basic health, detailed health (including dependencies),
 * database health, liveness, and readiness probes.
 * @class HealthController
 */
class HealthController {
  /**
   * Provides a basic health check of the service.
   * Indicates if the service is running and provides uptime, environment, version, and Node.js version.
   * @method healthCheck
   * @route GET /api/v1/health
   * @access Public
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with basic health information.
   */
  async healthCheck(req, res) { // Not using asyncHandler as it's simple and has try/catch
    try {
      const healthData = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(), // Uptime in seconds
        environment: process.env.NODE_ENV || 'development',
        version: process.env.npm_package_version || '1.0.0', // Assumes npm_package_version is available
        nodeVersion: process.version,
      };

      logger.info('Basic health check successful.');
      return successResponse(res, healthData, 'Service is healthy and operational.');
    } catch (error) {
      logger.error('Basic health check endpoint failed:', { message: error.message, stack: error.stack });
      // This catch is for unexpected errors within healthCheck itself, not for service health status.
      return errorResponse(res, 'Health check endpoint encountered an error.', 500);
    }
  }

  /**
   * Provides a detailed health check including critical dependencies like database and AI service.
   * Also includes system information like memory usage and response time for the check.
   * @method detailedHealthCheck
   * @route GET /api/v1/health/detailed
   * @access Public
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with detailed health information. HTTP 503 if critical services are down.
   */
  async detailedHealthCheck(req, res) {
    const startTime = Date.now();
    let dbHealthy = false;
    let databaseState = 'unknown';
    let aiServiceHealth = { healthy: false, provider: 'unknown', error: 'not checked' };

    try {
      logger.debug('detailedHealthCheck: Start');
      // Check database connectivity
      dbHealthy = await database.isHealthy();
      logger.debug('detailedHealthCheck: database.isHealthy() completed', { dbHealthy });
      databaseState = database.getConnectionState();
      logger.debug('detailedHealthCheck: database.getConnectionState() completed', { databaseState });

      // Check AI Service Health
      aiServiceHealth = await aiService.healthCheck();
      logger.debug('detailedHealthCheck: aiService.healthCheck() completed', { здоровый: aiServiceHealth?.healthy }); // "healthy" in Russian to ensure it's this log
      
      const memoryUsage = process.memoryUsage();
      const memoryUsageMB = {
        rss: Math.round(memoryUsage.rss / (1024 * 1024)), // Resident Set Size
        heapTotal: Math.round(memoryUsage.heapTotal / (1024 * 1024)), // Total V8 heap size
        heapUsed: Math.round(memoryUsage.heapUsed / (1024 * 1024)), // Used V8 heap
        external: Math.round(memoryUsage.external / (1024 * 1024)), // External memory used by C++ objects bound to JS
        // Safely access arrayBuffers, as it might not be present in all Node.js versions/environments
        arrayBuffers: memoryUsage.arrayBuffers ? Math.round(memoryUsage.arrayBuffers / (1024 * 1024)) : 0,
      };

      logger.debug('detailedHealthCheck: memoryUsage collected'); // This refers to the memoryUsageMB defined correctly above.
      // The following lines (remnants of a duplicate memoryUsageMB declaration and its log) are removed.

      // Ensure aiServiceHealth is an object and has a 'healthy' property before accessing it
      const isAiHealthy = aiServiceHealth && typeof aiServiceHealth === 'object' && aiServiceHealth.hasOwnProperty('healthy') ? aiServiceHealth.healthy : false;
      logger.debug('detailedHealthCheck: isAiHealthy determined', { isAiHealthy });

      const overallStatus = dbHealthy && isAiHealthy ? 'OK' : 'DEGRADED';
      logger.debug('detailedHealthCheck: overallStatus determined', { overallStatus });

      const healthData = {
        overallStatus,
        timestamp: new Date().toISOString(),
        checkResponseTime: `${Date.now() - startTime}ms`,
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        applicationVersion: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        memoryUsageMB,
        dependencies: {
          database: {
            status: dbHealthy ? 'UP' : 'DOWN',
            connectionState: databaseState,
          },
          aiService: { // Ensure this structure matches what aiService.healthCheck() mock returns, plus our status
            status: isAiHealthy ? 'UP' : 'DOWN',
            provider: aiServiceHealth?.provider || 'unknown', // Safely access provider
            details: aiServiceHealth || { error: 'AI service health data unavailable' },
          },
          gmailConfig: this.checkGmailConfigStatus(),
        },
      };
      logger.debug('detailedHealthCheck: healthData composed');

      const httpStatusCode = overallStatus === 'OK' ? 200 : 503;
      const responseMessage = overallStatus === 'OK' ? 'All systems operational and healthy.' : 'One or more critical services are degraded or unavailable.';
      logger.debug('detailedHealthCheck: httpStatusCode and responseMessage determined', { httpStatusCode, responseMessage });

      logger.info('Detailed health check performed successfully.', { overallStatus, dbStatus: dbHealthy, aiStatus: isAiHealthy });
      return res.status(httpStatusCode).json({ success: (httpStatusCode === 200), message: responseMessage, data: healthData });

    } catch (error) {
      logger.error('Detailed health check endpoint failed with an exception:', { errorMessage: error.message, stackTrace: error.stack });
      return errorResponse(res, 'The detailed health check process encountered an internal server error.', 500, { internalErrorDetails: error.message });
    }
  }

  /**
   * Provides a specific health check for the database connection.
   * @method databaseHealth
   * @route GET /api/v1/health/database
   * @access Public
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with database health status. HTTP 503 if unhealthy.
   */
  async databaseHealth(req, res) {
    try {
      const isDbHealthy = await database.isHealthy();
      const dbState = database.getConnectionState();
      const httpStatusCode = isDbHealthy ? 200 : 503;
      const message = isDbHealthy ? 'Database connection is healthy.' : 'Database connection is unhealthy.';

      logger.info(`Database health check: ${message}`);
      return res.status(httpStatusCode).json({
        success: isDbHealthy,
        message,
        data: { status: isDbHealthy ? 'UP' : 'DOWN', state: dbState, timestamp: new Date().toISOString() },
      });
    } catch (error) {
      logger.error('Database health check endpoint failed:', { message: error.message, stack: error.stack });
      return errorResponse(res, 'Database health check process encountered an error.', 500);
    }
  }

  /**
   * Kubernetes readiness probe. Checks if the service is ready to accept traffic.
   * This should verify critical dependencies needed for the app to function correctly.
   * @method readinessProbe
   * @route GET /api/v1/health/ready
   * @access Public
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends HTTP 200 if ready, HTTP 503 if not ready.
   */
  async readinessProbe(req, res) {
    try {
      const dbHealthy = await database.isHealthy();
      const aiServiceStatus = await aiService.healthCheck(); // Check AI service health

      if (dbHealthy && aiServiceStatus.healthy) {
        logger.debug('Readiness probe: Service is ready.');
        return res.status(200).json({ success: true, status: 'READY', message: 'Service is ready to accept traffic.' });
      } else {
        let issues = [];
        if (!dbHealthy) issues.push('Database: UNAVAILABLE');
        if (!aiServiceStatus.healthy) issues.push(`AI Service (${aiServiceStatus.provider}): UNAVAILABLE - ${aiServiceStatus.error || 'Details in detailed health check'}`);

        const message = `Service not ready. Issues: ${issues.join('; ')}`;
        logger.warn(`Readiness probe failed: ${message}`);
        return res.status(503).json({
          success: false,
          status: 'NOT_READY',
          message,
          details: { databaseHealthy: dbHealthy, aiService: aiServiceStatus }
        });
      }
    } catch (error) {
      logger.error('Readiness probe encountered an exception:', { message: error.message, stack: error.stack });
      // An exception in the probe itself means the service is likely not ready/healthy.
      return res.status(503).json({ success: false, status: 'NOT_READY', message: 'Service not ready due to an internal error during readiness check.' });
    }
  }

  /**
   * Kubernetes liveness probe. Checks if the service process is alive and responsive.
   * This should be a lightweight check.
   * @method livenessProbe
   * @route GET /api/v1/health/live
   * @access Public
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends HTTP 200 if alive, HTTP 500 or 503 if not.
   */
  async livenessProbe(req, res) { // Liveness probes are often synchronous but can be async
    try {
      // Basic check: if this code runs, the process is alive.
      // Could add a quick internal check, e.g., ensure event loop is not blocked, but keep it simple.
      logger.debug('Liveness probe: Service is alive.');
      return res.status(200).json({ success: true, status: 'ALIVE', message: 'Service is alive.', timestamp: new Date().toISOString() });
    } catch (error) {
      // This catch block would only execute if there's an error within the probe logic itself.
      logger.error('Liveness probe failed with an exception:', { message: error.message, stack: error.stack });
      return res.status(500).json({ success: false, status: 'ERROR', message: 'Liveness probe encountered an internal error.' });
    }
  }

  /**
   * Checks the configuration status of Gmail API credentials.
   * Does not check live connectivity, only if ENV variables are set.
   * @method checkGmailConfigStatus
   * @private
   * @returns {{configured: boolean, details: object}} Status of Gmail configuration.
   */
  checkGmailConfigStatus() { // Renamed from checkGmailConfig to be more specific about "status"
    const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
    const isConfigured = !!GOOGLE_CLIENT_ID && !!GOOGLE_CLIENT_SECRET && !!GOOGLE_REDIRECT_URI;

    return {
      name: 'Gmail API Credentials',
      configured: isConfigured,
      details: {
        clientId: GOOGLE_CLIENT_ID ? 'Set' : 'Missing',
        clientSecret: GOOGLE_CLIENT_SECRET ? 'Set' : 'Missing',
        redirectUri: GOOGLE_REDIRECT_URI ? 'Set' : 'Missing',
      },
    };
  }

  /**
   * Checks the configuration status of the primary AI service API key.
   * Does not check live connectivity, only if relevant ENV variables are set for the chosen provider.
   * @method checkAIConfigStatus
   * @private
   * @returns {{configured: boolean, provider: string, details: object}} Status of AI service configuration.
   */
  checkAIConfigStatus() { // Renamed from checkAIConfig
    const providerName = process.env.AI_PROVIDER || 'groq'; // Default to 'groq' as in ai.config.js
    let apiKeyEnvVar;
    switch (providerName.toLowerCase()) {
      case 'openai': apiKeyEnvVar = 'OPENAI_API_KEY'; break;
      case 'anthropic': apiKeyEnvVar = 'ANTHROPIC_API_KEY'; break;
      case 'huggingface': apiKeyEnvVar = 'HUGGINGFACE_API_KEY'; break;
      case 'groq': apiKeyEnvVar = 'GROQ_API_KEY'; break;
      default: apiKeyEnvVar = null;
    }

    const isConfigured = !!(apiKeyEnvVar && process.env[apiKeyEnvVar]);

    return {
      name: `AI Service (${providerName}) API Key`,
      provider: providerName,
      configured: isConfigured,
      details: {
        apiKeyStatus: isConfigured ? 'Set' : `Missing for provider '${providerName}' (expected ENV var: ${apiKeyEnvVar || 'N/A'})`,
      },
    };
  }
}

module.exports = new HealthController();