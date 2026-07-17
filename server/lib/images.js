'use strict';

const { ALLOWED_WIDTHS } = require('../routes/img');

// URL for a resized/WebP derivative of a site image.
//   imgUrl('/assets/images/foo.png', 1600) -> '/img/1600/assets/images/foo.png'
// External URLs and non-raster files are returned untouched.
function imgUrl(publicPath, width) {
  const p = String(publicPath || '');
  if (!p || !p.startsWith('/')) return p;
  if (!/\.(png|jpe?g|webp|avif|tiff?)$/i.test(p)) return p;
  return '/img/' + width + p;
}

// A srcset string so the browser downloads whichever size actually fits.
function imgSrcset(publicPath, widths) {
  const p = String(publicPath || '');
  if (!p || !p.startsWith('/') || !/\.(png|jpe?g|webp|avif|tiff?)$/i.test(p)) return '';
  return (widths || ALLOWED_WIDTHS).map((w) => imgUrl(p, w) + ' ' + w + 'w').join(', ');
}

module.exports = { imgUrl, imgSrcset, ALLOWED_WIDTHS };
