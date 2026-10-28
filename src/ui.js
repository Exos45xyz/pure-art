import { download, stamp } from './capture.js';
import { DEFAULT_GRADIENT, DEFAULT_PLAIN, cleanLook, controls, defaults, gradientValue, hexOf, isGradient, isPlain, lookCode, lookOf, matchingPreset, plainValue, presets, presetValues, readGradient, rgbAt, sameLook, shuffled } from './settings.js';

const h = (tag, attrs = {}, ...children) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat());
  return el;
};

const clamp01 = (v) => Math.min(1, Math.max(0, v));
// Past an edge, the further something is pulled the less it follows (Apple's rubber band): a soft limit,
// never a hard stop.
const rubberband = (over, size, c = 0.55) => (over * size * c) / (size + c * over);

// A button's face: an optional mark, a check (shown while the button says it's done) and its words.
const TICK = '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M1.6 5.3 4 7.6 8.4 2.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function face(words, ...marks) {
  const tick = h('i', { class: 'tick', 'aria-hidden': 'true' });
  tick.innerHTML = TICK;
  return h('span', { class: 'face' }, ...marks, tick, h('span', { class: 'words', 'aria-live': 'polite' }, words));
}

// A full-width row you drag anywhere on. Click glides there, drag scrubs, Shift is fine, double-click resets,
// arrows step by 1 (Shift or Page keys: 10). A finger might be scrolling the sheet instead: the row waits
// until it moves sideways (a drag) or lifts where it landed (a tap), and lets a vertical swipe scroll.
function slider(control, app, onChange) {
  const fill = h('div', { class: 'slider-fill' });
  const value = h('span', { class: 'slider-value' });
  const el = h('div', {
    class: 'slider', role: 'slider', tabindex: 0, title: control.hint,
    'aria-label': control.label, 'aria-valuemin': 0, 'aria-valuemax': 100,
  }, fill, h('span', { class: 'slider-label' }, control.label), value);

  // The number follows its fill. When the fill glides (a look applied, a click far along the row, a
  // double-click back to the default), the number counts along on the same ease-out; under the hand
  // and from the keyboard both change at once.
  let shownNumber = null;
  let counting = 0;
  const showNumber = (n) => {
    shownNumber = n;
    // Most sliders read 0–100; one that has a real unit (the beat's seconds, the speed) shows that.
    value.textContent = control.format ? control.format(n) : Math.round(n * 100);
    if (control.format) el.setAttribute('aria-valuetext', value.textContent);
  };
  const show = (v, ms = 0) => {
    fill.style.transform = `translateX(${(v - 1) * 100}%)`;
    el.setAttribute('aria-valuenow', Math.round(v * 100));
    cancelAnimationFrame(counting);
    const from = shownNumber ?? v;
    if (!ms || from === v || matchMedia('(prefers-reduced-motion: reduce)').matches) return showNumber(v);
    // On the wall clock from the first frame, as the CSS glide of the fill starts when it is first drawn.
    let t0 = null;
    const count = () => {
      t0 ??= performance.now();
      const p = Math.min(1, (performance.now() - t0) / ms);
      showNumber(p < 1 ? from + (v - from) * (1 - (1 - p) ** 5) : v);
      if (p < 1) counting = requestAnimationFrame(count);
    };
    counting = requestAnimationFrame(count);
  };
  // jump: the fill glides to a value it jumped to (style.css .slider.jump), and the number counts.
  const set = (v, jump = false) => {
    v = Math.round(clamp01(v) * 100) / 100;
    el.classList.toggle('jump', jump);
    show(v, jump ? 200 : 0);
    app.set(control.key, v);
    onChange();
  };

  const at = (e) => {
    const box = el.getBoundingClientRect();
    return clamp01((e.clientX - box.left) / box.width);
  };
  // Direct manipulation is never animated, even if a look was applied a moment ago.
  const still = () => el.closest('.panel')?.classList.remove('gliding');
  let start = null;
  let touch = null;
  const scrub = (e) => set(start.value + ((e.clientX - start.x) / start.width) * (e.shiftKey ? 0.2 : 1));
  // A press glides the fill to where it landed; a drag takes over at once, 1:1, but only once the pointer
  // has really moved (3 px): the browser reports a move at the press itself, and a hand shakes a little.
  const grab = (e, x, value, jump = false) => {
    still();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    start = { x, value, width: el.getBoundingClientRect().width, moved: !jump };
    if (jump) set(value, true);
    else scrub(e);
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.pointerType === 'touch') touch = { id: e.pointerId, x: e.clientX, value: at(e) };
    else grab(e, e.clientX, at(e), true);
  });
  el.addEventListener('pointermove', (e) => {
    if (touch?.id === e.pointerId) {
      if (Math.abs(e.clientX - touch.x) < 6) return;
      const { x, value } = touch;
      touch = null;
      return grab(e, x, value);
    }
    if (!start || !el.hasPointerCapture(e.pointerId)) return;
    if (!start.moved && Math.abs(e.clientX - start.x) < 3) return;
    start.moved = true;
    scrub(e);
  });
  const end = () => { start = null; el.classList.remove('dragging'); };
  el.addEventListener('pointerup', (e) => {
    if (touch?.id === e.pointerId) {
      still();
      set(touch.value, true);
    }
    touch = null;
    end();
  });
  // The browser took the finger to scroll the sheet: the value stays as it was.
  el.addEventListener('pointercancel', () => { touch = null; end(); });
  el.addEventListener('dblclick', () => set(defaults[control.key], true));
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const now = app.state[control.key];
    // From the keyboard the value changes at once.
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(now + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(now - step);
    else if (e.key === 'PageUp') set(now + 0.1);
    else if (e.key === 'PageDown') set(now - 0.1);
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(1);
    else return;
    e.preventDefault();
  });

  return { el, sync: () => show(app.state[control.key], el.closest('.panel')?.classList.contains('gliding') ? 240 : 0) };
}

// A row with its label on the left and the chosen option lit. bare: no label, for a row that is the only
// control in its section (the section's title already names it).
function choice(control, app, onChange, bare = false) {
  // Each option's share of the row follows its words, with the same air (two letters' worth) around
  // each: a long one like 262k gets the room it needs and a short one like 1m doesn't float in a wide
  // slot.
  const weights = control.options.map(([, label]) => String(label).length + 2);
  const total = weights.reduce((a, b) => a + b, 0);
  // The row twice: the options, and over them the same words lit on the thumb's grey, clipped to the
  // chosen one. A choice moves the clip, so the grey and the bright words travel as one, with no colour
  // to time against the move (Emil Kowalski, "The magic of clip-path"). Only the clip animates.
  const lit = h('div', { class: 'choice-lit', 'aria-hidden': 'true' },
    control.options.map(([, label], i) => h('span', { style: `flex: ${weights[i]} 1 0` }, label)));
  const buttons = control.options.map(([value, label], i) =>
    h('button', {
      type: 'button', role: 'radio', class: 'choice-option', style: `flex: ${weights[i]} 1 0`,
      onclick: () => {
        app.set(control.key, value);
        sync();
        onChange();
      },
      onkeydown: (e) => {
        const n = control.options.length;
        const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        const next = buttons[(i + d + n) % n];
        next.focus();
        // Keyboard changes land at once; only clicks glide.
        lit.style.transition = 'none';
        next.click();
        requestAnimationFrame(() => requestAnimationFrame(() => { lit.style.transition = ''; }));
      },
    }, label));
  const group = h('div', { class: 'choice', role: 'radiogroup', 'aria-label': control.label }, buttons, lit);
  const el = h('div', { class: bare ? 'row bare' : 'row', title: control.hint }, bare ? [] : h('span', { class: 'row-label' }, control.label), group);

  function sync() {
    const index = control.options.findIndex(([value]) => value === app.state[control.key]);
    const before = weights.slice(0, index).reduce((a, b) => a + b, 0);
    const after = total - before - weights[index];
    lit.style.clipPath = `inset(0 ${(after / total) * 100}% 0 ${(before / total) * 100}% round 5px)`;
    buttons.forEach((b, i) => {
      b.setAttribute('aria-checked', String(i === index));
      b.tabIndex = i === index ? 0 : -1;
    });
  }
  return { el, sync };
}

