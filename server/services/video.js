'use strict';

/*
 * Video helpers built on ffmpeg/ffprobe.
 *
 * Gallery cards autoplay a looping preview. Uploading only a full video used to
 * mean the card loaded the whole file (e.g. 58 MB), so a small preview had to be
 * made by hand. With ffmpeg present we can derive one automatically.
 *
 * Everything here degrades gracefully: if ffmpeg isn't installed, each function
 * returns null and the caller falls back to the previous behaviour.
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const PREVIEW_WIDTH = 700; // matches the widest gallery thumbnail
/*
 * Only used when deriving a preview from a FULL video, where looping a
 * five-minute file as a thumbnail would be silly. A clip already shorter than
 * this plays in full — a deliberate short loop must never be trimmed.
 * Pass { maxSeconds: 0 } to disable trimming entirely.
 */
const PREVIEW_MAX_SECONDS = 30;

/*
 * Finding ffmpeg, in order of preference:
 *   1. FFMPEG_PATH / FFPROBE_PATH in .env  (explicit wins)
 *   2. the PATH                            (normal installs, and Linux hosts)
 *   3. winget's package folder             (Windows: winget installs to a
 *                                           version-stamped dir and only adds
 *                                           that to PATH, which a process
 *                                           started earlier won't have picked up)
 *   4. Program Files                       (manual installs)
 * The winget lookup is globbed rather than hardcoded, so upgrading ffmpeg
 * doesn't silently break preview generation.
 */
function wingetCandidates(name) {
  const found = [];
  const base = path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet');
  const shim = path.join(base, 'Links', name + '.exe');
  if (fs.existsSync(shim)) found.push(shim);
  const pkgs = path.join(base, 'Packages');
  try {
    for (const dir of fs.readdirSync(pkgs)) {
      if (!/ffmpeg/i.test(dir)) continue;
      for (const sub of fs.readdirSync(path.join(pkgs, dir))) {
        const p = path.join(pkgs, dir, sub, 'bin', name + '.exe');
        if (fs.existsSync(p)) found.push(p);
      }
    }
  } catch (e) {
    /* no winget packages dir — fine */
  }
  return found;
}

function candidatesFor(name, envVar) {
  return [
    process.env[envVar],
    name,
    ...wingetCandidates(name),
    path.join(process.env.ProgramFiles || 'C:/Program Files', 'ffmpeg', 'bin', name + '.exe'),
  ].filter(Boolean);
}

const CANDIDATES = candidatesFor('ffmpeg', 'FFMPEG_PATH');
const PROBES = candidatesFor('ffprobe', 'FFPROBE_PATH');

function resolveBin(list) {
  for (const bin of list) {
    try {
      if (bin.includes(path.sep) && !fs.existsSync(bin)) continue;
      require('child_process').execFileSync(bin, ['-version'], { stdio: 'ignore' });
      return bin;
    } catch (e) {
      /* try the next candidate */
    }
  }
  return null;
}

let FFMPEG = null;
let FFPROBE = null;
let resolved = false;

function ensureResolved() {
  if (resolved) return;
  resolved = true;
  FFMPEG = resolveBin(CANDIDATES);
  FFPROBE = resolveBin(PROBES);
  // eslint-disable-next-line no-console
  console.log(FFMPEG ? `[video] ffmpeg found: ${FFMPEG}` : '[video] ffmpeg not found — video previews must be uploaded manually');
}

function hasFfmpeg() {
  ensureResolved();
  return !!FFMPEG;
}

function run(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs || 120000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message || '').toString().slice(0, 300)));
      resolve(String(stdout || ''));
    });
  });
}

// -> { width, height, duration } or null
async function probe(file) {
  ensureResolved();
  if (!FFPROBE) return null;
  try {
    const out = await run(FFPROBE, [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
      '-of', 'json',
      file,
    ], 30000);
    const j = JSON.parse(out);
    const s = (j.streams && j.streams[0]) || {};
    if (!s.width || !s.height) return null;
    return { width: s.width, height: s.height, duration: parseFloat((j.format && j.format.duration) || '0') || 0 };
  } catch (e) {
    return null;
  }
}

// Small, muted, looping clip for the gallery card. -> disk path or null
// opts.maxSeconds: trim only if the source is longer than this (0 = never trim).
async function makePreview(sourceFile, outFile, opts) {
  ensureResolved();
  if (!FFMPEG) return null;

  const maxSeconds = opts && 'maxSeconds' in opts ? opts.maxSeconds : PREVIEW_MAX_SECONDS;
  let trim = [];
  if (maxSeconds) {
    const meta = await probe(sourceFile);
    // Anything at or under the limit keeps its full length.
    if (meta && meta.duration > maxSeconds + 0.25) trim = ['-t', String(maxSeconds)];
  }

  try {
    await run(FFMPEG, [
      '-y',
      '-i', sourceFile,
      ...trim,
      '-an',                                   // no audio: the card is muted anyway
      '-vf', `scale=${PREVIEW_WIDTH}:-2:flags=lanczos`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '30',                            // small; it's a thumbnail, not the feature
      '-movflags', '+faststart',               // starts playing before it's fully loaded
      '-pix_fmt', 'yuv420p',                   // maximum browser compatibility
      outFile,
    ], 300000);
    return fs.existsSync(outFile) ? outFile : null;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[video] preview failed:', e.message);
    return null;
  }
}

// Single still frame, used as the <video> poster. -> disk path or null
async function makePoster(sourceFile, outFile, atSeconds) {
  ensureResolved();
  if (!FFMPEG) return null;
  try {
    await run(FFMPEG, [
      '-y',
      '-ss', String(atSeconds || 0),
      '-i', sourceFile,
      '-frames:v', '1',
      '-vf', `scale=${PREVIEW_WIDTH}:-2:flags=lanczos`,
      outFile,
    ], 60000);
    return fs.existsSync(outFile) ? outFile : null;
  } catch (e) {
    return null;
  }
}

module.exports = { hasFfmpeg, probe, makePreview, makePoster, PREVIEW_WIDTH, PREVIEW_MAX_SECONDS };
