import TelegramBot from 'node-telegram-bot-api';
import { getUser, updateUserSubscription } from '../db';

export function handleStop(bot: TelegramBot, msg: TelegramBot.Message): void {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from?.id ?? chatId);
  const user = getUser(telegramId);

  if (!user || user.subscribed === 0) {
    bot.sendMessage(
      chatId,
      "ℹ️ You don't have an active daily subscription.\n\nUse /daily to subscribe to morning wine lessons."
    );
    return;
  }

  updateUserSubscription(telegramId, false);

  bot.sendMessage(
    chatId,
    '✅ <b>Unsubscribed.</b> You will no longer receive daily lessons.\n\nYou can still use /lesson, /region, and /grape anytime.\nUse /daily to re-subscribe.',
    { parse_mode: 'HTML' }
  );
}
