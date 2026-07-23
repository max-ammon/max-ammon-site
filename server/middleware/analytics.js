'use strict';

// Privacy-friendly page-view tracking. Records one event per successfully served
// HTML page — NO cookies, NO stored IP, NO raw user-agent. Unique visitors are
// estimated with a salted hash whose salt is random, held only in memory and
// rotated daily, so a hash can't be reversed to an IP or linked across days.
// Bots/prefetchers and visitors sending Do-Not-Track / GPC are skipped, as is
// the logged-in owner's own browsing. Counting happens server-side, so there is
// no client script and nothing for the CSP to allow.

const crypto = require('crypto');
const analytics = require('../services/analytics');

const RETAIN_DAYS = Number(process.env.ANALYTICS_RETENTION_DAYS) || 730;

// Never counted: the admin area and gate, and any path with a file extension
// (assets are served earlier, but this catches stragglers like /favicon.ico).
const SKIP_PATH = /^\/(admin|gate)(\/|$)/i;
const ASSET_EXT = /\.[a-z0-9]{1,8}$/i;
const BOT_UA = /bot|crawl|spider|slurp|bingpreview|facebookexternal|embedly|whatsapp|telegram|discord|preview|scan|curl|wget|python-requests|axios|headless|lighthouse|pingdom|uptime|monitor/i;

// Daily-rotating salt, kept only in memory and never written anywhere.
let saltDay = '';
let saltValue = crypto.randomBytes(16);

function deviceType(ua) {
  if (!ua) return 'desktop';
  // Tablets first: iPads and Android tablets (Android UA without "Mobile").
  if (/ipad|tablet|playbook|silk|kindle|(android(?!.*mobi))/i.test(ua)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobi|windows phone|blackberry|iemobile|opera mini/i.test(ua)) return 'mobile';
  return 'desktop';
}

// Only the external referrer's hostname is kept (never the full URL, never a
// same-site referrer, which isn't a traffic source).
function referrerHost(ref, host) {
  if (!ref) return '';
  let h;
  try { h = new URL(ref).hostname; } catch (e) { return ''; }
  if (!h) return '';
  const clean = h.replace(/^www\./i, '');
  const self = String(host || '').replace(/:\d+$/, '').replace(/^www\./i, '');
  return clean === self ? '' : clean;
}

function visitorHash(day, ip, ua) {
  if (day !== saltDay) { saltValue = crypto.randomBytes(16); saltDay = day; }
  return crypto
    .createHash('sha256')
    .update(saltValue)
    .update('|' + (ip || '') + '|' + (ua || ''))
    .digest('hex')
    .slice(0, 16);
}

function track(req, res, next) {
  if (req.method !== 'GET') return next();
  const p = req.path || '/';
  if (SKIP_PATH.test(p) || (p !== '/' && ASSET_EXT.test(p))) return next();

  const ua = req.headers['user-agent'] || '';
  const optedOut = req.headers.dnt === '1' || req.headers['sec-gpc'] === '1';
  const isOwner = !!(req.session && req.session.userId);
  if (optedOut || isOwner || BOT_UA.test(ua)) return next();

  // Record only once the response is known to be a served HTML page (200 +
  // text/html), which naturally skips redirects, 404s and asset responses.
  res.on('finish', function () {
    try {
      if (res.statusCode !== 200) return;
      if (!/text\/html/i.test(String(res.getHeader('content-type') || ''))) return;
      const now = new Date();
      const day = analytics.localDay(now);
      analytics.record({
        day,
        ts: Math.floor(now.getTime() / 1000),
        path: p,
        referrer_host: referrerHost(req.headers.referer, req.headers.host),
        device: deviceType(ua),
        visitor: visitorHash(day, req.ip, ua),
      });
      // Opportunistic, self-maintaining retention (cheap; runs ~2% of the time).
      if (Math.random() < 0.02) {
        const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - RETAIN_DAYS);
        analytics.prune(analytics.localDay(cutoff));
      }
    } catch (e) {
      /* analytics must never break a page */
    }
  });
  next();
}

module.exports = { track };
