'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const SqliteStore = require('better-sqlite3-session-store')(session);

const db = require('./db');
const { loadPublicContext } = require('./services/content');
const { getPublicRows } = require('./services/gallery');
const { getMarkers } = require('./services/pipeline');
const { UPLOADS_DIR } = require('./middleware/upload');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contact');
const imgRoutes = require('./routes/img');
const { imgUrl, imgSrcset } = require('./lib/images');
const gate = require('./middleware/gate');
const analytics = require('./middleware/analytics');

const app = express();

// Behind a reverse proxy in production so req.ip / rate-limiting are correct.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

// When the CAPTCHA gate is configured, the challenge page loads Cloudflare
// Turnstile — allow its script/frame/connections in the CSP (only then).
const TURNSTILE_CSP = gate.enabled() ? ['https://challenges.cloudflare.com'] : [];

// Security headers. CSP is tuned for the site's inline styles/scripts, the
// YouTube (nocookie) embeds, uploaded media, and YouTube thumbnail images.
app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        fontSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com', ...TURNSTILE_CSP],
        imgSrc: ["'self'", 'data:', 'https://img.youtube.com', 'https://i.ytimg.com'],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'", ...TURNSTILE_CSP],
        scriptSrcAttr: ["'unsafe-inline'"], // inline onsubmit/onclick confirm() handlers
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", ...TURNSTILE_CSP],
      },
    },
    crossOriginEmbedderPolicy: false,
    // helmet's default is `no-referrer`, which makes browsers send
    // `Origin: null` on form POSTs (per the Fetch spec) and breaks the
    // same-origin check below. This is the modern browser default and keeps a
    // real Origin/Referer on same-origin requests.
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  })
);

// Lightweight CSRF mitigation: reject cross-site state-changing requests.
// Combined with SameSite=lax session cookies this covers the admin + contact form.
function sameOrigin(req, res, next) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const host = req.get('host');

  // Check Origin first, then fall back to Referer. Values we can't parse
  // (notably the literal "null" some privacy modes/sandboxed frames send) are
  // skipped rather than rejected — a genuine cross-site POST always carries a
  // real, mismatched Origin, and SameSite=lax cookies are the other backstop.
  for (const source of [req.get('origin'), req.get('referer')]) {
    if (!source || source === 'null') continue;
    let parsed;
    try {
      parsed = new URL(source);
    } catch (e) {
      continue; // unparseable — try the next source
    }
    if (parsed.host !== host) return res.status(403).send('Cross-site request blocked.');
    return next(); // verified same-origin
  }
  next(); // nothing verifiable to check against
}

const ROOT = path.join(__dirname, '..');
const SITE_DIR = path.join(ROOT, 'max-ammon.com'); // existing fonts/images/scripts/css
const PUBLIC_DIR = path.join(ROOT, 'public'); // new assets (admin css/js, viewer, ...)

// --- View engine -----------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(ROOT, 'views'));

