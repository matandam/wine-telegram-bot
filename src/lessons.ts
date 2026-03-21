import Anthropic from '@anthropic-ai/sdk';
import { getCachedContent, setCachedContent } from './db';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';

// ─── System Prompt ─────────────────────────────────────────────────────────

const WINE_SYSTEM_PROMPT = `You are a wine educator who writes like Wine Folly — clear, visual, and totally unpretentious. Your reader is a curious adult who drinks wine but has never studied it. Your job is to make them feel smart, not small.

You ONLY discuss wine, wine regions, grapes, producers, terroir, winemaking, and food pairing. Nothing else.

Write every lesson in this EXACT structure with these EXACT headers and NO others:

## The Hook
## The Region & The Wine
## In the Glass
## Three Bottles Worth Finding
## Close Your Eyes

RULES FOR EACH SECTION:

1. THE HOOK (2–3 sentences max)
   One punchy opening. Opinionated, specific, no "welcome" or "today we'll explore." Like the first line of a great article — it makes you want to keep reading.
   Good: "Barolo is the wine Italy points to when it wants to prove it invented this before anyone else."
   Bad: "Today we explore the beautiful Barolo region of Piedmont."

2. THE REGION & THE WINE (3–4 short paragraphs, pure prose)
   — Locate it like you're talking to a friend: "northwest Italy, in the hills an hour south of Turin" — not just "Piedmont."
   — Explain the grape and why it thrives there in plain terms. No Latin names unless they're the common name.
   — Explain winemaking only where it directly affects what you taste. Keep it concrete.
   — One piece of history that actually matters. Skip the rest.
   — Write like Wine Folly: direct sentences, no romance-novel adjectives, no "rolling hills bathed in golden light."

3. IN THE GLASS (1–2 paragraphs, NO bullet points)
   This is the WSET Systematic Approach to Tasting in plain English. Cover appearance, nose, and palate — but translate every descriptor into something real:
   — Don't say "cherry notes." Say "smells like a bowl of dark cherries left in the sun."
   — Don't say "grippy tannins." Say "dries out your mouth the way strong black tea does."
   — Don't say "mineral." Say "like wet slate or a mouthful of river water."
   — Don't say "structured." Tell them what that actually feels like.
   Connect every flavour to the place or the winemaking — why does it taste this way?

4. THREE BOTTLES WORTH FINDING (exactly 3, one line each)
   💚 [Producer — Wine Name] — [One sentence: why it's worth buying]
   💛 [Producer — Wine Name] — [One sentence]
   🔴 [Producer — Wine Name] — [One sentence]
   💚 = under $25 | 💛 = $25–70 | 🔴 = $70+
   No extra text. Just the three lines.

5. CLOSE YOUR EYES (100–150 words, one paragraph)
   A real scene: someone drinking this wine somewhere specific. A kitchen table in winter. A restaurant terrace. A beach. Make it feel like a memory. End there — no summary, no lesson recap, no moral.

OVERALL RULES:
- Total length: 4–5 minute read
- Plain text only — no **bold**, no _italic_ — only ## headers exactly as shown
- Every abstract descriptor must be translated to something the reader can picture or feel
- No sections beyond the five listed above`;

// ─── Helpers ───────────────────────────────────────────────────────────────

/** Escape HTML entities so raw text is safe in Telegram HTML mode */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Emoji per section header
const SECTION_EMOJI: Record<string, string> = {
  'The Hook':                   '🎯',
  'The Region & The Wine':      '🗺',
  'In the Glass':               '🍷',
  'Three Bottles Worth Finding':'🍾',
  'Close Your Eyes':            '✨',
  // Grape lesson variants
  'Grape Overview':             '🍇',
  'Key Growing Regions':        '🗺',
  // Bonus lesson sections
  'Why This Matters':           '🎯',
  'What It Actually Is':        '📖',
  'How It Affects Your Glass':  '🍷',
  'The Bottom Line':            '✅',
  'Try This':                   '🚀',
};

/**
 * Convert lesson text (plain text with ## headers) into Telegram HTML parts.
 * Returns an array of message strings, each ≤ maxLen characters.
 */
