import TelegramBot from 'node-telegram-bot-api';
import { getUserState, setUserState, clearUserState } from '../db';
import { generateRecommendation } from '../lessons';

// ─── Step definitions ──────────────────────────────────────────────────────

const STEPS = {
  COLOR: 'awaiting_color',
  STYLE: 'awaiting_style',
  OCCASION: 'awaiting_occasion',
};

const COLOR_OPTIONS = ['Red', 'White', 'Rosé', 'Sparkling / Champagne', 'No preference'];
const STYLE_OPTIONS = ['Light & delicate', 'Medium-bodied', 'Full & powerful', 'No preference'];
const OCCASION_OPTIONS = ['Casual weeknight', 'Special occasion', 'Food pairing (dinner)', 'Gift / discovery'];

// ─── Entry point ───────────────────────────────────────────────────────────

export function handleRecommend(bot: TelegramBot, msg: TelegramBot.Message): void {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from?.id ?? chatId);

  setUserState(telegramId, { command: 'recommend', step: STEPS.COLOR, answers: {} });

  bot.sendMessage(
    chatId,
    '🍾 <b>Let\'s find your perfect wine.</b>\n\n<b>Question 1 of 3:</b> What colour are you in the mood for?',
    {
      parse_mode: 'HTML',
      reply_markup: buildKeyboard(COLOR_OPTIONS),
    }
  );
}

// ─── State machine handler (called from index.ts for text messages) ─────────

export async function handleRecommendReply(
  bot: TelegramBot,
  msg: TelegramBot.Message
): Promise<void> {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from?.id ?? chatId);
  const text = (msg.text ?? '').trim();
  const state = getUserState(telegramId);

  if (!state || state.command !== 'recommend') return;

  switch (state.step) {
    case STEPS.COLOR: {
      if (!COLOR_OPTIONS.includes(text)) {
        bot.sendMessage(chatId, 'Please select one of the options below.', {
          reply_markup: buildKeyboard(COLOR_OPTIONS),
        });
        return;
      }
      setUserState(telegramId, {
        ...state,
        step: STEPS.STYLE,
        answers: { color: text },
      });
      bot.sendMessage(
        chatId,
        '<b>Question 2 of 3:</b> What style are you after?',
        {
          parse_mode: 'HTML',
          reply_markup: buildKeyboard(STYLE_OPTIONS),
        }
      );
      break;
    }

    case STEPS.STYLE: {
      if (!STYLE_OPTIONS.includes(text)) {
        bot.sendMessage(chatId, 'Please select one of the options below.', {
          reply_markup: buildKeyboard(STYLE_OPTIONS),
        });
        return;
      }
      setUserState(telegramId, {
        ...state,
        step: STEPS.OCCASION,
        answers: { ...state.answers, style: text },
      });
      bot.sendMessage(
        chatId,
        '<b>Question 3 of 3:</b> What\'s the occasion?',
        {
          parse_mode: 'HTML',
          reply_markup: buildKeyboard(OCCASION_OPTIONS),
        }
      );
      break;
    }

    case STEPS.OCCASION: {
      if (!OCCASION_OPTIONS.includes(text)) {
        bot.sendMessage(chatId, 'Please select one of the options below.', {
          reply_markup: buildKeyboard(OCCASION_OPTIONS),
        });
        return;
      }

      const answers: Record<string, string> = { ...state.answers, occasion: text };
      clearUserState(telegramId);

      await bot.sendMessage(
        chatId,
        '✨ <b>Perfect — generating your recommendation…</b>',
        {
          parse_mode: 'HTML',
          reply_markup: { remove_keyboard: true },
        }
      );
      await bot.sendChatAction(chatId, 'typing');

      let parts: string[];
      try {
        parts = await generateRecommendation({
          color: answers.color ?? 'No preference',
          style: answers.style ?? 'No preference',
          occasion: answers.occasion ?? 'Casual',
        });
      } catch (err) {
        console.error('[recommend] Error generating recommendation:', err);
        await bot.sendMessage(
          chatId,
          '⚠️ I had trouble generating your recommendation. Please try /recommend again.'
        );
        return;
      }

      for (const part of parts) {
        await bot.sendMessage(chatId, part, { parse_mode: 'HTML' });
        if (parts.length > 1) await sleep(300);
      }
      break;
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildKeyboard(options: string[]): TelegramBot.ReplyKeyboardMarkup {
  const rows: TelegramBot.KeyboardButton[][] = options.map(opt => [{ text: opt }]);
  return {
    keyboard: rows,
    one_time_keyboard: true,
    resize_keyboard: true,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
