const mongoose = require('mongoose');

const personaSchema = new mongoose.Schema({
  // User reference
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },

  // Basic persona information
  role: {
    type: String,
    maxlength: 100,
    trim: true,
  },
  
  company: {
    type: String,
    maxlength: 100,
    trim: true,
  },
  
  department: {
    type: String,
    maxlength: 100,
    trim: true,
  },

  // Email priorities and preferences
  importantContacts: [{
    type: String,
    maxlength: 200,
    trim: true,
    lowercase: true,
  }],

  importantDomains: [{
    type: String,
    maxlength: 100,
    trim: true,
    lowercase: true,
  }],

  keywords: [{
    type: String,
    maxlength: 50,
    trim: true,
    lowercase: true,
  }],

  interests: [{
    type: String,
    maxlength: 50,
    trim: true,
    lowercase: true,
  }],

  // Summary preferences
  summaryStyle: {
    type: String,
    enum: ['brief', 'detailed', 'action-focused', 'balanced'],
    default: 'balanced',
  },

  summaryLength: {
    type: String,
    enum: ['short', 'medium', 'long'],
    default: 'medium',
  },

  focusAreas: [{
    type: String,
    enum: ['deadlines', 'meetings', 'tasks', 'updates', 'decisions', 'approvals'],
  }],

  // Email categorization preferences
  emailCategories: {
    work: {
      priority: {
        type: Number,
        min: 1,
        max: 5,
        default: 5,
      },
      keywords: [String],
    },
    personal: {
      priority: {
        type: Number,
        min: 1,
        max: 5,
        default: 3,
      },
      keywords: [String],
    },
    newsletters: {
      priority: {
        type: Number,
        min: 1,
        max: 5,
        default: 1,
      },
      keywords: [String],
    },
    social: {
      priority: {
        type: Number,
        min: 1,
        max: 5,
        default: 2,
      },
      keywords: [String],
    },
    promotions: {
      priority: {
        type: Number,
        min: 1,
        max: 5,
        default: 1,
      },
      keywords: [String],
    },
  },

  // Scheduling preferences
  dailySummaryTime: {
    type: String,
    default: '08:00',
    match: [/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Invalid time format. Use HH:MM'],
  },

  timezone: {
    type: String,
    default: 'UTC',
  },

  // Advanced preferences
  excludePatterns: [{
    type: String,
    maxlength: 100,
  }],

  minimumEmailLength: {
    type: Number,
    default: 100,
    min: 50,
  },

  maxEmailsPerSummary: {
    type: Number,
    default: 20,
    min: 5,
    max: 100,
  },

  // Learning and adaptation
  learningEnabled: {
    type: Boolean,
    default: true,
  },

  feedbackHistory: [{
    action: {
      type: String,
      enum: ['liked', 'disliked', 'ignored', 'starred', 'archived'],
    },
    emailId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Email',
    },
    summaryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Summary',
    },
    feedback: String,
    timestamp: {
      type: Date,
      default: Date.now,
    },
  }],

  // Persona effectiveness metrics
  metrics: {
    totalSummariesGenerated: {
      type: Number,
      default: 0,
    },
    averageRating: {
      type: Number,
      default: 0,
    },
    emailsCorrectlyPrioritized: {
      type: Number,
      default: 0,
    },
    emailsMissed: {
      type: Number,
      default: 0,
    },
    lastOptimizedAt: {
      type: Date,
    },
  },

}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.__v;
      delete ret.feedbackHistory;
      return ret;
    },
  },
});

// Indexes
personaSchema.index({ userId: 1 });
personaSchema.index({ 'importantContacts': 1 });
personaSchema.index({ 'keywords': 1 });

// Virtual for getting high priority categories
personaSchema.virtual('highPriorityCategories').get(function() {
  const categories = [];
  Object.keys(this.emailCategories).forEach(category => {
    if (this.emailCategories[category].priority >= 4) {
      categories.push(category);
    }
  });
  return categories;
});

// Instance methods
personaSchema.methods.addFeedback = function(feedbackData) {
  this.feedbackHistory.push({
    ...feedbackData,
    timestamp: new Date(),
  });
  
  // Keep only last 100 feedback entries
  if (this.feedbackHistory.length > 100) {
    this.feedbackHistory = this.feedbackHistory.slice(-100);
  }
  
  return this.save();
};

personaSchema.methods.updateMetrics = function(summaryRating, emailStats) {
  this.metrics.totalSummariesGenerated += 1;
  
  if (summaryRating) {
    const currentAvg = this.metrics.averageRating || 0;
    const total = this.metrics.totalSummariesGenerated;
    this.metrics.averageRating = ((currentAvg * (total - 1)) + summaryRating) / total;
  }
  
  if (emailStats) {
    this.metrics.emailsCorrectlyPrioritized += emailStats.correctlyPrioritized || 0;
    this.metrics.emailsMissed += emailStats.missed || 0;
  }
  
  return this.save();
};

personaSchema.methods.optimizeBasedOnFeedback = function() {
  if (!this.learningEnabled || this.feedbackHistory.length < 10) {
    return this;
  }

  const recentFeedback = this.feedbackHistory.slice(-20);
  
  // Analyze patterns in feedback
  const dislikedPatterns = recentFeedback
    .filter(f => f.action === 'disliked')
    .map(f => f.feedback)
    .filter(Boolean);

  const likedPatterns = recentFeedback
    .filter(f => f.action === 'liked')
    .map(f => f.feedback)
    .filter(Boolean);

  // Simple optimization: adjust category priorities based on feedback
  // This is a basic implementation - could be much more sophisticated
  
  this.metrics.lastOptimizedAt = new Date();
  return this.save();
};

