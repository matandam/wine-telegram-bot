import TelegramBot from 'node-telegram-bot-api';
import { addLessonHistory } from '../db';
import { getNextRegionForUser } from '../regions';
import { generateRegionLesson } from '../lessons';
import { sendRegionMaps } from '../maps';

/**
 * Delivers the next unseen region lesson to a user.
 * Used by both the /lesson command and the daily scheduler.
 */
export async function deliverNextLesson(
  bot: TelegramBot,
  chatId: number,
  telegramId: string
): Promise<void> {
  const region = getNextRegionForUser(telegramId);

  if (!region) {
    await bot.sendMessage(
      chatId,
      '🏆 <b>Incredible — you\'ve completed all 60 regions!</b>\n\nYou\'ve received lessons for every wine region in my curriculum. Use /region or /grape for specific deep dives anytime.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await bot.sendChatAction(chatId, 'typing');

  // Send contextual maps: wide (country context) + close (the region itself)
  await sendRegionMaps(bot, chatId, region);

  let parts: string[];
  try {
    parts = await generateRegionLesson(region.name);
  } catch (err) {
    console.error(`[lesson] Error generating lesson for ${region.name}:`, err);
    await bot.sendMessage(
      chatId,
      '⚠️ I had trouble generating your lesson just now. Please try again in a moment.'
    );
    return;
  }

  // Record the delivery before sending (prevents double-delivery on crash)
  addLessonHistory(telegramId, region.index);

  for (const part of parts) {
    await bot.sendMessage(chatId, part, { parse_mode: 'HTML' });
    if (parts.length > 1) await sleep(300);
  }
}

export async function handleLesson(
  bot: TelegramBot,
  msg: TelegramBot.Message
): Promise<void> {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from?.id ?? chatId);

  await deliverNextLesson(bot, chatId, telegramId);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
