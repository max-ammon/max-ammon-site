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
  if (cols.includes(column)) return false;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  return true;
}
addColumnIfMissing('media_items', 'aspect_ratio', 'REAL');
addColumnIfMissing('pipeline_markers', 'vertical', 'INTEGER NOT NULL DEFAULT 1');
addColumnIfMissing('splats', 'flip_up', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('splats', 'exposure', 'REAL NOT NULL DEFAULT 1');
addColumnIfMissing('splats', 'default_view', "TEXT NOT NULL DEFAULT ''");
// The download "kind" used to be a colour space (rec2020 / p3d65 / srgb), which
// described the grade rather than the file. Those are all video files and the
// colour space is already spelled out in each download's label, so map them onto
// the new 'video' type once.
db.prepare("UPDATE media_downloads SET kind = 'video' WHERE kind IN ('rec2020', 'p3d65', 'srgb')").run();

// Views recorded before this column existed have no real-browser signal, so they
// would all read as "bot-shaped". Note the day measurement began and let the
// dashboard report the split only from then on.
if (addColumnIfMissing('analytics_events', 'assets_loaded', 'INTEGER NOT NULL DEFAULT 0')) {
  const hasHistory = db.prepare('SELECT COUNT(*) AS c FROM analytics_events').get().c > 0;
  if (hasHistory) {
    const d = new Date();
    const today =
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    db.prepare(
      "INSERT INTO site_settings (key, value) VALUES ('assets_signal_since', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).run(today);
  }
}
addColumnIfMissing('models', 'key_intensity', 'REAL NOT NULL DEFAULT 0');
addColumnIfMissing('models', 'key_color', "TEXT NOT NULL DEFAULT '#ffffff'");
addColumnIfMissing('models', 'key_azimuth', 'REAL NOT NULL DEFAULT 135');
addColumnIfMissing('models', 'key_elevation', 'REAL NOT NULL DEFAULT 45');
addColumnIfMissing('models', 'env_color', "TEXT NOT NULL DEFAULT '#ffffff'");
addColumnIfMissing('models', 'link_splat_id', 'INTEGER');
addColumnIfMissing('splats', 'link_model_id', 'INTEGER');
addColumnIfMissing('splats', 'white_balance', 'REAL NOT NULL DEFAULT 0');
addColumnIfMissing('splats', 'tint', 'REAL NOT NULL DEFAULT 0');
addColumnIfMissing('splats', 'background_path', "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('splats', 'background_yaw', 'REAL NOT NULL DEFAULT 0');
// The third leg of the cross-links: a splat or model can point back at the
// gallery project it belongs to, so the circle closes in both directions.
addColumnIfMissing('splats', 'link_project_id', 'INTEGER');
addColumnIfMissing('splats', 'splat_scale', 'REAL NOT NULL DEFAULT 1');
addColumnIfMissing('splats', 'splat_alpha', 'REAL NOT NULL DEFAULT 1');
addColumnIfMissing('models', 'link_project_id', 'INTEGER');
addColumnIfMissing('models', 'smooth_normals', 'INTEGER NOT NULL DEFAULT 0');
addColumnIfMissing('models', 'metalness', 'REAL');
addColumnIfMissing('models', 'roughness', 'REAL');
addColumnIfMissing('gallery_projects', 'link_model_id', 'INTEGER');
addColumnIfMissing('gallery_projects', 'link_splat_id', 'INTEGER');
addColumnIfMissing('photos', 'date_text', "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('photos', 'row_break', 'INTEGER NOT NULL DEFAULT 0');

// The single floating welcome note was replaced by the two arrow hints
// (hint.gallery / hint.welcome), so drop the block that no longer renders —
// otherwise it lingers in Admin -> Text as a field that does nothing.
db.prepare("DELETE FROM content_blocks WHERE block_key = 'welcome.note'").run();

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
