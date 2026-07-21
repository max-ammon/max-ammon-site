'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const ROOT = path.join(__dirname, '..', '..');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(ROOT, 'uploads');

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function safeExt(name) {
  const e = path.extname(name || '').toLowerCase();
  return /^\.[a-z0-9]{1,6}$/.test(e) ? e : '';
}

function makeStorage(subdir) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const pid = String(req.params.id || 'misc').replace(/[^0-9A-Za-z_-]/g, '');
      cb(null, ensureDir(path.join(UPLOADS_DIR, subdir, pid)));
    },
    filename: (req, file, cb) => {
      cb(null, crypto.randomUUID() + safeExt(file.originalname));
    },
  });
}

// SVG is allowed too — logos are commonly vector. It's only ever rendered via
// <img src> (scripts inside an SVG don't execute there) and the CSP is
// `imgSrc 'self'`, so a stored SVG can't run script.
const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml'];
const VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska'];

// The browser-supplied mime type isn't dependable (some clients send
// application/octet-stream for perfectly good video), so accept a file when
// EITHER its mime type OR its extension is on the allow-list. Uploads are
// owner-only, stored under generated names, and never executed.
const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg'];
const VIDEO_EXTS = ['.mp4', '.webm', '.mov', '.mkv', '.m4v'];

function isImage(file) {
  return IMAGE_MIMES.includes(file.mimetype) || IMAGE_EXTS.includes(safeExt(file.originalname));
}
function isVideo(file) {
  return VIDEO_MIMES.includes(file.mimetype) || VIDEO_EXTS.includes(safeExt(file.originalname));
}

function mediaFilter(req, file, cb) {
  cb(null, isImage(file) || isVideo(file));
}

function downloadFilter(req, file, cb) {
  // .mxf has no reliable mime type, so allow-list by extension here.
  cb(null, ['.mp4', '.mxf', '.mov', '.webm'].includes(safeExt(file.originalname)));
}

const uploadMedia = multer({
  storage: makeStorage('gallery'),
  fileFilter: mediaFilter,
  limits: { fileSize: 700 * 1024 * 1024 }, // 700 MB (covers large video previews/masters)
});

const uploadDownload = multer({
  storage: makeStorage('downloads'),
  fileFilter: downloadFilter,
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2 GB
});

// Site-wide images (About banner / profile picture, demo poster).
const uploadSiteImage = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ensureDir(path.join(UPLOADS_DIR, 'site'))),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + safeExt(file.originalname)),
  }),
  fileFilter: (req, file, cb) => cb(null, isImage(file)),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB
});

// Pipeline software-marker icons (SVG/PNG logos placed along the Skills bar).
// Logos are tiny; kept in their own folder so a deleted marker's file is easy
// to clean up.
const uploadPipeline = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ensureDir(path.join(UPLOADS_DIR, 'pipeline'))),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + safeExt(file.originalname)),
  }),
  fileFilter: (req, file, cb) => cb(null, isImage(file)),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// Disk path -> public URL under /uploads.
function toPublicPath(diskPath) {
  const rel = path.relative(UPLOADS_DIR, diskPath).split(path.sep).join('/');
  return '/uploads/' + rel;
}

module.exports = { uploadMedia, uploadDownload, uploadSiteImage, uploadPipeline, toPublicPath, UPLOADS_DIR, IMAGE_MIMES, VIDEO_MIMES };
