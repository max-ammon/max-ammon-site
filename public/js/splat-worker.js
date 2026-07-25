'use strict';

/*
 * Gaussian-splat web worker.
 *
 * Parses a .splat or .ply gaussian cloud into a GPU-ready RGBA32UI texture and,
 * on each camera move, depth-sorts the splats so the main thread can draw them
 * back-to-front for correct alpha blending.
 *
 * The rendering core here — the 32-byte splat record, the half-float covariance
 * texture packing, the single-pass 16-bit counting sort, and the .ply parser —
 * is adapted from antimatter15/splat (MIT licence, (c) 2023 Kevin Kwok):
 *   https://github.com/antimatter15/splat
 * The viewer around it (bounds/auto-framing, orbit camera, loading UI) is ours.
 */

// 3xf32 position + 3xf32 scale + 4xu8 colour + 4xu8 quaternion = 32 bytes.
const ROW_LENGTH = 3 * 4 + 3 * 4 + 4 + 4;

let buffer = null; // ArrayBuffer of packed 32-byte records
let vertexCount = 0;

// ---- half-float packing (for the covariance texture) ----------------------
const _floatView = new Float32Array(1);
const _int32View = new Int32Array(_floatView.buffer);
function floatToHalf(float) {
  _floatView[0] = float;
  const f = _int32View[0];
  const sign = (f >> 31) & 0x0001;
  const exp = (f >> 23) & 0x00ff;
  let frac = f & 0x007fffff;
  let newExp;
  if (exp == 0) {
    newExp = 0;
  } else if (exp < 113) {
    newExp = 0;
    frac |= 0x00800000;
    frac = frac >> (113 - exp);
    if (frac & 0x01000000) {
      newExp = 1;
      frac = 0;
    }
  } else if (exp < 142) {
    newExp = exp - 112;
  } else {
    newExp = 31;
    frac = 0;
  }
  return (sign << 15) | (newExp << 10) | (frac >> 13);
}
function packHalf2x16(x, y) {
  return (floatToHalf(x) | (floatToHalf(y) << 16)) >>> 0;
}

// ---- pack the cloud into a 2048-wide RGBA32UI texture ----------------------
// Two texels per splat: [pos.xyz, _], [cov(3x half2), rgba(u8x4)].
function generateTexture() {
  if (!buffer) return;
  const f_buffer = new Float32Array(buffer);
  const u_buffer = new Uint8Array(buffer);

  const texwidth = 1024 * 2;
  const texheight = Math.ceil((2 * vertexCount) / texwidth);
  const texdata = new Uint32Array(texwidth * texheight * 4);
  const texdata_c = new Uint8Array(texdata.buffer);
  const texdata_f = new Float32Array(texdata.buffer);

  for (let i = 0; i < vertexCount; i++) {
    // position
    texdata_f[8 * i + 0] = f_buffer[8 * i + 0];
    texdata_f[8 * i + 1] = f_buffer[8 * i + 1];
    texdata_f[8 * i + 2] = f_buffer[8 * i + 2];

    // colour (rgba)
    texdata_c[4 * (8 * i + 7) + 0] = u_buffer[32 * i + 24 + 0];
    texdata_c[4 * (8 * i + 7) + 1] = u_buffer[32 * i + 24 + 1];
    texdata_c[4 * (8 * i + 7) + 2] = u_buffer[32 * i + 24 + 2];
    texdata_c[4 * (8 * i + 7) + 3] = u_buffer[32 * i + 24 + 3];

    // covariance = M^T M, with M = S * R(quaternion)
    const scale = [f_buffer[8 * i + 3 + 0], f_buffer[8 * i + 3 + 1], f_buffer[8 * i + 3 + 2]];
    const rot = [
      (u_buffer[32 * i + 28 + 0] - 128) / 128,
      (u_buffer[32 * i + 28 + 1] - 128) / 128,
      (u_buffer[32 * i + 28 + 2] - 128) / 128,
      (u_buffer[32 * i + 28 + 3] - 128) / 128,
    ];
    const M = [
      1.0 - 2.0 * (rot[2] * rot[2] + rot[3] * rot[3]),
      2.0 * (rot[1] * rot[2] + rot[0] * rot[3]),
      2.0 * (rot[1] * rot[3] - rot[0] * rot[2]),
      2.0 * (rot[1] * rot[2] - rot[0] * rot[3]),
      1.0 - 2.0 * (rot[1] * rot[1] + rot[3] * rot[3]),
      2.0 * (rot[2] * rot[3] + rot[0] * rot[1]),
      2.0 * (rot[1] * rot[3] + rot[0] * rot[2]),
      2.0 * (rot[2] * rot[3] - rot[0] * rot[1]),
      1.0 - 2.0 * (rot[1] * rot[1] + rot[2] * rot[2]),
    ].map((k, idx) => k * scale[Math.floor(idx / 3)]);

    const sigma = [
      M[0] * M[0] + M[3] * M[3] + M[6] * M[6],
      M[0] * M[1] + M[3] * M[4] + M[6] * M[7],
      M[0] * M[2] + M[3] * M[5] + M[6] * M[8],
      M[1] * M[1] + M[4] * M[4] + M[7] * M[7],
      M[1] * M[2] + M[4] * M[5] + M[7] * M[8],
      M[2] * M[2] + M[5] * M[5] + M[8] * M[8],
    ];

    texdata[8 * i + 4] = packHalf2x16(4 * sigma[0], 4 * sigma[1]);
    texdata[8 * i + 5] = packHalf2x16(4 * sigma[2], 4 * sigma[3]);
    texdata[8 * i + 6] = packHalf2x16(4 * sigma[4], 4 * sigma[5]);
  }

  self.postMessage({ texdata, texwidth, texheight }, [texdata.buffer]);
}

