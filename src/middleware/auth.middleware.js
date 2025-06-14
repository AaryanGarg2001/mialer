const jwt = require('jsonwebtoken');
const User = require('../models/user.model');
const logger = require('../utils/logger');
const { unauthorizedResponse, forbiddenResponse } = require('../utils/response');

/**
 * Middleware to authenticate JWT token
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
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

    // Add user to request object
    req.user = {
      id: user._id,
      email: user.email,
      name: user.name,
      subscription: user.subscription,
      preferences: user.preferences,
    };

    next();
  } catch (error) {
    logger.error('Authentication middleware error:', error);
    return unauthorizedResponse(res, 'Authentication failed');
  }
};

/**
 * Middleware to check if user has Gmail connected
 */
const requireGmail = async (req, res, next) => {
  try {
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

    // Add Gmail provider info to request
    req.gmailProvider = gmailProvider;
    
    next();
  } catch (error) {
    logger.error('Gmail requirement middleware error:', error);
    return forbiddenResponse(res, 'Gmail connection verification failed');
  }
};

/**
 * Middleware to check subscription level
 */
const requireSubscription = (requiredPlan) => {
  const planHierarchy = {
    free: 0,
    pro: 1,
    enterprise: 2,
  };

  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      
      if (!user) {
        return unauthorizedResponse(res, 'User not found');
      }

      const userPlanLevel = planHierarchy[user.subscription.plan] || 0;
      const requiredPlanLevel = planHierarchy[requiredPlan] || 0;

      if (userPlanLevel < requiredPlanLevel) {
        return forbiddenResponse(res, `${requiredPlan} subscription required`);
      }

      // Check if subscription is active
      if (user.subscription.status !== 'active' && user.subscription.status !== 'trial') {
        return forbiddenResponse(res, 'Active subscription required');
      }

      // Check if subscription has expired
      if (user.subscription.expiresAt && new Date() > user.subscription.expiresAt) {
        return forbiddenResponse(res, 'Subscription has expired');
      }

      next();
    } catch (error) {
      logger.error('Subscription middleware error:', error);
      return forbiddenResponse(res, 'Subscription verification failed');
    }
  };
};

/**
 * Middleware to check API usage limits
 */
const checkUsageLimit = (limitType, maxCount) => {
  return async (req, res, next) => {
    try {
      const user = await User.findById(req.user.id);
      
      if (!user) {
        return unauthorizedResponse(res, 'User not found');
      }

      // Skip usage check for enterprise users
      if (user.subscription.plan === 'enterprise') {
        return next();
      }

      const currentUsage = user.usage[limitType] || 0;
      
      if (currentUsage >= maxCount) {
        return forbiddenResponse(res, `${limitType} limit exceeded. Upgrade your plan for higher limits`);
      }

      next();
    } catch (error) {
      logger.error('Usage limit middleware error:', error);
      return forbiddenResponse(res, 'Usage limit check failed');
    }
  };
};

/**
 * Middleware to track API usage
 */
const trackUsage = (usageType) => {
  return async (req, res, next) => {
    // Store the original send function
    const originalSend = res.send;
    
    // Override the send function
    res.send = function(data) {
      // Only track successful responses (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        // Track usage asynchronously to avoid blocking the response
        setImmediate(async () => {
          try {
            const user = await User.findById(req.user.id);
            if (user) {
              await user.incrementUsage(usageType);
            }
          } catch (error) {
            logger.error('Usage tracking error:', error);
          }
        });
      }
      
      // Call the original send function
      originalSend.call(this, data);
    };
    
    next();
  };
};

/**
 * Optional authentication - sets user if token is valid, but doesn't require it
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(); // No token provided, continue without user
    }

    const token = authHeader.substring(7);
    
    if (!token) {
      return next(); // No token provided, continue without user
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      
      if (user && user.isActive) {
        req.user = {
          id: user._id,
          email: user.email,
          name: user.name,
          subscription: user.subscription,
          preferences: user.preferences,
        };
      }
    } catch (error) {
      // Token is invalid, but we continue without user
      logger.warn('Invalid token in optional auth:', error.message);
    }

    next();
  } catch (error) {
    logger.error('Optional auth middleware error:', error);
    next(); // Continue without user even if there's an error
  }
};

/**
 * Middleware to validate Gmail token and refresh if needed
 */
const ensureValidGmailToken = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return unauthorizedResponse(res, 'User not found');
    }

    const gmailProvider = user.gmailProvider;
    
    if (!gmailProvider) {
      return forbiddenResponse(res, 'Gmail account not connected');
    }

    // Check if token needs refresh
    if (user.isTokenExpired('google', gmailProvider.providerId)) {
      try {
        const gmailConfig = require('../config/gmail.config');
        const newTokens = await gmailConfig.refreshAccessToken(gmailProvider.refreshToken);
        
        await user.updateProviderTokens('google', gmailProvider.providerId, newTokens);
        
        // Update the provider info in request
        req.gmailProvider = user.gmailProvider;
        
        logger.info('Gmail token refreshed automatically', {
          userId: user._id,
          email: user.email,
        });
      } catch (error) {
        logger.error('Auto token refresh failed:', error);
        return forbiddenResponse(res, 'Gmail token expired and refresh failed. Please reconnect your account');
      }
    } else {
      req.gmailProvider = gmailProvider;
    }

    next();
  } catch (error) {
    logger.error('Gmail token validation middleware error:', error);
    return forbiddenResponse(res, 'Gmail token validation failed');
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