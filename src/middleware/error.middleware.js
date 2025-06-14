const logger = require('../utils/logger');

/**
 * @file Error Handling Middleware
 * @module middleware/error
 * @requires ../utils/logger
 */

/**
 * Global error handling middleware.
 * Catches errors from previous middleware and route handlers.
 * Logs the error and sends a standardized JSON error response.
 *
 * @function errorHandler
 * @param {Error} err - The error object.
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware function (unused here, but required by Express error handler signature).
 */
const errorHandler = (err, req, res, next) => {
  // Ensure error object has all necessary properties, defaulting if not present.
  let error = {
    ...err, // Spread original error properties
    message: err.message || 'An unexpected error occurred.', // Ensure message is present
    statusCode: err.statusCode || 500 // Default to 500 if no statusCode
  };

  // Log error (using the original err object for more raw details if needed)
  const errorDetails = {
    message: err.message, // Original error message
    name: err.name,       // Original error name (e.g., 'ValidationError')
    statusCode: err.statusCode, // Original or assigned status code
    stack: err.stack,
    url: req.originalUrl || req.url, // Use originalUrl if available
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  };

  // Add specific error properties if they exist
  if (err.code) errorDetails.code = err.code;
  if (err.path) errorDetails.path = err.path;
  if (err.value) errorDetails.value = err.value;
  if (err.errors) errorDetails.errors = err.errors;


  logger.error('Unhandled error caught by error handler', errorDetails);

  // Standardize known error types to specific status codes and messages
  // The original `err` is used for checking type, but the `error` object (which is a copy) is updated for the response
  if (err.name === 'CastError') { // Mongoose bad ObjectId
    error.message = 'Resource not found. The ID provided is not valid.';
    error.statusCode = 404;
  } else if (err.code === 11000) { // Mongoose duplicate key
    // Attempt to extract the field that caused the duplication error
    const field = err.message.split("index: ")[1]?.split(" dup key")[0]?.split("_1")[0] || "field";
    error.message = `Duplicate value entered for ${field}. Please use a unique value.`;
    error.statusCode = 400;
  } else if (err.name === 'ValidationError') { // Mongoose validation error
    error.message = Object.values(err.errors).map(val => val.message).join(', ');
    error.statusCode = 400;
  } else if (err.name === 'JsonWebTokenError') { // JWT specific errors
    error.message = 'Invalid authentication token. Please log in again.';
    error.statusCode = 401;
  } else if (err.name === 'TokenExpiredError') {
    error.message = 'Your session has expired. Please log in again.';
    error.statusCode = 401;
  } else if (error.statusCode === 429) { // Rate limit error (already has statusCode)
    error.message = err.message || 'Too many requests. Please try again later.';
  }
  // For other errors, use the statusCode from the error if available, or default to 500

  // Final response structure
  res.status(error.statusCode).json({
    success: false,
    message: error.message, // Use the (potentially modified) error message
    // Include stack trace in development for easier debugging
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }), // Use error.stack from the modified error object
    timestamp: new Date().toISOString(),
  });
};

/**
 * Middleware to handle 404 errors (route not found).
 * This should be placed after all other routes.
 *
 * @function notFound
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware function (unused here).
 */
const notFound = (req, res, next) => {
  const message = `The requested route '${req.originalUrl}' was not found on this server.`;
  logger.warn(`404 - Route Not Found: ${req.method} ${req.originalUrl}`, {
    url: req.originalUrl, // Log the original URL
    method: req.method,
    ip: req.ip,
  });
  
  res.status(404).json({
    success: false,
    message,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Higher-order function to wrap asynchronous route handlers and controllers,
 * ensuring that any uncaught errors are passed to the `next` middleware (and thus to `errorHandler`).
 *
 * @function asyncHandler
 * @param {function} fn - The asynchronous function to wrap (typically a route handler).
 * @returns {function} An Express middleware function that executes `fn` and catches errors.
 *
 * @example
 * const { asyncHandler } = require('./error.middleware');
 * router.get('/some-async-route', asyncHandler(async (req, res, next) => {
 *   const data = await someAsyncOperation();
 *   res.json(data);
 * }));
 */
const asyncHandler = (fn) =>
  /**
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @param {import('express').NextFunction} next - Express next middleware function.
   */
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next); // Catches both synchronous and asynchronous errors from fn
};

module.exports = {
  errorHandler,
  notFound,
  asyncHandler,
};