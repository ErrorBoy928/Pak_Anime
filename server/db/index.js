const path = require('path');
const { createClient } = require('@libsql/client');

// Uses Turso (a free, forever-hosted SQLite-compatible database) in
// production. For local development, DATABASE_URL falls back to a local
// file so nothing here needs a Turso account to run and test.
const dbUrl = process.env.DATABASE_URL || `file:${path.join(__dirname, '..', '..', 'data', 'pakanime.sqlite')}`;
const authToken = process.env.DATABASE_AUTH_TOKEN || undefined;

const db = createClient({ url: dbUrl, authToken });

async function init() {
  await db.execute('PRAGMA foreign_keys = ON');

  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS anime (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      genre TEXT NOT NULL DEFAULT '',
      poster_key TEXT,
      video_key TEXT NOT NULL,
      uploaded_by INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid TEXT PRIMARY KEY,
      sess TEXT NOT NULL,
      expires INTEGER NOT NULL
    )
  `);

  await db.execute({ sql: 'DELETE FROM sessions WHERE expires < ?', args: [Date.now()] });
}

// Thin convenience wrappers so route code reads like plain SQL calls
// instead of repeating .execute({ sql, args }) everywhere.
async function get(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows[0] || null;
}

async function all(sql, args = []) {
  const result = await db.execute({ sql, args });
  return result.rows;
}

async function run(sql, args = []) {
  const result = await db.execute({ sql, args });
  return { lastInsertRowid: result.lastInsertRowid, changes: result.rowsAffected };
}

module.exports = { db, init, get, all, run };
