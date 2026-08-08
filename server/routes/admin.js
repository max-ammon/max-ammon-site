'use strict';

const express = require('express');
const { requireAuth, currentUser } = require('../services/auth');
const {
  getContentFull,
  updateContentBulk,
  getColorTokens,
  updateColorsBulk,
  resetColors,
  getSettingsMap,
  getSetting,
  updateSettings,
} = require('../services/content');
const gallery = require('../services/gallery');
const splatsSvc = require('../services/splats');
const demoArchive = require('../services/demoarchive');
const photography = require('../services/photography');
const geometry = require('../services/geometry');
const messages = require('../services/messages');
const mediaSvc = require('../services/media');
const pipeline = require('../services/pipeline');
const analytics = require('../services/analytics');
const { uploadMedia, uploadDownload, uploadSiteImage, uploadPipeline, uploadSplat, uploadPhoto, uploadModel, toPublicPath } = require('../middleware/upload');
const { parseYouTubeId, formatBytes } = require('../lib/format');
const { SHARE_PAGES } = require('../lib/share-pages');
const { DOWNLOAD_KINDS } = require('../lib/download-kinds');
const storage = require('../services/storage');

const router = express.Router();

router.use(requireAuth);
router.use((req, res, next) => {
  res.locals.user = currentUser(req);
  // Never let admin pages sit in a cache (also stops them showing via the
  // back button after logging out).
  res.setHeader('Cache-Control', 'no-store');
  next();
});

// (The old fixed-size aspect classes are retired: thumbnails are now scaled to
// a uniform height, with each item's width derived from its measured ratio.)

const SECTIONS = [
  { href: '/admin/content', title: 'Text', desc: 'Edit the words on your site (Demo, Skills, About, Contact, Gallery).' },
  { href: '/admin/colors', title: 'Colours', desc: 'Adjust the colour scheme with a live preview.' },
  { href: '/admin/images/about', title: 'Profile & banner', desc: 'Change your profile picture and the About banner image.' },
  { href: '/admin/images/skills', title: 'Skills images', desc: 'Swap the images shown with your four skill categories.' },
  { href: '/admin/pipeline', title: 'Pipeline software', desc: 'Place software logos along the production-pipeline bar in Skills.' },
  { href: '/admin/demo', title: 'Demo video', desc: 'Set the YouTube video and shape of the Demo embed.' },
  { href: '/admin/demo-archive', title: 'Demo archive', desc: 'Collect your older demo reels on their own page, linked from the Demo section.' },
  { href: '/admin/social', title: 'Social preview', desc: 'The image, title and text shown when your link is shared (LinkedIn, Discord, …).' },
  { href: '/admin/gallery', title: 'Gallery', desc: 'Add projects, upload media, embed videos, arrange the gallery.' },
  { href: '/admin/photography', title: 'Photography', desc: 'Upload and arrange the photos on your Photography page, and set how many sit in a row.' },
  { href: '/admin/splats', title: 'Gaussian Splats', desc: 'Add and arrange the splats shown on your Gaussian Splats page.' },
  { href: '/admin/geometry', title: '3D Geometry', desc: 'Upload glTF/GLB models people can rotate in the browser.' },
  { href: '/admin/messages', title: 'Messages', desc: 'Read messages sent through your contact form.' },
  { href: '/admin/analytics', title: 'Analytics', desc: 'Private, cookie-free visitor stats — views, top pages, and referrers.' },
  { href: '/admin/storage', title: 'Storage & backup', desc: 'See every stored file and what uses it, remove unused ones, and download a full backup.' },
];

router.get('/', (req, res) => {
  const unread = messages.unreadCount();
  const sections = SECTIONS.map((s) =>
    s.href === '/admin/messages' && unread ? { ...s, desc: `${unread} new message${unread > 1 ? 's' : ''}. ${s.desc}` } : s
  );
  res.render('admin/dashboard', { title: 'Dashboard', sections });
});

// --- Messages inbox --------------------------------------------------------
router.get('/messages', (req, res) => {
  res.render('admin/messages', { title: 'Messages', messages: messages.listMessages() });
});

router.post('/messages/:id/status', (req, res) => {
  messages.updateStatus(Number(req.params.id), req.body.status);
  res.redirect('/admin/messages');
});

router.post('/messages/:id/delete', (req, res) => {
  messages.deleteMessage(Number(req.params.id));
  res.redirect('/admin/messages');
});

// --- Analytics -------------------------------------------------------------
const ANALYTICS_RANGES = [7, 30, 90, 365];
router.get('/analytics', (req, res) => {
  let days = parseInt(req.query.days, 10);
  if (!ANALYTICS_RANGES.includes(days)) days = 30;
  const { fromDay, toDay } = analytics.rangeFor(days);
  res.render('admin/analytics', {
    title: 'Analytics',
    days,
    ranges: ANALYTICS_RANGES,
    fromDay,
    toDay,
    data: analytics.summary(fromDay, toDay, undefined, getSetting('assets_signal_since', '')),
  });
});

