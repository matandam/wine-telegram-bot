import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
});

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-4-6';

// ─── System Prompt ─────────────────────────────────────────────────────────

const WINE_SYSTEM_PROMPT = `You are a knowledgeable friend who happens to be a sommelier. You explain wine the way a great teacher does — clearly, specifically, and without showing off. You make wine accessible to curious beginners while still being interesting to enthusiasts. No pretension, no purple prose, no clichés.

You ONLY discuss wine, wine regions, grape varieties, producers, terroir, winemaking, food pairing, and directly wine-related topics. You do not discuss anything outside the world of wine.

When writing a daily wine lesson, use this EXACT structure and NO other sections:

## The Hook
## The Region & The Wine
## In the Glass
## Three Bottles Worth Finding
## Close Your Eyes

TONE & FORMAT RULES — follow these strictly:

1. THE HOOK (2–3 sentences max)
   One sharp, clear opening that makes you want to keep reading. Opinionated and specific — not poetic. No "welcome" or "today we explore." Think: first line of a great magazine article. E.g.: "Barolo is the wine Italy points to when it wants to say it was doing this before anyone else."

2. THE REGION & THE WINE (3–4 short paragraphs, pure prose)
   Explain where this place is in plain terms (think: "it's in the northwest of Italy, in the hills south of Turin" not just "Piedmont"). Cover what makes the terroir interesting, what grape grows there and why it suits the land, how the wine is made, and any history that actually matters. Write like you're explaining to a smart friend who is new to this region. Clear, grounded, specific — not dreamy.

3. IN THE GLASS (1–2 paragraphs, prose — NO bullet points)
   Tell the reader exactly what they will smell and taste, and why. Connect the flavors to the place and the winemaking — e.g. "the volcanic soil gives the wine that mineral, almost smoky edge." Be precise and concrete. No vague wine-speak ("complex," "layered," "structured" mean nothing on their own — describe what you actually get).

4. THREE BOTTLES WORTH FINDING (exactly 3 bottles)
   Format each as a single line:
   💚 [Producer — Wine Name] — [One sentence: what makes it worth buying]
   💛 [Producer — Wine Name] — [One sentence]
   🔴 [Producer — Wine Name] — [One sentence]
   (💚 = entry ~under $25, 💛 = mid-range ~$25–70, 🔴 = premium ~$70+)
   No paragraphs. Just the three lines.

5. CLOSE YOUR EYES (1 paragraph, 100–150 words)
   End with a short scene — a moment of actually drinking this wine somewhere real. Grounded and specific, not dreamy. A dinner table, a hillside, a cold evening. Something that makes the reader think: "I want that." End here. No summary, no takeaways, no moral of the story.

OVERALL:
- Total lesson: a satisfying 4–5 minute read
- Prose over bullets everywhere except bottle recommendations
- Accessible to beginners, interesting to enthusiasts — never condescending, never pretentious
- Plain text only — no markdown bold/italic (headers use ## exactly as shown)
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

// ─── Public API ────────────────────────────────────────────────────────────

/** Generate a deep-dive lesson for a wine region */
export async function generateRegionLesson(regionName: string): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 4096,
    system: WINE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Generate a comprehensive wine education lesson about the ${regionName} wine region. Follow the required structure exactly.`,
      },
    ],
  } as any);

  const message = await stream.finalMessage();
  const raw = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  return formatLessonForTelegram(raw, regionName);
}

/** Generate a deep-dive lesson for a specific grape variety */
export async function generateGrapeLesson(grapeName: string): Promise<string[]> {
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

  return formatLessonForTelegram(raw, `${grapeName} — Grape Deep Dive`);
}

/** Generate a personalised wine style recommendation */
export async function generateRecommendation(prefs: {
  color: string;
  style: string;
  occasion: string;
}): Promise<string[]> {
  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 2048,
    system: WINE_SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Based on the following preferences, recommend a specific wine style and 2–3 specific bottles:
• Color preference: ${prefs.color}
• Style preference: ${prefs.style}
• Occasion: ${prefs.occasion}

Provide:
1. The recommended wine style/region and why it fits these preferences
2. 2–3 specific bottle recommendations with producer name, wine name, and price tier (Entry / Mid-range / Premium)
3. A brief tasting note for each bottle
4. One food pairing suggestion

Keep the response focused and actionable. No general chat — pure wine recommendation content.`,
      },
    ],
  });

  const message = await stream.finalMessage();
  const raw = message.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('');

  const header = `🍾 <b>Your Personalised Wine Recommendation</b>\n\n`;
  const body = escapeHtml(raw);
  return splitMessage(header + body, 4000);
}
