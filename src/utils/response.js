/**
 * Standardized API response utilities
 */

/**
 * Send success response
 * @param {Object} res - Express response object
 * @param {any} data - Response data
 * @param {string} message - Success message
 * @param {number} statusCode - HTTP status code (default: 200)
 */
const successResponse = (res, data = null, message = 'Success', statusCode = 200) => {
    return res.status(statusCode).json({
      success: true,
      message,
      data,
      timestamp: new Date().toISOString(),
    });
  };
  
  /**
   * Send error response
   * @param {Object} res - Express response object
   * @param {string} message - Error message
   * @param {number} statusCode - HTTP status code (default: 500)
   * @param {any} errors - Detailed error information
   */
  const errorResponse = (res, message = 'Internal Server Error', statusCode = 500, errors = null) => {
    const response = {
      success: false,
      message,
      timestamp: new Date().toISOString(),
    };
  
    if (errors) {
      response.errors = errors;
    }
  
    return res.status(statusCode).json(response);
  };
  
  /**
   * Send validation error response
   * @param {Object} res - Express response object
   * @param {Array} validationErrors - Array of validation errors
   * @param {string} message - Error message
   */
  const validationErrorResponse = (res, validationErrors, message = 'Validation failed') => {
    return res.status(400).json({
      success: false,
      message,
      errors: validationErrors,
      timestamp: new Date().toISOString(),
    });
  };
  
  /**
   * Send paginated response
   * @param {Object} res - Express response object
   * @param {Array} data - Response data array
   * @param {Object} pagination - Pagination metadata
   * @param {string} message - Success message
   */
  const paginatedResponse = (res, data, pagination, message = 'Success') => {
    return res.status(200).json({
      success: true,
      message,
      data,
      pagination,
      timestamp: new Date().toISOString(),
    });
  };
  
  /**
   * Send no content response
   * @param {Object} res - Express response object
   * @param {string} message - Success message
   */
  const noContentResponse = (res, message = 'No content') => {
    return res.status(204).json({
      success: true,
      message,
      timestamp: new Date().toISOString(),
    });
  };
  
  /**
   * Send unauthorized response
   * @param {Object} res - Express response object
   * @param {string} message - Error message
   */
  const unauthorizedResponse = (res, message = 'Unauthorized') => {
    return res.status(401).json({
      success: false,
      message,
      timestamp: new Date().toISOString(),
    });
  };
  
  /**
   * Send forbidden response
   * @param {Object} res - Express response object
   * @param {string} message - Error message
   */
  const forbiddenResponse = (res, message = 'Forbidden') => {
    return res.status(403).json({
      success: false,
      message,
      timestamp: new Date().toISOString(),
    });
  };
  
  /**
   * Send not found response
   * @param {Object} res - Express response object
   * @param {string} message - Error message
   */
  const notFoundResponse = (res, message = 'Resource not found') => {
    return res.status(404).json({
      success: false,
      message,
      timestamp: new Date().toISOString(),
    });
  };
  
  /**
   * Send conflict response
   * @param {Object} res - Express response object
   * @param {string} message - Error message
   */
  const conflictResponse = (res, message = 'Conflict') => {
    return res.status(409).json({
      success: false,
      message,
      timestamp: new Date().toISOString(),
    });
  };
  
  /**
   * Send rate limit exceeded response
   * @param {Object} res - Express response object
   * @param {string} message - Error message
   */
  const rateLimitResponse = (res, message = 'Too many requests') => {
    return res.status(429).json({
      success: false,
      message,
      timestamp: new Date().toISOString(),
    });
  };
  
  module.exports = {
    successResponse,
    errorResponse,
    validationErrorResponse,
    paginatedResponse,
    noContentResponse,
    unauthorizedResponse,
    forbiddenResponse,
    notFoundResponse,
    conflictResponse,
    rateLimitResponse,
  };