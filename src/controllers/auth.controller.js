const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const gmailConfig = require('../config/gmail.config');
const logger = require('../utils/logger');
const { successResponse, errorResponse, unauthorizedResponse } = require('../utils/response');
const { asyncHandler } = require('../middleware/error.middleware');
const User = require('../models/user.model');

class AuthController {
  /**
   * Initiate Gmail OAuth flow
   * @route GET /auth/gmail
   */
  initiateGmailAuth = asyncHandler(async (req, res) => {
    try {
      // Generate state parameter for CSRF protection
      const state = crypto.randomBytes(32).toString('hex');
      
      // Store state in session or cache (for now, we'll include it in the URL)
      // In production, you should store this in Redis or session store
      
      const authUrl = gmailConfig.generateAuthUrl(state);
      
      logger.info('Gmail OAuth flow initiated', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        state: state.substring(0, 8) + '...', // Log partial state
      });

      return successResponse(res, {
        authUrl,
        state, // Client should store this and verify in callback
        scopes: gmailConfig.getScopeDescriptions(),
      }, 'Gmail authorization URL generated successfully');
      
    } catch (error) {
      logger.error('Failed to initiate Gmail auth:', error);
      return errorResponse(res, 'Failed to initiate Gmail authentication', 500);
    }
  });

  /**
   * Handle Gmail OAuth callback
   * @route GET /auth/gmail/callback
   */
  handleGmailCallback = asyncHandler(async (req, res) => {
    try {
      const { code, state, error, error_description } = req.query;

      // Handle OAuth errors
      if (error) {
        logger.warn('Gmail OAuth error:', { error, error_description });
        return errorResponse(res, `Gmail authentication failed: ${error_description || error}`, 400);
      }

      // Validate required parameters
      if (!code) {
        return errorResponse(res, 'Authorization code is missing', 400);
      }

      // TODO: Validate state parameter against stored value
      // For now, we'll just log it
      logger.info('Gmail OAuth callback received', {
        hasCode: !!code,
        hasState: !!state,
        ip: req.ip,
      });

      // Exchange code for tokens
      const tokens = await gmailConfig.exchangeCodeForTokens(code);
      
      if (!tokens.access_token || !tokens.refresh_token) {
        return errorResponse(res, 'Failed to obtain required tokens from Gmail', 400);
      }

      // Get user information from Google
      const userInfo = await gmailConfig.getUserInfo(tokens.access_token);
      
      if (!userInfo.verified_email) {
        return errorResponse(res, 'Gmail account email is not verified', 400);
      }

      // Find or create user
      let user = await User.findByEmail(userInfo.email);
      
      if (!user) {
        // Create new user
        user = new User({
          email: userInfo.email,
          name: userInfo.name,
          avatar: userInfo.avatar,
          isEmailVerified: true,
        });
      }

      // Add or update Gmail provider
      const providerData = {
        provider: 'google',
        providerId: userInfo.id,
        email: userInfo.email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiry: new Date(Date.now() + (tokens.expires_in * 1000)),
        scopes: gmailConfig.scopes,
        isActive: true,
        connectedAt: new Date(),
      };

      await user.addProvider(providerData);
      await user.updateLastLogin();

      // Generate JWT token
      const jwtToken = this.generateJWTToken(user);

      logger.info('Gmail authentication successful', {
        userId: user._id,
        email: user.email,
        isNewUser: !user.createdAt || user.createdAt.getTime() === user.updatedAt.getTime(),
      });

      return successResponse(res, {
        user: user.toJSON(),
        token: jwtToken,
        tokenExpiry: new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)), // 7 days
        scopes: gmailConfig.scopes,
      }, 'Gmail authentication successful');

    } catch (error) {
      logger.error('Gmail callback error:', error);
      return errorResponse(res, 'Gmail authentication failed', 500);
    }
  });

  /**
   * Get current user information
   * @route GET /auth/me
   */
  getCurrentUser = asyncHandler(async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      
      if (!user || !user.isActive) {
        return unauthorizedResponse(res, 'User not found or inactive');
      }

      // Update last login time
      await user.updateLastLogin();

      return successResponse(res, {
        user: user.toJSON(),
        gmailConnected: !!user.gmailProvider,
        providers: user.providers.map(p => ({
          provider: p.provider,
          email: p.email,
          isActive: p.isActive,
          connectedAt: p.connectedAt,
          lastSyncAt: p.lastSyncAt,
        })),
      }, 'User information retrieved successfully');

    } catch (error) {
      logger.error('Get current user error:', error);
      return errorResponse(res, 'Failed to retrieve user information', 500);
    }
  });

  /**
   * Refresh Gmail access token
   * @route POST /auth/gmail/refresh
   */
  refreshGmailToken = asyncHandler(async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      
      if (!user) {
        return unauthorizedResponse(res, 'User not found');
      }

      const gmailProvider = user.gmailProvider;
      
      if (!gmailProvider) {
        return errorResponse(res, 'Gmail account not connected', 400);
      }

      // Check if token refresh is needed
      if (!user.isTokenExpired('google', gmailProvider.providerId)) {
        return successResponse(res, {
          message: 'Token is still valid',
          expiresAt: gmailProvider.tokenExpiry,
        }, 'Gmail token is still valid');
      }

      // Refresh the token
      const newTokens = await gmailConfig.refreshAccessToken(gmailProvider.refreshToken);
      
      // Update user with new tokens
      await user.updateProviderTokens('google', gmailProvider.providerId, newTokens);

      logger.info('Gmail token refreshed successfully', {
        userId: user._id,
        email: user.email,
      });

      return successResponse(res, {
        tokenExpiry: new Date(Date.now() + (newTokens.expires_in * 1000)),
        refreshedAt: new Date(),
      }, 'Gmail token refreshed successfully');

    } catch (error) {
      logger.error('Gmail token refresh error:', error);
      return errorResponse(res, 'Failed to refresh Gmail token', 500);
    }
  });

  /**
   * Disconnect Gmail account
   * @route DELETE /auth/gmail/disconnect
   */
  disconnectGmail = asyncHandler(async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      
      if (!user) {
        return unauthorizedResponse(res, 'User not found');
      }

      const gmailProvider = user.gmailProvider;
      
      if (!gmailProvider) {
        return errorResponse(res, 'Gmail account not connected', 400);
      }

      // Revoke tokens with Google
      try {
        await gmailConfig.revokeTokens(gmailProvider.accessToken);
      } catch (error) {
        logger.warn('Failed to revoke tokens with Google:', error.message);
        // Continue with local cleanup even if revocation fails
      }

      // Remove provider from user
      await user.removeProvider('google', gmailProvider.providerId);

      logger.info('Gmail account disconnected', {
        userId: user._id,
        email: user.email,
      });

      return successResponse(res, null, 'Gmail account disconnected successfully');

    } catch (error) {
      logger.error('Gmail disconnect error:', error);
      return errorResponse(res, 'Failed to disconnect Gmail account', 500);
    }
  });

  /**
   * Get connection status for all providers
   * @route GET /auth/connections
   */
  getConnections = asyncHandler(async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      
      if (!user) {
        return unauthorizedResponse(res, 'User not found');
      }

      const connections = {
        gmail: {
          connected: !!user.gmailProvider,
          email: user.gmailProvider?.email || null,
          connectedAt: user.gmailProvider?.connectedAt || null,
          lastSyncAt: user.gmailProvider?.lastSyncAt || null,
          tokenExpired: user.gmailProvider ? user.isTokenExpired('google', user.gmailProvider.providerId) : null,
        },
        // Add other providers here in the future
      };

      return successResponse(res, connections, 'Connection status retrieved successfully');

    } catch (error) {
      logger.error('Get connections error:', error);
      return errorResponse(res, 'Failed to retrieve connection status', 500);
    }
  });

  /**
   * Logout user
   * @route POST /auth/logout
   */
  logout = asyncHandler(async (req, res) => {
    try {
      // For now, we'll just return success since JWT is stateless
      // In a more advanced implementation, you might want to:
      // 1. Blacklist the JWT token
      // 2. Clear any cached user data
      // 3. Log the logout event

      logger.info('User logged out', {
        userId: req.user.id,
        email: req.user.email,
      });

      return successResponse(res, null, 'Logged out successfully');

    } catch (error) {
      logger.error('Logout error:', error);
      return errorResponse(res, 'Logout failed', 500);
    }
  });

  /**
   * Generate JWT token for user
   */
  generateJWTToken(user) {
    const payload = {
      id: user._id,
      email: user.email,
      name: user.name,
    };

    return jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });
  }

  /**
   * Verify JWT token
   */
  verifyJWTToken(token) {
    try {
      return jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      throw new Error('Invalid or expired token');
    }
  }
}

module.exports = new AuthController();