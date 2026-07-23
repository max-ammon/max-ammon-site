'use strict';

/*
 * Optional site-wide CAPTCHA gate (Cloudflare Turnstile).
 *
 * OFF unless BOTH TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set, so the
 * site behaves exactly as before until it is deliberately configured. When on,
 * every page and every media file is withheld until the visitor passes the
 * Turnstile challenge once (a session flag then lets them browse). Styling,
 * fonts and scripts, the admin area, the challenge itself, and the ACME path
 * stay reachable so the gate page, the login and cert renewal still work.
 *
 * Note: this deliberately blocks search engines too — that is the point of a
 * whole-site gate.
 */

const { getSetting } = require('../services/content');

const SITE_KEY = (process.env.TURNSTILE_SITE_KEY || '').trim();
const SECRET = (process.env.TURNSTILE_SECRET_KEY || '').trim();

// Styling / fonts / scripts / icons are not content, so they load ungated (the
// admin login and its assets need to work without passing the public gate).
const EXEMPT_EXT = /\.(css|js|mjs|map|woff2?|ttf|otf|eot|ico|webmanifest)$/i;

// Link-preview ("unfurl") bots for the major platforms. When the owner leaves
// the toggle on (default), these are let through the gate so a shared link
// still renders its Open Graph preview card. It's a narrow bypass — only these
// user-agents, only GET, and only to read the same public pages — but a scraper
// could spoof one of these UAs, which is the accepted trade-off for previews.
const SOCIAL_BOT = /facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot|slack-imgproxy|discordbot|telegrambot|whatsapp|pinterest|redditbot|applebot|skypeuripreview|embedly|iframely|vkshare|mastodon|discourse|flipboard|tumblr|bitlybot|nuzzel|qwantify|google-inspectiontool/i;

// Owner toggle (settings key). Anything other than an explicit '0' means "on".
function socialBotsAllowed() {
  return getSetting('social_preview_bots', '1') !== '0';
}

function enabled() {
  return !!(SITE_KEY && SECRET);
}
function siteKey() {
  return SITE_KEY;
}

// Only ever redirect back to a real, local path after the challenge.
function safeNext(v) {
  const s = String(v || '');
  return s.startsWith('/') && !s.startsWith('//') ? s : '/';
}

function isExempt(p) {
  return (
    p === '/gate' ||
    p.startsWith('/gate/') ||
    p === '/imprint' || // legally-required imprint must stay reachable
    p.startsWith('/imprint/') ||
    p === '/admin' ||
    p.startsWith('/admin/') || // admin has its own login
    p.startsWith('/.well-known/') || // ACME / cert renewal
    EXEMPT_EXT.test(p)
  );
}

// Verify a Turnstile token with Cloudflare. Fails closed on any error.
async function verify(token, ip) {
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: SECRET, response: String(token) });
    if (ip) body.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    const data = await r.json();
    return !!(data && data.success);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[gate] Turnstile verify failed:', e.message);
    return false;
  }
}

// Global guard: send un-verified visitors to the challenge. The owner (logged
// in) and anyone who already passed skip it.
function guard(req, res, next) {
  if (!enabled()) return next();
  if (req.session && (req.session.gatePassed || req.session.userId)) return next();
  if (isExempt(req.path)) return next();
  // A bot POSTing straight past the pages gets refused rather than redirected.
  if (req.method !== 'GET' && req.method !== 'HEAD') return res.status(403).send('Access blocked.');
  // Let recognised link-preview bots read the page so shared links unfurl.
  if (SOCIAL_BOT.test(req.headers['user-agent'] || '') && socialBotsAllowed()) return next();
  return res.redirect('/gate?next=' + encodeURIComponent(safeNext(req.originalUrl)));
}

module.exports = { enabled, siteKey, safeNext, verify, guard };
