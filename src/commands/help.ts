import TelegramBot from 'node-telegram-bot-api';

export function handleHelp(bot: TelegramBot, msg: TelegramBot.Message): void {
  const chatId = msg.chat.id;

  const helpText = `🍷 <b>Wine Education Bot — Commands</b>

<b>Lessons</b>
/lesson — Get the next lesson (rotates through all 60 world regions)
/region [name] — Deep dive on a specific region (e.g. /region Barolo)
/grape [name] — Deep dive on a specific grape (e.g. /grape Riesling)

<b>Daily Subscription</b>
/daily — Subscribe to a lesson every morning at 9 AM your time
/stop — Unsubscribe from daily lessons

<b>Recommendations</b>
/recommend — Answer 3 questions, get a personalised wine suggestion

<b>Stats & Info</b>
/mystats — See your lessons received and regions covered
/start — Show the welcome message
/help — Show this menu

<b>About</b>
• I cover 60 wine regions across 15 countries
• Each lesson includes terroir, history, sensory profile, producer picks, and food pairing
• I only discuss wine — no general chat

<i>Tip: Try /lesson to get started, or /region Champagne for a specific region.</i>`;

  bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
}