// ---- centre + spread of the cloud, for auto-framing the camera ------------
function computeBounds() {
  const f = new Float32Array(buffer);
  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let i = 0; i < vertexCount; i++) {
    cx += f[8 * i + 0];
    cy += f[8 * i + 1];
    cz += f[8 * i + 2];
  }
  cx /= vertexCount;
  cy /= vertexCount;
  cz /= vertexCount;
  // RMS distance from the centre — a stable size estimate that isn't thrown off
  // by the stray far-away splats gaussian clouds often contain.
  let s = 0;
  for (let i = 0; i < vertexCount; i++) {
    const dx = f[8 * i + 0] - cx;
    const dy = f[8 * i + 1] - cy;
    const dz = f[8 * i + 2] - cz;
    s += dx * dx + dy * dy + dz * dz;
  }
  const radius = Math.sqrt(s / vertexCount) || 1;
  return { center: [cx, cy, cz], radius };
}

// ---- depth sort (single-pass 16-bit counting sort) ------------------------
let lastProj = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
let sortedForCount = -1;
function runSort(viewProj) {
  if (!buffer || !vertexCount) return;
  // Skip re-sorting when the view direction is essentially unchanged.
  const dot = lastProj[2] * viewProj[2] + lastProj[6] * viewProj[6] + lastProj[10] * viewProj[10];
  if (sortedForCount === vertexCount && Math.abs(dot - 1) < 0.01) return;

  const f = new Float32Array(buffer);
  let maxDepth = -Infinity;
  let minDepth = Infinity;
  const sizeList = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const depth =
      ((viewProj[2] * f[8 * i + 0] + viewProj[6] * f[8 * i + 1] + viewProj[10] * f[8 * i + 2]) * 4096) | 0;
    sizeList[i] = depth;
    if (depth > maxDepth) maxDepth = depth;
    if (depth < minDepth) minDepth = depth;
  }
  const depthInv = (256 * 256 - 1) / (maxDepth - minDepth || 1);
  const counts0 = new Uint32Array(256 * 256);
  for (let i = 0; i < vertexCount; i++) {
    sizeList[i] = ((sizeList[i] - minDepth) * depthInv) | 0;
    counts0[sizeList[i]]++;
  }
  const starts0 = new Uint32Array(256 * 256);
  for (let i = 1; i < 256 * 256; i++) starts0[i] = starts0[i - 1] + counts0[i - 1];
  const idx = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) idx[starts0[sizeList[i]]++] = i;

  lastProj = viewProj;
  sortedForCount = vertexCount;
  self.postMessage({ depthIndex: idx, vertexCount }, [idx.buffer]);
}

