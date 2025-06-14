const mongoose = require('mongoose');
const logger = require('../utils/logger'); // Assuming logger is available

/**
 * @file Persona Model
 * @module models/persona
 * @requires mongoose
 * @requires ../utils/logger
 */

/**
 * Persona Schema Definition.
 * Represents a user's persona, defining their preferences for email filtering,
 * summarization style, and other AI interactions. Each user has one persona.
 * @type {mongoose.Schema}
 */
const personaSchema = new mongoose.Schema({
  /** ID of the user this persona belongs to. Unique link to a User. */
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Reference to the User model
    required: [true, 'User ID is required for a persona.'],
    unique: true, // Each user can only have one persona document
    index: true,
  },

  // ----- Basic Persona Information -----
  /** User's professional role (e.g., 'Software Engineer', 'Product Manager'). */
  role: { type: String, trim: true, maxlength: [100, 'Role cannot exceed 100 characters.'] },
  /** Company the user works for. */
  company: { type: String, trim: true, maxlength: [100, 'Company name cannot exceed 100 characters.'] },
  /** Department the user works in. */
  department: { type: String, trim: true, maxlength: [100, 'Department name cannot exceed 100 characters.'] },

  // ----- Email Prioritization Preferences -----
  /** List of email addresses or names considered important contacts. */
  importantContacts: [{ type: String, trim: true, lowercase: true, maxlength: 200 }],
  /** List of domains considered important (e.g., 'mycompany.com'). */
  importantDomains: [{ type: String, trim: true, lowercase: true, maxlength: 100 }],
  /** Keywords that indicate an email's importance or relevance. */
  keywords: [{ type: String, trim: true, lowercase: true, maxlength: 50 }],
  /** Topics or areas of interest for the user. */
  interests: [{ type: String, trim: true, lowercase: true, maxlength: 50 }],

  // ----- Summary Preferences -----
  /** Preferred style for generated summaries. */
  summaryStyle: { type: String, enum: ['brief', 'detailed', 'action-focused', 'balanced'], default: 'balanced' },
  /** Preferred length for generated summaries. */
  summaryLength: { type: String, enum: ['short', 'medium', 'long'], default: 'medium' },
  /** Specific areas to focus on during summarization. */
  focusAreas: [{ type: String, enum: ['deadlines', 'meetings', 'tasks', 'updates', 'decisions', 'approvals'] }],

  // ----- Email Categorization Preferences -----
  /** User-defined priorities and keywords for different email categories. */
  emailCategories: {
    work: {
      priority: { type: Number, min: 1, max: 5, default: 5 }, // 5 = highest priority
      keywords: [{ type: String, trim: true, lowercase: true, maxlength: 50 }],
    },
    personal: {
      priority: { type: Number, min: 1, max: 5, default: 3 },
      keywords: [{ type: String, trim: true, lowercase: true, maxlength: 50 }],
    },
    newsletters: {
      priority: { type: Number, min: 1, max: 5, default: 1 },
      keywords: [{ type: String, trim: true, lowercase: true, maxlength: 50 }],
    },
    social: {
      priority: { type: Number, min: 1, max: 5, default: 2 },
      keywords: [{ type: String, trim: true, lowercase: true, maxlength: 50 }],
    },
    promotions: {
      priority: { type: Number, min: 1, max: 5, default: 1 },
      keywords: [{ type: String, trim: true, lowercase: true, maxlength: 50 }],
    },
    // Users might be able to add custom categories in the future.
  },

  // ----- Scheduling Preferences (Overrides global user preferences if set) -----
  /** Preferred time for receiving daily summaries (HH:MM format), specific to this persona. */
  dailySummaryTime: { type: String, default: '08:00', match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format. Use HH:MM.'] },
  /** Timezone for persona-specific scheduling. */
  timezone: { type: String, default: 'UTC' }, // Should ideally be validated against a list of valid timezones

  // ----- Advanced Filtering Preferences -----
  /** List of patterns (keywords, phrases) to exclude emails from summarization. */
  excludePatterns: [{ type: String, trim: true, lowercase: true, maxlength: 100 }],
  /** Minimum length (in characters) an email body must have to be considered for summarization. */
  minimumEmailLength: { type: Number, default: 100, min: [50, 'Minimum email length must be at least 50 characters.'] },
  /** Maximum number of emails to include in a single daily/periodic summary. */
  maxEmailsPerSummary: { type: Number, default: 20, min: [5, 'Max emails per summary must be at least 5.'], max: [100, 'Max emails per summary cannot exceed 100.'] },

  // ----- Learning and Adaptation -----
  /** Flag to enable/disable adaptive learning for this persona based on feedback. */
  learningEnabled: { type: Boolean, default: true },
  /** History of user feedback on summaries or email prioritization related to this persona. Limited to recent entries. */
  feedbackHistory: [{
    action: { type: String, enum: ['liked_summary', 'disliked_summary', 'changed_priority', 'marked_irrelevant', 'marked_important'] },
    emailId: { type: mongoose.Schema.Types.ObjectId, ref: 'Email' }, // Optional, if feedback is on a specific email
    summaryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Summary' }, // Optional, if feedback is on a summary
    feedbackText: { type: String, trim: true, maxlength: 500 }, // User's textual feedback
    adjustmentMade: { type: String, trim: true, maxlength: 200 }, // e.g., "Increased score for sender X"
    timestamp: { type: Date, default: Date.now },
  }],

  // ----- Persona Effectiveness Metrics -----
  /** Metrics to track how well the persona is performing. */
  metrics: {
    totalSummariesInfluenced: { type: Number, default: 0 }, // How many summaries were generated using this persona
    avgFeedbackRating: { type: Number, default: 0, min: 0, max: 5 }, // Average user rating for summaries influenced by this persona
    emailsCorrectlyPrioritized: { type: Number, default: 0 }, // Count of emails system thinks were correctly prioritized
    emailsMissedOrMisPrioritized: { type: Number, default: 0 }, // Count of emails user indicated were missed or misprioritized
    lastOptimizedAt: { type: Date }, // Timestamp of the last time the persona was auto-optimized
  },

}, {
  timestamps: true, // Automatically adds createdAt and updatedAt
  toJSON: { // Customize JSON output
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v; // Remove Mongoose version key
      // Potentially sensitive or large fields can be removed from default JSON output
      // delete ret.feedbackHistory;
      return ret;
    },
  },
  toObject: { virtuals: true }
});

