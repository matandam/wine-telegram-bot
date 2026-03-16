import TelegramBot from 'node-telegram-bot-api';
import { upsertUser, getUser } from '../db';

export function handleStart(bot: TelegramBot, msg: TelegramBot.Message): void {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from?.id ?? chatId);
  const username = msg.from?.username ?? null;
  const firstName = msg.from?.first_name ?? 'Wine Lover';

  upsertUser(telegramId, username, firstName);
  const user = getUser(telegramId);
  const isSubscribed = (user?.subscribed ?? 0) === 1;

  const welcomeText = `🍷 <b>Welcome to the Wine Education Bot, ${escapeHtml(firstName)}!</b>

I'm your personal sommelier for wine learning. Each lesson covers a different wine region or grape in depth — terroir, history, sensory profiles, producer recommendations, and more.

<b>What I can do:</b>
• /lesson — Get today's lesson (a new region you haven't seen)
• /region Barolo — Deep dive on any specific region
• /grape Nebbiolo — Deep dive on any grape variety
• /daily — Subscribe to a lesson every morning at 9 AM your time
• /recommend — Answer 3 quick questions, get a personalised recommendation
• /mystats — See your learning progress
• /help — Full command list

${isSubscribed ? '✅ You already have daily lessons active.' : '💡 Use /daily to subscribe to morning wine lessons.'}

I only discuss wine. I won't engage in general conversation — but ask me about any region or grape and I'll go deep.

<i>Let's start learning. Try /lesson now.</i>`;

  bot.sendMessage(chatId, welcomeText, { parse_mode: 'HTML' });
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
