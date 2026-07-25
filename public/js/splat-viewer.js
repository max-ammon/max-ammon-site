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

  var canvas = document.getElementById('splatCanvas');
  var stage = document.getElementById('splatStage');
  var loadingEl = document.getElementById('splatLoading');
  var barEl = document.getElementById('splatBar');
  var labelEl = document.getElementById('splatLabel');
  var errorEl = document.getElementById('splatError');
  var hintEl = document.getElementById('splatHint');
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

  var fsSource =
    '#version 300 es\n' +
    'precision highp float;\n' +
    'in vec4 vColor;\n' +
    'in vec2 vPosition;\n' +
    'out vec4 fragColor;\n' +
    'void main () {\n' +
    '    float A = -dot(vPosition, vPosition);\n' +
    '    if (A < -4.0) discard;\n' +
    '    float B = exp(A) * vColor.a;\n' +
    '    fragColor = vec4(B * vColor.rgb, B);\n' +
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

  var u_projection = gl.getUniformLocation(program, 'projection');
  var u_viewport = gl.getUniformLocation(program, 'viewport');
  var u_focal = gl.getUniformLocation(program, 'focal');
  var u_view = gl.getUniformLocation(program, 'view');

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
  var haveData = false;

  // Mobile GPUs are fill-rate bound on the heavy blended overdraw splats produce,
  // so render at a lower internal resolution: capped harder on mobile, and dropped
  // further while the user is actively orbiting/zooming (restored to full shortly
  // after they stop). This is the main performance lever for phones.
  var IS_MOBILE = false;
  try {
    IS_MOBILE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  } catch (e) {}
  var MAX_DPR = IS_MOBILE ? 1.25 : 1.75;
  var MOVE_SCALE = IS_MOBILE ? 0.55 : 0.85;
  // On phones, also cap how many splats are drawn — only the most visually
  // significant ones — which is the heaviest lever for large captures. Desktop
  // renders everything (renderCount is set to the full count once it's known).
  var MOBILE_MAX_SPLATS = 700000;
  var renderCount = 0;
  var activeScale = 1;
  var idleTimer = null;

  var focalX = 1000;
  var focalY = 1000;
  var projectionMatrix = getProjectionMatrix(focalX, focalY, 1, 1);

  function stageSize() {
    return [stage.clientWidth || window.innerWidth, stage.clientHeight || window.innerHeight];
  }
  function resize() {
    var s = stageSize();
    var W = s[0];
    var H = s[1];
    var dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR) * activeScale;
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

  // Drop to a lower render resolution while the camera is moving, then restore
  // full resolution ~0.2s after the last input — smooth while dragging, crisp at rest.
  function markInteracting() {
    if (activeScale === 1) {
      activeScale = MOVE_SCALE;
      resize();
    }
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(function () {
      activeScale = 1;
      resize();
    }, 220);
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
      renderCount = IS_MOBILE ? Math.min(d.vertexCount, MOBILE_MAX_SPLATS) : d.vertexCount;
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
    target = b.center.slice();
    dist = Math.max(b.radius * 2.6, 0.5);
    yaw = 0;
    pitch = START_PITCH;
    initial = { target: target.slice(), dist: dist, yaw: yaw, pitch: pitch };
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
  function frame() {
    if (haveData) {
      var view = currentView();
      var key = view.join(',');
      if (key !== lastPosted) {
        worker.postMessage({ view: multiply4(projectionMatrix, view), count: renderCount });
        lastPosted = key;
      }
      gl.uniformMatrix4fv(u_view, false, new Float32Array(view));
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (textureReady && drawCount > 0) {
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, 4, drawCount);
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
