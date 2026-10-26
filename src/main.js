import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/inter';
import './style.css';

import { FloatType, HalfFloatType, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { createCube } from './cube.js';
import { GradeShader } from './grade.js';
import { createSimulation } from './simulation.js';
import { pulseAt, readHash, spinRate, writeHash } from './settings.js';
import { createSmoke } from './smoke.js';
import { createUI } from './ui.js';
import { createView } from './view.js';
import { formatSize, recordVideo, saveImage } from './capture.js';

const canvas = document.querySelector('canvas');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;

let renderer;
try {
  renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch {
  document.body.classList.add('no-webgl');
  throw new Error('WebGL 2 is not available.');
}
renderer.autoClear = false;
// Accumulate light in full floats where the GPU can blend into them (see smoke.js).
const accumulate = renderer.extensions.has('EXT_color_buffer_float') && renderer.extensions.has('EXT_float_blend') ? FloatType : HalfFloatType;

// ---- State ---------------------------------------------------------------------------------

const state = readHash();
// Phones start light. Computers start at a million grains and step down if they can't keep up.
state.particles = coarse ? 256 : 1024;
let qualityCheck = coarse ? null : { frames: 0, time: 0 };
if (reducedMotion && !location.hash.includes('spin=')) state.spin = 0;

// The shaders read eased copies of the sliders, so every change glides instead of jumping.
const live = { ...state };
const eased = ['flow', 'turbulence', 'spread', 'gather', 'pulse', 'escape', 'brightness', 'shadows', 'glow', 'film', 'grain', 'blur', 'focus', 'spin'];

// ---- Scene ---------------------------------------------------------------------------------

const scene = new Scene();
const view = createView(canvas);
view.setLens(state.lens);
const cube = createCube();

let simulation;
let smoke;
// The clip's clock: zero when the original look starts, so its pulse lands on the clip's beats.
let clock = 0;
function simStep(dt, withStir = true) {
  simulation.step(dt, live, state.source, withStir ? stir : null, live.pulse * pulseAt(clock));
  clock += dt;
}
function build(size) {
  simulation?.dispose();
  if (smoke) {
    scene.remove(smoke.object);
    smoke.dispose();
  }
  simulation = createSimulation(renderer, size);
  smoke = createSmoke(size, accumulate);
  scene.add(smoke.object);
  // Let the smoke settle before anyone sees it.
  const settle = clock;
  for (let i = 0; i < 90; i++) simStep(1 / 45, false);
  clock = settle;
}
build(state.particles);

// ---- Post ----------------------------------------------------------------------------------

const composer = new EffectComposer(renderer, new WebGLRenderTarget(1, 1, { type: accumulate }));
const renderPass = new RenderPass(scene, view.camera);
composer.addPass(renderPass);
// A low threshold on purpose: the glow gives the grains a soft body of smoke around them.
const bloom = new UnrealBloomPass(new Vector2(256, 256), 0.4, 0.45, 0.08);
composer.addPass(bloom);
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);

// The cube's edges are drawn after the grade, so they stay crisp and never bloom.
const edgeScene = new Scene();
edgeScene.add(cube.object);

// ---- Output --------------------------------------------------------------------------------

// What the renderer draws into: the screen, or for a moment an export size.
const output = { width: 0, height: 0, ratio: 1, offsetX: 0, offsetY: 0 };
// The cube sits in the middle of the space the panel leaves free.
const pan = { x: 0, y: 0, targetX: 0, targetY: 0 };
let exporting = false;

function applyOutput() {
  renderer.setPixelRatio(output.ratio);
  renderer.setSize(output.width, output.height, false);
  composer.setPixelRatio(output.ratio);
  composer.setSize(output.width, output.height);
  applyFrame();
}

function applyFrame() {
  const pixelsHigh = output.height * output.ratio;
  // Edges are 2.8 px on a 1280 px frame with the flat lens (the reference's weight), 1.4 px with depth.
  const lineWidth = ((view.lens === 'flat' ? 2.8 : 1.4) * pixelsHigh) / 1280;
  cube.setOutput(output.width * output.ratio, pixelsHigh, Math.max(1, lineWidth));
  view.frame(output.width, output.height, output.offsetX, output.offsetY);
  grade.uniforms.uAspect.value = output.width / output.height;
  grade.uniforms.uCenter.value = [0.5 - output.offsetX / output.width, 0.5 + output.offsetY / output.height];
}

function fitScreen() {
  // A page opened in a background tab can start with no size; wait for a real one.
  if (!innerWidth || !innerHeight || exporting) return;
  Object.assign(output, { width: innerWidth, height: innerHeight, ratio: Math.min(devicePixelRatio, 2), offsetX: pan.x, offsetY: pan.y });
  app.layoutChanged();
  applyOutput();
}

// ---- Stir: hovering moves the smoke -------------------------------------------------------

const pointer = { x: 0, y: 0, inside: false };
const raycaster = new Raycaster();
const facing = new Plane();
const hit = new Vector3();
const lastHit = new Vector3();
const stir = { origin: new Vector3(), direction: new Vector3(), velocity: new Vector3() };
let hasLastHit = false;

canvas.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  pointer.inside = e.pointerType === 'mouse';
});
canvas.addEventListener('pointerleave', () => { pointer.inside = false; hasLastHit = false; });

