// Every control in the panel, its range and its default.
// Ranges are 0–1 unless a control is a choice; the shaders map them to real units.

export const controls = [
  { group: 'Colour', key: 'colour', label: 'colour', type: 'choice', look: false,
    options: [['white', 'white'], ['dusk', 'dusk'], ['pearl', 'pearl'], ['image', 'image']] },

  // Fine-tune, in short groups by what each changes: how the smoke moves, its rhythm, the glass, the light,
  // the grains, the camera. Each control says what it does in a line (hint, shown on hover).

  // Where the smoke is born. Not in the panel: with gather on (pure's masses) the smoke is born at the
  // gather centres and the source changes nothing you see; the looks and randomize set it where it shows.
  { group: 'Motion', key: 'source', label: 'source', type: 'choice', hidden: true,
    options: [['volume', 'volume'], ['plume', 'plume'], ['core', 'core']] },
  // How the smoke moves. Not in the panel: the rebound look sets it. flow: the current carries it (every
  // other look); rebound: it keeps its own momentum, thrown at the glass on every beat (simulation.js).
  { group: 'Motion', key: 'motion', label: 'motion', type: 'choice', hidden: true,
    options: [['flow', 'flow'], ['rebound', 'rebound']] },
  // Speed and beat are shown as what they are (1.00×, 2.0 s), not 0–100.
  { group: 'Motion', key: 'speed', label: 'speed', format: (v) => `${timeScale(v).toFixed(2)}×`,
    hint: "How fast the smoke's time runs, from slow motion to twice as fast" },
  { group: 'Motion', key: 'flow', label: 'flow', hint: 'How fast the current carries the smoke' },
  { group: 'Motion', key: 'turbulence', label: 'turbulence', hint: 'How many small eddies ride on the big swirls' },
  { group: 'Motion', key: 'twist', label: 'twist', hint: 'Winds the strands into a helix: the top turns one way, the bottom the other' },
  { group: 'Motion', key: 'spread', label: 'spread', hint: 'Each grain wanders on its own, puffing thin sheets into soft clouds' },

  { group: 'Rhythm', key: 'pulse', label: 'breath', hint: 'How far the smoke swells to the glass and pulls back on every beat' },
  { group: 'Rhythm', key: 'beat', label: 'beat', needs: 'pulse', format: (v) => `${beatPeriod(v).toFixed(1)} s`,
    hint: 'The time between breaths (and rebounds). Rests while breath is 0' },
  { group: 'Rhythm', key: 'gather', label: 'gather', hint: 'Pulls the smoke into bodies that move as whole masses' },

  { group: 'Glass', key: 'rebound', label: 'rebound', hint: 'How hard the smoke bounces off the glass (in the rebound look, how hard each beat throws it)' },
  { group: 'Glass', key: 'escape', label: 'escape', hint: 'Opens holes in the glass that let the smoke out' },
  // The cube's edges: white, the smoke's colours (smoke), a colour of your own (#rrggbb, picked in the
  // panel), or off.
  { group: 'Glass', key: 'edges', label: 'edges', type: 'edge', hint: 'The cube\'s edges: white, the smoke\'s colours, a colour of your own, or none' },

  { group: 'Light', key: 'brightness', label: 'brightness', hint: 'How bright the smoke is' },
  { group: 'Light', key: 'shadows', label: 'shadows', hint: 'How dense the smoke is to the light: how deep its shadows fall' },
  { group: 'Light', key: 'glow', label: 'glow', hint: 'The soft glow around the brightest smoke' },
  { group: 'Light', key: 'film', label: 'film grain', hint: 'Film grain over the picture' },

  { group: 'Particles', key: 'particles', label: 'count', type: 'choice', look: false,
    options: [[256, '65k'], [512, '262k'], [708, '500k'], [1024, '1m'], [1448, '2m']],
    hint: 'How many grains: more is finer, and more work for the computer' },
  { group: 'Particles', key: 'grain', label: 'size', hint: 'How big each grain is' },
  { group: 'Particles', key: 'blur', label: 'blur', hint: 'Depth of field: grains away from the focus open into soft discs' },
  { group: 'Particles', key: 'focus', label: 'focus', needs: 'blur', hint: 'Where the focus sits, front to back. Rests while blur is 0' },

  { group: 'Camera', key: 'spin', label: 'spin', hint: 'How fast the cube turns' },
  { group: 'Camera', key: 'lens', label: 'lens', type: 'choice', options: [['flat', 'flat'], ['depth', 'depth']],
    hint: 'Flat, without perspective like the reference clip, or with depth' },

  { group: 'Output', key: 'format', label: 'format', type: 'choice', look: false,
    options: [['screen', 'screen'], ['16:9', '16:9'], ['9:16', '9:16'], ['4:5', '4:5'], ['1:1', '1:1']] },
  // The video: how long, a seamless loop or a single take, and how many frames a second.
  { group: 'Output', key: 'length', label: 'length', type: 'choice', look: false,
    options: [[4, '4 s'], [8, '8 s'], [16, '16 s']] },
  { group: 'Output', key: 'loop', label: 'loop', type: 'choice', look: false,
    options: [['loop', 'loop'], ['once', 'once']] },
  { group: 'Output', key: 'fps', label: 'frame rate', type: 'choice', look: false,
    options: [[30, '30 fps'], [60, '60 fps']] },
];

