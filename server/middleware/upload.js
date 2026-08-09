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

// Project downloads are whatever the owner wants to hand out — a master video,
// a texture set, an .fbx, a .zip — so no type restriction here. They're stored
// under generated names and served with Content-Disposition: attachment (see
// app.js), so a file is only ever downloaded, never rendered in the site's origin.
function downloadFilter(req, file, cb) {
  cb(null, true);
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

// Frames of a scroll-driven Skills picture. Their own folder so a sequence is
// easy to spot in the storage manager, and many at once: a sixteen-frame
// sequence is chosen as sixteen files in one go, not one upload at a time.
const uploadSkillFrame = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ensureDir(path.join(UPLOADS_DIR, 'skills'))),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + safeExt(file.originalname)),
  }),
  fileFilter: (req, file, cb) => cb(null, isImage(file)),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB per frame
});

// 3D geometry. Like the splat uploader, one instance handles the two files the
// admin form posts together: a `thumb` image and the `model` itself (.glb/.gltf,
// allow-listed by extension since 3D formats have no dependable mime type).
const MODEL_EXTS = ['.glb', '.gltf'];
const uploadModel = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ensureDir(path.join(UPLOADS_DIR, 'models'))),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + safeExt(file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'thumb') return cb(null, isImage(file));
    if (file.fieldname === 'model') return cb(null, MODEL_EXTS.includes(safeExt(file.originalname)));
    cb(null, false);
  },
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

// Photography page images. Their own folder so they're easy to spot in the
// storage manager; several can be uploaded at once, and originals are kept
// as-is (the /img route derives the sizes actually served).
const uploadPhoto = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ensureDir(path.join(UPLOADS_DIR, 'photography'))),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + safeExt(file.originalname)),
  }),
  fileFilter: (req, file, cb) => cb(null, isImage(file)),
  limits: { fileSize: 80 * 1024 * 1024 }, // 80 MB per photo
});

// Gaussian splats. One uploader handles the two very different files the admin
// form posts together: a normal image `thumb`, and the `splat` point-cloud file
// itself (stored untouched). Splat formats have no dependable mime type, so the
// splat field is allow-listed by extension. Limited to the formats the in-browser
// viewer can render (.ply, .splat and the compact .spz). Big limit — a raw .ply
// can be hundreds of MB (though .spz is ~10x smaller and far friendlier to upload).
const SPLAT_EXTS = ['.ply', '.splat', '.spz'];
function isSplatFile(file) {
  return SPLAT_EXTS.includes(safeExt(file.originalname));
}
const uploadSplat = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ensureDir(path.join(UPLOADS_DIR, 'splats'))),
    filename: (req, file, cb) => cb(null, crypto.randomUUID() + safeExt(file.originalname)),
  }),
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'thumb') return cb(null, isImage(file));
    // The 360 backdrop is an ordinary image: browsers can't decode .hdr/.exr,
    // so what gets uploaded here is an equirectangular JPG/PNG/WebP.
    if (file.fieldname === 'background') return cb(null, isImage(file));
    if (file.fieldname === 'splat') return cb(null, isSplatFile(file));
    cb(null, false);
  },
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
});

// Disk path -> public URL under /uploads.
function toPublicPath(diskPath) {
  const rel = path.relative(UPLOADS_DIR, diskPath).split(path.sep).join('/');
  return '/uploads/' + rel;
}

module.exports = { uploadMedia, uploadDownload, uploadSiteImage, uploadPipeline, uploadSkillFrame, uploadSplat, uploadPhoto, uploadModel, toPublicPath, UPLOADS_DIR, IMAGE_MIMES, VIDEO_MIMES };