function formatLessonForTelegram(raw: string, title: string, maxLen = 4000): string[] {
  const header = `🍷 <b>${escapeHtml(title)}</b>\n─────────────────────\n\n`;
  const lines = raw.split('\n');
  const formattedLines: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)$/);
    if (headerMatch) {
      const sectionName = headerMatch[1].trim();
      const emoji = SECTION_EMOJI[sectionName] ?? '▪️';
      formattedLines.push(`\n\n${emoji} <b>${escapeHtml(sectionName)}</b>\n`);
    } else {
      formattedLines.push(escapeHtml(line));
    }
  }

  const body = formattedLines.join('\n').trim();
  const full = header + body;

  return splitMessage(full, maxLen);
}

/**
 * Split a long message at paragraph/line boundaries to stay under maxLen.
 */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const parts: string[] = [];
  const paragraphs = text.split('\n\n');
  let current = '';

  for (const para of paragraphs) {
    const candidate = current ? current + '\n\n' + para : para;
    if (candidate.length <= maxLen) {
      current = candidate;
    } else {
      if (current) parts.push(current.trim());
      // If a single paragraph itself exceeds maxLen, split at newlines
      if (para.length > maxLen) {
        const lines = para.split('\n');
        let chunk = '';
        for (const line of lines) {
          const c2 = chunk ? chunk + '\n' + line : line;
          if (c2.length <= maxLen) {
            chunk = c2;
          } else {
            if (chunk) parts.push(chunk.trim());
            chunk = line;
          }
        }
        current = chunk;
      } else {
        current = para;
      }
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts.filter(p => p.length > 0);
}

// ─── Short Card Prompt ─────────────────────────────────────────────────────

const WINE_CARD_PROMPT = `You are writing a WSET Level 3 SAT tasting note in plain English. Follow this EXACT format — no extra text, no markdown, plain text only.

The WSET SAT uses precise scale terms. Use ONLY the values shown in brackets — no substitutions.

[One punchy hook sentence. Opinionated and specific — not poetic. Example: "This is the wine that made Tuscany famous, and it earns it every time."]

👁 APPEARANCE
Clarity: [clear / hazy]
Intensity: [pale / medium / deep]
Colour: [white: lemon-green / lemon / gold / amber / brown | rosé: pink / salmon / orange | red: purple / ruby / garnet / tawny / brown]

👃 NOSE
Condition: [clean / unclean]
Intensity: [light / medium- / medium / medium+ / pronounced]
Aromas: [4–6 descriptors in plain English — say "dark cherry and dried fig" not "red fruit and dried fruit complexity"]
Development: [youthful / developing / fully developed]

👅 PALATE
Sweetness: [dry / off-dry / medium-dry / medium-sweet / sweet / luscious]
Acidity: [low / medium- / medium / medium+ / high] — add plain note e.g. "(bright, like biting a green apple)"
Tannin (red only): [low / medium- / medium / medium+ / high] — add plain note e.g. "(drying, like strong black tea)"
Alcohol: [low / medium / high]
Body: [light / medium- / medium / medium+ / full]
Flavour intensity: [light / medium- / medium / medium+ / pronounced]
Flavours: [4–6 plain-English descriptors — be specific, not generic]
Finish: [short / medium- / medium / medium+ / long]

✅ CONCLUSIONS
Quality: [faulty / poor / acceptable / good / very good / outstanding]
Readiness: [needs time / ready to drink / drink soon / past its best]

🍽 PAIRS WITH
[3–4 specific dishes — real dish names, not categories]

🎉 BEST FOR
[1 sentence describing the occasion or moment this wine suits]

Rules:
- Under 400 words total
- Every descriptor must be something a non-expert can picture or taste
- Use the exact WSET scale values — no paraphrasing them`;

/** Generate a short WSET-style wine card (one Telegram message). Cached per region. */
export async function generateWineCard(regionName: string): Promise<string> {
  const cached = getCachedContent(regionName, 'card');
  if (cached) return cached;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: WINE_CARD_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Write a WSET SAT tasting card for the ${regionName} wine region and its signature wine style.`,
      },
    ],
  });

  const raw = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  const formatted = `🍷 <b>${escapeHtml(regionName)}</b>\n─────────────────────\n\n${escapeHtml(raw.trim())}`;
  setCachedContent(regionName, 'card', formatted);
  return formatted;
}

// ─── Public API ────────────────────────────────────────────────────────────

/** Generate a deep-dive lesson for a wine region. Cached per region. */
export async function generateRegionLesson(regionName: string): Promise<string[]> {
  const cached = getCachedContent(regionName, 'lesson');
  if (cached) return formatLessonForTelegram(cached, regionName);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: WINE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Write a wine education lesson about the ${regionName} wine region. Follow the required structure exactly.`,
      },
    ],
  } as any);

  const message = await stream.finalMessage();
  const raw = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  setCachedContent(regionName, 'lesson', raw);
  return formatLessonForTelegram(raw, regionName);
}

