'use strict';

const fs = require('fs');
const db = require('../db');
const { formatFileSize, formatBytes } = require('../lib/format');
const { mediaRatio } = require('../lib/aspect');
const { imgUrl } = require('../lib/images');
const mediaSvc = require('./media');

// --- statements ------------------------------------------------------------
const qProjects = db.prepare('SELECT * FROM gallery_projects ORDER BY sort, id');
const qPublishedProjects = db.prepare('SELECT * FROM gallery_projects WHERE published = 1 ORDER BY sort, id');
const qProject = db.prepare('SELECT * FROM gallery_projects WHERE id = ?');
const qMediaByProject = db.prepare('SELECT * FROM media_items WHERE project_id = ? ORDER BY sort, id');
const qMedia = db.prepare('SELECT * FROM media_items WHERE id = ?');
const qDownloadsByProject = db.prepare('SELECT * FROM media_downloads WHERE project_id = ? ORDER BY sort, id');

// --- helpers ---------------------------------------------------------------
function toViewerItem(m) {
  if (m.type === 'embed') {
    return { type: 'embed', provider: m.embed_provider || 'youtube', embedId: m.embed_id, poster: m.poster_path || '' };
  }
  if (m.type === 'video') {
    // The viewer plays the real file; only the gallery card uses the small clip.
    return { type: 'video', src: mediaSvc.versionedUrl(m.full_path), poster: m.poster_path || '' };
  }
  // Stills go through the resizer: 3200px covers a 4K screen at full size and is
  // visually identical to the original while being ~20x smaller. The genuine
  // uncompressed files stay available via the per-project download links.
  const src = m.full_path || m.preview_path;
  return { type: 'image', src: imgUrl(src, 3200) || src, alt: m.alt_text || '' };
}

function decorateProject(p) {
  const media = qMediaByProject.all(p.id);
  const downloads = qDownloadsByProject.all(p.id).map((d) => ({
    ...d,
    sizeLabel: formatFileSize(d.filesize_bytes),
  }));
  const thumbRow = media.find((m) => m.id === p.thumbnail_media_id) || media[0] || null;
  // Thumbnails are sized by a uniform height; the width comes from this ratio.
  // preview_path is version-stamped: re-encoding rewrites it in place, and
  // without a changed URL browsers would keep playing the old clip.
  const thumb = thumbRow
    ? {
        ...thumbRow,
        ratio: Number(mediaRatio(thumbRow).toFixed(4)),
        preview_url: mediaSvc.versionedUrl(thumbRow.preview_path || thumbRow.full_path),
        // An embed shows the static YouTube image unless a looping clip is attached.
        hasVideoPreview: !!thumbRow.preview_path && /\.(mp4|webm|mov|m4v|ogv)$/i.test(thumbRow.preview_path),
      }
    : null;
  // Counts for the little badge on each gallery card. Embeds are videos too.
  const imageCount = media.filter((m) => m.type === 'image').length;
  const videoCount = media.filter((m) => m.type === 'video' || m.type === 'embed').length;
  return { ...p, media, downloads, thumb, imageCount, videoCount, viewerMedia: media.map(toViewerItem) };
}

// Group projects into rows: pair up half-width (layout0), full-width (layout1) alone.
function groupRows(projects) {
  const rows = [];
  let pair = [];
  const flush = () => {
    if (pair.length) {
      rows.push({ layout: 'project-layout0', projects: pair });
      pair = [];
    }
  };
  for (const p of projects) {
    if (p.layout === 'project-layout1') {
      flush();
      rows.push({ layout: 'project-layout1', projects: [p] });
    } else {
      pair.push(p);
      if (pair.length === 2) flush();
    }
  }
  flush();
  return rows;
}

// --- public reads ----------------------------------------------------------
function getPublicRows() {
  return groupRows(qPublishedProjects.all().map(decorateProject));
}

// --- admin reads -----------------------------------------------------------
function listProjects() {
  return qProjects.all().map((p) => {
    const media = qMediaByProject.all(p.id);
    const thumb = media.find((m) => m.id === p.thumbnail_media_id) || media[0] || null;
    return { ...p, mediaCount: media.length, thumb };
  });
}

