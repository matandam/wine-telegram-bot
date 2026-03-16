import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { upsertUser, getUserState, clearUserState } from './db';
import { initScheduler } from './scheduler';

// ─── Command handlers ──────────────────────────────────────────────────────
import { handleStart } from './commands/start';
import { handleHelp } from './commands/help';
import { handleDaily, handleTimezoneReply } from './commands/daily';
import { handleStop } from './commands/stop';
import { handleLesson } from './commands/lesson';
import { handleRegion } from './commands/region';
import { handleGrape } from './commands/grape';
import { handleRecommend, handleRecommendReply } from './commands/recommend';
import { handleMyStats } from './commands/mystats';

// ─── Env validation ────────────────────────────────────────────────────────

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('FATAL: TELEGRAM_BOT_TOKEN is not set.');
  process.exit(1);
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY is not set.');
  process.exit(1);
}

// ─── Bot initialisation ────────────────────────────────────────────────────

const bot = new TelegramBot(TOKEN, {
  polling: {
    interval: 1000,
    autoStart: true,
    params: { timeout: 30 },
  },
});

console.log('[bot] Wine Education Bot starting…');

// ─── Register commands with Telegram (best-effort) ─────────────────────────

bot.setMyCommands([
  { command: 'start',     description: 'Welcome message & onboarding' },
  { command: 'help',      description: 'Show all commands' },
  { command: 'lesson',    description: 'Get the next wine region lesson' },
  { command: 'region',    description: 'Deep dive on a region (e.g. /region Barolo)' },
  { command: 'grape',     description: 'Deep dive on a grape (e.g. /grape Riesling)' },
  { command: 'daily',     description: 'Subscribe to daily 9 AM lessons' },
  { command: 'stop',      description: 'Unsubscribe from daily lessons' },
  { command: 'recommend', description: 'Get a personalised wine recommendation' },
  { command: 'mystats',   description: 'View your learning progress' },
]).catch(err => console.warn('[bot] Failed to set commands:', err));

// ─── Command routing ───────────────────────────────────────────────────────

bot.onText(/^\/start(@\w+)?$/, (msg) => {
  ensureUser(msg);
  handleStart(bot, msg);
});

bot.onText(/^\/help(@\w+)?$/, (msg) => {
  ensureUser(msg);
  handleHelp(bot, msg);
});

bot.onText(/^\/daily(@\w+)?$/, (msg) => {
  ensureUser(msg);
  handleDaily(bot, msg);
});

bot.onText(/^\/stop(@\w+)?$/, (msg) => {
  ensureUser(msg);
  handleStop(bot, msg);
});

bot.onText(/^\/lesson(@\w+)?$/, async (msg) => {
  ensureUser(msg);
  await handleLesson(bot, msg);
});

// /region accepts the rest of the line as region name
bot.onText(/^\/region(?:@\w+)?(?:\s+(.+))?$/, async (msg, match) => {
  ensureUser(msg);
  await handleRegion(bot, msg, match ?? null);
});

// /grape accepts the rest of the line as grape name
bot.onText(/^\/grape(?:@\w+)?(?:\s+(.+))?$/, async (msg, match) => {
  ensureUser(msg);
  await handleGrape(bot, msg, match ?? null);
});

bot.onText(/^\/recommend(@\w+)?$/, (msg) => {
  ensureUser(msg);
  handleRecommend(bot, msg);
});

bot.onText(/^\/mystats(@\w+)?$/, (msg) => {
  ensureUser(msg);
  handleMyStats(bot, msg);
});

// ─── Text message handler (for multi-step flows & unrecognised messages) ───

bot.on('message', async (msg) => {
  // Only handle plain text messages; commands are routed above
  if (!msg.text || msg.text.startsWith('/')) return;

  const telegramId = String(msg.from?.id ?? msg.chat.id);
  const state = getUserState(telegramId);

  if (state?.command === 'daily' && state.step === 'awaiting_timezone') {
    handleTimezoneReply(bot, msg);
    return;
  }

  if (state?.command === 'recommend') {
    await handleRecommendReply(bot, msg);
    return;
  }

  // No active state — reject with scope message
  bot.sendMessage(
    msg.chat.id,
    '🍷 I am a wine education bot. Use /help to see what I can do.'
  );
});

// ─── Error handling ────────────────────────────────────────────────────────

bot.on('polling_error', (err) => {
  console.error('[bot] Polling error:', err.message);
  // Auto-restart polling on network errors
  setTimeout(() => {
    console.log('[bot] Restarting polling...');
    bot.startPolling();
  }, 5000);
});

bot.on('error', (err) => {
  console.error('[bot] Error:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[bot] Unhandled promise rejection:', reason);
});

// ─── Start scheduler ───────────────────────────────────────────────────────

initScheduler(bot);

console.log('[bot] Ready and polling for messages.');

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Auto-register any user who interacts with the bot. */
function ensureUser(msg: TelegramBot.Message): void {
  const telegramId = String(msg.from?.id ?? msg.chat.id);
  const username = msg.from?.username ?? null;
  const firstName = msg.from?.first_name ?? null;
  upsertUser(telegramId, username, firstName);
}
