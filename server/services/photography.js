'use strict';

/*
 * Photography — a flat, ordered list of images shown on /photography.
 *
 * The page lays them out in justified rows: each row holds `photography_columns`
 * images (1-4, set in the admin) scaled to a common height, with each image's
 * width coming from its own aspect ratio. So mixed portrait/landscape shots sit
 * together without cropping and every row fills the page width exactly — hence
 * the stored aspect_ratio. No viewer and no grouping; the images are the page.
 */

const fs = require('fs');
const db = require('../db');
const mediaSvc = require('./media');

const qAll = db.prepare('SELECT * FROM photos ORDER BY sort, id');
const qPublished = db.prepare('SELECT * FROM photos WHERE published = 1 ORDER BY sort, id');
const qOne = db.prepare('SELECT * FROM photos WHERE id = ?');
const qNextSort = db.prepare('SELECT COALESCE(MIN(sort), 1) - 1 AS s FROM photos'); // newest to the top
const storage = require('./storage');

const insPhoto = db.prepare(`INSERT INTO photos
  (title, image_path, width, height, aspect_ratio, sort, published)
  VALUES (@title, @image_path, @width, @height, @aspect_ratio, @sort, @published)`);

const updPhoto = db.prepare(
  'UPDATE photos SET title=@title, date_text=@date_text, published=@published, row_break=@row_break WHERE id=@id'
);
const delPhoto = db.prepare('DELETE FROM photos WHERE id = ?');
const setSort = db.prepare('UPDATE photos SET sort = ? WHERE id = ?');

const DEFAULT_RATIO = 1.5; // sane fallback if the file couldn't be measured

function removeFileIfUnused(publicPath) {
  if (!publicPath || publicPath.indexOf('/uploads/') !== 0) return;
  if (storage.isReferenced(publicPath)) return; // still used somewhere on the site
  const disk = mediaSvc.resolvePublicPath(publicPath);
  if (!disk) return;
  try {
    fs.unlinkSync(disk);
  } catch (e) {
    /* already gone */
  }
}

function decorate(p) {
  return { ...p, ratio: p.aspect_ratio ? Number(p.aspect_ratio) : DEFAULT_RATIO };
}

function getPublicPhotos() {
  return qPublished.all().map(decorate);
}

function listPhotos() {
  return qAll.all().map(decorate);
}

function getPhoto(id) {
  return qOne.get(Number(id)) || null;
}

function addPhoto(data) {
  const sort = qNextSort.get().s;
  const w = Number(data.width) || null;
  const h = Number(data.height) || null;
  const info = insPhoto.run({
    title: data.title || '',
    image_path: data.image_path || '',
    width: w,
    height: h,
    aspect_ratio: w && h ? Number((w / h).toFixed(4)) : null,
    sort,
    published: data.published === false ? 0 : 1,
  });
  return info.lastInsertRowid;
}

// Caption/alt text, date, visibility and the row break are editable; to change
// the picture itself you delete it and upload again (the file is the content here).
function updatePhoto(id, data) {
  const cur = qOne.get(Number(id));
  if (!cur) return;
  updPhoto.run({
    id: Number(id),
    title: data.title != null ? data.title : cur.title,
    date_text: data.date_text != null ? String(data.date_text).trim() : cur.date_text,
    published: data.published ? 1 : 0,
    row_break: data.row_break ? 1 : 0,
  });
}

function deletePhoto(id) {
  const p = qOne.get(Number(id));
  if (!p) return;
  delPhoto.run(Number(id));
  removeFileIfUnused(p.image_path);
}

// Swap sort with the neighbour in the given direction (-1 up, +1 down).
function movePhoto(id, dir) {
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

// Upper bound on how many photos share a row before one is forced to wrap.
// Rows normally end where the owner marks "end of row"; this is the fallback so
// unmarked photos can't run on forever.
const MAX_COLUMNS = 6;
function columnsFrom(settings) {
  const n = parseInt((settings && settings.photography_columns) || '3', 10);
  return isFinite(n) && n >= 1 && n <= MAX_COLUMNS ? n : 3;
}

/*
 * Build the rows. A row ends where a photo is marked `row_break`, or when it
 * reaches `maxCols` — so the owner composes the rows and the setting is just a
 * safety net.
 *
 * Spacers (invisible flex fillers) are added only to a FINAL row that ran out of
 * photos. A row the owner ended deliberately is meant to fill the width, so it
 * gets none.
 */
function toRows(photos, maxCols) {
  const rows = [];
  let cur = [];
  for (const p of photos) {
    cur.push(p);
    if (p.row_break || cur.length >= maxCols) {
      rows.push({ items: cur, spacers: 0 });
      cur = [];
    }
  }
  if (cur.length) rows.push({ items: cur, spacers: 0 });

  const last = rows[rows.length - 1];
  if (last && last.items.length < maxCols && !last.items[last.items.length - 1].row_break) {
    last.spacers = maxCols - last.items.length;
  }
  return rows;
}

module.exports = {
  getPublicPhotos,
  listPhotos,
  getPhoto,
  addPhoto,
  updatePhoto,
  deletePhoto,
  movePhoto,
  columnsFrom,
  toRows,
  DEFAULT_RATIO,
  MAX_COLUMNS,
};
