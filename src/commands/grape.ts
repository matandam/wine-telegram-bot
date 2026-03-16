import TelegramBot from 'node-telegram-bot-api';
import { generateGrapeLesson } from '../lessons';

export async function handleGrape(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  match: RegExpExecArray | null
): Promise<void> {
  const chatId = msg.chat.id;

  const rawArg = (match?.[1] ?? '').trim();

  if (!rawArg) {
    await bot.sendMessage(
      chatId,
      '🍇 Usage: <b>/grape [name]</b>\n\nExamples:\n• /grape Nebbiolo\n• /grape Riesling\n• /grape Sangiovese\n• /grape Chenin Blanc',
      { parse_mode: 'HTML' }
    );
    return;
  }

  const displayName = capitalise(rawArg);

  await bot.sendChatAction(chatId, 'typing');
  await bot.sendMessage(
    chatId,
    `🍇 Generating deep dive on <b>${escapeHtml(displayName)}</b>…`,
    { parse_mode: 'HTML' }
  );
  await bot.sendChatAction(chatId, 'typing');

  let parts: string[];
  try {
    parts = await generateGrapeLesson(displayName);
  } catch (err) {
    console.error(`[grape] Error generating lesson for "${displayName}":`, err);
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
