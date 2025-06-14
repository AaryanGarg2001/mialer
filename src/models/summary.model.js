const mongoose = require('mongoose');
const logger = require('../utils/logger'); // Assuming logger is available

/**
 * @file Summary Model
 * @module models/summary
 * @requires mongoose
 * @requires ../utils/logger
 */

/**
 * Summary Schema Definition.
 * Represents an AI-generated summary of emails for a user.
 * Can be of different types (daily, weekly, on-demand) and includes content,
 * action items, highlights, statistics, and user feedback.
 * @type {mongoose.Schema}
 */
const summarySchema = new mongoose.Schema({
  /** ID of the user this summary belongs to. */
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Reference to the User model
    required: [true, 'User ID is required for a summary.'],
    index: true,
  },

  // ----- Summary Type and Metadata -----
  /** Type of the summary (e.g., daily, weekly). */
  type: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'on-demand'], // Supported summary types
    required: [true, 'Summary type is required.'],
    index: true,
  },
  
  // ----- Summary Content -----
  /** The main content of the generated summary. */
  content: { type: String, required: [true, 'Summary content cannot be empty.'], trim: true, maxlength: [20000, 'Summary content is too long.'] }, // Increased max length

  // ----- Source Email References -----
  /** Array of ObjectIds referencing the Email documents included in this summary. */
  emailIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Email' }],

  // ----- Extracted Information -----
  /** Action items extracted from the summarized emails. */
  actionItems: [{
    description: { type: String, required: true, trim: true, maxlength: [500, 'Action item description is too long.'] },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    dueDate: { type: Date },
    completed: { type: Boolean, default: false },
    completedAt: { type: Date }, // Timestamp when the action item was marked completed
    emailId: { type: mongoose.Schema.Types.ObjectId, ref: 'Email' }, // Reference to the source email of the action item
    extractedAt: { type: Date, default: Date.now },
  }],
  /** Key highlights or important points from the summary. */
  highlights: [{ type: String, trim: true, maxlength: [300, 'Highlight is too long.'] }],

  // ----- Email Categorization -----
  /** Counts of emails included in the summary, by category. */
  categories: {
    work: { type: Number, default: 0, min: 0 },
    personal: { type: Number, default: 0, min: 0 },
    newsletters: { type: Number, default: 0, min: 0 },
    promotions: { type: Number, default: 0, min: 0 },
    social: { type: Number, default: 0, min: 0 },
    forums: { type: Number, default: 0, min: 0 }, // Example additional category
    updates: { type: Number, default: 0, min: 0 }, // Example: project updates, notifications
    other: { type: Number, default: 0, min: 0 },
  },

  // ----- Summary Statistics -----
  /** Statistics about the emails included in this summary. */
  stats: {
    totalEmails: { type: Number, default: 0, min: 0 },
    unreadEmails: { type: Number, default: 0, min: 0 },
    importantEmails: { type: Number, default: 0, min: 0 },
    averageEmailScore: { type: Number, default: 0, min: 0 }, // Average persona score of included emails
    topSenders: [{ // Top 3-5 senders by email count in this summary
      email: String,
      count: { type: Number, min: 1 },
    }],
  },

  // ----- Date Range -----
  /** The date range covered by this summary. */
  dateRange: {
    start: { type: Date, required: [true, 'Summary date range start is required.'] },
    end: { type: Date, required: [true, 'Summary date range end is required.'] },
  },

  // ----- AI Generation Metadata -----
  /** Additional metadata related to the AI generation process. */
  metadata: {
    aiProvider: { type: String, trim: true }, // e.g., 'openai', 'anthropic'
    modelUsed: { type: String, trim: true }, // e.g., 'gpt-3.5-turbo', 'claude-2'
    processingTimeMs: { type: Number, min: 0 }, // Time taken to generate the summary in milliseconds
    tokenCount: { type: Number, min: 0 }, // Tokens used for generation (if applicable)
    confidenceScore: { type: Number, min: 0, max: 1 }, // AI's confidence in the summary quality (0-1)
    version: { type: String, default: '1.0' }, // Version of the summarization algorithm/prompt
  },

  // ----- User Feedback -----
  /** Feedback provided by the user for this summary. */
  feedback: {
    rating: { type: Number, min: 1, max: 5 }, // e.g., 1-5 stars
    isHelpful: { type: Boolean }, // Was the summary helpful?
    comment: { type: String, trim: true, maxlength: [1000, 'Feedback comment is too long.'] },
    submittedAt: { type: Date },
  },

  // ----- Status Flags -----
  /** Flag indicating if the user has archived this summary. */
  isArchived: { type: Boolean, default: false, index: true },
  /** Flag indicating if this summary has been shared by the user. */
  isShared: { type: Boolean, default: false }, // Could be for future sharing features
  
}, {
  timestamps: true, // Automatically adds createdAt and updatedAt
  toJSON: { // Customize JSON output
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v; // Remove Mongoose version key
      return ret;
    },
  },
  toObject: { virtuals: true }
});

