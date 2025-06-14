const winston = require('winston');
const path = require('path');

/**
 * @file Winston logger configuration.
 * @module utils/logger
 * @requires winston
 * @requires path
 */

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston that you want to link the colors
winston.addColors(colors);

/**
 * Base format for all Winston transports.
 * Includes timestamp, error stack traces, string interpolation, and JSON formatting.
 * @type {winston.Logform.Format}
 */
const baseFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }), // Log the full stack
  winston.format.splat(), // Enable string interpolation
  winston.format.json() // Log in JSON format
);

/**
 * Console logging format for development environments.
 * Includes colorization and a custom printf function for human-readable output.
 * @type {winston.Logform.Format}
 */
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }), // Apply colors to the output
  winston.format.printf( // Custom print format
    (info) => {
      let logMessage = `${info.timestamp} ${info.level}: ${info.message}`;
      if (info.stack) { // Include stack trace if present
        logMessage += `\n${info.stack}`;
      }
      // Include any other metadata passed to the logger
      const remainingProps = Object.keys(info).reduce((acc, key) => {
        // Filter out standard Winston properties and symbols already handled
        if (!['timestamp', 'level', 'message', 'stack', Symbol.for('level'), Symbol.for('message'), Symbol.for('splat')].includes(key)) {
          acc[key] = info[key];
        }
        return acc;
      }, {});
      if (Object.keys(remainingProps).length > 0) {
        logMessage += ` ${JSON.stringify(remainingProps)}`; // Append remaining props as a JSON string
      }
      return logMessage;
    }
  )
);

/**
 * File logging format for production environments.
 * Combines the base format with uncolorize (to remove color codes from files)
 * and prettyPrint for readable JSON in log files.
 * @type {winston.Logform.Format}
 */
const fileFormat = winston.format.combine(
  winston.format.uncolorize(), // Remove colors for file logging
  baseFormat,
  winston.format.prettyPrint() // Pretty print JSON in files
);

// Define which transports the logger must use
const transports = [
  // Console transport
  new winston.transports.Console({
    format: process.env.NODE_ENV === 'production' ? baseFormat : consoleFormat,
    handleExceptions: true,
  }),
];

// Add file transports in production
if (process.env.NODE_ENV === 'production') {
  transports.push(
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/error.log'),
      level: 'error',
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5, // Increased maxFiles
      tailable: true,
      handleExceptions: true,
    }),
    new winston.transports.File({
      filename: path.join(__dirname, '../../logs/combined.log'),
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 3, // Increased maxFiles
      tailable: true,
      handleExceptions: true,
    })
  );
}

/**
 * Winston logger instance.
 * Configured with different transports and formats for development and production.
 *
 * @property {object} stream - A stream object with a `write` method,
 * compatible with Morgan logger. It parses JSON messages from Morgan if possible.
 */
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  levels,
  transports,
  exitOnError: false, // Do not exit on handled exceptions
});

// Create a stream object for Morgan integration
logger.stream = {
  /**
   * Write method for Morgan stream.
   * Parses the incoming message (expected to be a JSON string from Morgan)
   * and logs it using the http level. If parsing fails, logs the message as a plain string.
   * @param {string} message - The log message from Morgan.
   */
  write: (message) => {
    // Morgan logs are strings. If we configured Morgan to output JSON, we parse it here.
    try {
      const jsonMessage = JSON.parse(message);
      // Use the 'message' field from parsed JSON for the main log message,
      // and the whole parsed object as metadata.
      logger.http(jsonMessage.message || message.trim(), jsonMessage);
    } catch (e) {
      // If parsing fails, log the message as is.
      logger.http(message.trim());
    }
  },
};

module.exports = logger;