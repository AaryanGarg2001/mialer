const cron = require('node-cron');
const emailProcessingService = require('../services/email-processing.service');
const User = require('../models/user.model');
const Persona = require('../models/persona.model');
const logger = require('../utils/logger');

class DailySummaryJob {
  constructor() {
    this.isRunning = false;
    this.jobSchedule = null;
  }

  /**
   * Start the daily summary job scheduler
   */
  start() {
    // Run every hour to check for pending summaries
    this.jobSchedule = cron.schedule('0 * * * *', async () => {
      await this.processPendingSummaries();
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    logger.info('Daily summary job scheduler started');
  }

  /**
   * Stop the daily summary job scheduler
   */
  stop() {
    if (this.jobSchedule) {
      this.jobSchedule.stop();
      this.jobSchedule = null;
      logger.info('Daily summary job scheduler stopped');
    }
  }

  /**
   * Process pending summaries for all users
   */
  async processPendingSummaries() {
    if (this.isRunning) {
      logger.warn('Daily summary job already running, skipping this cycle');
      return;
    }

    this.isRunning = true;
    const startTime = Date.now();

    try {
      logger.info('Starting daily summary processing cycle');

      // Get all active users with personas
      const users = await this.getActiveUsersForSummary();
      
      if (users.length === 0) {
        logger.info('No users found for daily summary processing');
        return;
      }

      logger.info(`Processing daily summaries for ${users.length} users`);

      const results = {
        processed: 0,
        failed: 0,
        skipped: 0,
      };

      // Process users in batches to avoid overwhelming the system
      const batchSize = 5;
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        
        const batchPromises = batch.map(user => 
          this.processUserSummary(user).catch(error => {
            logger.error('Failed to process user summary', {
              userId: user._id,
              email: user.email,
              error: error.message,
            });
            return { status: 'failed', userId: user._id, error: error.message };
          })
        );

        const batchResults = await Promise.allSettled(batchPromises);
        
        // Process results
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            const userResult = result.value;
            if (userResult.status === 'completed') {
              results.processed++;
            } else if (userResult.status === 'skipped') {
              results.skipped++;
            } else {
              results.failed++;
            }
          } else {
            results.failed++;
            logger.error('Batch processing error', {
              userId: batch[index]._id,
              error: result.reason,
            });
          }
        });

        // Add delay between batches
        if (i + batchSize < users.length) {
          await this.delay(2000); // 2 second delay
        }
      }

      const duration = Date.now() - startTime;
      
