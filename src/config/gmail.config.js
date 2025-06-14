const { google } = require('googleapis');
const logger = require('../utils/logger');

class GmailConfig {
  constructor() {
    this.clientId = process.env.GOOGLE_CLIENT_ID;
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    this.redirectUri = process.env.GOOGLE_REDIRECT_URI;
    
    // Required scopes for Gmail access
    this.scopes = [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ];

    // Validate configuration on initialization
    this.validateConfig();
  }

  validateConfig() {
    const requiredEnvVars = [
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET', 
      'GOOGLE_REDIRECT_URI'
    ];

    const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    if (missing.length > 0) {
      logger.error('Missing Gmail configuration:', { missing });
      throw new Error(`Missing required Gmail environment variables: ${missing.join(', ')}`);
    }

    logger.info('Gmail configuration validated successfully');
  }

  /**
   * Create OAuth2 client instance
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
      logger.error('Failed to create OAuth2 client:', error);
      throw new Error('Gmail OAuth2 client initialization failed');
    }
  }

  /**
   * Generate authorization URL
   */
  generateAuthUrl(state = null) {
    try {
      const oauth2Client = this.createOAuth2Client();
      
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // Required for refresh token
        prompt: 'consent', // Force consent screen to get refresh token
        scope: this.scopes,
        state: state, // Optional state parameter for CSRF protection
        include_granted_scopes: true,
      });

      logger.info('Generated Gmail authorization URL');
      return authUrl;
    } catch (error) {
      logger.error('Failed to generate Gmail auth URL:', error);
      throw new Error('Failed to generate Gmail authorization URL');
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code) {
    try {
      const oauth2Client = this.createOAuth2Client();
      
      const { tokens } = await oauth2Client.getToken(code);
      
      logger.info('Successfully exchanged code for tokens', {
        hasAccessToken: !!tokens.access_token,
        hasRefreshToken: !!tokens.refresh_token,
        expiresIn: tokens.expires_in,
      });

      return tokens;
    } catch (error) {
      logger.error('Failed to exchange code for tokens:', error);
      throw new Error('Failed to exchange authorization code for tokens');
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken) {
    try {
      const oauth2Client = this.createOAuth2Client();
      oauth2Client.setCredentials({
        refresh_token: refreshToken,
      });

      const { credentials } = await oauth2Client.refreshAccessToken();
      
      logger.info('Successfully refreshed access token');
      return credentials;
    } catch (error) {
      logger.error('Failed to refresh access token:', error);
      throw new Error('Failed to refresh access token');
    }
  }

  /**
   * Get user info from Google
   */
  async getUserInfo(accessToken) {
    try {
      const oauth2Client = this.createOAuth2Client();
      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();

      logger.info('Retrieved user info from Google', {
        email: data.email,
        hasName: !!data.name,
        hasAvatar: !!data.picture,
      });

      return {
        id: data.id,
        email: data.email,
        name: data.name,
        avatar: data.picture,
        verified_email: data.verified_email,
      };
    } catch (error) {
      logger.error('Failed to get user info:', error);
      throw new Error('Failed to retrieve user information from Google');
    }
  }

  /**
   * Create Gmail API client with user credentials
   */
  createGmailClient(accessToken, refreshToken) {
    try {
      const oauth2Client = this.createOAuth2Client();
      oauth2Client.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      
      return gmail;
    } catch (error) {
      logger.error('Failed to create Gmail client:', error);
      throw new Error('Failed to create Gmail API client');
    }
  }

  /**
   * Validate access token
   */
  async validateAccessToken(accessToken) {
    try {
      const oauth2Client = this.createOAuth2Client();
      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      const tokenInfo = await oauth2Client.getAccessToken();
      return !!tokenInfo.token;
    } catch (error) {
      logger.warn('Access token validation failed:', error.message);
      return false;
    }
  }

  /**
   * Revoke tokens (disconnect account)
   */
  async revokeTokens(accessToken) {
    try {
      const oauth2Client = this.createOAuth2Client();
      oauth2Client.setCredentials({
        access_token: accessToken,
      });

      await oauth2Client.revokeCredentials();
      logger.info('Successfully revoked Gmail tokens');
      
      return true;
    } catch (error) {
      logger.error('Failed to revoke Gmail tokens:', error);
      throw new Error('Failed to revoke Gmail access');
    }
  }

  /**
   * Get scope descriptions for user-friendly display
   */
  getScopeDescriptions() {
    return {
      'https://www.googleapis.com/auth/gmail.readonly': 'Read your Gmail messages and settings',
      'https://www.googleapis.com/auth/gmail.modify': 'Manage your Gmail messages (mark as read/unread, add labels)',
      'https://www.googleapis.com/auth/userinfo.email': 'View your email address',
      'https://www.googleapis.com/auth/userinfo.profile': 'View your basic profile information',
    };
  }

  /**
   * Check if all required scopes are granted
   */
  validateScopes(grantedScopes) {
    const requiredScopes = new Set(this.scopes);
    const granted = new Set(grantedScopes);
    
    for (const scope of requiredScopes) {
      if (!granted.has(scope)) {
        logger.warn('Missing required scope:', scope);
        return false;
      }
    }
    
    return true;
  }
}

module.exports = new GmailConfig();