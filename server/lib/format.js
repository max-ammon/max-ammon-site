'use strict';

// Human file size roughly matching the site's existing "(~110mb)" style.
function formatFileSize(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n >= 1e9) {
    const gb = n / 1e9;
    return `~${gb >= 10 ? Math.round(gb) : gb.toFixed(1)}gb`;
  }
  return `~${Math.round(n / 1e6)}mb`;
}

// Neutral size label for the admin UI, e.g. "8.2 MB", "224 KB", "1.2 GB".
function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n < 1024) return n + ' B';
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (v >= 100 ? Math.round(v) : v.toFixed(1)) + ' ' + units[i];
}

// Extract a YouTube video id from a URL or bare id.
function parseYouTubeId(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s; // already a bare id
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/embed\/([A-Za-z0-9_-]{11})/,
    /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = s.match(re);
    if (m) return m[1];
  }
  return '';
}

module.exports = { formatFileSize, formatBytes, parseYouTubeId };
