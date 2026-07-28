/*
 * 3D geometry viewer — three.js (MIT), served from this site, no CDN.
 *
 * Loads a glTF/GLB with the Draco (geometry) and KTX2/Basis (texture) decoders,
 * lights it with a generated studio environment, and frames it automatically.
 * The owner additionally gets live exposure / environment sliders and a "set
 * default view" button; everyone else just sees the model as the owner left it.
 *
 * Both decoders are WebAssembly, which is why the site's CSP carries
 * 'wasm-unsafe-eval' (WebAssembly only — not JavaScript eval).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const stage = document.getElementById('geoStage');
const canvas = document.getElementById('geoCanvas');
const loadingEl = document.getElementById('geoLoading');
const barEl = document.getElementById('geoBar');
const labelEl = document.getElementById('geoLabel');
const errorEl = document.getElementById('geoError');
const hintEl = document.getElementById('geoHint');
const statsEl = document.getElementById('geoStats');

const SRC = stage.dataset.src;
const MODEL_ID = stage.dataset.id;
const AUTOROTATE = stage.dataset.autorotate === '1';
const BACKGROUND = stage.dataset.background || '';
let exposure = parseFloat(stage.dataset.exposure) || 1;
let envIntensity = stage.dataset.env === '' ? 1 : parseFloat(stage.dataset.env);
if (!isFinite(envIntensity)) envIntensity = 1;

const DEFAULT_VIEW = (() => {
  try {
    const v = JSON.parse(stage.dataset.view || '');
    return v && Array.isArray(v.t) && v.t.length === 3 ? v : null;
  } catch (e) {
    return null;
  }
})();

function fail(msg) {
  if (loadingEl) loadingEl.style.display = 'none';
  if (errorEl) {
    errorEl.textContent = msg;
    errorEl.hidden = false;
  }
}

// ---- renderer ---------------------------------------------------------------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: !BACKGROUND, powerPreference: 'high-performance' });
} catch (e) {
  fail('This 3D viewer needs WebGL, which your browser does not seem to support.');
  throw e;
}
// Mobile GPUs are fill-rate bound, so cap the pixel ratio harder there.
const IS_MOBILE = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const MAX_DPR = IS_MOBILE ? 1.5 : 2;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_DPR));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = exposure;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
if (BACKGROUND) scene.background = new THREE.Color(BACKGROUND);

const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.rotateSpeed = 0.9;
controls.panSpeed = 0.8;
controls.autoRotate = AUTOROTATE;
controls.autoRotateSpeed = 0.8;
controls.addEventListener('start', () => {
  controls.autoRotate = false; // any interaction stops the turntable for good
  dismissHint();
});

// ---- environment lighting ---------------------------------------------------
// A generated soft-box "room" — good PBR reflections without shipping an HDRI.
const pmrem = new THREE.PMREMGenerator(renderer);
let envMap = null;
try {
  envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envMap;
  scene.environmentIntensity = envIntensity;
} catch (e) {
  // Extremely old hardware: fall back to plain lights so something still shows.
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 2));
  const key = new THREE.DirectionalLight(0xffffff, 2);
  key.position.set(3, 6, 4);
  scene.add(key);
}

// ---- loaders ----------------------------------------------------------------
// WebAssembly decoders are the default in current three.js — no explicit config
// (setDecoderConfig is deprecated), just the self-hosted paths.
const draco = new DRACOLoader().setDecoderPath('/vendor/three/examples/jsm/libs/draco/');
const ktx2 = new KTX2Loader().setTranscoderPath('/vendor/three/examples/jsm/libs/basis/').detectSupport(renderer);

const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);

// ---- camera framing ---------------------------------------------------------
let target = new THREE.Vector3();
let initialView = null;
let autoView = null;

function applyView(v) {
  target.set(v.t[0], v.t[1], v.t[2]);
  const cp = Math.cos(v.p);
  camera.position.set(
    target.x + v.d * cp * Math.sin(v.y),
    target.y + v.d * Math.sin(v.p),
    target.z + v.d * cp * Math.cos(v.y)
  );
  controls.target.copy(target);
  camera.near = Math.max(v.d / 1000, 0.001);
  camera.far = Math.max(v.d * 100, 100);
  camera.updateProjectionMatrix();
  controls.update();
}

function currentView() {
  const off = camera.position.clone().sub(controls.target);
  const d = off.length() || 1;
  return {
    t: [controls.target.x, controls.target.y, controls.target.z],
    d,
    y: Math.atan2(off.x, off.z),
    p: Math.asin(Math.min(1, Math.max(-1, off.y / d))),
  };
}

// Frame the model: centre it and back off far enough for its bounding sphere.
function frameObject(object) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return { t: [0, 0, 0], d: 3, y: 0.7, p: 0.35 };
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fov = (camera.fov * Math.PI) / 180;
  const dist = (sphere.radius / Math.sin(fov / 2)) * 1.25;
  return { t: [sphere.center.x, sphere.center.y, sphere.center.z], d: dist || 3, y: 0.7, p: 0.35 };
}

// ---- resize -----------------------------------------------------------------
function resize() {
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / Math.max(1, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ---- render loop ------------------------------------------------------------
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

// ---- load -------------------------------------------------------------------
let root = null;
let wireframeOn = false;

function hideLoading() {
  if (loadingEl && !loadingEl.classList.contains('gone')) {
    loadingEl.classList.add('gone');
    if (hintEl) {
      hintEl.classList.remove('gone');
      hintTimer = setTimeout(dismissHint, 4500);
    }
  }
}

let hintTimer = null;
function dismissHint() {
  if (hintEl) hintEl.classList.add('gone');
  if (hintTimer) {
    clearTimeout(hintTimer);
    hintTimer = null;
  }
}

if (!SRC) {
  fail('This entry has no model file attached.');
} else {
  loader.load(
    SRC,
    (gltf) => {
      root = gltf.scene || gltf.scenes[0];
      scene.add(root);

      autoView = frameObject(root);
      applyView(DEFAULT_VIEW || autoView);
      initialView = DEFAULT_VIEW || autoView;

      // A quick count, so the owner can sanity-check what was exported.
      let tris = 0;
      let meshes = 0;
      root.traverse((o) => {
        if (o.isMesh && o.geometry) {
          meshes++;
          const g = o.geometry;
          tris += g.index ? g.index.count / 3 : (g.attributes.position ? g.attributes.position.count / 3 : 0);
        }
      });
      if (statsEl) {
        statsEl.textContent = meshes + (meshes === 1 ? ' mesh · ' : ' meshes · ') + Math.round(tris).toLocaleString() + ' triangles';
        statsEl.hidden = false;
      }

      hideLoading();
    },
    (ev) => {
      if (ev && ev.total) {
        const pct = Math.min(100, (ev.loaded / ev.total) * 100);
        if (barEl) barEl.style.width = pct.toFixed(1) + '%';
        if (labelEl) labelEl.textContent = 'Loading ' + Math.round(pct) + '%';
      } else if (labelEl && ev && ev.loaded) {
        labelEl.textContent = 'Loading ' + (ev.loaded / 1048576).toFixed(1) + ' MB';
      }
    },
    (err) => {
      fail('Could not load this model (' + ((err && err.message) || 'unknown error') + ').');
    }
  );
}

// ---- toolbar ----------------------------------------------------------------
const resetBtn = document.getElementById('geoReset');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    if (initialView) applyView(initialView);
  });
}

const fullBtn = document.getElementById('geoFull');
if (fullBtn) {
  fullBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.requestFullscreen) stage.requestFullscreen();
    else if (stage.webkitRequestFullscreen) stage.webkitRequestFullscreen();
    setTimeout(resize, 100);
  });
}
document.addEventListener('fullscreenchange', () => setTimeout(resize, 60));

const wireBtn = document.getElementById('geoWire');
if (wireBtn) {
  wireBtn.addEventListener('click', () => {
    if (!root) return;
    wireframeOn = !wireframeOn;
    root.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => {
        if (m && 'wireframe' in m) m.wireframe = wireframeOn;
      });
    });
    wireBtn.classList.toggle('is-on', wireframeOn);
  });
}

// ---- owner-only controls ----------------------------------------------------
function post(path, body) {
  return fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    credentials: 'same-origin',
  });
}

let lookTimer = null;
function saveLook() {
  if (lookTimer) clearTimeout(lookTimer);
  lookTimer = setTimeout(() => {
    post('/admin/geometry/' + encodeURIComponent(MODEL_ID) + '/look', 'exposure=' + exposure + '&env_intensity=' + envIntensity).catch(() => {});
  }, 500);
}

const expEl = document.getElementById('geoExposure');
if (expEl) {
  expEl.addEventListener('input', () => {
    exposure = parseFloat(expEl.value) || 1;
    renderer.toneMappingExposure = exposure;
    saveLook();
  });
}

const envEl = document.getElementById('geoEnv');
if (envEl) {
  envEl.addEventListener('input', () => {
    envIntensity = parseFloat(envEl.value);
    if (!isFinite(envIntensity)) envIntensity = 1;
    scene.environmentIntensity = envIntensity;
    saveLook();
  });
}

function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = old;
    btn.disabled = false;
  }, 1400);
}

const setViewBtn = document.getElementById('geoSetView');
const clearViewBtn = document.getElementById('geoClearView');
if (setViewBtn) {
  setViewBtn.addEventListener('click', () => {
    const v = currentView();
    initialView = v;
    post(
      '/admin/geometry/' + encodeURIComponent(MODEL_ID) + '/view',
      'tx=' + v.t[0] + '&ty=' + v.t[1] + '&tz=' + v.t[2] + '&dist=' + v.d + '&yaw=' + v.y + '&pitch=' + v.p
    )
      .then((r) => flash(setViewBtn, r.ok ? 'Saved ✓' : 'Failed'))
      .catch(() => flash(setViewBtn, 'Failed'));
    if (clearViewBtn) clearViewBtn.hidden = false;
  });
}
if (clearViewBtn) {
  clearViewBtn.addEventListener('click', () => {
    if (autoView) initialView = autoView;
    post('/admin/geometry/' + encodeURIComponent(MODEL_ID) + '/view', 'clear=1')
      .then((r) => flash(clearViewBtn, r.ok ? 'Cleared ✓' : 'Failed'))
      .catch(() => flash(clearViewBtn, 'Failed'));
  });
}
