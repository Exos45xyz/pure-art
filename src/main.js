import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/inter';
import './style.css';
// First, so the loading screen marks the code as here before anything heavy runs.
import { step } from './loader.js';

import {
  FloatType, FramebufferTexture, HalfFloatType, Mesh, OrthographicCamera, Plane, PlaneGeometry, Raycaster, Scene,
  ShaderMaterial, Vector2, Vector3, WebGLRenderTarget, WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

import { createCube } from './cube.js';
import { GradeShader } from './grade.js';
import { createSimulation } from './simulation.js';
import { breathAt, readHash, spinRate, writeHash } from './settings.js';
import { createLighting, createSmoke } from './smoke.js';
import { createUI } from './ui.js';
import { createView } from './view.js';
import { readImage, ribbonTexture } from './palette.js';
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
// Reduced motion: no turning camera and no breathing blasts unless a shared link asks for them.
if (reducedMotion && !location.hash.includes('spin=')) state.spin = 0;
if (reducedMotion && !location.hash.includes('pulse=')) state.pulse = 0;

// The shaders read eased copies of the sliders, so every change glides instead of jumping.
const live = { ...state, colourMix: 0 };
const eased = ['flow', 'turbulence', 'spread', 'gather', 'pulse', 'escape', 'rebound', 'brightness', 'shadows', 'glow', 'film', 'grain', 'blur', 'focus', 'spin'];

// ---- Scene ---------------------------------------------------------------------------------

const scene = new Scene();
const view = createView(canvas);
view.setLens(state.lens);
// One lamp lights the smoke and the cube's edges alike.
const lighting = createLighting(accumulate);
const cube = createCube(lighting);

let simulation;
let smoke;
// The colours the grains wear: white, a palette that ships with the app, or an uploaded image. Each is
// read once into its colour ribbon (palette.js).
const bundled = {
  dusk: new URL('./colours/dusk.webp', import.meta.url).href,
  pearl: new URL('./colours/pearl.webp', import.meta.url).href,
};
const palettes = {}; // colour choice → { image, ribbon }
let colours = null; // the palette the grains wear now, or null for white
let retired = null; // a replaced upload's ribbon, freed once no grain is turning from it
// Lifts dark images so the smoke keeps about the brightness it has in white.
const colourGain = (image) => Math.min(2.5, Math.max(1, 0.7 / Math.max(image.meanLuminance, 0.01)));
function wear(choice) {
  colours = palettes[choice] ?? null;
  if (colours) smoke.setColours(colours.ribbon, colourGain(colours.image), true);
  ui.showColours(colours?.image ?? null);
}
async function loadBundled(choice) {
  if (palettes[choice]) return;
  const blob = await (await fetch(bundled[choice])).blob();
  const image = await readImage(blob, choice);
  palettes[choice] = { image, ribbon: ribbonTexture(image) };
}
// The clip's clock: zero when the original look starts, so its pulse lands on the clip's beats.
let clock = 0;
const towardCamera = new Vector3();
function simStep(dt, withStir = true) {
  // The breath turns in the picture's plane, so the sim needs to know where the camera looks from.
  view.camera.getWorldDirection(towardCamera).negate();
  // The smoke answers the breath a little early (a compact mass springs back out on its own), so the
  // breath is fed 0.2 s late; measured inside the simulation, its swell then lines up with the clip's.
  simulation.step(dt, live, state.source, withStir ? stir : null, breathAt(clock - 0.2), towardCamera);
  clock += dt;
}
function build(size) {
  simulation?.dispose();
  if (smoke) {
    scene.remove(smoke.object);
    smoke.dispose();
  }
  simulation = createSimulation(renderer, size);
  smoke = createSmoke(size, lighting);
  if (colours) smoke.setColours(colours.ribbon, colourGain(colours.image));
  scene.add(smoke.object);
  // Let the smoke settle before anyone sees it.
  const settle = clock;
  for (let i = 0; i < 90; i++) simStep(1 / 45, false);
  clock = settle;
}
// Let the loading screen paint "code" before the grains are built (the build holds the page).
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
build(state.particles);
step('grains');

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

// A change of lens, or the original look's camera, crossfades: the last frame through the old camera
// is kept and fades out over the new one, so the picture changes instead of jumping.
const cut = { pending: null, fade: 0, texture: new FramebufferTexture(1, 1) };
const stillScene = new Scene();
const still = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
  uniforms: { tStill: { value: cut.texture }, uFade: { value: 0 } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tStill;
    uniform float uFade;
    varying vec2 vUv;
    void main() { gl_FragColor = vec4(texture2D(tStill, vUv).rgb, uFade); }`,
  transparent: true,
  depthTest: false,
  depthWrite: false,
}));
still.frustumCulled = false;
stillScene.add(still);
const stillCamera = new OrthographicCamera();
const bufferSize = new Vector2();

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
  // A kept frame belongs to the old size.
  cut.fade = 0;
  applyFrame();
}

function applyFrame() {
  const pixelsHigh = output.height * output.ratio;
  // Edges are 2.8 px on a 1280 px frame with the flat lens (the reference's weight), 2.4 px with depth,
  // and never thinner than one screen point, so the stroke always reads.
  const lineWidth = ((view.lens === 'flat' ? 2.8 : 2.4) * pixelsHigh) / 1280;
  cube.setOutput(output.width * output.ratio, pixelsHigh, Math.max(output.ratio, lineWidth));
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

// The cube's outline on screen: the convex hull of its 8 projected corners, as inward-facing lines in
// drawing-buffer pixels (bottom-left origin, like gl_FragCoord).
const corners = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => new Vector3(x, y, z))));
const projected = corners.map(() => new Vector3());
function cubeOutline(camera, width, height) {
  // The camera may have just moved (spin, drag, an export's own framing): use where it is now.
  camera.updateMatrixWorld();
  const pts = corners.map((c, i) => {
    const p = projected[i].copy(c).project(camera);
    return [(p.x * 0.5 + 0.5) * width, (p.y * 0.5 + 0.5) * height];
  }).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]; // counter-clockwise
  return hull.slice(0, 6).map((a, i) => {
    const b = hull[(i + 1) % hull.length];
    // Inside is to the left of each counter-clockwise side; half a pixel of room for anti-aliasing.
    const nx = -(b[1] - a[1]), ny = b[0] - a[0];
    const len = Math.hypot(nx, ny) || 1;
    return new Vector3(nx / len, ny / len, -(nx * a[0] + ny * a[1]) / len + 0.5);
  });
}

function render(dt) {
  const camera = view.camera;
  renderPass.camera = camera;
  smoke.update(simulation, live, output.height * output.ratio, camera);
  smoke.setOutline(cubeOutline(camera, output.width * output.ratio, output.height * output.ratio));
  smoke.colourMix = live.colourMix;
  smoke.turnColours(dt);
  if (retired && !smoke.turning) {
    retired.dispose();
    retired = null;
  }
  lighting.update(camera, live.shadows);
  smoke.renderShadow(renderer);

  bloom.strength = live.glow * 0.85;
  // Linear up to 0.6, then steeper: the original look (0.85) needs about four times the light.
  grade.uniforms.uExposure.value = 0.35 + live.brightness * 1.9 + 56.24 * Math.max(live.brightness - 0.6, 0) ** 2;
  grade.uniforms.uFilm.value = live.film;
  grade.uniforms.uLift.value = Math.min(1, live.glow * 4);
  grade.uniforms.uTime.value = time;

  // The cube's frame is a plain stroke, lit by the lamp and hidden by the smoke in front of it.
  cube.update(state.edges, camera, exporting || !rendered ? Infinity : dt, grade.uniforms.uExposure.value);
  rendered = true;
  renderer.setClearColor(0x000000, 1);
  composer.render(dt);
  renderer.setRenderTarget(null);
  renderer.render(edgeScene, camera);
  if (cut.fade > 0 && !exporting) {
    still.material.uniforms.uFade.value = cut.fade;
    renderer.render(stillScene, stillCamera);
  }
}

// Move the camera to a new lens or to the original look's start, keeping the frame just drawn so it
// can fade out over the new view.
function takeCut() {
  const { lens, original } = cut.pending;
  cut.pending = null;
  if (rendered && !exporting) {
    renderer.getDrawingBufferSize(bufferSize);
    if (cut.texture.image.width !== bufferSize.x || cut.texture.image.height !== bufferSize.y) {
      cut.texture.dispose();
      cut.texture = new FramebufferTexture(bufferSize.x, bufferSize.y);
      still.material.uniforms.tStill.value = cut.texture;
    }
    renderer.setRenderTarget(null);
    renderer.copyFramebufferToTexture(cut.texture);
    cut.fade = 1;
  }
  if (lens) view.setLens(lens);
  if (original) {
    view.original();
    clock = 0;
  }
  applyFrame();
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
  live.colourMix += ((state.colour !== 'white' && colours ? 1 : 0) - live.colourMix) * (1 - Math.exp(-dt * 6));

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
  // The kept frame fades like the sliders glide.
  cut.fade = cut.fade > 0.01 ? cut.fade * Math.exp(-dt * 10) : 0;
  render(dt);
  if (cut.pending) takeCut();
  checkQuality(dt);
  requestAnimationFrame(tick);
}

// Over the first two seconds, a computer that stays under 45 fps drops to 500k grains.
function checkQuality(dt) {
  if (!qualityCheck || document.hidden) return;
  qualityCheck.frames++;
  if (qualityCheck.frames < 20) return;
  qualityCheck.time += dt;
  if (qualityCheck.time < 2) return;
  const fps = (qualityCheck.frames - 20) / qualityCheck.time;
  qualityCheck = null;
  if (fps < 45 && state.particles === 1024) {
    app.set('particles', 708);
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
    // Image colours need an image first: ask for one instead.
    if (key === 'colour' && value === 'image' && !palettes.image) {
      ui.pickImage();
      return;
    }
    state[key] = value;
    if (key === 'colour') {
      wear(value);
      // A bundled palette is read the first time it is chosen; the smoke turns to it once it is ready.
      if (bundled[value] && !palettes[value]) {
        loadBundled(value)
          .then(() => { if (state.colour === value) wear(value); })
          .catch(() => ui.toast('those colours did not load'));
      }
    }
    if (key === 'particles') {
      qualityCheck = null;
      build(value);
    }
    if (key === 'lens') cut.pending = { ...cut.pending, lens: value };
    if (key === 'format') ui.showFormat(value);
    writeHash(state);
  },
  apply(values, look) {
    for (const [key, value] of Object.entries(values)) if (key !== 'particles' && key !== 'format') state[key] = value;
    // The original look starts the camera where the reference clip starts. Both moves crossfade.
    if (state.lens !== view.lens) cut.pending = { ...cut.pending, lens: state.lens };
    if (look === 'original') cut.pending = { ...cut.pending, original: true };
    writeHash(state);
  },
  // Colour the grains from an image file, in the image's own proportions.
  async useImage(file) {
    const image = await readImage(file);
    retired?.dispose();
    retired = palettes.image?.ribbon.texture ?? null;
    palettes.image = { image, ribbon: ribbonTexture(image) };
    state.colour = 'image';
    wear('image');
    return image;
  },
  get paused() { return paused; },
  togglePause() { paused = !paused; return paused; },
  recording: null,
  layoutChanged(instant = false) {
    const reserve = app.recording ? { x: 0, y: 0 } : ui.reserve();
    pan.targetX = reserve.x / 2;
    pan.targetY = reserve.y / 2;
    // With reduced motion the scene moves to its new centre at once instead of sliding.
    if (instant || reducedMotion) {
      pan.x = pan.targetX;
      pan.y = pan.targetY;
    }
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
    get smoke() { return smoke; },
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

// Two frames, so the loading screen paints "grains" before the first frame compiles the shaders.
requestAnimationFrame(() => requestAnimationFrame((now) => {
  last = now;
  tick(now);
  step('shaders');
  document.body.classList.add('ready');
  // After the one-time entrance, the panel opens and closes on its own, faster timing.
  setTimeout(() => document.body.classList.add('settled'), 1000);
}));