// The studio look every other look starts from.
const base = {
  source: 'volume', motion: 'flow', flow: 0.45, turbulence: 0.5, twist: 0, spread: 0, gather: 0, pulse: 0, escape: 0, rebound: 0.5, beat: 0.5, speed: 0.5,
  brightness: 0.5, shadows: 0.6, glow: 0.35, film: 0.35,
  grain: 0.4, blur: 0, focus: 0.5, spin: 0.2, lens: 'depth', edges: 'white',
};

// "original" is the reference clip's camera (flat lens, 16.85° down, 62.66°/s) and breath (the clip's
// red edges are white now: the edge colour is yours to choose). See README › The original look. With
// pure's smoke and particles: the clip's own speed (flow 1) washes the strands into fog.
const original = {
  flow: 0.45, turbulence: 0.51, spread: 0, gather: 0.98, pulse: 1, escape: 0,
  brightness: 0.5, shadows: 0.6, glow: 0.35, film: 0.42,
  grain: 0.4, blur: 0, focus: 0.5, spin: 0.5, lens: 'flat', edges: 'white',
};

// Romain's look: the clip's breath through a depth lens, fine filaments, sharp grains, sealed glass.
const pure = {
  flow: 0.45, turbulence: 0.51, spread: 0, gather: 0.98, pulse: 1, escape: 0,
  brightness: 0.5, shadows: 0.6, glow: 0.35, film: 0.42,
  grain: 0.4, blur: 0, focus: 0.5, spin: 0.13, lens: 'depth', edges: 'white',
};

// A look sets the smoke, its light and its form. The colour is yours: no look changes it.
export const presets = {
  pure,
  // aura: pure's breath a little softer and brighter, so a colour reads across a rounder, glowing body
  // (chosen in dusk against pure's own settings by rendering each at 5 and 15 s).
  aura: { ...pure, turbulence: 0.42, gather: 0.9, brightness: 0.55, shadows: 0.48, glow: 0.4, grain: 0.36 },
  original,
  // Two other shapes for the original's camera and breath, chosen from ten by rendering
  // each over 30 s and scoring it (crisp strands, smooth motion), and each its own shape the whole time.
  // ribbon: bright bands arcing around a breathing body.
  ribbon: { ...original, flow: 0.32, turbulence: 0.22, gather: 0.7, pulse: 1, brightness: 0.53, shadows: 0.42, glow: 0.3, grain: 0.32 },
  // veil: slow sheets that fill the glass and touch every face.
  veil: { ...original, flow: 0.24, turbulence: 0.12, gather: 0, pulse: 0.35, brightness: 0.56, shadows: 0.45, glow: 0.22, grain: 0.24 },
  // rebound: the clip as physics, on its camera. The smoke keeps its momentum and every beat throws it at
  // the glass, where it slams, presses flat and springs back, for as long as it runs (simulation.js).
  rebound: { ...original, motion: 'rebound', brightness: 0.55, shadows: 0.45, grain: 0.52 },
  smoke: {},
};

// The looks that start the camera where the reference clip starts (the original and its two shapes).
export const clipLooks = ['original', 'ribbon', 'veil', 'rebound'];

export function presetValues(name) {
  return { ...base, ...presets[name] };
}

// The colour the app opens in, and yours to start from: white that holds most of the way, then the
// glacier blues, the deep blue under them and the charcoal of the rock they were sampled from (a picture of
// ice on dark rock), which sinks into the black studio as the rock does in the picture.
export const DEFAULT_GRADIENT = 'g:ffffff@0~90,5a89a1@48,3b637e@66,204058@84,2c2b2d@100';
export const defaults = { ...presetValues('pure'), particles: 1024, format: 'screen', colour: DEFAULT_GRADIENT, length: 8, loop: 'loop', fps: 60 };
for (const c of controls) c.default = defaults[c.key];