// ----- INDEXES -----
summarySchema.index({ userId: 1, createdAt: -1 }); // Common query: user's summaries sorted by creation
summarySchema.index({ userId: 1, type: 1, createdAt: -1 }); // Query by type for a user
summarySchema.index({ userId: 1, 'dateRange.start': 1, 'dateRange.end': 1 }); // Query by date range
summarySchema.index({ 'actionItems.completed': 1, 'actionItems.dueDate': 1, userId: 1 }); // For finding pending/overdue action items for a user
summarySchema.index({ userId: 1, isArchived: 1, createdAt: -1 }); // For archived summaries

// Text search index for summary content, highlights, and action items
summarySchema.index(
  { content: 'text', highlights: 'text', 'actionItems.description': 'text' },
  { name: 'summary_text_search_index' }
);

// ----- VIRTUALS -----
/**
 * Virtual property to get all pending (not completed) action items for this summary.
 * @virtual pendingActionItems
 * @returns {Array<object>} Array of action item subdocuments that are not completed.
 */
summarySchema.virtual('pendingActionItems').get(function() {
  if (!this.actionItems) return [];
  return this.actionItems.filter(item => !item.completed);
});

/**
 * Virtual property to get all overdue action items for this summary.
 * An action item is overdue if it's not completed and its due date has passed.
 * @virtual overdueActionItems
 * @returns {Array<object>} Array of overdue action item subdocuments.
 */
summarySchema.virtual('overdueActionItems').get(function() {
  if (!this.actionItems) return [];
  const now = new Date();
  return this.actionItems.filter(item => 
    !item.completed && item.dueDate && new Date(item.dueDate) < now
  );
});

// ----- INSTANCE METHODS -----

/**
 * Marks a specific action item within this summary as completed.
 * @method markActionItemCompleted
 * @param {mongoose.Types.ObjectId|string} actionItemId - The ID of the action item to mark as completed.
 * @returns {Promise<Summary>} The saved summary document.
 * @throws {Error} If the action item is not found.
 */
summarySchema.methods.markActionItemCompleted = function(actionItemId) {
  const actionItem = this.actionItems.id(actionItemId); // Mongoose subdocument .id() method
  if (actionItem) {
    actionItem.completed = true;
    actionItem.completedAt = new Date(); // Record completion time
    logger.info(`Action item ${actionItemId} marked completed for summary ${this._id}`);
    return this.save();
  }
  logger.warn(`Action item ${actionItemId} not found in summary ${this._id}`);
  throw new Error('Action item not found in this summary.');
};

/**
 * Adds or updates user feedback for this summary.
 * @method addFeedback
 * @param {object} feedbackData - Object containing feedback details (rating, isHelpful, comment).
 * @returns {Promise<Summary>} The saved summary document.
 */
summarySchema.methods.addFeedback = function(feedbackData) {
  this.feedback = {
    rating: feedbackData.rating,
    isHelpful: feedbackData.isHelpful,
    comment: feedbackData.comment,
    submittedAt: new Date(),
  };
  logger.info(`Feedback added for summary ${this._id} by user ${this.userId}`);
  return this.save();
};

