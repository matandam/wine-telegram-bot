import TelegramBot from 'node-telegram-bot-api';
import { getLessonCount, incrementLessonCount, getUser } from '../db';
import { getNextRegionForUser } from '../regions';
import { generateRegionLesson, generateWineCard, generateBonusCard, generateBonusLesson } from '../lessons';
import { sendRegionMaps } from '../maps';
import bonusesRaw from '../../data/bonuses.json';

interface BonusTopic {
  index: number;
  title: string;
  category: string;
  description: string;
  lat?: number;
  lon?: number;
}

const BONUSES: BonusTopic[] = bonusesRaw as BonusTopic[];
const TOTAL_REGIONS = 126;

/** Deterministic Fisher-Yates shuffle seeded with a string (LCG PRNG). */
function shuffleBonusesWithSeed(arr: BonusTopic[], seed: string): BonusTopic[] {
  const result = [...arr];
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }
  let s = Math.abs(hash) || 1;
  const lcg = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0x100000000; };
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(lcg() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// In-memory store for pending full lessons (regionName keyed by callbackData)
// Format: "full_lesson:<telegramId>:<regionIndex>" or "full_bonus:<telegramId>:<bonusIndex>"
const pendingLessons = new Map<string, { regionName: string; regionIndex: number }>();
const pendingBonuses = new Map<string, BonusTopic>();

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

  // Hard cap — don't cycle, just congratulate
  if (lessonCount >= TOTAL_REGIONS) {
    await bot.sendMessage(
      chatId,
      '🏆 <b>You\'ve completed all 126 wine regions.</b>\n\nYou\'ve travelled from Barolo to Barossa, from Chablis to the Willamette Valley. That\'s a serious education.\n\n<i>More regions coming soon. In the meantime, use /grape to explore a specific variety, or /recommend for a personalised pick.</i>',
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Every 5th delivery is a bonus lesson (5th, 10th, 15th…)
  if ((lessonCount + 1) % 5 === 0) {
    await deliverBonusLesson(bot, chatId, telegramId, lessonCount);
    return;
  }

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

/**
 * Deliver a bonus lesson (every 5th delivery).
 */
async function deliverBonusLesson(
  bot: TelegramBot,
  chatId: number,
  telegramId: string,
  lessonCount: number
): Promise<void> {
  const bonusIndex = Math.floor(lessonCount / 5);
  const shuffled = shuffleBonusesWithSeed(BONUSES, telegramId + '_bonus');
  const bonus = shuffled[bonusIndex % BONUSES.length];

  await bot.sendChatAction(chatId, 'typing');

  // Village/sub-appellation bonuses get maps
  if (bonus.lat !== undefined && bonus.lon !== undefined) {
    await sendRegionMaps(bot, chatId, {
      name: bonus.title,
      country: '',
      lat: bonus.lat,
      lon: bonus.lon,
      index: bonus.index,
    } as Parameters<typeof sendRegionMaps>[2]);
  }

  // Generate and send the bonus card
  let card: string;
  try {
    card = await generateBonusCard(bonus.title, bonus.description, bonus.category);
  } catch (err) {
    console.error(`[lesson] Error generating bonus card for ${bonus.title}:`, err);
    await bot.sendMessage(chatId, '⚠️ I had trouble generating your bonus lesson. Please try again.');
    return;
  }

  const callbackData = `full_bonus:${telegramId}:${bonus.index}`;
  pendingBonuses.set(callbackData, bonus);

  await bot.sendMessage(chatId, `🎁 <b>Bonus lesson!</b> (every 5th delivery)\n\n` + card, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: '📖 Read full lesson →', callback_data: callbackData }
      ]]
    }
  });

  incrementLessonCount(telegramId);
}

/**
 * Handle the "Read full lesson" button for bonus topics.
 */
export async function handleFullBonusCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery
): Promise<void> {
  const chatId = query.message?.chat.id;
  const callbackData = query.data ?? '';
  if (!chatId || !callbackData.startsWith('full_bonus:')) return;

  await bot.answerCallbackQuery(query.id, { text: 'Generating full lesson…' });

  const bonus = pendingBonuses.get(callbackData);
  if (!bonus) {
    // Fallback: try to find from bonuses by index in callback data
    const bonusIndex = parseInt(callbackData.split(':')[2] ?? '-1', 10);
    const found = BONUSES.find(b => b.index === bonusIndex);
    if (!found) {
      await bot.sendMessage(chatId, '⚠️ Could not find that bonus lesson. Please request a new /lesson.');
      return;
    }
    await deliverFullBonus(bot, chatId, found);
    return;
  }

  pendingBonuses.delete(callbackData);
  await deliverFullBonus(bot, chatId, bonus);
}

async function deliverFullBonus(bot: TelegramBot, chatId: number, bonus: BonusTopic): Promise<void> {
  await bot.sendChatAction(chatId, 'typing');

  let parts: string[];
  try {
    parts = await generateBonusLesson(bonus.title, bonus.description, bonus.category);
  } catch (err) {
    console.error(`[lesson] Error generating full bonus lesson for ${bonus.title}:`, err);
    await bot.sendMessage(chatId, '⚠️ I had trouble generating the full lesson. Please try again.');
    return;
  }

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