personaSchema.methods.getEmailScore = function(email) {
  let score = 0;

  // Base score for unread emails
  if (!email.isRead) score += 2;

  // Gmail importance
  if (email.isImportant) score += 3;

  // Important contacts
  if (this.importantContacts && this.importantContacts.length > 0) {
    const senderLower = email.sender.toLowerCase();
    const isImportantContact = this.importantContacts.some(contact => 
      senderLower.includes(contact)
    );
    if (isImportantContact) score += 5;
  }

  // Important domains
  if (this.importantDomains && this.importantDomains.length > 0) {
    const senderLower = email.sender.toLowerCase();
    const isImportantDomain = this.importantDomains.some(domain => 
      senderLower.includes(domain)
    );
    if (isImportantDomain) score += 4;
  }

  // Keywords
  if (this.keywords && this.keywords.length > 0) {
    const text = `${email.subject} ${email.body}`.toLowerCase();
    const keywordMatches = this.keywords.filter(keyword => 
      text.includes(keyword)
    ).length;
    score += keywordMatches * 2;
  }

  // Interests
  if (this.interests && this.interests.length > 0) {
    const text = `${email.subject} ${email.body}`.toLowerCase();
    const interestMatches = this.interests.filter(interest => 
      text.includes(interest)
    ).length;
    score += interestMatches * 1.5;
  }

  // Category-based scoring
  const category = this.categorizeEmail(email);
  const categoryConfig = this.emailCategories[category];
  if (categoryConfig) {
    score += categoryConfig.priority;
  }

  // Penalize based on exclude patterns
  if (this.excludePatterns && this.excludePatterns.length > 0) {
    const text = `${email.subject} ${email.body}`.toLowerCase();
    const hasExcludePattern = this.excludePatterns.some(pattern => 
      text.includes(pattern.toLowerCase())
    );
    if (hasExcludePattern) score -= 3;
  }

  return Math.max(0, score);
};

personaSchema.methods.categorizeEmail = function(email) {
  const subject = email.subject.toLowerCase();
  const body = email.body.toLowerCase();
  const sender = email.sender.toLowerCase();
  
  // Check each category's keywords
  for (const [categoryName, categoryConfig] of Object.entries(this.emailCategories)) {
    if (categoryConfig.keywords && categoryConfig.keywords.length > 0) {
      const hasKeyword = categoryConfig.keywords.some(keyword => 
        subject.includes(keyword.toLowerCase()) || 
        body.includes(keyword.toLowerCase()) ||
        sender.includes(keyword.toLowerCase())
      );
      if (hasKeyword) {
        return categoryName;
      }
    }
  }

  // Default categorization logic
  if (sender.includes('noreply') || sender.includes('no-reply')) {
    return 'newsletters';
  }
  
  if (subject.includes('unsubscribe') || body.includes('unsubscribe')) {
    return 'promotions';
  }
  
  if (sender.includes('linkedin') || sender.includes('facebook') || sender.includes('twitter')) {
    return 'social';
  }

  return 'work'; // Default category
};

personaSchema.methods.shouldIncludeEmail = function(email) {
  // Check minimum length
  if (email.body.length < this.minimumEmailLength) {
    return false;
  }

  // Check exclude patterns
  if (this.excludePatterns && this.excludePatterns.length > 0) {
    const text = `${email.subject} ${email.body}`.toLowerCase();
    const hasExcludePattern = this.excludePatterns.some(pattern => 
      text.includes(pattern.toLowerCase())
    );
    if (hasExcludePattern) {
      return false;
    }
  }

  // Check category priority
  const category = this.categorizeEmail(email);
  const categoryConfig = this.emailCategories[category];
  
  if (categoryConfig && categoryConfig.priority < 2) {
    return false; // Skip very low priority categories
  }

  return true;
};

// Static methods
personaSchema.statics.findByUser = function(userId) {
  return this.findOne({ userId }).populate('userId', 'email name');
};

personaSchema.statics.createDefault = function(userId, userData = {}) {
  const defaultPersona = new this({
    userId,
    role: userData.role || 'Professional',
    summaryStyle: 'balanced',
    summaryLength: 'medium',
    focusAreas: ['tasks', 'deadlines', 'meetings'],
    emailCategories: {
      work: { priority: 5, keywords: ['meeting', 'project', 'deadline', 'urgent'] },
      personal: { priority: 3, keywords: ['family', 'friend', 'personal'] },
      newsletters: { priority: 1, keywords: ['newsletter', 'unsubscribe'] },
      social: { priority: 2, keywords: ['linkedin', 'facebook', 'twitter'] },
      promotions: { priority: 1, keywords: ['sale', 'offer', 'discount', 'promotion'] },
    },
    dailySummaryTime: '08:00',
    timezone: userData.timezone || 'UTC',
    maxEmailsPerSummary: 20,
    minimumEmailLength: 100,
    learningEnabled: true,
  });
  
  return defaultPersona.save();
};

const Persona = mongoose.model('Persona', personaSchema);

module.exports = Persona;