// Admin-only: attach the real on-disk details of each stored file, so the
// editor can show exactly what's saved and whether a separate (small) preview
// clip exists alongside the full file. Deliberately not used by the public
// render, which shouldn't stat files on every page load.
function describeMediaFiles(m) {
  if (m.type === 'embed') {
    // Embeds have no full file, but they CAN carry an optional looping preview
    // clip that the gallery card plays instead of the static YouTube thumbnail.
    const hasSeparatePreview = !!m.preview_path;
    const preview = hasSeparatePreview ? mediaSvc.fileInfo(m.preview_path) : null;
    return {
      ...m,
      files: {
        isEmbed: true,
        hasSeparatePreview,
        full: null,
        preview: preview
          ? { path: m.preview_path, exists: preview.exists, bytes: preview.bytes, label: formatBytes(preview.bytes) }
          : null,
      },
    };
  }
  const hasSeparatePreview = !!m.preview_path && m.preview_path !== m.full_path;
  const full = mediaSvc.fileInfo(m.full_path);
  const preview = hasSeparatePreview ? mediaSvc.fileInfo(m.preview_path) : null;
  return {
    ...m,
    files: {
      hasSeparatePreview,
      full: { path: m.full_path, exists: full.exists, bytes: full.bytes, label: formatBytes(full.bytes) },
      preview: preview
        ? { path: m.preview_path, exists: preview.exists, bytes: preview.bytes, label: formatBytes(preview.bytes) }
        : null,
    },
  };
}

function getProjectFull(id) {
  const p = qProject.get(id);
  if (!p) return null;
  return {
    ...p,
    media: qMediaByProject.all(id).map(describeMediaFiles),
    downloads: qDownloadsByProject.all(id).map((d) => ({ ...d, sizeLabel: formatFileSize(d.filesize_bytes) })),
  };
}

function getMedia(id) {
  return qMedia.get(id) || null;
}

// --- admin mutations -------------------------------------------------------
const insProject = db.prepare(
  "INSERT INTO gallery_projects (title, year, description, layout, sort, published) VALUES (@title, @year, @description, @layout, @sort, @published)"
);
// New projects go to the TOP of the gallery (newest work first), so this takes
// one below the current lowest sort rather than one above the highest.
// Values may go negative — harmless, since only the relative order matters, and
// reordering renumbers them 1..N anyway.
const nextProjectSort = db.prepare('SELECT COALESCE(MIN(sort), 1) - 1 AS s FROM gallery_projects');
const updProject = db.prepare(
  "UPDATE gallery_projects SET title=@title, year=@year, description=@description, layout=@layout, published=@published, updated_at=datetime('now') WHERE id=@id"
);
const delProject = db.prepare('DELETE FROM gallery_projects WHERE id = ?');
const setProjectSort = db.prepare('UPDATE gallery_projects SET sort = ? WHERE id = ?');
const setProjectThumb = db.prepare('UPDATE gallery_projects SET thumbnail_media_id = ? WHERE id = ?');

const insMedia = db.prepare(
  `INSERT INTO media_items (project_id, type, title, year, description, full_path, preview_path, poster_path, embed_provider, embed_id, aspect_class, aspect_ratio, width, height, alt_text, sort)
   VALUES (@project_id, @type, @title, @year, @description, @full_path, @preview_path, @poster_path, @embed_provider, @embed_id, @aspect_class, @aspect_ratio, @width, @height, @alt_text, @sort)`
);
const nextMediaSort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM media_items WHERE project_id = ?');
const updMedia = db.prepare(
  `UPDATE media_items SET type=@type, title=@title, year=@year, description=@description, full_path=@full_path,
     preview_path=@preview_path, poster_path=@poster_path, embed_provider=@embed_provider, embed_id=@embed_id,
     aspect_class=@aspect_class, alt_text=@alt_text WHERE id=@id`
);
const delMedia = db.prepare('DELETE FROM media_items WHERE id = ?');
const setMediaSort = db.prepare('UPDATE media_items SET sort = ? WHERE id = ?');

const insDownload = db.prepare(
  'INSERT INTO media_downloads (project_id, label, file_path, kind, filesize_bytes, sort) VALUES (@project_id, @label, @file_path, @kind, @filesize_bytes, @sort)'
);
const nextDownloadSort = db.prepare('SELECT COALESCE(MAX(sort), 0) + 1 AS s FROM media_downloads WHERE project_id = ?');
const delDownload = db.prepare('DELETE FROM media_downloads WHERE id = ?');
const qDownload = db.prepare('SELECT * FROM media_downloads WHERE id = ?');
const updDownloadLabel = db.prepare('UPDATE media_downloads SET label = @label WHERE id = @id');