// Colours as hue (0–360), saturation and brightness (0–1), the picker's own terms, and back to #rrggbb.
const hsvToHex = ({ h: hue, s, v }) => {
  const f = (n) => {
    const k = (n + hue / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return `#${[f(5), f(3), f(1)].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};
const hexToHsv = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const v = Math.max(r, g, b);
  const d = v - Math.min(r, g, b);
  const hue = d === 0 ? 0 : v === r ? ((g - b) / d + 6) % 6 : v === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: hue * 60, s: v === 0 ? 0 : d / v, v };
};
// 'abc', '#ABC', 'aabbcc' → '#aabbcc'; anything else → null.
const readHex = (text, short = true) => {
  const t = text.trim().replace(/^#/, '').toLowerCase();
  if (short && /^[0-9a-f]{3}$/.test(t)) return `#${[...t].map((c) => c + c).join('')}`;
  return /^[0-9a-f]{6}$/.test(t) ? `#${t}` : null;
};

// The eyedropper, drawn upright like the look icons and turned to lie on its side: bulb, collar, tube.
const PIPETTE = '<svg viewBox="0 0 12 12" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"><g transform="rotate(45 6 6)"><rect x="4.6" y="0.8" width="2.8" height="3.8" rx="1.4"/><path d="M3.5 4.9h5M5 4.9v4.3L6 11l1-1.8V4.9"/></g></svg>';

// The colour controls Figma has: a square of saturation (across) and brightness (down), a hue bar, an
// eyedropper where the browser has one, and the hex. A press puts the knob where it lands and a drag
// follows the hand 1:1, off the square too (pointer capture). set(hex) shows a colour; onPick(hex) hears
// every change as it happens.
function colourControls() {
  const knob = () => h('i', { class: 'picker-knob', 'aria-hidden': 'true' });
  const square = h('div', { class: 'picker-square', role: 'slider', tabindex: 0, 'aria-label': 'saturation and brightness' }, knob());
  const hue = h('div', { class: 'picker-hue', role: 'slider', tabindex: 0, 'aria-label': 'hue', 'aria-valuemin': 0, 'aria-valuemax': 360 }, knob());
  const drop = h('button', { type: 'button', class: 'picker-drop', title: 'Pick a colour from the screen', 'aria-label': 'pick a colour from the screen' });
  drop.innerHTML = PIPETTE;
  drop.hidden = !('EyeDropper' in window);
  const hex = h('input', { class: 'picker-hex', 'aria-label': 'hex', spellcheck: 'false', autocomplete: 'off', autocapitalize: 'characters', maxlength: 7 });
  const el = h('div', { class: 'picker-colour' },
    square,
    h('div', { class: 'picker-row' }, drop, hue),
    h('label', { class: 'picker-field' }, h('span', { class: 'micro' }, 'hex'), hex));

  let hsv = { h: 0, s: 0, v: 1 };
  const api = { el, onPick: null, set, focus: () => square.focus({ preventScroll: true }) };
  // Greys have no hue of their own: the square keeps the one it had instead of jumping to red.
  const keepHue = (next) => (next.s === 0 ? { ...next, h: hsv.h } : next);

  function draw() {
    const now = hsvToHex(hsv);
    el.style.setProperty('--hue', `hsl(${hsv.h} 100% 50%)`);
    el.style.setProperty('--now', now);
    square.firstChild.style.left = `${hsv.s * 100}%`;
    square.firstChild.style.top = `${(1 - hsv.v) * 100}%`;
    hue.firstChild.style.left = `calc(7px + ${hsv.h / 360} * (100% - 14px))`;
    square.setAttribute('aria-valuetext', `saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`);
    hue.setAttribute('aria-valuenow', Math.round(hsv.h));
    // The hex follows, except while it is being typed in.
    if (document.activeElement !== hex) hex.value = now.slice(1).toUpperCase();
    return now;
  }
  // A colour from outside (another stop chosen, plain or gradient) replaces what the hex shows, even while
  // it has focus: left there, it would apply to the new colour when it loses it.
  function set(colour) {
    hsv = keepHue(hexToHsv(readHex(colour) ?? '#ffffff'));
    hex.value = draw().slice(1).toUpperCase();
  }
  const change = (next) => {
    hsv = { ...hsv, ...next };
    api.onPick?.(draw());
  };

  function drag(area, at) {
    let box = null;
    area.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      area.focus({ preventScroll: true });
      area.setPointerCapture(e.pointerId);
      box = area.getBoundingClientRect();
      change(at(e, box));
    });
    area.addEventListener('pointermove', (e) => { if (box && area.hasPointerCapture(e.pointerId)) change(at(e, box)); });
    area.addEventListener('lostpointercapture', () => { box = null; });
  }
  drag(square, (e, b) => ({ s: clamp01((e.clientX - b.left) / b.width), v: 1 - clamp01((e.clientY - b.top) / b.height) }));
  drag(hue, (e, b) => ({ h: 360 * clamp01((e.clientX - b.left - 7) / (b.width - 14)) }));

  // Arrows step by 1% (or 1°), with Shift by 10; from the keyboard the knob moves at once.
  square.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 0.1 : 0.01;
    const next = { ArrowLeft: { s: hsv.s - d }, ArrowRight: { s: hsv.s + d }, ArrowUp: { v: hsv.v + d }, ArrowDown: { v: hsv.v - d } }[e.key];
    if (!next) return;
    e.preventDefault();
    change(Object.fromEntries(Object.entries(next).map(([k, v]) => [k, clamp01(v)])));
  });
  hue.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 10 : 1;
    const next = { ArrowLeft: hsv.h - d, ArrowDown: hsv.h - d, ArrowRight: hsv.h + d, ArrowUp: hsv.h + d, Home: 0, End: 360 }[e.key];
    if (next == null) return;
    e.preventDefault();
    change({ h: Math.min(360, Math.max(0, next)) });
  });

  // Six digits apply as they are typed; three (or a slip) on Enter or leaving the field.
  hex.addEventListener('input', () => {
    const v = readHex(hex.value, false);
    if (v) change(keepHue(hexToHsv(v)));
  });
  hex.addEventListener('change', () => {
    const v = readHex(hex.value);
    if (v) change(keepHue(hexToHsv(v)));
    hex.value = hsvToHex(hsv).slice(1).toUpperCase();
  });
  hex.addEventListener('focus', () => hex.select());

  drop.addEventListener('click', async () => {
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      const v = readHex(sRGBHex);
      if (v) change(keepHue(hexToHsv(v)));
    } catch {} // Escape put the eyedropper away
  });
  return api;
}

// A popover opened by a control and set beside it: beside the panel, level with the control; on a phone,
// above the sheet over it. It grows out of its control, closes on Escape, a press outside or its control
// again, or when the panel goes away, and from a key it opens and closes at once.
function popover() {
  const el = h('div', { class: 'picker', role: 'dialog', hidden: true });
  document.body.append(el);
  let anchor = null;
  let onDone = null;
  let hiding = 0;

  function place() {
    const w = el.offsetWidth;
    const ht = el.offsetHeight;
    const a = anchor.getBoundingClientRect();
    const panel = anchor.closest('.panel')?.getBoundingClientRect() ?? a;
    const ax = a.left + a.width / 2;
    const ay = a.top + a.height / 2;
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
    let left;
    let top;
    if (panel.left - 12 - w >= 16) {
      left = panel.left - 12 - w;
      top = clamp(ay - ht / 2, 16, innerHeight - 16 - ht);
      el.style.transformOrigin = `100% ${ay - top}px`;
    } else {
      left = clamp(ax - w / 2, 16, innerWidth - 16 - w);
      top = Math.max(16, panel.top - 12 - ht);
      el.style.transformOrigin = `${ax - left}px 100%`;
    }
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }

  const outside = (e) => { if (!el.contains(e.target) && !anchor?.contains(e.target)) close(); };
  const keys = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close({ instant: true, focus: true });
  };
  const resized = () => close({ instant: true });
  const moved = () => anchor && place();
  // The panel hides (H) or turns into the record window: the popover goes with it.
  const watch = new MutationObserver(() => { if (anchor?.closest('[data-hidden]')) close({ instant: true }); });

  // focus: where keyboard focus goes when it opens from a key; from a press it stays on the control, so
  // the next press closes it.
  function open(trigger, { label, done, instant = false, focus = null }) {
    if (anchor) close({ instant: true });
    anchor = trigger;
    onDone = done;
    el.setAttribute('aria-label', label);
    clearTimeout(hiding);
    el.hidden = false;
    el.classList.toggle('instant', instant);
    place();
    el.getBoundingClientRect();
    el.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keys);
    addEventListener('resize', resized);
    const panel = trigger.closest('.panel');
    panel?.addEventListener('scroll', moved, { passive: true });
    if (panel) watch.observe(panel, { attributes: true, attributeFilter: ['data-hidden'] });
    if (instant) focus?.();
  }
  function close({ instant = false, focus = false } = {}) {
    if (!anchor) return;
    const was = anchor;
    anchor = null;
    el.classList.toggle('instant', instant);
    el.classList.remove('open');
    clearTimeout(hiding);
    hiding = setTimeout(() => { el.hidden = true; }, instant ? 0 : 160);
    was.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', keys);
    removeEventListener('resize', resized);
    was.closest('.panel')?.removeEventListener('scroll', moved);
    watch.disconnect();
    const done = onDone;
    onDone = null;
    done?.();
    if (focus || el.contains(document.activeElement)) was.focus({ preventScroll: true });
  }
  return { el, open, close, isOpenOn: (trigger) => anchor === trigger, place: () => anchor && place() };
}

// The edges' colour picker: the colour controls in a popover, made the first time it opens.
let edgePicker = null;
function edgeColours() {
  if (!edgePicker) {
    edgePicker = { ...popover(), controls: colourControls() };
    edgePicker.el.append(edgePicker.controls.el);
  }
  return edgePicker;
}

