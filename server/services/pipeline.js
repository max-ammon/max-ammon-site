'use strict';

// Software markers placed along the Skills "production pipeline" bar. Each is an
// icon (SVG/PNG) at a vertical position (0 = top/"concept" .. 100 = bottom/
// "finished product") with an optional label.

const fs = require('fs');
const db = require('../db');
const mediaSvc = require('./media');

const qMarkers = db.prepare('SELECT * FROM pipeline_markers ORDER BY position, id');
const qMarker = db.prepare('SELECT * FROM pipeline_markers WHERE id = ?');
const insMarker = db.prepare(
  'INSERT INTO pipeline_markers (image_path, label, position) VALUES (@image_path, @label, @position)'
);
const updMarker = db.prepare(
  'UPDATE pipeline_markers SET image_path=@image_path, label=@label, position=@position WHERE id=@id'
);
const delMarker = db.prepare('DELETE FROM pipeline_markers WHERE id = ?');
const qUsers = db.prepare('SELECT COUNT(*) AS c FROM pipeline_markers WHERE image_path = ?');

// Keep position on the 0..100 axis the bar (and the scroll dot) use.
function clampPos(v) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 50;
  return n < 0 ? 0 : n > 100 ? 100 : n;
}

// Bin a marker's uploaded icon once nothing references it. Only ever touches
// files under /uploads/pipeline/ that no other marker still uses.
function removeIconIfUnused(publicPath) {
  if (!publicPath || publicPath.indexOf('/uploads/pipeline/') !== 0) return;
  if (qUsers.get(publicPath).c > 0) return;
  const disk = mediaSvc.resolvePublicPath(publicPath);
  if (!disk) return;
  try {
    fs.unlinkSync(disk);
  } catch (e) {
    /* already gone */
  }
}

function getMarkers() {
  return qMarkers.all();
}

function addMarker(data) {
  const info = insMarker.run({
    image_path: data.image_path || '',
    label: (data.label || '').trim(),
    position: clampPos(data.position),
  });
  return info.lastInsertRowid;
}

function updateMarker(id, data) {
  const cur = qMarker.get(id);
  if (!cur) return;
  // A new upload replaces the icon; an empty image_path means "keep the old one".
  const nextImage = data.image_path ? data.image_path : cur.image_path;
  updMarker.run({
    id,
    image_path: nextImage,
    label: data.label != null ? String(data.label).trim() : cur.label,
    position: data.position != null ? clampPos(data.position) : cur.position,
  });
  // Only now that the row no longer references it can the old file be removed.
  if (nextImage !== cur.image_path) removeIconIfUnused(cur.image_path);
}

function deleteMarker(id) {
  const m = qMarker.get(id);
  if (!m) return;
  delMarker.run(id);
  removeIconIfUnused(m.image_path);
}

module.exports = { getMarkers, addMarker, updateMarker, deleteMarker };