// ---- .ply -> packed .splat records ----------------------------------------
function processPlyBuffer(inputBuffer) {
  const ubuf = new Uint8Array(inputBuffer);
  const header = new TextDecoder().decode(ubuf.slice(0, 1024 * 10));
  const header_end = 'end_header\n';
  const header_end_index = header.indexOf(header_end);
  if (header_end_index < 0) throw new Error('Unable to read .ply file header');
  const vertexCountMatch = /element vertex (\d+)\n/.exec(header);
  if (!vertexCountMatch) throw new Error('Unable to find the vertex count in the .ply header');
  const count = parseInt(vertexCountMatch[1]);

  let row_offset = 0;
  const offsets = {};
  const types = {};
  const TYPE_MAP = {
    double: 'getFloat64',
    int: 'getInt32',
    uint: 'getUint32',
    float: 'getFloat32',
    short: 'getInt16',
    ushort: 'getUint16',
    uchar: 'getUint8',
  };
  for (const prop of header
    .slice(0, header_end_index)
    .split('\n')
    .filter((k) => k.startsWith('property '))) {
    const [, type, name] = prop.split(' ');
    const arrayType = TYPE_MAP[type] || 'getInt8';
    types[name] = arrayType;
    offsets[name] = row_offset;
    row_offset += parseInt(arrayType.replace(/[^\d]/g, '')) / 8;
  }

  const dataView = new DataView(inputBuffer, header_end_index + header_end.length);
  let row = 0;
  const attrs = new Proxy(
    {},
    {
      get(target, prop) {
        if (!types[prop]) throw new Error(prop + ' not found');
        return dataView[types[prop]](row * row_offset + offsets[prop], true);
      },
    }
  );

  // Order by "importance" (size * opacity) so a partial/truncated read still
  // shows the most visually significant splats.
  const sizeList = new Float32Array(count);
  const sizeIndex = new Uint32Array(count);
  for (row = 0; row < count; row++) {
    sizeIndex[row] = row;
    if (!types['scale_0']) continue;
    const size = Math.exp(attrs.scale_0) * Math.exp(attrs.scale_1) * Math.exp(attrs.scale_2);
    const opacity = 1 / (1 + Math.exp(-attrs.opacity));
    sizeList[row] = size * opacity;
  }
  sizeIndex.sort((b, a) => sizeList[a] - sizeList[b]);

  const out = new ArrayBuffer(ROW_LENGTH * count);
  for (let j = 0; j < count; j++) {
    row = sizeIndex[j];
    const position = new Float32Array(out, j * ROW_LENGTH, 3);
    const scales = new Float32Array(out, j * ROW_LENGTH + 4 * 3, 3);
    const rgba = new Uint8ClampedArray(out, j * ROW_LENGTH + 4 * 3 + 4 * 3, 4);
    const rot = new Uint8ClampedArray(out, j * ROW_LENGTH + 4 * 3 + 4 * 3 + 4, 4);

    if (types['scale_0']) {
      const qlen = Math.sqrt(attrs.rot_0 ** 2 + attrs.rot_1 ** 2 + attrs.rot_2 ** 2 + attrs.rot_3 ** 2);
      rot[0] = (attrs.rot_0 / qlen) * 128 + 128;
      rot[1] = (attrs.rot_1 / qlen) * 128 + 128;
      rot[2] = (attrs.rot_2 / qlen) * 128 + 128;
      rot[3] = (attrs.rot_3 / qlen) * 128 + 128;
      scales[0] = Math.exp(attrs.scale_0);
      scales[1] = Math.exp(attrs.scale_1);
      scales[2] = Math.exp(attrs.scale_2);
    } else {
      scales[0] = 0.01;
      scales[1] = 0.01;
      scales[2] = 0.01;
      rot[0] = 255;
      rot[1] = 0;
      rot[2] = 0;
      rot[3] = 0;
    }

    position[0] = attrs.x;
    position[1] = attrs.y;
    position[2] = attrs.z;

    if (types['f_dc_0']) {
      const SH_C0 = 0.28209479177387814;
      rgba[0] = (0.5 + SH_C0 * attrs.f_dc_0) * 255;
      rgba[1] = (0.5 + SH_C0 * attrs.f_dc_1) * 255;
      rgba[2] = (0.5 + SH_C0 * attrs.f_dc_2) * 255;
    } else {
      rgba[0] = attrs.red;
      rgba[1] = attrs.green;
      rgba[2] = attrs.blue;
    }
    if (types['opacity']) {
      rgba[3] = (1 / (1 + Math.exp(-attrs.opacity))) * 255;
    } else {
      rgba[3] = 255;
    }
  }
  return out;
}

// ---- message plumbing (throttled so a burst of camera moves coalesces) -----
let sortRunning = false;
let pendingView = null;
function throttledSort() {
  if (sortRunning) return;
  sortRunning = true;
  const view = pendingView;
  pendingView = null;
  try {
    runSort(view);
  } catch (e) {
    self.postMessage({ error: 'sort failed: ' + e.message });
  }
  setTimeout(() => {
    sortRunning = false;
    if (pendingView) throttledSort();
  }, 0);
}

function ingest() {
  vertexCount = Math.floor(buffer.byteLength / ROW_LENGTH);
  sortedForCount = -1;
  if (!vertexCount) throw new Error('The splat file appears to be empty.');
  self.postMessage({ bounds: computeBounds(), vertexCount });
  generateTexture();
}

self.onmessage = (e) => {
  const d = e.data;
  try {
    if (d.ply) {
      buffer = processPlyBuffer(d.ply);
      ingest();
    } else if (d.splat) {
      buffer = d.splat;
      ingest();
    } else if (d.view) {
      pendingView = d.view;
      throttledSort();
    }
  } catch (err) {
    self.postMessage({ error: err.message || String(err) });
  }
};
