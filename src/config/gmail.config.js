const { google } = require('googleapis');
const logger = require('../utils/logger');

/**
 * @file Gmail API Configuration and Authentication
 * @module config/gmail
 * @requires googleapis
 * @requires ../utils/logger
 */

/**
 * Manages Gmail API client configuration, OAuth2 authentication, and token handling.
 * Reads Google OAuth2 credentials from environment variables.
 * @class GmailConfig
 */
class GmailConfig {
  /**
   * Initializes the GmailConfig instance.
   * Sets Google OAuth2 client ID, client secret, redirect URI, and scopes.
   * Validates the presence of required environment variables.
   * @constructor
   */
  constructor() {
    /** @member {string} clientId - Google OAuth2 Client ID. */
    this.clientId = process.env.GOOGLE_CLIENT_ID;
    /** @member {string} clientSecret - Google OAuth2 Client Secret. */
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    /** @member {string} redirectUri - Google OAuth2 Redirect URI. */
    this.redirectUri = process.env.GOOGLE_REDIRECT_URI;
    
    /** @member {string[]} scopes - Array of scopes required for Gmail API access. */
    this.scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',    // View your messages and settings
      'https://www.googleapis.com/auth/gmail.modify',     // Modify your messages (e.g., mark as read/unread, archive)
      'https://www.googleapis.com/auth/userinfo.email',   // View your email address
      'https://www.googleapis.com/auth/userinfo.profile', // View your basic profile info
    ];