// The cube's edges: white, a colour of your own, or off, as small discs in their row. Your colour opens the
// colour picker beside it and the cube follows live as you pick; it is remembered for next time.
const EDGE_KEY = 'pure-smoke-edge-colour';
function edgeField(control, app, onChange) {
  let yours = '#8ab4ff';
  try { yours = readHex(localStorage.getItem(EDGE_KEY) ?? '') ?? yours; } catch {}
  const names = { white: 'white edges', colour: 'edges in your colour', off: 'no edges' };
  const orbs = {};
  for (const [kind, label] of Object.entries(names)) {
    orbs[kind] = h('button', {
      type: 'button', role: 'radio', class: `orb orb-edge orb-edge-${kind}`, 'aria-label': label, title: label,
      onclick: (e) => pick(kind, e.detail === 0), onkeydown: (e) => step(e, kind),
    }, h('i', { class: 'orb-fill', 'aria-hidden': 'true' }));
  }
  orbs.colour.title = 'Edges in your colour (click to pick it)';
  orbs.colour.setAttribute('aria-haspopup', 'dialog');
  orbs.colour.setAttribute('aria-expanded', 'false');
  const set = (v) => {
    app.set(control.key, v);
    sync();
    onChange();
  };
  // Your colour's disc opens the picker on the colour the edges wear (a link may have brought one), and
  // closes it again.
  function pick(kind, instant) {
    if (kind !== 'colour') {
      edgePicker?.close({ instant: true });
      return set(kind);
    }
    const picker = edgeColours();
    if (picker.isOpenOn(orbs.colour)) return picker.close({ instant, focus: instant });
    const worn = readHex(app.state[control.key], false);
    if (worn) yours = worn;
    set(yours);
    picker.controls.set(yours);
    picker.controls.onPick = (hex) => {
      yours = hex;
      set(yours);
    };
    picker.open(orbs.colour, {
      label: 'edge colour',
      instant,
      focus: picker.controls.focus,
      done: () => { try { localStorage.setItem(EDGE_KEY, yours); } catch {} },
    });
  }
  const kindOf = (v) => (v === 'white' || v === 'off' ? v : 'colour');
  function sync() {
    const v = app.state[control.key];
    const on = kindOf(v);
    for (const [kind, o] of Object.entries(orbs)) {
      o.setAttribute('aria-checked', String(kind === on));
      o.tabIndex = kind === on ? 0 : -1;
    }
    orbs.colour.firstChild.style.setProperty('--edge', on === 'colour' ? (v === 'red' ? '#d1051b' : v) : yours);
  }
  // Arrows move along the orbs, as in any group of choices (the picker opens only with a click, Enter or Space).
  function step(e, kind) {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const kinds = Object.keys(orbs);
    const next = kinds[(kinds.indexOf(kind) + d + kinds.length) % kinds.length];
    orbs[next].focus();
    if (next !== 'colour') edgePicker?.close({ instant: true });
    set(next === 'colour' ? yours : next);
  }
  const el = h('div', { class: 'row', title: control.hint },
    h('span', { class: 'row-label' }, control.label),
    h('div', { class: 'edge-orbs', role: 'radiogroup', 'aria-label': control.label }, orbs.white, orbs.colour, orbs.off));
  return { el, sync };
}

