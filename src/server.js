// Load environment variables from .env file
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const database = require('./config/database');
const { errorHandler, notFound } = require('./middleware/error.middleware');

// Import application routes
const healthRoutes = require('./routes/health.routes');
const authRoutes = require('./routes/auth.routes');
const aiRoutes = require('./routes/ai.routes');
const emailRoutes = require('./routes/email.routes');
const personaRoutes = require('./routes/persona.routes');

/**
 * @file Application Server Setup
 * @module server
 * @requires dotenv For environment variable management.
 * @requires express Main application framework.
 * @requires cors For enabling Cross-Origin Resource Sharing.
 * @requires helmet For securing the app by setting various HTTP headers.
 * @requires morgan For HTTP request logging.
 * @requires express-rate-limit For limiting repeated requests to public APIs and/or endpoints.
 * @requires ./utils/logger Custom logger utility.
 * @requires ./config/database Database connection utility.
 * @requires ./middleware/error.middleware Global error handling and 404 middleware.
 * @requires ./routes/* All route modules for the application.
 */

/**
 * Represents the main application server.
 * Encapsulates Express application setup, middleware configuration, route initialization,
 * error handling, and server start/stop logic.
 * @class Server
 */
class Server {
  /**
   * Initializes a new instance of the Server.
   * Sets up the Express application, port, and host.
   * Calls methods to initialize middlewares, routes, and error handling.
   * @constructor
   */
  constructor() {
    /** @member {import('express').Application} app - The Express application instance. */
    this.app = express();
    /** @member {number} port - The port on which the server will listen. Defaults to 3000 or `process.env.PORT`. */
    this.port = parseInt(process.env.PORT, 10) || 3000;
    /** @member {string} host - The hostname on which the server will listen. Defaults to 'localhost' or `process.env.HOST`. */
    this.host = process.env.HOST || 'localhost';
    
    this._initializeMiddlewares();
    this._initializeRoutes();
    this._initializeErrorHandling();
  }

