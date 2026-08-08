'use strict';

// Gaussian splats. Each row is one self-contained splat (a thumbnail + the splat
// file + a bit of text). Simpler than the gallery: no per-item media list and no
// downloads, so this mirrors services/gallery.js's conventions (prepared
// statements up top, sort/move, own file cleanup) without the two-level nesting.

const fs = require('fs');
const db = require('../db');
const mediaSvc = require('./media');
const { formatBytes, slugify } = require('../lib/format');
const { imgUrl } = require('../lib/images');

const qAll = db.prepare('SELECT * FROM splats ORDER BY sort, id');
const qPublished = db.prepare('SELECT * FROM splats WHERE published = 1 ORDER BY sort, id');
const qOne = db.prepare('SELECT * FROM splats WHERE id = ?');
const qNextSort = db.prepare('SELECT COALESCE(MIN(sort), 1) - 1 AS s FROM splats'); // new items go to the top
const storage = require('./storage');

const insSplat = db.prepare(`INSERT INTO splats
  (title, year, description, thumb_path, aspect_ratio, splat_path, splat_format, sort, published, flip_up, background_path)
  VALUES (@title, @year, @description, @thumb_path, @aspect_ratio, @splat_path, @splat_format, @sort, @published, @flip_up, @background_path)`);

const updSplat = db.prepare(`UPDATE splats SET
  title=@title, year=@year, description=@description, thumb_path=@thumb_path,
  aspect_ratio=@aspect_ratio, splat_path=@splat_path, splat_format=@splat_format, published=@published, flip_up=@flip_up,
  link_model_id=@link_model_id, link_project_id=@link_project_id, background_path=@background_path
  WHERE id=@id`);

const delSplat = db.prepare('DELETE FROM splats WHERE id = ?');
const setSort = db.prepare('UPDATE splats SET sort = ? WHERE id = ?');
const setExp = db.prepare('UPDATE splats SET exposure = ? WHERE id = ?');
const setView = db.prepare('UPDATE splats SET default_view = ? WHERE id = ?');
const setGradeStmt = db.prepare('UPDATE splats SET white_balance = ?, tint = ? WHERE id = ?');
const setYawStmt = db.prepare('UPDATE splats SET background_yaw = ? WHERE id = ?');

/*
 * Which way the 360 backdrop faces, as a fraction of a full turn. A panorama
 * arrives pointing wherever the camera happened to face when it was shot, which
 * is rarely where it wants to be behind a given capture, so this turns it.
 */
function setBackdropYaw(id, value) {
  let n = parseFloat(value);
  if (!isFinite(n)) n = 0;
  n = ((n % 1) + 1) % 1; // any input lands in 0..1
  n = Math.round(n * 1000) / 1000;
  setYawStmt.run(n, Number(id));
  return n;
}

/*
 * Owner white balance / tint, applied in linear light by the viewer's
 * tone-mapping pass. Both run -1 .. +1 with 0 neutral: white balance from cool
 * (blue) to warm (orange), tint from green to magenta — the usual photographic
 * pair. Stored per splat so a capture with an off colour cast can be corrected
 * once for every visitor.
 */
function setGrade(id, whiteBalance, tint) {
  const clamp = (v) => {
    const n = parseFloat(v);
    return isFinite(n) ? Math.min(1, Math.max(-1, Math.round(n * 1000) / 1000)) : 0;
  };
  const wb = clamp(whiteBalance);
  const ti = clamp(tint);
  setGradeStmt.run(wb, ti, Number(id));
  return { white_balance: wb, tint: ti };
}

/*
 * Owner-set starting camera for one splat: the orbit camera's target point,
 * distance, yaw and pitch — together these fully describe where the camera sits
 * and which way it looks. Stored as compact JSON; '' means "auto-frame the splat"
 * (the original behaviour). Every value is validated, so a malformed post can
 * never leave a view the viewer chokes on.
 */
const MAX_PITCH = 1.5533; // matches the viewer's own clamp

function setDefaultView(id, v) {
  const nums = [v && v.tx, v && v.ty, v && v.tz, v && v.dist, v && v.yaw, v && v.pitch].map(parseFloat);
  if (nums.some((n) => !isFinite(n))) return null;
  let [tx, ty, tz, dist, yaw, pitch] = nums;
  dist = Math.min(500, Math.max(0.05, dist));
  pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
  // Keep yaw in [-PI, PI] so stored values stay tidy and comparable.
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  const round = (n) => Math.round(n * 1e4) / 1e4;
  const view = { t: [round(tx), round(ty), round(tz)], d: round(dist), y: round(yaw), p: round(pitch) };
  setView.run(JSON.stringify(view), Number(id));
  return view;
}

