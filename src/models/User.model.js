const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // Kept for potential future password use, though not used currently

/**
 * @file User Model
 * @module models/user
 * @requires mongoose
 * @requires bcryptjs
 */

/**
 * User Schema Definition.
 * Represents a user in the system, storing their profile, authentication provider details,
 * preferences, subscription status, and usage metrics.
 * @type {mongoose.Schema}
 */
const userSchema = new mongoose.Schema({
  // Basic user information
  /**
   * User's primary email address. Must be unique and valid.
   * @type {string}
   * @required
   */
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
  },
  /**
   * User's full name.
   * @type {string}
   * @required
   */
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters'],
  },
  /**
   * URL to the user's avatar image.
   * @type {string}
   */
  avatar: {
    type: String,
    default: null,
  },
  
  /**
   * Array of connected OAuth providers (e.g., Google).
   * @type {Array<object>}
   */
  providers: [{
    /** Name of the OAuth provider (e.g., 'google'). */
    provider: { type: String, enum: ['google', 'microsoft', 'yahoo'], required: true },
    /** User's unique ID from the provider. */
    providerId: { type: String, required: true },
    /** Email associated with this provider account. */
    email: { type: String, required: true },
    /** Encrypted access token for the provider. */
    accessToken: { type: String, required: true }, // Should be encrypted in a real app
    /** Encrypted refresh token for the provider (if applicable). */
    refreshToken: { type: String, required: true }, // Should be encrypted
    /** Expiry date of the access token. */
    tokenExpiry: { type: Date, required: true },
    /** Scopes granted by the user for this provider. */
    scopes: [{ type: String }],
    /** Whether this provider connection is currently active. */
    isActive: { type: Boolean, default: true },
    /** Date when this provider was connected. */
    connectedAt: { type: Date, default: Date.now },
    /** Date when data was last synced from this provider. */
    lastSyncAt: { type: Date, default: null },
  }],

  /**
   * User-specific preferences and settings.
   * @type {object}
   */
  preferences: {
    /** User's preferred timezone (e.g., 'America/New_York'). */
    timezone: { type: String, default: 'UTC' },
    /** Preferred time for receiving daily summaries (HH:MM format). */
    dailySummaryTime: { type: String, default: '08:00', match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format. Use HH:MM'] },
    /** Frequency of summary generation. */
    summaryFrequency: { type: String, enum: ['daily', 'weekly', 'on-demand'], default: 'daily' },
    /** Preferred language for summaries and communication. */
    language: { type: String, default: 'en' },
    /** Notification settings. */
    notifications: {
      email: { type: Boolean, default: true }, // General email notifications
      push: { type: Boolean, default: false }, // General push notifications
      dailySummary: { type: Boolean, default: true }, // Notification for daily summary
      urgentEmails: { type: Boolean, default: false }, // Notification for urgent emails
    },
  },

  /**
   * Account status fields.
   * @type {object}
   */
  // Overall account active status
  isActive: { type: Boolean, default: true },
  // Whether the primary email address has been verified
  isEmailVerified: { type: Boolean, default: false },
  // Timestamp of the last login
  lastLoginAt: { type: Date, default: null },
  // Counter for number of logins
  loginCount: { type: Number, default: 0 },
  
  /**
   * Subscription details for the user.
   * @type {object}
   */
  subscription: {
    /** Current subscription plan. */
    plan: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
    /** Status of the subscription. */
    status: { type: String, enum: ['active', 'inactive', 'trial', 'expired', 'cancelled', 'past_due'], default: 'active' },
    /** Date when the current subscription plan expires or renews. */
    expiresAt: { type: Date, default: null },
    // stripeCustomerId: { type: String, unique: true, sparse: true }, // Example for Stripe
    // stripeSubscriptionId: { type: String, unique: true, sparse: true }, // Example for Stripe
  },
  
  /**
   * Usage tracking for various features.
   * @type {object}
   */
  usage: {
    /** Number of emails processed for the user. */
    emailsProcessed: { type: Number, default: 0 },
    /** Number of summaries generated for the user. */
    summariesGenerated: { type: Number, default: 0 },
    /** Number of API calls made this billing cycle/month. */
    apiCallsThisMonth: { type: Number, default: 0 },
    /** Timestamp when monthly API call count was last reset. */
    lastResetAt: { type: Date, default: Date.now },
  },

}, {
  timestamps: true, // Automatically adds createdAt and updatedAt fields
  toJSON: { // Defines a transform function to customize the JSON output of User documents
    virtuals: true, // Ensure virtuals are included in toJSON output
    transform: function(doc, ret) {
      // Remove sensitive or internal fields from the output
      delete ret.__v; // Remove Mongoose version key
      // IMPORTANT: In a real application, accessTokens and refreshTokens should be encrypted at rest
      // and NEVER directly exposed like this, even if deleted here.
      // This transform is a last-line defense for accidental exposure, not a security measure.
      if (ret.providers) {
        ret.providers.forEach(provider => {
          delete provider.accessToken;  // Example: remove sensitive token
          delete provider.refreshToken; // Example: remove sensitive token
        });
      }
      return ret;
    },
  },
  toObject: { // Defines a transform function for converting to a plain JavaScript object
    virtuals: true, // Ensure virtuals are included in toObject output
  }
});

