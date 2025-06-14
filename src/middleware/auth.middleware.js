const jwt = require('jsonwebtoken');
const User = require('../models/User.model.js'); // Ensure .js extension and correct casing
const logger = require('../utils/logger');
const { unauthorizedResponse, forbiddenResponse } = require('../utils/response');

/**
 * @file Authentication and Authorization Middleware
 * @module middleware/auth
 * @requires jsonwebtoken
 * @requires ../models/user.model
 * @requires ../utils/logger
 * @requires ../utils/response
 */

/**
 * Middleware to authenticate users based on JWT token.
 * Verifies the token, checks user existence and status, and attaches user info to `req.user`.
 * @async
 * @function authenticate
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware function.
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.header('Authorization');
    
    if (!authHeader) {
      return unauthorizedResponse(res, 'Access token is required');
    }

    // Check if the header starts with 'Bearer '
    if (!authHeader.startsWith('Bearer ')) {
      return unauthorizedResponse(res, 'Invalid token format. Use Bearer <token>');
    }

    // Extract token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    if (!token) {
      return unauthorizedResponse(res, 'Access token is required');
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return unauthorizedResponse(res, 'Token has expired');
      } else if (error.name === 'JsonWebTokenError') {
        return unauthorizedResponse(res, 'Invalid token');
      } else {
        return unauthorizedResponse(res, 'Token verification failed');
      }
    }

    // Get user from database
    const user = await User.findById(decoded.id);
    
    if (!user) {
      return unauthorizedResponse(res, 'User not found');
    }

    if (!user.isActive) {
      return unauthorizedResponse(res, 'Account is deactivated');
    }

    // Add user to request object for downstream handlers
    req.user = {
      id: user._id,
      email: user.email,
      name: user.name,
      subscription: user.subscription, // Attach subscription details for quick access
      preferences: user.preferences,   // Attach user preferences
    };

    next();
  } catch (error) {
    // Log the detailed error internally
    logger.error('Authentication middleware error:', { message: error.message, stack: error.stack, path: req.originalUrl });
    // Send a generic unauthorized response to the client
    return unauthorizedResponse(res, 'Authentication failed. Please ensure your token is valid and try again.');
  }
};

/**
 * Middleware to ensure the authenticated user has an active Gmail connection.
 * It also checks if the Gmail token is expired.
 * Assumes `authenticate` middleware has run prior.
 * @async
 * @function requireGmail
 * @param {import('express').Request} req - Express request object, expects `req.user` to be populated.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware function.
 */
const requireGmail = async (req, res, next) => {
  try {
    // req.user.id should be populated by the `authenticate` middleware
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return unauthorizedResponse(res, 'User not found');
    }

    const gmailProvider = user.gmailProvider;
    
    if (!gmailProvider || !gmailProvider.isActive) {
      return forbiddenResponse(res, 'Gmail account connection required');
    }

    // Check if token is expired
    if (user.isTokenExpired('google', gmailProvider.providerId)) {
      return forbiddenResponse(res, 'Gmail token has expired. Please reconnect your account');
    }

    // Add Gmail provider info to request for downstream handlers
    req.gmailProvider = gmailProvider;
    
    next();
  } catch (error) {
    logger.error('Gmail requirement middleware error:', { message: error.message, userId: req.user?.id });
    return forbiddenResponse(res, 'Gmail connection verification failed. Please ensure your Gmail is connected and active.');
  }
};

/**
 * Higher-order middleware to check if the authenticated user's subscription plan
 * meets the required level.
 * Assumes `authenticate` middleware has run prior.
 * @function requireSubscription
 * @param {('free'|'pro'|'enterprise')} requiredPlan - The minimum plan required to access the route.
 * @returns {function} Express middleware function.
 */
