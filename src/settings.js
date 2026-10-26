// Every control in the panel, its range and its default.
// Ranges are 0–1 unless a control is a choice; the shaders map them to real units.

export const controls = [
  { group: 'Smoke', key: 'source', label: 'source', type: 'choice',
    options: [['volume', 'volume'], ['plume', 'plume'], ['core', 'core']] },
  { group: 'Smoke', key: 'flow', label: 'flow' },
  { group: 'Smoke', key: 'turbulence', label: 'turbulence' },
  { group: 'Smoke', key: 'spread', label: 'spread' },
  { group: 'Smoke', key: 'gather', label: 'gather' },
  { group: 'Smoke', key: 'pulse', label: 'pulse' },
  { group: 'Smoke', key: 'escape', label: 'escape' },

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
  source: 'volume', flow: 0.45, turbulence: 0.5, spread: 0, gather: 0, pulse: 0, escape: 0.18,
  brightness: 0.5, shadows: 0.6, glow: 0.35, film: 0.35,
  grain: 0.4, blur: 0, focus: 0.5, spin: 0.2, lens: 'depth', edges: 'white',
};

// "original" is the reference clip: its camera (flat lens, 16.85° down, 62.66°/s), its red edges,
// no glow or grain on a pure black ground. See README › The original look.
export const presets = {
  // The reference clip's camera and movement, measured frame by frame, with the studio's particle
  // texture: see README › The original look.
  original: {
    flow: 1, turbulence: 0.1, spread: 0.45, gather: 1, pulse: 1, escape: 0,
    brightness: 0.5, shadows: 0.6, glow: 0.35, film: 0.35,
    grain: 0.4, spin: 0.5, lens: 'flat', edges: 'red',
  },
  smoke: {},
  storm: { flow: 0.82, turbulence: 0.92, escape: 0.34, shadows: 0.78, glow: 0.5, brightness: 0.46, grain: 0.32 },
  silk: { flow: 0.22, turbulence: 0.12, escape: 0, shadows: 0.42, glow: 0.22, brightness: 0.58, grain: 0.22, spin: 0.15 },
  plume: { source: 'plume', flow: 0.55, turbulence: 0.55, escape: 0.55, shadows: 0.7, glow: 0.4 },
  core: { source: 'core', flow: 0.6, turbulence: 0.72, escape: 0.3, shadows: 0.72, glow: 0.45, brightness: 0.55 },
};

export function presetValues(name) {
  return { ...base, ...presets[name] };
}

export const defaults = { ...presetValues('original'), particles: 1024, format: 'screen' };
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
    escape: r(0, 0.5),
    brightness: r(0.4, 0.62),
    shadows: r(0.35, 0.85),
    glow: r(0.15, 0.55),
    grain: r(0.2, 0.55),
    spread: Math.random() < 0.5 ? 0 : r(0.2, 0.6),
    gather: Math.random() < 0.6 ? 0 : r(0.5, 1),
    pulse: Math.random() < 0.6 ? 0 : r(0.4, 1),
    blur: Math.random() < 0.5 ? 0 : r(0.15, 0.6),
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

// How hard the pulse pushes at a point of its cycle (phase 0.5 = the smoke at its fullest). The push
// builds on the rising half and holds through the beat, so the smoke stays pressed against the glass
// for about half a second, as in the clip, then lets go.
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function pulseAt(clock) {
  const phase = ((((clock - ORIGINAL_PULSE.firstPeak) / ORIGINAL_PULSE.period + 0.5) % 1) + 1) % 1;
  // The swell takes about 0.4 s to fill the cube, so it starts that much before the beat.
  return smooth(0.02, 0.16, phase) * (1 - smooth(0.4, 0.52, phase));
}

// Spin 0.5 is the reference's exact speed.
export const spinRate = (spin) => 4.374177773153739 * spin * spin;