// ----- INDEXES -----
// Indexing improves query performance for common lookups.
userSchema.index({ email: 1 }, { unique: true }); // Ensure email is unique and indexed for fast lookup.
userSchema.index({ 'providers.provider': 1, 'providers.providerId': 1 }); // For finding users by OAuth provider ID.
userSchema.index({ 'providers.email': 1 }); // For finding users by email associated with an OAuth provider.
userSchema.index({ isActive: 1 }); // For querying active/inactive users.
userSchema.index({ createdAt: -1 }); // For sorting users by creation date.
userSchema.index({ 'subscription.plan': 1, 'subscription.status': 1 }); // For querying subscription status.

// ----- VIRTUALS -----
/**
 * Virtual property to get the primary active Gmail provider details.
 * @virtual gmailProvider
 * @returns {object|undefined} The active Gmail provider object, or undefined if not found.
 */
userSchema.virtual('gmailProvider').get(function() {
  if (!this.providers) return undefined;
  return this.providers.find(p => p.provider === 'google' && p.isActive);
});

// ----- INSTANCE METHODS -----

/**
 * Adds or updates an OAuth provider for the user.
 * @method addProvider
 * @param {object} providerData - Data for the provider (provider, providerId, email, tokens, etc.).
 * @returns {Promise<User>} The saved user document.
 */
userSchema.methods.addProvider = function(providerData) {
  const existingProviderIndex = this.providers.findIndex(
    p => p.provider === providerData.provider && p.providerId === providerData.providerId
  );

  if (existingProviderIndex !== -1) {
    // Update existing provider: merge new data, ensure critical fields are updated
    this.providers[existingProviderIndex] = {
      ...this.providers[existingProviderIndex],
      ...providerData,
      isActive: true, // Ensure it's active on update/reconnect
      connectedAt: this.providers[existingProviderIndex].connectedAt || new Date(), // Keep original connectedAt or set if new
      lastSyncAt: new Date(), // Update last sync time
    };
  } else {
    // Add new provider
    this.providers.push({ ...providerData, isActive: true, connectedAt: new Date(), lastSyncAt: new Date() });
  }
  
  // If adding/updating Google provider, mark email as verified
  if (providerData.provider === 'google') {
    this.isEmailVerified = true;
  }
  return this.save();
};

/**
 * Removes an OAuth provider from the user's profile.
 * @method removeProvider
 * @param {string} providerName - The name of the provider (e.g., 'google').
 * @param {string} providerId - The provider-specific user ID.
 * @returns {Promise<User>} The saved user document.
 */
