'use strict';

/*
 * Standalone pages that can carry their own social-share (Open Graph) card in
 * addition to the site-wide default.
 *
 * To give a NEW page its own preview (e.g. a future blog): add an entry here and
 * set `res.locals.og = pageOg(res.locals.settings, '<key>')` in that page's
 * route. It then automatically gets its own section in the /admin/social editor,
 * and its settings keys (share_<key>_title/description/image) are created on
 * first save — no migration needed.
 *
 * This is for standalone PAGES only. Individual items (a gallery project, a
 * single splat) preview themselves from their own data instead.
 */
const SHARE_PAGES = [
  {
    key: 'demoarchive',
    label: 'Demo Archive',
    path: '/demo-archive',
    blurb: 'The card shown when your Demo Archive link is shared.',
  },
  {
    key: 'gallery',
    label: 'Gallery',
    path: '/gallery',
    blurb: 'The card shown when your Gallery link is shared.',
  },
  {
    key: 'splats',
    label: 'Gaussian Splats',
    path: '/splats',
    blurb: 'The card for the Gaussian Splats page. (Individual splats already preview themselves.)',
  },
];

// Per-page OG override built from the settings map. Empty fields stay empty and
// the head partial falls back to the site-wide values, so a blank section simply
// inherits the default.
function pageOg(settings, key) {
  const s = settings || {};
  return {
    title: (s['share_' + key + '_title'] || '').trim(),
    description: (s['share_' + key + '_description'] || '').trim(),
    image: (s['share_' + key + '_image'] || '').trim(),
  };
}

module.exports = { SHARE_PAGES, pageOg };
