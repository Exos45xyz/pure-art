import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/inter';
import './style.css';

import { PerspectiveCamera, Plane, Raycaster, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { createCube } from './cube.js';
import { GradeShader } from './grade.js';
import { createSimulation } from './simulation.js';
import { readHash, writeHash } from './settings.js';
import { createSmoke } from './smoke.js';
import { createUI } from './ui.js';
import { recordVideo, saveImage } from './capture.js';

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

// ---- State ---------------------------------------------------------------------------------

const state = readHash();
// Phones start light. Computers start at a million grains and step down if they can't keep up.
state.particles = coarse ? 256 : 1024;
let qualityCheck = coarse ? null : { frames: 0, time: 0 };
if (reducedMotion && !location.hash.includes('spin=')) state.spin = 0;

// The shaders read eased copies of the sliders, so every change glides instead of jumping.
const live = { ...state };
const eased = ['flow', 'turbulence', 'escape', 'brightness', 'shadows', 'glow', 'film', 'grain', 'spin'];

// ---- Scene ---------------------------------------------------------------------------------

const scene = new Scene();
const camera = new PerspectiveCamera(26, 1, 0.1, 100);
camera.position.setFromSphericalCoords(10.5, Math.PI / 2 - 0.36, 0.7);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.rotateSpeed = 0.55;
controls.enablePan = false;
controls.minDistance = 5.5;
controls.maxDistance = 18;
controls.autoRotate = true;

const cube = createCube();

let simulation;
let smoke;
function build(size) {
  simulation?.dispose();
  if (smoke) {
    scene.remove(smoke.object);
    smoke.dispose();
  }
  simulation = createSimulation(renderer, size);
  smoke = createSmoke(size);
  scene.add(smoke.object);
  // Let the smoke settle before anyone sees it.
  for (let i = 0; i < 90; i++) simulation.step(1 / 45, live, state.source, null);
}
build(state.particles);

// ---- Post ----------------------------------------------------------------------------------

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// A low threshold on purpose: the glow gives the grains a soft body of smoke around them.
const bloom = new UnrealBloomPass(new Vector2(256, 256), 0.4, 0.45, 0.08);
composer.addPass(bloom);
const grade = new ShaderPass(GradeShader);
composer.addPass(grade);

// The cube's edges are drawn after the grade, so they stay crisp and never bloom.
const edgeScene = new Scene();
edgeScene.add(cube.object);

// ---- Layout --------------------------------------------------------------------------------

// The cube sits in the middle of the space the panel leaves free.
const frame = { offsetX: 0, offsetY: 0, targetX: 0, targetY: 0 };
let width = 0;
let height = 0;

function resize() {
  // A page opened in a background tab can start with no size; wait for a real one.
  if (!innerWidth || !innerHeight) return;
  width = innerWidth;
  height = innerHeight;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(width, height, false);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(width, height);
  cube.setResolution(width, height);
  camera.aspect = width / height;
  // Narrow screens widen the lens so the whole cube stays in view.
  camera.fov = camera.aspect < 0.8 ? 2 * Math.atan(Math.tan((13 * Math.PI) / 180) * (0.8 / camera.aspect)) * (180 / Math.PI) : 26;
  app.layoutChanged();
  applyFrame();
}

function applyFrame() {
  camera.setViewOffset(width, height, frame.offsetX, frame.offsetY, width, height);
  camera.updateProjectionMatrix();
  grade.uniforms.uAspect.value = width / height;
  grade.uniforms.uCenter.value = [0.5 - frame.offsetX / width, 0.5 + frame.offsetY / height];
}

// ---- Stir: hovering moves the smoke -------------------------------------------------------

const pointer = { x: 0, y: 0, inside: false, dragging: false };
const raycaster = new Raycaster();
const facing = new Plane();
const hit = new Vector3();
const lastHit = new Vector3();
const stir = { origin: new Vector3(), direction: new Vector3(), velocity: new Vector3() };
let hasLastHit = false;

canvas.addEventListener('pointermove', (e) => {
  pointer.x = (e.clientX / width) * 2 - 1;
  pointer.y = -(e.clientY / height) * 2 + 1;
  pointer.inside = e.pointerType === 'mouse';
});
canvas.addEventListener('pointerleave', () => { pointer.inside = false; hasLastHit = false; });
controls.addEventListener('start', () => { pointer.dragging = true; });
controls.addEventListener('end', () => { pointer.dragging = false; hasLastHit = false; });

function updateStir(dt) {
  const active = pointer.inside && !pointer.dragging && dt > 0;
  if (active) {
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
  }
  if (!active || !hasLastHit) stir.velocity.multiplyScalar(Math.exp(-dt * 6));
}

// ---- Render ----------------------------------------------------------------------------------

let paused = false;
let time = 0;

function render(dt) {
  smoke.update(simulation, live, height * renderer.getPixelRatio());
  smoke.renderShadow(renderer);

  bloom.strength = live.glow * 0.85;
  grade.uniforms.uExposure.value = 0.35 + live.brightness * 1.9;
  grade.uniforms.uFilm.value = live.film;
  grade.uniforms.uTime.value = time;

  renderer.setClearColor(0x000000, 1);
  composer.render(dt);
  renderer.setRenderTarget(null);
  renderer.render(edgeScene, camera);
}

let last = performance.now();
function tick(now) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  if (innerWidth !== width || innerHeight !== height) resize();
  if (!width || !height) return requestAnimationFrame(tick);
  time += dt;

  const k = 1 - Math.exp(-dt * 10);
  for (const key of eased) live[key] += (state[key] - live[key]) * k;

  const panK = 1 - Math.exp(-dt * 9);
  const before = frame.offsetX + frame.offsetY;
  frame.offsetX += (frame.targetX - frame.offsetX) * panK;
  frame.offsetY += (frame.targetY - frame.offsetY) * panK;
  if (Math.abs(frame.offsetX + frame.offsetY - before) > 0.01) applyFrame();

  controls.autoRotate = !paused && live.spin > 0.002;
  controls.autoRotateSpeed = -live.spin * 6;
  controls.update(dt);
  updateStir(dt);
  cube.update(state.edges, camera, dt);

  if (!paused) simulation.step(dt, live, state.source, stir);
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

// Exports are framed on the cube, not on the screen with the panel beside it.
async function withCentredFrame(task) {
  const saved = { x: frame.offsetX, y: frame.offsetY };
  frame.offsetX = frame.offsetY = 0;
  applyFrame();
  try {
    return await task();
  } finally {
    frame.offsetX = saved.x;
    frame.offsetY = saved.y;
    applyFrame();
  }
}

const app = {
  state,
  set(key, value) {
    if (state[key] === value) return;
    state[key] = value;
    if (key === 'particles') qualityCheck = null;
    if (key === 'particles') build(value);
    writeHash(state);
  },
  apply(values) {
    for (const [key, value] of Object.entries(values)) if (key !== 'particles') state[key] = value;
    writeHash(state);
  },
  get paused() { return paused; },
  togglePause() { paused = !paused; return paused; },
  recording: null,
  layoutChanged() {
    const reserve = app.recording ? { x: 0, y: 0 } : ui.reserve();
    frame.targetX = reserve.x / 2;
    frame.targetY = reserve.y / 2;
  },
  saveImage: () => withCentredFrame(() => saveImage({ renderer, composer, render, width, height })),
  async recordVideo(onProgress) {
    app.recording = { renderer, composer, canvas, width, height, onProgress, seconds: 8, cancelled: false };
    app.layoutChanged();
    try {
      return await recordVideo(app.recording);
    } finally {
      app.recording = null;
      app.layoutChanged();
    }
  },
  stopRecording() {
    if (app.recording) app.recording.cancelled = true;
  },
};

const ui = createUI(app);
if (import.meta.env.DEV) window.pureSmoke = { renderer, camera, state, live, stir, get simulation() { return simulation; } };
resize();
frame.offsetX = frame.targetX;
frame.offsetY = frame.targetY;
applyFrame();
addEventListener('resize', resize);

requestAnimationFrame((now) => {
  last = now;
  tick(now);
  document.body.classList.add('ready');
});
