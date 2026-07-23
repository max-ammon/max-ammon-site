'use strict';

const db = require('../db');

// --- prepared statements ---------------------------------------------------
const qContent = db.prepare('SELECT block_key, value, format FROM content_blocks');
const qContentFull = db.prepare(
  'SELECT block_key, grp, label, value, format, sort FROM content_blocks ORDER BY sort, id'
);
const qSettings = db.prepare('SELECT key, value FROM site_settings');
const qSetting = db.prepare('SELECT value FROM site_settings WHERE key = ?');
const qColors = db.prepare(
  'SELECT token, value, default_value, category, label, sort FROM color_tokens ORDER BY sort, token'
);

// --- helpers ---------------------------------------------------------------
function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Escape text, then turn single newlines into <br> (for one-paragraph fields).
function nl2br(text) {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

// Turn a multiline text block (paragraphs separated by blank lines) into
// escaped <p> elements — mirrors the original hand-written markup.
function paragraphs(text) {
  return String(text == null ? '' : text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escapeHtml(p)}</p>`) // inner single newlines collapse in HTML anyway
    .join('\n');
}

function getContentMap() {
  const map = {};
  for (const row of qContent.all()) map[row.block_key] = row.value;
  return map;
}

function getContentFull() {
  return qContentFull.all();
}

function getSettingsMap() {
  const map = {};
  for (const row of qSettings.all()) map[row.key] = row.value;
  return map;
}

// Read a single setting (cheap; used on the gate hot path). Returns `def` when
// the key has never been set.
function getSetting(key, def) {
  const row = qSetting.get(key);
  return row ? row.value : def == null ? '' : def;
}

function getColorTokens() {
  return qColors.all();
}

function buildThemeCss(tokens) {
  const decls = (tokens || getColorTokens())
    .map((t) => `--${t.token}: ${t.value};`)
    .join(' ');
  return `:root { ${decls} }`;
}

// --- mutations (admin) -----------------------------------------------------
const isValidHexColor = (v) =>
  /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(String(v == null ? '' : v).trim());

const updContentStmt = db.prepare(
  "UPDATE content_blocks SET value = ?, updated_at = datetime('now') WHERE block_key = ?"
);
function updateContentBulk(updates) {
  const keys = new Set(qContentFull.all().map((b) => b.block_key));
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(updates)) {
      if (keys.has(k)) updContentStmt.run(String(v == null ? '' : v), k);
    }
  });
  tx();
}

const updColorStmt = db.prepare('UPDATE color_tokens SET value = ? WHERE token = ?');
function updateColorsBulk(updates) {
  const tx = db.transaction(() => {
    for (const [token, v] of Object.entries(updates)) {
      const val = String(v == null ? '' : v).trim();
      if (isValidHexColor(val)) updColorStmt.run(val, token);
    }
  });
  tx();
}

const resetAllColorsStmt = db.prepare('UPDATE color_tokens SET value = default_value');
const resetOneColorStmt = db.prepare('UPDATE color_tokens SET value = default_value WHERE token = ?');
function resetColors(token) {
  if (token) resetOneColorStmt.run(token);
  else resetAllColorsStmt.run();
}

const setSettingStmt = db.prepare(
  'INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);
function updateSettings(updates) {
  const tx = db.transaction(() => {
    for (const [k, v] of Object.entries(updates)) setSettingStmt.run(k, String(v == null ? '' : v));
  });
  tx();
}

// Everything the public templates need, in one call.
function loadPublicContext() {
  const colorTokens = getColorTokens();
  return {
    content: getContentMap(),
    settings: getSettingsMap(),
    colorTokens,
    themeCss: buildThemeCss(colorTokens),
    paragraphs,
    nl2br,
    escapeHtml,
  };
}

module.exports = {
  escapeHtml,
  paragraphs,
  nl2br,
  getContentMap,
  getContentFull,
  getSettingsMap,
  getSetting,
  getColorTokens,
  buildThemeCss,
  loadPublicContext,
  isValidHexColor,
  updateContentBulk,
  updateColorsBulk,
  resetColors,
  updateSettings,
};