export function createUI(app) {
  const panel = document.querySelector('.panel');
  const reopen = document.querySelector('.reopen');
  const toastEl = document.querySelector('.toast');
  const fields = [];
  const chips = {};

  const refresh = () => {
    const active = matchingPreset(app.state);
    for (const [name, chip] of Object.entries(chips)) chip.setAttribute('aria-pressed', String(name === active));
    showMine();
    // A control that only works with another one (focus needs blur) rests until that one is on.
    for (const { el, control } of fields) {
      if (!control.needs) continue;
      const resting = !app.state[control.needs];
      el.classList.toggle('resting', resting);
      el.setAttribute('aria-disabled', String(resting));
      el.tabIndex = resting ? -1 : 0;
    }
  };
  let glideTimer;
  const syncAll = (instant) => {
    clearTimeout(glideTimer);
    panel.classList.toggle('gliding', !instant);
    fields.forEach((f) => f.sync());
    refresh();
    glideTimer = setTimeout(() => panel.classList.remove('gliding'), 260);
  };
  // instant: from the keyboard, where an animation would only feel slow. No look changes the colour:
  // it stays whatever you chose, through looks, reset and randomize.
  // Changes made by hand (the look's sliders and choices) that a look, reset or randomize would replace,
  // when they are not kept anywhere: the toast offers them back.
  let handMade = false;
  const kept = () => matchingPreset(app.state) !== undefined || mine.some((m) => sameLook(valuesOf(m), app.state));
  const applyLook = (values, name, instant = false) => {
    const before = handMade && !kept() ? lookOf(app.state) : null;
    handMade = false;
    app.apply(values, name);
    syncAll(instant);
    if (before) {
      toast('your changes were replaced', { instant, action: { label: 'undo', run: () => {
        app.apply(before);
        syncAll(true);
        handMade = true;
      } } });
    }
  };

  // Looks: chips with a small radius, each with a line icon of its shape, drawn like the die: a thin
  // 12 px diagram in the current colour. pure breathes (two rings), aura glows (a ring in a dotted halo),
  // original is the clip's cube, ribbon a band, veil stacked sheets, rebound a path bouncing off the glass,
  // smoke a soft cloud; yours a spark.
  const ICONS = {
    pure: '<circle cx="6" cy="6" r="4.6"/><circle cx="6" cy="6" r="2"/>',
    aura: '<circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="6" r="4.8" stroke-dasharray="1.1 1.5"/>',
    original: '<path d="M6 1.3 10.2 3.7v4.6L6 10.7 1.8 8.3V3.7zM1.8 3.7 6 6.1l4.2-2.4M6 6.1v4.6"/>',
    ribbon: '<path d="M1.3 4.4c1.9-2.3 3.4 2.3 4.7 0s2.8-2.3 4.7 0M1.3 7.9c1.9-2.3 3.4 2.3 4.7 0s2.8-2.3 4.7 0"/>',
    veil: '<path d="M1.5 3.4q4.5-2.2 9 0M1.5 6.2q4.5-2.2 9 0M1.5 9q4.5-2.2 9 0"/>',
    rebound: '<rect x="1.4" y="1.4" width="9.2" height="9.2" rx="1.6"/><path d="M3.2 3.6 6 8.4l2.8-4.8"/>',
    smoke: '<path d="M3.4 9.3h5.3a2.1 2.1 0 0 0 .3-4.2 2.9 2.9 0 0 0-5.5.7 1.8 1.8 0 0 0-.1 3.5z"/>',
    mine: '<path d="M6 1.4 7 5l3.6 1L7 7l-1 3.6L5 7 1.4 6 5 5z"/>',
    save: '<path d="M6 2.4v7.2M2.4 6h7.2"/>',
    minus: '<path d="M2.4 6h7.2"/>',
    // The heads' buttons, in the same hand: a file out of or into its tray, the panel put away (to the
    // side on a computer, down on a phone), and back.
    download: '<path d="M6 1.6v6.2M3.5 5.4 6 7.9l2.5-2.5M1.8 9.2v.5c0 .7.5 1.2 1.2 1.2h6c.7 0 1.2-.5 1.2-1.2v-.5"/>',
    upload: '<path d="M6 7.9V1.7M3.5 4.2 6 1.7l2.5 2.5M1.8 9.2v.5c0 .7.5 1.2 1.2 1.2h6c.7 0 1.2-.5 1.2-1.2v-.5"/>',
    hide: '<rect x="1.3" y="2.1" width="9.4" height="7.8" rx="2"/><path d="M7.4 2.1v7.8"/>',
    lower: '<path d="M2.6 4.4 6 7.8l3.4-3.4"/>',
    back: '<path d="M7.6 2.6 4.2 6l3.4 3.4"/>',
  };
  const icon = (name, place = '') => {
    const i = h('i', { class: `look-icon ${place}`.trim(), 'aria-hidden': 'true' });
    i.innerHTML = `<svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
    return i;
  };
  const lookChip = (name, iconName, onclick) => h('button', { type: 'button', class: 'chip chip-look', onclick }, icon(iconName), h('span', {}, name));
  for (const name of Object.keys(presets)) chips[name] = lookChip(name, name, () => applyLook(presetValues(name), name));
  const shuffle = (instant = false) => applyLook(shuffled(app.state), undefined, instant);
  // Your own looks: + save appears when the look on screen is new (which also says it isn't kept yet) and
  // keeps it as a chip (mine 1, mine 2…), in this browser. The one on screen shows × beside it to remove it. Copy code turns any look into a preset for src/settings.js,
  // and the address bar link shares it with anyone.
  const MINE_KEY = 'pure-smoke-looks';
  const MAX_MINE = 6;
  let mine = [];
  try { mine = JSON.parse(localStorage.getItem(MINE_KEY)) ?? []; } catch {}
  // Dev only: a worst-case set in their place (src/dev-data.js), never written over the kept ones.
  if (app.devLooks) mine = app.devLooks;
  if (!Array.isArray(mine)) mine = [];
  mine = mine.filter((m) => typeof m?.name === 'string' && m.values && typeof m.values === 'object').slice(0, MAX_MINE);
  const keepMine = () => { if (app.devLooks) return; try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)); } catch {} };
  const valuesOf = (m) => ({ ...presetValues('smoke'), ...m.values });
  // Numbered after the highest kept, so the chips read in the order they were made.
  const nextName = () => `mine ${Math.max(0, ...mine.map((m) => Number(m.name.match(/\d+$/)?.[0]) || 0)) + 1}`;
  const saveChip = h('button', { type: 'button', class: 'chip chip-look chip-save', onclick: (e) => saveLook(e.detail === 0) }, icon('save'), h('span', {}, 'save'));
  const looksRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Look' });
  let mineChips = [];
  function drawMine() {
    mineChips = mine.map((m) => {
      // Clicked while it's the look on screen (a second click, or a double-click): its name opens to type.
      const chip = lookChip(m.name, 'mine', () => (chip.getAttribute('aria-pressed') === 'true' ? rename(m, chip) : applyLook(valuesOf(m), m.name)));
      chip.title = 'Click again to rename';
      const remove = h('button', {
        type: 'button', class: 'chip chip-look chip-remove', 'aria-label': `Remove ${m.name}`, title: `Remove ${m.name}`, hidden: true,
        onclick: () => forget(m),
      }, '×');
      return { m, chip, remove, el: h('span', { class: 'mine' }, chip, remove) };
    });
    looksRow.replaceChildren(...Object.values(chips), ...mineChips.map((c) => c.el), saveChip);
    downloadButton.hidden = !mine.length;
    showMine();
  }
  // Which of yours is on screen, and whether + save has anything new to keep.
  function showMine() {
    let found = false;
    for (const { m, chip, remove } of mineChips) {
      const on = !found && sameLook(valuesOf(m), app.state);
      found ||= on;
      chip.setAttribute('aria-pressed', String(on));
      remove.hidden = !on;
    }
    const known = found || matchingPreset(app.state) !== undefined;
    saveChip.hidden = known;
    saveChip.disabled = mine.length >= MAX_MINE;
    saveChip.title = mine.length >= MAX_MINE ? 'Six looks kept: remove one to keep another' : 'Keep this look as a chip, in this browser';
  }
  function saveLook(keyboard) {
    // A look is the smoke, its light and its form: the colour stays out of it, as it does for the presets.
    const m = { name: nextName(), values: lookOf(app.state) };
    mine.push(m);
    keepMine();
    drawMine();
    // + save is now gone (this look is a chip): keyboard focus goes to the new chip.
    if (keyboard) mineChips.at(-1).chip.focus();
  }
  // Name one of yours: the chip becomes a field in its place, Enter or a click away keeps the name,
  // Escape leaves it as it was. Names stay short (24) and their own (a taken one gets a number).
  function rename(m, chip) {
    const field = h('input', {
      class: 'chip chip-look chip-name', value: m.name, maxlength: 24, size: Math.max(4, m.name.length + 1),
      spellcheck: 'false', autocomplete: 'off', 'aria-label': `Name for ${m.name}`,
    });
    chip.replaceWith(field);
    field.focus();
    field.select();
    field.addEventListener('input', () => { field.size = Math.max(4, field.value.length + 1); });
    let done = false;
    const finish = (keep) => {
      if (done) return;
      done = true;
      const name = field.value.trim().replace(/\s+/g, ' ').slice(0, 24);
      if (keep && name && name !== m.name) {
        const taken = (n) => presets[n] || mine.some((x) => x !== m && x.name === n);
        let unique = name;
        for (let i = 2; taken(unique); i++) unique = `${name} ${i}`;
        m.name = unique;
        keepMine();
      }
      drawMine();
      mineChips.find((c) => c.m === m)?.chip.focus({ preventScroll: true });
    };
    field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    field.addEventListener('blur', () => finish(true));
  }
  // Removing one of yours can be undone for a few seconds (Sonner's action toast): it comes back in its place.
  function forget(m) {
    const at = mine.indexOf(m);
    mine = mine.filter((x) => x !== m);
    keepMine();
    drawMine();
    (saveChip.hidden ? looksRow.querySelector('button') : saveChip).focus({ preventScroll: true });
    toast(`${m.name} removed`, { action: { label: 'undo', run: () => {
      if (mine.includes(m) || mine.length >= MAX_MINE) return;
      mine.splice(Math.min(at, mine.length), 0, m);
      keepMine();
      drawMine();
    } } });
  }
  // Your looks travel as a file: download keeps them all (a small JSON file), upload brings a file of them
  // back, here or in another browser, or drop it anywhere on the page. Uploading only adds: a look you
  // already have is kept once, and six at most.
  const looksFile = h('input', {
    type: 'file', accept: '.json,application/json', hidden: true,
    onchange: () => {
      if (looksFile.files[0]) uploadLooks(looksFile.files[0]);
      looksFile.value = '';
    },
  });
  // Icons, so they don't read as labels beside the section's title; each says what it did in words.
  const downloadButton = h('button', { type: 'button', class: 'text-button micro icon-button', title: 'Download your looks as a file', 'aria-label': 'download your looks', onclick: () => downloadLooks() }, face('', icon('download')));
  const uploadButton = h('button', { type: 'button', class: 'text-button micro icon-button', title: 'Upload a file of looks you downloaded', 'aria-label': 'upload looks', onclick: () => looksFile.click() }, face('', icon('upload')));
  function downloadLooks() {
    const blob = new Blob([JSON.stringify({ app: 'pure-smoke', looks: mine }, null, 2)], { type: 'application/json' });
    download(blob, `pure-smoke-looks-${stamp()}.json`);
    sayIn(downloadButton, 'downloaded', '');
  }
  async function uploadLooks(file) {
    let looks = null;
    try { looks = JSON.parse(await file.text())?.looks; } catch {}
    if (!Array.isArray(looks)) return toast('that file has no Pure Smoke looks', { error: true });
    let added = 0;
    let full = false;
    for (const l of looks) {
      const values = cleanLook(l?.values);
      if (!values) continue;
      const m = { name: '', values };
      if (mine.some((x) => sameLook(valuesOf(x), valuesOf(m)))) continue;
      if (mine.length >= MAX_MINE) { full = true; break; }
      const given = typeof l.name === 'string' ? l.name.trim().slice(0, 24) : '';
      m.name = given && !mine.some((x) => x.name === given) && !presets[given] ? given : nextName();
      mine.push(m);
      added++;
    }
    keepMine();
    drawMine();
    if (added) sayIn(uploadButton, `${added} added`, '');
    else toast(full ? 'six looks kept: remove one to add more' : 'those looks are already here');
  }
  const look = h('section', {},
    h('div', { class: 'section-head' }, h('h2', { class: 'micro' }, 'Look'), h('span', { class: 'head-actions' }, downloadButton, uploadButton)),
    looksRow, looksFile);
  drawMine();

  // Actions
  const save = h('button', { type: 'button', class: 'pill pill-wide', onclick: () => saveImage() }, face('save image'));
  const record = h('button', { type: 'button', class: 'pill', onclick: (e) => openRecord(true, { keyboard: e.detail === 0 }) }, h('i', { class: 'rec-dot' }), 'record');
  const copy = h('button', {
    type: 'button', class: 'pill', title: 'Copy this look as code: a preset to paste into src/settings.js',
    onclick: (e) => copyCode(e.detail === 0),
  }, face('copy code'));

  // Controls. The everyday path comes first: a look, a colour, then save or share. The rest waits one
  // level deeper under Fine-tune, so a first visit asks for three choices instead of twenty.
  // A look's own controls mark the look as made by hand (see applyLook); the output's don't.
  const touched = () => {
    handMade = true;
    refresh();
  };
  const field = (control, bare = false) => {
    const onChange = control.look === false ? refresh : touched;
    const f = control.type === 'choice' ? choice(control, app, onChange, bare)
      : control.type === 'edge' ? edgeField(control, app, onChange) : slider(control, app, onChange);
    fields.push({ ...f, control });
    return f.el;
  };
  const byKey = (key) => controls.find((c) => c.key === key);
  const section = (title, ...children) => h('section', {}, h('h2', { class: 'micro' }, title), ...children);

  // A colour disc: the main shades, left to right from light, without near-black (the studio around a
  // picture): a flat band of its colours, as the palettes' discs are drawn in style.css.
  const discOf = (swatches) => {
    const light = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const shades = swatches.map((sw) => sw.color).filter((c) => light(c) > 60).sort((a, b) => light(b) - light(a));
    return shades.length > 1 ? `linear-gradient(90deg, ${shades.join(', ')})` : shades[0] ?? swatches[0]?.color ?? '#2a2a2a';
  };
  // Colour: a flat disc for each palette, filled with its own colours, and apart from them yours: your
  // gradient, and an image (+ image brings one, as do a drop or a paste anywhere on the page; it joins as
  // a disc of its own picture). Yours, pressed again while worn, open again: the gradient its editor, the
  // image the choice of another. The colour worn has a ring and its name by the title; an image's main
  // colours show below at the share of the picture each covers, the proportions the smoke wears them in.
  const fileInput = h('input', {
    type: 'file', accept: 'image/*', hidden: true,
    onchange: () => {
      if (fileInput.files[0]) loadImage(fileInput.files[0]);
      fileInput.value = '';
    },
  });
  const orbs = {};
  for (const value of ['white', 'dusk', 'pearl', 'yours', 'image']) {
    const fill = h('i', { class: 'orb-fill', 'aria-hidden': 'true' });
    orbs[value] = h('button', {
      type: 'button', role: 'radio', class: `orb orb-${value}`, 'aria-label': value, title: value,
      onclick: (e) => pressColour(value, e.detail === 0), onkeydown: (e) => stepColour(e, value),
    }, fill);
  }
  orbs.yours.title = 'Your colour: plain or a gradient (click to make it)';
  orbs.yours.setAttribute('aria-label', 'your colour');
  orbs.yours.setAttribute('aria-haspopup', 'dialog');
  orbs.yours.setAttribute('aria-expanded', 'false');
  orbs.image.hidden = true;
  // Yours: a plain colour or a gradient, made in the editor, worn by its disc, and kept in this browser
  // (only what you changed, so the defaults stay the app's own). Both start from the ice-on-rock picture.
  const YOURS_KEY = 'pure-smoke-yours';
  let gradient = DEFAULT_GRADIENT;
  let plain = DEFAULT_PLAIN;
  let yoursKind = 'gradient';
  try {
    localStorage.removeItem('pure-smoke-gradient'); // the first editor's: it gives way to the ice gradient
    const kept = JSON.parse(localStorage.getItem(YOURS_KEY) ?? '{}');
    if (isGradient(kept.gradient) && !isPlain(kept.gradient)) gradient = kept.gradient;
    if (isPlain(kept.plain)) plain = kept.plain;
    if (kept.kind === 'plain') yoursKind = 'plain';
  } catch {}
  const keepYours = () => {
    const kept = { kind: yoursKind, ...(gradient !== DEFAULT_GRADIENT && { gradient }), ...(plain !== DEFAULT_PLAIN && { plain }) };
    try { localStorage.setItem(YOURS_KEY, JSON.stringify(kept)); } catch {}
  };
  const yoursValue = () => (yoursKind === 'plain' ? plain : gradient);
  // As CSS: each colour where it sits, and where a blend's midpoint moved, a colour hint there.
  const cssGradient = (value) => {
    const stops = readGradient(value);
    const parts = stops.map((s, i) => {
      const next = stops[i + 1];
      return next && s.mid !== 0.5 ? `${s.colour} ${s.at}%, ${s.at + s.mid * (next.at - s.at)}%` : `${s.colour} ${s.at}%`;
    });
    return `linear-gradient(90deg, ${parts.join(', ')})`;
  };
  const colourKind = (v) => (isGradient(v) ? 'yours' : v);
  const colourValue = (kind) => (kind === 'yours' ? yoursValue() : kind);
  const addImage = h('button', {
    type: 'button', class: 'chip chip-add',
    title: 'Colour the smoke from an image: choose one, drop one anywhere, or paste one', onclick: () => fileInput.click(),
  }, icon('save'), h('span', {}, 'image'));
  const colourName = h('span', { class: 'micro colour-name' });
  const strip = h('div', { class: 'swatches', 'aria-hidden': 'true', hidden: true });
  let imageLabel = 'image';
  const colourField = {
    control: byKey('colour'),
    el: h('div', { class: 'colour-row' },
      h('div', { class: 'orbs', role: 'radiogroup', 'aria-label': 'Colour' },
        orbs.white, orbs.dusk, orbs.pearl, h('i', { class: 'orb-split', 'aria-hidden': 'true' }), orbs.yours, orbs.image),
      addImage),
    sync() {
      const on = colourKind(app.state.colour);
      if (on === 'yours') {
        yoursKind = isPlain(app.state.colour) ? 'plain' : 'gradient';
        if (yoursKind === 'plain') plain = app.state.colour;
        else gradient = app.state.colour;
      }
      orbs.yours.firstChild.style.background = yoursKind === 'plain' ? `#${plain.slice(2)}` : cssGradient(gradient);
      // Once there is an image its disc takes the place of + image (pressed again, it asks for another).
      addImage.hidden = !orbs.image.hidden;
      for (const [value, o] of Object.entries(orbs)) {
        o.setAttribute('aria-checked', String(value === on));
        o.tabIndex = value === on ? 0 : -1;
      }
      colourName.textContent = on === 'image' ? imageLabel : on === 'yours' ? `your ${yoursKind === 'plain' ? 'colour' : 'gradient'}` : on;
      colourName.title = on === 'image' ? imageLabel : '';
      strip.hidden = on !== 'image';
    },
  };
  fields.push(colourField);
  function wearColour(kind) {
    app.set('colour', colourValue(kind));
    colourField.sync();
    refresh();
  }
  function pressColour(kind, instant) {
    if (kind === 'yours') return editYours(instant);
    if (kind === 'image' && app.state.colour === 'image') return fileInput.click();
    editor?.close({ instant: true });
    wearColour(kind);
  }
  // Arrows move along the orbs (and wear each one), as in any group of choices.
  function stepColour(e, value) {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const shown = Object.keys(orbs).filter((v) => !orbs[v].hidden);
    const next = shown[(shown.indexOf(value) + d + shown.length) % shown.length];
    orbs[next].focus();
    if (next !== 'yours') editor?.close({ instant: true });
    wearColour(next);
  }

  // Your colour's editor, as in Paper: two tabs, a plain colour or a gradient. A plain colour is the colour
  // controls alone. Each tab keeps its own, so switching never loses the other. The gradient: a bar of it,
  // a pin under it for each colour, pointing
  // at its place, and a diamond above it for each blend, where it is half done. Press a pin to choose it and
  // drag it along; drag it well off the bar and let go to take it away. Press the bar to add a colour
  // there, in the colour the gradient already has at that place, so nothing changes until you change it.
  // Drag a diamond to move where its blend is half done (double-click puts it back in the middle). The
  // chosen colour is set below with the colour controls (two to eight colours). The smoke follows as you
  // go, and every stretch of the bar colours its share of the smoke. Made the first time it opens; kept in this browser when it closes.
  let editor = null;
  // The two tabs, drawn like Paper's: a plain square, and a square fading across.
  const KIND_ICONS = {
    plain: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><rect x="1.5" y="1.5" width="11" height="11" rx="3" fill="currentColor"/></svg>',
    gradient: '<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true"><defs><linearGradient id="kind-fade" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="currentColor"/><stop offset="1" stop-color="currentColor" stop-opacity="0.12"/></linearGradient></defs><rect x="1.5" y="1.5" width="11" height="11" rx="3" fill="url(#kind-fade)" stroke="currentColor" stroke-opacity="0.5"/></svg>',
  };
  const PIN = '<svg viewBox="0 0 18 20" aria-hidden="true"><path d="M9 1.2 16.8 7.3V17a2 2 0 0 1-2 2H3.2a2 2 0 0 1-2-2V7.3Z"/></svg>';
  function gradientEditor() {
    if (editor) return editor;
    const pop = popover();
    const controls = colourControls();
    const bar = h('div', { class: 'grad-bar', title: 'Press to add a colour here' });
    const strip = h('div', { class: 'grad' }, bar);
    // − puts the window away, back into the disc it came from (from a key, at once); a colour is added by
    // pressing the bar and taken away by dragging its pin off it, or Delete.
    const close = h('button', {
      type: 'button', class: 'text-button micro icon-button', 'aria-label': 'close', title: 'Close (Esc)',
      onclick: (e) => pop.close({ instant: e.detail === 0, focus: e.detail === 0 }),
    }, icon('minus'));
    const kinds = {
      plain: h('button', { type: 'button', role: 'radio', class: 'kind-option', 'aria-label': 'plain colour', title: 'Plain colour' }),
      gradient: h('button', { type: 'button', role: 'radio', class: 'kind-option', 'aria-label': 'gradient', title: 'Gradient' }),
    };
    kinds.plain.innerHTML = KIND_ICONS.plain;
    kinds.gradient.innerHTML = KIND_ICONS.gradient;
    for (const [kind, button] of Object.entries(kinds)) {
      button.addEventListener('click', () => setKind(kind));
      // Arrows move to the other tab and choose it, as in any group of choices.
      button.addEventListener('keydown', (e) => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
        e.preventDefault();
        const other = kind === 'plain' ? 'gradient' : 'plain';
        kinds[other].focus();
        setKind(other);
      });
    }
    pop.el.append(
      h('div', { class: 'section-head' }, h('div', { class: 'kind', role: 'radiogroup', 'aria-label': 'plain colour or gradient' }, kinds.plain, kinds.gradient), close),
      strip, controls.el);

    let stops = [];
    let chosen = null;
    let leaving = null; // a pin dragged off the bar: it goes if the hand lets go there
    const pins = new Map();
    const diamonds = new Map(); // by the stop whose blend into the next one it holds
    const kept = () => stops.filter((s) => s !== leaving);
    const sorted = () => kept().sort((a, b) => a.at - b.at);
    const atPointer = (e) => {
      const box = bar.getBoundingClientRect();
      return clamp01((e.clientX - box.left) / box.width) * 100;
    };
    // Where a blend is half done, on the bar (0–100).
    const midOf = (a, b) => a.at + a.mid * (b.at - a.at);
    // The colour the gradient has at a place (0–100), as the bar draws it.
    const colourAt = (at) => hexOf(rgbAt(sorted(), at));

    function draw() {
      const order = sorted();
      bar.style.background = cssGradient(gradientValue(order));
      for (const stop of stops) {
        let pin = pins.get(stop);
        if (!pin) {
          pin = makePin(stop);
          pins.set(stop, pin);
          strip.append(pin);
        }
        pin.style.left = `${stop.at}%`;
        pin.style.setProperty('--stop', stop.colour);
        pin.classList.toggle('chosen', stop === chosen);
        pin.classList.toggle('leaving', stop === leaving);
        pin.setAttribute('aria-valuenow', Math.round(stop.at));
        pin.setAttribute('aria-valuetext', `${stop.colour.slice(1).toUpperCase()} at ${Math.round(stop.at)}%`);
      }
      order.forEach((stop, i) => {
        const next = order[i + 1];
        let diamond = diamonds.get(stop);
        if (!next) return diamond?.remove();
        if (!diamond) {
          diamond = makeDiamond(stop);
          diamonds.set(stop, diamond);
        }
        if (!diamond.isConnected) strip.append(diamond);
        diamond.style.left = `${midOf(stop, next)}%`;
        diamond.setAttribute('aria-valuenow', Math.round(stop.mid * 100));
      });
      for (const [stop, pin] of pins) {
        if (stops.includes(stop)) continue;
        pin.remove();
        pins.delete(stop);
        diamonds.get(stop)?.remove();
        diamonds.delete(stop);
      }
      for (const [stop, diamond] of diamonds) if (stop === leaving) diamond.remove();
      bar.classList.toggle('full', stops.length >= 8);
      bar.title = stops.length >= 8 ? 'Eight colours at most: take one away to add another' : 'Press to add a colour here';
    }
    function changed() {
      gradient = gradientValue(kept());
      app.set('colour', gradient);
      colourField.sync();
      refresh();
      draw();
    }
    function choose(stop) {
      chosen = stop;
      controls.set(stop.colour);
      draw();
    }
    function drop(stop) {
      const at = stop.at;
      stops = stops.filter((s) => s !== stop);
      leaving = null;
      const nearest = [...stops].sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
      choose(nearest);
      changed();
      return nearest;
    }
    // A new colour where the gradient already has it; the blend it splits starts again from the middle.
    function addAt(at) {
      const colour = colourAt(at);
      const before = sorted().filter((s) => s.at <= at).pop();
      if (before) before.mid = 0.5;
      const stop = { colour, at: Math.round(at), mid: 0.5 };
      stops.push(stop);
      choose(stop);
      changed();
      return stop;
    }
    controls.onPick = (hex) => {
      if (yoursKind === 'plain') {
        plain = plainValue(hex);
        wearColour('yours');
        return;
      }
      chosen.colour = hex;
      changed();
    };
    function showKind() {
      for (const [kind, button] of Object.entries(kinds)) {
        button.setAttribute('aria-checked', String(kind === yoursKind));
        button.tabIndex = kind === yoursKind ? 0 : -1;
      }
      strip.hidden = yoursKind === 'plain';
      controls.set(yoursKind === 'plain' ? `#${plain.slice(2)}` : chosen.colour);
    }
    function setKind(kind) {
      if (kind === yoursKind) return;
      yoursKind = kind;
      showKind();
      wearColour('yours');
      pop.place();
    }

    // A drag follows the hand along the bar, 1:1, off it too; 28 px above or below it, the pin lets go.
    // The pin keeps the place under the hand where it was taken, instead of jumping its point there.
    function grab(stop, pin, e) {
      pin.setPointerCapture(e.pointerId);
      const box = bar.getBoundingClientRect();
      const offset = atPointer(e) - stop.at;
      const move = (ev) => {
        if (!pin.hasPointerCapture(ev.pointerId)) return;
        stop.at = Math.round(Math.min(100, Math.max(0, atPointer(ev) - offset)));
        leaving = stops.length > 2 && (ev.clientY < box.top - 28 || ev.clientY > box.bottom + 28) ? stop : null;
        changed();
      };
      const end = () => {
        pin.removeEventListener('pointermove', move);
        pin.removeEventListener('lostpointercapture', end);
        if (leaving === stop) pins.get(drop(stop))?.focus({ preventScroll: true });
      };
      pin.addEventListener('pointermove', move);
      pin.addEventListener('lostpointercapture', end);
    }
    function makePin(stop) {
      const pin = h('button', {
        type: 'button', class: 'grad-stop', role: 'slider', 'aria-label': 'colour on the gradient', 'aria-valuemin': 0, 'aria-valuemax': 100,
      });
      pin.innerHTML = PIN;
      pin.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        pin.focus({ preventScroll: true });
        choose(stop);
        grab(stop, pin, e);
      });
      pin.addEventListener('focus', () => { if (chosen !== stop) choose(stop); });
      // Arrows move it by 1% (Shift: 10); Delete or Backspace takes it away. From a key, at once.
      pin.addEventListener('keydown', (e) => {
        const d = e.shiftKey ? 10 : 1;
        const to = { ArrowLeft: stop.at - d, ArrowDown: stop.at - d, ArrowRight: stop.at + d, ArrowUp: stop.at + d, Home: 0, End: 100 }[e.key];
        if (to != null) {
          e.preventDefault();
          stop.at = Math.min(100, Math.max(0, to));
          changed();
        } else if ((e.key === 'Delete' || e.key === 'Backspace') && stops.length > 2) {
          e.preventDefault();
          pins.get(drop(stop))?.focus({ preventScroll: true });
        }
      });
      return pin;
    }
    // A blend's midpoint stays between its two colours (5–95% of the way).
    function makeDiamond(stop) {
      const diamond = h('button', {
        type: 'button', class: 'grad-mid', role: 'slider', 'aria-label': 'where the blend is half done', title: 'Drag to move where the blend is half done',
        'aria-valuemin': 5, 'aria-valuemax': 95,
      });
      const setMid = (mid) => {
        stop.mid = Math.round(Math.min(0.95, Math.max(0.05, mid)) * 100) / 100;
        changed();
      };
      const next = () => sorted()[sorted().indexOf(stop) + 1];
      let offset = 0; // where on the diamond the hand took it
      diamond.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        diamond.focus({ preventScroll: true });
        diamond.setPointerCapture(e.pointerId);
        const b = next();
        offset = b ? atPointer(e) - midOf(stop, b) : 0;
      });
      diamond.addEventListener('pointermove', (e) => {
        const b = next();
        if (!diamond.hasPointerCapture(e.pointerId) || !b) return;
        setMid((atPointer(e) - offset - stop.at) / (b.at - stop.at || 1));
      });
      diamond.addEventListener('dblclick', () => setMid(0.5));
      diamond.addEventListener('keydown', (e) => {
        const d = e.shiftKey ? 0.1 : 0.01;
        const to = { ArrowLeft: stop.mid - d, ArrowDown: stop.mid - d, ArrowRight: stop.mid + d, ArrowUp: stop.mid + d }[e.key];
        if (to == null) return;
        e.preventDefault();
        setMid(to);
      });
      return diamond;
    }
    bar.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || stops.length >= 8) return;
      e.preventDefault();
      const stop = addAt(atPointer(e));
      const pin = pins.get(stop);
      pin.focus({ preventScroll: true });
      grab(stop, pin, e);
    });

    editor = {
      ...pop,
      load(value) {
        stops = readGradient(value).map((s) => ({ ...s }));
        leaving = null;
        pins.forEach((pin) => pin.remove());
        pins.clear();
        diamonds.forEach((diamond) => diamond.remove());
        diamonds.clear();
        choose(stops[0]);
        showKind();
      },
      focus: () => (yoursKind === 'plain' ? controls.focus() : pins.get(chosen)?.focus({ preventScroll: true })),
    };
    return editor;
  }
  // Your colour's disc wears it and opens its editor; pressed again, it closes it.
  function editYours(instant) {
    const ed = gradientEditor();
    if (ed.isOpenOn(orbs.yours)) return ed.close({ instant, focus: instant });
    if (colourKind(app.state.colour) !== 'yours') wearColour('yours');
    ed.load(gradient);
    ed.open(orbs.yours, { label: 'your colour', instant, focus: ed.focus, done: keepYours });
  }
  const colour = h('section', {},
    h('div', { class: 'section-head' }, h('h2', { class: 'micro' }, 'Colour'), colourName),
    colourField.el, strip, fileInput);

  // Record opens the record window, where the frame is chosen and an image or a video is made.
  const share = section('Share', h('div', { class: 'actions' }, record, copy));

  const tuneGroups = [...new Set(controls.map((c) => c.group))].filter((g) => g !== 'Colour' && g !== 'Output');
  const tune = h('div', { class: 'tune', id: 'fine-tune' }, tuneGroups.map((group) =>
    h('section', {},
      h('h3', { class: 'micro' }, group),
      h('div', { class: 'rows' }, controls.filter((c) => c.group === group && !c.hidden).map((c) => field(c))))));
  const tuneButton = h('button', {
    type: 'button', class: 'disclosure micro', 'aria-controls': 'fine-tune', onclick: () => setTune(tune.hidden),
  }, 'Fine-tune', h('i', { class: 'chevron', 'aria-hidden': 'true' }));
  const tuneSection = h('section', {}, tuneButton, tune);

  // Fine-tune stays open or closed as each visitor left it (kept in this browser only).
  const TUNE_KEY = 'pure-smoke-fine-tune';
  const showTune = (open) => {
    tune.hidden = !open;
    tuneButton.setAttribute('aria-expanded', String(open));
  };
  function setTune(open) {
    showTune(open);
    try { localStorage.setItem(TUNE_KEY, open ? 'open' : 'closed'); } catch {}
    // On a phone the sheet grows or shrinks, so the cube (or its frame) re-centres in the space left.
    app.reframe();
    placeChrome();
    if (open && panel.scrollHeight > panel.clientHeight) {
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      tuneButton.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    }
  }
  let remembered = null;
  try { remembered = localStorage.getItem(TUNE_KEY); } catch {}
  showTune(remembered === 'open');

  // The colours in use (a bundled palette or an uploaded image), or none for white. An uploaded image
  // becomes its orb, and the strip shows its main colours at the share of the picture each one covers.
  function showColours(picked) {
    if (app.state.colour === 'image' && picked) {
      orbs.image.querySelector('.orb-fill').style.background = discOf(picked.swatches);
      orbs.image.hidden = false;
      orbs.image.setAttribute('aria-label', picked.name);
      orbs.image.title = `${picked.name} (press it again to choose another image)`;
      imageLabel = picked.name;
    }
    colourField.sync();
    if (!picked || app.state.colour !== 'image') return;
    strip.replaceChildren(...picked.swatches.map((sw) => {
      const bar = h('i', { title: `${Math.round(sw.share * 100)}%` });
      bar.style.background = sw.color;
      bar.style.flexGrow = sw.share;
      return bar;
    }));
  }

  async function loadImage(file) {
    if (!file.type.startsWith('image/')) return toast('that file is not an image', { error: true });
    try {
      await app.useImage(file);
      fields.forEach((f) => f.sync());
      refresh();
      // The orb and its strip say it where the panel shows; with the panel away, a toast does.
      if (panel.hasAttribute('data-hidden') || recordOpen) toast('image colours · same proportions');
    } catch (e) {
      toast(e.message, { error: !/cancelled/.test(e.message) });
    }
  }

  let dragDepth = 0;
  const hasFile = (e) => [...(e.dataTransfer?.items ?? [])].some((item) => item.kind === 'file');
  const dropText = document.querySelector('.dropzone p');
  addEventListener('dragenter', (e) => {
    if (!hasFile(e)) return;
    // The drop says what it will do: colour the smoke, or add looks from a file.
    const looksFile = [...e.dataTransfer.items].some((item) => item.type === 'application/json');
    dropText.innerHTML = looksFile ? '<b>Drop the file</b> to add its looks' : '<b>Drop an image</b> to colour the smoke';
    dragDepth++;
    document.body.classList.add('dropping');
  });
  addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('dropping');
  });
  addEventListener('dragover', (e) => e.preventDefault());
  addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dropping');
    const files = [...e.dataTransfer.files];
    const image = files.find((f) => f.type.startsWith('image/'));
    const looksJson = files.find((f) => f.type === 'application/json' || f.name.endsWith('.json'));
    if (image) loadImage(image);
    else if (looksJson) uploadLooks(looksJson);
  });
  // Paste an image (⌘V) to colour the smoke with it, as + image or a drop does.
  addEventListener('paste', (e) => {
    const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!image) return;
    e.preventDefault();
    loadImage(image);
  });

  const head = h('div', { class: 'panel-head' },
    h('span', { class: 'micro micro-strong' }, 'Parameters'),
    h('button', {
      type: 'button', class: 'text-button micro icon-button', onclick: () => setOpen(false),
      'aria-label': 'Hide parameters (H)', title: 'Hide parameters (H)', 'aria-keyshortcuts': 'H',
    }, icon('hide', 'on-wide'), icon('lower', 'on-phone')));
  // The two buttons people reach for first: a new random look, or back to the default look. Randomize
  // carries its key (R) where the eye already is, for anyone with a keyboard.
  const die = h('span', { class: 'die', 'aria-hidden': 'true' });
  const quick = h('div', { class: 'quick' },
    h('button', {
      type: 'button', class: 'pill pill-randomize', title: 'Randomize (R)', 'aria-keyshortcuts': 'R',
      onclick: (e) => { rollDie(e.detail === 0); shuffle(); },
    }, die, 'randomize', h('kbd', { class: 'key micro', 'aria-hidden': 'true' }, 'R')),
    h('button', { type: 'button', class: 'pill', onclick: () => applyLook(presetValues('pure'), 'pure') }, 'reset'));
  // The die rolls: a quarter turn (a die looks the same each quarter) that lands on a new face, never the
  // one it showed, so the icon says a new random look came up. From a key: the new face, without the turn.
  const PIPS = [null,
    [[8, 8]],
    [[5.2, 5.2], [10.8, 10.8]],
    [[5.2, 5.2], [8, 8], [10.8, 10.8]],
    [[5.2, 5.2], [10.8, 5.2], [5.2, 10.8], [10.8, 10.8]],
    [[5.2, 5.2], [10.8, 5.2], [8, 8], [5.2, 10.8], [10.8, 10.8]],
    [[5.2, 4.9], [10.8, 4.9], [5.2, 8], [10.8, 8], [5.2, 11.1], [10.8, 11.1]]];
  let dieFace = 3;
  let turns = 0;
  function showFace(n) {
    dieFace = n;
    const r = n === 6 ? 1 : 1.15;
    die.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.3"/>'
      + PIPS[n].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="currentColor"/>`).join('') + '</svg>';
  }
  function rollDie(instant) {
    showFace(1 + ((dieFace + Math.floor(Math.random() * 5)) % 6));
    if (instant) return;
    turns += 1;
    die.style.transform = `rotate(${turns * 90}deg)`;
  }
  showFace(dieFace);

  const grabber = h('i', { class: 'grabber', 'aria-hidden': 'true' });
  panel.append(grabber, head, quick, look, colour, share, tuneSection,
    h('p', { class: 'micro keys' }, 'Space pause · R randomize · H hide'));
  fields.forEach((f) => f.sync());
  refresh();

  // Toast, with Sonner's manners: it stays long enough to read (a longer message, longer), its clock
  // stops while the page is hidden (a video can finish while you are in another tab), and a message
  // that replaces one on screen blurs across instead of snapping. One with an action (undo) stays 5 s,
  // holds while the pointer is on it, and swipes down to go; an error carries a small mark.
  // opts: true (raised by a key: appears at once, still fades out), or { instant, error, action: { label, run } }.
  let toastTimer;
  let toastLeft = 0;
  let toastSince = 0;
  let toastTicking = false;
  let toastHovered = false;
  let undoable = null; // the action of the toast on screen, for ⌘Z

  function toast(message, opts = {}) {
    const { instant = false, error = false, action = null } = typeof opts === 'boolean' ? { instant: opts } : opts;
    const body = h('span', { class: 'toast-body' },
      error ? h('i', { class: 'toast-mark', 'aria-hidden': 'true' }, '!') : [],
      h('span', {}, message),
      action ? h('button', { type: 'button', class: 'toast-action', onclick: () => { action.run(); hideToast(); } }, action.label) : []);
    const replacing = toastEl.classList.contains('show') && !instant;
    toastEl.replaceChildren(body);
    if (replacing) {
      body.animate([{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0)' }],
        { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    }
    toastEl.style.transform = '';
    toastEl.classList.toggle('instant', instant);
    toastEl.classList.toggle('actionable', !!action);
    undoable = action?.run ?? null;
    toastEl.classList.add('show');
    if (!action) toastHovered = false;
    toastLeft = action ? 5000 : Math.max(2000, 1200 + message.length * 45);
    runToastClock();
  }
  function hideToast() {
    undoable = null;
    clearTimeout(toastTimer);
    toastTicking = false;
    toastEl.classList.remove('show', 'instant', 'actionable');
  }
  function runToastClock() {
    clearTimeout(toastTimer);
    toastTicking = false;
    if (document.hidden || toastHovered) return;
    toastTicking = true;
    toastSince = performance.now();
    toastTimer = setTimeout(hideToast, toastLeft);
  }
  function holdToastClock() {
    if (!toastTicking) return;
    clearTimeout(toastTimer);
    toastTicking = false;
    toastLeft -= performance.now() - toastSince;
  }
  document.addEventListener('visibilitychange', () => {
    if (!toastEl.classList.contains('show')) return;
    if (document.hidden) holdToastClock();
    else runToastClock();
  });
  // Only a toast with an action takes the pointer: it holds while the pointer is on it, and a swipe down
  // (far enough, or quick enough: a flick) sends it away; a short one springs back.
  toastEl.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    toastHovered = true;
    holdToastClock();
  });
  toastEl.addEventListener('pointerleave', () => {
    toastHovered = false;
    if (toastEl.classList.contains('show')) runToastClock();
  });
  let swipe = null;
  toastEl.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.toast-action')) return;
    toastEl.setPointerCapture(e.pointerId);
    swipe = { y: e.clientY, t: performance.now(), dy: 0 };
    toastEl.style.transition = 'none';
    holdToastClock();
  });
  toastEl.addEventListener('pointermove', (e) => {
    if (!swipe) return;
    const dy = e.clientY - swipe.y;
    // Upward it resists (there is nowhere to go), downward it follows the hand.
    swipe.dy = dy > 0 ? dy : dy / (1 + Math.abs(dy) / 12);
    toastEl.style.transform = `translate(-50%, ${swipe.dy}px)`;
  });
  const endSwipe = () => {
    if (!swipe) return;
    const { dy, t } = swipe;
    swipe = null;
    toastEl.style.transition = '';
    if (dy > 30 || dy / (performance.now() - t) > 0.11) {
      toastEl.style.transform = `translate(-50%, ${dy + 24}px)`;
      hideToast();
    } else {
      toastEl.style.transform = '';
      runToastClock();
    }
  };
  toastEl.addEventListener('pointerup', endSwipe);
  toastEl.addEventListener('pointercancel', endSwipe);

  // A button says what it just did in its own place, where the eye already is, then its own words again
  // after 1.5 s. The words crossfade through a slight blur, so one reads as turning into the next; from
  // a key they change at once. rest: the words to go back to.
  const saying = new WeakMap();
  function sayIn(button, words, rest, instant = false) {
    const f = button.querySelector('.face');
    const show = (text, done, fade) => {
      f.querySelector('.words').textContent = text;
      button.classList.toggle('done', done);
      if (fade) f.animate([{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0)' }], { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    };
    clearTimeout(saying.get(button));
    if (!button.classList.contains('done') || f.querySelector('.words').textContent !== words) show(words, true, !instant);
    saying.set(button, setTimeout(() => show(rest, false, true), 1500));
  }
  // Before a button starts something new, it stops saying what it did last.
  function hush(button) {
    clearTimeout(saying.get(button));
    button.classList.remove('done');
  }

  // A large image takes a second or two to encode: the button says so while it does, then that it's
  // saved. From the S key (the record window closed, the button out of sight) a toast says it.
  async function saveImage() {
    if (save.getAttribute('aria-busy') === 'true') return;
    const words = save.querySelector('.words');
    hush(save);
    save.disabled = true;
    save.setAttribute('aria-busy', 'true');
    words.textContent = 'saving…';
    try {
      const size = await app.saveImage();
      if (recordOpen) sayIn(save, `saved · ${size}`, 'save image');
      else {
        words.textContent = 'save image';
        toast(`image saved · ${size}`);
      }
    } catch (e) {
      words.textContent = 'save image';
      toast(e.message, { error: true });
    } finally {
      save.disabled = false;
      save.removeAttribute('aria-busy');
    }
  }

  // The record window, in the panel's place: choose the frame (the canvas becomes it), then save an
  // image of it or record a video. Each option names itself, so the rows need no labels.
  const start = h('button', { type: 'button', class: 'pill pill-primary pill-start', onclick: () => recordVideo() },
    face('start recording', h('i', { class: 'rec-dot' })));
  const startLabel = start.querySelector('.words');
  // Progress is a progressbar, not a live region: a screen reader can ask for it, instead of hearing
  // every percent read out. The toast announces the end.
  const statusText = h('span');
  const statusFill = h('i');
  const statusBar = h('div', { class: 'bar', role: 'progressbar', 'aria-label': 'Recording', 'aria-valuemin': 0, 'aria-valuemax': 100 }, statusFill);
  const status = h('div', { class: 'record-status', hidden: true },
    h('p', { class: 'micro', 'aria-hidden': 'true' }, statusText),
    statusBar);
  const back = h('button', {
    type: 'button', class: 'text-button micro icon-button', 'aria-label': 'Back to parameters (Esc)', title: 'Back to parameters (Esc)',
    onclick: (e) => openRecord(false, { keyboard: e.detail === 0 }),
  }, icon('back'));
  const frameRow = h('div', { class: 'rows' }, field(byKey('format'), true));
  const recordRows = h('div', { class: 'rows' }, ['length', 'loop', 'fps'].map((key) => field(byKey(key), true)));
  const recordPanel = h('aside', { class: 'panel record-panel', 'aria-label': 'Record', 'data-hidden': true, tabindex: -1 },
    h('div', { class: 'panel-head' }, h('span', { class: 'head-title' }, back, h('span', { class: 'micro micro-strong' }, 'Record'))),
    section('Frame', frameRow, save),
    section('Video', recordRows, start, status),
    h('p', { class: 'micro keys' }, 'Esc back · cancel'));
  recordPanel.inert = true;
  document.body.append(recordPanel);
  // Its rows came after the first sync above: show their choices too (8 s and 60 fps, not the first).
  fields.forEach((f) => f.sync());

  // The record window is a level below the parameters: it turns in like a page while the canvas glides
  // into the frame (main.js), and Back turns it out again. From a key it changes at once, and keyboard
  // focus follows into the window and back to the button that opened it.
  let recordOpen = false;
  let pagingTimer;
  function openRecord(open, { instant = false, keyboard = false } = {}) {
    if (app.recording || open === recordOpen) return;
    recordOpen = open;
    panel.classList.toggle('instant', instant);
    recordPanel.classList.toggle('instant', instant);
    document.body.classList.add('paging');
    clearTimeout(pagingTimer);
    pagingTimer = setTimeout(() => document.body.classList.remove('paging'), 400);
    document.body.classList.toggle('record-mode', open);
    panel.toggleAttribute('data-hidden', open);
    panel.inert = open;
    recordPanel.toggleAttribute('data-hidden', !open);
    recordPanel.inert = !open;
    reopen.toggleAttribute('data-shown', false);
    app.reframe(instant, true);
    placeChrome();
    if (keyboard) (open ? recordPanel : record).focus({ preventScroll: true });
  }

  async function recordVideo() {
    if (app.recording) return app.stopRecording();
    if (save.getAttribute('aria-busy') === 'true') return;
    hush(start);
    const { length, loop, fps } = app.state;
    const doing = app.canLoop ? `${length} s ${loop === 'loop' ? 'loop' : 'video'} · ${fps} fps` : `${length} s live`;
    const show = (p) => {
      statusText.textContent = `${doing} · ${Math.floor(p * 100)}%`;
      statusFill.style.transform = `scaleX(${p})`;
      statusBar.setAttribute('aria-valuenow', Math.floor(p * 100));
      statusBar.setAttribute('aria-valuetext', statusText.textContent);
    };
    show(0);
    status.hidden = false;
    startLabel.textContent = 'cancel';
    start.classList.add('recording');
    back.disabled = true;
    // The settings hold still while a video is being made.
    recordRows.inert = frameRow.inert = save.disabled = true;
    let saved = null;
    try {
      const ext = await app.recordVideo(show);
      saved = `${app.canLoop && loop === 'loop' ? 'loop' : 'video'} saved · ${ext}`;
    } catch (e) {
      toast(e.message, { error: !/cancelled/.test(e.message) });
    } finally {
      status.hidden = true;
      startLabel.textContent = 'start recording';
      start.classList.remove('recording');
      back.disabled = false;
      recordRows.inert = frameRow.inert = save.disabled = false;
    }
    // The button says it's saved, where the eye is, then start recording again.
    if (saved) sayIn(start, saved, 'start recording');
  }

  // The look as code (every parameter, as a preset for src/settings.js), for anyone building on it. The
  // button says it's copied; the code's first line says where it goes.
  async function copyCode(instant = false) {
    try {
      await navigator.clipboard.writeText(lookCode(app.state));
      sayIn(copy, 'copied', 'copy code', instant);
    } catch {
      toast('this browser blocked the clipboard', { error: true });
    }
  }


  // Open / hide. Keyboard toggles are instant: animating something done with a shortcut feels slow.
  function setOpen(open, instant = false) {
    panel.classList.toggle('instant', instant);
    reopen.classList.toggle('instant', instant);
    panel.toggleAttribute('data-hidden', !open);
    panel.inert = !open;
    reopen.toggleAttribute('data-shown', !open);
    app.reframe(instant);
    placeChrome();
  }
  reopen.addEventListener('click', () => setOpen(true));

  // On a phone the panel is a sheet, and it goes away as a sheet does: drag its head (or the grabber) down
  // and it follows the finger 1:1; let go past half its height, or flick it, and it goes, the flick's speed
  // projected to where it would come to rest (iOS's v·0.998 / (1 − 0.998)); otherwise it settles back.
  // Pulled up, it resists more the further it goes. The panel's own transitions (style.css) carry it on
  // from wherever the finger left it. A touch that hasn't moved 6 px is still a tap.
  const sheetDrag = { id: null, y: 0, dy: 0, moving: false, samples: [] };
  panel.addEventListener('pointerdown', (e) => {
    if (!phone() || e.button !== 0 || recordOpen || panel.hasAttribute('data-hidden')) return;
    if (!e.target.closest('.panel-head, .grabber') || e.target.closest('button')) return;
    Object.assign(sheetDrag, { id: e.pointerId, y: e.clientY, dy: 0, moving: false, samples: [[e.timeStamp, e.clientY]] });
    panel.setPointerCapture(e.pointerId);
  });
  panel.addEventListener('pointermove', (e) => {
    if (e.pointerId !== sheetDrag.id) return;
    const dy = e.clientY - sheetDrag.y;
    if (!sheetDrag.moving && Math.abs(dy) < 6) return;
    sheetDrag.moving = true;
    sheetDrag.samples.push([e.timeStamp, e.clientY]);
    if (sheetDrag.samples.length > 5) sheetDrag.samples.shift();
    sheetDrag.dy = dy >= 0 ? dy : -rubberband(-dy, panel.offsetHeight);
    panel.style.transition = 'none';
    panel.style.transform = `translateY(${sheetDrag.dy}px)`;
  });
  const letGo = (e) => {
    if (e.pointerId !== sheetDrag.id) return;
    sheetDrag.id = null;
    if (!sheetDrag.moving) return;
    const [t0, y0] = sheetDrag.samples[0];
    const [t1, y1] = sheetDrag.samples[sheetDrag.samples.length - 1];
    const speed = t1 > t0 ? ((y1 - y0) / (t1 - t0)) * 1000 : 0; // px a second, down positive
    const rest = sheetDrag.dy + (speed / 1000) * (0.998 / (1 - 0.998));
    panel.style.transition = '';
    panel.style.transform = '';
    if (rest > panel.offsetHeight / 2) setOpen(false);
  };
  panel.addEventListener('pointerup', letGo);
  panel.addEventListener('pointercancel', letGo);

  const shownPanel = () => (recordOpen ? recordPanel : panel.hasAttribute('data-hidden') ? null : panel);
  const phone = () => matchMedia('(max-width: 720px)').matches;
  const brandEl = document.querySelector('.brand');
  const footEl = document.querySelector('.foot');

  function reserve() {
    const shown = shownPanel();
    if (!shown) return { x: 0, y: 0 };
    // On a phone the cube sits in the band between the title and the sheet, clear of both.
    if (phone()) return { x: 0, y: shown.offsetHeight + 8 - (brandEl.offsetTop + brandEl.offsetHeight) };
    return { x: shown.offsetWidth + 16, y: 0 };
  }

  // The frame a file is recorded in, in page pixels: the format's shape, as large as fits in the free
  // space between the title, the footer and the panel. aspect: width / height.
  function frameBox(aspect) {
    const shown = shownPanel();
    const top = brandEl.offsetTop + brandEl.offsetHeight + (phone() ? 16 : 24);
    let left = phone() ? 16 : 24;
    let right = innerWidth - (phone() ? 16 : 24);
    let bottom = innerHeight - (phone() ? 16 : footEl.offsetHeight + 44);
    if (shown && phone()) bottom = innerHeight - shown.offsetHeight - 24;
    if (shown && !phone()) right = innerWidth - shown.offsetWidth - 40;
    const room = { w: Math.max(80, right - left), h: Math.max(80, bottom - top) };
    const w = Math.round(Math.min(room.w, room.h * aspect));
    const h = Math.round(w / aspect);
    return { x: Math.round(left + (room.w - w) / 2), y: Math.round(top + (room.h - h) / 2), w, h };
  }

  // The page's own chrome follows the panel: messages centre in the free space, and on a phone they
  // sit just above the sheet, where the eye already is.
  function placeChrome() {
    document.body.style.setProperty('--reserve-x', `${reserve().x}px`);
    document.body.style.setProperty('--sheet', `${shownPanel()?.offsetHeight ?? 0}px`);
  }
  addEventListener('resize', placeChrome);
  placeChrome();

  addEventListener('keydown', (e) => {
    // ⌘Z (Ctrl+Z) does what the undo toast on screen offers.
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && undoable && !e.target.closest('input, textarea')) {
      e.preventDefault();
      undoable();
      hideToast();
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    // While recording, keys only cancel: Escape. In the record window, Escape goes back.
    if (app.recording) {
      if (e.key === 'Escape') app.stopRecording();
      return;
    }
    if (recordOpen) {
      if (e.key === 'Escape') openRecord(false, { instant: true, keyboard: true });
      return;
    }
    // Typing a look's name: the keys are the name's.
    if (e.target.closest('input, textarea')) return;
    // Space presses a focused button (or steps nothing on a slider) by itself, so it pauses only from
    // elsewhere. The letters work wherever else focus is: a click leaves focus on the button it pressed.
    const key = e.key.toLowerCase();
    if (key === ' ') {
      if (e.target.closest('button, [role=slider], input, a')) return;
      e.preventDefault();
      toast(app.togglePause() ? 'paused' : 'playing', true);
    } else if (key === 'r') {
      rollDie(true);
      shuffle(true);
    }
    else if (key === 's') saveImage();
    else if (key === 'h') setOpen(panel.hasAttribute('data-hidden'), true);
  });

  // Phones have no footer hint: if nobody has touched the cube a few seconds in, say what it does.
  if (matchMedia('(pointer: coarse)').matches) {
    let touched = false;
    document.querySelector('canvas').addEventListener('pointerdown', () => { touched = true; }, { once: true });
    setTimeout(() => { if (!touched) toast('drag to turn the cube'); }, 3500);
  }

  return { reserve, frameBox, get recordOpen() { return recordOpen; }, toast, showColours, pickImage: () => fileInput.click(), sync: () => fields.forEach((f) => f.sync()) };
}