userSchema.methods.removeProvider = function(providerName, providerId) {
  this.providers = this.providers.filter(
    p => !(p.provider === providerName && p.providerId === providerId)
  );
  // Optionally, if no 'google' provider remains, set isEmailVerified to false,
  // or handle based on other verification methods if they exist.
  return this.save();
};

/**
 * Retrieves an active OAuth provider by name.
 * @method getActiveProvider
 * @param {string} providerName - The name of the provider.
 * @returns {object|undefined} The provider object if found and active, otherwise undefined.
 */
userSchema.methods.getActiveProvider = function(providerName) {
  if (!this.providers) return undefined;
  return this.providers.find(p => p.provider === providerName && p.isActive);
};

/**
 * Updates the tokens for a specific OAuth provider.
 * @method updateProviderTokens
 * @param {string} providerName - The name of the provider.
 * @param {string} providerId - The provider-specific user ID.
 * @param {object} tokens - Object containing new tokens (e.g., access_token, refresh_token, expires_in).
 * @returns {Promise<User>} The saved user document.
 * @throws {Error} If the provider is not found.
 */
userSchema.methods.updateProviderTokens = function(providerName, providerId, tokens) {
  const providerData = this.providers.find(
    p => p.provider === providerName && p.providerId === providerId
  );
  
  if (providerData) {
    providerData.accessToken = tokens.access_token;
    if (tokens.refresh_token) { // Refresh token might not always be returned
      providerData.refreshToken = tokens.refresh_token;
    }
    providerData.tokenExpiry = new Date(Date.now() + (tokens.expires_in * 1000)); // expires_in is in seconds
    providerData.lastSyncAt = new Date(); // Update sync time on token refresh
    return this.save();
  }
  
  throw new Error(`Provider '${providerName}' with ID '${providerId}' not found for this user.`);
};

/**
 * Checks if the access token for a specific provider is expired.
 * @method isTokenExpired
 * @param {string} providerName - The name of the provider.
 * @param {string} providerId - The provider-specific user ID.
 * @returns {boolean} True if token is expired or provider not found, false otherwise.
 */
userSchema.methods.isTokenExpired = function(providerName, providerId) {
  const providerData = this.providers.find(
    p => p.provider === providerName && p.providerId === providerId
  );
  
  if (!providerData || !providerData.tokenExpiry) return true; // Assume expired if no data or no expiry
  
  // Add a small buffer (e.g., 5 minutes) to consider token expired slightly before actual expiry
  const bufferMs = 5 * 60 * 1000;
  return new Date() >= new Date(providerData.tokenExpiry.getTime() - bufferMs);
};

/**
 * Increments a specific usage counter for the user.
 * @method incrementUsage
 * @param {('emailsProcessed'|'summariesGenerated'|'apiCallsThisMonth')} type - The type of usage to increment.
 * @param {number} [count=1] - The amount to increment by.
 * @returns {Promise<User>} The saved user document.
 */
userSchema.methods.incrementUsage = function(type, count = 1) {
  if (this.usage && typeof this.usage[type] === 'number') {
    this.usage[type] += count;
  } else {
    // Initialize if type doesn't exist, though schema defines defaults
    this.usage = this.usage || {};
    this.usage[type] = count;
    logger.warn(`Usage type '${type}' was not initialized for user ${this.id}. Initializing now.`);
  }
  return this.save();
};

/**
 * Resets the monthly API call usage counter.
 * @method resetMonthlyUsage
 * @returns {Promise<User>} The saved user document.
 */
userSchema.methods.resetMonthlyUsage = function() {
  if (this.usage) {
    this.usage.apiCallsThisMonth = 0;
    this.usage.lastResetAt = new Date();
  }
  return this.save();
};

/**
 * Updates the last login timestamp and increments login count.
 * @method updateLastLogin
 * @returns {Promise<User>} The saved user document.
 */
