import TelegramBot from 'node-telegram-bot-api';
import { getUserState, setUserState, clearUserState, saveUserPreferences } from '../db';
import { generateRecommendation, generateFreshRecommendation } from '../lessons';

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

      const prefs = {
        color: answers.color ?? 'No preference',
        style: answers.style ?? 'No preference',
        occasion: answers.occasion ?? 'Casual',
      };

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
        parts = await generateRecommendation(prefs);
      } catch (err) {
        console.error('[recommend] Error generating recommendation:', err);
        await bot.sendMessage(
          chatId,
          '⚠️ I had trouble generating your recommendation. Please try /recommend again.'
        );
        return;
      }

      saveUserPreferences(telegramId, prefs.color, prefs.style, prefs.occasion);

      const prefsEncoded = encodePrefs(prefs.color, prefs.style, prefs.occasion);
      for (let i = 0; i < parts.length; i++) {
        const isLast = i === parts.length - 1;
        await bot.sendMessage(chatId, parts[i], {
          parse_mode: 'HTML',
          ...(isLast && {
            reply_markup: {
              inline_keyboard: [[
                { text: '🔄 Different preferences', callback_data: `rec_restart:${telegramId}` },
                { text: '🍾 Show me something else', callback_data: `rec_different:${telegramId}:${prefsEncoded}` },
              ]],
            },
          }),
        });
        if (!isLast) await sleep(300);
      }
      break;
    }
  }
}

// ─── Inline button callbacks ───────────────────────────────────────────────

export async function handleRecommendCallback(
  bot: TelegramBot,
  query: TelegramBot.CallbackQuery
): Promise<void> {
  const chatId = query.message?.chat.id;
  const data = query.data ?? '';
  if (!chatId) return;

  if (data.startsWith('rec_restart:')) {
    await bot.answerCallbackQuery(query.id);
    // Re-trigger the full 3-question flow for the user from the callback
    const telegramId = data.split(':')[1] ?? String(query.from.id);
    setUserState(telegramId, { command: 'recommend', step: STEPS.COLOR, answers: {} });
    await bot.sendMessage(
      chatId,
      '🍾 <b>Let\'s find your perfect wine.</b>\n\n<b>Question 1 of 3:</b> What colour are you in the mood for?',
      {
        parse_mode: 'HTML',
        reply_markup: buildKeyboard(COLOR_OPTIONS),
      }
    );
    return;
  }

  if (data.startsWith('rec_different:')) {
    await bot.answerCallbackQuery(query.id, { text: 'Finding something different…' });
    const parts = data.split(':');
    // Format: rec_different:<telegramId>:<color>|||<style>|||<occasion>
    const prefsStr = parts.slice(2).join(':');
    const prefs = decodePrefs(prefsStr);

    await bot.sendChatAction(chatId, 'typing');
    let result: string[];
    try {
      result = await generateFreshRecommendation(prefs);
    } catch (err) {
      console.error('[recommend] Error generating fresh recommendation:', err);
      await bot.sendMessage(chatId, '⚠️ Could not generate a new recommendation. Please try again.');
      return;
    }

    const prefsEncoded = encodePrefs(prefs.color, prefs.style, prefs.occasion);
    const telegramId = parts[1] ?? String(query.from.id);
    for (let i = 0; i < result.length; i++) {
      const isLast = i === result.length - 1;
      await bot.sendMessage(chatId, result[i], {
        parse_mode: 'HTML',
        ...(isLast && {
          reply_markup: {
            inline_keyboard: [[
              { text: '🔄 Different preferences', callback_data: `rec_restart:${telegramId}` },
              { text: '🍾 Show me something else', callback_data: `rec_different:${telegramId}:${prefsEncoded}` },
            ]],
          },
        }),
      });
      if (!isLast) await sleep(300);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Encode prefs for callback_data (max 64 bytes in Telegram). Uses ||| separator. */
function encodePrefs(color: string, style: string, occasion: string): string {
  return `${color}|||${style}|||${occasion}`;
}

function decodePrefs(encoded: string): { color: string; style: string; occasion: string } {
  const [color = 'No preference', style = 'No preference', occasion = 'Casual'] = encoded.split('|||');
  return { color, style, occasion };
}

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
