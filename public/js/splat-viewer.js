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
  var SPLAT_SCALE = parseFloat(SELF.getAttribute('data-splat-scale')) || 1; // size of the discs themselves
  var SPLAT_ALPHA = parseFloat(SELF.getAttribute('data-splat-alpha')) || 1;  // and how opaque they are
  var SPLAT_ID = SELF.getAttribute('data-id') || '';
  var BG_SRC = SELF.getAttribute('data-bg') || '';           // equirectangular 360 backdrop
  var BG_YAW = parseFloat(SELF.getAttribute('data-bg-yaw')) || 0; // whole turns
  var WB = parseFloat(SELF.getAttribute('data-wb')) || 0;    // -1 cool .. +1 warm
  var TINT = parseFloat(SELF.getAttribute('data-tint')) || 0; // -1 green .. +1 magenta
  var GAMMA = parseFloat(SELF.getAttribute('data-gamma')) || 1;      // 0.5 .. 2, 1 neutral
  var SHADOWS = parseFloat(SELF.getAttribute('data-shadows')) || 0;  // the three bands,
  var MIDS = parseFloat(SELF.getAttribute('data-mids')) || 0;        // -1 .. +1 each,
  var HIGHS = parseFloat(SELF.getAttribute('data-highs')) || 0;      // 0 neutral
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

  /*
   * A context can fail to come back for reasons that have nothing to do with
   * what the browser is capable of — a phone under memory pressure, a tab that
   * already has several 3D views alive in it, a context lost earlier and never
   * given back. Telling someone their browser is too old in those cases sends
   * them nowhere: the page they are on would work perfectly a moment later.
   *
   * So ask before saying. The driver's own reason arrives on a
   * webglcontextcreationerror event, and two throwaway canvases separate "this
   * browser cannot" from "not right now": if a fresh canvas gets a WebGL2
   * context, WebGL2 is plainly here and the problem is this page's state, which
   * a reload clears. The probes are handed back immediately — a diagnosis that
   * leaks contexts would make the very thing it is diagnosing worse.
   */
  var creationError = '';
  canvas.addEventListener('webglcontextcreationerror', function (e) {
    if (e && e.statusMessage) creationError = String(e.statusMessage);
  });

  function probeContext(kind) {
    var c = document.createElement('canvas').getContext(kind);
    if (!c) return false;
    var lose = c.getExtension('WEBGL_lose_context');
    if (lose) lose.loseContext();
    return true;
  }

  // Some drivers refuse one set of attributes and grant another, so a plain
  // request is worth trying before concluding anything.
  var gl = canvas.getContext('webgl2', { antialias: false }) || canvas.getContext('webgl2');
  if (!gl) {
    var because = creationError ? ' (' + creationError + ')' : '';
    if (probeContext('webgl2')) {
      fail('This 3D view could not start' + because + ', though this browser does support it. '
        + 'Reloading the page usually clears it — it is normally another 3D view still holding the graphics card.');
    } else if (probeContext('webgl')) {
      fail('This 3D viewer needs WebGL2 and this browser is only offering WebGL1' + because + '. '
        + 'If you opened this from inside another app, opening it in Safari or Chrome instead usually has it.');
    } else {
      fail('This 3D viewer needs WebGL2, which this browser does not seem to offer' + because + '. '
        + 'On a phone this is often a browser built into another app — opening the page in Safari or Chrome usually works.');
    }
    return;
  }

  /*
   * A phone short of memory can have the context taken away again while the
   * splat is on screen. Left alone that is a canvas that has quietly stopped
   * drawing; caught, it is a sentence saying what happened. preventDefault is
   * what allows the browser to hand one back at all, so it is worth doing even
   * though this viewer rebuilds from scratch on a reload rather than restoring.
   */
  canvas.addEventListener('webglcontextlost', function (e) {
    e.preventDefault();
    fail('The browser took the graphics card back from this 3D view, usually because the device was short of memory. Reload the page to start it again.');
  });

  /*
   * Coming back to this page with the back button hands it over from the
   * browser's cache exactly as it was — including, on a phone, a context that
   * was taken away while it sat there. Nothing here can revive one, so the only
   * honest thing is to start the page again. Only when it really is lost: a
   * context that survived the trip is perfectly good, and reloading that would
   * be throwing away a splat the visitor has already waited for.
   */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted && gl.isContextLost()) window.location.reload();
  });

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

  /*
   * ---- shaders (from antimatter15/splat) ------------------------------------
   *
   * Two additions to the vertex shader. splatScale multiplies the two axes of
   * the screen-space ellipse a splat is drawn as: the falloff in the fragment
   * shader is in the quad's own space, so scaling the axes scales the whole
   * Gaussian rather than cropping it — a splat drawn larger is the same splat,
   * spread wider. It goes inside the 1024 clamp so that guard stays an absolute
   * cap on what one splat may cover, whatever the multiplier says.
   *
   * splatAlpha multiplies how opaque each splat is. It belongs here rather than
   * in the fragment shader because the fragment's B is this alpha times the
   * falloff, and the colour it writes is premultiplied by B — so scaling the
   * alpha once, up front, scales what a splat contributes and what it hides
   * behind it by the same amount, which is what "more transparent" has to mean.
   * Clamped, so a multiplier above 1 can make a faint splat solid but never
   * accumulate past what the blend expects.
   */
  var vsSource =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'precision highp int;\n' +
    'uniform highp usampler2D u_texture;\n' +
    'uniform mat4 projection, view;\n' +
    'uniform vec2 focal;\n' +
    'uniform vec2 viewport;\n' +
    'uniform float splatScale;\n' +
    'uniform float splatAlpha;\n' +
    // Harmonics to degree 2: eight coefficients a splat over six texels, or
    // nothing at all when the file had none.
    'uniform highp sampler2D u_sh;\n' +
    'uniform float shOn;\n' +
    // Whether the colour in the data texture is two pairs of halves (a file that
    // had real colour) or the four bytes the .splat format keeps.
    'uniform float hdrOn;\n' +
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
    // A splat smaller than a pixel has no defensible shape on screen: it lands
    // wherever the sampling happens to catch it and flickers as anything moves.
    // The reference rasteriser widens every splat by a third of a pixel for that
    // reason, which costs nothing on the large ones and turns the small ones from
    // sparkle into the soft points they are meant to be.
    '    cov2d[0][0] += 0.3;\n' +
    '    cov2d[1][1] += 0.3;\n' +
    '    float mid = (cov2d[0][0] + cov2d[1][1]) / 2.0;\n' +
    '    float radius = length(vec2((cov2d[0][0] - cov2d[1][1]) / 2.0, cov2d[0][1]));\n' +
    '    float lambda1 = mid + radius, lambda2 = mid - radius;\n' +
    '    if(lambda2 < 0.0) return;\n' +
    /*
     * The major axis of the projected ellipse. Both components are zero when the
     * ellipse is exactly axis-aligned and its wider axis is the horizontal one —
     * a flat surface square to the camera does it — and normalising nothing gives
     * NaN, which silently loses the splat. Upstream has the same hole; a splat
     * that is already axis-aligned simply is its own axis, so say so.
     */
    '    vec2 dv = vec2(cov2d[0][1], lambda1 - cov2d[0][0]);\n' +
    '    vec2 diagonalVector = dot(dv, dv) > 1e-12 ? normalize(dv) : vec2(1.0, 0.0);\n' +
    '    vec2 majorAxis = min(sqrt(2.0 * lambda1) * splatScale, 1024.0) * diagonalVector;\n' +
    '    vec2 minorAxis = min(sqrt(2.0 * lambda2) * splatScale, 1024.0) * vec2(diagonalVector.y, -diagonalVector.x);\n' +
    '    vec4 base;\n' +
    '    if (hdrOn > 0.5) {\n' +
    '        vec2 rg = unpackHalf2x16(cen.w);\n' +
    '        vec2 ba = unpackHalf2x16(cov.w);\n' +
    '        base = vec4(rg, ba);\n' +
    '    } else {\n' +
    '        base = vec4((cov.w) & 0xffu, (cov.w >> 8) & 0xffu, (cov.w >> 16) & 0xffu, (cov.w >> 24) & 0xffu) / 255.0;\n' +
    '    }\n' +
    /*
     * The colour in the record is the splat seen from nowhere in particular. The
     * three harmonics bend it towards where the camera actually is, which is what
     * makes a surface look wet, or metal, or lit from one side, instead of
     * painted. The direction has to be the one the model was trained in, so the
     * camera-space vector to the splat is turned back by the view rotation —
     * orthonormal, so its transpose is its inverse and no matrix need be built.
     * Signs and the coefficient are the reference evaluation's, unchanged.
     */
    '    if (shOn > 0.5) {\n' +
    // 512 splats to a row here, half the covariance texture's, so that six
    // texels a splat stay inside a width every GPU will take.
    '        ivec2 s0 = ivec2(int((uint(index) & 0x1ffu) * 6u), int(uint(index) >> 9));\n' +
    '        vec4 t0 = texelFetch(u_sh, s0, 0);\n' +
    '        vec4 t1 = texelFetch(u_sh, s0 + ivec2(1, 0), 0);\n' +
    '        vec4 t2 = texelFetch(u_sh, s0 + ivec2(2, 0), 0);\n' +
    '        vec4 t3 = texelFetch(u_sh, s0 + ivec2(3, 0), 0);\n' +
    '        vec4 t4 = texelFetch(u_sh, s0 + ivec2(4, 0), 0);\n' +
    '        vec4 t5 = texelFetch(u_sh, s0 + ivec2(5, 0), 0);\n' +
    // Every three texels hold four coefficients, so the eight come out of six in
    // two identical steps. Bytes back to their value: a byte of 128 is nothing.
    '        vec3 c0 = t0.rgb, c1 = vec3(t0.a, t1.rg), c2 = vec3(t1.ba, t2.r), c3 = t2.gba;\n' +
    '        vec3 c4 = t3.rgb, c5 = vec3(t3.a, t4.rg), c6 = vec3(t4.ba, t5.r), c7 = t5.gba;\n' +
    '        float q = 255.0 / 128.0;\n' +
    '        c0 = c0 * q - 1.0; c1 = c1 * q - 1.0; c2 = c2 * q - 1.0; c3 = c3 * q - 1.0;\n' +
    '        c4 = c4 * q - 1.0; c5 = c5 * q - 1.0; c6 = c6 * q - 1.0; c7 = c7 * q - 1.0;\n' +
    '        vec3 d = normalize(transpose(mat3(view)) * cam.xyz);\n' +
    '        float x = d.x, y = d.y, z = d.z;\n' +
    '        vec3 sh = 0.4886025119029199 * (-y * c0 + z * c1 - x * c2);\n' +
    // Degree 2: the same evaluation the reference does, constants and all.
    '        sh += 1.0925484305920792 * x * y * c3;\n' +
    '        sh += -1.0925484305920792 * y * z * c4;\n' +
    '        sh += 0.31539156525252005 * (2.0 * z * z - x * x - y * y) * c5;\n' +
    '        sh += -1.0925484305920792 * x * z * c6;\n' +
    '        sh += 0.5462742152960396 * (x * x - y * y) * c7;\n' +
    // Only the floor is held: a splat the harmonics push above white is a splat
    // that is meant to be that bright, and the tone mapping is what decides
    // what to do about it.
    '        base.rgb = max(base.rgb + sh, vec3(0.0));\n' +
    '    }\n' +
    '    base.a = clamp(base.a * splatAlpha, 0.0, 1.0);\n' +
    '    vColor = clamp(pos2d.z/pos2d.w+1.0, 0.0, 1.0) * base;\n' +
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
    // Three sigma: the quad reaches exactly this far, and past it the gaussian is
    // down to a hundredth of itself and worth nothing but fill rate.
    '    if (A < -4.5) discard;\n' +
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

  /*
   * The tone-mapping pass is also where the grade lives, because it is the only
   * place the finished picture exists: a band of tone is a property of the
   * composited image, not of any one splat, so nothing per-splat could know
   * which band it had landed in.
   *
   * Order is exposure, then the per-channel gains, then the three bands, then
   * gamma, and the shoulder last. That is the order they mean: exposure decides
   * how much light there is, the bands redistribute it, gamma bends what is
   * left, and the shoulder catches whatever came out above white.
   *
   * The bands are weighted on a rough perceptual value rather than on linear
   * luminance, or "mid" would sit down in what the eye reads as shadow. Their
   * weights sum to 1 at every level, so with all three at the same setting this
   * is a plain gain and nothing is double-counted at the joins.
   */
  var postFs =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D tex;\n' +
    'uniform float exposure;\n' +
    // White balance / tint as per-channel gains, applied in linear light.
    'uniform vec3 grade;\n' +
    // Shadows / mids / highlights, -1 .. +1 each, and the overall gamma.
    'uniform vec3 bands;\n' +
    'uniform float gamma;\n' +
    'in vec2 vUv;\n' +
    'out vec4 fragColor;\n' +
    // Highlights below the knee pass through untouched, so a splat left at
    // exposure 1 keeps very close to its original brightness.
    'const float KNEE = 0.85;\n' +
    'void main () {\n' +
    '    vec3 c = texture(tex, vUv).rgb * exposure * grade;\n' +
    '    float lum = dot(max(c, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));\n' +
    '    float t = pow(clamp(lum, 0.0, 1.0), 1.0 / 2.2);\n' +
    '    float ws = 1.0 - smoothstep(0.0, 0.5, t);\n' +
    '    float wh = smoothstep(0.5, 1.0, t);\n' +
    '    float wm = 1.0 - ws - wh;\n' +
    '    c *= max(1.0 + bands.x * ws + bands.y * wm + bands.z * wh, 0.0);\n' +
    '    if (gamma != 1.0) c = pow(max(c, vec3(0.0)), vec3(1.0 / gamma));\n' +
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

  /*
   * ---- 360 backdrop ----------------------------------------------------------
   * An equirectangular panorama behind the splat. Rather than build a sphere,
   * this is one fullscreen triangle: for each pixel the camera ray is rebuilt
   * from the same focal length and viewport the splats are projected with, then
   * turned into a latitude/longitude pair to look up. Nothing to tessellate, no
   * geometry to sort against, and it can never intersect the capture.
   *
   * The panorama's own up axis follows the viewer's, so a splat flipped upright
   * takes its backdrop with it rather than ending up on its head.
   */
  var bgProgram = null;
  var bgTex = null;
  var bgVao = null;
  var bgReady = false;
  var u_bgTex = null;
  var u_bgViewport = null;
  var u_bgFocal = null;
  var u_bgPano = null;
  var u_bgYaw = null;
  var u_bgExposure = null;
  var u_bgGrade = null;
  var u_bgLinear = null;

  var bgFs =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'uniform sampler2D bg;\n' +
    'uniform vec2 viewport;\n' +
    'uniform vec2 focal;\n' +
    'uniform mat3 pano;\n' + // camera space -> panorama space
    'uniform float yaw;\n' + // whole turns, so 0.25 is a quarter round
    'uniform float exposure;\n' +
    'uniform vec3 grade;\n' +
    'uniform float toLinear;\n' + // the float buffer holds linear light, the canvas does not
    'in vec2 vUv;\n' +
    'out vec4 fragColor;\n' +
    'void main () {\n' +
    '    vec2 ndc = vUv * 2.0 - 1.0;\n' +
    // The inverse of the projection the splats use, so the backdrop lines up
    // with them exactly at any field of view or window shape.
    '    vec3 d = normalize(pano * vec3(\n' +
    '        ndc.x * viewport.x / (2.0 * focal.x),\n' +
    '       -ndc.y * viewport.y / (2.0 * focal.y),\n' +
    '        1.0));\n' +
    '    float u = atan(d.x, d.z) * 0.15915494 + 0.5 + yaw;\n' + // 1/(2pi)
    '    float v = acos(clamp(d.y, -1.0, 1.0)) * 0.31830989;\n' + // 1/pi
    '    vec3 c = texture(bg, vec2(u, v)).rgb;\n' +
    '    if (toLinear > 0.5) c = pow(c, vec3(2.2));\n' +
    '    c *= exposure * grade;\n' +
    // Opaque: under the blend above, this fills whatever light the splats left.
    '    fragColor = vec4(c, 1.0);\n' +
    '}\n';

  function initBackdrop() {
    if (!BG_SRC) return;
    try {
      bgProgram = gl.createProgram();
      gl.attachShader(bgProgram, compile(gl.VERTEX_SHADER, postVs));
      gl.attachShader(bgProgram, compile(gl.FRAGMENT_SHADER, bgFs));
      gl.linkProgram(bgProgram);
      if (!gl.getProgramParameter(bgProgram, gl.LINK_STATUS)) throw new Error('backdrop link failed');
      u_bgTex = gl.getUniformLocation(bgProgram, 'bg');
      u_bgViewport = gl.getUniformLocation(bgProgram, 'viewport');
      u_bgFocal = gl.getUniformLocation(bgProgram, 'focal');
      u_bgPano = gl.getUniformLocation(bgProgram, 'pano');
      u_bgYaw = gl.getUniformLocation(bgProgram, 'yaw');
      u_bgExposure = gl.getUniformLocation(bgProgram, 'exposure');
      u_bgGrade = gl.getUniformLocation(bgProgram, 'grade');
      u_bgLinear = gl.getUniformLocation(bgProgram, 'toLinear');
      bgVao = gl.createVertexArray();
      gl.useProgram(program);
    } catch (e) {
      bgProgram = null; // no backdrop is a perfectly good outcome
      return;
    }
    var img = new Image();
    img.onload = function () {
      bgTex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, bgTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      // Repeat sideways so turning the panorama wraps seamlessly; clamp top and
      // bottom, where there is nothing beyond the poles to sample.
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.activeTexture(gl.TEXTURE0);
      bgReady = true;
      invalidate();
    };
    img.onerror = function () {
      /* a missing backdrop just leaves the stage dark */
    };
    img.src = BG_SRC;
  }

  // The panorama's own frame: its up axis is the viewer's, with any two
  // perpendicular axes making up the rest — which one faces "forward" only sets
  // where a rotation of zero points, and the owner aims that with the slider.
  function panoAxes() {
    var up = normalize(UP);
    var ref = Math.abs(up[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    var right = normalize(cross(up, ref));
    return { up: up, right: right, fwd: cross(right, up) };
  }

  function drawBackdrop(useHdr) {
    if (!bgReady || !bgProgram) return;
    var view = currentView();
    // The camera's world-space axes are the rows of the view rotation.
    var cx = [view[0], view[4], view[8]];
    var cy = [view[1], view[5], view[9]];
    var cz = [view[2], view[6], view[10]];
    var a = panoAxes();
    // Camera space -> world -> panorama, folded into one matrix (column-major).
    var m = new Float32Array([
      dot3(a.right, cx), dot3(a.up, cx), dot3(a.fwd, cx),
      dot3(a.right, cy), dot3(a.up, cy), dot3(a.fwd, cy),
      dot3(a.right, cz), dot3(a.up, cz), dot3(a.fwd, cz),
    ]);
    var s = stageSize();
    gl.useProgram(bgProgram);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.uniform1i(u_bgTex, 2);
    gl.uniform2f(u_bgViewport, s[0], s[1]);
    gl.uniform2f(u_bgFocal, focalX, focalY);
    gl.uniformMatrix3fv(u_bgPano, false, m);
    gl.uniform1f(u_bgYaw, BG_YAW);
    // In the float path the tone-mapping pass applies exposure and grade to the
    // finished image, backdrop included, so they aren't applied twice here.
    var g = useHdr ? [1, 1, 1] : gradeGain();
    gl.uniform1f(u_bgExposure, useHdr ? 1 : EXPOSURE);
    gl.uniform3f(u_bgGrade, g[0], g[1], g[2]);
    gl.uniform1f(u_bgLinear, useHdr ? 1 : 0);
    gl.bindVertexArray(bgVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(program);
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
    if (!hdrReady) {
      /*
       * The GPU refused a target this size. Giving up on the float buffer
       * altogether would cost the whole linear-light pipeline — the thing that
       * keeps colour honest — so first try asking for less: halve the pixel
       * budget and let the next frame come back with a size it will take. Only
       * a refusal at an already-small size means this GPU simply can't.
       */
      if (w * h > 1e6) {
        MAX_PIXELS = Math.max(1e6, Math.round(w * h * 0.5));
        hdrW = 0;
        hdrH = 0;
        resize();
      } else {
        HDR_OK = false;
      }
    }
    return hdrReady;
  }

  var u_grade = gl.getUniformLocation(program, 'grade');
  var u_postGrade = postProgram ? gl.getUniformLocation(postProgram, 'grade') : null;
  var u_postBands = postProgram ? gl.getUniformLocation(postProgram, 'bands') : null;
  var u_postGamma = postProgram ? gl.getUniformLocation(postProgram, 'gamma') : null;

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
  var u_splatScale = gl.getUniformLocation(program, 'splatScale');
  var u_splatAlpha = gl.getUniformLocation(program, 'splatAlpha');
  var u_shTex = gl.getUniformLocation(program, 'u_sh');
  var u_shOn = gl.getUniformLocation(program, 'shOn');
  var u_hdrOn = gl.getUniformLocation(program, 'hdrOn');
  var hasSh = false;
  gl.uniform1f(u_shOn, 0); // until a file arrives that has them
  gl.uniform1f(u_hdrOn, 0); // ...and until one arrives with colour past a byte
  // In the HDR path exposure is applied by the tone-mapping pass each frame.
  if (!HDR_OK) gl.uniform1f(u_exposure, EXPOSURE);
  /*
   * How large the splats are and how opaque they are both describe the splats
   * themselves rather than the picture made of them, so unlike exposure they
   * belong to this program in both paths, and are set once until the owner
   * changes them.
   */
  gl.uniform1f(u_splatScale, SPLAT_SCALE);
  gl.uniform1f(u_splatAlpha, SPLAT_ALPHA);
  applyGrade(); // the fallback shader needs a gain before the first draw
  initBackdrop();

  /*
   * Quad corners (per-vertex, one instance per splat). The distance is in units
   * of the axes the vertex shader computes, which are sqrt(2) sigma each, so
   * these 2.1213 are three sigma exactly — where the reference rasteriser stops
   * as well. The 2 that stood here cut every splat at 2.83 sigma, which is a
   * visible edge on the largest ones. It is 12% more area to fill per splat.
   */
  var vertexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  var QUAD = 3 / Math.SQRT2;
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-QUAD, -QUAD, QUAD, -QUAD, QUAD, QUAD, -QUAD, QUAD]), gl.STATIC_DRAW);
  var a_position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(a_position);
  gl.vertexAttribPointer(a_position, 2, gl.FLOAT, false, 0, 0);

  var texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(gl.getUniformLocation(program, 'u_texture'), 0);
  /*
   * Unit 0 is this data texture, 1 the tone-mapping pass's colour buffer, 2 the
   * backdrop — which rebinds itself every single frame, so the harmonics take 3.
   * Anything sharing with the backdrop would be quietly replaced by a panorama
   * one frame in, and splats coloured by a photograph of a room is not an error
   * anything would report.
   */
  var shTexture = gl.createTexture();

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
  // How far the camera may travel. Set from the size of the cloud once it has
  // been measured (see initCamera); these hold until then.
  var modelRadius = 1;
  var minDist = 0.05;
  var maxDist = 500;
  var droppedForSize = 0; // splats this card had no room for

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
  // Render at the screen's own pixels — on a 3x phone that's what "sharp" means,
  // and anything less is visibly soft. Above the panel's density there is nothing
  // left to resolve, and 3 is the ceiling for the rare 4x display.
  var MAX_SCALE = Math.min(DPR, 3);
  var MIN_SCALE = IS_MOBILE ? 0.4 : 0.6;

  /*
   * Opening guess only — the measured frame rate takes over within ~a second, so
   * this errs high: start sharp and let a device that can't hold it say so.
   * Only signals that actually say "weak" pull it down. A missing signal isn't
   * one: Safari doesn't implement deviceMemory at all, and scoring that as low
   * memory used to open every iPhone at less than half its panel resolution.
   */
  function startingScale() {
    var cores = navigator.hardwareConcurrency || 0; // absent on some browsers
    var mem = navigator.deviceMemory || 0; // Chromium only
    var weak = (cores > 0 && cores <= 4) || (mem > 0 && mem <= 3);
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, MAX_SCALE * (weak ? 0.7 : 1)));
  }

  /*
   * There are two qualities, not one. A still camera gets the best the screen
   * can show — full pixel density, every splat — because a still frame is
   * allowed to take as long as it likes; nobody can tell whether a picture that
   * isn't changing took 8ms or 300ms to draw. Only while you're actually moving
   * the camera does the frame rate matter, and only that moving resolution is
   * what the measurements below adapt.
   */
  var renderScale = startingScale(); // device pixels per CSS pixel, while moving
  var scaleCeiling = MAX_SCALE; // ratchets down past a moving resolution that proved too slow
  var atRest = true; // still long enough to be worth the full-quality render
  var REST_MS = 260; // how long the camera has to hold still before it sharpens
  var idleTimer = null;
  var movedSinceSample = false; // was the camera actually moving during this window?

  // Keep the drawing buffer inside a sane budget however dense the screen is:
  // past this the half-float target costs more memory than it is worth, and some
  // GPUs refuse the allocation outright.
  var MAX_PIXELS = 8e6;

  /*
   * Drawing is on demand. While the camera moves every frame is drawn; at rest
   * the picture only changes when something says so, and redrawing an identical
   * — and deliberately expensive — frame sixty times a second would cook the
   * phone for nothing. Anything that changes what's on screen calls invalidate().
   */
  var pendingDraws = 1;
  var lastDrawAt = 0;
  var REST_HEARTBEAT_MS = 2000; // safety net: repaint occasionally even at rest
  function invalidate() {
    pendingDraws = 1;
  }

  // Splat budget: how many of the (importance-ordered) splats we draw. Every
  // splat is drawn until the frame rate says otherwise — the tail of that order
  // is the small, faint splats that fill the gaps between the big ones, so
  // holding any back is what makes a capture look see-through.
  var MIN_SPLATS = 150000;
  var totalSplats = 0;
  var renderCount = 0;

  // Never thin the cloud past this, however slow the device: below roughly
  // two-thirds the gaps start to show, and a soft image beats a transparent one.
  function splatFloor() {
    return Math.max(Math.min(totalSplats, MIN_SPLATS), Math.round(totalSplats * 0.65));
  }

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
    // Full density at rest, the adapted moving resolution while the camera moves.
    var dpr = atRest ? MAX_SCALE : renderScale;
    dpr = Math.min(dpr, Math.max(MIN_SCALE, Math.sqrt(MAX_PIXELS / Math.max(1, W * H))));
    canvas.width = Math.max(1, Math.round(W * dpr));
    canvas.height = Math.max(1, Math.round(H * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    focalY = (0.5 * H) / Math.tan(FOV_Y / 2);
    focalX = focalY;
    projectionMatrix = getProjectionMatrix(focalX, focalY, W, H);
    gl.uniform2fv(u_focal, new Float32Array([focalX, focalY]));
    gl.uniform2fv(u_viewport, new Float32Array([W, H]));
    gl.uniformMatrix4fv(u_projection, false, new Float32Array(projectionMatrix));
    invalidate();
  }
  window.addEventListener('resize', resize);
  resize();

  // Touching the camera drops to the moving resolution; letting go for a moment
  // brings back full density and the whole cloud.
  function markInteracting() {
    movedSinceSample = true;
    invalidate();
    if (atRest) {
      atRest = false;
      resize();
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(settleToRest, REST_MS);
  }

  function settleToRest() {
    if (atRest) return;
    atRest = true;
    if (renderCount < totalSplats) {
      renderCount = totalSplats; // whatever was held back, the still frame gets it
      lastPosted = ''; // re-sort at the full count
    }
    resize();
    invalidate();
    showQuality();
  }

  /*
   * Frame-rate feedback for the moving resolution, sampled over ~0.7s windows.
   * Only windows in which the camera actually moved are judged: a still frame is
   * deliberately expensive now, and nothing this loop can change would make it
   * cheaper without giving up the quality it exists to provide.
   *
   * Fidelity first — quality is only given up below SLOW_FPS, and resolution
   * goes before the splat count, which is never thinned past its floor. What
   * keeps this from hunting is the rule that a resolution which measured slow is
   * never climbed back into: every failed attempt at the ceiling lowers it, so
   * the loop can only converge. That ratchet is deliberately tied to being *at*
   * the ceiling rather than to the size of the correction — on a device whose
   * cost is dominated by the per-splat work rather than fill rate, every
   * correction is large, and keying off that meant the ceiling never engaged and
   * the loop cut and climbed forever.
   */
  var SLOW_FPS = 27;
  var FAST_FPS = 34;
  var TARGET_FPS = 31; // aimed between the two, so one correction lands in the band
  var fpsFrames = 0;
  var fpsSince = 0;
  var lastFps = 0;

  /*
   * The scale that should land near TARGET_FPS. Fill cost goes with the square
   * of the render scale, so the measured frame rate says directly how far off we
   * are — one informed correction instead of a series of blind steps, which is
   * the difference between a moment of adjustment on load and several seconds of
   * it. Clamped, because if the bottleneck isn't fill rate the estimate is wrong.
   */
  function seekScale(fps) {
    return renderScale * Math.min(1.3, Math.max(0.7, Math.sqrt(fps / TARGET_FPS)));
  }

  function setScale(next) {
    next = Math.max(MIN_SCALE, Math.min(scaleCeiling, next));
    if (Math.abs(next - renderScale) < 0.02) return false;
    renderScale = next;
    resize();
    return true;
  }

  /*
   * A real frame rate is noisy — thermal throttling, other apps, the compositor,
   * and the scene itself getting cheaper or dearer as the camera moves. Acting on
   * a single window means every stray reading moves the quality, which reads as
   * the picture endlessly churning without ever getting better. So a change needs
   * two windows in a row agreeing, and after one is made the next window is
   * skipped: the resize itself costs frames, and judging that would be judging
   * the correction rather than the result.
   */
  var slowRun = 0;
  var fastRun = 0;
  var cooldown = 0;

  function adapt(fps) {
    if (!textureReady || !drawCount) return; // nothing drawn yet — don't judge
    if (cooldown > 0) {
      cooldown--;
      slowRun = 0;
      fastRun = 0;
      return;
    }
    if (fps < SLOW_FPS) {
      fastRun = 0;
      if (++slowRun < 2) return;
    } else if (fps >= FAST_FPS) {
      slowRun = 0;
      if (++fastRun < 2) return;
    } else {
      slowRun = 0; // comfortably in the band — leave it alone
      fastRun = 0;
      return;
    }
    slowRun = 0;
    fastRun = 0;
    cooldown = 1;

    if (fps < SLOW_FPS) {
      // Slow while already at the ceiling means the ceiling itself is too high;
      // slow well below it is a passing hiccup and proves nothing about it.
      if (renderScale > scaleCeiling * 0.9) scaleCeiling = Math.max(MIN_SCALE, renderScale * 0.95);
      if (!setScale(seekScale(fps)) && renderCount > splatFloor()) {
        renderCount = Math.max(splatFloor(), Math.round(renderCount * 0.85));
        lastPosted = ''; // force a re-sort at the new budget
      }
    } else if (fps >= FAST_FPS) {
      // Headroom: fill the cloud back in first, since that's the visible loss.
      if (renderCount < totalSplats) {
        renderCount = Math.min(totalSplats, Math.round(renderCount * 1.4) + 100000);
        lastPosted = '';
      } else {
        setScale(seekScale(fps));
      }
    }
  }

  // Owner-only readout of where the two qualities currently sit.
  function showQuality() {
    if (!qualityEl) return;
    var splats =
      (renderCount >= 1e6 ? (renderCount / 1e6).toFixed(1) + 'M' : Math.round(renderCount / 1000) + 'k') +
      (renderCount < totalSplats ? ' of ' + (totalSplats / 1e6).toFixed(1) + 'M' : '');
    // Whether this file brought harmonics is worth seeing: it is the difference
    // between a capture that changes as you move around it and one that cannot,
    // and nothing else on screen would tell you which you are looking at.
    var sh = hasSh ? ' · view-dependent' : ' · flat colour';
    /*
     * Where the camera is, against how big the capture is. A camera closer than
     * the cloud is a camera inside it, which is what turns orbiting into looking
     * around — and being pinned against either limit is what makes zooming feel
     * like it has stopped working. Both are invisible without a number.
     */
    var round = function (v) { return v >= 100 ? Math.round(v) : +v.toFixed(2); };
    var cut = droppedForSize
      ? ' · ' + Math.round(droppedForSize / 1000) + 'k dropped — this card\'s texture limit'
      : '';
    var cam = cut + ' · ' + round(dist) + ' from a cloud of ' + round(modelRadius)
      + (dist <= minDist * 1.001 ? ' (as close as it goes)' : '')
      + (dist >= maxDist * 0.999 ? ' (as far as it goes)' : '');
    qualityEl.textContent = (atRest
      ? 'at rest: ' + MAX_SCALE + '× · ' + splats + ' splats' + sh
      : 'moving: ' + renderScale.toFixed(2) + '× of ' + MAX_SCALE + '× · ' + Math.round(lastFps) + ' fps · ' + splats + ' splats' + sh) + cam;
    qualityEl.hidden = false;
  }

  function sampleFps(now) {
    // Only moving windows are measured; a still frame is meant to be expensive.
    if (atRest) {
      fpsSince = 0;
      fpsFrames = 0;
      return;
    }
    if (!fpsSince) {
      fpsSince = now;
      fpsFrames = 0;
      movedSinceSample = false;
      return;
    }
    fpsFrames++;
    var elapsed = now - fpsSince;
    if (elapsed < 700) return;
    var moved = movedSinceSample;
    lastFps = (fpsFrames * 1000) / elapsed;
    fpsFrames = 0;
    fpsSince = now;
    movedSinceSample = false;
    if (moved) {
      adapt(lastFps);
      showQuality();
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
      // Every device starts with the whole cloud; only a measured stall thins it.
      totalSplats = d.vertexCount;
      renderCount = totalSplats;
      // ...or the card's own ceiling, which is a property of the device rather
      // than of the moment, so it is worth saying rather than leaving to be
      // guessed at from a capture that looks thinner here than elsewhere.
      droppedForSize = d.dropped || 0;
      initCamera(d.bounds);
    }
    if (d.texdata) uploadTexture(d);
    if (d.depthIndex) {
      gl.bindBuffer(gl.ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, d.depthIndex, gl.DYNAMIC_DRAW);
      drawCount = d.vertexCount;
      if (drawCount > 0) hideLoading();
    }
    invalidate(); // new geometry, order or camera to show
  };
  worker.onerror = function () {
    fail('The splat viewer background worker failed to start.');
  };

  function initCamera(b) {
    /*
     * How far the camera may go, in the units this capture happens to be in.
     * They were fixed numbers — never nearer than 0.05, never further than 500 —
     * which is a silent assumption that every capture is a few units across. A
     * capture whose coordinates are metres of a landscape is thousands, and 500
     * away from something thousands wide is inside it: the camera cannot get out
     * far enough to orbit, so dragging turns on the spot like looking around a
     * room, and the whole of the zoom is spent within the object.
     *
     * Tied to the size of the actual cloud, both ends move with it. The old
     * numbers stay as the outer bounds so that nothing that worked before is
     * given less room than it had — this only ever adds range where a capture
     * needed it.
     */
    modelRadius = b.radius > 0 ? b.radius : 1;
    minDist = Math.max(1e-4, Math.min(0.05, modelRadius * 0.02));
    maxDist = Math.max(500, modelRadius * 40);

    if (DEFAULT_VIEW) {
      // The owner picked where this splat opens; Reset returns here too.
      target = DEFAULT_VIEW.t.slice();
      // Through the same limits: a view saved while the camera was stuck at an
      // old ceiling should not put every visitor back there.
      dist = Math.max(minDist, Math.min(maxDist, DEFAULT_VIEW.d));
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
    /*
     * A refused texture is the quietest failure this viewer has: the call
     * returns, the texture stays empty, every splat reads zeroes, and the screen
     * is black with nothing in the console. So ask, and say so.
     */
    var texErr = gl.getError();
    if (texErr !== gl.NO_ERROR) {
      fail('This capture is larger than this device can hold (the graphics card refused a '
        + d.texwidth + '×' + d.texheight + ' texture). It should open on a desktop browser.');
      return;
    }
    textureReady = true;
    gl.useProgram(program);
    gl.uniform1f(u_hdrOn, d.hdr ? 1 : 0);

    /*
     * The harmonics, when the file carried any. Their own texture on its own
     * unit, so a file without them costs nothing and the shader skips the
     * fetches entirely. A byte a coefficient, which is what lets eight of them
     * fit in the room three took as halves.
     */
    if (!d.shdata || !shTexture) return;
    var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (d.shwidth > maxTex || d.shheight > maxTex) return; // no room: stay flat
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, shTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, d.shwidth, d.shheight, 0, gl.RGBA, gl.UNSIGNED_BYTE, d.shdata);
    gl.activeTexture(gl.TEXTURE0);
    gl.useProgram(program);
    gl.uniform1i(u_shTex, 3);
    gl.uniform1f(u_shOn, 1);
    hasSh = true;
    invalidate();
  }

  // ---- render loop ----------------------------------------------------------
  var lastPosted = '';
  function draw() {
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
    // The backdrop goes in last on purpose. Splats composite front-to-back with
    // premultiplied "under" blending, which reads the destination alpha to know
    // how much light still gets through — so anything already in the buffer when
    // they draw would block them entirely. Drawn afterwards with that same
    // blend, the panorama fills exactly the light the splats left unclaimed.
    drawBackdrop(useHdr);
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
      gl.uniform3f(u_postBands, SHADOWS, MIDS, HIGHS);
      gl.uniform1f(u_postGamma, GAMMA);
      gl.bindVertexArray(postVao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.BLEND);
      gl.useProgram(program);
    }
  }

  function frame(now) {
    now = now || performance.now();
    if (!atRest || pendingDraws > 0 || now - lastDrawAt > REST_HEARTBEAT_MS) {
      if (pendingDraws > 0) pendingDraws--;
      lastDrawAt = now;
      draw();
      sampleFps(now);
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
    if (dist < minDist) dist = minDist;
    if (dist > maxDist) dist = maxDist;
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
      invalidate();
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
      invalidate();
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
   * The owner panels all sit in the same corner, so only one can be open at a
   * time. Each registers here and opening one closes the rest — which is the
   * same rule as before, except it now holds in every direction rather than
   * only from the panel that happened to be written last.
   */
  var panels = [];
  function registerPanel(btn, panel) {
    if (!btn || !panel) return;
    panels.push({ btn: btn, panel: panel });
    btn.addEventListener('click', function () {
      var opening = panel.hidden;
      panels.forEach(function (p) {
        p.panel.hidden = true;
        p.btn.classList.remove('is-on');
      });
      panel.hidden = !opening;
      btn.classList.toggle('is-on', opening);
    });
  }

  /*
   * Owner-only splat look: how large the discs a capture is made of are drawn,
   * and how opaque they are. One panel, because they describe the same thing —
   * but a slider each and a save each, because they do not change together.
   *
   * Both are the live-then-save shape of the sliders above: the uniform is set
   * as the slider moves and the value written back once it settles, so what is
   * being judged on screen is exactly what every visitor will get.
   */
  registerPanel(document.getElementById('splatLookBtn'), document.getElementById('splatLookPanel'));

  function wireLookSlider(id, endpoint, field, uniform, onValue) {
    var el = document.getElementById(id);
    if (!el) return;
    var out = document.getElementById(id + 'Out');
    var resetEl = document.getElementById(id + 'Reset');
    var timer = null;
    var read = function () {
      var v = parseFloat(el.value) || 1;
      onValue(v);
      if (out) out.textContent = v.toFixed(2) + '×';
      gl.useProgram(program);
      gl.uniform1f(uniform, v);
      invalidate();
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () {
        fetch('/admin/splats/' + encodeURIComponent(SPLAT_ID) + '/' + endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: field + '=' + encodeURIComponent(v),
          credentials: 'same-origin',
        }).catch(function () {});
      }, 500);
    };
    if (out) out.textContent = (parseFloat(el.value) || 1).toFixed(2) + '×';
    el.addEventListener('input', read);
    if (resetEl) {
      resetEl.addEventListener('click', function () {
        el.value = 1;
        read();
      });
    }
  }

  wireLookSlider('splatSize', 'splat-scale', 'splat_scale', u_splatScale, function (v) { SPLAT_SCALE = v; });
  wireLookSlider('splatOpacity', 'splat-alpha', 'splat_alpha', u_splatAlpha, function (v) { SPLAT_ALPHA = v; });

  /*
   * Owner-only grade: white balance and tint, the three tonal bands, and gamma.
   * Same live-then-save shape as the exposure slider — every value is reread on
   * any input event and the whole grade is written back once the sliders settle.
   * One save for the six, because they are one grade: nothing here is judged on
   * its own.
   *
   * The bands and gamma live in the tone-mapping pass, which only runs where the
   * GPU can render to a float buffer. Somewhere without that, the viewer keeps
   * its old single-pass path and these four have nothing to act on — so the
   * panel says so rather than offering sliders that do nothing.
   */
  registerPanel(document.getElementById('splatColourBtn'), document.getElementById('splatColourPanel'));

  var gradeEls = {
    white_balance: document.getElementById('splatWb'),
    tint: document.getElementById('splatTint'),
    shadows: document.getElementById('splatShadows'),
    mids: document.getElementById('splatMids'),
    highs: document.getElementById('splatHighs'),
    gamma: document.getElementById('splatGamma'),
  };
  var toneOnly = document.getElementById('splatToneNote');
  if (toneOnly) toneOnly.hidden = HDR_OK;
  if (gradeEls.white_balance && gradeEls.tint) {
    var gradeTimer = null;
    var neutral = { white_balance: 0, tint: 0, shadows: 0, mids: 0, highs: 0, gamma: 1 };
    var readGrade = function () {
      var body = [];
      Object.keys(gradeEls).forEach(function (key) {
        var el = gradeEls[key];
        if (!el) return;
        var v = parseFloat(el.value);
        if (!isFinite(v)) v = neutral[key];
        var out = document.getElementById(el.id + 'Out');
        if (out) out.textContent = v.toFixed(2);
        if (key === 'white_balance') WB = v;
        else if (key === 'tint') TINT = v;
        else if (key === 'shadows') SHADOWS = v;
        else if (key === 'mids') MIDS = v;
        else if (key === 'highs') HIGHS = v;
        else GAMMA = v;
        body.push(key + '=' + encodeURIComponent(v));
      });
      applyGrade();
      invalidate();
      if (gradeTimer) clearTimeout(gradeTimer);
      gradeTimer = setTimeout(function () {
        fetch('/admin/splats/' + encodeURIComponent(SPLAT_ID) + '/grade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.join('&'),
          credentials: 'same-origin',
        }).catch(function () {});
      }, 500);
    };
    Object.keys(gradeEls).forEach(function (key) {
      if (gradeEls[key]) gradeEls[key].addEventListener('input', readGrade);
    });
    // Shows the values the page was given, without saving them back.
    Object.keys(gradeEls).forEach(function (key) {
      var el = gradeEls[key];
      if (!el) return;
      var out = document.getElementById(el.id + 'Out');
      if (out) out.textContent = (parseFloat(el.value) || neutral[key]).toFixed(2);
    });
    var gradeResetEl = document.getElementById('splatGradeReset');
    if (gradeResetEl) {
      gradeResetEl.addEventListener('click', function () {
        Object.keys(gradeEls).forEach(function (key) {
          if (gradeEls[key]) gradeEls[key].value = neutral[key];
        });
        readGrade();
      });
    }
  }

  /*
   * Owner-only backdrop aim. Same live-then-save shape as the other panels: the
   * rotation is a uniform the next frame reads, so dragging is free, and the
   * value is written back once the slider settles.
   */
  var bgYawEl = document.getElementById('splatBgYaw');
  registerPanel(document.getElementById('splatBackdropBtn'), document.getElementById('splatBackdropPanel'));
  if (bgYawEl) {
    var yawTimer = null;
    var yawOut = document.getElementById('splatBgYawOut');
    var readYaw = function () {
      BG_YAW = parseFloat(bgYawEl.value) || 0;
      if (yawOut) yawOut.textContent = Math.round(BG_YAW * 360) + '°';
      invalidate();
      if (yawTimer) clearTimeout(yawTimer);
      yawTimer = setTimeout(function () {
        fetch('/admin/splats/' + encodeURIComponent(SPLAT_ID) + '/backdrop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'background_yaw=' + encodeURIComponent(BG_YAW),
          credentials: 'same-origin',
        }).catch(function () {});
      }, 500);
    };
    readYaw();
    bgYawEl.addEventListener('input', readYaw);
    var bgResetEl = document.getElementById('splatBgReset');
    if (bgResetEl) {
      bgResetEl.addEventListener('click', function () {
        bgYawEl.value = 0;
        readYaw();
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
    /*
     * How big a texture this card will take goes with the file: the worker packs
     * the cloud into one and only this side can ask. A capture past what the
     * card can hold has to be cut down before it is packed, or the upload is
     * refused and the viewer draws nothing at all.
     */
    var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (FORMAT === 'ply') worker.postMessage({ ply: ab, maxTex: maxTex }, [ab]);
    else if (FORMAT === 'spz') worker.postMessage({ spz: ab, maxTex: maxTex }, [ab]);
    else worker.postMessage({ splat: ab, maxTex: maxTex }, [ab]);
  }

  load().catch(function (e) {
    fail('Could not download the splat file (' + (e && e.message ? e.message : e) + ').');
  });
})();