// ----- INDEXES -----
personaSchema.index({ userId: 1 }, { unique: true }); // Ensured by schema, but good for explicitness
personaSchema.index({ 'importantContacts': 1 }); // For quickly finding personas by important contacts
personaSchema.index({ 'keywords': 1 }); // For quickly finding personas by keywords

// ----- VIRTUALS -----
/**
 * Virtual property to get categories considered high priority by this persona.
 * @virtual highPriorityCategories
 * @returns {Array<string>} An array of category names with priority >= 4.
 */
personaSchema.virtual('highPriorityCategories').get(function() {
  const categories = [];
  if (this.emailCategories) {
    for (const [categoryName, config] of Object.entries(this.emailCategories)) {
      if (config && config.priority >= 4) {
        categories.push(categoryName);
      }
    }
  }
  return categories;
});

// ----- INSTANCE METHODS -----

/**
 * Adds a feedback entry to the persona's feedback history.
 * Keeps the feedback history limited to the last 100 entries.
 * @method addFeedback
 * @param {object} feedbackData - Data for the feedback entry (action, emailId, summaryId, feedbackText, adjustmentMade).
 * @returns {Promise<Persona>} The saved persona document.
 */
personaSchema.methods.addFeedback = function(feedbackData) {
  this.feedbackHistory.push({
    ...feedbackData,
    timestamp: new Date(), // Ensure timestamp is fresh
  });
  
  // Limit feedback history to a manageable size (e.g., last 100 entries)
  const MAX_FEEDBACK_ENTRIES = 100;
  if (this.feedbackHistory.length > MAX_FEEDBACK_ENTRIES) {
    this.feedbackHistory = this.feedbackHistory.slice(-MAX_FEEDBACK_ENTRIES);
  }
  
  return this.save();
};

