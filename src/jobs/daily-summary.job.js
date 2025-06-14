const cron = require('node-cron');
const emailProcessingService = require('../services/email-processing.service');
const User = require('../models/User.model.js'); // Ensure .js extension and correct casing
const Persona = require('../models/persona.model.js'); // Ensure .js extension
const logger = require('../utils/logger');

/**
 * @file Daily Summary Job
 * @module jobs/daily-summary
 * @requires node-cron
 * @requires ../services/email-processing.service
 * @requires ../models/user.model
 * @requires ../models/persona.model
 * @requires ../utils/logger
 */

/**
 * Manages the scheduled task for generating daily summaries for users.
 * This job runs periodically (e.g., hourly) to check which users are due for their daily summary
 * based on their preferences and timezone.
 * @class DailySummaryJob
 */
class DailySummaryJob {
  /**
   * Initializes the DailySummaryJob.
   * @constructor
   */
  constructor() {
    /** @member {boolean} isRunning - Flag to prevent concurrent job executions. */
    this.isRunning = false;
    /** @member {import('node-cron').ScheduledTask|null} jobSchedule - The node-cron scheduled task instance. */
    this.jobSchedule = null;
  }

  /**
   * Starts the cron job scheduler.
   * The job is scheduled to run hourly to check for users needing daily summaries.
   * Uses UTC for the scheduler.
   */
  start() {
    // Cron pattern '0 * * * *' means "at minute 0 past every hour" (i.e., hourly).
    this.jobSchedule = cron.schedule('0 * * * *', async () => {
      logger.info('Hourly cron tick: Checking for pending daily summaries.');
      await this.processPendingSummaries();
    }, {
      scheduled: true,
      timezone: 'UTC' // Scheduler runs in UTC, individual user times are converted to UTC for checking.
    });

    logger.info('Daily summary job scheduler started successfully. Will run hourly.');
  }

  /**
   * Stops the cron job scheduler if it is running.
   */
  stop() {
    if (this.jobSchedule) {
      this.jobSchedule.stop();
      this.jobSchedule = null; // Clear the schedule object
      logger.info('Daily summary job scheduler stopped successfully.');
    } else {
      logger.info('Daily summary job scheduler was not running.');
    }
  }

  /**
   * Processes pending daily summaries for all eligible users.
   * This method is typically called by the cron scheduler.
   * It ensures that only one instance of this processing logic runs at a time.
   * @async
   * @returns {Promise<void>}
   */
  async processPendingSummaries() {
    if (this.isRunning) {
      logger.warn('Daily summary processing cycle is already running. Skipping this tick.');
      return;
    }

    this.isRunning = true;
    const cycleStartTime = Date.now();
    logger.info('Starting new daily summary processing cycle.');

    try {
      const usersForSummary = await this._getActiveUsersForSummary();
      if (usersForSummary.length === 0) {
        logger.info('No users are due for daily summary processing at this time.');
        return;
      }

      logger.info(`Found ${usersForSummary.length} users eligible for daily summary processing in this cycle.`);
      const summaryCycleStats = { processed: 0, failed: 0, skipped: 0, totalEligible: usersForSummary.length };

      // Process users in batches to manage load
      const BATCH_SIZE = parseInt(process.env.JOB_USER_BATCH_SIZE, 10) || 5;
      for (let i = 0; i < usersForSummary.length; i += BATCH_SIZE) {
        const userBatch = usersForSummary.slice(i, i + BATCH_SIZE);
        logger.info(`Processing batch of ${userBatch.length} users (Batch ${Math.floor(i / BATCH_SIZE) + 1}).`);
        
        const batchProcessingPromises = userBatch.map(user =>
          this._processUserSummary(user).catch(error => ({ // Ensure individual user failure doesn't stop batch
            status: 'failed_critical', userId: user._id, error: error.message
          }))
        );

        const batchResults = await Promise.allSettled(batchProcessingPromises);
        batchResults.forEach(result => {
          if (result.status === 'fulfilled') {
            const userResult = result.value; // This is { status, userId, ... }
            if (userResult.status === 'completed') summaryCycleStats.processed++;
            else if (userResult.status === 'skipped') summaryCycleStats.skipped++;
            else summaryCycleStats.failed++; // Covers 'failed' and 'failed_critical'
          } else { // Promise was rejected (should be caught by inner catch, but as a safeguard)
            summaryCycleStats.failed++;
            logger.error('Unexpected rejection in batch processing user summary:', { error: result.reason });
          }
        });

        if (i + BATCH_SIZE < usersForSummary.length) {
          const delayMs = parseInt(process.env.JOB_BATCH_DELAY_MS, 10) || 2000; // e.g., 2 seconds
          logger.debug(`Delaying ${delayMs}ms before next batch.`);
          await this._delay(delayMs);
        }
      }

      const cycleDurationMs = Date.now() - cycleStartTime;
      logger.info('Daily summary processing cycle finished.', { cycleDurationMs, ...summaryCycleStats });

    } catch (error) { // Catch errors from _getActiveUsersForSummary or other unexpected issues
      logger.error('Major failure in daily summary processing cycle:', { message: error.message, stack: error.stack });
    } finally {
      this.isRunning = false;
      logger.info('Daily summary processing cycle flag `isRunning` set to false.');
    }
  }