const lookKeys = controls.filter((c) => c.look !== false).map((c) => c.key);

// The look in a state: every control a look sets (not the colour, the count or the output).
export function lookOf(state) {
  return Object.fromEntries(lookKeys.map((key) => [key, state[key]]));
}
export const sameLook = (a, b) => lookKeys.every((key) => a[key] === b[key]);

// The look on screen, if it is one of the presets.
export const matchingPreset = (state) => Object.keys(presets).find((name) => sameLook(presetValues(name), state));

// Randomize: every roll is one of the smoke's beautiful families, varied only inside the ranges where it
// stays beautiful. Found by rendering rolls and scoring them (crisp strands, shapes with air around
// them, the glass touched, no fog and no glare): spread puffs strands into fog, high flow and
// turbulence without gather wash into fog, masses without the breath shrink into small dim blobs.
// masses: bodies that breathe and fold against the glass, like pure (above flow .52 and turbulence .62
// they wash into fog, and the plume source fogs them too).
// silk: slow, crisp sheets that fill the cube.
// ribbons: crisp filaments wrapped around a breathing body (a tight body shades itself dark, so it gets
// a full breath, more light and softer shadows).
const families = {
  masses: { flow: [0.32, 0.52], turbulence: [0.35, 0.62], gather: [0.7, 1], pulse: [0.6, 1], brightness: [0.42, 0.56], shadows: [0.45, 0.78], glow: [0.2, 0.35], grain: [0.28, 0.5], sources: ['volume', 'volume', 'core'] },
  silk: { flow: [0.15, 0.32], turbulence: [0.06, 0.28], gather: [0, 0], pulse: [0, 0.35], brightness: [0.5, 0.58], shadows: [0.35, 0.6], glow: [0.15, 0.28], grain: [0.18, 0.32], sources: ['volume'] },
  ribbons: { flow: [0.3, 0.42], turbulence: [0.2, 0.32], gather: [0.5, 0.75], pulse: [0.75, 1], brightness: [0.5, 0.56], shadows: [0.35, 0.6], glow: [0.22, 0.32], grain: [0.28, 0.45], sources: ['volume', 'core'] },
};
export function shuffled(state) {
  const r = (a, b) => Math.round((a + Math.random() * (b - a)) * 100) / 100;
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const { sources, ...ranges } = families[pick(['masses', 'masses', 'silk', 'ribbons'])];
  return {
    ...state,
    ...Object.fromEntries(Object.entries(ranges).map(([key, [a, b]]) => [key, r(a, b)])),
    source: pick(sources),
    // No roll puffs the strands into fog, opens the glass or blurs the grains: those are choices you make.
    spread: 0,
    escape: 0,
    blur: 0,
    // The families are the current's: a roll from the rebound look goes back to the flow.
    motion: 'flow',
    rebound: r(0.3, 0.85),
    focus: r(0.3, 0.7),
  };
}

// The current look as code, ready to paste into presets above (copy code in the panel).
export function lookCode(state) {
  const value = (v) => (typeof v === 'string' ? `'${v}'` : String(v));
  const keys = controls.filter((c) => c.look !== false).map((c) => c.key);
  const lines = [];
  for (let i = 0; i < keys.length; i += 6) lines.push('    ' + keys.slice(i, i + 6).map((k) => `${k}: ${value(state[k])}`).join(', ') + ',');
  return `  // A Pure Smoke look: paste it into presets in src/settings.js.\n  mine: {\n${lines.join('\n')}\n  },\n`;
}