const requireSubscription = (requiredPlan) => {
  // Defines the hierarchy of plans. Higher number means higher plan.
  const planHierarchy = {
    free: 0,
    pro: 1,
    enterprise: 2,
  };

  /**
   * @param {import('express').Request} req - Express request object, expects `req.user` to be populated.
   * @param {import('express').Response} res - Express response object.
   * @param {import('express').NextFunction} next - Express next middleware function.
   */
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id); // req.user.id from `authenticate`
      
      if (!user) {
        return unauthorizedResponse(res, 'User not found for subscription check.');
      }

      const userPlanLevel = planHierarchy[user.subscription?.plan] || 0;
      const requiredPlanLevel = planHierarchy[requiredPlan] || 0;

      if (userPlanLevel < requiredPlanLevel) {
        return forbiddenResponse(res, `This feature requires a '${requiredPlan}' subscription or higher.`);
      }

      // Check if subscription is active (e.g., not 'cancelled' or 'paused')
      if (user.subscription?.status !== 'active' && user.subscription?.status !== 'trial') {
        return forbiddenResponse(res, 'An active subscription is required. Current status: ' + user.subscription?.status);
      }

      // Check if subscription has expired
      if (user.subscription?.expiresAt && new Date() > new Date(user.subscription.expiresAt)) {
        return forbiddenResponse(res, 'Your subscription has expired. Please renew to continue.');
      }

      next();
    } catch (error) {
      logger.error('Subscription middleware error:', { message: error.message, userId: req.user?.id, requiredPlan });
      return forbiddenResponse(res, 'Subscription verification failed. Please contact support if this issue persists.');
    }
  };
};

/**
 * Higher-order middleware to check API usage limits for the authenticated user.
 * Skips checks for 'enterprise' plan users.
 * Assumes `authenticate` middleware has run prior.
 * @function checkUsageLimit
 * @param {string} limitType - The type of usage to check (e.g., 'summaries', 'emailsProcessed'). Must match a key in `user.usage`.
 * @param {number} maxCount - The maximum allowed count for this `limitType`.
 * @returns {function} Express middleware function.
 */
const checkUsageLimit = (limitType, maxCount) => {
  /**
   * @param {import('express').Request} req - Express request object, expects `req.user` to be populated.
   * @param {import('express').Response} res - Express response object.
   * @param {import('express').NextFunction} next - Express next middleware function.
   */
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id); // req.user.id from `authenticate`
      
      if (!user) {
        return unauthorizedResponse(res, 'User not found for usage limit check.');
      }

      // Enterprise users may have unlimited usage or custom limits handled elsewhere
      if (user.subscription?.plan === 'enterprise') {
        return next();
      }

      const currentUsage = user.usage[limitType] || 0;
      
      if (currentUsage >= maxCount) {
        return forbiddenResponse(res, `Your usage limit for '${limitType}' (${maxCount}) has been exceeded. Please upgrade your plan or wait for the next cycle.`);
      }

      next();
    } catch (error) {
      logger.error('Usage limit middleware error:', { message: error.message, userId: req.user?.id, limitType, maxCount });
      return forbiddenResponse(res, 'Usage limit check failed. Please try again or contact support.');
    }
  };
};

/**
 * Higher-order middleware to track API usage for a specific feature.
 * Increments usage count for the authenticated user after a successful response.
 * Assumes `authenticate` middleware has run prior.
 * @function trackUsage
 * @param {string} usageType - The type of usage to track (e.g., 'summariesCreated', 'emailsAnalyzed'). Must match a key in `user.usage`.
 * @returns {function} Express middleware function.
 */
const trackUsage = (usageType) => {
  /**
   * @param {import('express').Request} req - Express request object, expects `req.user` to be populated.
   * @param {import('express').Response} res - Express response object.
   * @param {import('express').NextFunction} next - Express next middleware function.
   */
  return async (req, res, next) => {
    // Store the original res.send function
    const originalSend = res.send;
    
    // Override res.send to intercept the response
    res.send = function(data) {
      // Only track usage for successful responses (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Perform usage tracking asynchronously to avoid delaying the response
        setImmediate(async () => {
          try {
            // Ensure user is still available (e.g., from req.user set by authenticate middleware)
            if (req.user && req.user.id) {
              const user = await User.findById(req.user.id);
              if (user) {
                await user.incrementUsage(usageType);
                logger.info('Usage tracked successfully', { userId: user._id, usageType });
              }
            }
          } catch (error) {
            logger.error('Usage tracking error:', { message: error.message, userId: req.user?.id, usageType });
            // Do not interfere with client response if tracking fails
          }
        });
      }
      
      // Call the original res.send function to send the response to the client
      originalSend.call(this, data);
    };
    
    next();
  };
};

