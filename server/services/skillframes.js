'use strict';

/*
 * Frames of a Skills picture that plays as the section scrolls past.
 *
 * A slot ('texturing') holds an ordered sequence of images. With fewer than two
 * the section falls back to the single picture its setting points at, so a slot
 * that has been emptied is not a broken section — it is the original one.
 *
 * Ordering works the way the photography page does: a `sort` column the arrows
 * swap, rather than positions rewritten on every change.
 */

const fs = require('fs');
const db = require('../db');
const mediaSvc = require('./media');

const qFrames = db.prepare('SELECT * FROM skill_frames WHERE slot = ? ORDER BY sort, id');
const qFrame = db.prepare('SELECT * FROM skill_frames WHERE id = ?');
const insFrame = db.prepare('INSERT INTO skill_frames (slot, file_path, sort) VALUES (?, ?, ?)');
const delFrame = db.prepare('DELETE FROM skill_frames WHERE id = ?');
const delSlot = db.prepare('DELETE FROM skill_frames WHERE slot = ?');
const nextSort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM skill_frames WHERE slot = ?');
const setSort = db.prepare('UPDATE skill_frames SET sort = ? WHERE id = ?');
const qUsers = db.prepare('SELECT COUNT(*) AS c FROM skill_frames WHERE file_path = ?');

// Bin an uploaded frame once no row points at it. Only ever touches files under
// /uploads/skills/, and only when this slot (or another) is not still using the
// very same path.
function removeFrameIfUnused(publicPath) {
  if (!publicPath || publicPath.indexOf('/uploads/skills/') !== 0) return;
  if (qUsers.get(publicPath).c > 0) return;
  const disk = mediaSvc.resolvePublicPath(publicPath);
  if (!disk) return;
  try {
    fs.unlinkSync(disk);
  } catch (e) {
    /* already gone */
  }
}

function getFrames(slot) {
  return qFrames.all(String(slot || ''));
}

function framePaths(slot) {
  return getFrames(slot).map((f) => f.file_path);
}

// Append frames, keeping the order they were chosen in. Uploading a folder of
// stills in one go is the whole point, so this takes a list.
const addFrames = db.transaction((slot, paths) => {
  let s = nextSort.get(String(slot)).s;
  for (const p of paths) {
    if (!p) continue;
    insFrame.run(String(slot), p, s);
    s += 1;
  }
});

function deleteFrame(id) {
  const f = qFrame.get(id);
  if (!f) return;
  delFrame.run(id);
  removeFrameIfUnused(f.file_path);
}

// Clearing a slot puts the section back to its single picture.
function clearSlot(slot) {
  const paths = framePaths(slot);
  delSlot.run(String(slot || ''));
  paths.forEach(removeFrameIfUnused);
}

/*
 * Swap a frame with its neighbour. Sort values can arrive equal (two frames
 * uploaded in the same batch never do, but a hand-edited database could), so
 * the swap goes by the order the list is actually read in rather than by
 * arithmetic on the values themselves.
 */
const moveFrame = db.transaction((id, dir) => {
  const f = qFrame.get(id);
  if (!f) return;
  const list = qFrames.all(f.slot);
  const i = list.findIndex((r) => r.id === f.id);
  const j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= list.length) return;
  setSort.run(list[j].sort, list[i].id);
  setSort.run(list[i].sort, list[j].id);
  // Equal sorts would leave the pair in id order and the swap would not stick,
  // so give them distinct values when the two happened to match.
  if (list[i].sort === list[j].sort) {
    setSort.run(list[i].sort + (dir === 'up' ? -1 : 1), list[i].id);
  }
});

module.exports = { getFrames, framePaths, addFrames, deleteFrame, clearSlot, moveFrame, removeFrameIfUnused };