function createProject(data) {
  const sort = nextProjectSort.get().s;
  const info = insProject.run({
    title: data.title || 'Untitled project',
    year: data.year || '',
    description: data.description || '',
    layout: data.layout === 'project-layout1' ? 'project-layout1' : 'project-layout0',
    sort,
    // New projects start HIDDEN. They're created empty and now land at the top
    // of the gallery, so publishing immediately would put an empty card in front
    // of every visitor. Tick "Visible on the site" once it has media.
    published: data.published === true ? 1 : 0,
  });
  return info.lastInsertRowid;
}

function updateProject(id, data) {
  const cur = qProject.get(id);
  if (!cur) return;
  updProject.run({
    id,
    title: data.title != null ? data.title : cur.title,
    year: data.year != null ? data.year : cur.year,
    description: data.description != null ? data.description : cur.description,
    layout: data.layout === 'project-layout1' ? 'project-layout1' : 'project-layout0',
    published: data.published ? 1 : 0,
  });
}

// Delete an uploaded file once nothing references it any more. Only ever
// touches /uploads — the original /assets media is never removed.
const qPathInMedia = db.prepare('SELECT COUNT(*) AS c FROM media_items WHERE full_path = ? OR preview_path = ?');
const qPathInDownloads = db.prepare('SELECT COUNT(*) AS c FROM media_downloads WHERE file_path = ?');
const qPathInSettings = db.prepare('SELECT COUNT(*) AS c FROM site_settings WHERE value = ?');

function removeUploadIfUnused(publicPath) {
  if (!publicPath || publicPath.indexOf('/uploads/') !== 0) return;
  if (qPathInMedia.get(publicPath, publicPath).c > 0) return;
  if (qPathInDownloads.get(publicPath).c > 0) return;
  if (qPathInSettings.get(publicPath).c > 0) return;
  const disk = mediaSvc.resolvePublicPath(publicPath);
  if (!disk) return;
  try {
    fs.unlinkSync(disk);
  } catch (e) {
    /* already gone */
  }
}

function deleteProject(id) {
  // Collect file paths before the rows cascade away.
  const media = qMediaByProject.all(id);
  const downloads = qDownloadsByProject.all(id);
  delProject.run(id);
  media.forEach((m) => {
    removeUploadIfUnused(m.full_path);
    removeUploadIfUnused(m.preview_path);
  });
  downloads.forEach((d) => removeUploadIfUnused(d.file_path));
}

function reorderProjects(orderedIds) {
  const tx = db.transaction((ids) => {
    ids.forEach((id, i) => setProjectSort.run(i + 1, id));
  });
  tx(orderedIds.map(Number).filter(Boolean));
}

function setThumbnail(projectId, mediaId) {
  setProjectThumb.run(mediaId, projectId);
}

// Swap a project's sort with its neighbour (dir: -1 up, +1 down).
function moveProject(id, dir) {
  const list = qProjects.all();
  const idx = list.findIndex((p) => p.id === Number(id));
  const swap = idx + (dir < 0 ? -1 : 1);
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  const a = list[idx];
  const b = list[swap];
  db.transaction(() => {
    setProjectSort.run(b.sort, a.id);
    setProjectSort.run(a.sort, b.id);
  })();
}

function moveMedia(projectId, id, dir) {
  const list = qMediaByProject.all(projectId);
  const idx = list.findIndex((m) => m.id === Number(id));
  const swap = idx + (dir < 0 ? -1 : 1);
  if (idx < 0 || swap < 0 || swap >= list.length) return;
  const a = list[idx];
  const b = list[swap];
  db.transaction(() => {
    setMediaSort.run(b.sort, a.id);
    setMediaSort.run(a.sort, b.id);
  })();
}

