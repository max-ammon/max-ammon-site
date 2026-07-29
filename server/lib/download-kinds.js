'use strict';

/*
 * What a project download *is* — shown as a small type next to the file in the
 * gallery's download menu. One list, used by both the admin picker and the
 * public menu, so adding a type later means editing only this file.
 *
 * (These replaced the original colour-space kinds — rec2020 / p3d65 / srgb —
 * which said nothing about the file type; that detail lives in each download's
 * label instead. db/index.js maps those legacy values onto 'video'.)
 */
const DOWNLOAD_KINDS = [
  { value: 'video', label: 'Video' },
  { value: 'image', label: 'Image' },
  { value: 'geometry', label: 'Geometry' },
  { value: 'pointcloud', label: 'Point cloud' },
  { value: 'rar', label: '.rar' },
  { value: 'zip', label: '.zip' },
];

const BY_VALUE = DOWNLOAD_KINDS.reduce((m, k) => {
  m[k.value] = k.label;
  return m;
}, {});

// Display label for a stored kind ('' for none / anything unrecognised, so a
// stray value never shows up as a type on the site).
function kindLabel(value) {
  return BY_VALUE[String(value || '').toLowerCase()] || '';
}

// Keep only values we know; anything else is stored as ''.
function normalizeKind(value) {
  const v = String(value || '').toLowerCase();
  return BY_VALUE[v] ? v : '';
}

module.exports = { DOWNLOAD_KINDS, kindLabel, normalizeKind };
