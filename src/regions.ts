import path from 'path';

export interface Region {
  index: number;
  name: string;
  country: string;
  lat?: number;
  lon?: number;
}

// Load the full regions list once at startup
const REGIONS: Region[] = require(path.join(__dirname, '..', 'data', 'regions.json')) as Region[];

export function getAllRegions(): Region[] {
  return REGIONS;
}

export function getRegionByIndex(index: number): Region | undefined {
  return REGIONS.find(r => r.index === index);
}

export function findRegionByName(query: string): Region | undefined {
  const normalised = query.toLowerCase().trim();
  return REGIONS.find(
    r =>
      r.name.toLowerCase() === normalised ||
      r.name.toLowerCase().includes(normalised)
  );
}

/**
 * Returns the next region for a user based on their lesson count and offset.
 * The order is a deterministic shuffle seeded by telegramId. The regionOffset
 * (set randomly at registration) shifts the starting position so new users
 * don't all begin with the same region.
 */
export function getNextRegionForUser(telegramId: string, lessonCount: number, regionOffset: number): Region {
  const shuffled = shuffleWithSeed(REGIONS, telegramId);
  return shuffled[(lessonCount + regionOffset) % shuffled.length];
}

/**
 * Deterministic Fisher-Yates shuffle using a string seed.
 */
function shuffleWithSeed<T>(arr: T[], seed: string): T[] {
  const copy = [...arr];
  let s = hashCode(seed);

  for (let i = copy.length - 1; i > 0; i--) {
    s = lcg(s);
    const j = Math.abs(s) % (i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Linear congruential generator for reproducible pseudo-random numbers */
function lcg(seed: number): number {
  return (Math.imul(1664525, seed) + 1013904223) | 0;
}

/**
 * Returns the list of regions a user has already received lessons for,
 * reconstructed from their lesson count, offset, and deterministic shuffle order.
 */
export function getRegionsCoveredByUser(telegramId: string, lessonCount: number, regionOffset: number): Region[] {
  const shuffled = shuffleWithSeed(REGIONS, telegramId);
  const total = shuffled.length;
  const count = Math.min(lessonCount, total);
  return Array.from({ length: count }, (_, i) => shuffled[(i + regionOffset) % total]);
}