      logger.info('Daily summary processing cycle completed', {
        duration: `${duration}ms`,
        totalUsers: users.length,
        processed: results.processed,
        failed: results.failed,
        skipped: results.skipped,
      });

    } catch (error) {
      logger.error('Daily summary processing cycle failed', {
        error: error.message,
        stack: error.stack,
      });
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Get active users who should receive daily summaries
   */
  async getActiveUsersForSummary() {
    try {
      const currentHour = new Date().getUTCHours();
      
      // Find users whose summary time matches the current hour (with timezone consideration)
      const users = await User.find({
        isActive: true,
        'providers.provider': 'google',
        'providers.isActive': true,
      }).populate('persona');

      const eligibleUsers = [];

      for (const user of users) {
        if (this.shouldProcessUserNow(user, currentHour)) {
          eligibleUsers.push(user);
        }
      }

      return eligibleUsers;

    } catch (error) {
      logger.error('Failed to get active users for summary', error);
      return [];
    }
  }

  /**
   * Check if a user should be processed now based on their timezone and preferences
   */
  shouldProcessUserNow(user, currentHour) {
    try {
      const persona = user.persona;
      
      if (!persona) {
        return false; // No persona, skip
      }

      // Get user's preferred summary time
      const summaryTime = persona.dailySummaryTime || '08:00';
      const [hours] = summaryTime.split(':').map(Number);
      
      // Convert user's timezone to UTC
      const timezone = persona.timezone || user.preferences?.timezone || 'UTC';
      const userHour = this.convertToUTC(hours, timezone);
      
      // Check if it's time for this user's summary
      return userHour === currentHour;

    } catch (error) {
      logger.error('Error checking if user should be processed', {
        userId: user._id,
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Convert local time to UTC based on timezone
   */
  convertToUTC(localHour, timezone) {
    try {
      // Simple timezone conversion - in production, use a proper timezone library
      const timezoneOffsets = {
        'UTC': 0,
        'EST': -5, 'EDT': -4,
        'CST': -6, 'CDT': -5,
        'MST': -7, 'MDT': -6,
        'PST': -8, 'PDT': -7,
        'GMT': 0, 'BST': 1,
        'CET': 1, 'CEST': 2,
      };

      const offset = timezoneOffsets[timezone] || 0;
      let utcHour = localHour - offset;

      // Handle day boundary crossing
      if (utcHour < 0) utcHour += 24;
      if (utcHour >= 24) utcHour -= 24;

      return utcHour;

    } catch (error) {
      logger.error('Timezone conversion error', { localHour, timezone, error: error.message });
      return localHour; // Fallback to local hour
    }
  }

  /**
   * Process daily summary for a single user
   */
  async processUserSummary(user) {
    const startTime = Date.now();
    
    try {
      logger.info('Processing daily summary for user', {
        userId: user._id,
        email: user.email,
      });

      // Check if user already has a summary for today
      if (await this.hasRecentSummary(user._id)) {
        logger.info('User already has recent summary, skipping', {
          userId: user._id,
        });
        return { status: 'skipped', reason: 'recent_summary_exists' };
      }

      // Process daily emails
      const result = await emailProcessingService.processDailyEmails(user._id, {
        maxResults: user.persona?.maxEmailsPerSummary || 20,
      });

      const duration = Date.now() - startTime;

      logger.info('Daily summary completed for user', {
        userId: user._id,
        email: user.email,
        duration: `${duration}ms`,
        processedCount: result.processedCount,
        summarizedCount: result.summarizedCount,
      });

      return {
        status: 'completed',
        userId: user._id,
        result,
        duration,
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      
      logger.error('Failed to process daily summary for user', {
        userId: user._id,
        email: user.email,
        duration: `${duration}ms`,
        error: error.message,
      });

      return {
        status: 'failed',
        userId: user._id,
        error: error.message,
        duration,
      };
    }
  }

  /**
   * Check if user has a recent summary (within last 20 hours)
   */
  async hasRecentSummary(userId) {
    try {
      const Summary = require('../models/summary.model');
      
      const twentyHoursAgo = new Date();
      twentyHoursAgo.setHours(twentyHoursAgo.getHours() - 20);

      const recentSummary = await Summary.findOne({
        userId,
        type: 'daily',
        createdAt: { $gte: twentyHoursAgo },
      });

      return !!recentSummary;

    } catch (error) {
      logger.error('Error checking for recent summary', {
        userId,
        error: error.message,
      });
      return false; // Assume no recent summary on error
    }
  }

  /**
   * Process summary for a specific user (manual trigger)
   */
  async processUserManually(userId) {
    try {
      const user = await User.findById(userId).populate('persona');
      
      if (!user) {
        throw new Error('User not found');
      }

      if (!user.gmailProvider) {
        throw new Error('User does not have Gmail connected');
      }

      const result = await this.processUserSummary(user);
      
      logger.info('Manual summary processing completed', {
        userId,
        result,
      });

      return result;

    } catch (error) {
      logger.error('Manual summary processing failed', {
        userId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get job status and statistics
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isScheduled: !!this.jobSchedule,
      nextRun: this.jobSchedule ? this.jobSchedule.nextDate() : null,
    };
  }

  /**
   * Simple delay utility
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Process summaries for all users (admin function)
   */
  async processAllUsers() {
    try {
      const users = await User.find({
        isActive: true,
        'providers.provider': 'google',
        'providers.isActive': true,
      }).populate('persona');

      logger.info(`Processing summaries for all ${users.length} users`);

      const results = [];
      
      for (const user of users) {
        try {
          const result = await this.processUserSummary(user);
          results.push(result);
          
          // Add delay between users
          await this.delay(1000);
        } catch (error) {
          results.push({
            status: 'failed',
            userId: user._id,
            error: error.message,
          });
        }
      }

      return results;

    } catch (error) {
      logger.error('Failed to process all users', error);
      throw error;
    }
  }
}

module.exports = new DailySummaryJob();