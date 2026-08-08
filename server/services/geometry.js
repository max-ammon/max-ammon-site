'use strict';

/*
 * 3D geometry — glTF/GLB models listed on /geometry, each opened in a three.js
 * viewer at its own shareable URL. Deliberately mirrors services/splats.js: one
 * atomic item per row (thumbnail + model file + text), plus the owner-set look
 * (exposure, environment strength, background, starting camera).
 */

const fs = require('fs');
const db = require('../db');
const mediaSvc = require('./media');
const { formatBytes, slugify } = require('../lib/format');

const qAll = db.prepare('SELECT * FROM models ORDER BY sort, id');
const qPublished = db.prepare('SELECT * FROM models WHERE published = 1 ORDER BY sort, id');
const qOne = db.prepare('SELECT * FROM models WHERE id = ?');
const qNextSort = db.prepare('SELECT COALESCE(MIN(sort), 1) - 1 AS s FROM models'); // new items to the top
const storage = require('./storage');

const insModel = db.prepare(`INSERT INTO models
  (title, year, description, thumb_path, aspect_ratio, model_path, model_format, sort, published)
  VALUES (@title, @year, @description, @thumb_path, @aspect_ratio, @model_path, @model_format, @sort, @published)`);

const updModel = db.prepare(`UPDATE models SET
  title=@title, year=@year, description=@description, thumb_path=@thumb_path,
  aspect_ratio=@aspect_ratio, model_path=@model_path, model_format=@model_format,
  published=@published, auto_rotate=@auto_rotate, wireframe_ok=@wireframe_ok, background=@background,
  link_splat_id=@link_splat_id, link_project_id=@link_project_id
  WHERE id=@id`);

const delModel = db.prepare('DELETE FROM models WHERE id = ?');
const setSort = db.prepare('UPDATE models SET sort = ? WHERE id = ?');
const setLookStmt = db.prepare('UPDATE models SET exposure = ?, env_intensity = ? WHERE id = ?');
const setViewStmt = db.prepare('UPDATE models SET default_view = ? WHERE id = ?');

const MAX_PITCH = 1.5533; // matches the viewer's own clamp

// Checks every table + settings + text (not just this one), so a file shared
// with another part of the site is never removed from under it.
function removeFileIfUnused(publicPath) {
  if (!publicPath || publicPath.indexOf('/uploads/') !== 0) return;
  if (storage.isReferenced(publicPath)) return;
  const disk = mediaSvc.resolvePublicPath(publicPath);
  if (!disk) return;
  try {
    fs.unlinkSync(disk);
  } catch (e) {
    /* already gone */
  }
}

