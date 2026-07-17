'use strict';

const { classRatio, DEFAULT_RATIO } = require('../lib/aspect');

/*
 * One-off migration: give every media item an aspect_ratio.
 *  - images : measured from the actual file with sharp (most accurate)
 *  - videos : taken from the legacy size class the owner picked
 *  - embeds : 16:9 (YouTube)
 * Runs on boot and only touches rows where aspect_ratio IS NULL, so it's a
 * no-op once everything has one.
 */
async function backfillAspectRatios(db) {
  const rows = db
    .prepare('SELECT id, type, aspect_class, full_path, preview_path, width, height FROM media_items WHERE aspect_ratio IS NULL')
    .all();
  if (!rows.length) return 0;

  let sharp = null;
  try {
    sharp = require('sharp');
  } catch (e) {
    sharp = null;
  }
  const { resolvePublicPath } = require('../services/media');

  const upd = db.prepare(
    'UPDATE media_items SET aspect_ratio = ?, width = COALESCE(?, width), height = COALESCE(?, height) WHERE id = ?'
  );

  let done = 0;
  for (const m of rows) {
    let ratio = null;
    let w = null;
    let h = null;

    if (m.type === 'embed') {
      ratio = DEFAULT_RATIO;
    } else if (m.type === 'image' && sharp) {
      const disk = resolvePublicPath(m.full_path || m.preview_path);
      if (disk) {
        try {
          const meta = await sharp(disk).metadata();
          if (meta.width && meta.height) {
            w = meta.width;
            h = meta.height;
            ratio = meta.width / meta.height;
          }
        } catch (e) {
          /* unreadable file — fall through to the class map */
        }
      }
    }

    if (!ratio && m.width > 0 && m.height > 0) ratio = m.width / m.height;
    if (!ratio) ratio = classRatio(m.aspect_class);
    if (!ratio) ratio = DEFAULT_RATIO;

    upd.run(Number(ratio.toFixed(4)), w, h, m.id);
    done++;
  }
  return done;
}

module.exports = { backfillAspectRatios };