userSchema.methods.updateLastLogin = function() {
  this.lastLoginAt = new Date();
  this.loginCount = (this.loginCount || 0) + 1;
  return this.save();
};

// ----- STATIC METHODS -----
// Static methods are called on the User model itself (e.g., User.findByEmail()).

/**
 * Finds a user by their primary email address.
 * @static findByEmail
 * @param {string} email - The email address to search for.
 * @returns {Promise<User|null>} The user document if found, otherwise null.
 */
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase().trim() });
};

/**
 * Finds a user by their OAuth provider and provider-specific ID.
 * @static findByProvider
 * @param {string} providerName - The name of the OAuth provider.
 * @param {string} providerId - The provider-specific user ID.
 * @returns {Promise<User|null>} The user document if found, otherwise null.
 */
userSchema.statics.findByProvider = function(providerName, providerId) {
  return this.findOne({
    'providers.provider': providerName,
    'providers.providerId': providerId,
  });
};

/**
 * Finds all active users.
 * @static findActiveUsers
 * @returns {Promise<Array<User>>} A promise that resolves to an array of active user documents.
 */
userSchema.statics.findActiveUsers = function() {
  return this.find({ isActive: true });
};

// ----- MIDDLEWARE (HOOKS) -----
// Mongoose middleware (also called pre and post hooks) are functions which are passed control during execution of asynchronous functions.

/**
 * Pre-save middleware for the User schema.
 * - Automatically sets `isEmailVerified` to true if the user has any active OAuth provider (especially Google).
 * - Resets `apiCallsThisMonth` if a month has passed since `lastResetAt`.
 * @listens Mongoose#save:pre
 * @param {import('express').NextFunction} next - Callback to continue the save operation.
 */
userSchema.pre('save', async function(next) {
  // If modified, and a password field existed, this is where bcrypt hashing would go:
  // if (this.isModified('password') && this.password) {
  //   const salt = await bcrypt.genSalt(10);
  //   this.password = await bcrypt.hash(this.password, salt);
  // }

  // Set email as verified if user has an active Google provider, or any provider if that's the policy.
  if (this.isModified('providers') || this.isNew) {
    const hasActiveGoogleProvider = this.providers.some(p => p.provider === 'google' && p.isActive);
    if (hasActiveGoogleProvider) {
      this.isEmailVerified = true;
    }
  }
  
  // Reset monthly usage if needed (check if a calendar month has passed)
  if (this.usage && this.usage.lastResetAt) {
    const now = new Date();
    const lastReset = new Date(this.usage.lastResetAt);
    // Check if the current month is different from the last reset month, or if a year has passed.
    if (now.getUTCMonth() !== lastReset.getUTCMonth() || now.getUTCFullYear() !== lastReset.getUTCFullYear()) {
      this.usage.apiCallsThisMonth = 0;
      this.usage.lastResetAt = now; // Set to the beginning of the current month for consistency
      logger.info(`Monthly API usage reset for user ${this.id}`);
    }
  }
  
  next();
});

/**
 * Pre-remove middleware for the User schema.
 * Cleans up related data (Personas, Emails, Summaries) when a user is deleted.
 * @listens Mongoose#remove:pre
 * @param {import('express').NextFunction} next - Callback to continue the remove operation.
 */
userSchema.pre('remove', async function(next) {
  logger.info(`Preparing to remove user ${this._id} and their associated data.`);
  try {
    // Dynamically access models to avoid circular dependency issues at module load time.
    await mongoose.model('Persona').deleteMany({ userId: this._id });
    await mongoose.model('Email').deleteMany({ userId: this._id });
    await mongoose.model('Summary').deleteMany({ userId: this._id });
    logger.info(`Successfully removed associated data for user ${this._id}.`);
    next();
  } catch (error) {
    logger.error(`Error cleaning up data for user ${this._id}:`, error);
    next(error); // Pass error to stop removal if cleanup fails critically
  }
});

const User = mongoose.model('User', userSchema);

module.exports = User;