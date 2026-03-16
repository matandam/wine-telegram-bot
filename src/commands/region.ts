import TelegramBot from 'node-telegram-bot-api';
import { generateRegionLesson } from '../lessons';
import { findRegionByName } from '../regions';
import { sendRegionMaps } from '../maps';

export async function handleRegion(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  match: RegExpExecArray | null
): Promise<void> {
  const chatId = msg.chat.id;

  // Extract region name from the command argument
  const rawArg = (match?.[1] ?? '').trim();

  if (!rawArg) {
    await bot.sendMessage(
      chatId,
      '🍷 Usage: <b>/region [name]</b>\n\nExamples:\n• /region Barolo\n• /region Burgundy\n• /region Napa Valley\n• /region Rías Baixas',
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Friendly confirmation if we recognise the region
  const known = findRegionByName(rawArg);
  const displayName = known ? known.name : capitalise(rawArg);

  await bot.sendChatAction(chatId, 'typing');
  await bot.sendMessage(
    chatId,
    `🔍 Generating deep dive on <b>${escapeHtml(displayName)}</b>…`,
    { parse_mode: 'HTML' }
  );

  // Send contextual maps: wide (country context) + close (the region itself)
  if (known) {
    await sendRegionMaps(bot, chatId, known);
  }

  await bot.sendChatAction(chatId, 'typing');

  let parts: string[];
  try {
    parts = await generateRegionLesson(displayName);
  } catch (err) {
    console.error(`[region] Error generating lesson for "${displayName}":`, err);
    await bot.sendMessage(
      chatId,
      '⚠️ I had trouble generating that lesson. Please try again in a moment.'
    );
    return;
  }

  for (const part of parts) {
    await bot.sendMessage(chatId, part, { parse_mode: 'HTML' });
    if (parts.length > 1) await sleep(300);
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function capitalise(text: string): string {
  return text
    .split(' ')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
