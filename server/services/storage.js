'use strict';

/*
 * Storage inspector + backup.
 *
 * scan()        — every file under uploads/, grouped by folder, each tagged with
 *                 what references it (or flagged unused). Plus the regenerable
 *                 image cache as a separate, clearable group.
 * deleteUnused  — remove ONE file, but only if it's under uploads/ AND nothing in
 *                 the database still references it (re-checked at delete time).
 * deleteAllUnused / clearImageCache — bulk variants.
 * streamBackupTar — write a plain .tar (a consistent DB snapshot + all uploads)
 *                 to a stream, with no external dependency.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const db = require('../db');
const { UPLOADS_DIR } = require('../middleware/upload');
const mediaSvc = require('./media');

const ROOT = path.join(__dirname, '..', '..');
const IMG_CACHE_DIR = process.env.IMG_CACHE_DIR || path.join(ROOT, 'data', 'img-cache');

// Friendly names for the top-level upload folders.
const DIR_LABELS = {
  gallery: 'Gallery media',
  downloads: 'Gallery downloads',
  site: 'Profile, banner & share images',
  pipeline: 'Pipeline icons',
  splats: 'Gaussian splats',
};

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.isFile()) out.push(full);
  }
  return out;
}

function normalizePath(p) {
  if (!p) return '';
  let s = String(p).split('?')[0].trim(); // drop the ?v= cache-buster
  try {
    s = decodeURIComponent(s);
  } catch (e) {
    /* keep as-is */
  }
  return s;
}

/*
 * Every /uploads path the site references, mapped to human "used by" labels.
 * Built fresh each call so deletes are always checked against current data.
 * Belt-and-braces: besides the explicit path columns, it also regex-scans
 * settings and text content for any embedded /uploads/... path.
 */
function referencedMap() {
  const map = new Map();
  const add = (p, label) => {
    const n = normalizePath(p);
    if (!n || n.indexOf('/uploads/') !== 0) return;
    if (!map.has(n)) map.set(n, new Set());
    map.get(n).add(label);
  };
  const extract = (text, label) => {
    const re = /\/uploads\/[A-Za-z0-9_\-./]+/g;
    let m;
    while ((m = re.exec(String(text || '')))) add(m[0], label);
  };

  for (const m of db
    .prepare(
      `SELECT m.full_path, m.preview_path, m.poster_path,
              COALESCE(g.title,'') AS proj
       FROM media_items m LEFT JOIN gallery_projects g ON g.id = m.project_id`
    )
    .all()) {
    const where = 'Gallery: ' + (m.proj || 'project');
    add(m.full_path, where + ' (media)');
    if (m.preview_path && m.preview_path !== m.full_path) add(m.preview_path, where + ' (preview)');
    if (m.poster_path) add(m.poster_path, where + ' (poster)');
  }

  for (const d of db
    .prepare(
      `SELECT d.file_path, d.label, COALESCE(g.title,'') AS proj
       FROM media_downloads d LEFT JOIN gallery_projects g ON g.id = d.project_id`
    )
    .all()) {
    add(d.file_path, 'Gallery download: ' + (d.label || d.proj || 'file'));
  }

  for (const s of db.prepare('SELECT title, thumb_path, splat_path FROM splats').all()) {
    const t = s.title || 'untitled';
    add(s.thumb_path, 'Splat: ' + t + ' (thumbnail)');
    add(s.splat_path, 'Splat: ' + t + ' (file)');
  }

  for (const p of db.prepare('SELECT image_path, label FROM pipeline_markers').all()) {
    add(p.image_path, 'Pipeline icon' + (p.label ? ': ' + p.label : ''));
  }

  for (const s of db.prepare('SELECT key, value FROM site_settings').all()) {
    extract(s.value, 'Setting: ' + s.key);
  }
  for (const c of db.prepare('SELECT block_key, label, value FROM content_blocks').all()) {
    extract(c.value, 'Text: ' + (c.label || c.block_key));
  }

  return map;
}

function dirSize(dir) {
  let bytes = 0;
  let count = 0;
  for (const f of walk(dir)) {
    try {
      bytes += fs.statSync(f).size;
      count++;
    } catch (e) {
      /* skip */
    }
  }
  return { bytes, count };
}

function scan() {
  const refs = referencedMap();
  const groups = {};
  let totalBytes = 0;
  let totalCount = 0;
  let unusedBytes = 0;
  let unusedCount = 0;

  for (const abs of walk(UPLOADS_DIR)) {
    let st;
    try {
      st = fs.statSync(abs);
    } catch (e) {
      continue;
    }
    const rel = path.relative(UPLOADS_DIR, abs).split(path.sep).join('/');
    const pub = '/uploads/' + rel;
    const top = rel.indexOf('/') >= 0 ? rel.slice(0, rel.indexOf('/')) : '(loose files)';
    const usages = refs.get(pub);
    const used = !!(usages && usages.size);

    const item = {
      public: pub,
      name: path.basename(rel),
      rel,
      bytes: st.size,
      mtime: st.mtimeMs,
      used,
      usedBy: used ? Array.from(usages) : [],
    };

    if (!groups[top]) groups[top] = { dir: top, label: DIR_LABELS[top] || top, count: 0, bytes: 0, unusedCount: 0, unusedBytes: 0, files: [] };
    const g = groups[top];
    g.count++;
    g.bytes += st.size;
    g.files.push(item);
    totalBytes += st.size;
    totalCount++;
    if (!used) {
      g.unusedCount++;
      g.unusedBytes += st.size;
      unusedBytes += st.size;
      unusedCount++;
    }
  }

  const groupList = Object.values(groups).sort((a, b) => b.bytes - a.bytes);
  for (const g of groupList) g.files.sort((a, b) => (a.used === b.used ? b.bytes - a.bytes : a.used ? 1 : -1));

  const cache = dirSize(IMG_CACHE_DIR);
  return { groups: groupList, totalBytes, totalCount, unusedBytes, unusedCount, cache };
}

