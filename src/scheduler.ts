import TelegramBot from 'node-telegram-bot-api';
import cron from 'node-cron';
import { getAllSubscribedUsers, hasRecentLesson } from './db';
import { deliverNextLesson } from './commands/lesson';

/**
 * Returns the current hour and minute in the given IANA timezone.
 */
function getTimeInTimezone(timezone: string): { hour: number; minute: number } {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    // Intl hour12:false can return 24 for midnight in some environments
    return { hour: hour === 24 ? 0 : hour, minute };
  } catch {
    return { hour: -1, minute: -1 };
  }
}

/**
 * Initialise the daily lesson scheduler.
 * Runs every minute; delivers a lesson to users for whom it is currently 9:00 AM.
 */
export function initScheduler(bot: TelegramBot): void {
  console.log('[scheduler] Daily lesson scheduler started.');

  // Run at the start of every minute
  cron.schedule('* * * * *', async () => {
    const users = getAllSubscribedUsers();
    if (users.length === 0) return;

    const now = new Date();
    console.log(`[scheduler] Tick at ${now.toISOString()} — checking ${users.length} subscribed user(s)`);

    for (const user of users) {
      try {
        const { hour, minute } = getTimeInTimezone(user.timezone || 'UTC');

        // Deliver at 9:00 AM in the user's timezone
        if (hour !== 9 || minute !== 0) continue;

        // Guard against double delivery within 20 hours
        if (hasRecentLesson(user.telegram_id, 20)) {
          console.log(`[scheduler] Skipping ${user.telegram_id} — already delivered recently`);
          continue;
        }

        console.log(`[scheduler] Delivering to ${user.telegram_id} (${user.timezone})`);
        const chatId = parseInt(user.telegram_id, 10);
        await deliverNextLesson(bot, chatId, user.telegram_id);
      } catch (err) {
        console.error(`[scheduler] Failed delivery to ${user.telegram_id}:`, err);
      }
    }
  });
}