// A '#rrggbb' background, or '' for the viewer's default.
function normalizeColor(v) {
  const s = String(v || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : '';
}

function parseView(s) {
  if (!s) return null;
  try {
    const v = JSON.parse(s);
    if (!v || !Array.isArray(v.t) || v.t.length !== 3) return null;
    if ([v.t[0], v.t[1], v.t[2], v.d, v.y, v.p].some((n) => typeof n !== 'number' || !isFinite(n))) return null;
    return v;
  } catch (e) {
    return null;
  }
}

/*
 * Cross-link to the same subject captured as a Gaussian splat, so a model and
 * its scan stay connected. Only while that splat is still published, and tagged
 * ?from=geometry so leaving its viewer returns to this listing.
 */
const qLinkSplat = db.prepare('SELECT id, title FROM splats WHERE id = ? AND published = 1');
const qLinkProject = db.prepare('SELECT id, title FROM gallery_projects WHERE id = ? AND published = 1');
function modelLinks(m) {
  const links = [];
  if (m.link_splat_id) {
    const s = qLinkSplat.get(m.link_splat_id);
    if (s) links.push({ kind: 'splat', href: '/splats/' + s.id + '/' + slugify(s.title) + '?from=geometry', title: s.title || 'this splat' });
  }
  // Back to the gallery project this model belongs to — see splats.js for why
  // the link carries the #project-<id> fragment.
  if (m.link_project_id) {
    const p = qLinkProject.get(m.link_project_id);
    if (p) links.push({ kind: 'project', href: '/gallery#project-' + p.id, title: p.title || 'this project' });
  }
  return links;
}

function decoratePublic(m) {
  return {
    ...m,
    ratio: m.aspect_ratio ? Number(m.aspect_ratio) : 1.5,
    model_url: mediaSvc.versionedUrl(m.model_path),
    view_url: '/geometry/' + m.id + '/' + slugify(m.title),
    view: parseView(m.default_view),
    links: modelLinks(m),
  };
}

function decorateAdmin(m) {
  const info = mediaSvc.fileInfo(m.model_path);
  return { ...m, model_exists: info.exists, model_size: formatBytes(info.bytes) };
}

function getPublicModels() {
  return qPublished.all().map(decoratePublic);
}

function getPublicModel(id) {
  const m = qOne.get(Number(id));
  if (!m || !m.published) return null;
  return decoratePublic(m);
}

function listModels() {
  return qAll.all().map(decorateAdmin);
}

function getModel(id) {
  return qOne.get(Number(id)) || null;
}

function createModel(data) {
  const sort = qNextSort.get().s;
  const info = insModel.run({
    title: data.title || 'Untitled model',
    year: data.year || '',
    description: data.description || '',
    thumb_path: data.thumb_path || '',
    aspect_ratio: data.aspect_ratio != null ? data.aspect_ratio : null,
    model_path: data.model_path || '',
    model_format: data.model_format || '',
    sort,
    published: data.published ? 1 : 0,
  });
  return info.lastInsertRowid;
}

// Text/flags always come from the form; the thumbnail and model files only
// change when a replacement was uploaded.
function updateModel(id, data) {
  const cur = qOne.get(Number(id));
  if (!cur) return;
  const nextThumb = data.thumb_path ? data.thumb_path : cur.thumb_path;
  const nextRatio = data.thumb_path ? (data.aspect_ratio != null ? data.aspect_ratio : null) : cur.aspect_ratio;
  const nextModel = data.model_path ? data.model_path : cur.model_path;
  const nextFormat = data.model_path ? data.model_format || '' : cur.model_format;
  updModel.run({
    id: Number(id),
    title: data.title != null ? data.title : cur.title,
    year: data.year != null ? data.year : cur.year,
    description: data.description != null ? data.description : cur.description,
    thumb_path: nextThumb,
    aspect_ratio: nextRatio,
    model_path: nextModel,
    model_format: nextFormat,
    published: data.published ? 1 : 0,
    auto_rotate: data.auto_rotate ? 1 : 0,
    wireframe_ok: data.wireframe_ok ? 1 : 0,
    background: normalizeColor(data.background),
    link_splat_id: data.link_splat_id ? Number(data.link_splat_id) : null,
    link_project_id: data.link_project_id ? Number(data.link_project_id) : null,
  });
  if (nextThumb !== cur.thumb_path) removeFileIfUnused(cur.thumb_path);
  if (nextModel !== cur.model_path) removeFileIfUnused(cur.model_path);
}

function deleteModel(id) {
  const m = qOne.get(Number(id));
  if (!m) return;
  delModel.run(Number(id));
  removeFileIfUnused(m.thumb_path);
  removeFileIfUnused(m.model_path);
}

function moveModel(id, dir) {
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

/*
 * Owner overrides for a material that didn't survive the export well. A glTF
 * without an explicit metallicFactor defaults to fully metallic, which renders
 * dark and mirror-like; and an export with no vertex normals shades faceted.
 * Passing '' for metalness/roughness clears the override (back to the file).
 */
const setMaterialStmt = db.prepare(
  'UPDATE models SET smooth_normals = ?, metalness = ?, roughness = ? WHERE id = ?'
);
function setMaterial(id, { smooth, metalness, roughness }) {
  const opt = (v) => {
    if (v === '' || v == null) return null; // "use the file's value"
    const n = parseFloat(v);
    return isFinite(n) ? Math.min(1, Math.max(0, n)) : null;
  };
  const m = opt(metalness);
  const r = opt(roughness);
  const s = smooth ? 1 : 0;
  setMaterialStmt.run(s, m, r, Number(id));
  return { smooth_normals: s, metalness: m, roughness: r };
}

/*
 * Owner-saved lighting rig: a directional key light (strength, colour and the two
 * angles that aim it) plus a colour tint for the studio environment. Saved live
 * from the viewer's Light panel and applied for every visitor. Intensity 0 means
 * no key light at all, which is the default.
 */
const setLightingStmt = db.prepare(
  'UPDATE models SET key_intensity = ?, key_color = ?, key_azimuth = ?, key_elevation = ?, env_color = ? WHERE id = ?'
);
function setLighting(id, d) {
  const num = (v, lo, hi, def) => {
    const n = parseFloat(v);
    return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  };
  const col = (v, def) => normalizeColor(v) || def;
  const out = {
    key_intensity: num(d.key_intensity, 0, 10, 0),
    key_color: col(d.key_color, '#ffffff'),
    // Azimuth wraps; elevation is clamped so the light can't flip past vertical.
    key_azimuth: ((num(d.key_azimuth, -3600, 3600, 135) % 360) + 360) % 360,
    key_elevation: num(d.key_elevation, -89, 89, 45),
    env_color: col(d.env_color, '#ffffff'),
  };
  setLightingStmt.run(
    out.key_intensity,
    out.key_color,
    out.key_azimuth,
    out.key_elevation,
    out.env_color,
    Number(id)
  );
  return out;
}

// Owner-set lighting, saved live from the viewer's sliders.
function setLook(id, exposure, envIntensity) {
  const clamp = (v, lo, hi, def) => {
    const n = parseFloat(v);
    return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
  };
  const e = clamp(exposure, 0.1, 3, 1);
  const env = clamp(envIntensity, 0, 4, 1);
  setLookStmt.run(e, env, Number(id));
  return { exposure: e, env_intensity: env };
}

// Owner-set starting camera (orbit target + distance + yaw/pitch), validated so
// a malformed post can never store a view the viewer chokes on.
function setDefaultView(id, v) {
  const nums = [v && v.tx, v && v.ty, v && v.tz, v && v.dist, v && v.yaw, v && v.pitch].map(parseFloat);
  if (nums.some((n) => !isFinite(n))) return null;
  let [tx, ty, tz, dist, yaw, pitch] = nums;
  dist = Math.min(5000, Math.max(0.001, dist));
  pitch = Math.min(MAX_PITCH, Math.max(-MAX_PITCH, pitch));
  yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  const round = (n) => Math.round(n * 1e4) / 1e4;
  const view = { t: [round(tx), round(ty), round(tz)], d: round(dist), y: round(yaw), p: round(pitch) };
  setViewStmt.run(JSON.stringify(view), Number(id));
  return view;
}

function clearDefaultView(id) {
  setViewStmt.run('', Number(id));
}

module.exports = {
  getPublicModels,
  getPublicModel,
  listModels,
  getModel,
  createModel,
  updateModel,
  deleteModel,
  moveModel,
  setLook,
  setMaterial,
  setLighting,
  setDefaultView,
  clearDefaultView,
};