  /**
   * Configures and registers global middlewares for the Express application.
   * Includes security headers (Helmet), CORS, rate limiting, body parsing (JSON, URL-encoded),
   * and HTTP request logging (Morgan).
   * @private
   */
  _initializeMiddlewares() {
    // Apply Helmet for basic security headers
    this.app.use(helmet({
      contentSecurityPolicy: { // Example CSP configuration; adjust as needed for your frontend
        directives: {
          defaultSrc: ["'self'"], // Only allow resources from own origin by default
          scriptSrc: ["'self'"], // Add other sources if you use CDNs for scripts
          styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles if necessary
          imgSrc: ["'self'", "data:", "https:"], // Allow images from self, data URLs, and HTTPS
          // connectSrc: ["'self'", "your-api-domain.com"], // Define where AJAX requests can go
        },
      },
    }));

    // Configure CORS
    const corsOptions = {
      origin: (origin, callback) => {
        const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [];
        
        // Allow Chrome extensions
        const isChromeExtension = origin && origin.startsWith('chrome-extension://');
        
        // Allow requests with no origin (like mobile apps, curl, Postman)
        // or if origin is in allowed list or is a chrome extension
        if (!origin || allowedOrigins.includes(origin) || isChromeExtension) {
          callback(null, true);
        } else {
          logger.warn(`CORS: Blocked origin - ${origin}`);
          callback(new Error('This origin is not allowed by CORS policy.'));
        }
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type', 
        'Authorization', 
        'X-Requested-With',
        'X-Extension-ID', // Custom header for extension identification
        'X-Chrome-Extension'
      ],
      credentials: true,
      optionsSuccessStatus: 200 // For legacy browser support
    };
    this.app.use(cors(corsOptions));

    // Apply rate limiting to all requests
    const globalLimiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS_GLOBAL, 10) || 200, // Max requests per window per IP
      standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
      legacyHeaders: false, // Disable `X-RateLimit-*` headers
      message: { // Custom message when rate limit is hit
        success: false,
        message: 'Too many requests from this IP address, please try again after 15 minutes.',
        timestamp: new Date().toISOString(),
      },
      handler: (req, res, next, options) => { // Custom handler to log when limit is exceeded
        logger.warn('Global rate limit exceeded', { ip: req.ip, path: req.path });
        res.status(options.statusCode).send(options.message);
      }
    });
    this.app.use(globalLimiter);

    // Middleware for parsing JSON and URL-encoded request bodies
    this.app.use(express.json({ limit: process.env.REQUEST_BODY_LIMIT || '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: process.env.REQUEST_BODY_LIMIT || '10mb' }));

    // HTTP request logging with Morgan, configured to stream to Winston
    morgan.token('response-time-ms', function (req, res) { // Custom token for response time
      const startTime = this._startTime || process.hrtime(); // Access Morgan's internal start time or fallback
      const diff = process.hrtime(startTime);
      const ms = (diff[0] * 1e3) + (diff[1] * 1e-6);
      return ms.toFixed(3) + 'ms';
    });
    const morganJsonFormat = (tokens, req, res) => JSON.stringify({ // Structured JSON log format
        message: `HTTP ${tokens.method(req, res)} ${tokens.url(req, res)} ${tokens.status(req, res)} - ${tokens['response-time-ms'](req, res)}`,
        method: tokens.method(req, res),
        url: tokens.url(req, res),
        status: parseInt(tokens.status(req, res), 10),
        content_length: tokens.res(req, res, 'content-length'),
        response_time_ms: parseFloat(tokens['response-time-ms'](req, res)), // Ensure it's a number
        remote_addr: tokens['remote-addr'](req, res),
        user_agent: tokens['user-agent'](req, res),
      });
    this.app.use(morgan(morganJsonFormat, { stream: logger.stream })); // logger.stream is defined in logger.js
    logger.info('Core middlewares initialized.');
  }

  /**
   * Initializes and mounts application routes.
   * Includes main API routes and informational root/api-docs endpoints.
   * @private
   */
  _initializeRoutes() {
    // Mount main application routes under /api/v1 prefix (example)
    const apiPrefix = process.env.API_PREFIX || '/api/v1';
    this.app.use(`${apiPrefix}/health`, healthRoutes);
    this.app.use(`${apiPrefix}/auth`, authRoutes);
    this.app.use(`${apiPrefix}/ai`, aiRoutes);
    this.app.use(`${apiPrefix}/emails`, emailRoutes); // Changed from /email to /emails for plurality
    this.app.use(`${apiPrefix}/persona`, personaRoutes);

    // Root endpoint providing basic API information
    this.app.get('/', (req, res) => {
      res.json({
        success: true,
        message: 'Welcome to the Email Summarizer API!',
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        documentation: `${req.protocol}://${req.get('host')}${apiPrefix}/api-docs`, // Link to API docs
        healthCheck: `${req.protocol}://${req.get('host')}${apiPrefix}/health`,
      });
    });

    // API documentation endpoint (could serve Swagger/OpenAPI docs)
    // For now, it lists key endpoints.
    this.app.get(`${apiPrefix}/api-docs`, (req, res) => {
      // This could be expanded to serve a more detailed Swagger/OpenAPI definition
      res.json({
        success: true,
        message: 'Email Summarizer API Documentation',
        version: '1.0.0', // API version
        basePath: apiPrefix,
        // A simplified list of endpoint categories
        availableModules: {
          health: { path: `${apiPrefix}/health`, description: 'Service health and dependency checks.' },
          authentication: { path: `${apiPrefix}/auth`, description: 'User authentication and OAuth flows.' },
          ai: { path: `${apiPrefix}/ai`, description: 'AI-powered summarization and Q&A.' },
          emails: { path: `${apiPrefix}/emails`, description: 'Email processing, retrieval, and summaries.' },
          persona: { path: `${apiPrefix}/persona`, description: 'User persona management.' },
        },
      });
    });
    logger.info('Application routes initialized.');
  }

  /**
   * Initializes global error handling middleware.
   * Includes a 404 handler for undefined routes and a global error handler.
   * @private
   */
  _initializeErrorHandling() {
    // Middleware for handling 404 Not Found errors
    this.app.use(notFound);
    // Global error handling middleware (must be last in the middleware chain)
    this.app.use(errorHandler);
    logger.info('Error handling middleware initialized.');
  }

  /**
   * Starts the application server.
   * Connects to the database, then starts listening for HTTP requests.
   * Sets up graceful shutdown for SIGTERM and SIGINT signals.
   * @async
   * @returns {Promise<import('http').Server>} The HTTP server instance.
   * @throws {Error} If the server fails to start (e.g., database connection issue).
   */
  async start() {
    try {
      // Establish database connection before starting the server
      await database.connect();
      
      const serverInstance = this.app.listen(this.port, this.host, () => {
        logger.info(`🚀 Server successfully started in ${process.env.NODE_ENV || 'development'} mode.`);
        logger.info(`🔗 Listening on: http://${this.host}:${this.port}`);
        logger.info(`📖 API Docs available at: http://${this.host}:${this.port}${process.env.API_PREFIX || '/api/v1'}/api-docs`);
        logger.info(`❤️ Health check: http://${this.host}:${this.port}${process.env.API_PREFIX || '/api/v1'}/health`);
      });

      // Handle graceful shutdown
      const gracefulShutdown = async (signal) => {
        logger.info(`Signal ${signal} received. Initiating graceful shutdown...`);
        
        // Stop accepting new connections
        serverInstance.close(async () => {
          logger.info('HTTP server closed. No longer accepting new connections.');
          
          try {
            // Close database connection
            await database.disconnect();
            logger.info('Database connection closed successfully.');
            // Exit process
            logger.info('Graceful shutdown completed. Exiting.');
            process.exit(0);
          } catch (dbError) {
            logger.error('Error during database disconnection in graceful shutdown:', { message: dbError.message });
            process.exit(1); // Exit with error code if DB disconnect fails
          }
        });

        // Force shutdown if graceful period exceeds timeout
        const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 30000; // 30 seconds
        setTimeout(() => {
          logger.error('Graceful shutdown timed out. Forcing server to exit.');
          process.exit(1); // Exit with error code
        }, SHUTDOWN_TIMEOUT_MS);
      };

      // Listen for common termination signals
      process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Sent by Docker, Kubernetes, etc.
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // Sent by Ctrl+C

      this.httpServer = serverInstance; // Store server instance if needed later
      return serverInstance;

    } catch (error) {
      logger.error('Failed to start the server due to a critical error:', { message: error.message, stack: error.stack });
      // Ensure DB is disconnected if connect() succeeded but listen() failed.
      if (database.getConnectionState() === 'connected') {
        await database.disconnect().catch(dbErr => logger.error('Failed to disconnect DB during server start error:', dbErr));
      }
      process.exit(1); // Exit with error code
    }
  }
}

// Entry point: Start the server if this script is executed directly
if (require.main === module) {
  const application = new Server();
  application.start();
}

module.exports = Server;