import TelegramBot from 'node-telegram-bot-api';
import { getUser, updateUserSubscription, updateUserTimezone, setUserState, clearUserState } from '../db';

// Common timezones displayed as friendly labels → IANA names
export const COMMON_TIMEZONES: Record<string, string> = {
  'UTC': 'UTC',
  'Israel / Jerusalem': 'Asia/Jerusalem',
  'New York (EST/EDT)': 'America/New_York',
  'Chicago (CST/CDT)': 'America/Chicago',
  'Denver (MST/MDT)': 'America/Denver',
  'Los Angeles (PST/PDT)': 'America/Los_Angeles',
  'London (GMT/BST)': 'Europe/London',
  'Paris / Berlin (CET/CEST)': 'Europe/Paris',
  'Helsinki / Kyiv (EET)': 'Europe/Helsinki',
  'Moscow (MSK)': 'Europe/Moscow',
  'Tel Aviv / Beirut': 'Asia/Jerusalem',
  'Dubai (GST)': 'Asia/Dubai',
  'Mumbai (IST)': 'Asia/Kolkata',
  'Bangkok (ICT)': 'Asia/Bangkok',
  'Singapore / HK (SGT)': 'Asia/Singapore',
  'Tokyo (JST)': 'Asia/Tokyo',
  'Sydney (AEDT/AEST)': 'Australia/Sydney',
  'Auckland (NZST/NZDT)': 'Pacific/Auckland',
};

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function handleDaily(bot: TelegramBot, msg: TelegramBot.Message): void {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from?.id ?? chatId);
  const user = getUser(telegramId);

  if (user?.subscribed === 1) {
    // User is already subscribed — offer to unsubscribe
    const tz = user.timezone || 'UTC';
    bot.sendMessage(
      chatId,
      `✅ You are currently subscribed to daily lessons at <b>9:00 AM ${escapeHtml(tz)}</b>.\n\nUse /stop to unsubscribe.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Ask for timezone
  setUserState(telegramId, { command: 'daily', step: 'awaiting_timezone', answers: {} });

  const tzRows = buildTimezoneKeyboard();

  bot.sendMessage(
    chatId,
    '🌍 <b>Choose your timezone</b> so I can deliver your lesson at 9:00 AM local time.\n\nSelect from the list below, or type a custom IANA timezone (e.g. <code>America/Chicago</code>):',
    {
      parse_mode: 'HTML',
      reply_markup: {
        keyboard: tzRows,
        one_time_keyboard: true,
        resize_keyboard: true,
      },
    }
  );
}

function buildTimezoneKeyboard(): TelegramBot.KeyboardButton[][] {
  const labels = Object.keys(COMMON_TIMEZONES);
  const rows: TelegramBot.KeyboardButton[][] = [];
  // 2 buttons per row
  for (let i = 0; i < labels.length; i += 2) {
    const row: TelegramBot.KeyboardButton[] = [{ text: labels[i] }];
    if (i + 1 < labels.length) row.push({ text: labels[i + 1] });
    rows.push(row);
  }
  return rows;
}

/** Called from index.ts when user is in daily/awaiting_timezone state */
export function handleTimezoneReply(
  bot: TelegramBot,
  msg: TelegramBot.Message
): void {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from?.id ?? chatId);
  const input = (msg.text ?? '').trim();

  // Check if they sent a friendly label (from the keyboard)
  let ianaTimezone = COMMON_TIMEZONES[input] ?? input;

  if (!isValidTimezone(ianaTimezone)) {
    bot.sendMessage(
      chatId,
      `❌ <b>"${escapeHtml(input)}"</b> is not a recognised timezone.\n\nPlease select from the keyboard or type a valid IANA timezone (e.g. <code>Europe/Berlin</code>).`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Save and subscribe
  updateUserTimezone(telegramId, ianaTimezone);
  updateUserSubscription(telegramId, true);
  clearUserState(telegramId);

  bot.sendMessage(
    chatId,
    `✅ <b>Subscribed!</b> You'll receive a wine lesson every day at <b>9:00 AM ${escapeHtml(ianaTimezone)}</b>.\n\nUse /stop at any time to unsubscribe.`,
    {
      parse_mode: 'HTML',
      reply_markup: { remove_keyboard: true },
    }
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