function updateStir(dt) {
  const active = pointer.inside && !view.dragging && !exporting && dt > 0;
  if (active) {
    const camera = view.camera;
    raycaster.setFromCamera(new Vector2(pointer.x, pointer.y), camera);
    facing.setFromNormalAndCoplanarPoint(camera.getWorldDirection(hit).negate(), new Vector3());
    if (raycaster.ray.intersectPlane(facing, hit)) {
      if (hasLastHit) {
        const v = hit.clone().sub(lastHit).divideScalar(dt).clampLength(0, 6);
        stir.velocity.lerp(v.multiplyScalar(0.9), 1 - Math.exp(-dt * 18));
      }
      lastHit.copy(hit);
      hasLastHit = true;
    }
    stir.origin.copy(raycaster.ray.origin);
    stir.direction.copy(raycaster.ray.direction);
  } else {
    hasLastHit = hasLastHit && !view.dragging;
  }
  if (!active || !hasLastHit) stir.velocity.multiplyScalar(Math.exp(-dt * 6));
}

// ---- Render ----------------------------------------------------------------------------------

let paused = false;
let time = 0;
let rendered = false;

function render(dt) {
  const camera = view.camera;
  renderPass.camera = camera;
  smoke.update(simulation, live, output.height * output.ratio, camera);
  smoke.renderShadow(renderer);

  bloom.strength = live.glow * 0.85;
  // Linear up to 0.6, then steeper: the original look (0.85) needs about four times the light.
  grade.uniforms.uExposure.value = 0.35 + live.brightness * 1.9 + 56.24 * Math.max(live.brightness - 0.6, 0) ** 2;
  grade.uniforms.uFilm.value = live.film;
  grade.uniforms.uLift.value = Math.min(1, live.glow * 4);
  grade.uniforms.uTime.value = time;

  cube.update(state.edges, view.lens === 'flat' ? 1 : 0.5, camera, exporting || !rendered ? Infinity : dt);
  rendered = true;
  renderer.setClearColor(0x000000, 1);
  composer.render(dt);
  renderer.setRenderTarget(null);
  renderer.render(edgeScene, camera);
}

let last = performance.now();
function tick(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  if (!exporting && (innerWidth !== output.width || innerHeight !== output.height)) fitScreen();
  if (!output.width || !output.height) return requestAnimationFrame(tick);
  time += dt;

  const k = 1 - Math.exp(-dt * 10);
  for (const key of eased) live[key] += (state[key] - live[key]) * k;

  if (!exporting) {
    const panK = 1 - Math.exp(-dt * 9);
    pan.x += (pan.targetX - pan.x) * panK;
    pan.y += (pan.targetY - pan.y) * panK;
    if (Math.abs(pan.x - output.offsetX) + Math.abs(pan.y - output.offsetY) > 0.01) {
      output.offsetX = pan.x;
      output.offsetY = pan.y;
      applyFrame();
    }
  }

  view.update(dt, paused ? 0 : spinRate(live.spin));
  updateStir(dt);

  if (!paused) simStep(dt);
  render(dt);
  checkQuality(dt);
  requestAnimationFrame(tick);
}

