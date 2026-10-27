// Every control in the panel, its range and its default.
// Ranges are 0–1 unless a control is a choice; the shaders map them to real units.

export const controls = [
  { group: 'Colour', key: 'colour', label: 'colour', type: 'choice', look: false,
    options: [['white', 'white'], ['dusk', 'dusk'], ['pearl', 'pearl'], ['image', 'image']] },

  { group: 'Smoke', key: 'source', label: 'source', type: 'choice',
    options: [['volume', 'volume'], ['plume', 'plume'], ['core', 'core']] },
  { group: 'Smoke', key: 'flow', label: 'flow' },
  { group: 'Smoke', key: 'turbulence', label: 'turbulence' },
  { group: 'Smoke', key: 'spread', label: 'spread' },
  { group: 'Smoke', key: 'gather', label: 'gather' },
  { group: 'Smoke', key: 'pulse', label: 'pulse' },
  { group: 'Smoke', key: 'escape', label: 'escape' },
  { group: 'Smoke', key: 'rebound', label: 'rebound' },

  { group: 'Light', key: 'brightness', label: 'brightness' },
  { group: 'Light', key: 'shadows', label: 'shadows' },
  { group: 'Light', key: 'glow', label: 'glow' },
  { group: 'Light', key: 'film', label: 'film grain' },

  { group: 'Particles', key: 'particles', label: 'count', type: 'choice', look: false,
    options: [[256, '65k'], [512, '262k'], [1024, '1m'], [1448, '2m'], [2048, '4m']] },
  { group: 'Particles', key: 'grain', label: 'size' },
  { group: 'Particles', key: 'blur', label: 'blur' },
  { group: 'Particles', key: 'focus', label: 'focus' },

  { group: 'Form', key: 'spin', label: 'spin' },
  { group: 'Form', key: 'lens', label: 'lens', type: 'choice', options: [['flat', 'flat'], ['depth', 'depth']] },
  { group: 'Form', key: 'edges', label: 'edges', type: 'choice',
    options: [['white', 'white'], ['red', 'red'], ['off', 'off']] },

  { group: 'Output', key: 'format', label: 'format', type: 'choice', look: false,
    options: [['screen', 'screen'], ['9:16', '9:16'], ['4:5', '4:5'], ['1:1', '1:1']] },
];

// The studio look every other look starts from.
const base = {
  source: 'volume', flow: 0.45, turbulence: 0.5, spread: 0, gather: 0, pulse: 0, escape: 0, rebound: 0.5,
  brightness: 0.5, shadows: 0.6, glow: 0.35, film: 0.35,
  grain: 0.4, blur: 0, focus: 0.5, spin: 0.2, lens: 'depth', edges: 'white',
};

// "original" is the reference clip's camera (flat lens, 16.85° down, 62.66°/s) and red edges.
// See README › The original look.
export const presets = {
  // Romain's look: the clip's breath through a depth lens, fine filaments, sharp grains, sealed glass.
  pure: {
    flow: 0.45, turbulence: 0.51, spread: 0, gather: 0.98, pulse: 1, escape: 0,
    brightness: 0.5, shadows: 0.6, glow: 0.35, film: 0.42,
    grain: 0.4, blur: 0, focus: 0.5, spin: 0.13, lens: 'depth', edges: 'white',
  },
  // The reference clip's camera, edges and breath, with pure's smoke and particles: the clip's own
  // speed (flow 1) washes the strands into fog, so the smoke keeps pure's pace.
  original: {
    flow: 0.45, turbulence: 0.51, spread: 0, gather: 0.98, pulse: 1, escape: 0,
    brightness: 0.5, shadows: 0.6, glow: 0.35, film: 0.42,
    grain: 0.4, blur: 0, focus: 0.5, spin: 0.5, lens: 'flat', edges: 'red',
  },
  smoke: {},
  storm: { flow: 0.82, turbulence: 0.92, shadows: 0.78, glow: 0.5, brightness: 0.46, grain: 0.32 },
  silk: { flow: 0.22, turbulence: 0.12, escape: 0, shadows: 0.42, glow: 0.22, brightness: 0.58, grain: 0.22, spin: 0.15 },
  plume: { source: 'plume', flow: 0.55, turbulence: 0.55, shadows: 0.7, glow: 0.4 },
  core: { source: 'core', flow: 0.6, turbulence: 0.72, shadows: 0.72, glow: 0.45, brightness: 0.55 },
};

export function presetValues(name) {
  return { ...base, ...presets[name] };
}

export const defaults = { ...presetValues('pure'), particles: 1024, format: 'screen', colour: 'white' };
for (const c of controls) c.default = defaults[c.key];

const lookKeys = controls.filter((c) => c.look !== false).map((c) => c.key);

export function matchingPreset(state) {
  return Object.keys(presets).find((name) => {
    const look = presetValues(name);
    return lookKeys.every((key) => look[key] === state[key]);
  });
}

// Random but always good-looking: every range is kept inside what reads well.
export function shuffled(state) {
  const r = (a, b) => Math.round((a + Math.random() * (b - a)) * 100) / 100;
  return {
    ...state,
    source: ['volume', 'volume', 'plume', 'core'][Math.floor(Math.random() * 4)],
    flow: r(0.2, 0.85),
    turbulence: r(0.1, 0.95),
    // Randomize never opens the glass: the smoke stays in the cube. Escape is a choice you make.
    escape: 0,
    rebound: r(0.25, 0.85),
    brightness: r(0.4, 0.62),
    shadows: r(0.35, 0.85),
    glow: r(0.15, 0.55),
    grain: r(0.2, 0.55),
    spread: Math.random() < 0.5 ? 0 : r(0.2, 0.6),
    gather: Math.random() < 0.6 ? 0 : r(0.5, 1),
    pulse: Math.random() < 0.6 ? 0 : r(0.4, 1),
    // Every grain stays sharp: blur is a choice you make.
    blur: 0,
    focus: r(0.3, 0.7),
  };
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
    } else {
      const n = Number(raw);
      if (Number.isFinite(n)) state[c.key] = Math.min(1, Math.max(0, n));
    }
  }
  return state;
}

export function writeHash(state) {
  const params = new URLSearchParams();
  for (const c of controls) {
    if (c.look === false) continue;
    if (state[c.key] !== c.default) params.set(c.key, String(state[c.key]));
  }
  const hash = params.toString();
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
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

// The breath at a moment of the clip's clock, eased between the measured steps.
export function breathAt(clock) {
  const phase = ((((clock - ORIGINAL_PULSE.firstPeak) / ORIGINAL_PULSE.period + 0.5) % 1) + 1) % 1;
  const x = phase * 20 - 0.5;
  const i = Math.floor(x);
  const f = x - i;
  const w = f * f * (3 - 2 * f);
  const at = (curve) => curve[(i + 20) % 20] * (1 - w) + curve[(i + 21) % 20] * w;
  // The mass lets go of itself from the burst through the float, and pulls together for the collapse.
  const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const hold = 1 - smooth(0.02, 0.12, phase) * (1 - smooth(0.66, 0.8, phase));
  return { swell: at(BREATH.swell), drift: at(BREATH.drift), swirl: at(BREATH.swirl), energy: at(BREATH.energy), hold };
}

// Spin 0.5 is the reference's exact speed.
export const spinRate = (spin) => 4.374177773153739 * spin * spin;