// Drop the saved view; the viewer goes back to auto-framing the splat.
function clearDefaultView(id) {
  setView.run('', Number(id));
}

function parseView(s) {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    if (!v || !Array.isArray(v.t) || v.t.length !== 3) return null;
    const all = [v.t[0], v.t[1], v.t[2], v.d, v.y, v.p];
    if (all.some((n) => typeof n !== 'number' || !isFinite(n))) return null;
    return v;
  } catch (e) {
    return null; // stored value was damaged — fall back to auto-framing
  }
}

// Owner-set viewer brightness for one splat (clamped to a sane range). Returns
// the value actually stored so the caller can echo it back.
function setExposure(id, value) {
  let n = parseFloat(value);
  if (!isFinite(n)) n = 1;
  n = Math.min(3, Math.max(0.2, n));
  setExp.run(n, Number(id));
  return n;
}

// Delete an uploaded file once no splat row still references it. Scoped to
// /uploads/ (never the bundled site assets), mirroring gallery.removeUploadIfUnused.
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

/*
 * Cross-link to the same subject modelled as 3D geometry — the mirror of the
 * link on the geometry cards. Published-only, and tagged ?from=splats so the
 * model viewer's back link returns to this listing.
 */
const qLinkModel = db.prepare('SELECT id, title FROM models WHERE id = ? AND published = 1');
const qLinkProject = db.prepare('SELECT id, title FROM gallery_projects WHERE id = ? AND published = 1');
function splatLinks(s) {
  const links = [];
  if (s.link_model_id) {
    const m = qLinkModel.get(s.link_model_id);
    if (m) links.push({ kind: 'model', href: '/geometry/' + m.id + '/' + slugify(m.title) + '?from=splats', title: m.title || 'this model' });
  }
  // Back to the gallery project this capture belongs to. The #project-<id>
  // fragment is what the gallery uses to scroll to it and light it up, so the
  // visitor lands on the project rather than at the top of a long page.
  if (s.link_project_id) {
    const p = qLinkProject.get(s.link_project_id);
    if (p) links.push({ kind: 'project', href: '/gallery#project-' + p.id, title: p.title || 'this project' });
  }
  return links;
}

// Shape a row for the public listing: a usable aspect ratio, a cache-busting URL
// for the splat file, and any cross-link to the matching model.
function decoratePublic(s) {
  return {
    ...s,
    links: splatLinks(s),
    ratio: s.aspect_ratio ? Number(s.aspect_ratio) : 1.5,
    splat_url: mediaSvc.versionedUrl(s.splat_path),
    // Resized like any other image: an 8K equirect JPEG straight off a camera is
    // far more than the backdrop needs, and it would hold up the whole viewer.
    background_url: s.background_path ? imgUrl(s.background_path, 3200) || s.background_path : '',
    view_url: '/splats/' + s.id + '/' + slugify(s.title),
    view: parseView(s.default_view),
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

// One published splat, decorated for the viewer page (null if missing/hidden).
function getPublicSplat(id) {
  const s = qOne.get(Number(id));
  if (!s || !s.published) return null;
  return decoratePublic(s);
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
    flip_up: data.flip_up ? 1 : 0,
    background_path: data.background_path || '',
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
  // An upload replaces the backdrop, remove_background clears it, and neither
  // leaves it alone — the same rule the thumbnail and the splat file follow.
  const nextBackground = data.remove_background ? '' : data.background_path || cur.background_path;
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
    flip_up: data.flip_up ? 1 : 0,
    link_model_id: data.link_model_id ? Number(data.link_model_id) : null,
    link_project_id: data.link_project_id ? Number(data.link_project_id) : null,
    background_path: nextBackground,
  });
  if (nextThumb !== cur.thumb_path) removeFileIfUnused(cur.thumb_path);
  if (nextSplat !== cur.splat_path) removeFileIfUnused(cur.splat_path);
  if (nextBackground !== cur.background_path) removeFileIfUnused(cur.background_path);
}

function deleteSplat(id) {
  const s = qOne.get(Number(id));
  if (!s) return;
  delSplat.run(Number(id));
  removeFileIfUnused(s.thumb_path);
  removeFileIfUnused(s.splat_path);
  removeFileIfUnused(s.background_path);
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
  getPublicSplat,
  listSplats,
  getSplat,
  createSplat,
  updateSplat,
  deleteSplat,
  moveSplat,
  setExposure,
  setGrade,
  setBackdropYaw,
  setDefaultView,
  clearDefaultView,
};