/** Generate a deep-dive lesson for a specific grape variety. Cached per grape. */
export async function generateGrapeLesson(grapeName: string): Promise<string[]> {
  const cached = getCachedContent(grapeName, 'grape_lesson');
  if (cached) return formatLessonForTelegram(cached, `${grapeName} — Grape Deep Dive`);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: WINE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Generate a comprehensive wine education lesson about the ${grapeName} grape variety. Adapt the standard lesson structure to focus on this grape: cover its origins and key growing regions, structural profile (acidity/tannin/body/alcohol), aromatic and flavor profile, famous expressions worldwide, notable producers, food pairing, and an immersive sensory story. Use the same section headers where applicable, substituting "Grape Overview" for "Region Overview" and "Key Growing Regions" for "Wine Style".`,
      },
    ],
  } as any);

  const message = await stream.finalMessage();
  const raw = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  setCachedContent(grapeName, 'grape_lesson', raw);
  return formatLessonForTelegram(raw, `${grapeName} — Grape Deep Dive`);
}

// ─── Bonus Lesson Prompts ───────────────────────────────────────────────────

const BONUS_CARD_PROMPT = `You are writing a short "Did You Know" wine education card in the Wine Folly style — clear, punchy, totally unpretentious. Plain text only, no markdown.

Follow this EXACT format with NO extra text:

[One punchy hook sentence. Opinionated and specific — what makes this topic genuinely interesting to a wine drinker. Not poetic.]

🔑 KEY FACTS
• [Surprising specific fact — something concrete, not vague]
• [Something you'd tell a friend at a dinner party]
• [The "aha" moment — the one thing that reframes how you think about this]
• [Practical: how this directly affects what you taste or buy]

📌 WHY IT MATTERS
[One sentence any wine drinker should care about. Connect it to the glass.]

Rules:
- Under 200 words total
- Every fact must be specific — no generalities
- Plain text only, no bold, no markdown
- Write for curious adults, not sommeliers`;

const BONUS_LESSON_PROMPT = `You are a wine educator who writes like Wine Folly — clear, visual, and totally unpretentious. Your reader drinks wine but has never studied it. Make them feel smart.

You ONLY discuss wine, wine regions, grapes, producers, terroir, winemaking, and food pairing. Nothing else.

Write every lesson in this EXACT structure with these EXACT headers and NO others:

## Why This Matters
## What It Actually Is
## How It Affects Your Glass
## The Bottom Line
## Try This

RULES FOR EACH SECTION:

1. WHY THIS MATTERS (2–3 sentences)
   Why should someone who just wants to drink good wine care about this? Make the stakes real and personal. No academic framing.

2. WHAT IT ACTUALLY IS (3–4 short paragraphs, pure prose)
   Explain the concept plainly. No jargon without immediate translation. Use analogies from everyday life. If it's a place, locate it concretely. If it's a technique, describe what physically happens.

3. HOW IT AFFECTS YOUR GLASS (2–3 paragraphs)
   This is where concept meets palate. Translate everything into what you actually taste, smell, or see. Use specific examples — real wines, real producers, real flavour descriptions in plain English (no "mineral," no "complex," no "terroir-driven").

4. THE BOTTOM LINE (1 short paragraph)
   The one-sentence mental model they should walk away with. Make it memorable.

5. TRY THIS (3–4 bullet points or short lines)
   Concrete actions: specific bottles to buy, things to compare, questions to ask a sommelier. Real names, real wines, approachable prices.

OVERALL RULES:
- Total length: 3–4 minute read
- Plain text only — no **bold**, no _italic_ — only ## headers exactly as shown
- Every abstract descriptor must be translated to something the reader can picture or feel
- No sections beyond the five listed above`;

/** Generate a short bonus topic card (Did You Know format). Cached per title. */
export async function generateBonusCard(title: string, description: string, category: string): Promise<string> {
  const cached = getCachedContent(title, 'bonus_card');
  if (cached) return cached;

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    system: BONUS_CARD_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Write a "Did You Know" wine card about: ${title}. Context: ${description}. Category: ${category}.`,
      },
    ],
  });

  const raw = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  const formatted = `🍾 <b>${escapeHtml(title)}</b>\n─────────────────────\n\n${escapeHtml(raw.trim())}`;
  setCachedContent(title, 'bonus_card', formatted);
  return formatted;
}