// Over the first two seconds, a computer that stays under 45 fps drops to 262k grains.
function checkQuality(dt) {
  if (!qualityCheck || document.hidden) return;
  qualityCheck.frames++;
  if (qualityCheck.frames < 20) return;
  qualityCheck.time += dt;
  if (qualityCheck.time < 2) return;
  const fps = (qualityCheck.frames - 20) / qualityCheck.time;
  qualityCheck = null;
  if (fps < 45 && state.particles === 1024) {
    app.set('particles', 512);
    ui.sync();
  }
}

// ---- Capture -------------------------------------------------------------------------------

// Draw into a size of its own (an export), centred on the cube, then go back to the screen.
async function atSize(width, height, ratio, task) {
  exporting = true;
  Object.assign(output, { width, height, ratio, offsetX: 0, offsetY: 0 });
  applyOutput();
  try {
    return await task();
  } finally {
    exporting = false;
    fitScreen();
  }
}

const app = {
  state,
  set(key, value) {
    if (state[key] === value) return;
    state[key] = value;
    if (key === 'particles') {
      qualityCheck = null;
      build(value);
    }
    if (key === 'lens') {
      view.setLens(value);
      applyFrame();
    }
    if (key === 'format') ui.showFormat(value);
    writeHash(state);
  },
  apply(values, look) {
    for (const [key, value] of Object.entries(values)) if (key !== 'particles' && key !== 'format') state[key] = value;
    view.setLens(state.lens);
    applyFrame();
    // The original look starts the camera where the reference clip starts.
    if (look === 'original') {
      view.original();
      clock = 0;
    }
    writeHash(state);
  },
  get paused() { return paused; },
  togglePause() { paused = !paused; return paused; },
  recording: null,
  layoutChanged() {
    const reserve = app.recording ? { x: 0, y: 0 } : ui.reserve();
    pan.targetX = reserve.x / 2;
    pan.targetY = reserve.y / 2;
  },
  saveImage() {
    const size = formatSize(state.format, 'image', innerWidth, innerHeight);
    return atSize(size.width, size.height, 1, () => saveImage({ canvas, render, ...size }));
  },
  async recordVideo(onProgress) {
    const size = formatSize(state.format, 'video', innerWidth, innerHeight);
    app.recording = { canvas, onProgress, seconds: 8, cancelled: false };
    app.layoutChanged();
    document.body.classList.add('recording-frame');
    try {
      return await atSize(size.width, size.height, 1, () => recordVideo(app.recording));
    } finally {
      document.body.classList.remove('recording-frame');
      app.recording = null;
      app.layoutChanged();
    }
  },
  stopRecording() {
    if (app.recording) app.recording.cancelled = true;
  },
};

const ui = createUI(app);
ui.showFormat(state.format);

if (import.meta.env.DEV) {
  window.pureSmoke = {
    renderer, view, state, live, stir, app,
    get simulation() { return simulation; },
    // Draw frame n of the original timing at width × height and hand back a PNG blob.
    async frame(n, width = 720, height = 1280, fps = 30) {
      paused = true;
      return atSize(width, height, 1, () => {
        view.atOriginalTime(n / fps);
        view.update(0, 0);
        render(0);
        return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      });
    },
    resume() { paused = false; },
    step(seconds) { for (let t = 0; t < seconds - 1e-6; t += 1 / 30) simStep(1 / 30, false); },
    setClock(t) { clock = t; },
    // Milliseconds per frame (simulation + drawing) at the current screen size, synced with a pixel read.
    bench(n = 30) {
      const gl = renderer.getContext();
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const t0 = performance.now();
      for (let i = 0; i < n; i++) { simStep(1 / 60, false); render(1 / 60); }
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return +((performance.now() - t0) / n).toFixed(2);
    },
  };
}

fitScreen();
pan.x = pan.targetX;
pan.y = pan.targetY;
output.offsetX = pan.x;
output.offsetY = pan.y;
applyFrame();
addEventListener('resize', fitScreen);

requestAnimationFrame((now) => {
  last = now;
  tick(now);
  document.body.classList.add('ready');
});
