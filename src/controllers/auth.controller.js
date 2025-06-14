const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const gmailConfig = require('../config/gmail.config');
const logger = require('../utils/logger');
const { successResponse, errorResponse, unauthorizedResponse } = require('../utils/response');
const { asyncHandler } = require('../middleware/error.middleware');
const User = require('../models/User.model.js'); // Ensure .js extension and correct casing

/**
 * @file Authentication Controller
 * @module controllers/auth
 * @requires jsonwebtoken
 * @requires crypto
 * @requires ../config/gmail.config
 * @requires ../utils/logger
 * @requires ../utils/response
 * @requires ../middleware/error.middleware
 * @requires ../models/user.model
 */

/**
 * Controller for handling user authentication, including OAuth with Gmail.
 * @class AuthController
 */
class AuthController {
  /**
   * Initiates the Gmail OAuth 2.0 authentication flow.
   * Generates an authorization URL and returns it to the client.
   * @method initiateGmailAuth
   * @route GET /api/v1/auth/gmail
   * @access Public
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with the Gmail authorization URL and state.
   */
  initiateGmailAuth = asyncHandler(async (req, res) => {
    try {
      // Generate a secure random state string for CSRF protection
      const state = crypto.randomBytes(32).toString('hex');
      
      // In a stateful application, `state` would be stored in the user's session (e.g., Redis)
      // to be verified in the callback. For stateless APIs, other mechanisms might be used or
      // the state might be encoded with information and signed.
      
      const authUrl = gmailConfig.generateAuthUrl(state); // Pass state to generateAuthUrl
      
      logger.info('Gmail OAuth flow initiated by user.', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        // Avoid logging the full state if it's sensitive or used for session linking directly.
        // statePreview: state.substring(0, 8) + '...',
      });

      // Client should store this state (e.g., in localStorage) and send it back during callback for verification.
      return successResponse(res, {
        authorizationUrl: authUrl,
        state: state, // Provide state to client for verification on callback
        requiredScopes: gmailConfig.getScopeDescriptions(), // Inform client about requested permissions
      }, 'Gmail authorization URL generated. Please redirect user.');
      
    } catch (error) {
      logger.error('Failed to initiate Gmail authentication flow:', { message: error.message, stack: error.stack });
      return errorResponse(res, 'Failed to initiate Gmail authentication. Please try again later.', 500);
    }
  });

  /**
   * Handles the callback from Gmail OAuth 2.0 flow.
   * Exchanges the authorization code for tokens, retrieves user info,
   * finds or creates a user in the database, and issues a JWT.
   * @method handleGmailCallback
   * @route GET /api/v1/auth/gmail/callback
   * @access Public
   * @param {import('express').Request} req - Express request object. Expects `code` and `state` in query parameters.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with user details and JWT, or an error.
   */
  handleGmailCallback = asyncHandler(async (req, res) => {
    try {
      const { code, state, error: oauthError, error_description: oauthErrorDescription } = req.query;

      // Handle OAuth errors reported by Google
      if (oauthError) {
        logger.warn('Gmail OAuth callback error reported by Google:', { oauthError, oauthErrorDescription, ip: req.ip });
        return errorResponse(res, `Gmail authentication failed: ${oauthErrorDescription || oauthError}`, 400);
      }

      // Validate state parameter (compare with the one stored in session or sent by client)
      // This is crucial for CSRF protection. Example:
      // if (!state || state !== req.session.oauthState) {
      //   logger.warn('Invalid OAuth state parameter.', { receivedState: state });
      //   return errorResponse(res, 'Invalid state parameter. Possible CSRF attempt.', 403);
      // }
      // delete req.session.oauthState; // Clean up state from session

      if (!code) {
        return errorResponse(res, 'Authorization code is missing in callback.', 400);
      }

      logger.info('Gmail OAuth callback received successfully.', { hasCode: !!code, hasState: !!state, ip: req.ip });

      const tokens = await gmailConfig.exchangeCodeForTokens(code);
      if (!tokens.access_token) { // Refresh token might not always be present on subsequent auths
        logger.error('Failed to obtain access token from Gmail.', { tokensReceived: Object.keys(tokens) });
        return errorResponse(res, 'Failed to obtain access token from Gmail.', 400);
      }
      if (!tokens.refresh_token) {
        logger.warn('Refresh token not received in this OAuth exchange. This is expected if user has previously authorized this app with offline access.');
      }


      const googleUserInfo = await gmailConfig.getUserInfo(tokens.access_token);
      if (!googleUserInfo.verified_email) {
        return errorResponse(res, 'Gmail account email is not verified. Please verify your email with Google.', 400);
      }

      let user = await User.findByEmail(googleUserInfo.email);
      const isNewUser = !user;
      
      if (isNewUser) {
        user = new User({
          email: googleUserInfo.email,
          name: googleUserInfo.name || 'User', // Default name if not provided
          avatar: googleUserInfo.avatar,
          isEmailVerified: true, // Email is verified by Google
        });
      }

      const providerData = {
        provider: 'google',
        providerId: googleUserInfo.id,
        email: googleUserInfo.email, // Store the email associated with this specific provider login
        accessToken: tokens.access_token,
        // Only update refresh token if a new one is provided by Google
        ...(tokens.refresh_token && { refreshToken: tokens.refresh_token }),
        tokenExpiry: new Date(tokens.expiry_date), // expiry_date is typically a timestamp in ms
        scopes: tokens.scope ? tokens.scope.split(' ') : gmailConfig.scopes, // Use scopes from token if available
        isActive: true,
        connectedAt: user.providers?.find(p=>p.provider==='google')?.connectedAt || new Date(), // Preserve original connection date if updating
      };

      await user.addProvider(providerData); // This method handles both add and update
      await user.updateLastLogin(); // Update last login timestamp

      const jwtToken = this.generateJWTToken(user);
      const jwtExpiresInMs = (parseInt(process.env.JWT_EXPIRES_IN_SECONDS, 10) || 7 * 24 * 60 * 60) * 1000;


      logger.info(`Gmail authentication successful for user: ${user.email}`, { userId: user._id, isNewUser });
      return successResponse(res, {
        user: user.toJSON(), // Ensure toJSON() is properly configured in User model
        token: jwtToken,
        tokenExpiresAt: new Date(Date.now() + jwtExpiresInMs).toISOString(),
        // grantedScopes: providerData.scopes, // Optionally inform client of granted scopes
      }, 'Gmail authentication successful. User session established.');

    } catch (error) {
      logger.error('Error during Gmail OAuth callback handling:', { message: error.message, stack: error.stack });
      return errorResponse(res, 'Gmail authentication process failed due to an internal error.', 500);
    }
  });

  /**
   * Retrieves information about the currently authenticated user.
   * @method getCurrentUser
   * @route GET /api/v1/auth/me
   * @access Private (Requires authentication via JWT)
   * @param {import('express').Request} req - Express request object, expects `req.user` to be populated by `authenticate` middleware.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with the current user's details.
   */
  getCurrentUser = asyncHandler(async (req, res) => {
    try {
      // req.user.id is populated by the 'authenticate' middleware
      const user = await User.findById(req.user.id);
      
      if (!user || !user.isActive) {
        return unauthorizedResponse(res, 'User not found, inactive, or token invalid.');
      }

      await user.updateLastLogin(); // Update last login time, non-critical if it fails

      return successResponse(res, {
        user: user.toJSON(), // Ensure sensitive data is stripped by toJSON in model
        // Provide a summary of connected providers for the client
        activeProviders: user.providers
          .filter(p => p.isActive)
          .map(p => ({
            provider: p.provider,
            email: p.email,
            connectedAt: p.connectedAt,
            lastSyncAt: p.lastSyncAt,
            isTokenExpired: user.isTokenExpired(p.provider, p.providerId) // Add token status
          })),
      }, 'Current user information retrieved successfully.');

    } catch (error) {
      logger.error('Error retrieving current user:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve user information.', 500);
    }
  });

  /**
   * Refreshes the Gmail access token for the authenticated user.
   * @method refreshGmailToken
   * @route POST /api/v1/auth/gmail/refresh
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response indicating success or failure of token refresh.
   */
  refreshGmailToken = asyncHandler(async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) return unauthorizedResponse(res, 'User not found.');

      const gmailProvider = user.getActiveProvider('google'); // Use method to get active Google provider
      if (!gmailProvider) {
        return errorResponse(res, 'No active Gmail account connected for this user.', 400);
      }
      if (!gmailProvider.refreshToken) {
         return errorResponse(res, 'Refresh token not available. User may need to re-authenticate.', 400);
      }

      // Even if not strictly expired by our check, attempt refresh if requested by client.
      // Or, only refresh if isTokenExpired is true:
      // if (!user.isTokenExpired('google', gmailProvider.providerId)) {
      //   return successResponse(res, { message: 'Token is still valid.', expiresAt: gmailProvider.tokenExpiry }, 'Gmail token is still valid.');
      // }

      const newTokens = await gmailConfig.refreshAccessToken(gmailProvider.refreshToken);
      if (!newTokens.access_token) {
        logger.error('Refresh token did not return a new access token.', { userId: user._id });
        return errorResponse(res, 'Failed to obtain new access token during refresh.', 500);
      }
      
      await user.updateProviderTokens('google', gmailProvider.providerId, newTokens);

      logger.info('Gmail access token refreshed successfully.', { userId: user._id });
      return successResponse(res, {
        message: 'Gmail token refreshed successfully.',
        newExpiry: new Date(newTokens.expiry_date).toISOString(), // expiry_date is a timestamp from google-auth-library
      }, 'Gmail token refreshed successfully.');

    } catch (error) {
      logger.error('Gmail token refresh process failed:', { message: error.message, userId: req.user?.id });
      // If refresh token is invalid (e.g., revoked by user), they need to re-authenticate.
      if (error.message.toLowerCase().includes('token has been expired or revoked')) {
         return errorResponse(res, 'Gmail refresh token is invalid. Please re-authenticate your Gmail account.', 401);
      }
      return errorResponse(res, 'Failed to refresh Gmail token.', 500);
    }
  });

  /**
   * Disconnects the user's Gmail account by revoking tokens and removing provider data.
   * @method disconnectGmail
   * @route DELETE /api/v1/auth/gmail/disconnect
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response indicating success or failure.
   */
  disconnectGmail = asyncHandler(async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) return unauthorizedResponse(res, 'User not found.');

      const gmailProvider = user.getActiveProvider('google');
      if (!gmailProvider) {
        return errorResponse(res, 'No active Gmail account is connected to disconnect.', 400);
      }

      // Attempt to revoke tokens with Google. This is best-effort.
      try {
        if (gmailProvider.accessToken) { // Some flows might not store accessToken if only refreshToken is used.
          await gmailConfig.revokeTokens(gmailProvider.accessToken); // Use accessToken for revocation
        } else if (gmailProvider.refreshToken) {
          // If only refresh token is available, some providers might allow revoking it directly
          // For Google, revoking an access token usually revokes the associated refresh token if from same grant.
          // If only refresh token is stored, direct revocation might be different or not supported via simple API.
          // As a fallback, we'll just remove it locally if access token is missing.
           logger.warn('Access token not available for revocation, attempting with refresh token or local removal only.', { userId: user._id });
           await gmailConfig.revokeTokens(gmailProvider.refreshToken); // Try with refresh token
        }
      } catch (revocationError) {
        logger.warn('Failed to revoke tokens with Google during disconnect. This might happen if tokens were already invalid.', {
          userId: user._id,
          errorMessage: revocationError.message,
        });
        // Proceed with local cleanup regardless of Google revocation status.
      }

      await user.removeProvider('google', gmailProvider.providerId);

      logger.info('Gmail account disconnected successfully.', { userId: user._id });
      return successResponse(res, null, 'Gmail account disconnected successfully.');

    } catch (error) {
      logger.error('Gmail disconnect process failed:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to disconnect Gmail account.', 500);
    }
  });

  /**
   * Retrieves the connection status for all OAuth providers linked to the user.
   * @method getConnections
   * @route GET /api/v1/auth/connections
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response with connection statuses.
   */
  getConnections = asyncHandler(async (req, res) => {
    try {
      const user = await User.findById(req.user.id);
      if (!user) return unauthorizedResponse(res, 'User not found.');

      const connections = user.providers.map(p => ({
        provider: p.provider,
        email: p.email,
        isConnected: p.isActive,
        connectedAt: p.connectedAt,
        lastSyncAt: p.lastSyncAt,
        isTokenExpired: user.isTokenExpired(p.provider, p.providerId),
        scopesGranted: p.scopes,
      }));
      // Example for a specific provider if needed directly
      // const gmailProvider = user.getActiveProvider('google');
      // const gmailStatus = { ... };

      return successResponse(res, { connections }, 'Connection statuses retrieved successfully.');

    } catch (error) {
      logger.error('Error retrieving connection statuses:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Failed to retrieve connection statuses.', 500);
    }
  });

  /**
   * Logs out the user.
   * For JWT-based auth, this is typically a client-side operation (deleting the token).
   * Server-side might involve token blacklisting if implemented.
   * @method logout
   * @route POST /api/v1/auth/logout
   * @access Private
   * @param {import('express').Request} req - Express request object.
   * @param {import('express').Response} res - Express response object.
   * @returns {Promise<void>} Sends a JSON response indicating successful logout.
   */
  logout = asyncHandler(async (req, res) => {
    try {
      // If using a token blacklist (e.g., with Redis), add the current token to it here.
      // Example: await TokenBlacklistService.add(req.token);
      // For simple JWT, logout is mainly a client-side responsibility.

      logger.info('User logout request processed.', { userId: req.user.id });
      return successResponse(res, null, 'Logout successful. Please clear your local token.');

    } catch (error) {
      logger.error('Logout process error:', { message: error.message, userId: req.user?.id });
      return errorResponse(res, 'Logout failed due to an internal error.', 500);
    }
  });

  /**
   * Generates a JWT (JSON Web Token) for a given user.
   * The token includes user's ID, email, and name.
   * @method generateJWTToken
   * @private
   * @param {User} user - The user object for whom to generate the token.
   * @returns {string} The generated JWT.
   */
  generateJWTToken(user) {
    const payload = {
      id: user._id.toString(), // Ensure ID is a string
      email: user.email,
      name: user.name,
      // role: user.role, // Optionally include role or other non-sensitive data
    };
    const secret = process.env.JWT_SECRET;
    const expiresIn = process.env.JWT_EXPIRES_IN_SECONDS ? `${process.env.JWT_EXPIRES_IN_SECONDS}s` : '7d';

    if (!secret) {
      logger.error('JWT_SECRET is not defined. Cannot sign tokens.');
      throw new Error('JWT signing error due to missing secret.');
    }

    return jwt.sign(payload, secret, { expiresIn });
  }

  /**
   * Verifies a JWT. (Primarily for internal use or testing, auth middleware handles verification for routes)
   * @method verifyJWTToken
   * @private
   * @param {string} token - The JWT to verify.
   * @returns {object} The decoded token payload if verification is successful.
   * @throws {Error} If the token is invalid or expired.
   */
  verifyJWTToken(token) {
    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) {
        logger.error('JWT_SECRET is not defined. Cannot verify tokens.');
        throw new Error('JWT verification error due to missing secret.');
      }
      return jwt.verify(token, secret);
    } catch (error) {
      logger.warn('JWT verification failed:', { tokenProvided: !!token, errorMessage: error.message });
      throw new Error(`Token verification failed: ${error.message}`);
    }
  }
}

module.exports = new AuthController();