/** Generate a full bonus topic lesson. Cached per title. */
export async function generateBonusLesson(title: string, description: string, category: string): Promise<string[]> {
  const cached = getCachedContent(title, 'bonus_lesson');
  if (cached) return formatLessonForTelegram(cached, title);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: BONUS_LESSON_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Write a wine education lesson about: ${title}. Context: ${description}. Category: ${category}. Follow the required structure exactly.`,
      },
    ],
  } as any);

  const message = await stream.finalMessage();
  const raw = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  setCachedContent(title, 'bonus_lesson', raw);
  return formatLessonForTelegram(raw, title);
}

// ─── Recommendation Prompt ──────────────────────────────────────────────────

const RECOMMENDATION_PROMPT = `You are a wine recommender who writes like Wine Folly — direct, specific, and completely unpretentious. You receive three user preferences (color, style, occasion) and output exactly 3 bottle recommendations.

Follow this EXACT format with NO extra text, no markdown, plain text only:

[One punchy hook sentence: why this combination of preferences points to a specific wine. Opinionated. Not poetic.]

💚 [Producer — Wine Name]
[One tasting note in plain English — what it smells and tastes like, no jargon]
[One sentence: why it fits this color + style + occasion]

💛 [Producer — Wine Name]
[tasting note]
[fit reason]

🔴 [Producer — Wine Name]
[tasting note]
[fit reason]

🍽 PAIRS WITH
[3 specific dish names, comma-separated]

💡 WHY THESE WORK
[One sentence connecting the preference logic to the recommendation]

Price emoji rules: 💚 = under $25 | 💛 = $25–70 | 🔴 = $70+
Rules:
- Exactly 3 bottles, one per price tier where possible
- Under 350 words total
- Every tasting note must use plain English — no "minerality", no "terroir-driven", no "complex"
- Real producers, real wine names that actually exist`;

/** Generate a personalised wine recommendation. Cached per (color, style, occasion) combo. */
export async function generateRecommendation(prefs: {
  color: string;
  style: string;
  occasion: string;
}): Promise<string[]> {
  const cacheKey = `${prefs.color}|${prefs.style}|${prefs.occasion}`;
  const cached = getCachedContent(cacheKey, 'recommendation');
  if (cached) return splitMessage(cached, 4000);

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: RECOMMENDATION_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Color: ${prefs.color}\nStyle: ${prefs.style}\nOccasion: ${prefs.occasion}`,
      },
    ],
  });

  const raw = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  setCachedContent(cacheKey, 'recommendation', raw);

  const header = `🍾 <b>Your Personalised Wine Recommendation</b>\n─────────────────────\n\n`;
  const body = escapeHtml(raw.trim());
  return splitMessage(header + body, 4000);
}

/** Generate a fresh recommendation for the same preferences (bypasses cache). */
export async function generateFreshRecommendation(prefs: {
  color: string;
  style: string;
  occasion: string;
}): Promise<string[]> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: RECOMMENDATION_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Color: ${prefs.color}\nStyle: ${prefs.style}\nOccasion: ${prefs.occasion}\n\nGive me different bottles from last time.`,
      },
    ],
  });

  const raw = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  const header = `🍾 <b>Your Personalised Wine Recommendation</b>\n─────────────────────\n\n`;
  const body = escapeHtml(raw.trim());
  return splitMessage(header + body, 4000);
}
