'use strict';

/*
 * Thumbnails are sized by a uniform height, with each item's width derived from
 * its own aspect ratio. These ratios are what the old fixed-width size classes
 * were really encoding: each class' width was hand-computed so that
 * width / ratio landed on the same height. They're kept only to migrate legacy
 * rows (and as a fallback) — new media stores a real measured ratio.
 */
const CLASS_RATIOS = {
  cinemascope: 2.3329, // 3840x1646, the ultrawide demo shape
  sixtybynine: 1.7778, // 16:9
  square: 1,
  'custom-aspect': 1.63,
  'custom-aspect1': 1.88,
};

const DEFAULT_RATIO = 16 / 9;

function classRatio(cls) {
  return CLASS_RATIOS[cls] || null;
}

// Best available ratio for a media row: measured dimensions > stored ratio >
// legacy class > 16:9.
function mediaRatio(m) {
  if (!m) return DEFAULT_RATIO;
  if (m.aspect_ratio > 0) return m.aspect_ratio;
  if (m.width > 0 && m.height > 0) return m.width / m.height;
  return classRatio(m.aspect_class) || DEFAULT_RATIO;
}

module.exports = { CLASS_RATIOS, DEFAULT_RATIO, classRatio, mediaRatio };
