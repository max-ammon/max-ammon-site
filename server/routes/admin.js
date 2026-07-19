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
  updateSettings,
} = require('../services/content');
const gallery = require('../services/gallery');
const messages = require('../services/messages');
const mediaSvc = require('../services/media');
const { uploadMedia, uploadDownload, uploadSiteImage, toPublicPath } = require('../middleware/upload');
const { parseYouTubeId } = require('../lib/format');

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
  { href: '/admin/demo', title: 'Demo video', desc: 'Set the YouTube video and shape of the Demo embed.' },
  { href: '/admin/gallery', title: 'Gallery', desc: 'Add projects, upload media, embed videos, arrange the gallery.' },
  { href: '/admin/messages', title: 'Messages', desc: 'Read messages sent through your contact form.' },
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
      { key: 'skills_animation_img', label: 'Animation', shape: 'wide' },
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
  uploadMedia.fields([{ name: 'file', maxCount: 1 }, { name: 'preview', maxCount: 1 }]),
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
  const pid = gallery.updateDownloadLabel(Number(req.params.id), req.body.label);
  res.redirect(pid ? '/admin/gallery/' + pid : req.get('Referer') || '/admin/gallery');
});

router.post('/downloads/:id/delete', (req, res) => {
  gallery.deleteDownload(Number(req.params.id));
  res.redirect(req.get('Referer') || '/admin/gallery');
});

// Upload / form errors within the admin (e.g. file too large).
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error('admin error:', err.message);
  res.status(400).send('There was a problem with your request: ' + err.message + '. Go back and try again.');
});

module.exports = router;
