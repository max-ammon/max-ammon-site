'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const SqliteStore = require('better-sqlite3-session-store')(session);

const db = require('./db');
const { loadPublicContext } = require('./services/content');
const { getPublicRows } = require('./services/gallery');
const { getPublicSplats, getPublicSplat } = require('./services/splats');
const { getMarkers } = require('./services/pipeline');
const { getPublicItems: getDemoArchive } = require('./services/demoarchive');
const photography = require('./services/photography');
const geometry = require('./services/geometry');
const { UPLOADS_DIR } = require('./middleware/upload');
const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');
const contactRoutes = require('./routes/contact');
const imgRoutes = require('./routes/img');
const { imgUrl, imgSrcset } = require('./lib/images');
const { pageOg } = require('./lib/share-pages');
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
        // blob: is required by the 3D viewer: three.js extracts textures embedded
        // in a .glb into blob URLs and loads them as images. A blob URL can only
        // be minted by this page's own script from data it already holds, so this
        // adds no external origin — without it, models load untextured.
        imgSrc: ["'self'", 'data:', 'blob:', 'https://img.youtube.com', 'https://i.ytimg.com'],
        mediaSrc: ["'self'"],
        objectSrc: ["'none'"],
        // 'wasm-unsafe-eval' lets the 3D-geometry viewer compile its WebAssembly
        // decoders (Draco geometry + KTX2/Basis textures, both self-hosted with
        // three.js). It permits WebAssembly ONLY — it does not re-enable
        // JavaScript eval()/new Function() — and script-src 'self' still means
        // those .wasm files can only come from this server.
        scriptSrc: ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", ...TURNSTILE_CSP],
        scriptSrcAttr: ["'unsafe-inline'"], // inline onsubmit/onclick confirm() handlers
        styleSrc: ["'self'", "'unsafe-inline'"],
        // blob: as above — three.js fetches those texture blobs (and the KTX2
        // transcoder runs from one) rather than loading them via <img>.
        connectSrc: ["'self'", 'blob:', ...TURNSTILE_CSP],
        workerSrc: ["'self'", 'blob:'], // KTX2/Basis transcoder + Draco workers
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
// Notes which visitors go on to fetch the stylesheet/fonts — the signal that a
// real browser rendered the page, rather than a crawler taking the HTML alone.
// Must sit before the static handlers, which end the request.
app.use(analytics.markAssets);

app.use('/', imgRoutes); // resized/WebP image derivatives, before the disk lookup
app.use(express.static(PUBLIC_DIR, { setHeaders: revalidate }));
// three.js for the 3D-geometry viewer, served from the installed package (MIT).
// Versioned by the package itself and never edited, so it can cache hard.
app.use(
  '/vendor/three',
  express.static(path.join(ROOT, 'node_modules', 'three'), {
    index: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
  })
);
app.use(
  '/uploads',
  express.static(UPLOADS_DIR, {
    setHeaders: (res, filePath) => {
      revalidate(res);
      // Project downloads can be any file type, so always hand them over as a
      // download rather than letting the browser render them in this origin.
      if (/[\\/]downloads[\\/]/.test(filePath)) res.setHeader('Content-Disposition', 'attachment');
    },
  })
);
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
  // Whether the owner is logged in. Set here rather than per route so shared
  // partials (the header) can show them what a visitor isn't seeing.
  res.locals.isOwner = !!(req.session && req.session.userId);
  next();
}

// A section can be switched off in the dashboard while it's being worked on.
// Hidden means hidden from visitors only — the owner still sees it, otherwise
// there'd be no way to finish it.
function sectionVisible(res, key) {
  return String(res.locals.settings[key]) !== '0' || res.locals.isOwner;
}

/*
 * Where a viewer's "back" link should point. A splat or model opened from a
 * gallery card carries ?from=gallery so leaving the viewer returns there rather
 * than to its own listing. Only these known keys are honoured, so the parameter
 * can never be used to bounce a visitor somewhere unexpected.
 */
const VIEWER_ORIGINS = {
  gallery: { href: '/gallery', label: 'Project Gallery' },
  geometry: { href: '/geometry', label: '3D Geometry' },
  splats: { href: '/splats', label: 'Gaussian Splats' },
  photography: { href: '/photography', label: 'Photography' },
};
function backLink(req, href, label) {
  return VIEWER_ORIGINS[String(req.query.from || '')] || { href: href, label: label };
}

// Plain-text, length-limited text for a social-preview description card.
function ogText(s) {
  const t = String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 200 ? t.slice(0, 197).replace(/\s+\S*$/, '') + '…' : t;
}

