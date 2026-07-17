'use strict';

/*
 * Re-encodes gallery preview clips so the gallery page stays light.
 *
 * The gallery autoplays every project's preview at once, so their combined size
 * is what a visitor pays on arrival. Hand-made previews were 2-8 MB each (~39 MB
 * total); at 700px and CRF 30 the same clips land around 40-300 KB.
 *
 * Rules:
 *  - If a project has its OWN preview clip, that clip is the source — so the
 *    moment you chose is preserved, at its FULL length, just re-encoded smaller.
 *  - If it has none (preview_path === full_path), the full video is used, capped
 *    at PREVIEW_MAX_SECONDS so a long video doesn't become a huge thumbnail.
 *  - Originals are never deleted; a new *_opt.mp4 is written alongside and the
 *    database is pointed at it.
 *  - Re-running always re-encodes from the ORIGINAL, never from a previous
 *    *_opt.mp4 — so repeated runs never stack compression on compression.
 *
 * Usage:  npm run optimize-previews          (dry run)
 *         npm run optimize-previews -- --apply
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const db = require('../db');
const video = require('../services/video');
const { resolvePublicPath } = require('../services/media');
const { toPublicPath } = require('../middleware/upload');

const APPLY = process.argv.includes('--apply');
const mb = (b) => (b / 1048576).toFixed(2) + ' MB';

(async () => {
  if (!video.hasFfmpeg()) {
    console.error('ffmpeg not found — install it first (winget install Gyan.FFmpeg), then re-run.');
    process.exit(1);
  }

  const rows = db.prepare("SELECT * FROM media_items WHERE type = 'video' ORDER BY id").all();
  console.log(`${rows.length} video item(s).${APPLY ? '' : '  DRY RUN — pass --apply to write.'}\n`);

  let before = 0;
  let after = 0;
  let done = 0;
  let skipped = 0;

  for (const m of rows) {
    // Always work from the true original. If preview_path already points at one
    // of our derived files, step back to the clip it was made from.
    let sourcePublic = m.preview_path;
    if (/_opt\.mp4$/i.test(sourcePublic || '')) {
      const base = sourcePublic.replace(/_opt\.mp4$/i, '');
      sourcePublic = null;
      for (const ext of ['.mp4', '.webm', '.mov']) {
        const cand = base + ext;
        const d = resolvePublicPath(cand);
        if (d && fs.existsSync(d)) { sourcePublic = cand; break; }
      }
      if (!sourcePublic) sourcePublic = m.full_path; // derived from the full video
    }
    if (!sourcePublic || sourcePublic === m.full_path) sourcePublic = m.full_path;

    const hasOwn = sourcePublic !== m.full_path;
    // Owner-made clips are deliberate loops: keep every frame. Only a full video
    // gets capped.
    const opts = hasOwn ? { maxSeconds: 0 } : { maxSeconds: video.PREVIEW_MAX_SECONDS };

    const srcDisk = resolvePublicPath(sourcePublic);
    if (!srcDisk || !fs.existsSync(srcDisk)) {
      console.log(`  ! media ${m.id}: source missing (${sourcePublic})`);
      continue;
    }

    const srcBytes = fs.statSync(srcDisk).size;
    const outDisk = path.join(path.dirname(srcDisk), path.basename(srcDisk, path.extname(srcDisk)) + '_opt.mp4');
    const srcMeta = await video.probe(srcDisk);
    const label = path.basename(sourcePublic) +
      (srcMeta ? `  (${srcMeta.duration.toFixed(1)}s${hasOwn ? ', kept in full' : ', from full video'})` : '');

    if (!APPLY) {
      console.log(`  would optimise  ${label}  ${mb(srcBytes)}`);
      before += srcBytes;
      continue;
    }

    const made = await video.makePreview(srcDisk, outDisk, opts);
    if (!made) {
      console.log(`  ! media ${m.id}: ffmpeg failed for ${label}`);
      continue;
    }
    const outBytes = fs.statSync(outDisk).size;
    db.prepare('UPDATE media_items SET preview_path = ? WHERE id = ?').run(toPublicPath(outDisk), m.id);

    const outMeta = await video.probe(outDisk);
    const kept = srcMeta && outMeta && Math.abs(outMeta.duration - srcMeta.duration) < 0.3;
    before += srcBytes;
    after += outBytes;
    done++;
    console.log(
      `  ${mb(srcBytes).padStart(9)} -> ${mb(outBytes).padStart(8)}   ` +
      `${(outMeta ? outMeta.duration.toFixed(1) + 's' : '?').padStart(6)} ${kept ? '(full length)' : '(trimmed)'}   ${path.basename(sourcePublic)}`
    );
  }

  console.log('');
  if (APPLY) {
    console.log(`optimised ${done}, skipped ${skipped} (already done)`);
    console.log(`gallery previews: ${mb(before)}  ->  ${mb(after)}`);
    console.log('originals kept on disk; only what the gallery serves has changed.');
  } else {
    console.log(`total preview weight today: ${mb(before)}`);
  }
  process.exit(0);
})();
