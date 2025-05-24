const database = require('../config/database');
const logger = require('../utils/logger');
const { successResponse, errorResponse } = require('../utils/response');

class HealthController {
  /**
   * Basic health check endpoint
   */
  async healthCheck(req, res) {
    try {
      const healthData = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: process.env.NODE_ENV,
        version: process.env.npm_package_version || '1.0.0',
        nodeVersion: process.version,
      };

      logger.info('Health check requested');
      return successResponse(res, healthData, 'Service is healthy');
    } catch (error) {
      logger.error('Health check failed:', error);
      return errorResponse(res, 'Health check failed', 500);
    }
  }

  /**
   * Detailed health check including database connectivity
   */
  async detailedHealthCheck(req, res) {
    try {
      const startTime = Date.now();
      
      // Check database connectivity
      const isDatabaseHealthy = await database.isHealthy();
      const databaseState = database.getConnectionState();
      
      // Memory usage
      const memoryUsage = process.memoryUsage();
      const memoryUsageMB = {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024),
      };

      // System info
      const healthData = {
        status: isDatabaseHealthy ? 'OK' : 'DEGRADED',
        timestamp: new Date().toISOString(),
        responseTime: `${Date.now() - startTime}ms`,
        uptime: Math.floor(process.uptime()),
        environment: process.env.NODE_ENV,
        version: process.env.npm_package_version || '1.0.0',
        nodeVersion: process.version,
        memory: memoryUsageMB,
        database: {
          status: isDatabaseHealthy ? 'connected' : 'disconnected',
          state: databaseState,
        },
        services: {
          gmail: this.checkGmailConfig(),
          ai: this.checkAIConfig(),
        },
      };

      const statusCode = isDatabaseHealthy ? 200 : 503;
      const message = isDatabaseHealthy ? 'All systems operational' : 'Some services are degraded';

      logger.info('Detailed health check completed', { 
        status: healthData.status,
        responseTime: healthData.responseTime 
      });

      return res.status(statusCode).json({
        success: statusCode === 200,
        message,
        data: healthData,
      });
    } catch (error) {
      logger.error('Detailed health check failed:', error);
      return errorResponse(res, 'Health check failed', 500);
    }
  }

  /**
   * Database-specific health check
   */
  async databaseHealth(req, res) {
    try {
      const isDatabaseHealthy = await database.isHealthy();
      const databaseState = database.getConnectionState();

      const healthData = {
        status: isDatabaseHealthy ? 'healthy' : 'unhealthy',
        state: databaseState,
        timestamp: new Date().toISOString(),
      };

      const statusCode = isDatabaseHealthy ? 200 : 503;
      const message = isDatabaseHealthy ? 'Database is healthy' : 'Database is unhealthy';

      return res.status(statusCode).json({
        success: isDatabaseHealthy,
        message,
        data: healthData,
      });
    } catch (error) {
      logger.error('Database health check failed:', error);
      return errorResponse(res, 'Database health check failed', 500);
    }
  }

  /**
   * Readiness probe - checks if service is ready to accept requests
   */
  async readinessProbe(req, res) {
    try {
      const isDatabaseHealthy = await database.isHealthy();
      
      if (!isDatabaseHealthy) {
        return res.status(503).json({
          success: false,
          message: 'Service not ready - database unavailable',
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Service is ready',
      });
    } catch (error) {
      logger.error('Readiness probe failed:', error);
      return res.status(503).json({
        success: false,
        message: 'Service not ready',
      });
    }
  }

  /**
   * Liveness probe - checks if service is alive
   */
  async livenessProbe(req, res) {
    try {
      return res.status(200).json({
        success: true,
        message: 'Service is alive',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('Liveness probe failed:', error);
      return res.status(500).json({
        success: false,
        message: 'Service is not responding',
      });
    }
  }

  /**
   * Check Gmail configuration
   */
  checkGmailConfig() {
    const hasClientId = !!process.env.GOOGLE_CLIENT_ID;
    const hasClientSecret = !!process.env.GOOGLE_CLIENT_SECRET;
    const hasRedirectUri = !!process.env.GOOGLE_REDIRECT_URI;

    return {
      configured: hasClientId && hasClientSecret && hasRedirectUri,
      details: {
        clientId: hasClientId ? 'configured' : 'missing',
        clientSecret: hasClientSecret ? 'configured' : 'missing',
        redirectUri: hasRedirectUri ? 'configured' : 'missing',
      },
    };
  }

  /**
   * Check AI service configuration
   */
  checkAIConfig() {
    const provider = process.env.AI_PROVIDER || 'openai';
    const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;

    let configured = false;
    if (provider === 'openai' && hasOpenAIKey) configured = true;
    if (provider === 'anthropic' && hasAnthropicKey) configured = true;

    return {
      provider,
      configured,
      details: {
        openai: hasOpenAIKey ? 'configured' : 'missing',
        anthropic: hasAnthropicKey ? 'configured' : 'missing',
      },
    };
  }
}

module.exports = new HealthController();