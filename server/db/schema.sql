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
  link_model_id      INTEGER,                 -- optional: 3D Geometry model this project links to
  link_splat_id      INTEGER,                 -- optional: Gaussian splat this project links to
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

-- Software logos placed along the Skills "production pipeline" bar. Each marker
-- is an icon (SVG/PNG) at a vertical position (0 = top/"concept" .. 100 =
-- bottom/"finished product") with an optional label (shown vertically on the
-- rail and as the name in the mobile list; empty = icon-only).
CREATE TABLE IF NOT EXISTS pipeline_markers (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  image_path TEXT NOT NULL DEFAULT '',
  label      TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 50,       -- 0..100 down the bar
  vertical   INTEGER NOT NULL DEFAULT 1,         -- 1 = rotate the logo to read vertically
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 3D geometry: glTF/GLB models listed on /geometry and opened in a three.js
-- viewer. Mirrors the splats table — a thumbnail + the model file + text, plus
-- the owner-set look (exposure, starting camera, environment brightness).
CREATE TABLE IF NOT EXISTS models (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL DEFAULT '',
  year          TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  thumb_path    TEXT NOT NULL DEFAULT '',     -- static thumbnail for the card
  aspect_ratio  REAL,                          -- thumbnail width/height
  model_path    TEXT NOT NULL DEFAULT '',     -- the .glb / .gltf file
  model_format  TEXT NOT NULL DEFAULT '',     -- lowercase extension
  exposure      REAL NOT NULL DEFAULT 1,      -- tone-mapping exposure
  env_intensity REAL NOT NULL DEFAULT 1,      -- environment lighting strength
  background    TEXT NOT NULL DEFAULT '',     -- '' = viewer default, or a #hex
  default_view  TEXT NOT NULL DEFAULT '',     -- owner-set starting camera (JSON)
  auto_rotate   INTEGER NOT NULL DEFAULT 0,   -- 1 = gentle turntable on load
  wireframe_ok  INTEGER NOT NULL DEFAULT 1,   -- 1 = offer the wireframe toggle
  link_splat_id  INTEGER,                     -- optional: the same subject captured as a Gaussian splat
  -- Owner overrides for exports whose material didn't come across well.
  -- NULL metalness/roughness = use whatever the file says.
  smooth_normals INTEGER NOT NULL DEFAULT 0,  -- 1 = recompute smooth vertex normals
  metalness      REAL,
  roughness      REAL,
  sort          INTEGER NOT NULL DEFAULT 0,
  published     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Photography: a flat list of images shown on /photography, laid out in
-- justified rows (the images-per-row count is the photography_columns setting).
-- No viewer and no grouping — each row is simply one photo.
CREATE TABLE IF NOT EXISTS photos (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL DEFAULT '',   -- also used as the image's alt text
  date_text    TEXT NOT NULL DEFAULT '',   -- free-form date shown under the photo
  image_path   TEXT NOT NULL DEFAULT '',
  width        INTEGER,
  height       INTEGER,
  aspect_ratio REAL,                        -- width/height; drives the justified rows
  row_break    INTEGER NOT NULL DEFAULT 0, -- 1 = this photo ends its row
  sort         INTEGER NOT NULL DEFAULT 0,
  published    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Demo archive: past demo reels, listed on /demo-archive. Each is the same
-- click-to-play YouTube embed as the main page's demo (poster + play button,
-- full page width), with its own title above it.
CREATE TABLE IF NOT EXISTS demo_archive (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL DEFAULT '',
  youtube_id  TEXT NOT NULL DEFAULT '',
  aspect_w    INTEGER NOT NULL DEFAULT 3840,
  aspect_h    INTEGER NOT NULL DEFAULT 1646,
  poster_path TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0,
  published   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
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

-- Privacy-friendly, first-party visitor analytics: one row per served page view.
-- No cookies, no stored IP, no raw user-agent. `visitor` is a per-day rotating
-- salted hash used only to estimate unique visitors; its salt lives in memory,
-- rotates daily and is never stored, so a hash can't be reversed or linked
-- across days. `referrer_host` holds the external referrer's hostname only.
CREATE TABLE IF NOT EXISTS analytics_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  day           TEXT NOT NULL,                 -- YYYY-MM-DD (server local time)
  ts            INTEGER NOT NULL,              -- unix seconds, for ordering
  path          TEXT NOT NULL DEFAULT '',      -- pathname only, no query string
  referrer_host TEXT NOT NULL DEFAULT '',      -- external referrer host; '' = direct/internal
  device        TEXT NOT NULL DEFAULT '',      -- 'mobile' | 'tablet' | 'desktop'
  visitor       TEXT NOT NULL DEFAULT '',      -- daily-rotating salted hash (unique estimate)
  -- 1 once this visitor was also seen fetching the stylesheet/fonts, i.e. a real
  -- browser rendering the page. A crawler almost always takes the HTML alone, so
  -- 0 marks bot-shaped traffic — including bots posing as mobile browsers.
  assets_loaded INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_analytics_day ON analytics_events(day);
CREATE INDEX IF NOT EXISTS idx_analytics_path ON analytics_events(path);

-- Gaussian splats: each row is one splat shown on /splats and (later) opened in a
-- viewer. Atomic — a static thumbnail + the splat file + a bit of text — so unlike
-- the gallery there's no per-item media list and no downloads.
CREATE TABLE IF NOT EXISTS splats (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL DEFAULT '',
  year         TEXT NOT NULL DEFAULT '',
  description  TEXT NOT NULL DEFAULT '',
  thumb_path   TEXT NOT NULL DEFAULT '',     -- static thumbnail image (/uploads/...)
  aspect_ratio REAL,                          -- thumbnail width/height, for the card
  splat_path   TEXT NOT NULL DEFAULT '',     -- the splat file (.ply/.splat/.ksplat/.spz)
  splat_format TEXT NOT NULL DEFAULT '',     -- lowercase extension, for the viewer
  link_model_id INTEGER,                      -- optional: the same subject as a 3D Geometry model
  sort         INTEGER NOT NULL DEFAULT 0,
  published    INTEGER NOT NULL DEFAULT 1,
  flip_up      INTEGER NOT NULL DEFAULT 0,    -- 1 = flip the up axis (fixes upside-down captures)
  exposure     REAL NOT NULL DEFAULT 1,        -- viewer brightness multiplier (owner-set)
  default_view TEXT NOT NULL DEFAULT '',      -- owner-set starting camera (JSON: target/dist/yaw/pitch)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