function addMedia(projectId, data) {
  const sort = nextMediaSort.get(projectId).s;
  // Prefer a measured ratio (image dimensions from sharp, video dimensions read
  // in the browser at upload); fall back to the legacy class map.
  const w = Number(data.width) || null;
  const h = Number(data.height) || null;
  let ratio = Number(data.aspect_ratio) || (w && h ? w / h : null);
  if (!ratio) ratio = mediaRatio({ type: data.type, aspect_class: data.aspect_class });

  const info = insMedia.run({
    project_id: projectId,
    aspect_ratio: Number(ratio.toFixed(4)),
    type: data.type || 'image',
    title: data.title || '',
    year: data.year || '',
    description: data.description || '',
    full_path: data.full_path || '',
    preview_path: data.preview_path || '',
    poster_path: data.poster_path || '',
    embed_provider: data.embed_provider || '',
    embed_id: data.embed_id || '',
    aspect_class: data.aspect_class || '',
    width: data.width || null,
    height: data.height || null,
    alt_text: data.alt_text || '',
    sort,
  });
  // First media added becomes the default thumbnail.
  const proj = qProject.get(projectId);
  if (proj && !proj.thumbnail_media_id) setThumbnail(projectId, info.lastInsertRowid);
  return info.lastInsertRowid;
}

function updateMedia(id, data) {
  const cur = qMedia.get(id);
  if (!cur) return;
  updMedia.run({
    id,
    type: data.type || cur.type,
    title: data.title != null ? data.title : cur.title,
    year: data.year != null ? data.year : cur.year,
    description: data.description != null ? data.description : cur.description,
    full_path: data.full_path != null ? data.full_path : cur.full_path,
    preview_path: data.preview_path != null ? data.preview_path : cur.preview_path,
    poster_path: data.poster_path != null ? data.poster_path : cur.poster_path,
    embed_provider: data.embed_provider != null ? data.embed_provider : cur.embed_provider,
    embed_id: data.embed_id != null ? data.embed_id : cur.embed_id,
    aspect_class: data.aspect_class != null ? data.aspect_class : cur.aspect_class,
    alt_text: data.alt_text != null ? data.alt_text : cur.alt_text,
  });
}

// Attach / replace / clear the small preview clip on an existing media item,
// so a preview can be added without re-uploading the full file.
const setMediaPreview = db.prepare('UPDATE media_items SET preview_path = ? WHERE id = ?');

function setPreview(mediaId, previewPath) {
  const m = qMedia.get(mediaId);
  if (!m) return;
  const previous = m.preview_path;
  // Point at the full file when clearing — that's what "no separate preview" means.
  setMediaPreview.run(previewPath || m.full_path, mediaId);
  // Only now that the row no longer references it can we safely bin the old file.
  removeUploadIfUnused(previous);
}

function deleteMedia(id) {
  const m = qMedia.get(id);
  if (!m) return;
  // If this item was the project's thumbnail, hand the badge to another item
  // rather than leaving a dangling thumbnail_media_id behind.
  const proj = qProject.get(m.project_id);
  if (proj && proj.thumbnail_media_id === m.id) {
    const next = qMediaByProject.all(m.project_id).find((x) => x.id !== m.id);
    setProjectThumb.run(next ? next.id : null, m.project_id);
  }
  delMedia.run(id);
  removeUploadIfUnused(m.full_path);
  removeUploadIfUnused(m.preview_path);
}

function reorderMedia(projectId, orderedIds) {
  const tx = db.transaction((ids) => {
    ids.forEach((id, i) => setMediaSort.run(i + 1, id));
  });
  tx(orderedIds.map(Number).filter(Boolean));
}

function addDownload(projectId, data) {
  const sort = nextDownloadSort.get(projectId).s;
  const info = insDownload.run({
    project_id: projectId,
    label: data.label || '',
    file_path: data.file_path || '',
    kind: data.kind || '',
    filesize_bytes: data.filesize_bytes || null,
    sort,
  });
  return info.lastInsertRowid;
}

// Edit the visible button text of a download. Returns the project id (for the
// redirect) or null if the row is gone. An empty label is ignored — the button
// would otherwise render blank — so the existing label is kept.
function updateDownloadLabel(id, label) {
  const cur = qDownload.get(id);
  if (!cur) return null;
  if (label != null && String(label).trim() !== '') updDownloadLabel.run({ id, label });
  return cur.project_id;
}

function deleteDownload(id) {
  const d = qDownload.get(id);
  delDownload.run(id);
  if (d) removeUploadIfUnused(d.file_path);
}

module.exports = {
  getPublicRows,
  listProjects,
  getProjectFull,
  getMedia,
  createProject,
  updateProject,
  deleteProject,
  reorderProjects,
  setThumbnail,
  moveProject,
  addMedia,
  updateMedia,
  setPreview,
  deleteMedia,
  reorderMedia,
  moveMedia,
  addDownload,
  updateDownloadLabel,
  deleteDownload,
};
