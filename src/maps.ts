import TelegramBot from 'node-telegram-bot-api';
import https from 'https';
import http from 'http';
import { Region } from './regions';

/**
 * Sends two contextual map images for a wine region:
 * 1. Wide view — country context (where in the world is this?)
 * 2. Close view — the actual wine region zoomed in
 *
 * Images are fetched server-side as Buffers and sent directly,
 * bypassing Telegram's URL fetcher entirely.
 */
export async function sendRegionMaps(
  bot: TelegramBot,
  chatId: number,
  region: Region
): Promise<void> {
  if (region.lat === undefined || region.lon === undefined) return;

  const { lat, lon, name, country } = region;
  const wideZoom = getWideZoom(region);
  const closeZoom = 9;

  try {
    // Fetch both images in parallel
    const [wideImg, closeImg] = await Promise.all([
      fetchMapImage(lat, lon, wideZoom),
      fetchMapImage(lat, lon, closeZoom),
    ]);

    // Send as two separate photos — more reliable than sendMediaGroup
    await bot.sendPhoto(chatId, wideImg, {
      caption: `🌍 ${name} in ${country}`,
    });
    await bot.sendPhoto(chatId, closeImg, {
      caption: `📍 The ${name} wine region`,
    });

  } catch (err) {
    console.error(`[maps] Failed to send region maps for "${name}":`, err);
    // Graceful fallback — plain location pin
    try {
      await bot.sendLocation(chatId, lat, lon);
    } catch {
      // Skip silently if even that fails
    }
  }
}

/**
 * Build a Yandex static map URL and fetch it as a Buffer.
 * Yandex static maps are free, no API key required, and reliably accessible.
 */
function fetchMapImage(lat: number, lon: number, zoom: number): Promise<Buffer> {
  const url =
    `https://static-maps.yandex.ru/1.x/` +
    `?ll=${lon},${lat}` +
    `&z=${zoom}` +
    `&l=map` +
    `&size=640,400` +
    `&pt=${lon},${lat},pm2rdm`;

  return fetchBuffer(url);
}

/**
 * Fetch a URL and return its body as a Buffer.
 * Follows one level of redirects (301/302).
 */
function fetchBuffer(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    lib.get(url, { headers: { 'User-Agent': 'WineBot/1.0' } }, (res) => {
      // Follow redirects
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Choose a sensible wide-zoom level based on geography.
 * Smaller countries / islands need less zoom-out; large continents need more.
 */
function getWideZoom(region: Region): number {
  const islands = ['Madeira', 'Canary Islands', 'Santorini', 'Etna', 'Corsica'];
  const largeCountries = ['USA', 'Australia', 'Argentina', 'Chile', 'South Africa', 'Canada'];
  const smallCountries = ['Israel', 'Lebanon', 'Georgia', 'Hungary', 'Austria', 'Greece'];

  if (islands.some(i => region.name.includes(i))) return 7;
  if (largeCountries.includes(region.country)) return 5;
  if (smallCountries.includes(region.country)) return 7;
  return 6; // default: France, Italy, Spain, Germany, Portugal, NZ etc.
}