// --- Sessions --------------------------------------------------------------
// Moved above the static handlers so the CAPTCHA gate below can read
// req.session. With saveUninitialized:false, cookieless requests still skip the
// store, so anonymous asset requests stay cheap.
app.use(
  session({
    store: new SqliteStore({
      client: db,
      expired: { clear: true, intervalMs: 15 * 60 * 1000 },
    }),
    secret: process.env.SESSION_SECRET || 'dev-insecure-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

// --- Body parsing (admin forms, contact form, the gate challenge) ----------
app.use(express.urlencoded({ extended: false }));

// --- Optional site-wide CAPTCHA gate ---------------------------------------
// A no-op unless Turnstile keys are configured (see middleware/gate.js). When
// on, un-verified visitors are sent to /gate before any page or media is served.
app.use(gate.guard);

// --- Static assets ---------------------------------------------------------
// `no-cache` still lets the browser cache but forces a cheap revalidate, so
// edited CSS/JS/images (and regenerated *_opt.mp4 / *_preview.jpg, which reuse
// their URL) are never served stale.
const revalidate = (res) => res.setHeader('Cache-Control', 'no-cache');
app.use('/', imgRoutes); // resized/WebP image derivatives, before the disk lookup
app.use(express.static(PUBLIC_DIR, { setHeaders: revalidate }));
app.use('/uploads', express.static(UPLOADS_DIR, { setHeaders: revalidate }));
// No `extensions:['html']` here, so /gallery falls through to the template route.
app.use(express.static(SITE_DIR, { index: false, setHeaders: revalidate }));

// Block cross-site state-changing requests.
app.use(sameOrigin);

// --- CAPTCHA gate challenge (only active when Turnstile is configured) ------
app.get('/gate', (req, res) => {
  if (!gate.enabled()) return res.redirect('/');
  if (req.session && (req.session.gatePassed || req.session.userId)) return res.redirect(gate.safeNext(req.query.next));
  res.render('public/gate', {
    title: 'Max Ammon',
    siteKey: gate.siteKey(),
    next: gate.safeNext(req.query.next),
    err: req.query.err === '1',
  });
});

app.post('/gate', async (req, res) => {
  if (!gate.enabled()) return res.redirect('/');
  const ok = await gate.verify(req.body['cf-turnstile-response'], req.ip);
  const target = gate.safeNext(req.body.next);
  if (!ok) return res.redirect('/gate?err=1&next=' + encodeURIComponent(target));
  req.session.gatePassed = true;
  res.redirect(target);
});

// --- Privacy-friendly, first-party page-view analytics ---------------------
// Cookie-free; counts only real HTML page views and skips the admin area, bots,
// Do-Not-Track/GPC and the logged-in owner. Server-side, so it doesn't touch
// the CSP or the responses. (Static assets are served above, so they never
// reach this and aren't counted.)
app.use(analytics.track);

// --- Public pages ----------------------------------------------------------
function attachSiteContext(req, res, next) {
  // Pages are rendered from the DB, so they must revalidate — otherwise an
  // admin edit can appear "not to have saved" behind a cached page.
  res.setHeader('Cache-Control', 'no-cache');
  const ctx = loadPublicContext();
  res.locals.content = ctx.content;
  res.locals.settings = ctx.settings;
  res.locals.themeCss = ctx.themeCss;
  res.locals.paragraphs = ctx.paragraphs;
  res.locals.nl2br = ctx.nl2br;
  res.locals.imgUrl = imgUrl;
  res.locals.imgSrcset = imgSrcset;
  // Absolute base URL + current path, so the social-share tags in the head can
  // emit absolute og:url / og:image (behind the proxy, trust proxy makes
  // req.protocol reflect the real https scheme).
  res.locals.baseUrl = req.protocol + '://' + req.get('host');
  res.locals.currentPath = req.path;
  next();
}

app.get('/', attachSiteContext, (req, res) => {
  const owner = res.locals.settings.site_title || 'Max Ammon';
  res.render('public/index', { title: owner, contactStatus: req.query.contact || '', markers: getMarkers() });
});

app.get('/gallery', attachSiteContext, (req, res) => {
  const owner = res.locals.settings.site_title || 'Max Ammon';
  res.render('public/gallery', { title: owner + "'s Gallery", rows: getPublicRows() });
});

app.get('/impressum', attachSiteContext, (req, res) => {
  res.render('public/imprint', { title: 'Impressum/Legal Disclosure', gateOn: gate.enabled() });
});
// The page first lived at /imprint; 301 old links and bookmarks to the new path.
app.get('/imprint', (req, res) => res.redirect(301, '/impressum'));

// Public contact form handler.
app.use('/', contactRoutes);

// --- Admin -----------------------------------------------------------------
app.use('/admin', authRoutes); // /admin/login, /admin/setup, /admin/logout
app.use('/admin', adminRoutes); // /admin dashboard + editors (requireAuth)

module.exports = app;
