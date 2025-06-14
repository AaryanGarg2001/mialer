const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * @file MongoDB Database Configuration and Management
 * @module config/database
 * @requires mongoose
 * @requires ../utils/logger
 */

/**
 * Manages MongoDB database connections.
 * Provides methods to connect, disconnect, check health, and get connection state.
 * @class Database
 */
class Database {
  /**
   * Initializes the Database instance.
   * @constructor
   */
  constructor() {
    /** @member {import('mongoose').Connection|null} connection - The Mongoose connection object. Null if not connected. */
    this.connection = null;
  }

  /**
   * Establishes a connection to the MongoDB database using Mongoose.
   * Reads the MongoDB URI from environment variables.
   * Sets up connection event listeners for errors, disconnections, and reconnections.
   * Handles SIGINT process signal for graceful shutdown.
   * @async
   * @returns {Promise<import('mongoose').Connection>} The Mongoose connection object.
   * @throws {Error} If the MongoDB URI is not defined or if connection fails.
   */
  async connect() {
    try {
      const mongoUri = process.env.NODE_ENV === 'test' 
        ? process.env.MONGODB_TEST_URI 
        : process.env.MONGODB_URI;

      if (!mongoUri) {
        logger.error('MongoDB URI is not defined. Set MONGODB_URI or MONGODB_TEST_URI in environment variables.');
        throw new Error('MongoDB URI is not defined in environment variables');
      }

      // MongoDB connection options
      // These options are sensible defaults for most applications.
      const options = {
        maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE, 10) || 10, // Max number of sockets the MongoDB driver will keep open for this connection.
        serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 10) || 5000, // How long the driver will try to find a server before timing out.
        socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS, 10) || 45000, // How long a send or receive on a socket can take before timing out.
        bufferCommands: false, // Disable Mongoose's buffering mechanism for commands.
        bufferMaxEntries: 0,   // If bufferCommands is false, this option is ignored.
        // family: 4, // Use IPv4, skip trying IPv6 - useful in some environments
      };

      // Establish the connection
      this.connection = await mongoose.connect(mongoUri, options);

      logger.info(`MongoDB connected successfully to: ${this.connection.connection.name} on ${this.connection.connection.host}:${this.connection.connection.port}`);

      // Set up event listeners for the Mongoose connection
      mongoose.connection.on('error', (error) => {
        logger.error('MongoDB connection error after initial connection:', error);
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected. Attempting to reconnect if configured.');
        // Note: Mongoose handles reconnection automatically based on its options.
        // You might add custom logic here if needed.
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected successfully.');
      });

      // Graceful shutdown on SIGINT (Ctrl+C)
      process.on('SIGINT', async () => {
        logger.info('SIGINT received. Closing MongoDB connection...');
        await this.disconnect();
        process.exit(0);
      });

      return this.connection.connection; // Return the native driver connection object
    } catch (error) {
      logger.error('Database connection failed during initial setup:', { message: error.message, stack: error.stack });
      // Rethrow the error to allow the application to handle it, e.g., by exiting.
      throw error;
    }
  }

  /**
   * Closes the active MongoDB connection if it exists.
   * @async
   * @returns {Promise<void>}
   * @throws {Error} If an error occurs during disconnection.
   */
  async disconnect() {
    try {
      if (mongoose.connection && mongoose.connection.readyState !== 0) { // 0 = disconnected
        await mongoose.connection.close();
        this.connection = null; // Reset the stored connection
        logger.info('MongoDB connection closed successfully.');
      } else {
        logger.info('MongoDB connection already closed or not established.');
      }
    } catch (error) {
      logger.error('Error closing MongoDB connection:', { message: error.message, stack: error.stack });
      throw error;
    }
  }

  /**
   * Gets the current state of the Mongoose connection.
   * @returns {('disconnected'|'connected'|'connecting'|'disconnecting'|'uninitialized'|'unknown')} A string representing the connection state.
   */
  getConnectionState() {
    if (!mongoose.connection) return 'uninitialized';

    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting',
      99: 'uninitialized', // Mongoose < 5 used 99
    };
    return states[mongoose.connection.readyState] || 'unknown';
  }

  /**
   * Checks the health of the database connection.
   * Verifies that the connection state is 'connected' and pings the admin database.
   * @async
   * @returns {Promise<boolean>} True if the database is healthy, false otherwise.
   */
  async isHealthy() {
    try {
      const state = this.getConnectionState();
      if (state !== 'connected') {
        logger.warn(`Database health check: Unhealthy, current state: ${state}`);
        return false;
      }

      // Ping the database to ensure it's responsive
      // The admin().ping() command is lightweight and suitable for health checks.
      await mongoose.connection.db.admin().ping();
      logger.debug('Database health check: Healthy, ping successful.');
      return true;
    } catch (error) {
      logger.error('Database health check failed with error:', { message: error.message });
      return false;
    }
  }
}

module.exports = new Database();