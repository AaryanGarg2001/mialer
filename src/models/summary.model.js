const mongoose = require('mongoose');

const summarySchema = new mongoose.Schema({
  // User reference
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // Summary type and metadata
  type: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'on-demand'],
    required: true,
    index: true,
  },
  
  // Summary content
  content: {
    type: String,
    required: true,
    maxlength: 10000,
  },

  // References to source emails
  emailIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Email',
  }],

  // Extracted action items
  actionItems: [{
    description: {
      type: String,
      required: true,
      maxlength: 500,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    dueDate: {
      type: Date,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    emailId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Email',
    },
    extractedAt: {
      type: Date,
      default: Date.now,
    },
  }],

  // Key highlights from the summary
  highlights: [{
    type: String,
    maxlength: 300,
  }],

  // Email categorization
  categories: {
    work: { type: Number, default: 0 },
    personal: { type: Number, default: 0 },
    newsletters: { type: Number, default: 0 },
    promotions: { type: Number, default: 0 },
    social: { type: Number, default: 0 },
    forums: { type: Number, default: 0 },
    updates: { type: Number, default: 0 },
    other: { type: Number, default: 0 },
  },

  // Summary statistics
  stats: {
    totalEmails: {
      type: Number,
      default: 0,
    },
    unreadEmails: {
      type: Number,
      default: 0,
    },
    importantEmails: {
      type: Number,
      default: 0,
    },
    averageScore: {
      type: Number,
      default: 0,
    },
    topSenders: [{
      email: String,
      count: Number,
    }],
  },

  // Date range covered by this summary
  dateRange: {
    start: {
      type: Date,
      required: true,
    },
    end: {
      type: Date,
      required: true,
    },
  },

  // Additional metadata
  metadata: {
    aiProvider: String,
    model: String,
    processingTime: Number, // milliseconds
    tokenCount: Number,
    confidence: {
      type: Number,
      min: 0,
      max: 1,
    },
    version: {
      type: String,
      default: '1.0',
    },
  },

  // User feedback
  feedback: {
    rating: {
      type: Number,
      min: 1,
      max: 5,
    },
    helpful: {
      type: Boolean,
    },
    comment: {
      type: String,
      maxlength: 1000,
    },
    submittedAt: {
      type: Date,
    },
  },

  // Status flags
  isArchived: {
    type: Boolean,
    default: false,
  },
  isShared: {
    type: Boolean,
    default: false,
  },
  
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    },
  },
});

// Compound indexes for better query performance
summarySchema.index({ userId: 1, createdAt: -1 });
summarySchema.index({ userId: 1, type: 1, createdAt: -1 });
summarySchema.index({ userId: 1, 'dateRange.start': 1, 'dateRange.end': 1 });
summarySchema.index({ 'actionItems.completed': 1, 'actionItems.dueDate': 1 });

// Text search index for summary content
summarySchema.index({
  content: 'text',
  'highlights': 'text',
  'actionItems.description': 'text',
});

// Virtual for getting pending action items
summarySchema.virtual('pendingActionItems').get(function() {
  return this.actionItems.filter(item => !item.completed);
});

// Virtual for getting overdue action items
summarySchema.virtual('overdueActionItems').get(function() {
  const now = new Date();
  return this.actionItems.filter(item => 
    !item.completed && item.dueDate && item.dueDate < now
  );
});

// Instance methods
summarySchema.methods.markActionItemCompleted = function(actionItemId) {
  const actionItem = this.actionItems.id(actionItemId);
  if (actionItem) {
    actionItem.completed = true;
    actionItem.completedAt = new Date();
    return this.save();
  }
  throw new Error('Action item not found');
};

summarySchema.methods.addFeedback = function(feedbackData) {
  this.feedback = {
    ...feedbackData,
    submittedAt: new Date(),
  };
  return this.save();
};

summarySchema.methods.archive = function() {
  this.isArchived = true;
  return this.save();
};

summarySchema.methods.getActionItemsDueSoon = function(days = 3) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);
  
  return this.actionItems.filter(item => 
    !item.completed && 
    item.dueDate && 
    item.dueDate >= new Date() && 
    item.dueDate <= futureDate
  );
};

// Static methods
summarySchema.statics.findByUser = function(userId, options = {}) {
  const query = { userId };
  
  if (options.type) {
    query.type = options.type;
  }
  
  if (options.after) {
    query.createdAt = { $gte: new Date(options.after) };
  }
  
  if (options.before) {
    query.createdAt = { ...query.createdAt, $lte: new Date(options.before) };
  }
  
  if (options.archived !== undefined) {
    query.isArchived = options.archived;
  }
  
  return this.find(query)
    .populate('emailIds', 'subject sender receivedAt')
    .sort({ createdAt: -1 })
    .limit(options.limit || 20);
};

summarySchema.statics.getLatestDailySummary = function(userId) {
  return this.findOne({ 
    userId, 
    type: 'daily',
    isArchived: false 
  })
  .populate('emailIds', 'subject sender receivedAt')
  .sort({ createdAt: -1 });
};

summarySchema.statics.getPendingActionItems = function(userId) {
  return this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        isArchived: false,
      }
    },
    {
      $unwind: '$actionItems'
    },
    {
      $match: {
        'actionItems.completed': false
      }
    },
    {
      $project: {
        _id: '$actionItems._id',
        description: '$actionItems.description',
        priority: '$actionItems.priority',
        dueDate: '$actionItems.dueDate',
        emailId: '$actionItems.emailId',
        summaryId: '$_id',
        summaryType: '$type',
        extractedAt: '$actionItems.extractedAt',
      }
    },
    {
      $sort: {
        priority: 1, // high = 1, medium = 2, low = 3
        dueDate: 1
      }
    }
  ]);
};

summarySchema.statics.getSummaryStats = function(userId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        createdAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        totalEmails: { $sum: '$stats.totalEmails' },
        totalActionItems: { $sum: { $size: '$actionItems' } },
        avgRating: { $avg: '$feedback.rating' },
        lastCreated: { $max: '$createdAt' }
      }
    }
  ]);
};

summarySchema.statics.searchSummaries = function(userId, searchTerm) {
  return this.find({
    userId,
    $text: { $search: searchTerm }
  }, {
    score: { $meta: 'textScore' }
  })
  .populate('emailIds', 'subject sender receivedAt')
  .sort({ score: { $meta: 'textScore' } })
  .limit(10);
};

// Pre-save middleware
summarySchema.pre('save', function(next) {
  // Ensure content is not too long
  if (this.content && this.content.length > 10000) {
    this.content = this.content.substring(0, 10000) + '... [truncated]';
  }
  
  // Set date range if not provided
  if (!this.dateRange.start || !this.dateRange.end) {
    const now = new Date();
    this.dateRange.end = now;
    
    // Default to yesterday for daily summaries
    if (this.type === 'daily') {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(0, 0, 0, 0);
      this.dateRange.start = yesterday;
    }
  }
  
  next();
});

const Summary = mongoose.model('Summary', summarySchema);

module.exports = Summary;