/**
 * Marks this summary as archived.
 * @method archive
 * @returns {Promise<Summary>} The saved summary document.
 */
summarySchema.methods.archive = function() {
  this.isArchived = true;
  return this.save();
};

/**
 * Retrieves action items from this summary that are due soon.
 * @method getActionItemsDueSoon
 * @param {number} [days=3] - Number of days from now to consider as "due soon".
 * @returns {Array<object>} Array of action items due within the specified number of days.
 */
summarySchema.methods.getActionItemsDueSoon = function(days = 3) {
  if (!this.actionItems) return [];
  const now = new Date();
  const futureDate = new Date();
  futureDate.setDate(now.getDate() + days);
  
  return this.actionItems.filter(item => 
    !item.completed && 
    item.dueDate && 
    new Date(item.dueDate) >= now &&
    new Date(item.dueDate) <= futureDate
  );
};

// ----- STATIC METHODS -----

/**
 * Finds summaries for a given user, with various filtering and pagination options.
 * @static findByUser
 * @param {mongoose.Types.ObjectId} userId - The ID of the user.
 * @param {object} [options={}] - Query options.
 * @param {string} [options.type] - Filter by summary type (e.g., 'daily').
 * @param {Date} [options.after] - Filter summaries created after this date.
 * @param {Date} [options.before] - Filter summaries created before this date.
 * @param {boolean} [options.archived] - Filter by archived status.
 * @param {number} [options.limit=20] - Maximum number of summaries to return.
 * @param {string} [options.sortBy='createdAt'] - Field to sort by.
 * @param {number} [options.sortOrder=-1] - Sort order (-1 for descending, 1 for ascending).
 * @returns {Promise<Array<Summary>>} A promise that resolves to an array of summary documents.
 */
summarySchema.statics.findByUser = function(userId, options = {}) {
  const query = { userId };
  
  if (options.type) query.type = options.type;
  
  const dateQuery = {};
  if (options.after) dateQuery.$gte = new Date(options.after);
  if (options.before) dateQuery.$lte = new Date(options.before);
  if (Object.keys(dateQuery).length > 0) query.createdAt = dateQuery;
  
  if (options.archived !== undefined) query.isArchived = options.archived;
  
  const sortOptions = {};
  sortOptions[options.sortBy || 'createdAt'] = options.sortOrder || -1;

  return this.find(query)
    .populate('emailIds', 'subject sender receivedAt isImportant') // Populate some fields from related emails
    .sort(sortOptions)
    .limit(options.limit || 20);
};

/**
 * Gets the latest non-archived daily summary for a user.
 * @static getLatestDailySummary
 * @param {mongoose.Types.ObjectId} userId - The ID of the user.
 * @returns {Promise<Summary|null>} The latest daily summary document, or null if none found.
 */
summarySchema.statics.getLatestDailySummary = function(userId) {
  return this.findOne({ userId, type: 'daily', isArchived: false })
    .populate('emailIds', 'subject sender receivedAt isImportant')
    .sort({ createdAt: -1 });
};

/**
 * Retrieves all pending (not completed) action items for a user across all their summaries.
 * @static getPendingActionItems
 * @param {mongoose.Types.ObjectId} userId - The ID of the user.
 * @returns {Promise<Array<object>>} An array of pending action items with details.
 */
summarySchema.statics.getPendingActionItems = function(userId) {
  return this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), isArchived: false } }, // Only from non-archived summaries
    { $unwind: '$actionItems' }, // Deconstruct the actionItems array
    { $match: { 'actionItems.completed': false } }, // Filter for incomplete items
    {
      $project: { // Shape the output
        _id: '$actionItems._id',
        description: '$actionItems.description',
        priority: '$actionItems.priority',
        dueDate: '$actionItems.dueDate',
        emailId: '$actionItems.emailId', // So user can navigate to the source email
        summaryId: '$_id', // ID of the summary this action item belongs to
        summaryType: '$type',
        extractedAt: '$actionItems.extractedAt',
        summaryCreatedAt: '$createdAt', // Include summary creation date for context
      }
    },
    { $sort: { 'priority': 1, 'dueDate': 1, 'summaryCreatedAt': -1 } } // Sort by priority, then due date, then summary date
  ]);
};