/**
 * Middleware for optional authentication.
 * If a valid JWT token is provided, `req.user` is populated.
 * If no token or an invalid token is provided, proceeds without `req.user`, allowing public access or different handling for unauthenticated users.
 * @async
 * @function optionalAuth
 * @param {import('express').Request} req - Express request object.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware function.
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // No token provided, continue without user
    }

    const token = authHeader.substring(7);
    
    if (!token) {
      return next(); // No token (or Bearer prefix missing), continue without user
    }

    try {
      // Verify the token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      // Fetch the user from the database
      const user = await User.findById(decoded.id);
      
      // If user exists and is active, attach to request
      if (user && user.isActive) {
        req.user = {
          id: user._id,
          email: user.email,
          name: user.name,
          subscription: user.subscription,
          preferences: user.preferences,
        };
      }
      // If user not found or inactive, or token invalid, req.user remains undefined
    } catch (error) {
      // Token verification failed (e.g., expired, malformed). Log it but proceed.
      logger.warn('Optional auth: Token verification failed or user not found.', { message: error.message });
    }

    next();
  } catch (error) {
    // Catch any unexpected errors during the process
    logger.error('Optional auth middleware encountered an unexpected error:', { message: error.message, stack: error.stack });
    next(); // Ensure we always call next, even on unexpected errors
  }
};

/**
 * Middleware to ensure the authenticated user's Gmail token is valid.
 * If the token is expired, it attempts to refresh it automatically.
 * Assumes `authenticate` middleware has run prior.
 * @async
 * @function ensureValidGmailToken
 * @param {import('express').Request} req - Express request object, expects `req.user` to be populated.
 * @param {import('express').Response} res - Express response object.
 * @param {import('express').NextFunction} next - Express next middleware function.
 */
const ensureValidGmailToken = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id); // req.user.id from `authenticate`
    
    if (!user) {
      return unauthorizedResponse(res, 'User not found for Gmail token validation.');
    }

    const gmailProvider = user.gmailProvider; // Assuming this field exists and stores provider details
    
    if (!gmailProvider || !gmailProvider.isActive) {
      return forbiddenResponse(res, 'Active Gmail account connection is required.');
    }

    // Check if token needs refresh (assumes user model has such a method)
    if (user.isTokenExpired('google', gmailProvider.providerId)) {
      logger.info('Gmail token requires refresh', { userId: user._id, email: user.email });
      try {
        const gmailConfig = require('../config/gmail.config'); // Lazy load to avoid circular deps if any
        const newTokens = await gmailConfig.refreshAccessToken(gmailProvider.refreshToken);
        
        // Update user's tokens in the database
        await user.updateProviderTokens('google', gmailProvider.providerId, newTokens);
        
        // Update the gmailProvider info in the current request object with new details
        req.gmailProvider = user.gmailProvider; // Re-fetch or update in-memory user.gmailProvider
        
        logger.info('Gmail token refreshed automatically and updated in request', {
          userId: user._id,
          email: user.email,
        });
      } catch (refreshError) {
        logger.error('Automatic Gmail token refresh failed:', { message: refreshError.message, userId: user._id });
        // It's important to inform the user that re-authentication might be needed
        return forbiddenResponse(res, 'Your Gmail session has expired and automatic refresh failed. Please reconnect your Gmail account.');
      }
    } else {
      // Token is still valid, attach existing provider info to request
      req.gmailProvider = gmailProvider;
    }

    next();
  } catch (error) {
    logger.error('Gmail token validation middleware error:', { message: error.message, userId: req.user?.id });
    return forbiddenResponse(res, 'Gmail token validation failed. Please try again or reconnect your account.');
  }
};

module.exports = {
  authenticate,
  requireGmail,
  requireSubscription,
  checkUsageLimit,
  trackUsage,
  optionalAuth,
  ensureValidGmailToken,
};