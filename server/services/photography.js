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
const qPathUse = db.prepare('SELECT COUNT(*) AS c FROM photos WHERE image_path = ?');

const insPhoto = db.prepare(`INSERT INTO photos
  (title, image_path, width, height, aspect_ratio, sort, published)
  VALUES (@title, @image_path, @width, @height, @aspect_ratio, @sort, @published)`);

const updPhoto = db.prepare('UPDATE photos SET title=@title, published=@published WHERE id=@id');
const delPhoto = db.prepare('DELETE FROM photos WHERE id = ?');
const setSort = db.prepare('UPDATE photos SET sort = ? WHERE id = ?');

const DEFAULT_RATIO = 1.5; // sane fallback if the file couldn't be measured

function removeFileIfUnused(publicPath) {
  if (!publicPath || publicPath.indexOf('/uploads/') !== 0) return;
  if (qPathUse.get(publicPath).c > 0) return;
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

// Only the caption/alt text and visibility are editable; to change the picture
// itself you delete it and upload again (the file is the content here).
function updatePhoto(id, data) {
  const cur = qOne.get(Number(id));
  if (!cur) return;
  updPhoto.run({
    id: Number(id),
    title: data.title != null ? data.title : cur.title,
    published: data.published ? 1 : 0,
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

// Images per row, clamped to the 1-4 the layout is designed for.
function columnsFrom(settings) {
  const n = parseInt((settings && settings.photography_columns) || '3', 10);
  return isFinite(n) && n >= 1 && n <= 4 ? n : 3;
}

/*
 * Split the list into rows of `cols`. A trailing short row is padded with
 * "spacer" ratios so its images stay the size of the rows above instead of
 * stretching across the full width.
 */
function toRows(photos, cols) {
  const rows = [];
  for (let i = 0; i < photos.length; i += cols) {
    const items = photos.slice(i, i + cols);
    rows.push({ items, spacers: Math.max(0, cols - items.length) });
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
};
