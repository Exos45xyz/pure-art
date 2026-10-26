// Every control in the panel, its range and its default.
// Ranges are 0–1 unless a control is a choice; the shaders map them to real units.

export const controls = [
  { group: 'Smoke', key: 'source', label: 'source', type: 'choice', default: 'volume',
    options: [['volume', 'volume'], ['plume', 'plume'], ['core', 'core']] },
  { group: 'Smoke', key: 'flow', label: 'flow', default: 0.45 },
  { group: 'Smoke', key: 'turbulence', label: 'turbulence', default: 0.5 },
  { group: 'Smoke', key: 'escape', label: 'escape', default: 0.18 },

  { group: 'Light', key: 'brightness', label: 'brightness', default: 0.5 },
  { group: 'Light', key: 'shadows', label: 'shadows', default: 0.6 },
  { group: 'Light', key: 'glow', label: 'glow', default: 0.35 },
  { group: 'Light', key: 'film', label: 'film grain', default: 0.35 },

  { group: 'Form', key: 'grain', label: 'grain size', default: 0.4 },
  { group: 'Form', key: 'spin', label: 'spin', default: 0.25 },
  { group: 'Form', key: 'edges', label: 'edges', type: 'choice', default: 'white',
    options: [['white', 'white'], ['red', 'red'], ['off', 'off']] },
  { group: 'Form', key: 'particles', label: 'particles', type: 'choice', default: 1024,
    options: [[256, '65k'], [512, '262k'], [1024, '1m']] },
];

export const defaults = Object.fromEntries(controls.map((c) => [c.key, c.default]));

// Looks only set the controls they name; particles stay as the device chose.
export const presets = {
  smoke: {},
  storm: { flow: 0.82, turbulence: 0.92, escape: 0.34, shadows: 0.78, glow: 0.5, brightness: 0.46, grain: 0.32 },
  silk: { flow: 0.22, turbulence: 0.12, escape: 0, shadows: 0.42, glow: 0.22, brightness: 0.58, grain: 0.22, spin: 0.15 },
  plume: { source: 'plume', flow: 0.55, turbulence: 0.55, escape: 0.55, shadows: 0.7, glow: 0.4 },
  core: { source: 'core', flow: 0.6, turbulence: 0.72, escape: 0.3, shadows: 0.72, glow: 0.45, brightness: 0.55 },
};

const lookKeys = controls.filter((c) => c.key !== 'particles').map((c) => c.key);

export function presetValues(name) {
  const values = {};
  for (const key of lookKeys) values[key] = defaults[key];
  return { ...values, ...presets[name] };
}

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
  };
}

// The link carries every control that differs from its default: #flow=0.62&edges=red
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
    if (c.key === 'particles') continue;
    if (state[c.key] !== c.default) params.set(c.key, String(state[c.key]));
  }
  const hash = params.toString();
  history.replaceState(null, '', hash ? `#${hash}` : location.pathname + location.search);
}