app.get('/', attachSiteContext, (req, res) => {
  const owner = res.locals.settings.site_title || 'Max Ammon';
  res.render('public/index', { title: owner, contactStatus: req.query.contact || '', markers: getMarkers() });
});

// Demo Archive — past demo reels on their own page (linked from the Demo section).
app.get('/demo-archive', attachSiteContext, (req, res) => {
  const owner = res.locals.settings.site_title || 'Max Ammon';
  res.locals.og = pageOg(res.locals.settings, 'demoarchive');
  res.render('public/demo-archive', { title: owner + ' — Demo Archive', items: getDemoArchive() });
});

app.get('/gallery', attachSiteContext, (req, res) => {
  const owner = res.locals.settings.site_title || 'Max Ammon';
  res.locals.og = pageOg(res.locals.settings, 'gallery');
  res.render('public/gallery', { title: owner + "'s Gallery", rows: getPublicRows(), currentYear: new Date().getFullYear() });
});

// Photography — a separate page of photos (reached from the gallery/splats
// headers). Switched off in the dashboard it behaves as though it isn't there:
// no header link, and the URL falls through to the same 404 as any other
// unknown path, so a stale link or bookmark can't reach it either.
app.get('/photography', attachSiteContext, (req, res, next) => {
  if (!sectionVisible(res, 'photography_visible')) return next();
  const owner = res.locals.settings.site_title || 'Max Ammon';
  const cols = photography.columnsFrom(res.locals.settings);
  res.locals.og = pageOg(res.locals.settings, 'photography');
  res.render('public/photography', {
    title: owner + ' — Photography',
    rows: photography.toRows(photography.getPublicPhotos(), cols),
    cols,
    hidden: String(res.locals.settings.photography_visible) === '0',
  });
});

// 3D Geometry — glTF/GLB models, listed then opened in the three.js viewer.
app.get('/geometry', attachSiteContext, (req, res) => {
  const owner = res.locals.settings.site_title || 'Max Ammon';
  res.locals.og = pageOg(res.locals.settings, 'geometry');
  res.render('public/geometry', { title: owner + ' — 3D Geometry', models: geometry.getPublicModels() });
});

// One model in the viewer. Same shape as the splat viewer route: cosmetic slug,
// authoritative id, and a per-model social card built from its own data.
app.get(['/geometry/:id', '/geometry/:id/:slug'], attachSiteContext, (req, res) => {
  const model = geometry.getPublicModel(req.params.id);
  if (!model) return res.redirect('/geometry');
  const owner = res.locals.settings.site_title || 'Max Ammon';
  res.locals.og = {
    title: model.title || owner + ' — 3D Geometry',
    description: ogText(model.description),
    image: model.thumb_path || '',
    url: model.view_url,
  };
  const isOwner = !!(req.session && req.session.userId);
  res.render('public/geometry-view', {
    title: model.title + ' — ' + owner,
    model,
    isOwner,
    back: backLink(req, '/geometry', '3D Geometry'),
  });
});

// Gaussian Splats — a separate listing page (reached from the gallery header).
app.get('/splats', attachSiteContext, (req, res) => {
  const owner = res.locals.settings.site_title || 'Max Ammon';
  res.locals.og = pageOg(res.locals.settings, 'splats');
  res.render('public/splats', { title: owner + "'s Gaussian Splats", splats: getPublicSplats() });
});

// A single splat opened in the interactive WebGL viewer — a dedicated, shareable
// page. :slug is cosmetic (the numeric :id is authoritative), so any or no slug
// resolves the right splat; an unknown/hidden id falls back to the listing. Each
// splat sets its own social-preview (its thumbnail + title/description) via
// res.locals.og, so a shared link previews that specific splat.
app.get(['/splats/:id', '/splats/:id/:slug'], attachSiteContext, (req, res) => {
  const splat = getPublicSplat(req.params.id);
  if (!splat) return res.redirect('/splats');
  const owner = res.locals.settings.site_title || 'Max Ammon';
  res.locals.og = {
    title: splat.title || owner + ' — Gaussian Splat',
    description: ogText(splat.description),
    image: splat.thumb_path || '',
    url: splat.view_url,
  };
  // The live exposure slider is shown only to the logged-in owner.
  const isOwner = !!(req.session && req.session.userId);
  res.render('public/splat-view', {
    title: splat.title + ' — ' + owner,
    splat,
    isOwner,
    back: backLink(req, '/splats', 'Splats'),
  });
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
