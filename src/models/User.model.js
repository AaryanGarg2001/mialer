const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // Basic user information
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email'],
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [100, 'Name cannot exceed 100 characters'],
  },
  avatar: {
    type: String,
    default: null,
  },
  
  // OAuth provider information
  providers: [{
    provider: {
      type: String,
      enum: ['google', 'microsoft', 'yahoo'],
      required: true,
    },
    providerId: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    accessToken: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
    },
    tokenExpiry: {
      type: Date,
      required: true,
    },
    scopes: [{
      type: String,
    }],
    isActive: {
      type: Boolean,
      default: true,
    },
    connectedAt: {
      type: Date,
      default: Date.now,
    },
    lastSyncAt: {
      type: Date,
      default: null,
    },
  }],

  // User preferences and settings
  preferences: {
    timezone: {
      type: String,
      default: 'UTC',
    },
    dailySummaryTime: {
      type: String,
      default: '08:00',
      match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format. Use HH:MM'],
    },
    summaryFrequency: {
      type: String,
      enum: ['daily', 'weekly', 'on-demand'],
      default: 'daily',
    },
    language: {
      type: String,
      default: 'en',
    },
    notifications: {
      email: {
        type: Boolean,
        default: true,
      },
      push: {
        type: Boolean,
        default: false,
      },
      dailySummary: {
        type: Boolean,
        default: true,
      },
      urgentEmails: {
        type: Boolean,
        default: false,
      },
    },
  },

  // Account status and metadata
  isActive: {
    type: Boolean,
    default: true,
  },
  isEmailVerified: {
    type: Boolean,
    default: false,
  },
  lastLoginAt: {
    type: Date,
    default: null,
  },
  loginCount: {
    type: Number,
    default: 0,
  },
  
  // Subscription and usage tracking
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'pro', 'enterprise'],
      default: 'free',
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'trial', 'expired'],
      default: 'active',
    },
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  
  usage: {
    emailsProcessed: {
      type: Number,
      default: 0,
    },
    summariesGenerated: {
      type: Number,
      default: 0,
    },
    apiCallsThisMonth: {
      type: Number,
      default: 0,
    },
    lastResetAt: {
      type: Date,
      default: Date.now,
    },
  },

}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      // Remove sensitive information when converting to JSON
      delete ret.__v;
      if (ret.providers) {
        ret.providers.forEach(provider => {
          delete provider.accessToken;
          delete provider.refreshToken;
        });
      }
      return ret;
    },
  },
});

// Indexes for better performance
userSchema.index({ email: 1 });
userSchema.index({ 'providers.provider': 1, 'providers.providerId': 1 });
userSchema.index({ 'providers.email': 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ createdAt: -1 });

// Virtual for getting the primary Gmail provider
userSchema.virtual('gmailProvider').get(function() {
  return this.providers.find(p => p.provider === 'google' && p.isActive);
});

// Instance methods
userSchema.methods.addProvider = function(providerData) {
  // Check if provider already exists
  const existingProvider = this.providers.find(
    p => p.provider === providerData.provider && p.providerId === providerData.providerId
  );

  if (existingProvider) {
    // Update existing provider
    Object.assign(existingProvider, providerData);
  } else {
    // Add new provider
    this.providers.push(providerData);
  }
  
  return this.save();
};

userSchema.methods.removeProvider = function(provider, providerId) {
  this.providers = this.providers.filter(
    p => !(p.provider === provider && p.providerId === providerId)
  );
  return this.save();
};

userSchema.methods.getActiveProvider = function(provider) {
  return this.providers.find(p => p.provider === provider && p.isActive);
};

userSchema.methods.updateProviderTokens = function(provider, providerId, tokens) {
  const providerData = this.providers.find(
    p => p.provider === provider && p.providerId === providerId
  );
  
  if (providerData) {
    providerData.accessToken = tokens.access_token;
    if (tokens.refresh_token) {
      providerData.refreshToken = tokens.refresh_token;
    }
    providerData.tokenExpiry = new Date(Date.now() + (tokens.expires_in * 1000));
    return this.save();
  }
  
  throw new Error('Provider not found');
};

userSchema.methods.isTokenExpired = function(provider, providerId) {
  const providerData = this.providers.find(
    p => p.provider === provider && p.providerId === providerId
  );
  
  if (!providerData) return true;
  
  return new Date() >= providerData.tokenExpiry;
};

userSchema.methods.incrementUsage = function(type, count = 1) {
  if (!this.usage[type]) return;
  
  this.usage[type] += count;
  return this.save();
};

userSchema.methods.resetMonthlyUsage = function() {
  this.usage.apiCallsThisMonth = 0;
  this.usage.lastResetAt = new Date();
  return this.save();
};

userSchema.methods.updateLastLogin = function() {
  this.lastLoginAt = new Date();
  this.loginCount += 1;
  return this.save();
};

// Static methods
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: email.toLowerCase() });
};

userSchema.statics.findByProvider = function(provider, providerId) {
  return this.findOne({
    'providers.provider': provider,
    'providers.providerId': providerId,
  });
};

userSchema.statics.findActiveUsers = function() {
  return this.find({ isActive: true });
};

// Pre-save middleware
userSchema.pre('save', async function(next) {
  // Set email as verified if user has active OAuth provider
  if (this.providers && this.providers.length > 0) {
    this.isEmailVerified = true;
  }
  
  // Reset monthly usage if needed (check if a month has passed)
  const now = new Date();
  const lastReset = this.usage.lastResetAt;
  const monthsDiff = (now.getFullYear() - lastReset.getFullYear()) * 12 + 
                    (now.getMonth() - lastReset.getMonth());
  
  if (monthsDiff >= 1) {
    this.usage.apiCallsThisMonth = 0;
    this.usage.lastResetAt = now;
  }
  
  next();
});

// Pre-remove middleware
userSchema.pre('remove', async function(next) {
  // Clean up related data when user is deleted
  try {
    // Remove personas
    await mongoose.model('Persona').deleteMany({ userId: this._id });
    // Remove emails
    await mongoose.model('Email').deleteMany({ userId: this._id });
    // Remove summaries
    await mongoose.model('Summary').deleteMany({ userId: this._id });
    next();
  } catch (error) {
    next(error);
  }
});

const User = mongoose.model('User', userSchema);

module.exports = User;