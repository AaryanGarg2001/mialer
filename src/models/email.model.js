const mongoose = require('mongoose');

const emailSchema = new mongoose.Schema({
  // User reference
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  // Gmail identifiers
  messageId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  threadId: {
    type: String,
    required: true,
    index: true,
  },

  // Email content
  subject: {
    type: String,
    required: true,
    maxlength: 500,
  },
  sender: {
    type: String,
    required: true,
    maxlength: 200,
    index: true,
  },
  recipients: [{
    type: String,
    maxlength: 200,
  }],
  body: {
    type: String,
    required: true,
  },
  htmlBody: {
    type: String,
    default: '',
  },
  snippet: {
    type: String,
    maxlength: 500,
  },

  // Gmail metadata
  labels: [{
    type: String,
  }],
  isImportant: {
    type: Boolean,
    default: false,
    index: true,
  },
  isRead: {
    type: Boolean,
    default: false,
    index: true,
  },
  receivedAt: {
    type: Date,
    required: true,
    index: true,
  },

  // Processing metadata
  processedAt: {
    type: Date,
    default: Date.now,
  },
  personalityScore: {
    type: Number,
    default: 0,
    min: 0,
    max: 20,
  },
  
  // Attachments
  attachments: [{
    filename: String,
    mimeType: String,
    size: Number,
    attachmentId: String,
  }],

  // AI processing results
  summary: {
    content: String,
    actionItems: [String],
    priority: {
      type: String,
      enum: ['low', 'medium', 'high'],
      default: 'medium',
    },
    category: {
      type: String,
      default: 'general',
    },
    sentiment: {
      type: String,
      enum: ['positive', 'neutral', 'negative'],
      default: 'neutral',
    },
    generatedAt: Date,
  },

  // Flags
  isArchived: {
    type: Boolean,
    default: false,
  },
  isStarred: {
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
emailSchema.index({ userId: 1, receivedAt: -1 });
emailSchema.index({ userId: 1, isRead: 1 });
emailSchema.index({ userId: 1, isImportant: 1 });
emailSchema.index({ userId: 1, personalityScore: -1 });
emailSchema.index({ userId: 1, 'summary.priority': 1 });

// Text search index for content search
emailSchema.index({
  subject: 'text',
  body: 'text',
  sender: 'text',
}, {
  weights: {
    subject: 10,
    sender: 5,
    body: 1,
  },
  name: 'email_text_search',
});

// Instance methods
emailSchema.methods.markAsRead = function() {
  this.isRead = true;
  return this.save();
};

emailSchema.methods.markAsImportant = function() {
  this.isImportant = true;
  return this.save();
};

emailSchema.methods.addSummary = function(summaryData) {
  this.summary = {
    ...summaryData,
    generatedAt: new Date(),
  };
  return this.save();
};

// Static methods
emailSchema.statics.findByUser = function(userId, options = {}) {
  const query = { userId };
  
  if (options.unreadOnly) {
    query.isRead = false;
  }
  
  if (options.importantOnly) {
    query.isImportant = true;
  }
  
  if (options.after) {
    query.receivedAt = { $gte: new Date(options.after) };
  }
  
  if (options.before) {
    query.receivedAt = { ...query.receivedAt, $lte: new Date(options.before) };
  }
  
  return this.find(query)
    .sort({ receivedAt: -1 })
    .limit(options.limit || 50);
};

emailSchema.statics.findByThread = function(userId, threadId) {
  return this.find({ userId, threadId })
    .sort({ receivedAt: 1 });
};

emailSchema.statics.searchEmails = function(userId, searchTerm) {
  return this.find({
    userId,
    $text: { $search: searchTerm }
  }, {
    score: { $meta: 'textScore' }
  })
  .sort({ score: { $meta: 'textScore' } })
  .limit(20);
};

emailSchema.statics.getEmailStats = function(userId, days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        receivedAt: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: '$receivedAt' },
          month: { $month: '$receivedAt' },
          day: { $dayOfMonth: '$receivedAt' }
        },
        total: { $sum: 1 },
        unread: { $sum: { $cond: [{ $eq: ['$isRead', false] }, 1, 0] } },
        important: { $sum: { $cond: [{ $eq: ['$isImportant', true] }, 1, 0] } },
        avgScore: { $avg: '$personalityScore' }
      }
    },
    {
      $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 }
    }
  ]);
};

// Pre-save middleware
emailSchema.pre('save', function(next) {
  // Ensure body is not too long for database
  if (this.body && this.body.length > 50000) {
    this.body = this.body.substring(0, 50000) + '... [truncated]';
  }
  
  // Ensure HTML body is not too long
  if (this.htmlBody && this.htmlBody.length > 100000) {
    this.htmlBody = this.htmlBody.substring(0, 100000) + '... [truncated]';
  }
  
  next();
});

const Email = mongoose.model('Email', emailSchema);

module.exports = Email;