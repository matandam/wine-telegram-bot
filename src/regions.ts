import path from 'path';
import { getUserLessonHistory } from './db';

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
 * Returns the next region index the user has not yet received,
 * cycling through regions in a shuffled order tied to the user.
 * Returns null when the user has received all 60 regions.
 */
export function getNextRegionForUser(telegramId: string): Region | null {
  const delivered = new Set(getUserLessonHistory(telegramId));

  // Shuffle regions with a stable seed derived from telegramId so the order
  // is consistent across bot restarts but unique per user.
  const shuffled = shuffleWithSeed(REGIONS, telegramId);

  for (const region of shuffled) {
    if (!delivered.has(region.index)) {
      return region;
    }
  }

  return null; // user has received all regions
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
 * Returns the list of region names a user has already received lessons for.
 */
export function getRegionsCoveredByUser(telegramId: string): Region[] {
  const delivered = getUserLessonHistory(telegramId);
  return delivered
    .map(idx => getRegionByIndex(idx))
    .filter((r): r is Region => r !== undefined);
}
