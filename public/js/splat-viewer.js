'use strict';

/*
 * Gaussian-splat viewer (main thread): WebGL2 setup, an orbit camera, a
 * streaming loader with a progress bar, and mouse/touch controls. It drives
 * /js/splat-worker.js, which parses the file and depth-sorts the splats.
 *
 * The WebGL rendering core (the two shaders, the RGBA32UI covariance texture,
 * the blend setup) is adapted from antimatter15/splat (MIT, (c) 2023 Kevin Kwok):
 *   https://github.com/antimatter15/splat
 * The camera, controls and loading UI are ours.
 */
(function () {
  var SELF = document.currentScript;
  var SRC = SELF.getAttribute('data-src');
  var FORMAT = (SELF.getAttribute('data-format') || '').toLowerCase();
  var FLIP_UP = SELF.getAttribute('data-flip') === '1';
  var EXPOSURE = parseFloat(SELF.getAttribute('data-exposure')) || 1;
  var SPLAT_ID = SELF.getAttribute('data-id') || '';
  var WB = parseFloat(SELF.getAttribute('data-wb')) || 0;    // -1 cool .. +1 warm
  var TINT = parseFloat(SELF.getAttribute('data-tint')) || 0; // -1 green .. +1 magenta
  // Owner-set starting camera ({t:[x,y,z], d, y, p}); null = auto-frame the splat.
  var DEFAULT_VIEW = (function () {
    var raw = SELF.getAttribute('data-view');
    if (!raw) return null;
    try {
      var v = JSON.parse(raw);
      return v && v.t && v.t.length === 3 ? v : null;
    } catch (e) {
      return null;
    }
  })();

  var canvas = document.getElementById('splatCanvas');
  var stage = document.getElementById('splatStage');
  var loadingEl = document.getElementById('splatLoading');
  var barEl = document.getElementById('splatBar');
  var labelEl = document.getElementById('splatLabel');
  var errorEl = document.getElementById('splatError');
  var hintEl = document.getElementById('splatHint');
  var mobileNoteEl = document.getElementById('splatMobileNote');
  var captionEl = document.querySelector('.splat-caption');
  var qualityEl = document.getElementById('splatQuality'); // owner-only readout
  var resetBtn = document.getElementById('splatReset');
  var fullBtn = document.getElementById('splatFull');

  function fail(msg) {
    if (loadingEl) loadingEl.style.display = 'none';
    if (errorEl) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }
  }

  var gl = canvas.getContext('webgl2', { antialias: false });
  if (!gl) {
    fail('This 3D viewer needs WebGL2, which your browser does not seem to support.');
    return;
  }

  // ---- small vec/mat helpers -------------------------------------------------
  function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }
  function normalize(a) {
    var l = Math.hypot(a[0], a[1], a[2]) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }
  // Column-major 4x4 multiply (projection * view).
  function multiply4(a, b) {
    var o = new Array(16);
    for (var c = 0; c < 4; c++) {
      for (var r = 0; r < 4; r++) {
        o[c * 4 + r] =
          a[0 * 4 + r] * b[c * 4 + 0] +
          a[1 * 4 + r] * b[c * 4 + 1] +
          a[2 * 4 + r] * b[c * 4 + 2] +
          a[3 * 4 + r] * b[c * 4 + 3];
      }
    }
    return o;
  }
  // World->camera matrix with the camera looking down +Z toward the target
  // (the convention the vertex shader's Jacobian and projection expect).
  function lookAtZForward(eye, target, up) {
    var z = normalize(sub(target, eye));
    var x = normalize(cross(up, z));
    var y = cross(z, x);
    return [
      x[0], y[0], z[0], 0,
      x[1], y[1], z[1], 0,
      x[2], y[2], z[2], 0,
      -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
    ];
  }
  function getProjectionMatrix(fx, fy, W, H) {
    var znear = 0.2;
    var zfar = 200;
    return [
      (2 * fx) / W, 0, 0, 0,
      0, -(2 * fy) / H, 0, 0,
      0, 0, zfar / (zfar - znear), 1,
      0, 0, -(zfar * znear) / (zfar - znear), 0,
    ];
  }

  // ---- shaders (verbatim from antimatter15/splat) ---------------------------
  var vsSource =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'precision highp int;\n' +
    'uniform highp usampler2D u_texture;\n' +
    'uniform mat4 projection, view;\n' +
    'uniform vec2 focal;\n' +
    'uniform vec2 viewport;\n' +
    'in vec2 position;\n' +
    'in int index;\n' +
    'out vec4 vColor;\n' +
    'out vec2 vPosition;\n' +
    'void main () {\n' +
    '    uvec4 cen = texelFetch(u_texture, ivec2((uint(index) & 0x3ffu) << 1, uint(index) >> 10), 0);\n' +
    '    vec4 cam = view * vec4(uintBitsToFloat(cen.xyz), 1);\n' +
    '    vec4 pos2d = projection * cam;\n' +
    '    float clip = 1.2 * pos2d.w;\n' +
    '    if (pos2d.z < -clip || pos2d.x < -clip || pos2d.x > clip || pos2d.y < -clip || pos2d.y > clip) {\n' +
    '        gl_Position = vec4(0.0, 0.0, 2.0, 1.0);\n' +
    '        return;\n' +
    '    }\n' +
    '    uvec4 cov = texelFetch(u_texture, ivec2(((uint(index) & 0x3ffu) << 1) | 1u, uint(index) >> 10), 0);\n' +
    '    vec2 u1 = unpackHalf2x16(cov.x), u2 = unpackHalf2x16(cov.y), u3 = unpackHalf2x16(cov.z);\n' +
    '    mat3 Vrk = mat3(u1.x, u1.y, u2.x, u1.y, u2.y, u3.x, u2.x, u3.x, u3.y);\n' +
    '    mat3 J = mat3(\n' +
    '        focal.x / cam.z, 0., -(focal.x * cam.x) / (cam.z * cam.z),\n' +
    '        0., -focal.y / cam.z, (focal.y * cam.y) / (cam.z * cam.z),\n' +
    '        0., 0., 0.\n' +
    '    );\n' +
    '    mat3 T = transpose(mat3(view)) * J;\n' +
    '    mat3 cov2d = transpose(T) * Vrk * T;\n' +
    '    float mid = (cov2d[0][0] + cov2d[1][1]) / 2.0;\n' +
    '    float radius = length(vec2((cov2d[0][0] - cov2d[1][1]) / 2.0, cov2d[0][1]));\n' +
    '    float lambda1 = mid + radius, lambda2 = mid - radius;\n' +
    '    if(lambda2 < 0.0) return;\n' +
    '    vec2 diagonalVector = normalize(vec2(cov2d[0][1], lambda1 - cov2d[0][0]));\n' +
    '    vec2 majorAxis = min(sqrt(2.0 * lambda1), 1024.0) * diagonalVector;\n' +
    '    vec2 minorAxis = min(sqrt(2.0 * lambda2), 1024.0) * vec2(diagonalVector.y, -diagonalVector.x);\n' +
    '    vColor = clamp(pos2d.z/pos2d.w+1.0, 0.0, 1.0) * vec4((cov.w) & 0xffu, (cov.w >> 8) & 0xffu, (cov.w >> 16) & 0xffu, (cov.w >> 24) & 0xffu) / 255.0;\n' +
    '    vPosition = position;\n' +
    '    vec2 vCenter = vec2(pos2d) / pos2d.w;\n' +
    '    gl_Position = vec4(vCenter + position.x * majorAxis / viewport + position.y * minorAxis / viewport, 0.0, 1.0);\n' +
    '}\n';

  /*
   * ---- colour pipeline --------------------------------------------------------
   * Splat colours are stored sRGB-encoded. Blending them directly (as the
   * reference implementation does) has two problems: the semi-transparent
   * splats composite in gamma space, which washes overlapping colour out, and
   * `exposure` multiplies straight into an 8-bit buffer, where each channel
   * clips on its own — an orange (1.0, 0.55, 0.2) brightened 2x becomes
   * (1.0, 1.0, 0.4), i.e. pure yellow with the warmth gone.
   *
   * So when the GPU can render to a float buffer we decode to linear light,
   * blend there at high precision, and only at the very end apply exposure with
   * a shoulder that scales all three channels together — hue survives — before
   * encoding back to sRGB. Older GPUs keep the original single-pass path.
   */
  var HDR_OK = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));

  if (HDR_OK) {
    // sRGB -> linear before anything is blended.
    vsSource = vsSource.replace(
      '    vPosition = position;\n',
      '    vColor.rgb = pow(vColor.rgb, vec3(2.2));\n    vPosition = position;\n'
    );
  }

  var fsSource =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec4 vColor;\n' +
    'in vec2 vPosition;\n' +
    'uniform float exposure;\n' +
    'uniform vec3 grade;\n' +
    'out vec4 fragColor;\n' +
    'void main () {\n' +
    '    float A = -dot(vPosition, vPosition);\n' +
    '    if (A < -4.0) discard;\n' +
    '    float B = exp(A) * vColor.a;\n' +
    // In the HDR path exposure is applied after compositing, so nothing clips
    // mid-blend; the fallback keeps applying it here as before.
    (HDR_OK
      ? '    fragColor = vec4(B * vColor.rgb, B);\n'
      : '    fragColor = vec4(exposure * grade * B * vColor.rgb, B);\n') +
    '}\n';

  // Fullscreen pass: exposure, a hue-preserving highlight shoulder, then sRGB.
  var postVs =
    '#version 300 es\n' +
    'out vec2 vUv;\n' +
    'void main () {\n' +
    '    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));\n' +
    '    vUv = p;\n' +
    '    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);\n' +
    '}\n';

  var postFs =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D tex;\n' +
    'uniform float exposure;\n' +
    // White balance / tint as per-channel gains, applied in linear light.
    'uniform vec3 grade;\n' +
    'in vec2 vUv;\n' +
    'out vec4 fragColor;\n' +
    // Highlights below the knee pass through untouched, so a splat left at
    // exposure 1 keeps very close to its original brightness.
    'const float KNEE = 0.85;\n' +
    'void main () {\n' +
    '    vec3 c = texture(tex, vUv).rgb * exposure * grade;\n' +
    // Compress the brightest channel and scale the other two by the same factor,
    // so an over-exposed orange desaturates towards white instead of turning
    // yellow. Below the knee nothing is touched.
    '    float m = max(c.r, max(c.g, c.b));\n' +
    '    if (m > KNEE) {\n' +
    '        float over = m - KNEE;\n' +
    '        float mapped = KNEE + (1.0 - KNEE) * (over / (over + (1.0 - KNEE)));\n' +
    '        c *= mapped / m;\n' +
    '    }\n' +
    '    c = max(c, vec3(0.0));\n' +
    '    vec3 srgb = mix(12.92 * c, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));\n' +
    '    fragColor = vec4(clamp(srgb, 0.0, 1.0), 1.0);\n' +
    '}\n';

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) || 'shader compile failed');
    }
    return sh;
  }

  var program;
  try {
    program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'program link failed');
    }
  } catch (e) {
    fail('The 3D viewer failed to start (' + e.message + ').');
    return;
  }
  gl.useProgram(program);

  gl.disable(gl.DEPTH_TEST);
  gl.enable(gl.BLEND);
  // Premultiplied front-to-back "under" compositing (splats drawn near->far).
  gl.blendFuncSeparate(gl.ONE_MINUS_DST_ALPHA, gl.ONE, gl.ONE_MINUS_DST_ALPHA, gl.ONE);
  gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
  gl.clearColor(0, 0, 0, 0);

  // --- HDR target + tone-mapping pass (skipped where float targets are absent) ---
  var postProgram = null;
  var postVao = null;
  var u_postTex = null;
  var u_postExposure = null;
  var hdrFbo = null;
  var hdrTex = null;
  var hdrW = 0;
  var hdrH = 0;
  var hdrReady = false;

  if (HDR_OK) {
    try {
      postProgram = gl.createProgram();
      gl.attachShader(postProgram, compile(gl.VERTEX_SHADER, postVs));
      gl.attachShader(postProgram, compile(gl.FRAGMENT_SHADER, postFs));
      gl.linkProgram(postProgram);
      if (!gl.getProgramParameter(postProgram, gl.LINK_STATUS)) throw new Error('post link failed');
      u_postTex = gl.getUniformLocation(postProgram, 'tex');
      u_postExposure = gl.getUniformLocation(postProgram, 'exposure');
      postVao = gl.createVertexArray(); // attribute-less draw; keeps the main VAO clean
      gl.useProgram(program);
    } catch (e) {
      HDR_OK = false; // fall back to the single-pass path
      postProgram = null;
    }
  }

  // (Re)allocate the float colour buffer the splats composite into.
  function ensureHdr(w, h) {
    if (!HDR_OK || w < 1 || h < 1) return false;
    if (hdrReady && w === hdrW && h === hdrH) return true;
    if (!hdrTex) {
      hdrTex = gl.createTexture();
      hdrFbo = gl.createFramebuffer();
    }
    gl.activeTexture(gl.TEXTURE1); // unit 0 stays with the splat data texture
    gl.bindTexture(gl.TEXTURE_2D, hdrTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, hdrFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, hdrTex, 0);
    hdrReady = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0);
    hdrW = w;
    hdrH = h;
    if (!hdrReady) HDR_OK = false; // never retry a target this GPU refused
    return hdrReady;
  }

  var u_grade = gl.getUniformLocation(program, 'grade');
  var u_postGrade = postProgram ? gl.getUniformLocation(postProgram, 'grade') : null;

  /*
   * White balance and tint as per-channel gains. Warm lifts red and drops blue;
   * tint trades green against magenta. The result is divided by its own
   * luminance so moving either slider changes the colour cast without also
   * changing how bright the splat is.
   */
  function gradeGain() {
    var r = 1 + 0.35 * WB + 0.15 * TINT;
    var g = 1 - 0.3 * TINT;
    var b = 1 - 0.35 * WB + 0.15 * TINT;
    r = Math.max(r, 0.05); g = Math.max(g, 0.05); b = Math.max(b, 0.05);
    var lum = Math.max(0.2126 * r + 0.7152 * g + 0.0722 * b, 1e-4);
    return [r / lum, g / lum, b / lum];
  }
  function applyGrade() {
    var v = gradeGain();
    if (!HDR_OK) {
      gl.useProgram(program);
      gl.uniform3f(u_grade, v[0], v[1], v[2]);
    }
    // In the HDR path the post pass sets it per frame from WB/TINT.
  }

  var u_projection = gl.getUniformLocation(program, 'projection');
  var u_viewport = gl.getUniformLocation(program, 'viewport');
  var u_focal = gl.getUniformLocation(program, 'focal');
  var u_view = gl.getUniformLocation(program, 'view');
  var u_exposure = gl.getUniformLocation(program, 'exposure');
  // In the HDR path exposure is applied by the tone-mapping pass each frame.
  if (!HDR_OK) gl.uniform1f(u_exposure, EXPOSURE);
  applyGrade(); // the fallback shader needs a gain before the first draw

  // Quad corners (per-vertex, one instance per splat).
  var vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-2, -2, 2, -2, 2, 2, -2, 2]), gl.STATIC_DRAW);
  var a_position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(a_position);
  gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 0, 0);

  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);

  // Per-instance splat index (the depth-sorted order from the worker).
  var indexBuffer = gl.createBuffer();
  var a_index = gl.getAttribLocation(program, 'index');
  gl.enableVertexAttribArray(a_index);
  gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
  gl.vertexAttribIPointer(a_index, 1, gl.INT, false, 0, 0);
  gl.vertexAttribDivisor(a_index, 1);

  // ---- camera state ---------------------------------------------------------
  // Gaussian data from the usual tools (Postshot / INRIA) is Y-down, so the
  // world "up" is -Y and such captures load right-side up. Some come out the
  // other way; the per-splat "flip vertical" flag swaps to +Y, which rolls the
  // view 180deg (same side, now upright — a rotation, not a mirror).
  var UP = FLIP_UP ? [0, 1, 0] : [0, -1, 0];
  var FOV_Y = (50 * Math.PI) / 180;
  var MIN_PITCH = -1.5533; // ~ +/-89deg, so lookAt never degenerates
  var MAX_PITCH = 1.5533;
  var START_PITCH = FLIP_UP ? 0.2 : -0.2; // a gentle look from "above" either way
  // Flipping the up axis rolls the camera 180deg, which would otherwise invert
  // the drag directions; this compensation keeps orbit/pan feeling the same
  // whether a splat is flipped or not.
  var CTRL = FLIP_UP ? -1 : 1;

  var target = [0, 0, 0];
  var dist = 5;
  var yaw = 0;
  var pitch = START_PITCH;
  var initial = null;
  var autoFramed = null; // the computed framing, kept for "Clear default view"
  var haveData = false;

  /*
   * ---- adaptive quality ------------------------------------------------------
   * Splat rendering is fill-rate bound: cost scales with the pixels drawn and the
   * number of splats. How much a device can take varies enormously — and a user
   * agent string won't tell you, since a flagship phone can outrun an old laptop.
   *
   * So this measures instead of guessing. The browser's hints (touch, cores,
   * memory, pixel ratio) only pick a safe *starting* point; from there the frame
   * rate decides: while frames stay fast the render resolution climbs, and if
   * they slow it backs off. A strong desktop settles at full device pixels — the
   * old build capped it at 1.75 and dropped to ~1.5 whenever you orbited — while
   * a weak phone settles low, with neither hard-coded.
   */
  var IS_MOBILE = false;
  try {
    IS_MOBILE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  } catch (e) {}

  var DPR = window.devicePixelRatio || 1;
  // Never render above the screen's own pixels (wasted work), and cap at 2 so a
  // 3x phone screen doesn't ask for 9x the fragments.
  var MAX_SCALE = Math.min(DPR, 2);
  var MIN_SCALE = IS_MOBILE ? 0.4 : 0.6;

  // Opening guess only — the measured frame rate takes over within ~a second.
  function startingScale() {
    var cores = navigator.hardwareConcurrency || 0; // absent on some browsers
    var mem = navigator.deviceMemory || 0; // Chromium only
    var score = IS_MOBILE ? 0 : 2;
    if (cores >= 8) score += 2;
    else if (cores >= 4) score += 1;
    if (mem >= 8) score += 2;
    else if (mem >= 4) score += 1;
    // A clearly capable machine opens at full quality rather than easing up to
    // it, so the first second already looks its best; if it can't hold the pace
    // the measurements pull it back within one sampling window.
    var frac = score >= 5 ? 1 : score >= 3 ? 0.65 : 0.5;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, MAX_SCALE * frac));
  }

  var renderScale = startingScale(); // device pixels per CSS pixel
  var moveFactor = IS_MOBILE ? 0.65 : 0.9; // extra reduction while the camera moves
  var activeScale = 1; // 1 at rest, moveFactor while moving
  var idleTimer = null;

  // Splat budget: how many of the (importance-ordered) splats we draw. Starts
  // conservative on mobile and is raised or lowered by the same measurements.
  var MIN_SPLATS = 150000;
  var totalSplats = 0;
  var renderCount = 0;

  var focalX = 1000;
  var focalY = 1000;
  var projectionMatrix = getProjectionMatrix(focalX, focalY, 1, 1);

  function stageSize() {
    return [stage.clientWidth || window.innerWidth, stage.clientHeight || window.innerHeight];
  }
  function resize() {
    gl.useProgram(program); // the post pass may have been current
    var s = stageSize();
    var W = s[0];
    var H = s[1];
    var dpr = renderScale * activeScale;
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    focalY = (0.5 * H) / Math.tan(FOV_Y / 2);
    focalX = focalY;
    projectionMatrix = getProjectionMatrix(focalX, focalY, W, H);
    gl.uniform2fv(u_focal, new Float32Array([focalX, focalY]));
    gl.uniform2fv(u_viewport, new Float32Array([W, H]));
    gl.uniformMatrix4fv(u_projection, false, new Float32Array(projectionMatrix));
  }
  window.addEventListener('resize', resize);
  resize();

  // Drop the render resolution a little while the camera is moving, then restore
  // it ~0.2s after the last input — smooth while dragging, crisp at rest. On a
  // device that's comfortably fast, moveFactor becomes 1 and nothing is dropped.
  function markInteracting() {
    if (activeScale === 1 && moveFactor < 1) {
      activeScale = moveFactor;
      resize();
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      if (activeScale !== 1) {
        activeScale = 1;
        resize();
      }
    }, 220);
  }

  /*
   * Frame-rate feedback. Sampled over ~0.7s windows, with a gap between the
   * "speed up" and "slow down" thresholds so it settles instead of oscillating.
   * Resolution is traded first (cheap, reversible); only once it's already at the
   * floor does the splat count come down, since that's the visible one.
   */
  var fpsFrames = 0;
  var fpsSince = 0;
  var lastFps = 0;

  function setScale(next) {
    next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, next));
    if (Math.abs(next - renderScale) < 0.02) return false;
    renderScale = next;
    resize();
    return true;
  }

  function adapt(fps) {
    if (!textureReady || !drawCount) return; // nothing drawn yet — don't judge
    if (fps >= 55) {
      // Headroom: sharpen first, then draw more of the splats we're holding back.
      if (!setScale(renderScale + 0.15) && renderCount < totalSplats) {
        renderCount = Math.min(totalSplats, Math.round(renderCount * 1.25) + 50000);
        lastPosted = ''; // force a re-sort at the new budget
      }
      if (fps >= 58 && renderScale >= MAX_SCALE - 0.01) moveFactor = 1;
    } else if (fps < 40) {
      if (!setScale(renderScale - 0.2) && renderCount > MIN_SPLATS) {
        renderCount = Math.max(MIN_SPLATS, Math.round(renderCount * 0.75));
        lastPosted = '';
      }
      moveFactor = IS_MOBILE ? 0.55 : 0.8;
    }
  }

  function sampleFps(now) {
    if (!fpsSince) {
      fpsSince = now;
      return;
    }
    fpsFrames++;
    var elapsed = now - fpsSince;
    if (elapsed < 700) return;
    lastFps = (fpsFrames * 1000) / elapsed;
    fpsFrames = 0;
    fpsSince = now;
    adapt(lastFps);
    if (qualityEl) {
      qualityEl.textContent =
        renderScale.toFixed(2) + '× · ' + Math.round(lastFps) + ' fps · ' +
        (renderCount >= 1e6 ? (renderCount / 1e6).toFixed(1) + 'M' : Math.round(renderCount / 1000) + 'k') +
        (renderCount < totalSplats ? ' of ' + (totalSplats / 1e6).toFixed(1) + 'M' : '') + ' splats';
      qualityEl.hidden = false;
    }
  }

  function eyePosition() {
    var cp = Math.cos(pitch);
    var sp = Math.sin(pitch);
    var cy = Math.cos(yaw);
    var sy = Math.sin(yaw);
    var dir = [cp * sy, sp, cp * cy]; // target -> eye
    return [target[0] + dist * dir[0], target[1] + dist * dir[1], target[2] + dist * dir[2]];
  }
  function currentView() {
    return lookAtZForward(eyePosition(), target, UP);
  }

  // ---- worker plumbing ------------------------------------------------------
  var worker = new Worker('/js/splat-worker.js');
  var drawCount = 0;
  var textureReady = false;

  worker.onmessage = function (e) {
    var d = e.data;
    if (d.error) {
      fail('Could not load this splat: ' + d.error);
      return;
    }
    if (d.bounds) {
      // Start mobile on a subset of the (importance-ordered) splats and let the
      // measurements raise it; desktop starts with everything.
      totalSplats = d.vertexCount;
      renderCount = IS_MOBILE ? Math.min(totalSplats, 700000) : totalSplats;
      initCamera(d.bounds);
    }
    if (d.texdata) uploadTexture(d);
    if (d.depthIndex) {
      gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, d.depthIndex, gl.DYNAMIC_DRAW);
      drawCount = d.vertexCount;
      if (drawCount > 0) hideLoading();
    }
  };
  worker.onerror = function () {
    fail('The splat viewer background worker failed to start.');
  };

  function initCamera(b) {
    if (DEFAULT_VIEW) {
      // The owner picked where this splat opens; Reset returns here too.
      target = DEFAULT_VIEW.t.slice();
      dist = DEFAULT_VIEW.d;
      yaw = DEFAULT_VIEW.y;
      pitch = DEFAULT_VIEW.p;
    } else {
      target = b.center.slice();
      dist = Math.max(b.radius * 2.6, 0.5);
      yaw = 0;
      pitch = START_PITCH;
    }
    initial = { target: target.slice(), dist: dist, yaw: yaw, pitch: pitch };
    autoFramed = { target: b.center.slice(), dist: Math.max(b.radius * 2.6, 0.5), yaw: 0, pitch: START_PITCH };
    haveData = true;
  }
  function uploadTexture(d) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32UI, d.texwidth, d.texheight, 0, gl.RGBA_INTEGER, gl.UNSIGNED_INT, d.texdata);
    textureReady = true;
  }

  // ---- render loop ----------------------------------------------------------
  var lastPosted = '';
  function frame(now) {
    sampleFps(now || performance.now());
    if (haveData) {
      var view = currentView();
      var key = view.join(',');
      if (key !== lastPosted) {
        worker.postMessage({ view: multiply4(projectionMatrix, view), count: renderCount });
        lastPosted = key;
      }
      gl.uniformMatrix4fv(u_view, false, new Float32Array(view));
    }
    // Composite the splats in linear light (float target), then tone-map to the
    // screen. Without float support this draws straight to the canvas as before.
    var useHdr = ensureHdr(canvas.width, canvas.height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, useHdr ? hdrFbo : null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (textureReady && drawCount > 0) {
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, drawCount);
    }
    if (useHdr) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND); // this pass writes the finished image
      gl.useProgram(postProgram);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, hdrTex);
      gl.uniform1i(u_postTex, 1);
      gl.uniform1f(u_postExposure, EXPOSURE);
      var gainv = gradeGain();
      gl.uniform3f(u_postGrade, gainv[0], gainv[1], gainv[2]);
      gl.bindVertexArray(postVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.BLEND);
      gl.useProgram(program);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- controls -------------------------------------------------------------
  var dragging = false;
  var dragMode = 'orbit';
  var lastX = 0;
  var lastY = 0;

  function panBy(dx, dy) {
    // Only the vertical pan needs flip-compensation: horizontal already stays
    // consistent (the roll flips the world axis and the screen orientation
    // together), so compensating it too would wrongly invert it.
    dy *= CTRL;
    var view = currentView();
    var right = [view[0], view[4], view[8]];
    var camUp = [view[1], view[5], view[9]];
    var k = dist * 0.0016;
    for (var i = 0; i < 3; i++) {
      target[i] += (-dx * right[i] + dy * camUp[i]) * k;
    }
  }
  function orbitBy(dx, dy) {
    yaw -= CTRL * dx * 0.005;
    pitch += CTRL * dy * 0.005;
    if (pitch < MIN_PITCH) pitch = MIN_PITCH;
    if (pitch > MAX_PITCH) pitch = MAX_PITCH;
  }
  function dollyBy(factor) {
    dist *= factor;
    if (dist < 0.05) dist = 0.05;
    if (dist > 500) dist = 500;
  }

  canvas.addEventListener('pointerdown', function (ev) {
    dragging = true;
    dragMode = ev.button === 2 || ev.shiftKey ? 'pan' : 'orbit';
    lastX = ev.clientX;
    lastY = ev.clientY;
    dismissHint();
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(ev.pointerId);
      } catch (e) {}
    }
  });
  canvas.addEventListener('pointermove', function (ev) {
    if (!dragging) return;
    var dx = ev.clientX - lastX;
    var dy = ev.clientY - lastY;
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (dragMode === 'pan') panBy(dx, dy);
    else orbitBy(dx, dy);
    markInteracting();
  });
  function endDrag() {
    dragging = false;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', endDrag);
  canvas.addEventListener('contextmenu', function (ev) {
    ev.preventDefault();
  });
  canvas.addEventListener(
    'wheel',
    function (ev) {
      ev.preventDefault();
      dismissHint();
      dollyBy(Math.exp(ev.deltaY * 0.001));
      markInteracting();
    },
    { passive: false }
  );

  // Touch: one finger orbits, two fingers pinch-zoom and pan.
  var touchDist = 0;
  var touchMidX = 0;
  var touchMidY = 0;
  function midpoint(t) {
    return [(t[0].clientX + t[1].clientX) / 2, (t[0].clientY + t[1].clientY) / 2];
  }
  function spread(t) {
    return Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  }
  canvas.addEventListener(
    'touchstart',
    function (ev) {
      dismissHint();
      if (ev.touches.length === 1) {
        dragging = true;
        dragMode = 'orbit';
        lastX = ev.touches[0].clientX;
        lastY = ev.touches[0].clientY;
      } else if (ev.touches.length === 2) {
        dragging = false;
        touchDist = spread(ev.touches);
        var m = midpoint(ev.touches);
        touchMidX = m[0];
        touchMidY = m[1];
      }
    },
    { passive: true }
  );
  canvas.addEventListener(
    'touchmove',
    function (ev) {
      if (ev.touches.length === 1 && dragging) {
        var dx = ev.touches[0].clientX - lastX;
        var dy = ev.touches[0].clientY - lastY;
        lastX = ev.touches[0].clientX;
        lastY = ev.touches[0].clientY;
        orbitBy(dx, dy);
      } else if (ev.touches.length === 2) {
        ev.preventDefault();
        var nd = spread(ev.touches);
        if (touchDist > 0) dollyBy(touchDist / (nd || 1));
        touchDist = nd;
        var m = midpoint(ev.touches);
        panBy(m[0] - touchMidX, m[1] - touchMidY);
        touchMidX = m[0];
        touchMidY = m[1];
      }
      markInteracting();
    },
    { passive: false }
  );
  canvas.addEventListener('touchend', function (ev) {
    if (ev.touches.length === 0) dragging = false;
  });

  // ---- toolbar --------------------------------------------------------------
  if (resetBtn) {
    resetBtn.addEventListener('click', function () {
      if (!initial) return;
      target = initial.target.slice();
      dist = initial.dist;
      yaw = initial.yaw;
      pitch = initial.pitch;
    });
  }
  if (fullBtn) {
    fullBtn.addEventListener('click', function () {
      var el = stage;
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (el.requestFullscreen) {
        el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
      setTimeout(resize, 100);
    });
  }
  document.addEventListener('fullscreenchange', function () {
    setTimeout(resize, 60);
  });

  /*
   * Owner-only "Set default view" / "Clear": save the camera a visitor starts
   * at. Navigate to the shot you want, then save it — Reset returns here too.
   */
  var setViewBtn = document.getElementById('splatSetView');
  var clearViewBtn = document.getElementById('splatClearView');
  function flash(btn, text) {
    var old = btn.textContent;
    btn.textContent = text;
    btn.disabled = true;
    setTimeout(function () {
      btn.textContent = old;
      btn.disabled = false;
    }, 1400);
  }
  function postView(body, btn, okText) {
    fetch('/admin/splats/' + encodeURIComponent(SPLAT_ID) + '/view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body,
      credentials: 'same-origin',
    })
      .then(function (r) {
        flash(btn, r.ok ? okText : 'Failed');
      })
      .catch(function () {
        flash(btn, 'Failed');
      });
  }
  if (setViewBtn) {
    setViewBtn.addEventListener('click', function () {
      if (!haveData) return;
      initial = { target: target.slice(), dist: dist, yaw: yaw, pitch: pitch };
      postView(
        'tx=' + target[0] + '&ty=' + target[1] + '&tz=' + target[2] + '&dist=' + dist + '&yaw=' + yaw + '&pitch=' + pitch,
        setViewBtn,
        'Saved ✓'
      );
      if (clearViewBtn) clearViewBtn.hidden = false;
    });
  }
  if (clearViewBtn) {
    clearViewBtn.addEventListener('click', function () {
      if (autoFramed) initial = { target: autoFramed.target.slice(), dist: autoFramed.dist, yaw: autoFramed.yaw, pitch: autoFramed.pitch };
      postView('clear=1', clearViewBtn, 'Cleared ✓');
    });
  }

  // Owner-only live exposure slider: adjusts brightness in real time and saves
  // the value per-splat (debounced) so it becomes the default everyone sees.
  var expEl = document.getElementById('splatExposure');
  if (expEl) {
    var saveTimer = null;
    expEl.addEventListener('input', function () {
      EXPOSURE = parseFloat(expEl.value) || 1;
      if (!HDR_OK) {
        gl.useProgram(program);
        gl.uniform1f(u_exposure, EXPOSURE);
      }
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        fetch('/admin/splats/' + encodeURIComponent(SPLAT_ID) + '/exposure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'exposure=' + encodeURIComponent(EXPOSURE),
          credentials: 'same-origin',
        }).catch(function () {});
      }, 500);
    });
  }

  /*
   * Owner-only white balance + tint. Same live-then-save shape as the exposure
   * slider: the gain is recomputed on every input event (free — the HDR pass
   * reads it per frame) and the pair is written back once the sliders settle.
   */
  var wbEl = document.getElementById('splatWb');
  var tintEl = document.getElementById('splatTint');
  var colourBtn = document.getElementById('splatColourBtn');
  var colourPanel = document.getElementById('splatColourPanel');
  if (colourBtn && colourPanel) {
    colourBtn.addEventListener('click', function () {
      colourPanel.hidden = !colourPanel.hidden;
      colourBtn.classList.toggle('is-on', !colourPanel.hidden);
    });
  }
  if (wbEl && tintEl) {
    var gradeTimer = null;
    var wbOut = document.getElementById('splatWbOut');
    var tintOut = document.getElementById('splatTintOut');
    var showGrade = function () {
      if (wbOut) wbOut.textContent = WB.toFixed(2);
      if (tintOut) tintOut.textContent = TINT.toFixed(2);
    };
    var readGrade = function () {
      WB = parseFloat(wbEl.value) || 0;
      TINT = parseFloat(tintEl.value) || 0;
      showGrade();
      applyGrade();
      if (gradeTimer) clearTimeout(gradeTimer);
      gradeTimer = setTimeout(function () {
        fetch('/admin/splats/' + encodeURIComponent(SPLAT_ID) + '/grade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'white_balance=' + encodeURIComponent(WB) + '&tint=' + encodeURIComponent(TINT),
          credentials: 'same-origin',
        }).catch(function () {});
      }, 500);
    };
    showGrade();
    wbEl.addEventListener('input', readGrade);
    tintEl.addEventListener('input', readGrade);
    var gradeResetEl = document.getElementById('splatGradeReset');
    if (gradeResetEl) {
      gradeResetEl.addEventListener('click', function () {
        wbEl.value = 0;
        tintEl.value = 0;
        readGrade();
      });
    }
  }

  // ---- loading UI -----------------------------------------------------------
  var hintTimer = null;
  function dismissHint() {
    if (hintEl) hintEl.classList.add('gone');
    if (hintTimer) {
      clearTimeout(hintTimer);
      hintTimer = null;
    }
  }
  function hideLoading() {
    if (loadingEl && !loadingEl.classList.contains('gone')) {
      loadingEl.classList.add('gone');
      if (hintEl) {
        hintEl.classList.remove('gone');
        hintTimer = setTimeout(dismissHint, 4500);
        // On mobile the description caption is a full-width band at the bottom;
        // lift the controls hint to just above it so it isn't covered.
        if (IS_MOBILE && captionEl) {
          var fromBottom = stage.getBoundingClientRect().bottom - captionEl.getBoundingClientRect().top;
          hintEl.style.bottom = Math.round(fromBottom + 12) + 'px';
        }
      }
      // On mobile (where resolution + splat count are reduced), briefly note it.
      if (IS_MOBILE && mobileNoteEl) {
        mobileNoteEl.classList.add('show');
        setTimeout(function () {
          mobileNoteEl.classList.add('gone');
        }, 7000);
      }
    }
  }

  async function load() {
    if (!SRC) {
      fail('This splat has no file attached.');
      return;
    }
    var res = await fetch(SRC);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var ab;
    if (res.body && res.body.getReader) {
      var total = +(res.headers.get('content-length') || 0);
      var reader = res.body.getReader();
      var chunks = [];
      var received = 0;
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        chunks.push(r.value);
        received += r.value.length;
        if (total) {
          var pct = Math.min(100, (received / total) * 100);
          if (barEl) barEl.style.width = pct.toFixed(1) + '%';
          if (labelEl) labelEl.textContent = 'Loading ' + Math.round(pct) + '%';
        } else if (labelEl) {
          labelEl.textContent = 'Loading ' + (received / 1048576).toFixed(1) + ' MB';
        }
      }
      var merged = new Uint8Array(received);
      var off = 0;
      for (var i = 0; i < chunks.length; i++) {
        merged.set(chunks[i], off);
        off += chunks[i].length;
      }
      ab = merged.buffer;
    } else {
      ab = await res.arrayBuffer();
    }
    if (labelEl) labelEl.textContent = 'Preparing…';
    if (barEl) barEl.style.width = '100%';
    if (FORMAT === 'ply') worker.postMessage({ ply: ab }, [ab]);
    else if (FORMAT === 'spz') worker.postMessage({ spz: ab }, [ab]);
    else worker.postMessage({ splat: ab }, [ab]);
  }

  load().catch(function (e) {
    fail('Could not download the splat file (' + (e && e.message ? e.message : e) + ').');
  });
})();
