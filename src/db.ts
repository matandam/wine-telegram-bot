import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// Prefer /app/db on Fly.io (volume mount), fall back to local data/
const DEFAULT_PATH = fs.existsSync('/app/db')
  ? '/app/db/wine_bot.db'
  : path.join(__dirname, '..', 'data', 'wine_bot.db');

const DB_PATH = process.env.DB_PATH || DEFAULT_PATH;

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

console.log(`[db] Using database at: ${DB_PATH}`);
console.log(`[db] DB_PATH env: ${process.env.DB_PATH || '(not set, using default)'}`);

const db: DatabaseType = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id    TEXT    UNIQUE NOT NULL,
    username       TEXT,
    first_name     TEXT,
    subscribed     INTEGER DEFAULT 0,
    timezone       TEXT    DEFAULT 'UTC',
    created_at     TEXT    DEFAULT (datetime('now')),
    lesson_count   INTEGER DEFAULT 0,
    last_lesson_at TEXT
  );

  CREATE TABLE IF NOT EXISTS user_state (
    telegram_id TEXT PRIMARY KEY,
    state       TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lesson_cache (
    region_name  TEXT NOT NULL,
    cache_type   TEXT NOT NULL,
    content      TEXT NOT NULL,
    created_at   TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (region_name, cache_type)
  );
`);

// Migrations for databases created before these columns were added
try { db.exec(`ALTER TABLE users ADD COLUMN lesson_count INTEGER DEFAULT 0`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN last_lesson_at TEXT`); } catch {}
try { db.exec(`ALTER TABLE users ADD COLUMN region_offset INTEGER DEFAULT 0`); } catch {}

// ─── Types ─────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  subscribed: number;
  timezone: string;
  created_at: string;
  lesson_count: number;
  last_lesson_at: string | null;
  region_offset: number;
}

export interface UserState {
  command: string;
  step: string;
  answers: Record<string, string>;
}

// ─── Prepared Statements ───────────────────────────────────────────────────

const stmtGetUser = db.prepare<[string], User>(
  'SELECT * FROM users WHERE telegram_id = ?'
);

const stmtUpsertUser = db.prepare(`
  INSERT INTO users (telegram_id, username, first_name, region_offset)
  VALUES (@telegram_id, @username, @first_name, @region_offset)
  ON CONFLICT(telegram_id) DO UPDATE SET
    username   = excluded.username,
    first_name = excluded.first_name
`);

const stmtUpdateTimezone = db.prepare(
  'UPDATE users SET timezone = ? WHERE telegram_id = ?'
);

const stmtUpdateSubscription = db.prepare(
  'UPDATE users SET subscribed = ? WHERE telegram_id = ?'
);

const stmtGetAllSubscribed = db.prepare<[], User>(
  'SELECT * FROM users WHERE subscribed = 1'
);

const stmtGetLessonCount = db.prepare<[string], { lesson_count: number }>(
  'SELECT lesson_count FROM users WHERE telegram_id = ?'
);

const stmtIncrementLessonCount = db.prepare(`
  UPDATE users SET lesson_count = lesson_count + 1, last_lesson_at = datetime('now')
  WHERE telegram_id = ?
`);

const stmtHasRecentLesson = db.prepare<[string, number], { count: number }>(`
  SELECT COUNT(*) as count FROM users
  WHERE telegram_id = ?
  AND last_lesson_at > datetime('now', '-' || ? || ' hours')
`);

const stmtGetUserState = db.prepare<[string], { state: string }>(
  'SELECT state FROM user_state WHERE telegram_id = ?'
);

const stmtSetUserState = db.prepare(`
  INSERT INTO user_state (telegram_id, state) VALUES (?, ?)
  ON CONFLICT(telegram_id) DO UPDATE SET state = excluded.state
`);

const stmtClearUserState = db.prepare(
  'DELETE FROM user_state WHERE telegram_id = ?'
);

// ─── User Operations ───────────────────────────────────────────────────────

export function getUser(telegramId: string): User | undefined {
  return stmtGetUser.get(telegramId);
}

export function upsertUser(telegramId: string, username: string | null, firstName: string | null): void {
  // region_offset is set once on INSERT and never overwritten — gives each new user
  // a random starting position in their lesson shuffle so the first lesson varies.
  const regionOffset = Math.floor(Math.random() * 126);
  stmtUpsertUser.run({ telegram_id: telegramId, username, first_name: firstName, region_offset: regionOffset });
}

export function updateUserTimezone(telegramId: string, timezone: string): void {
  stmtUpdateTimezone.run(timezone, telegramId);
}

export function updateUserSubscription(telegramId: string, subscribed: boolean): void {
  stmtUpdateSubscription.run(subscribed ? 1 : 0, telegramId);
}

export function getAllSubscribedUsers(): User[] {
  return stmtGetAllSubscribed.all();
}

// ─── Lesson Count Operations ────────────────────────────────────────────────

export function getLessonCount(telegramId: string): number {
  const row = stmtGetLessonCount.get(telegramId);
  return row?.lesson_count ?? 0;
}

export function incrementLessonCount(telegramId: string): void {
  stmtIncrementLessonCount.run(telegramId);
}

export function hasRecentLesson(telegramId: string, hoursAgo: number = 20): boolean {
  const row = stmtHasRecentLesson.get(telegramId, hoursAgo);
  return (row?.count ?? 0) > 0;
}

// ─── User State Operations ─────────────────────────────────────────────────

export function getUserState(telegramId: string): UserState | null {
  const row = stmtGetUserState.get(telegramId);
  if (!row) return null;
  try {
    return JSON.parse(row.state) as UserState;
  } catch {
    return null;
  }
}

export function setUserState(telegramId: string, state: UserState): void {
  stmtSetUserState.run(telegramId, JSON.stringify(state));
}

export function clearUserState(telegramId: string): void {
  stmtClearUserState.run(telegramId);
}

// ─── Lesson Cache Operations ────────────────────────────────────────────────

const stmtGetCachedContent = db.prepare<[string, string], { content: string }>(
  'SELECT content FROM lesson_cache WHERE region_name = ? AND cache_type = ?'
);

const stmtSetCachedContent = db.prepare(`
  INSERT INTO lesson_cache (region_name, cache_type, content)
  VALUES (?, ?, ?)
  ON CONFLICT(region_name, cache_type) DO UPDATE SET content = excluded.content
`);

export function getCachedContent(regionName: string, cacheType: string): string | null {
  return stmtGetCachedContent.get(regionName, cacheType)?.content ?? null;
}

export function setCachedContent(regionName: string, cacheType: string, content: string): void {
  stmtSetCachedContent.run(regionName, cacheType, content);
}

export type { DatabaseType };
export default db;