    // Validate configuration on initialization
    this.validateConfig();
  }

  /**
   * Validates that all required Google OAuth2 environment variables are set.
   * Throws an error if any required variable is missing.
   * @private
   */
  validateConfig() {
    const requiredEnvVars = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET', 
      'GOOGLE_REDIRECT_URI'
    ];

    const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missing.length > 0) {
      const errorMessage = `Missing required Gmail environment variables: ${missing.join(', ')}. Please check your .env file.`;
      logger.error('Gmail configuration validation failed:', { missing });
      throw new Error(errorMessage);
    }

    logger.info('Gmail configuration validated successfully.');
  }

  /**
   * Creates and returns a Google OAuth2 client instance.
   * @returns {import('google-auth-library').OAuth2Client} Configured OAuth2 client.
   * @throws {Error} If client creation fails.
   */
  createOAuth2Client() {
    try {
      const oauth2Client = new google.auth.OAuth2(
        this.clientId,
        this.clientSecret,
        this.redirectUri
      );
      return oauth2Client;
    } catch (error) {
      logger.error('Failed to create Google OAuth2 client:', { message: error.message, stack: error.stack });
      throw new Error('Gmail OAuth2 client initialization failed. Check credentials and configuration.');
    }
  }

  /**
   * Generates a Google OAuth2 authorization URL.
   * This URL is used to initiate the consent flow for users.
   * @param {string} [state=null] - Optional state parameter for CSRF protection or redirect tracking.
   * @returns {string} The generated authorization URL.
   * @throws {Error} If URL generation fails.
   */
  generateAuthUrl(state = null) {
    try {
      const oauth2Client = this.createOAuth2Client();
      
      const authUrlOptions = {
        access_type: 'offline', // Required to obtain a refresh token
        prompt: 'consent',      // Ensures the consent screen is shown, vital for getting a refresh token on first auth
        scope: this.scopes,
        include_granted_scopes: true, // Useful for incremental auth, though prompt:consent usually re-requests all
      };
      if (state) {
        authUrlOptions.state = state;
      }

      const authUrl = oauth2Client.generateAuthUrl(authUrlOptions);

      logger.info('Generated Gmail authorization URL successfully.');
      return authUrl;
    } catch (error) {
      logger.error('Failed to generate Gmail auth URL:', { message: error.message, stack: error.stack });
      throw new Error('Failed to generate Gmail authorization URL.');
    }
  }

  /**
   * Exchanges an authorization code (obtained from user consent) for access and refresh tokens.
   * @async
   * @param {string} code - The authorization code.
   * @returns {Promise<import('google-auth-library').Credentials>} Object containing access_token, refresh_token, expiry_date, etc.
   * @throws {Error} If token exchange fails.
   */
  async exchangeCodeForTokens(code) {
    try {
      const oauth2Client = this.createOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);
      
      if (!tokens.refresh_token) {
        logger.warn('Refresh token not received. This might happen if it is not the first time the user grants consent or if prompt:consent was not used.');
      }
      logger.info('Successfully exchanged authorization code for tokens.', {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token, // Log if refresh token was received
        expiresIn: tokens.expiry_date, // Log expiry
      });

      return tokens;
    } catch (error) {
      logger.error('Failed to exchange authorization code for tokens:', { message: error.message, stack: error.stack, codeUsed: code ? 'yes' : 'no' });
      throw new Error('Failed to exchange authorization code for tokens. The code might be invalid or expired.');
    }
  }

  /**
   * Refreshes an expired access token using a refresh token.
   * @async
   * @param {string} refreshToken - The refresh token.
   * @returns {Promise<import('google-auth-library').Credentials>} New credentials, including a new access_token.
   * @throws {Error} If token refresh fails (e.g., refresh token revoked or invalid).
   */
  async refreshAccessToken(refreshToken) {
    if (!refreshToken) {
      logger.error('refreshAccessToken called without a refreshToken.');
      throw new Error('Refresh token is required to refresh the access token.');
    }
    try {
      const oauth2Client = this.createOAuth2Client();
      oauth2Client.setCredentials({ refresh_token: refreshToken });

      const { credentials } = await oauth2Client.refreshAccessToken(); // `credentials` contains the new access_token
      
      logger.info('Successfully refreshed Google access token.');
      return credentials; // Contains new access_token, potentially new expiry_date
    } catch (error) {
      logger.error('Failed to refresh Google access token:', { message: error.message, stack: error.stack, refreshTokenUsed: refreshToken ? 'yes' : 'no' });
      // Common errors include 'invalid_grant' if the refresh token is revoked or expired.
      throw new Error('Failed to refresh access token. The refresh token might be invalid or revoked.');
    }
  }

  /**
   * Retrieves user profile information from Google using an access token.
   * @async
   * @param {string} accessToken - The user's access token.
   * @returns {Promise<object>} User profile data (id, email, name, avatar, verified_email).
   * @throws {Error} If fetching user info fails.
   */
  async getUserInfo(accessToken) {
    if (!accessToken) {
      logger.error('getUserInfo called without an accessToken.');
      throw new Error('Access token is required to get user info.');
    }
    try {
      const oauth2Client = this.createOAuth2Client();
      oauth2Client.setCredentials({ access_token: accessToken });

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();

      logger.info('Retrieved user info from Google successfully.', {
        email: data.email, // For logging privacy, consider logging only data.id or a hash
        userId: data.id,
      });

      return {
        id: data.id,
        email: data.email,
        name: data.name,
        avatar: data.picture,
        verified_email: data.verified_email,
      };
    } catch (error) {
      logger.error('Failed to get user info from Google:', { message: error.message, stack: error.stack });
      throw new Error('Failed to retrieve user information from Google. The access token might be invalid or expired.');
    }
  }

  /**
   * Creates a Gmail API client instance, authenticated with the user's tokens.
   * @param {string} accessToken - The user's access token.
   * @param {string} [refreshToken] - Optional. The user's refresh token. Recommended for long-lived access.
   * @returns {import('googleapis').gmail_v1.Gmail} Authenticated Gmail API client.
   * @throws {Error} If client creation fails.
   */
  createGmailClient(accessToken, refreshToken) {
    if (!accessToken) {
      logger.error('createGmailClient called without an accessToken.');
      throw new Error('Access token is required to create Gmail client.');
    }
    try {
      const oauth2Client = this.createOAuth2Client();
      const credentials = { access_token: accessToken };
      if (refreshToken) {
        credentials.refresh_token = refreshToken;
      }
      oauth2Client.setCredentials(credentials);

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      
      logger.debug('Gmail API client created successfully.');
      return gmail;
    } catch (error) {
      logger.error('Failed to create Gmail API client:', { message: error.message, stack: error.stack });
      throw new Error('Failed to create Gmail API client.');
    }
  }

  /**
   * Validates an access token by attempting to retrieve token information.
   * @async
   * @param {string} accessToken - The access token to validate.
   * @returns {Promise<boolean>} True if the token is valid, false otherwise.
   */
  async validateAccessToken(accessToken) {
    if (!accessToken) return false;
    try {
      const oauth2Client = this.createOAuth2Client();
      // No need to set credentials here, getAccessTokenInfo is a method of google.auth.OAuth2
      const tokenInfo = await oauth2Client.getTokenInfo(accessToken);
      // A valid token will return info like expiry_date, scope, etc.
      // An expired or invalid token will throw an error.
      return !!tokenInfo && !!tokenInfo.expiry_date && tokenInfo.expiry_date > Date.now();
    } catch (error) {
      logger.warn('Google access token validation failed:', { message: error.message });
      return false;
    }
  }

  /**
   * Revokes all tokens (access and refresh) associated with the provided access token.
   * This effectively disconnects the application from the user's Google account.
   * @async
   * @param {string} accessToken - The user's access token whose associated tokens should be revoked.
   * @returns {Promise<boolean>} True if revocation was successful.
   * @throws {Error} If token revocation fails.
   */
  async revokeTokens(accessToken) {
    if (!accessToken) {
      logger.error('revokeTokens called without an accessToken.');
      throw new Error('Access token is required to revoke credentials.');
    }
    try {
      const oauth2Client = this.createOAuth2Client();
      // It's more robust to revoke using the token itself, rather than just setting it on the client.
      // The `revokeToken` method is appropriate here.
      await oauth2Client.revokeToken(accessToken);
      logger.info('Successfully revoked Gmail tokens.');
      return true;
    } catch (error) {
      logger.error('Failed to revoke Gmail tokens:', { message: error.message, stack: error.stack });
      // Error might occur if the token is already invalid or other issues.
      throw new Error('Failed to revoke Gmail access. The token might already be invalid.');
    }
  }

  /**
   * Provides a map of OAuth scopes to user-friendly descriptions.
   * Useful for displaying consent information to users.
   * @returns {object<string, string>} A map where keys are scope URLs and values are their descriptions.
   */
  getScopeDescriptions() {
    return {
      'https://www.googleapis.com/auth/gmail.readonly': 'Read your Gmail messages and settings.',
      'https://www.googleapis.com/auth/gmail.modify': 'Manage your Gmail messages (e.g., mark as read/unread, archive).',
      'https://www.googleapis.com/auth/userinfo.email': 'View your email address.',
      'https://www.googleapis.com/auth/userinfo.profile': 'View your basic profile information (name, picture).',
    };
  }

  /**
   * Validates if a list of granted scopes includes all scopes required by this configuration.
   * @param {string[]} grantedScopes - An array of scopes granted by the user.
   * @returns {boolean} True if all required scopes are present, false otherwise.
   */
  validateScopes(grantedScopes) {
    if (!grantedScopes || grantedScopes.length === 0) return false;

    const requiredScopesSet = new Set(this.scopes);
    const grantedScopesSet = new Set(grantedScopes);
    
    for (const scope of requiredScopesSet) {
      if (!grantedScopesSet.has(scope)) {
        logger.warn('Scope validation failed: Missing required scope.', { missingScope: scope });
        return false;
      }
    }
    logger.info('All required scopes are present.');
    return true;
  }
}

module.exports = new GmailConfig();