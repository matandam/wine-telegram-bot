import TelegramBot from 'node-telegram-bot-api';
import { getLessonCount, incrementLessonCount, getUser } from '../db';
import { getNextRegionForUser } from '../regions';
import { generateRegionLesson, generateWineCard } from '../lessons';
import { sendRegionMaps } from '../maps';

// In-memory store for pending full lessons (regionName keyed by callbackData)
// Format: "full_lesson:<telegramId>:<regionName>"
const pendingLessons = new Map<string, { regionName: string; regionIndex: number }>();

/**
 * Delivers the next unseen region lesson to a user.
 * First sends a short WSET-style card + "Read full lesson" button.
 * Full lesson is delivered when the user taps the button.
 */
export async function deliverNextLesson(
  bot: TelegramBot,
  chatId: number,
  telegramId: string
): Promise<void> {
  const lessonCount = getLessonCount(telegramId);
  const regionOffset = getUser(telegramId)?.region_offset ?? 0;
  const region = getNextRegionForUser(telegramId, lessonCount, regionOffset);

  await bot.sendChatAction(chatId, 'typing');

  // Send contextual maps: wide (country context) + close (the region itself)
  await sendRegionMaps(bot, chatId, region);

  // Generate and send the short card
  let card: string;
  try {
    card = await generateWineCard(region.name);
  } catch (err) {
    console.error(`[lesson] Error generating card for ${region.name}:`, err);
    await bot.sendMessage(chatId, '⚠️ I had trouble generating your lesson just now. Please try again in a moment.');
    return;
  }

  // Store the pending full lesson
  const callbackData = `full_lesson:${telegramId}:${region.index}`;
  pendingLessons.set(callbackData, { regionName: region.name, regionIndex: region.index });

  // Send card with inline button
  await bot.sendMessage(chatId, card, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '📖 Read full lesson →', callback_data: callbackData }
      ]]
    }
  });

  // Record delivery now (card counts as delivery)
  incrementLessonCount(telegramId);
}

/**
 * Handle the "Read full lesson" button press.
 */
export async function handleFullLessonCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery
): Promise<void> {
  const chatId = query.message?.chat.id;
  const callbackData = query.data ?? '';
  if (!chatId || !callbackData.startsWith('full_lesson:')) return;

  // Acknowledge the button press immediately
  await bot.answerCallbackQuery(query.id, { text: 'Generating full lesson…' });

  const pending = pendingLessons.get(callbackData);
  const regionName = pending?.regionName ?? callbackData.split(':')[2] ?? 'Unknown';

  await bot.sendChatAction(chatId, 'typing');

  let parts: string[];
  try {
    parts = await generateRegionLesson(regionName);
  } catch (err) {
    console.error(`[lesson] Error generating full lesson for ${regionName}:`, err);
    await bot.sendMessage(chatId, '⚠️ I had trouble generating the full lesson. Please try again in a moment.');
    return;
  }

  pendingLessons.delete(callbackData);

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
