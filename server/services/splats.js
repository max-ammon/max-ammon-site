'use strict';

// Gaussian splats. Each row is one self-contained splat (a thumbnail + the splat
// file + a bit of text). Simpler than the gallery: no per-item media list and no
// downloads, so this mirrors services/gallery.js's conventions (prepared
// statements up top, sort/move, own file cleanup) without the two-level nesting.

const fs = require('fs');
const db = require('../db');
const mediaSvc = require('./media');
const { formatBytes } = require('../lib/format');

const qAll = db.prepare('SELECT * FROM splats ORDER BY sort, id');
const qPublished = db.prepare('SELECT * FROM splats WHERE published = 1 ORDER BY sort, id');
const qOne = db.prepare('SELECT * FROM splats WHERE id = ?');
const qNextSort = db.prepare('SELECT COALESCE(MIN(sort), 1) - 1 AS s FROM splats'); // new items go to the top
const qPathUse = db.prepare('SELECT COUNT(*) AS c FROM splats WHERE thumb_path = ? OR splat_path = ?');

const insSplat = db.prepare(`INSERT INTO splats
  (title, year, description, thumb_path, aspect_ratio, splat_path, splat_format, sort, published)
  VALUES (@title, @year, @description, @thumb_path, @aspect_ratio, @splat_path, @splat_format, @sort, @published)`);

const updSplat = db.prepare(`UPDATE splats SET
  title=@title, year=@year, description=@description, thumb_path=@thumb_path,
  aspect_ratio=@aspect_ratio, splat_path=@splat_path, splat_format=@splat_format, published=@published
  WHERE id=@id`);

const delSplat = db.prepare('DELETE FROM splats WHERE id = ?');
const setSort = db.prepare('UPDATE splats SET sort = ? WHERE id = ?');

// Delete an uploaded file once no splat row still references it. Scoped to
// /uploads/ (never the bundled site assets), mirroring gallery.removeUploadIfUnused.
function removeFileIfUnused(publicPath) {
  if (!publicPath || publicPath.indexOf('/uploads/') !== 0) return;
  if (qPathUse.get(publicPath, publicPath).c > 0) return; // still referenced
  const disk = mediaSvc.resolvePublicPath(publicPath);
  if (!disk) return;
  try {
    fs.unlinkSync(disk);
  } catch (e) {
    /* already gone */
  }
}

// Shape a row for the public listing: a usable aspect ratio and a cache-busting
// URL for the splat file (the viewer, added later, will fetch this).
function decoratePublic(s) {
  return {
    ...s,
    ratio: s.aspect_ratio ? Number(s.aspect_ratio) : 1.5,
    splat_url: mediaSvc.versionedUrl(s.splat_path),
  };
}

// Shape a row for the admin: whether the splat file is present + a size label.
function decorateAdmin(s) {
  const info = mediaSvc.fileInfo(s.splat_path);
  return { ...s, splat_exists: info.exists, splat_size: formatBytes(info.bytes) };
}

function getPublicSplats() {
  return qPublished.all().map(decoratePublic);
}

function listSplats() {
  return qAll.all().map(decorateAdmin);
}

function getSplat(id) {
  return qOne.get(Number(id)) || null;
}

function createSplat(data) {
  const sort = qNextSort.get().s;
  const info = insSplat.run({
    title: data.title || 'Untitled splat',
    year: data.year || '',
    description: data.description || '',
    thumb_path: data.thumb_path || '',
    aspect_ratio: data.aspect_ratio != null ? data.aspect_ratio : null,
    splat_path: data.splat_path || '',
    splat_format: data.splat_format || '',
    sort,
    published: data.published ? 1 : 0,
  });
  return info.lastInsertRowid;
}

// Partial update: text/published always come from the form; thumb/splat paths
// only change when a replacement file was uploaded (so an edit without new files
// keeps the current ones). Any file left orphaned by a replacement is removed.
function updateSplat(id, data) {
  const cur = qOne.get(Number(id));
  if (!cur) return;
  const nextThumb = data.thumb_path ? data.thumb_path : cur.thumb_path;
  const nextRatio = data.thumb_path ? (data.aspect_ratio != null ? data.aspect_ratio : null) : cur.aspect_ratio;
  const nextSplat = data.splat_path ? data.splat_path : cur.splat_path;
  const nextFormat = data.splat_path ? data.splat_format || '' : cur.splat_format;
  updSplat.run({
    id: Number(id),
    title: data.title != null ? data.title : cur.title,
    year: data.year != null ? data.year : cur.year,
    description: data.description != null ? data.description : cur.description,
    thumb_path: nextThumb,
    aspect_ratio: nextRatio,
    splat_path: nextSplat,
    splat_format: nextFormat,
    published: data.published ? 1 : 0,
  });
  if (nextThumb !== cur.thumb_path) removeFileIfUnused(cur.thumb_path);
  if (nextSplat !== cur.splat_path) removeFileIfUnused(cur.splat_path);
}

function deleteSplat(id) {
  const s = qOne.get(Number(id));
  if (!s) return;
  delSplat.run(Number(id));
  removeFileIfUnused(s.thumb_path);
  removeFileIfUnused(s.splat_path);
}

// Swap sort with the neighbour in the given direction (-1 up, +1 down).
function moveSplat(id, dir) {
  const list = qAll.all();
  const idx = list.findIndex((x) => x.id === Number(id));
  const swap = idx + (dir < 0 ? -1 : 1);
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  const a = list[idx];
  const b = list[swap];
  db.transaction(() => {
    setSort.run(b.sort, a.id);
    setSort.run(a.sort, b.id);
  })();
}

module.exports = {
  getPublicSplats,
  listSplats,
  getSplat,
  createSplat,
  updateSplat,
  deleteSplat,
  moveSplat,
};