// --- Text editor -----------------------------------------------------------
router.get('/content', (req, res) => {
  const blocks = getContentFull();
  const groups = {};
  for (const b of blocks) {
    if (!groups[b.grp]) groups[b.grp] = [];
    groups[b.grp].push(b);
  }
  res.render('admin/content', { title: 'Edit text', groups, saved: req.query.saved === '1' });
});

router.post('/content', (req, res) => {
  const updates = {};
  for (const b of getContentFull()) {
    if (Object.prototype.hasOwnProperty.call(req.body, b.block_key)) updates[b.block_key] = req.body[b.block_key];
  }
  updateContentBulk(updates);
  res.redirect('/admin/content?saved=1');
});

// --- Colour editor ---------------------------------------------------------
router.get('/colors', (req, res) => {
  res.render('admin/colors', { title: 'Edit colours', tokens: getColorTokens(), saved: req.query.saved === '1' });
});

router.post('/colors', (req, res) => {
  if (req.body.action === 'reset') {
    resetColors();
    return res.redirect('/admin/colors?saved=1');
  }
  const updates = {};
  for (const t of getColorTokens()) {
    if (Object.prototype.hasOwnProperty.call(req.body, t.token)) updates[t.token] = req.body[t.token];
  }
  updateColorsBulk(updates);
  res.redirect('/admin/colors?saved=1');
});

// --- Swappable site images --------------------------------------------------
// One config-driven editor serves every group of images. To expose more images
// later, add the setting to SETTINGS in db/seed.js and list it here.
const IMAGE_GROUPS = {
  about: {
    title: 'Profile & banner',
    desc: 'The two images in your “About Me” section.',
    fields: [
      { key: 'about_profile', label: 'Profile picture', shape: 'round', hint: 'Displayed as a circle — a non-square photo is centre-cropped, not squashed.' },
      { key: 'about_banner', label: 'About banner', shape: 'wide' },
    ],
  },
  skills: {
    title: 'Skills images',
    desc: 'The images shown with each of your four skill categories.',
    fields: [
      { key: 'skills_modeling_img1', label: 'Modeling & Simulations — left image', shape: 'wide' },
      { key: 'skills_modeling_img2', label: 'Modeling & Simulations — right image', shape: 'wide' },
      { key: 'skills_texturing_img', label: 'Texturing & Lighting', shape: 'wide', hint: 'The text sits on top of this one, so keep it wide.' },
      { key: 'skills_animation_img', label: 'Animation — frame 1', shape: 'wide', hint: 'Add frame 2 (and 3) below to make this image respond to scrolling: the frames cross-fade as the section passes, the current one picking up a slight aqua tint. Leave them empty for a single, static picture.' },
      { key: 'skills_animation_img2', label: 'Animation — frame 2 (optional)', shape: 'wide' },
      { key: 'skills_animation_img3', label: 'Animation — frame 3 (optional)', shape: 'wide' },
      { key: 'skills_grading_img', label: 'Compositing & Grading', shape: 'wide' },
    ],
  },
};

router.get('/images/:slug', (req, res) => {
  const group = IMAGE_GROUPS[req.params.slug];
  if (!group) return res.redirect('/admin');
  res.render('admin/images', {
    title: group.title,
    slug: req.params.slug,
    group,
    settings: getSettingsMap(),
    saved: req.query.saved === '1',
    err: req.query.err || '',
  });
});

router.post('/images/:slug', uploadSiteImage.any(), (req, res) => {
  const group = IMAGE_GROUPS[req.params.slug];
  if (!group) return res.redirect('/admin');

  const files = {};
  (req.files || []).forEach((f) => { files[f.fieldname] = f; });

  const updates = {};
  for (const field of group.fields) {
    const uploaded = files['file__' + field.key];
    if (uploaded) updates[field.key] = toPublicPath(uploaded.path);
    else if (req.body['path__' + field.key]) updates[field.key] = String(req.body['path__' + field.key]).trim();
  }
  updateSettings(updates);
  res.redirect('/admin/images/' + req.params.slug + '?saved=1');
});

// --- Pipeline software markers ----------------------------------------------
router.get('/pipeline', (req, res) => {
  res.render('admin/pipeline', {
    title: 'Pipeline software',
    markers: pipeline.getMarkers(),
    saved: req.query.saved === '1',
    err: req.query.err || '',
  });
});

