'use strict';

const fs = require('fs');
const path = require('path');
const { toPublicPath, UPLOADS_DIR } = require('../middleware/upload');
const video = require('./video');

const ROOT = path.join(__dirname, '..', '..');
const SITE_DIR = path.join(ROOT, 'max-ammon.com');

// Map a public URL path back to a file on disk, refusing anything that would
// escape the media directories.
function resolvePublicPath(publicPath) {
  const p = String(publicPath || '');
  let base;
  let rel;
  if (p.startsWith('/uploads/')) {
    base = UPLOADS_DIR;
    rel = p.slice('/uploads/'.length);
  } else if (p.startsWith('/assets/')) {
    base = SITE_DIR;
    rel = p.slice(1); // keep the "assets/" segment
  } else {
    return null; // external URL or unknown location
  }
  const resolved = path.resolve(base, decodeURIComponent(rel));
  if (resolved !== base && !resolved.startsWith(base + path.sep)) return null; // traversal guard
  return resolved;
}

/*
 * Cache-busting URL for owner media.
 *
 * Derived files (*_opt.mp4 previews, *_preview.jpg) are regenerated in place at
 * the same path, so a browser that cached the old bytes would keep showing them.
 * Appending the file's mtime means any regeneration produces a new URL and is
 * picked up immediately — including by anyone who cached an earlier version.
 */
function versionedUrl(publicPath) {
  const p = String(publicPath || '');
  if (!p.startsWith('/uploads/')) return p;
  const disk = resolvePublicPath(p);
  if (!disk) return p;
  try {
    return p + '?v=' + Math.floor(fs.statSync(disk).mtimeMs);
  } catch (e) {
    return p;
  }
}

// { exists, bytes } for a public path — used by the admin to show file sizes.
function fileInfo(publicPath) {
  const disk = resolvePublicPath(publicPath);
  if (!disk) return { exists: false, bytes: null };
  try {
    const st = fs.statSync(disk);
    return { exists: st.isFile(), bytes: st.size };
  } catch (e) {
    return { exists: false, bytes: null };
  }
}

let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  sharp = null; // optional — app works without it (uploads stored as-is)
}

// Process an uploaded image: read dimensions and, for large images, generate a
// smaller preview. Falls back to using the original if sharp is unavailable.
async function processImage(file) {
  const full = toPublicPath(file.path);
  const result = { full_path: full, preview_path: full, width: null, height: null };
  if (!sharp) return result;
  try {
    const meta = await sharp(file.path).metadata();
    result.width = meta.width || null;
    result.height = meta.height || null;
    if (meta.width && meta.width > 900) {
      const dir = path.dirname(file.path);
      const base = path.basename(file.path, path.extname(file.path));
      const previewDisk = path.join(dir, base + '_preview.jpg');
      await sharp(file.path).resize({ width: 900 }).jpeg({ quality: 82 }).toFile(previewDisk);
      result.preview_path = toPublicPath(previewDisk);
    }
  } catch (e) {
    /* keep original as preview */
  }
  return result;
}

/*
 * Videos are stored untouched. What we can derive is the small looping clip the
 * gallery card plays: without one, the card would stream the whole file (58 MB
 * in one real case). If ffmpeg is unavailable this degrades to the old
 * behaviour — preview_path points at the full file — and the owner can still
 * attach a preview by hand.
 */
async function processVideo(file) {
  const full = toPublicPath(file.path);
  const result = { full_path: full, preview_path: full, width: null, height: null };

  const meta = await video.probe(file.path);
  if (meta) {
    result.width = meta.width;
    result.height = meta.height;
  }

  if (video.hasFfmpeg()) {
    const dir = path.dirname(file.path);
    const base = path.basename(file.path, path.extname(file.path));
    const previewDisk = path.join(dir, base + '_preview.mp4');
    const made = await video.makePreview(file.path, previewDisk);
    if (made) result.preview_path = toPublicPath(made);
  }
  return result;
}

module.exports = { processImage, processVideo, fileInfo, resolvePublicPath, versionedUrl, hasSharp: !!sharp };