/**
 * Updates persona metrics based on new summary feedback or email processing stats.
 * @method updateMetrics
 * @param {object} metricsUpdate - Object containing metrics to update (e.g., { summaryRating, correctlyPrioritized, missed }).
 * @returns {Promise<Persona>} The saved persona document.
 */
personaSchema.methods.updateMetrics = function(metricsUpdate = {}) {
  this.metrics.totalSummariesInfluenced = (this.metrics.totalSummariesInfluenced || 0) + 1;
  
  if (typeof metricsUpdate.summaryRating === 'number') {
    const currentAvg = this.metrics.avgFeedbackRating || 0;
    const totalInfluenced = this.metrics.totalSummariesInfluenced;
    // Ensure totalInfluenced is at least 1 to avoid division by zero if it's the first rating
    this.metrics.avgFeedbackRating = ((currentAvg * (totalInfluenced - 1)) + metricsUpdate.summaryRating) / Math.max(1, totalInfluenced);
  }
  
  if (typeof metricsUpdate.correctlyPrioritized === 'number') {
    this.metrics.emailsCorrectlyPrioritized = (this.metrics.emailsCorrectlyPrioritized || 0) + metricsUpdate.correctlyPrioritized;
  }
  if (typeof metricsUpdate.missedOrMisPrioritized === 'number') {
    this.metrics.emailsMissedOrMisPrioritized = (this.metrics.emailsMissedOrMisPrioritized || 0) + metricsUpdate.missedOrMisPrioritized;
  }
  
  return this.save();
};

/**
 * Placeholder for a method that would optimize the persona based on accumulated feedback.
 * This would involve more complex AI/ML logic in a real application.
 * @method optimizeBasedOnFeedback
 * @returns {Promise<Persona>} The potentially modified and saved persona document.
 */
personaSchema.methods.optimizeBasedOnFeedback = async function() {
  if (!this.learningEnabled || this.feedbackHistory.length < 10) { // Require a minimum amount of feedback
    logger.info(`Persona optimization skipped for user ${this.userId} due to insufficient feedback or learning disabled.`);
    return this; // Return current instance if no optimization is done
  }

  logger.info(`Optimizing persona for user ${this.userId} based on feedback.`);
  // --- Advanced AI/ML logic would go here ---
  // Example: Analyze feedbackHistory to adjust keywords, priorities, important contacts/domains.
  // For instance, if emails from a certain sender are consistently marked important, add sender to importantContacts.
  // If summaries with certain keywords are disliked, add those keywords to excludePatterns or adjust category.
  // This is a highly complex task and is stubbed out here.
  
  // Simulate some optimization
  // const adjustmentsMade = [];
  // Example: if many disliked summaries mentioned "marketing", add "marketing" to excludePatterns if not too generic
  // if (this.feedbackHistory.filter(f => f.action === 'disliked_summary' && f.feedbackText?.includes('marketing')).length > 5) {
  //   if (!this.excludePatterns.includes('marketing')) {
  //     this.excludePatterns.push('marketing');
  //     adjustmentsMade.push('Added "marketing" to exclude patterns');
  //   }
  // }
  
  this.metrics.lastOptimizedAt = new Date();
  // if (adjustmentsMade.length > 0) {
  //    this.addFeedback({ action: 'internal_optimization', adjustmentMade: adjustmentsMade.join(', ') });
  // }
  return this.save();
};

/**
 * Calculates a relevance score for a given email based on this persona.
 * @method getEmailScore
 * @param {object} email - An email object (should have fields like isRead, isImportant, sender, subject, body).
 * @returns {number} A numerical score representing the email's relevance to the persona. Higher is more relevant.
 */