router.post('/pipeline', uploadPipeline.single('image'), (req, res) => {
  // multer's filter drops non-images silently — tell the owner rather than
  // redirecting as if it worked.
  if (!req.file) return res.redirect('/admin/pipeline?err=nofile');
  pipeline.addMarker({ image_path: toPublicPath(req.file.path), label: req.body.label, position: req.body.position, vertical: req.body.vertical ? 1 : 0 });
  res.redirect('/admin/pipeline?saved=1');
});

router.post('/pipeline/:id', uploadPipeline.single('image'), (req, res) => {
  pipeline.updateMarker(Number(req.params.id), {
    // A new upload replaces the icon; omitting the field keeps the current one.
    image_path: req.file ? toPublicPath(req.file.path) : undefined,
    label: req.body.label,
    position: req.body.position,
    vertical: req.body.vertical ? 1 : 0,
  });
  res.redirect('/admin/pipeline?saved=1');
});

router.post('/pipeline/:id/delete', (req, res) => {
  pipeline.deleteMarker(Number(req.params.id));
  res.redirect('/admin/pipeline?saved=1');
});

// --- Demo video ------------------------------------------------------------
router.get('/demo', (req, res) => {
  res.render('admin/demo', { title: 'Demo video', settings: getSettingsMap(), saved: req.query.saved === '1' });
});

router.post('/demo', uploadSiteImage.single('poster'), (req, res) => {
  const updates = {};
  const id = parseYouTubeId(req.body.demo_youtube_id || '');
  if (id) updates.demo_youtube_id = id;
  if (/^\d{2,5}$/.test(req.body.demo_aspect_w || '')) updates.demo_aspect_w = req.body.demo_aspect_w;
  if (/^\d{2,5}$/.test(req.body.demo_aspect_h || '')) updates.demo_aspect_h = req.body.demo_aspect_h;
  if (req.file) updates.demo_poster = toPublicPath(req.file.path);
  else if (req.body.demo_poster) updates.demo_poster = req.body.demo_poster;
  updateSettings(updates);
  res.redirect('/admin/demo?saved=1');
});

