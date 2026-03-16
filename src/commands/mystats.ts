import TelegramBot from 'node-telegram-bot-api';
import { getUser, getUserLessonCount } from '../db';
import { getRegionsCoveredByUser, getAllRegions } from '../regions';

export function handleMyStats(bot: TelegramBot, msg: TelegramBot.Message): void {
  const chatId = msg.chat.id;
  const telegramId = String(msg.from?.id ?? chatId);
  const user = getUser(telegramId);

  if (!user) {
    bot.sendMessage(chatId, 'Use /start first to register.');
    return;
  }

  const totalRegions = getAllRegions().length;
  const lessonsReceived = getUserLessonCount(telegramId);
  const covered = getRegionsCoveredByUser(telegramId);
  const isSubscribed = user.subscribed === 1;
  const memberSince = user.created_at.split('T')[0] ?? user.created_at.slice(0, 10);
  const firstName = user.first_name ?? 'Wine Lover';

  // Group covered regions by country for a nice summary
  const byCountry: Record<string, string[]> = {};
  for (const region of covered) {
    if (!byCountry[region.country]) byCountry[region.country] = [];
    byCountry[region.country].push(region.name);
  }

  const countryLines = Object.entries(byCountry)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([country, regions]) => `• ${escapeHtml(country)}: ${regions.map(r => escapeHtml(r)).join(', ')}`)
    .join('\n');

  const progressBar = buildProgressBar(lessonsReceived, totalRegions);
  const completionPct = Math.round((lessonsReceived / totalRegions) * 100);

  let statsText = `🍷 <b>Your Wine Journey — ${escapeHtml(firstName)}</b>\n\n`;
  statsText += `${progressBar} ${completionPct}%\n`;
  statsText += `<b>Lessons received:</b> ${lessonsReceived} / ${totalRegions} regions\n`;
  statsText += `<b>Member since:</b> ${memberSince}\n`;
  statsText += `<b>Daily lessons:</b> ${isSubscribed ? `✅ Active (9:00 AM ${escapeHtml(user.timezone)})` : '❌ Off — use /daily to subscribe'}\n`;

  if (covered.length > 0) {
    statsText += `\n<b>Regions explored:</b>\n${countryLines}`;
  } else {
    statsText += '\n\n<i>No regions explored yet. Use /lesson to start!</i>';
  }

  if (lessonsReceived === totalRegions) {
    statsText += '\n\n🏆 <b>You\'ve completed all 60 regions. Extraordinary!</b>';
  } else {
    const remaining = totalRegions - lessonsReceived;
    statsText += `\n\n<i>${remaining} region${remaining !== 1 ? 's' : ''} still to discover.</i>`;
  }

  bot.sendMessage(chatId, statsText, { parse_mode: 'HTML' });
}

function buildProgressBar(current: number, total: number): string {
  const filled = Math.round((current / total) * 10);
  const empty = 10 - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
