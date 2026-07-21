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

const app = express();

// Behind a reverse proxy in production so req.ip / rate-limiting are correct.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

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
        frameSrc: ["'self'", 'https://www.youtube-nocookie.com', 'https://www.youtube.com'],
        imgSrc: ["'self'", 'data:', 'https://img.youtube.com', 'https://i.ytimg.com'],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        scriptSrcAttr: ["'unsafe-inline'"], // inline onsubmit/onclick confirm() handlers
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
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

// --- Static assets (served before sessions so assets skip session cost) -----
// `no-cache` still lets the browser cache, but forces it to revalidate (cheap
// 304s) — so edited CSS/JS/images are never served stale from a cached copy.
const revalidate = (res) => res.setHeader('Cache-Control', 'no-cache');

// Resized/WebP image derivatives. Mounted before the static handlers so /img/*
// is served from the cache rather than looked for on disk.
app.use('/', imgRoutes);

app.use(express.static(PUBLIC_DIR, { setHeaders: revalidate }));
/*
 * Uploaded media. This once cached for 7 days on the assumption that every file
 * has a unique UUID name — but derived files (*_opt.mp4 previews, *_preview.jpg)
 * are regenerated in place at the SAME url, so a hard cache served stale clips
 * after re-encoding. `no-cache` still caches; it just revalidates first and gets
 * a cheap 304 when nothing changed.
 */
app.use('/uploads', express.static(UPLOADS_DIR, { setHeaders: revalidate }));
// No `extensions:['html']` here, so /gallery falls through to the template
// route rather than being hijacked by the raw gallery.html file.
app.use(express.static(SITE_DIR, { index: false, setHeaders: revalidate }));

// --- Sessions --------------------------------------------------------------
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

// --- Body parsing (admin forms, contact form) ------------------------------
app.use(express.urlencoded({ extended: false }));

// Block cross-site state-changing requests.
app.use(sameOrigin);

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

// Public contact form handler.
app.use('/', contactRoutes);

// --- Admin -----------------------------------------------------------------
app.use('/admin', authRoutes); // /admin/login, /admin/setup, /admin/logout
app.use('/admin', adminRoutes); // /admin dashboard + editors (requireAuth)

module.exports = app;