personaSchema.methods.getEmailScore = function(email) {
  if (!email || !email.sender || !email.subject || !email.body) {
    logger.warn('getEmailScore called with invalid email object', { emailId: email?._id, userId: this.userId });
    return 0;
  }
  let score = 0;

  // Base score for unread emails
  if (!email.isRead) score += 2;

  // Gmail importance flag
  if (email.isImportant) score += 3;

  // Important Contacts: Check if sender's email or name matches any important contact
  if (this.importantContacts && this.importantContacts.length > 0) {
    const senderLower = email.sender.toLowerCase();
    if (this.importantContacts.some(contact => senderLower.includes(contact.toLowerCase()))) {
      score += 5;
    }
  }

  // Important Domains: Check if sender's domain matches any important domain
  if (this.importantDomains && this.importantDomains.length > 0) {
    const senderDomainMatch = email.sender.match(/@([\w.-]+)/);
    if (senderDomainMatch && senderDomainMatch[1]) {
      const senderDomain = senderDomainMatch[1].toLowerCase();
      if (this.importantDomains.some(domain => senderDomain.includes(domain.toLowerCase()))) {
        score += 4;
      }
    }
  }

  // Keywords: Check for presence in subject or body
  if (this.keywords && this.keywords.length > 0) {
    const emailText = `${email.subject} ${email.body}`.toLowerCase();
    const keywordMatches = this.keywords.filter(keyword => emailText.includes(keyword.toLowerCase())).length;
    score += keywordMatches * 2; // Score per keyword match
  }

  // Interests: Similar to keywords, but could have different weighting or source
  if (this.interests && this.interests.length > 0) {
    const emailText = `${email.subject} ${email.body}`.toLowerCase();
    const interestMatches = this.interests.filter(interest => emailText.includes(interest.toLowerCase())).length;
    score += interestMatches * 1.5; // Score per interest match
  }

  // Category-based scoring
  const category = this.categorizeEmail(email); // Use the categorization method
  const categoryConfig = this.emailCategories ? this.emailCategories[category] : null;
  if (categoryConfig && typeof categoryConfig.priority === 'number') {
    score += categoryConfig.priority; // Add the priority score of the category
  }

  // Penalize based on exclude patterns
  if (this.excludePatterns && this.excludePatterns.length > 0) {
    const emailText = `${email.subject} ${email.body}`.toLowerCase();
    if (this.excludePatterns.some(pattern => emailText.includes(pattern.toLowerCase()))) {
      score -= 5; // Significantly penalize excluded emails
    }
  }

  return Math.max(0, Math.round(score)); // Ensure score is not negative and round it
};

/**
 * Categorizes an email based on persona settings (keywords, sender patterns).
 * @method categorizeEmail
 * @param {object} email - An email object (with subject, body, sender fields).
 * @returns {string} The determined category name (e.g., 'work', 'personal').
 */
personaSchema.methods.categorizeEmail = function(email) {
  if (!email || !email.sender || !email.subject || !email.body) {
    return 'general'; // Default category if email data is insufficient
  }
  const subjectLower = email.subject.toLowerCase();
  const bodyLower = email.body.toLowerCase();
  const senderLower = email.sender.toLowerCase();
  
  // Check each defined category's keywords
  if (this.emailCategories) {
    for (const [categoryName, categoryConfig] of Object.entries(this.emailCategories)) {
      if (categoryConfig && categoryConfig.keywords && categoryConfig.keywords.length > 0) {
        if (categoryConfig.keywords.some(kw =>
            subjectLower.includes(kw.toLowerCase()) ||
            bodyLower.includes(kw.toLowerCase()) ||
            senderLower.includes(kw.toLowerCase()) // Check sender as well for specific rules
        )) {
          return categoryName;
        }
      }
    }
  }

  // Fallback/Default categorization logic (can be expanded)
  if (senderLower.includes('noreply') || senderLower.includes('no-reply') || subjectLower.startsWith('newsletter')) {
    return 'newsletters';
  }
  if (subjectLower.includes('unsubscribe') || bodyLower.includes('unsubscribe') || subjectLower.includes('promotion') || subjectLower.includes('offer')) {
    return 'promotions';
  }
  if (senderLower.includes('linkedin.com') || senderLower.includes('facebookmail.com') || senderLower.includes('twitter.com')) {
    return 'social';
  }

  // Default to 'work' or a more generic category if no specific rules match
  return this.emailCategories?.work ? 'work' : 'general';
};

