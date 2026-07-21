'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'site.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Apply schema (idempotent).
const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// Migrations for databases created before a column existed. CREATE TABLE
// IF NOT EXISTS won't add columns to an existing table, so do it explicitly.
function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
addColumnIfMissing('media_items', 'aspect_ratio', 'REAL');
addColumnIfMissing('pipeline_markers', 'vertical', 'INTEGER NOT NULL DEFAULT 1');

// Seed with today's exact content/colours on first run only.
const seed = require('./seed');
seed.seedIfEmpty(db);
seed.seedProjectsIfEmpty(db);
seed.ensureSettingsDefaults(db); // backfill newly-added settings keys
seed.ensureContentDefaults(db); // backfill newly-added text blocks

// Give legacy media an aspect ratio. Async (sharp measures image files), but
// rendering never waits on it: templates fall back to the legacy size class
// until a row is filled in.
require('./backfill')
  .backfillAspectRatios(db)
  .then((n) => {
    // eslint-disable-next-line no-console
    if (n) console.log(`[migrate] aspect ratio backfilled for ${n} media item(s).`);
  })
  // eslint-disable-next-line no-console
  .catch((e) => console.error('[migrate] aspect ratio backfill failed:', e.message));

module.exports = db;
