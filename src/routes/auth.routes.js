const express = require('express');
const authController = require('../controllers/auth.controller');
const { authenticate, requireGmail, optionalAuth } = require('../middleware/auth.middleware');
const { asyncHandler } = require('../middleware/error.middleware');
const User = require('../models/User.model');

const router = express.Router();

/**
 * @route GET /auth/gmail
 * @description Initiate Gmail OAuth flow
 * @access Public
 */
router.get('/gmail', authController.initiateGmailAuth);

/**
 * @route GET /auth/gmail/callback
 * @description Handle Gmail OAuth callback
 * @access Public
 */
router.get('/gmail/callback', authController.handleGmailCallback);

/**
 * @route GET /auth/me
 * @description Get current authenticated user
 * @access Private
 */
router.get('/me', authenticate, authController.getCurrentUser);

/**
 * @route POST /auth/gmail/refresh
 * @description Refresh Gmail access token
 * @access Private
 */
router.post('/gmail/refresh', authenticate, authController.refreshGmailToken);

/**
 * @route DELETE /auth/gmail/disconnect
 * @description Disconnect Gmail account
 * @access Private
 */
router.delete('/gmail/disconnect', authenticate, authController.disconnectGmail);

/**
 * @route GET /auth/connections
 * @description Get connection status for all providers
 * @access Private
 */
router.get('/connections', authenticate, authController.getConnections);

/**
 * @route POST /auth/logout
 * @description Logout user (invalidate token)
 * @access Private
 */
router.post('/logout', authenticate, authController.logout);

/**
 * @route GET /auth/status
 * @description Check authentication status (optional auth)
 * @access Public/Private
 */
router.get('/status', optionalAuth, asyncHandler(async (req, res) => {
  const { successResponse } = require('../utils/response');
  
  if (req.user) {
    return successResponse(res, {
      authenticated: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        subscription: req.user.subscription,
      },
    }, 'User is authenticated');
  } else {
    return successResponse(res, {
      authenticated: false,
    }, 'User is not authenticated');
  }
}));

/**
 * @route GET /auth/gmail/status
 * @description Check Gmail connection status
 * @access Private
 */
router.get('/gmail/status', authenticate, asyncHandler(async (req, res) => {
  const { successResponse, errorResponse } = require('../utils/response');
  
  try {
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return errorResponse(res, 'User not found', 404);
    }

    const gmailProvider = user.gmailProvider;
    
    const status = {
      connected: !!gmailProvider,
      email: gmailProvider?.email || null,
      connectedAt: gmailProvider?.connectedAt || null,
      lastSyncAt: gmailProvider?.lastSyncAt || null,
      tokenExpired: gmailProvider ? user.isTokenExpired('google', gmailProvider.providerId) : null,
      scopes: gmailProvider?.scopes || [],
    };

    return successResponse(res, status, 'Gmail status retrieved successfully');
    
  } catch (error) {
    return errorResponse(res, 'Failed to check Gmail status', 500);
  }
}));

/**
 * @route POST /auth/gmail/test-connection
 * @description Test Gmail API connection
 * @access Private
 */
router.post('/gmail/test-connection', authenticate, requireGmail, asyncHandler(async (req, res) => {
  const gmailConfig = require('../config/gmail.config');
  const { successResponse, errorResponse } = require('../utils/response');
  const logger = require('../utils/logger');
  
  try {
    // Create Gmail client
    const gmail = gmailConfig.createGmailClient(
      req.gmailProvider.accessToken,
      req.gmailProvider.refreshToken
    );

    // Test API call - get user profile
    const profile = await gmail.users.getProfile({ userId: 'me' });
    
    logger.info('Gmail connection test successful', {
      userId: req.user.id,
      email: req.user.email,
      gmailEmail: profile.data.emailAddress,
    });

    return successResponse(res, {
      connected: true,
      profile: {
        emailAddress: profile.data.emailAddress,
        messagesTotal: profile.data.messagesTotal,
        threadsTotal: profile.data.threadsTotal,
        historyId: profile.data.historyId,
      },
      testedAt: new Date(),
    }, 'Gmail connection test successful');
    
  } catch (error) {
    logger.error('Gmail connection test failed:', error);
    
    if (error.code === 401) {
      return errorResponse(res, 'Gmail token is invalid or expired', 401);
    }
    
    return errorResponse(res, 'Gmail connection test failed', 500);
  }
}));

module.exports = router;