/**
 * Retrieves aggregated statistics about summaries for a user over a specified number of days.
 * @static getSummaryStats
 * @param {mongoose.Types.ObjectId} userId - The ID of the user.
 * @param {number} [days=30] - The number of past days to include in the stats.
 * @returns {Promise<Array<object>>} Aggregated statistics (count, totalEmails, totalActionItems, avgRating, lastCreated per summary type).
 */
summarySchema.statics.getSummaryStats = function(userId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0,0,0,0);
  
  return this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), createdAt: { $gte: startDate } } },
    {
      $group: {
        _id: '$type', // Group by summary type
        count: { $sum: 1 },
        totalEmailsSummarized: { $sum: '$stats.totalEmails' },
        totalActionItemsExtracted: { $sum: { $size: '$actionItems' } }, // Count elements in actionItems array
        averageUserRating: { $avg: '$feedback.rating' }, // Average of user-provided ratings
        lastSummaryDate: { $max: '$createdAt' }
      }
    },
    {
      $project: { // Rename _id to summaryType for clarity
        summaryType: '$_id',
        count: 1,
        totalEmailsSummarized: 1,
        totalActionItemsExtracted: 1,
        averageUserRating: { $ifNull: ['$averageUserRating', null] }, // Handle cases with no ratings
        lastSummaryDate: 1,
        _id: 0
      }
    }
  ]);
};

/**
 * Searches summaries for a user based on a search term using the text index.
 * @static searchSummaries
 * @param {mongoose.Types.ObjectId} userId - The ID of the user.
 * @param {string} searchTerm - The term to search for.
 * @param {number} [limit=10] - Maximum number of results to return.
 * @returns {Promise<Array<Summary>>} A promise that resolves to an array of matching summary documents.
 */
summarySchema.statics.searchSummaries = function(userId, searchTerm, limit = 10) {
  return this.find(
    { userId, $text: { $search: searchTerm } },
    { score: { $meta: 'textScore' } } // Project the text search score
  )
  .populate('emailIds', 'subject sender receivedAt') // Populate some details from related emails
  .sort({ score: { $meta: 'textScore' } }) // Sort by relevance
  .limit(limit);
};

// ----- MIDDLEWARE (HOOKS) -----

/**
 * Pre-save middleware for the Summary schema.
 * - Truncates `content` if it exceeds maximum length.
 * - Sets default `dateRange` for daily summaries if not provided.
 * @listens Mongoose#save:pre
 * @param {import('express').NextFunction} next - Callback to continue the save operation.
 */
summarySchema.pre('save', function(next) {
  const MAX_CONTENT_LENGTH = 20000;
  if (this.content && this.content.length > MAX_CONTENT_LENGTH) {
    logger.warn(`Truncating content for summary ${this._id} due to excessive length. Original: ${this.content.length}, Max: ${MAX_CONTENT_LENGTH}`);
    this.content = this.content.substring(0, MAX_CONTENT_LENGTH) + '... [truncated]';
  }
  
  // Auto-fill date range for daily summaries if not explicitly set
  if (this.type === 'daily' && (!this.dateRange.start || !this.dateRange.end)) {
    const today = new Date(this.createdAt || Date.now()); // Use createdAt if available, otherwise now
    today.setHours(0, 0, 0, 0); // Start of today

    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1); // Start of yesterday

    this.dateRange.start = this.dateRange.start || yesterday;
    this.dateRange.end = this.dateRange.end || today; // End of "yesterday" technically, or "up to today"
    
    logger.debug(`Auto-set date range for daily summary ${this._id}: ${this.dateRange.start} - ${this.dateRange.end}`);
  }
  
  next();
});

const Summary = mongoose.model('Summary', summarySchema);

module.exports = Summary;