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

import { compileAhead } from './compile.js';
import { createCube } from './cube.js';
import { GradeShader } from './grade.js';
import { createSimulation } from './simulation.js';
import { ORIGINAL_PULSE, breathAt, readHash, spinRate, writeHash } from './settings.js';
import { createLighting, createSmoke } from './smoke.js';
import { createUI } from './ui.js';
import { createView } from './view.js';
import { colourMap, readImage } from './palette.js';
import { download, formatSize, recordVideo, saveImage, stamp } from './capture.js';

const canvas = document.querySelector('canvas');
// Read when it is used, so turning the setting on with the page open takes effect at once.
const motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => motionQuery.matches;
const coarse = matchMedia('(pointer: coarse)').matches;

let renderer;
try {
  renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch {
  document.body.classList.add('no-webgl');
  throw new Error('WebGL 2 is not available.');
}
renderer.autoClear = false;
// Checking every shader for errors makes the GPU finish compiling each one before the next can start.
// The shaders are known good, so only the dev build checks; the published page compiles them in parallel.
renderer.debug.checkShaderErrors = import.meta.env.DEV;
// Accumulate light in full floats where the GPU can blend into them (see smoke.js).
const accumulate = renderer.extensions.has('EXT_color_buffer_float') && renderer.extensions.has('EXT_float_blend') ? FloatType : HalfFloatType;

// ---- State ---------------------------------------------------------------------------------

const state = readHash();
// Phones start light. Computers start at a million grains and step down if they can't keep up.
state.particles = coarse ? 256 : 1024;
let qualityCheck = coarse ? null : { frames: 0, time: 0 };
// Reduced motion: no turning camera and no breathing blasts unless a shared link asks for them.
if (reducedMotion() && !location.hash.includes('spin=')) state.spin = 0;
if (reducedMotion() && !location.hash.includes('pulse=')) state.pulse = 0;

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
// read once into its colour map (palette.js).
const bundled = {
  dusk: new URL('./colours/dusk.webp', import.meta.url).href,
  pearl: new URL('./colours/pearl.webp', import.meta.url).href,
};
const palettes = {}; // colour choice → { image, map }
let colours = null; // the palette the grains wear now, or null for white
let retired = null; // a replaced upload's colour map, freed once no grain is turning from it
// Lifts dark images so the smoke keeps about the brightness it has in white.
const colourGain = (image) => Math.min(2.5, Math.max(1, 0.7 / Math.max(image.meanLuminance, 0.01)));
function wear(choice) {
  colours = palettes[choice] ?? null;
  if (colours) smoke.setColours(colours.map, colourGain(colours.image), true);
  ui.showColours(colours?.image ?? null);
}
async function loadBundled(choice) {
  if (palettes[choice]) return;
  const blob = await (await fetch(bundled[choice])).blob();
  const image = await readImage(blob, choice);
  palettes[choice] = { image, map: colourMap(image) };
}
// The clip's clock: zero when the original look starts, so its pulse lands on the clip's beats.
let clock = 0;
const towardCamera = new Vector3();
function simStep(dt, withStir = true) {
  advance(simulation, dt, clock, withStir ? stir : null);
  clock += dt;
}
// One step of a simulation at a breath clock (the loop recording also steps a second one).
function advance(sim, dt, at, stirring = null) {
  // The breath turns in the picture's plane, so the sim needs to know where the camera looks from.
  view.camera.getWorldDirection(towardCamera).negate();
  // The smoke answers the breath a little early (a compact mass springs back out on its own), so the
  // breath is fed 0.2 s late; measured inside the simulation, its swell then lines up with the clip's.
  sim.step(dt, live, state.source, stirring, breathAt(at - 0.2), towardCamera);
}
function make(size) {
  simulation?.dispose();
  if (smoke) {
    scene.remove(smoke.object);
    smoke.dispose();
  }
  simulation = createSimulation(renderer, size);
  smoke = createSmoke(size, lighting);
  if (colours) smoke.setColours(colours.map, colourGain(colours.image));
  scene.add(smoke.object);
}
const SETTLE = 90;
function build(size) {
  make(size);
  // Let the smoke settle before anyone sees it.
  const settle = clock;
  for (let i = 0; i < SETTLE; i++) simStep(1 / 45, false);
  clock = settle;
}
// A mark in the GPU's queue (a fence), and a wait until the GPU has reached it (checked between tasks),
// so its work doesn't queue up far ahead of the browser drawing the page. A hidden tab doesn't wait.
function gpuMark() {
  const gl = renderer.getContext();
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  return fence;
}
async function gpuReached(fence) {
  const gl = renderer.getContext();
  while (!document.hidden && gl.getSyncParameter(fence, gl.SYNC_STATUS) !== gl.SIGNALED) {
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  gl.deleteSync(fence);
}
// Let the loading screen paint "code" before the grains are built. A tab opened in the background
// never paints, so it builds after a moment anyway and is ready when shown.
await Promise.race([
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  new Promise((resolve) => setTimeout(resolve, 100)),
]);
// The first build leaves the browser room to draw the loading bar. The passes compile on its own
// threads (compile.js), then the smoke takes the same 90 settling steps as build, two at a time, with
// never more than two pairs on the GPU: a step is about 9 ms of GPU work, and sent at once the 90 held
// the screen for most of a second. A tab in the background builds at once.
const gently = !document.hidden;
if (gently) {
  make(state.particles);
  await simulation.compile();
  const settle = clock;
  let ahead = null;
  for (let i = 0; i < SETTLE; i++) {
    simStep(1 / 45, false);
    if (i % 2 === 0) continue;
    const mark = gpuMark();
    if (ahead) await gpuReached(ahead);
    ahead = mark;
  }
  await gpuReached(ahead);
  clock = settle;
} else {
  build(state.particles);
}
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
// While an image is encoded the loop holds still: the screen keeps the frame being saved, and the
// browser's PNG encoder gets the idle time it waits for (with the loop running it took 5 to 10 s).
let holding = false;
let rendering = false;

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

// The screen the canvas was last fitted to.
const fitted = { width: 0, height: 0 };
const aspects = { '16:9': 16 / 9, '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1 };
function fitScreen(instant = false) {
  // A page opened in a background tab can start with no size; wait for a real one.
  if (!innerWidth || !innerHeight || exporting) return;
  frameGlide?.cancel();
  Object.assign(fitted, { width: innerWidth, height: innerHeight });
  // In the record window the canvas becomes the frame of the file: you see what is saved.
  const framed = ui.recordOpen;
  document.body.classList.toggle('framed', framed);
  const ratio = Math.min(devicePixelRatio, 2);
  if (framed) {
    const box = ui.frameBox(aspects[state.format] ?? innerWidth / innerHeight);
    Object.assign(canvas.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px` });
    Object.assign(output, { width: box.w, height: box.h, ratio, offsetX: 0, offsetY: 0 });
  } else {
    Object.assign(canvas.style, { left: '', top: '', width: '', height: '' });
    Object.assign(output, { width: innerWidth, height: innerHeight, ratio });
  }
  app.layoutChanged(instant);
  if (!framed) Object.assign(output, { offsetX: pan.x, offsetY: pan.y });
  applyOutput();
}

// The cube on the page as drawn now (through any glide under way): its centre, and its size up to a
// constant.
function cubeOnPage() {
  const box = canvas.getBoundingClientRect();
  const s = box.width / output.width;
  return {
    x: box.left + (output.width / 2 - output.offsetX) * s,
    y: box.top + (output.height / 2 - output.offsetY) * s,
    size: view.scale(output.width, output.height) * s,
  };
}

// Opening or closing the record window, the canvas glides between the screen and the frame. It is
// laid out at once in its new place, then drawn from where the cube was, at the size it was, and
// settles: the cube stays under the eye while the frame closes in around it (or opens out).
let frameGlide = null;
function glideFrom(from) {
  const box = canvas.getBoundingClientRect();
  const to = cubeOnPage();
  const s = from.size / to.size;
  const x = from.x - box.left - s * (to.x - box.left);
  const y = from.y - box.top - s * (to.y - box.top);
  frameGlide = canvas.animate(
    [{ transform: `translate(${x}px, ${y}px) scale(${s})` }, { transform: 'none' }],
    // The panel's own drawer curve (style.css), so the canvas and the panel move as one.
    { duration: 300, easing: getComputedStyle(document.documentElement).getPropertyValue('--ease-drawer').trim() },
  );
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
  const box = canvas.getBoundingClientRect();
  pointer.x = ((e.clientX - box.left) / box.width) * 2 - 1;
  pointer.y = -((e.clientY - box.top) / box.height) * 2 + 1;
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
  if (cut.fade > 0 && !exporting) layKeptFrame(cut.fade);
}

// Move the camera to a new lens or to the original look's start, keeping the frame just drawn so it
// can fade out over the new view.
// Keep the frame just drawn, to lay over a later one.
function keepFrame() {
  renderer.getDrawingBufferSize(bufferSize);
  if (cut.texture.image.width !== bufferSize.x || cut.texture.image.height !== bufferSize.y) {
    cut.texture.dispose();
    cut.texture = new FramebufferTexture(bufferSize.x, bufferSize.y);
    still.material.uniforms.tStill.value = cut.texture;
  }
  renderer.setRenderTarget(null);
  renderer.copyFramebufferToTexture(cut.texture);
}
// Lay the kept frame over what is drawn, at this opacity.
function layKeptFrame(opacity) {
  still.material.uniforms.uFade.value = opacity;
  renderer.render(stillScene, stillCamera);
}
function takeCut() {
  const { lens, original } = cut.pending;
  cut.pending = null;
  if (rendered && !exporting) {
    keepFrame();
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
  // A loop being rendered draws its own frames; an image being saved keeps the one it saves.
  if (rendering || holding) return requestAnimationFrame(tick);
  if (!exporting && (innerWidth !== fitted.width || innerHeight !== fitted.height)) fitScreen();
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

// A video rendered frame by frame instead of filmed live, so every computer gets every frame. The
// simulation always steps at 60 a second, as it does live; at 30 fps every other step is kept.
// A loop lasts whole breaths (the length asked for, rounded to them) and the camera turns by whole
// quarter turns: the glass looks the same every quarter turn, so it lines up where the loop closes
// (a slow spin holds still for the loop). Its last second crossfades into its first: a second
// simulation, started from the first frame's grains, replays that second under the end, so the last
// frame leads into the first. A single take ("once") keeps the length and the spin as they are.
const STEP = 1 / 60;
const smoothstep = (x) => {
  x = Math.min(1, Math.max(0, x));
  return x * x * (3 - 2 * x);
};
async function renderVideo(job, { length, loop, fps }) {
  const { createEncoder } = await import('./loop.js');
  const stride = Math.round(60 / fps);
  const breathing = loop && live.pulse > 0.001;
  const seconds = breathing ? Math.max(1, Math.round(length / ORIGINAL_PULSE.period)) * ORIGINAL_PULSE.period : length;
  const spin = paused ? 0 : spinRate(live.spin);
  const quarter = Math.PI / 2;
  const omega = loop ? (Math.round((spin * seconds) / quarter) * quarter) / seconds : spin;
  const frames = Math.round(seconds * fps);
  const steps = frames * stride;
  // The crossfade: a second, or a quarter of a short loop.
  const blend = loop ? Math.round(Math.min(1, seconds / 4) * fps) * stride : 0;
  const start = view.theta;
  const turn = (i) => {
    view.turnTo(start + omega * i * STEP);
    view.update(0, 0);
  };

  const encoder = await createEncoder(canvas, fps);
  const main = simulation;
  const replay = loop ? createSimulation(renderer, main.size) : null;
  replay?.copyFrom(main);
  let replayClock = clock;
  rendering = true;
  try {
    for (let i = 0; i < steps + blend; i++) {
      if (job.cancelled) throw new Error('recording cancelled');
      // Every step: the camera at this moment, then the smoke moves on.
      turn(i);
      simStep(STEP, false);
      const tail = i >= steps;
      if (tail) {
        turn(i - steps);
        advance(replay, STEP, replayClock);
        replayClock += STEP;
      }
      // A frame after every stride of steps, once the first (crossfaded) second has gone by.
      if (i < blend || (i + 1 - blend) % stride) continue;
      time += stride * STEP;
      if (tail) {
        // The replayed beginning, kept, then the end with the beginning laid over it, more and more,
        // so the last frame is the one before the first.
        simulation = replay;
        render(STEP);
        simulation = main;
        keepFrame();
        turn(i);
        render(STEP);
        layKeptFrame(smoothstep((i - steps + 1) / blend));
      } else {
        render(STEP);
      }
      await encoder.add();
      job.onProgress?.((i + 1) / (steps + blend));
      // Let the page breathe (the preview shows the frames as they come).
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const blob = await encoder.finish();
    const name = `pure-smoke-${loop ? 'loop' : 'video'}-${canvas.width}x${canvas.height}-${Math.round(seconds)}s-${fps}fps-${stamp()}.mp4`;
    download(blob, name);
    return 'mp4';
  } catch (e) {
    encoder.cancel();
    throw e;
  } finally {
    simulation = main;
    replay?.dispose();
    view.turnTo(start);
    rendering = false;
  }
}

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
    if (key === 'format') {
      ui.sync();
      app.reframe(true);
    }
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
    retired = palettes.image?.map.texture ?? null;
    palettes.image = { image, map: colourMap(image) };
    state.colour = 'image';
    wear('image');
    return image;
  },
  get paused() { return paused; },
  togglePause() { paused = !paused; return paused; },
  recording: null,
  // The panel opened, closed, or gave way to the record window: fit the canvas or the frame again.
  // glide: the canvas moves to its new place from where it was (the record window opening or closing).
  reframe(instant = false, glide = false) {
    const from = glide && !instant && !reducedMotion() ? cubeOnPage() : null;
    fitScreen(instant || !!from);
    if (from) glideFrom(from);
  },
  layoutChanged(instant = false) {
    // A framed canvas is placed in the free space itself; the full screen pans the cube into it.
    const framed = document.body.classList.contains('framed');
    const reserve = app.recording || framed ? { x: 0, y: 0 } : ui.reserve();
    pan.targetX = reserve.x / 2;
    pan.targetY = reserve.y / 2;
    if (framed) instant = true;
    // With reduced motion the scene moves to its new centre at once instead of sliding.
    if (instant || reducedMotion()) {
      pan.x = pan.targetX;
      pan.y = pan.targetY;
    }
  },
  // What you see: the chosen frame in the record window, the screen everywhere else (the S key).
  async saveImage() {
    const size = formatSize(ui.recordOpen ? state.format : 'screen', 'image', innerWidth, innerHeight);
    holding = true;
    try {
      return await atSize(size.width, size.height, 1, () => saveImage({ canvas, render, ...size }));
    } finally {
      holding = false;
    }
  },
  // A browser with a video encoder renders the video (a loop or a single take); one without films it live.
  canLoop: typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined',
  async recordVideo(onProgress) {
    const size = formatSize(state.format, 'video', innerWidth, innerHeight);
    app.recording = { canvas, onProgress, seconds: state.length, cancelled: false };
    app.layoutChanged();
    document.body.classList.add('rendering');
    const settings = { length: state.length, loop: state.loop === 'loop', fps: state.fps };
    try {
      return await atSize(size.width, size.height, 1, () => (app.canLoop ? renderVideo(app.recording, settings) : recordVideo(app.recording)));
    } finally {
      document.body.classList.remove('rendering');
      app.recording = null;
      app.layoutChanged();
    }
  },
  stopRecording() {
    if (app.recording) app.recording.cancelled = true;
  },
};

const ui = createUI(app);

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

// The first frame's programs compile ahead too: render once with every draw a compile, then forget it
// was drawn (the cube's edges snap on the first real frame).
if (gently) {
  await compileAhead(renderer, () => render(0));
  rendered = false;
}
// Two frames, so the loading screen paints "grains" before the first frame.
requestAnimationFrame(() => requestAnimationFrame((now) => {
  last = now;
  tick(now);
  step('shaders');
  document.body.classList.add('ready');
  // After the one-time entrance, the panel opens and closes on its own, faster timing.
  setTimeout(() => document.body.classList.add('settled'), 1000);
}));