// Delete one file — only if it's under uploads/ and unreferenced right now.
function deleteUnused(publicPath) {
  const n = normalizePath(publicPath);
  if (!n || n.indexOf('/uploads/') !== 0) return { ok: false, reason: 'not an uploaded file' };
  if (referencedMap().has(n)) return { ok: false, reason: 'still in use' };
  const disk = mediaSvc.resolvePublicPath(n);
  if (!disk) return { ok: false, reason: 'path could not be resolved' };
  try {
    fs.unlinkSync(disk);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.code || e.message };
  }
}

function deleteAllUnused() {
  const refs = referencedMap();
  let removed = 0;
  let freed = 0;
  for (const abs of walk(UPLOADS_DIR)) {
    const rel = path.relative(UPLOADS_DIR, abs).split(path.sep).join('/');
    if (refs.has('/uploads/' + rel)) continue;
    try {
      const sz = fs.statSync(abs).size;
      fs.unlinkSync(abs);
      removed++;
      freed += sz;
    } catch (e) {
      /* skip */
    }
  }
  return { removed, freed };
}

function clearImageCache() {
  let removed = 0;
  let freed = 0;
  for (const abs of walk(IMG_CACHE_DIR)) {
    try {
      const sz = fs.statSync(abs).size;
      fs.unlinkSync(abs);
      removed++;
      freed += sz;
    } catch (e) {
      /* skip */
    }
  }
  return { removed, freed };
}

// --- Minimal streaming tar (ustar), no external dependency -----------------
function writeOctal(buf, offset, length, value) {
  const s = Math.floor(value).toString(8);
  buf.write(s.padStart(length - 1, '0').slice(-(length - 1)), offset, length - 1, 'ascii');
  buf[offset + length - 1] = 0;
}

function tarHeader(name, size, mtimeMs) {
  const buf = Buffer.alloc(512);
  let nm = name;
  let prefix = '';
  if (Buffer.byteLength(nm, 'utf8') > 100) {
    const parts = nm.split('/');
    let namePart = '';
    for (let i = parts.length - 1; i >= 0; i--) {
      const cand = parts[i] + (namePart ? '/' + namePart : '');
      if (Buffer.byteLength(cand, 'utf8') <= 100) namePart = cand;
      else {
        prefix = parts.slice(0, i + 1).join('/');
        break;
      }
    }
    nm = namePart.slice(0, 100);
    prefix = prefix.slice(0, 155);
  }
  buf.write(nm, 0, 100, 'utf8');
  writeOctal(buf, 100, 8, 0o644); // mode
  writeOctal(buf, 108, 8, 0); // uid
  writeOctal(buf, 116, 8, 0); // gid
  writeOctal(buf, 124, 12, size);
  writeOctal(buf, 136, 12, Math.floor((mtimeMs || Date.now()) / 1000));
  buf.write('        ', 148, 8, 'ascii'); // checksum placeholder (spaces)
  buf[156] = 0x30; // typeflag '0' = regular file
  Buffer.from([0x75, 0x73, 0x74, 0x61, 0x72, 0x00]).copy(buf, 257); // "ustar\0"
  buf.write('00', 263, 2, 'ascii');
  if (prefix) buf.write(prefix, 345, 155, 'utf8');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0').slice(-6), 148, 6, 'ascii');
  buf[154] = 0;
  buf[155] = 0x20;
  return buf;
}

function addEntry(dest, name, filePath) {
  let st;
  try {
    st = fs.statSync(filePath);
  } catch (e) {
    return Promise.resolve();
  }
  dest.write(tarHeader(name, st.size, st.mtimeMs));
  return new Promise((resolve, reject) => {
    const rs = fs.createReadStream(filePath);
    rs.on('error', reject);
    rs.on('end', () => {
      const rem = st.size % 512;
      if (rem) dest.write(Buffer.alloc(512 - rem)); // pad to a 512 boundary
      resolve();
    });
    rs.pipe(dest, { end: false }); // pipe carries backpressure; never end `dest` here
  });
}

// Writes a tar (DB snapshot as data/site.db + everything under uploads/) to a
// writable stream and resolves when finished. Does not end the stream on error.
async function streamBackupTar(dest, dbSnapshotPath) {
  await addEntry(dest, 'data/site.db', dbSnapshotPath);
  for (const abs of walk(UPLOADS_DIR)) {
    const rel = path.relative(UPLOADS_DIR, abs).split(path.sep).join('/');
    await addEntry(dest, 'uploads/' + rel, abs);
  }
  dest.write(Buffer.alloc(1024)); // two zero blocks mark end-of-archive
  dest.end();
}

// Snapshot the DB to a consistent temp file (better-sqlite3's online backup, so
// no need to stop the app or copy the WAL), tar it up with all uploads, then
// remove the temp snapshot. Throws before writing anything if the snapshot
// fails, so the route can still send a clean error.
async function backupToStream(dest) {
  const tmp = path.join(os.tmpdir(), 'max-ammon-backup-' + crypto.randomUUID() + '.db');
  try {
    await db.backup(tmp);
    await streamBackupTar(dest, tmp);
  } finally {
    fs.unlink(tmp, () => {});
  }
}

module.exports = {
  scan,
  deleteUnused,
  deleteAllUnused,
  clearImageCache,
  streamBackupTar,
  backupToStream,
  IMG_CACHE_DIR,
};