  /**
   * Retrieves active users who are due for a daily summary based on their preferred time and timezone.
   * @async
   * @private
   * @returns {Promise<Array<User>>} A list of user documents (with persona populated).
   */
  async _getActiveUsersForSummary() {
    try {
      const currentUTCHour = new Date().getUTCHours();
      // Find users who are active and have an active Gmail connection.
      const potentiallyEligibleUsers = await User.find({
        isActive: true,
        'providers.provider': 'google', // Ensures they have a Google provider entry
        'providers.isActive': true,     // Ensures that specific provider is active
      }).populate('persona').lean(); // Populate persona, use .lean() for performance if not modifying

      const usersDueNow = potentiallyEligibleUsers.filter(user =>
        this._shouldProcessUserNow(user, currentUTCHour)
      );
      logger.debug(`Found ${usersDueNow.length} users due for summary in current UTC hour ${currentUTCHour}.`);
      return usersDueNow;
    } catch (error) {
      logger.error('Failed to get active users for summary processing:', { message: error.message });
      return []; // Return empty array on error to prevent cycle failure
    }
  }

  /**
   * Determines if a user's daily summary should be processed at the current UTC hour.
   * Considers user's persona-defined (or default) summary time and timezone.
   * @private
   * @param {User} user - The user document (with persona).
   * @param {number} currentUTCHour - The current hour in UTC (0-23).
   * @returns {boolean} True if the user's summary should be processed now.
   */
  _shouldProcessUserNow(user, currentUTCHour) {
    try {
      const persona = user.persona;
      if (!persona) {
        logger.debug(`User ${user._id} skipped: No persona found.`, { userId: user._id });
        return false;
      }

      const preferredTime = persona.dailySummaryTime || user.preferences?.dailySummaryTime || '08:00'; // Default to 08:00
      const [prefHour, prefMinute] = preferredTime.split(':').map(Number);
      
      // This job runs hourly, so we only care about the hour.
      // The conversion to UTC should handle the hour correctly.
      const userLocalSummaryHour = prefHour;
      const userTimezone = persona.timezone || user.preferences?.timezone || 'UTC'; // Default to UTC
      
      const userSummaryUTCHour = this._convertLocalHourToUTC(userLocalSummaryHour, userTimezone);

      if (userSummaryUTCHour === currentUTCHour) {
        logger.debug(`User ${user._id} is due for summary. PrefHour: ${userLocalSummaryHour} (${userTimezone}), UTCHour: ${userSummaryUTCHour}, CurrentUTCHour: ${currentUTCHour}`);
        return true;
      }
      return false;
    } catch (error) {
      logger.error('Error determining if user summary should be processed now:', { userId: user._id, message: error.message });
      return false; // Err on the side of not processing if there's an issue
    }
  }