/**
 * Determines if an email should be included in a summary based on persona settings.
 * Considers minimum length, exclude patterns, and category priority.
 * @method shouldIncludeEmail
 * @param {object} email - An email object.
 * @returns {boolean} True if the email should be included, false otherwise.
 */
personaSchema.methods.shouldIncludeEmail = function(email) {
  if (!email || !email.body) return false;

  // Check minimum length
  if (email.body.length < (this.minimumEmailLength || 50)) {
    return false;
  }

  // Check exclude patterns
  if (this.excludePatterns && this.excludePatterns.length > 0) {
    const emailText = `${email.subject} ${email.body}`.toLowerCase();
    if (this.excludePatterns.some(pattern => emailText.includes(pattern.toLowerCase()))) {
      return false;
    }
  }

  // Check category priority (e.g., skip emails from very low priority categories)
  const category = this.categorizeEmail(email);
  const categoryConfig = this.emailCategories ? this.emailCategories[category] : null;
  
  // Define a threshold, e.g., priority 1 categories are skipped unless explicitly included by other rules.
  const MIN_PRIORITY_TO_INCLUDE = 2;
  if (categoryConfig && typeof categoryConfig.priority === 'number' && categoryConfig.priority < MIN_PRIORITY_TO_INCLUDE) {
    // Further checks could be added here, e.g., if an email from a low-priority category
    // matches an important keyword, it might still be included.
    return false;
  }

  return true; // If not excluded by any rule, include it.
};

// ----- STATIC METHODS -----

/**
 * Finds a persona by user ID and populates the user's email and name.
 * @static findByUser
 * @param {mongoose.Types.ObjectId} userId - The ID of the user.
 * @returns {Promise<Persona|null>} The persona document if found, otherwise null.
 */
personaSchema.statics.findByUser = function(userId) {
  return this.findOne({ userId }).populate('userId', 'email name'); // Populate specific fields from User
};

/**
 * Creates a default persona for a new user.
 * @static createDefault
 * @param {mongoose.Types.ObjectId} userId - The ID of the new user.
 * @param {object} [userData={}] - Optional user data (e.g., role, timezone from user profile) to customize defaults.
 * @returns {Promise<Persona>} The newly created default persona document.
 */
personaSchema.statics.createDefault = function(userId, userData = {}) {
  const defaultPersonaData = {
    userId,
    role: userData.role || 'Professional', // Example: use user's role if available
    summaryStyle: 'balanced',
    summaryLength: 'medium',
    focusAreas: ['tasks', 'deadlines', 'meetings', 'updates'],
    emailCategories: { // Sensible defaults for categories
      work: { priority: 5, keywords: ['meeting', 'project', 'deadline', 'urgent', 'action required', 'important'] },
      personal: { priority: 3, keywords: ['family', 'friend', 'personal', 'invitation'] },
      newsletters: { priority: 1, keywords: ['newsletter', 'subscription', 'digest', 'unsubscribe'] },
      social: { priority: 2, keywords: ['linkedin', 'facebook', 'twitter', 'notification'] },
      promotions: { priority: 1, keywords: ['sale', 'offer', 'discount', 'promotion', 'coupon'] },
    },
    dailySummaryTime: userData.dailySummaryTime || '08:00', // Use user's pref if available
    timezone: userData.timezone || 'UTC', // Use user's pref if available
    maxEmailsPerSummary: 20,
    minimumEmailLength: 100,
    learningEnabled: true,
  };
  const defaultPersona = new this(defaultPersonaData);
  logger.info(`Creating default persona for user ${userId}.`);
  return defaultPersona.save();
};

const Persona = mongoose.model('Persona', personaSchema);

module.exports = Persona;