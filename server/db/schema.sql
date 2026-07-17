-- Schema for the max-ammon.com self-managed site.
-- All statements are idempotent (IF NOT EXISTS) so this can run on every boot.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Keyed, editable text blocks (Demo/Skills/About/Contact/Gallery copy).
CREATE TABLE IF NOT EXISTS content_blocks (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  block_key  TEXT UNIQUE NOT NULL,
  grp        TEXT NOT NULL DEFAULT '',       -- grouping for the admin UI (demo, skills, about, ...)
  label      TEXT NOT NULL DEFAULT '',       -- human label for the admin field
  value      TEXT NOT NULL DEFAULT '',
  format     TEXT NOT NULL DEFAULT 'text',   -- 'text' | 'multiline' | 'html'
  sort       INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Singleton key/value site settings (titles, demo embed, contact recipient, ...).
CREATE TABLE IF NOT EXISTS site_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- Editable theme colors. default_value powers "reset to default".
CREATE TABLE IF NOT EXISTS color_tokens (
  token         TEXT PRIMARY KEY,            -- e.g. 'basecolor' -> CSS var --basecolor
  value         TEXT NOT NULL,
  default_value TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'section', -- 'text' | 'section'
  label         TEXT NOT NULL DEFAULT '',
  sort          INTEGER NOT NULL DEFAULT 0
);

-- Gallery projects.
CREATE TABLE IF NOT EXISTS gallery_projects (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  title              TEXT NOT NULL DEFAULT '',
  year               TEXT NOT NULL DEFAULT '',
  description        TEXT NOT NULL DEFAULT '',
  layout             TEXT NOT NULL DEFAULT 'project-layout0', -- row layout (pair vs single)
  thumbnail_media_id INTEGER,
  sort               INTEGER NOT NULL DEFAULT 0,
  published          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per asset inside a project (image | video | embed).
CREATE TABLE IF NOT EXISTS media_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES gallery_projects(id) ON DELETE CASCADE,
  type           TEXT NOT NULL DEFAULT 'image',  -- 'image' | 'video' | 'embed'
  title          TEXT NOT NULL DEFAULT '',
  year           TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  full_path      TEXT NOT NULL DEFAULT '',   -- image: full-res; video: main file (data-main)
  preview_path   TEXT NOT NULL DEFAULT '',   -- image: thumbnail; video: looping preview
  poster_path    TEXT NOT NULL DEFAULT '',
  embed_provider TEXT NOT NULL DEFAULT '',   -- 'youtube' | 'vimeo' | ...
  embed_id       TEXT NOT NULL DEFAULT '',
  aspect_class   TEXT NOT NULL DEFAULT '',   -- legacy size class, superseded by aspect_ratio
  aspect_ratio   REAL,                       -- width/height; drives the uniform-height thumbnails
  width          INTEGER,
  height         INTEGER,
  alt_text       TEXT NOT NULL DEFAULT '',
  sort           INTEGER NOT NULL DEFAULT 0
);

-- Per-project downloadable colour variants (rec2020 / p3d65 / srgb).
CREATE TABLE IF NOT EXISTS media_downloads (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     INTEGER NOT NULL REFERENCES gallery_projects(id) ON DELETE CASCADE,
  label          TEXT NOT NULL DEFAULT '',
  file_path      TEXT NOT NULL DEFAULT '',
  kind           TEXT NOT NULL DEFAULT '',   -- 'rec2020' | 'p3d65' | 'srgb'
  filesize_bytes INTEGER,
  sort           INTEGER NOT NULL DEFAULT 0
);

-- Contact form submissions (also emailed).
CREATE TABLE IF NOT EXISTS contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL DEFAULT '',
  email      TEXT NOT NULL DEFAULT '',
  subject    TEXT NOT NULL DEFAULT '',
  message    TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'new',     -- 'new' | 'read' | 'archived'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