  /**
   * Converts a local hour in a given timezone to the equivalent UTC hour.
   * Note: This is a simplified conversion. For full accuracy with DST, a robust library like `moment-timezone` or `date-fns-tz` is recommended.
   * @private
   * @param {number} localHour - The hour in the user's local timezone (0-23).
   * @param {string} timezoneIdentifier - The timezone identifier (e.g., 'America/New_York', 'EST', 'UTC').
   * @returns {number} The equivalent hour in UTC (0-23).
   */
  _convertLocalHourToUTC(localHour, timezoneIdentifier) {
    try {
      // Create a date object for today in the target timezone, at the specified localHour
      // This is a complex task due to DST and varying timezone definitions.
      // A robust library is highly recommended here.
      // For a simplified example (that might not handle DST correctly for all zones):
      const now = new Date(); // Use current date to get context for DST
      const targetDateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}T${String(localHour).padStart(2, '0')}:00:00`;

      // Using Intl.DateTimeFormat to guess offset - this is NOT ideal for production server logic
      // but avoids adding a large library for this example.
      // A better server-side approach involves mapping IANA timezone names to fixed offsets or using a date-time library.
      const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezoneIdentifier, hour12: false, hour: 'numeric', timeZoneName: 'shortOffset' });
      const parts = formatter.formatToParts(new Date(targetDateStr)); // Use a date object at localHour in some base (like UTC)
      const offsetPart = parts.find(part => part.type === 'timeZoneName');

      let offsetHours = 0;
      if (offsetPart && offsetPart.value.includes('GMT')) {
        const offsetMatch = offsetPart.value.match(/GMT([+-]\d+)/);
        if (offsetMatch && offsetMatch[1]) {
          offsetHours = parseInt(offsetMatch[1], 10);
        }
      } else {
         logger.warn(`Could not parse offset for timezone: ${timezoneIdentifier}. Assuming UTC.`, { timezoneIdentifier });
      }

      let utcHour = localHour - offsetHours;
      utcHour = (utcHour % 24 + 24) % 24; // Normalize to 0-23 range

      return utcHour;
    } catch (error) {
      logger.error('Timezone to UTC conversion error:', { localHour, timezoneIdentifier, message: error.message });
      return localHour; // Fallback: assume localHour is close enough to UTC hour or handle error appropriately
    }
  }

  /**
   * Processes the daily summary for an individual user.
   * Checks if a summary was recently generated, then calls the email processing service.
   * @async
   * @private
   * @param {User} user - The user document (with persona).
   * @returns {Promise<object>} Result of the summary processing for this user.
   */
  async _processUserSummary(user) {
    const processStartTime = Date.now();
    try {
      logger.info('Initiating daily summary processing for user.', { userId: user._id, email: user.email });

      if (await this._hasRecentSummary(user._id)) {
        logger.info('User already has a recent daily summary, skipping.', { userId: user._id });
        return { status: 'skipped', reason: 'recent_summary_exists', userId: user._id };
      }

      const processingOptions = {
        maxResults: user.persona?.maxEmailsPerSummary || parseInt(process.env.DEFAULT_MAX_EMAILS_PER_SUMMARY, 10) || 20,
        // Other options like 'after', 'includeRead' could be derived from persona or defaults
      };
      const result = await emailProcessingService.processDailyEmails(user._id, processingOptions);

      const durationMs = Date.now() - processStartTime;
      logger.info('Daily summary processing for user completed.', { userId: user._id, durationMs, result });
      return { status: 'completed', userId: user._id, result, durationMs };
    } catch (error) {
      const durationMs = Date.now() - processStartTime;
      logger.error('Failed to process daily summary for user:', { userId: user._id, email: user.email, durationMs, message: error.message, stack: error.stack.substring(0, 200) });
      return { status: 'failed', userId: user._id, error: error.message, durationMs };
    }
  }

  /**
   * Checks if a user has a daily summary generated recently (e.g., within the last 20 hours).
   * @async
   * @private
   * @param {string} userId - The ID of the user.
   * @returns {Promise<boolean>} True if a recent daily summary exists.
   */
  async _hasRecentSummary(userId) {
    try {
      // Define "recent" e.g., within the last 20-23 hours to avoid re-processing if job re-runs closely.
      const N_HOURS_AGO = 20;
      const thresholdDate = new Date();
      thresholdDate.setHours(thresholdDate.getHours() - N_HOURS_AGO);

      const recentSummary = await Summary.findOne({
        userId,
        type: 'daily',
        createdAt: { $gte: thresholdDate }, // Check if created after the threshold
      }).lean(); // .lean() for performance as we only need to check existence

      return !!recentSummary;
    } catch (error) {
      logger.error('Error checking for recent user summary:', { userId, message: error.message });
      return false; // Default to false (no recent summary) on error to allow processing attempt
    }
  }

  /**
   * Manually triggers summary processing for a specific user.
   * Useful for testing or admin actions.
   * @async
   * @param {string} userId - The ID of the user to process.
   * @returns {Promise<object>} Result of the summary processing.
   * @throws {Error} If user not found or Gmail not connected.
   */
  async processUserManually(userId) {
    logger.info('Manual daily summary processing triggered for user.', { userId });
    try {
      const user = await User.findById(userId).populate('persona').lean(); // Lean might be problematic if methods on user doc are needed by _processUserSummary
      if (!user) throw new Error(`User with ID ${userId} not found.`);
      
      const gmailProvider = user.providers?.find(p => p.provider === 'google' && p.isActive);
      if (!gmailProvider) throw new Error(`User ${userId} does not have an active Gmail connection.`);

      // Re-fetch full user document if _processUserSummary or its callees need Mongoose document methods
      const fullUserDoc = await User.findById(userId).populate('persona');
      const result = await this._processUserSummary(fullUserDoc);
      
      logger.info('Manual summary processing for user finished.', { userId, result });
      return result;
    } catch (error) {
      logger.error('Manual summary processing failed for user:', { userId, message: error.message });
      throw error; // Re-throw for the caller to handle
    }
  }

  /**
   * Gets the current status of the daily summary job.
   * @returns {{isRunning: boolean, isScheduled: boolean, nextRun: Date|null}} Job status.
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isScheduled: !!this.jobSchedule,
      nextRun: this.jobSchedule ? this.jobSchedule.nextDates(1)[0]?.toDate() : null, // Get next single run date
    };
  }

  /**
   * Utility function to introduce a delay.
   * @private
   * @param {number} ms - Milliseconds to delay.
   * @returns {Promise<void>}
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Processes daily summaries for all active users with Gmail connected.
   * Intended for admin use or specific scenarios, use with caution due to potential load.
   * @async
   * @returns {Promise<Array<object>>} An array of results for each user processed.
   */
  async processAllUsers() { // Caution: This can be resource-intensive.
    logger.warn('Initiating manual daily summary processing for ALL eligible users. This may take a while.');
    try {
      const allEligibleUsers = await User.find({
        isActive: true,
        'providers.provider': 'google',
        'providers.isActive': true,
      }).populate('persona'); // Populate persona for all

      logger.info(`Found ${allEligibleUsers.length} users for 'processAllUsers' task.`);
      const allResults = [];
      
      for (const user of allEligibleUsers) {
        try {
          const result = await this._processUserSummary(user); // Pass full Mongoose doc
          allResults.push(result);
          await this._delay(parseInt(process.env.JOB_ALL_USERS_DELAY_MS, 10) || 1000); // Delay between each user
        } catch (userError) {
          logger.error(`Failed to process summary for user during 'processAllUsers':`, { userId: user._id, message: userError.message });
          allResults.push({ status: 'failed_critical', userId: user._id, error: userError.message });
        }
      }
      logger.info(`Finished 'processAllUsers' task. Results count: ${allResults.length}`);
      return allResults;
    } catch (error) {
      logger.error("Critical error during 'processAllUsers':", { message: error.message });
      throw error;
    }
  }
}

module.exports = new DailySummaryJob();