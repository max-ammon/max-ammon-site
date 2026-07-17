'use strict';

/*
 * On-demand image derivatives.
 *
 *   /img/<width>/assets/images/foo.png  ->  foo.png resized to <width>, as WebP
 *
 * The source images are print/compositing exports (16-bit PNGs, up to 3840px
 * and ~30 MB) which browsers can't use: they display 8-bit, at roughly a third
 * of those dimensions. This resizes and re-encodes once, caches the result on
 * disk, and serves that instead. Originals are never modified.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');

const { resolvePublicPath } = require('../services/media');

let sharp = null;
try {
  sharp = require('sharp');
} catch (e) {
  sharp = null;
}

const ROOT = path.join(__dirname, '..', '..');
const CACHE_DIR = process.env.IMG_CACHE_DIR || path.join(ROOT, 'data', 'img-cache');
fs.mkdirSync(CACHE_DIR, { recursive: true });

// Only these widths can be requested, so the endpoint can't be used to burn CPU
// generating arbitrary sizes.
// 3200 exists for the full-bleed images (demo poster, texturing, banner): on a
// 1.5x display a 1905px-wide slot wants ~2857 real pixels, so 2400 would render
// slightly soft. The sources are 3840px, and the re-encode is small enough that
// the extra step costs little.
const ALLOWED_WIDTHS = [480, 800, 1200, 1600, 2400, 3200];
const RASTER = /\.(png|jpe?g|webp|avif|tiff?)$/i;

const router = express.Router();

router.get('/img/:width/*splat', async (req, res, next) => {
  const width = Number(req.params.width);
  if (!ALLOWED_WIDTHS.includes(width)) return res.status(400).send('Unsupported width');

  const splat = req.params.splat;
  const rest = Array.isArray(splat) ? splat.join('/') : String(splat || '');
  const publicPath = '/' + rest;

  const source = resolvePublicPath(publicPath);
  // Anything we can't resize (SVG, unknown location, sharp missing) just falls
  // through to the normal static handler for the original file.
  if (!source || !RASTER.test(source) || !sharp) return next();

  let stat;
  try {
    stat = fs.statSync(source);
  } catch (e) {
    return next();
  }

  // Cache key includes mtime+size, so replacing an image invalidates it.
  const key = crypto
    .createHash('sha1')
    .update(publicPath + '|' + width + '|' + stat.mtimeMs + '|' + stat.size)
    .digest('hex');
  const cached = path.join(CACHE_DIR, key + '.webp');

  res.type('image/webp');
  res.setHeader('Cache-Control', 'no-cache'); // revalidates cheaply via ETag

  if (fs.existsSync(cached)) return res.sendFile(cached);

  try {
    await sharp(source)
      .resize({ width, withoutEnlargement: true }) // never upscale past the original
      .webp({ quality: 82 }) // keeps alpha (the round profile picture needs it)
      .toFile(cached);
    return res.sendFile(cached);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[img] could not derive', publicPath, '->', e.message);
    return next(); // serve the original rather than failing
  }
});

module.exports = router;
module.exports.ALLOWED_WIDTHS = ALLOWED_WIDTHS;
