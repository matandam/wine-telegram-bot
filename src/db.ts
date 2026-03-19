import Database, { Database as DatabaseType } from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'wine_bot.db');

// Ensure data directory exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

console.log(`[db] Using database at: ${DB_PATH}`);
console.log(`[db] __dirname: ${__dirname}`);
console.log(`[db] DB_PATH env: ${process.env.DB_PATH || '(not set)'}`);

const db: DatabaseType = new Database(DB_PATH);

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ────────────────────────────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT    UNIQUE NOT NULL,
    username    TEXT,
    first_name  TEXT,
    subscribed  INTEGER DEFAULT 0,
    timezone    TEXT    DEFAULT 'UTC',
    created_at  TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS lesson_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id  TEXT    NOT NULL,
    region_index INTEGER NOT NULL,
    delivered_at TEXT    DEFAULT (datetime('now')),
    UNIQUE(telegram_id, region_index)
  );

  CREATE TABLE IF NOT EXISTS user_state (
    telegram_id TEXT PRIMARY KEY,
    state       TEXT NOT NULL
  );
`);

// ─── Types ─────────────────────────────────────────────────────────────────

export interface User {
  id: number;
  telegram_id: string;
  username: string | null;
  first_name: string | null;
  subscribed: number;
  timezone: string;
  created_at: string;
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
  INSERT INTO users (telegram_id, username, first_name)
  VALUES (@telegram_id, @username, @first_name)
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

const stmtAddLessonHistory = db.prepare(`
  INSERT OR IGNORE INTO lesson_history (telegram_id, region_index)
  VALUES (?, ?)
`);

const stmtGetUserLessonHistory = db.prepare<[string], { region_index: number }>(
  'SELECT region_index FROM lesson_history WHERE telegram_id = ?'
);

const stmtGetUserLessonCount = db.prepare<[string], { count: number }>(
  'SELECT COUNT(*) as count FROM lesson_history WHERE telegram_id = ?'
);

const stmtHasRecentLesson = db.prepare<[string, number], { count: number }>(`
  SELECT COUNT(*) as count FROM lesson_history
  WHERE telegram_id = ?
  AND delivered_at > datetime('now', '-' || ? || ' hours')
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
  stmtUpsertUser.run({ telegram_id: telegramId, username, first_name: firstName });
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

// ─── Lesson History Operations ─────────────────────────────────────────────

export function addLessonHistory(telegramId: string, regionIndex: number): void {
  stmtAddLessonHistory.run(telegramId, regionIndex);
}

export function getUserLessonHistory(telegramId: string): number[] {
  return stmtGetUserLessonHistory.all(telegramId).map(r => r.region_index);
}

export function getUserLessonCount(telegramId: string): number {
  const row = stmtGetUserLessonCount.get(telegramId);
  return row?.count ?? 0;
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

export type { DatabaseType };
export default db;