// An edge colour: white, off, a colour of your own (#rrggbb), or red (the clip's, in older links and looks).
export const isEdge = (v) => typeof v === 'string' && (['white', 'smoke', 'off', 'red'].includes(v) || /^#[0-9a-f]{6}$/i.test(v));

// Your gradient as a colour: g: and its stops, two to eight, each a colour, where it sits on the bar
// (0–100) and, after ~, where its blend into the next one is half done (1–99, as a share of the way;
// 50 when left out), in order: g:d0dce3@0~40,81a8bb@28,… (the panel keeps it in this browser).
// A plain colour of your own is c: and its hex (c:5a89a1), read as a gradient of that one colour.
const STOP = /^([0-9a-f]{6})@(\d{1,3})(?:~(\d{1,2}))?$/;
export const isPlain = (v) => typeof v === 'string' && /^c:[0-9a-f]{6}$/.test(v);
export const plainValue = (hex) => `c:${hex.slice(1).toLowerCase()}`;
export function readGradient(v) {
  if (isPlain(v)) return [0, 100].map((at) => ({ colour: `#${v.slice(2)}`, at, mid: 0.5 }));
  if (typeof v !== 'string' || !v.startsWith('g:')) return null;
  const stops = v.slice(2).split(',').map((s) => STOP.exec(s))
    .map((m) => m && { colour: `#${m[1]}`, at: Number(m[2]), mid: m[3] ? Number(m[3]) / 100 : 0.5 });
  if (stops.length < 2 || stops.length > 8 || stops.some((s) => !s || s.at > 100 || s.mid <= 0)) return null;
  return stops.every((s, i) => i === 0 || s.at >= stops[i - 1].at) ? stops : null;
}
export const isGradient = (v) => readGradient(v) !== null;
export function gradientValue(stops) {
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  return `g:${sorted.map((s, i) => {
    const mid = Math.round((s.mid ?? 0.5) * 100);
    return `${s.colour.slice(1).toLowerCase()}@${Math.round(s.at)}${i < sorted.length - 1 && mid !== 50 ? `~${mid}` : ''}`;
  }).join(',')}`;
}
// How far a blend has gone at t (0–1 of the way between two stops) when it is half done at mid: the curve
// CSS draws for a colour hint, so the bar, the disc and the smoke agree.
export const blendAt = (t, mid = 0.5) => (mid === 0.5 ? t : t ** (Math.log(0.5) / Math.log(mid)));
// The colour a gradient has at a place (0–100), as [r, g, b]: its stops in order, each blend on its curve.
export function rgbAt(stops, at) {
  const rgb = (c) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
  const last = stops[stops.length - 1];
  if (at <= stops[0].at) return rgb(stops[0].colour);
  if (at >= last.at) return rgb(last.colour);
  const i = stops.findIndex((s) => s.at >= at);
  const [a, b] = [stops[i - 1], stops[i]];
  const t = blendAt((at - a.at) / (b.at - a.at || 1), a.mid);
  const [x, y] = [rgb(a.colour), rgb(b.colour)];
  return x.map((v, k) => Math.round(v + (y[k] - v) * t));
}
export const hexOf = (rgb) => `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
// And as a plain colour, its glacier blue.
export const DEFAULT_PLAIN = 'c:5a89a1';

// A look from outside (a file of looks): only the look controls, each a real value (a slider 0–1, a
// choice one of its options). A colour in an older file is left out: looks don't change the colour.
// null when nothing is usable.
export function cleanLook(values) {
  if (!values || typeof values !== 'object') return null;
  const look = {};
  for (const c of controls) {
    if (c.look === false || !(c.key in values)) continue;
    const v = values[c.key];
    if (c.type === 'choice') {
      if (c.options.some(([o]) => o === v)) look[c.key] = v;
    } else if (c.type === 'edge') {
      if (isEdge(v)) look[c.key] = v.toLowerCase();
    } else if (typeof v === 'number' && Number.isFinite(v)) look[c.key] = Math.min(1, Math.max(0, v));
  }
  return Object.keys(look).length ? look : null;
}

// The link carries every look control that differs from its default: #flow=0.62&edges=red
export function readHash() {
  const state = { ...defaults };
  const params = new URLSearchParams(location.hash.slice(1));
  for (const c of controls) {
    if (!params.has(c.key)) continue;
    const raw = params.get(c.key);
    if (c.type === 'choice') {
      const option = c.options.find(([value]) => String(value) === raw);
      if (option) state[c.key] = option[0];
    } else if (c.type === 'edge') {
      if (isEdge(raw)) state[c.key] = raw.toLowerCase();
    } else {
      const n = Number(raw);
      if (Number.isFinite(n)) state[c.key] = Math.min(1, Math.max(0, n));
    }
  }
  return state;
}

// A drag changes the state every frame, and Safari refuses (throws) after about a hundred address changes
// in a few seconds: the link is written at once, then at most every 250 ms, and always ends on the last state.
let hashWritten = 0;
let hashTimer = 0;
export function writeHash(state) {
  clearTimeout(hashTimer);
  const wait = hashWritten + 250 - performance.now();
  if (wait > 0) {
    hashTimer = setTimeout(() => writeHash(state), wait);
    return;
  }
  hashWritten = performance.now();
  const params = new URLSearchParams();
  for (const c of controls) {
    if (c.look === false) continue;
    if (state[c.key] !== c.default) params.set(c.key, String(state[c.key]));
  }
  const hash = params.toString();
  try { history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search); } catch {}
}

// The reference clip's camera, measured on all 734 frames.
export const ORIGINAL_CAMERA = {
  theta0: -0.19549770093239827, // azimuth at the first frame
  rate: 1.0935444432884347, // radians per second (62.66° a second)
  tilt: 0.294, // 16.85° down
  halfHeight: 1 / 0.3171875, // the cube's half-edge is 203 px of the frame's 640 px half-height
};

// The reference breathes: every 1.994 s the smoke fills the cube and pulls back, first peak at 1.192 s.
export const ORIGINAL_PULSE = { period: 1.994, firstPeak: 1.192 };

// One breath of the reference, measured on every frame at full resolution and folded over its 12 beats
// (20 steps, step i centred on phase (i + 0.5) / 20, phase 0.5 = the smoke at its fullest). With the
// camera's own motion removed, the smoke's vertical motion splits into:
//   swell  how fast it spreads apart (+) or squeezes together (-), per second; the same horizontally
//   drift  the whole mass rising (+) or sinking (-), in half-edges per second
//   swirl  turning in the picture's plane (+ counter-clockwise), per second
//   energy how lively the turbulence is, relative to its average
// It bursts out right after its smallest point, floats at its fullest, then collapses faster and faster
// with a twist, and bounces straight back.
const BREATH = {
  swell: [0.0, 0.36, 0.43, 0.58, 0.62, 0.62, 0.5, 0.34, 0.25, 0.12, -0.01, -0.1, -0.18, -0.36, -0.46, -0.45, -0.52, -0.61, -0.82, -0.45],
  drift: [0.18, -0.02, 0.08, -0.09, -0.33, -0.32, -0.26, -0.17, -0.13, -0.08, -0.03, 0.0, -0.04, -0.05, -0.08, -0.09, 0.08, 0.18, 0.28, 0.21],
  swirl: [-0.25, -0.18, -0.34, -0.12, 0.03, -0.02, -0.07, -0.07, -0.03, 0.03, 0.12, 0.08, 0.14, 0.08, -0.15, -0.23, -0.1, -0.15, -0.43, -0.39],
  energy: [0.92, 0.94, 0.88, 0.89, 0.95, 0.89, 0.77, 0.68, 0.63, 0.64, 0.57, 0.57, 0.61, 0.69, 0.83, 0.82, 0.8, 0.76, 0.95, 1.03].map((e) => e / 0.79),
};

// Beat: the time between breaths (and rebounds). 0.5 is the clip's 1.994 s; it runs from a third of
// that (0.66 s) to three times (6 s), evenly to the ear.
export const beatPeriod = (beat) => ORIGINAL_PULSE.period * 3 ** ((beat - 0.5) * 2);
// Speed: how fast the smoke's time runs, breath and all. 0.5 is as it is; from a quarter to twice.
export const timeScale = (speed) => (speed < 0.5 ? 0.25 + 1.5 * speed : 1 + 2 * (speed - 0.5));

// The breath at a moment of the clip's clock, eased between the measured steps. period: the beat; the
// breath's pushes scale with it, so a slower beat goes as far, with more time between.
export function breathAt(clock, period = ORIGINAL_PULSE.period) {
  const k = period / ORIGINAL_PULSE.period;
  const phase = ((((clock - ORIGINAL_PULSE.firstPeak * k) / period + 0.5) % 1) + 1) % 1;
  const x = phase * 20 - 0.5;
  const i = Math.floor(x);
  const f = x - i;
  const w = f * f * (3 - 2 * f);
  const at = (curve) => curve[(i + 20) % 20] * (1 - w) + curve[(i + 21) % 20] * w;
  // The mass lets go of itself from the burst through the float, and pulls together for the collapse.
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hold = 1 - smooth(0.02, 0.12, phase) * (1 - smooth(0.66, 0.8, phase));
  return { swell: at(BREATH.swell) / k, drift: at(BREATH.drift) / k, swirl: at(BREATH.swirl) / k, energy: at(BREATH.energy), hold };
}

// Spin 0.5 is the reference's exact speed.
export const spinRate = (spin) => 4.374177773153739 * spin * spin;