// --- Photography -----------------------------------------------------------
router.get('/photography', (req, res) => {
  const settings = getSettingsMap();
  res.render('admin/photography', {
    title: 'Photography',
    photos: photography.listPhotos(),
    columns: photography.columnsFrom(settings),
    maxColumns: photography.MAX_COLUMNS,
    visible: String(settings.photography_visible) !== '0',
    selected: String(req.query.sel || '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0),
    saved: req.query.saved === '1',
    err: req.query.err || '',
  });
});

// Several photos can be uploaded at once; each becomes its own entry, measured
// so the page can lay them out in justified rows.
router.post('/photography', uploadPhoto.array('photos', 40), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.redirect('/admin/photography?err=nofile');
  try {
    for (const f of files) {
      const dim = await mediaSvc.imageSize(f.path);
      photography.addPhoto({ image_path: toPublicPath(f.path), width: dim.width, height: dim.height });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('photo upload error:', e.message);
    return res.redirect('/admin/photography?err=upload');
  }
  res.redirect('/admin/photography?saved=1');
});

// Take the whole Photography page off the site (or put it back). Hidden means
// hidden from visitors: the owner keeps the header link and the page itself, or
// there'd be no way to work on it.
router.post('/photography/visibility', (req, res) => {
  updateSettings({ photography_visible: req.body.visible === 'on' ? '1' : '0' });
  res.redirect('/admin/photography?saved=1');
});

// Move several photos at once, by however many places. The ids that moved come
// back in the redirect so the page can tick them again — reselecting a dozen
// photos after every nudge would make the feature not worth using.
router.post('/photography/move-selection', (req, res) => {
  const moved = photography.moveSelection(req.body.ids || [], req.body.dir === 'up' ? -1 : 1, req.body.steps);
  // Keep the URL sane: past a certain size the selection is not worth echoing.
  const sel = moved.length && moved.length <= 100 ? '&sel=' + moved.join(',') : '';
  res.redirect('/admin/photography?saved=1' + sel);
});

router.post('/photography/columns', (req, res) => {
  const n = parseInt(req.body.photography_columns, 10);
  if (isFinite(n) && n >= 1 && n <= photography.MAX_COLUMNS) updateSettings({ photography_columns: String(n) });
  res.redirect('/admin/photography?saved=1');
});

router.post('/photography/:id', (req, res) => {
  photography.updatePhoto(Number(req.params.id), {
    title: req.body.title,
    date_text: req.body.date_text,
    published: req.body.published === 'on',
    row_break: req.body.row_break === 'on',
  });
  res.redirect('/admin/photography?saved=1');
});

router.post('/photography/:id/delete', (req, res) => {
  photography.deletePhoto(Number(req.params.id));
  res.redirect('/admin/photography?saved=1');
});

router.post('/photography/:id/move', (req, res) => {
  photography.movePhoto(Number(req.params.id), req.body.dir === 'up' ? -1 : 1);
  res.redirect('/admin/photography');
});

// --- Demo archive ----------------------------------------------------------
router.get('/demo-archive', (req, res) => {
  res.render('admin/demo-archive', {
    title: 'Demo archive',
    items: demoArchive.listItems(),
    saved: req.query.saved === '1',
    err: req.query.err || '',
  });
});

router.post('/demo-archive', uploadSiteImage.single('poster'), (req, res) => {
  const youtubeId = parseYouTubeId(req.body.youtube_id || '');
  if (!youtubeId) return res.redirect('/admin/demo-archive?err=embed');
  demoArchive.addItem({
    title: req.body.title,
    youtube_id: youtubeId,
    aspect_w: req.body.aspect_w,
    aspect_h: req.body.aspect_h,
    poster_path: req.file ? toPublicPath(req.file.path) : (req.body.poster_path || '').trim(),
    published: req.body.published === 'on',
  });
  res.redirect('/admin/demo-archive?saved=1');
});

router.post('/demo-archive/:id', uploadSiteImage.single('poster'), (req, res) => {
  demoArchive.updateItem(Number(req.params.id), {
    title: req.body.title,
    // Blank/unparseable leaves the current video in place.
    youtube_id: parseYouTubeId(req.body.youtube_id || ''),
    aspect_w: req.body.aspect_w,
    aspect_h: req.body.aspect_h,
    poster_path: req.file ? toPublicPath(req.file.path) : (req.body.poster_path || '').trim(),
    published: req.body.published === 'on',
  });
  res.redirect('/admin/demo-archive?saved=1');
});

router.post('/demo-archive/:id/delete', (req, res) => {
  demoArchive.deleteItem(Number(req.params.id));
  res.redirect('/admin/demo-archive?saved=1');
});

router.post('/demo-archive/:id/move', (req, res) => {
  demoArchive.moveItem(Number(req.params.id), req.body.dir === 'up' ? -1 : 1);
  res.redirect('/admin/demo-archive');
});

// --- Social preview (Open Graph) -------------------------------------------
router.get('/social', (req, res) => {
  res.render('admin/social', {
    title: 'Social preview',
    settings: getSettingsMap(),
    sharePages: SHARE_PAGES,
    saved: req.query.saved === '1',
  });
});

// The site-wide default plus an optional per-page override for each SHARE_PAGES
// entry. Each override has its own file field (<key>_image) and pasted-path
// field (share_<key>_image); a blank override falls back to the default in the
// head partial. `.any()` collects every image field in one go.
router.post('/social', uploadSiteImage.any(), (req, res) => {
  const files = {};
  (req.files || []).forEach((f) => {
    files[f.fieldname] = f;
  });

  const updates = {
    share_title: (req.body.share_title || '').trim(),
    share_description: (req.body.share_description || '').trim(),
    share_splat_description: (req.body.share_splat_description || '').trim(),
    // An unchecked checkbox isn't submitted, so its absence means "off".
    social_preview_bots: req.body.social_preview_bots ? '1' : '0',
  };
  if (files.image) updates.share_image = toPublicPath(files.image.path);
  else if (typeof req.body.share_image === 'string') updates.share_image = req.body.share_image.trim();

  for (const pg of SHARE_PAGES) {
    updates['share_' + pg.key + '_title'] = (req.body['share_' + pg.key + '_title'] || '').trim();
    updates['share_' + pg.key + '_description'] = (req.body['share_' + pg.key + '_description'] || '').trim();
    const uploaded = files[pg.key + '_image'];
    if (uploaded) updates['share_' + pg.key + '_image'] = toPublicPath(uploaded.path);
    else if (typeof req.body['share_' + pg.key + '_image'] === 'string')
      updates['share_' + pg.key + '_image'] = req.body['share_' + pg.key + '_image'].trim();
  }

  updateSettings(updates);
  res.redirect('/admin/social?saved=1');
});

// --- Gallery: project list -------------------------------------------------
router.get('/gallery', (req, res) => {
  res.render('admin/gallery-list', { title: 'Gallery', projects: gallery.listProjects() });
});

router.post('/gallery', (req, res) => {
  const id = gallery.createProject({ title: req.body.title || 'New project', layout: req.body.layout });
  res.redirect('/admin/gallery/' + id);
});

router.post('/gallery/:id/move', (req, res) => {
  gallery.moveProject(Number(req.params.id), req.body.dir === 'up' ? -1 : 1);
  res.redirect('/admin/gallery');
});

// --- Gallery: single project editor ---------------------------------------
router.get('/gallery/:id', (req, res) => {
  const project = gallery.getProjectFull(Number(req.params.id));
  if (!project) return res.redirect('/admin/gallery');
  res.render('admin/gallery-edit', {
    title: 'Edit — ' + project.title,
    project,
    // Pickable cross-link targets for the little icons on the gallery card.
    linkModels: geometry.listModels(),
    linkSplats: splatsSvc.listSplats(),
    downloadKinds: DOWNLOAD_KINDS,
    hasSharp: mediaSvc.hasSharp,
    saved: req.query.saved === '1',
    err: req.query.err || '',
  });
});

router.post('/gallery/:id', (req, res) => {
  gallery.updateProject(Number(req.params.id), {
    title: req.body.title,
    year: req.body.year,
    description: req.body.description,
    layout: req.body.layout,
    published: req.body.published === 'on',
    link_model_id: req.body.link_model_id,
    link_splat_id: req.body.link_splat_id,
  });
  res.redirect('/admin/gallery/' + req.params.id + '?saved=1');
});

router.post('/gallery/:id/delete', (req, res) => {
  gallery.deleteProject(Number(req.params.id));
  res.redirect('/admin/gallery');
});

router.post('/gallery/:id/thumbnail', (req, res) => {
  gallery.setThumbnail(Number(req.params.id), Number(req.body.media_id));
  res.redirect('/admin/gallery/' + req.params.id);
});

// Add media: file upload (image/video) or a YouTube embed.
router.post(
  '/gallery/:id/media',
  uploadMedia.fields([
    { name: 'file', maxCount: 1 },
    { name: 'preview', maxCount: 1 },
    { name: 'frames', maxCount: 600 }, // a turntable's image sequence
  ]),
  async (req, res) => {
    const pid = Number(req.params.id);
    const type = req.body.media_type;
    // There's no shape to pick any more — a thumbnail's proportions come from
    // the file itself (sharp measures images; the browser reports video
    // dimensions at upload). Everything is then scaled to one uniform height.
    const common = { title: req.body.title, year: req.body.year, description: req.body.description, alt_text: req.body.alt_text };
    try {
      if (type === 'embed') {
        const embedId = parseYouTubeId(req.body.embed_url);
        if (!embedId) return res.redirect('/admin/gallery/' + pid + '?err=embed');
        gallery.addMedia(pid, { ...common, type: 'embed', embed_provider: 'youtube', embed_id: embedId, aspect_ratio: 16 / 9 });
      } else if (type === 'turntable') {
        /*
         * A turntable is either an image sequence or a single video the slider
         * scrubs. Only the first frame gets a generated preview — it is the one
         * the gallery card shows, and the rest are resized on demand by /img, so
         * a 200-frame sequence doesn't leave 200 unused preview files behind.
         */
        const frames = (req.files && req.files.frames) || [];
        const video = req.files && req.files.file && req.files.file[0];
        if (!frames.length && !video) return res.redirect('/admin/gallery/' + pid + '?err=nofile');

        if (frames.length) {
          const first = await mediaSvc.processImage(frames[0]);
          const id = gallery.addMedia(pid, {
            ...common,
            type: 'turntable',
            full_path: first.full_path,
            preview_path: first.preview_path,
            width: first.width,
            height: first.height,
          });
          gallery.addFrames(id, frames.map((f) => toPublicPath(f.path)));
        } else {
          const info = await mediaSvc.processVideo(video);
          if (!info.width) info.width = Number(req.body.media_width) || null;
          if (!info.height) info.height = Number(req.body.media_height) || null;
          gallery.addMedia(pid, {
            ...common,
            type: 'turntable',
            full_path: info.full_path,
            preview_path: info.preview_path,
            width: info.width,
            height: info.height,
          });
        }
      } else {
        const file = req.files && req.files.file && req.files.file[0];
        // multer's filter drops unsupported files silently — tell the owner
        // rather than redirecting as if it worked.
        if (!file) return res.redirect('/admin/gallery/' + pid + '?err=nofile');

        let info;
        if (type === 'video') {
          // Probes the file and, with ffmpeg present, derives a small looping
          // preview so the gallery card doesn't stream the whole video.
          info = await mediaSvc.processVideo(file);
          // An explicitly uploaded preview always beats the generated one
          // (optimized to a small looping clip, same as the "Add preview" button).
          const pv = req.files.preview && req.files.preview[0];
          if (pv) info.preview_path = (await mediaSvc.processPreviewClip(pv)).preview_path;
          // Fall back to the browser's measurement only if ffprobe couldn't read it.
          if (!info.width) info.width = Number(req.body.media_width) || null;
          if (!info.height) info.height = Number(req.body.media_height) || null;
        } else {
          info = await mediaSvc.processImage(file);
        }
        gallery.addMedia(pid, { ...common, type: type === 'video' ? 'video' : 'image', full_path: info.full_path, preview_path: info.preview_path, width: info.width, height: info.height });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('media upload error:', e.message);
      return res.redirect('/admin/gallery/' + pid + '?err=upload');
    }
    res.redirect('/admin/gallery/' + pid);
  }
);

// Attach or replace the small preview clip on an existing media item — avoids
// having to delete and re-upload a large full file just to add a preview.
router.post('/gallery/:id/media/:mediaId/preview', uploadMedia.single('preview'), async (req, res) => {
  const pid = Number(req.params.id);
  const m = gallery.getMedia(Number(req.params.mediaId));
  if (!m || m.project_id !== pid) return res.redirect('/admin/gallery/' + pid);
  if (!req.file) return res.redirect('/admin/gallery/' + pid + '?err=nofile');
  try {
    // Works for videos and embeds alike: an embed has no full file, so this
    // clip becomes the looping thumbnail the gallery card plays instead of the
    // static YouTube image (clicking the card still opens the real video).
    const { preview_path, width, height } = await mediaSvc.processPreviewClip(req.file);
    gallery.setPreview(m.id, preview_path);
    // Size an embed card to its clip so a wider-than-16:9 clip isn't cropped.
    if (m.type === 'embed') gallery.setEmbedPreviewShape(m.id, width, height);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('preview upload error:', e.message);
    return res.redirect('/admin/gallery/' + pid + '?err=upload');
  }
  res.redirect('/admin/gallery/' + pid);
});

// Clear a preview: fall back to using the full file (the original behaviour).
router.post('/gallery/:id/media/:mediaId/preview/remove', (req, res) => {
  const pid = Number(req.params.id);
  const m = gallery.getMedia(Number(req.params.mediaId));
  if (!m || m.project_id !== pid) return res.redirect('/admin/gallery/' + pid);
  gallery.setPreview(m.id, m.full_path);
  // Back to the 16:9 of the static YouTube thumbnail now shown in the clip's place.
  if (m.type === 'embed') gallery.setEmbedPreviewShape(m.id, null, null);
  res.redirect('/admin/gallery/' + pid);
});

// Append frames to an existing turntable, so a sequence can be extended (or
// uploaded in batches) without rebuilding the item.
router.post('/gallery/:id/media/:mediaId/frames', uploadMedia.array('frames', 600), (req, res) => {
  const pid = Number(req.params.id);
  const m = gallery.getMedia(Number(req.params.mediaId));
  if (!m || m.project_id !== pid || m.type !== 'turntable') return res.redirect('/admin/gallery/' + pid);
  const files = req.files || [];
  if (!files.length) return res.redirect('/admin/gallery/' + pid + '?err=nofile');
  gallery.addFrames(m.id, files.map((f) => toPublicPath(f.path)));
  res.redirect('/admin/gallery/' + pid);
});

router.post('/gallery/:id/media/:mediaId/move', (req, res) => {
  gallery.moveMedia(Number(req.params.id), Number(req.params.mediaId), req.body.dir === 'up' ? -1 : 1);
  res.redirect('/admin/gallery/' + req.params.id);
});

router.post('/media/:id/delete', (req, res) => {
  const m = gallery.getMedia(Number(req.params.id));
  gallery.deleteMedia(Number(req.params.id));
  res.redirect('/admin/gallery/' + (m ? m.project_id : ''));
});

// Downloads
router.post('/gallery/:id/downloads', uploadDownload.single('file'), (req, res) => {
  const pid = Number(req.params.id);
  const file = req.file;
  if (file) {
    gallery.addDownload(pid, {
      label: req.body.label || file.originalname,
      file_path: toPublicPath(file.path),
      kind: req.body.kind || '',
      filesize_bytes: file.size,
    });
  }
  res.redirect('/admin/gallery/' + pid);
});

// Rename a download button (the text visitors see on it).
router.post('/downloads/:id/label', (req, res) => {
  const pid = gallery.updateDownloadLabel(Number(req.params.id), req.body.label, req.body.kind);
  res.redirect(pid ? '/admin/gallery/' + pid : req.get('Referer') || '/admin/gallery');
});

router.post('/downloads/:id/delete', (req, res) => {
  gallery.deleteDownload(Number(req.params.id));
  res.redirect(req.get('Referer') || '/admin/gallery');
});

// --- Gaussian Splats -------------------------------------------------------
// The add/edit forms post two files at once: a `thumb` image and the `splat`
// file itself. multer's filters drop anything off the allow-list, so a missing
// splat on create is reported rather than saved as a broken entry.
const splatFields = uploadSplat.fields([{ name: 'thumb', maxCount: 1 }, { name: 'splat', maxCount: 1 }, { name: 'background', maxCount: 1 }]);

async function thumbInfo(file) {
  const out = { thumb_path: toPublicPath(file.path), aspect_ratio: null };
  const dim = await mediaSvc.imageSize(file.path);
  if (dim.width && dim.height) out.aspect_ratio = Number((dim.width / dim.height).toFixed(4));
  return out;
}
function splatExt(file) {
  const m = (file.originalname || '').match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

router.get('/splats', (req, res) => {
  res.render('admin/splats', {
    title: 'Gaussian Splats',
    splats: splatsSvc.listSplats(),
    linkModels: geometry.listModels(),
    linkProjects: gallery.listProjects(),
    saved: req.query.saved === '1',
    err: req.query.err || '',
  });
});

router.post('/splats', splatFields, async (req, res) => {
  const thumb = req.files && req.files.thumb && req.files.thumb[0];
  const splat = req.files && req.files.splat && req.files.splat[0];
  const background = req.files && req.files.background && req.files.background[0];
  if (!splat) return res.redirect('/admin/splats?err=nosplat');
  const data = {
    title: req.body.title,
    year: req.body.year,
    description: req.body.description,
    splat_path: toPublicPath(splat.path),
    splat_format: splatExt(splat),
    published: req.body.published === 'on',
    flip_up: req.body.flip_up === 'on',
    background_path: background ? toPublicPath(background.path) : '',
  };
  if (thumb) Object.assign(data, await thumbInfo(thumb));
  splatsSvc.createSplat(data);
  res.redirect('/admin/splats?saved=1');
});

router.post('/splats/:id', splatFields, async (req, res) => {
  const thumb = req.files && req.files.thumb && req.files.thumb[0];
  const splat = req.files && req.files.splat && req.files.splat[0];
  const background = req.files && req.files.background && req.files.background[0];
  const data = {
    title: req.body.title,
    year: req.body.year,
    description: req.body.description,
    published: req.body.published === 'on',
    flip_up: req.body.flip_up === 'on',
    link_model_id: req.body.link_model_id,
    link_project_id: req.body.link_project_id,
    remove_background: req.body.remove_background === 'on',
  };
  // A new upload replaces that file; omitting it keeps the current one.
  if (background) data.background_path = toPublicPath(background.path);
  if (thumb) Object.assign(data, await thumbInfo(thumb));
  if (splat) {
    data.splat_path = toPublicPath(splat.path);
    data.splat_format = splatExt(splat);
  }
  splatsSvc.updateSplat(Number(req.params.id), data);
  res.redirect('/admin/splats?saved=1');
});

router.post('/splats/:id/delete', (req, res) => {
  splatsSvc.deleteSplat(Number(req.params.id));
  res.redirect('/admin/splats?saved=1');
});

router.post('/splats/:id/move', (req, res) => {
  splatsSvc.moveSplat(Number(req.params.id), req.body.dir === 'up' ? -1 : 1);
  res.redirect('/admin/splats');
});

// Owner-only, called by the viewer's live exposure slider (auto-saves as you
// drag). Returns JSON; requireAuth + sameOrigin above already gate it.
router.post('/splats/:id/exposure', (req, res) => {
  const exposure = splatsSvc.setExposure(Number(req.params.id), req.body.exposure);
  res.json({ ok: true, exposure });
});

// Owner-only white balance / tint, saved live from the viewer's Colour panel.
router.post('/splats/:id/grade', (req, res) => {
  res.json({ ok: true, ...splatsSvc.setGrade(Number(req.params.id), req.body.white_balance, req.body.tint) });
});

// Owner-only, called by the viewer's "Set default view" / "Clear" buttons: saves
// the camera the visitor starts at (and that Reset returns to).
// Owner-only backdrop rotation, saved live from the viewer's Backdrop panel.
router.post('/splats/:id/backdrop', (req, res) => {
  res.json({ ok: true, background_yaw: splatsSvc.setBackdropYaw(Number(req.params.id), req.body.background_yaw) });
});

router.post('/splats/:id/view', (req, res) => {
  if (req.body.clear) {
    splatsSvc.clearDefaultView(Number(req.params.id));
    return res.json({ ok: true, view: null });
  }
  const view = splatsSvc.setDefaultView(Number(req.params.id), req.body);
  if (!view) return res.status(400).json({ ok: false, error: 'invalid view' });
  res.json({ ok: true, view });
});

// --- 3D geometry -----------------------------------------------------------
const modelFields = uploadModel.fields([{ name: 'thumb', maxCount: 1 }, { name: 'model', maxCount: 1 }]);

function modelExt(file) {
  const m = (file.originalname || '').match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : '';
}

router.get('/geometry', (req, res) => {
  res.render('admin/geometry', {
    title: '3D Geometry',
    models: geometry.listModels(),
    linkSplats: splatsSvc.listSplats(),
    linkProjects: gallery.listProjects(),
    saved: req.query.saved === '1',
    err: req.query.err || '',
  });
});

router.post('/geometry', modelFields, async (req, res) => {
  const thumb = req.files && req.files.thumb && req.files.thumb[0];
  const model = req.files && req.files.model && req.files.model[0];
  if (!model) return res.redirect('/admin/geometry?err=nomodel');
  const data = {
    title: req.body.title,
    year: req.body.year,
    description: req.body.description,
    model_path: toPublicPath(model.path),
    model_format: modelExt(model),
    published: req.body.published === 'on',
  };
  if (thumb) Object.assign(data, await thumbInfo(thumb));
  geometry.createModel(data);
  res.redirect('/admin/geometry?saved=1');
});

router.post('/geometry/:id', modelFields, async (req, res) => {
  const thumb = req.files && req.files.thumb && req.files.thumb[0];
  const model = req.files && req.files.model && req.files.model[0];
  const data = {
    title: req.body.title,
    year: req.body.year,
    description: req.body.description,
    published: req.body.published === 'on',
    auto_rotate: req.body.auto_rotate === 'on',
    wireframe_ok: req.body.wireframe_ok === 'on',
    background: req.body.background,
    link_splat_id: req.body.link_splat_id,
    link_project_id: req.body.link_project_id,
  };
  if (thumb) Object.assign(data, await thumbInfo(thumb));
  if (model) {
    data.model_path = toPublicPath(model.path);
    data.model_format = modelExt(model);
  }
  geometry.updateModel(Number(req.params.id), data);
  res.redirect('/admin/geometry?saved=1');
});

router.post('/geometry/:id/delete', (req, res) => {
  geometry.deleteModel(Number(req.params.id));
  res.redirect('/admin/geometry?saved=1');
});

router.post('/geometry/:id/move', (req, res) => {
  geometry.moveModel(Number(req.params.id), req.body.dir === 'up' ? -1 : 1);
  res.redirect('/admin/geometry');
});

// Called live by the viewer's owner-only lighting sliders and camera buttons.
router.post('/geometry/:id/look', (req, res) => {
  res.json({ ok: true, ...geometry.setLook(Number(req.params.id), req.body.exposure, req.body.env_intensity) });
});

// Owner-only lighting rig (key light + environment tint), saved live from the
// viewer's Light panel.
router.post('/geometry/:id/lighting', (req, res) => {
  res.json({ ok: true, ...geometry.setLighting(Number(req.params.id), req.body) });
});

// Owner-only material overrides (smooth shading, metalness/roughness), saved
// live from the viewer's Material panel.
router.post('/geometry/:id/material', (req, res) => {
  res.json({
    ok: true,
    ...geometry.setMaterial(Number(req.params.id), {
      smooth: req.body.smooth === '1',
      metalness: req.body.metalness,
      roughness: req.body.roughness,
    }),
  });
});

router.post('/geometry/:id/view', (req, res) => {
  if (req.body.clear) {
    geometry.clearDefaultView(Number(req.params.id));
    return res.json({ ok: true, view: null });
  }
  const view = geometry.setDefaultView(Number(req.params.id), req.body);
  if (!view) return res.status(400).json({ ok: false, error: 'invalid view' });
  res.json({ ok: true, view });
});

// --- Storage & backup ------------------------------------------------------
router.get('/storage', (req, res) => {
  res.render('admin/storage', {
    title: 'Storage & backup',
    data: storage.scan(),
    fmt: formatBytes,
    saved: req.query.saved || '',
  });
});

router.post('/storage/delete', (req, res) => {
  const r = storage.deleteUnused(req.body.path);
  res.redirect('/admin/storage?saved=' + (r.ok ? 'deleted' : 'kept'));
});

router.post('/storage/delete-all', (req, res) => {
  const r = storage.deleteAllUnused();
  res.redirect('/admin/storage?saved=cleaned-' + r.removed);
});

router.post('/storage/clear-cache', (req, res) => {
  storage.clearImageCache();
  res.redirect('/admin/storage?saved=cache');
});

// Full backup: a consistent DB snapshot + every uploaded file, as one .tar.
router.get('/backup', async (req, res) => {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', '_').replace(/:/g, '');
  res.setHeader('Content-Type', 'application/x-tar');
  res.setHeader('Content-Disposition', 'attachment; filename="max-ammon-backup-' + stamp + '.tar"');
  try {
    await storage.backupToStream(res);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('backup error:', e.message);
    if (!res.headersSent) {
      res.removeHeader('Content-Disposition');
      res.status(500).type('text/plain').send('Backup failed: ' + e.message);
    } else {
      res.destroy();
    }
  }
});

// Upload / form errors within the admin (e.g. file too large).
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('admin error:', err.message);
  res.status(400).send('There was a problem with your request: ' + err.message + '. Go back and try again.');
});

module.exports = router;
