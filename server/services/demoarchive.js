'use strict';

/*
 * Demo archive — past demo reels shown on /demo-archive, newest first by the
 * owner's chosen order. Each entry is the same click-to-play YouTube embed the
 * main page uses (poster image + play button, full page width) plus a title.
 * Mirrors services/pipeline.js: prepared statements up top, own file cleanup.
 */

const fs = require('fs');
const db = require('../db');
const mediaSvc = require('./media');

const qAll = db.prepare('SELECT * FROM demo_archive ORDER BY sort, id');
const qPublished = db.prepare('SELECT * FROM demo_archive WHERE published = 1 ORDER BY sort, id');
const qOne = db.prepare('SELECT * FROM demo_archive WHERE id = ?');
const qNextSort = db.prepare('SELECT COALESCE(MIN(sort), 1) - 1 AS s FROM demo_archive'); // new entries to the top
const storage = require('./storage');

const insItem = db.prepare(`INSERT INTO demo_archive
  (title, youtube_id, aspect_w, aspect_h, poster_path, sort, published)
  VALUES (@title, @youtube_id, @aspect_w, @aspect_h, @poster_path, @sort, @published)`);

const updItem = db.prepare(`UPDATE demo_archive SET
  title=@title, youtube_id=@youtube_id, aspect_w=@aspect_w, aspect_h=@aspect_h,
  poster_path=@poster_path, published=@published WHERE id=@id`);

const delItem = db.prepare('DELETE FROM demo_archive WHERE id = ?');
const setSort = db.prepare('UPDATE demo_archive SET sort = ? WHERE id = ?');

// Drop an uploaded poster once no archive entry still points at it. Scoped to
// /uploads/, and it deliberately ignores posters shared with a site setting
// (those live under the same folder but are removed by their own editor).
function removePosterIfUnused(publicPath) {
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

function intOr(value, fallback) {
  const n = parseInt(value, 10);
  return isFinite(n) && n >= 10 && n <= 99999 ? n : fallback;
}

function getPublicItems() {
  return qPublished.all();
}

function listItems() {
  return qAll.all();
}

function getItem(id) {
  return qOne.get(Number(id)) || null;
}

function addItem(data) {
  const sort = qNextSort.get().s;
  const info = insItem.run({
    title: data.title || 'Untitled demo',
    youtube_id: data.youtube_id || '',
    aspect_w: intOr(data.aspect_w, 3840),
    aspect_h: intOr(data.aspect_h, 1646),
    poster_path: data.poster_path || '',
    sort,
    published: data.published ? 1 : 0,
  });
  return info.lastInsertRowid;
}

// A new poster/video only replaces the current one when supplied, so saving the
// text fields alone keeps the existing media.
function updateItem(id, data) {
  const cur = qOne.get(Number(id));
  if (!cur) return;
  const nextPoster = data.poster_path ? data.poster_path : cur.poster_path;
  updItem.run({
    id: Number(id),
    title: data.title != null ? data.title : cur.title,
    youtube_id: data.youtube_id ? data.youtube_id : cur.youtube_id,
    aspect_w: intOr(data.aspect_w, cur.aspect_w),
    aspect_h: intOr(data.aspect_h, cur.aspect_h),
    poster_path: nextPoster,
    published: data.published ? 1 : 0,
  });
  if (nextPoster !== cur.poster_path) removePosterIfUnused(cur.poster_path);
}

function deleteItem(id) {
  const item = qOne.get(Number(id));
  if (!item) return;
  delItem.run(Number(id));
  removePosterIfUnused(item.poster_path);
}

// Swap sort with the neighbour in the given direction (-1 up, +1 down).
function moveItem(id, dir) {
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

module.exports = { getPublicItems, listItems, getItem, addItem, updateItem, deleteItem, moveItem };
