require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const logger = require('./utils/logger');
const database = require('./config/database');
const { errorHandler, notFound } = require('./middleware/error.middleware');

// Import routes
const healthRoutes = require('./routes/health.routes');

class Server {
  constructor() {
    this.app = express();
    this.port = process.env.PORT || 3000;
    this.host = process.env.HOST || 'localhost';
    
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  initializeMiddlewares() {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
    }));

    // CORS configuration
    const corsOptions = {
      origin: (origin, callback) => {
        const allowedOrigins = process.env.ALLOWED_ORIGINS 
          ? process.env.ALLOWED_ORIGINS.split(',')
          : ['http://localhost:3000'];
        
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
          callback(null, true);
        } else {
          callback(new Error('Not allowed by CORS'));
        }
      },
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
      credentials: true,
    };
    this.app.use(cors(corsOptions));

    // Rate limiting
    const limiter = rateLimit({
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
      max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100, // limit each IP to 100 requests per windowMs
      message: {
        success: false,
        message: 'Too many requests from this IP, please try again later.',
        timestamp: new Date().toISOString(),
      },
      standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
      legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    });
    this.app.use(limiter);

    // Body parsing middleware
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // HTTP request logger
    this.app.use(morgan('combined', { stream: logger.stream }));

    // Request logging middleware
    this.app.use((req, res, next) => {
      logger.info(`${req.method} ${req.originalUrl}`, {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        body: req.method !== 'GET' ? req.body : undefined,
      });
      next();
    });
  }

  initializeRoutes() {
    // API routes
    this.app.use('/health', healthRoutes);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        success: true,
        message: 'Email Summarizer API',
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV,
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          healthDetailed: '/health/detailed',
          healthDatabase: '/health/database',
          readiness: '/health/ready',
          liveness: '/health/live',
        },
      });
    });

    // API documentation endpoint
    this.app.get('/api-docs', (req, res) => {
      res.json({
        success: true,
        message: 'API Documentation',
        version: '1.0.0',
        endpoints: {
          root: {
            path: '/',
            method: 'GET',
            description: 'API information',
          },
          health: {
            path: '/health',
            method: 'GET',
            description: 'Basic health check',
          },
          healthDetailed: {
            path: '/health/detailed',
            method: 'GET',
            description: 'Detailed health check with system information',
          },
          healthDatabase: {
            path: '/health/database',
            method: 'GET',
            description: 'Database connectivity check',
          },
          readiness: {
            path: '/health/ready',
            method: 'GET',
            description: 'Kubernetes readiness probe',
          },
          liveness: {
            path: '/health/live',
            method: 'GET',
            description: 'Kubernetes liveness probe',
          },
        },
      });
    });
  }

  initializeErrorHandling() {
    // 404 handler
    this.app.use(notFound);
    
    // Global error handler
    this.app.use(errorHandler);
  }

  async start() {
    try {
      // Connect to database
      await database.connect();
      
      // Start server
      const server = this.app.listen(this.port, this.host, () => {
        logger.info(`🚀 Server running in ${process.env.NODE_ENV} mode`);
        logger.info(`🔗 Server URL: http://${this.host}:${this.port}`);
        logger.info(`📊 Health check: http://${this.host}:${this.port}/health`);
        logger.info(`📚 API docs: http://${this.host}:${this.port}/api-docs`);
      });

      // Graceful shutdown
      const gracefulShutdown = async (signal) => {
        logger.info(`${signal} received. Starting graceful shutdown...`);
        
        server.close(async () => {
          logger.info('HTTP server closed');
          
          try {
            await database.disconnect();
            logger.info('Database connection closed');
            process.exit(0);
          } catch (error) {
            logger.error('Error during graceful shutdown:', error);
            process.exit(1);
          }
        });

        // Force close after 30 seconds
        setTimeout(() => {
          logger.error('Could not close connections in time, forcefully shutting down');
          process.exit(1);
        }, 30000);
      };

      // Listen for termination signals
      process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
      process.on('SIGINT', () => gracefulShutdown('SIGINT'));

      return server;
    } catch (error) {
      logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }
}

// Start server if this file is run directly
if (require.main === module) {
  const server = new Server();
  server.start();
}

module.exports = Server;