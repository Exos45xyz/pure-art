import { controls, defaults, matchingPreset, presets, presetValues, shuffled } from './settings.js';

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

// A full-width row you drag anywhere on. Click jumps, drag scrubs, Shift is fine, double-click resets,
// arrows step by 1 (Shift: 10).
function slider(control, app, onChange) {
  const fill = h('div', { class: 'slider-fill' });
  const value = h('span', { class: 'slider-value' });
  const el = h('div', {
    class: 'slider', role: 'slider', tabindex: 0,
    'aria-label': control.label, 'aria-valuemin': 0, 'aria-valuemax': 100,
  }, fill, h('span', { class: 'slider-label' }, control.label), value);

  const show = (v) => {
    fill.style.transform = `translateX(${(v - 1) * 100}%)`;
    value.textContent = Math.round(v * 100);
    el.setAttribute('aria-valuenow', Math.round(v * 100));
  };
  const set = (v) => {
    v = Math.round(clamp01(v) * 100) / 100;
    show(v);
    app.set(control.key, v);
    onChange();
  };

  let start = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    const box = el.getBoundingClientRect();
    start = { x: e.clientX, value: clamp01((e.clientX - box.left) / box.width), width: box.width };
    set(start.value);
  });
  el.addEventListener('pointermove', (e) => {
    if (!start || !el.hasPointerCapture(e.pointerId)) return;
    const scale = e.shiftKey ? 0.2 : 1;
    set(start.value + ((e.clientX - start.x) / start.width) * scale);
  });
  const end = () => { start = null; el.classList.remove('dragging'); };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', () => set(defaults[control.key]));
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const now = app.state[control.key];
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(now + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(now - step);
    else if (e.key === 'Home') set(0);
    else if (e.key === 'End') set(1);
    else return;
    e.preventDefault();
  });

  return { el, sync: () => show(app.state[control.key]) };
}

// A row with its label on the left and a sliding thumb behind the chosen option.
function choice(control, app, onChange) {
  const thumb = h('div', { class: 'choice-thumb' });
  thumb.style.width = `${100 / control.options.length}%`;
  const buttons = control.options.map(([value, label], i) =>
    h('button', {
      type: 'button', role: 'radio', class: 'choice-option',
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
        next.click();
      },
    }, label));
  const group = h('div', { class: 'choice', role: 'radiogroup', 'aria-label': control.label }, thumb, buttons);
  const el = h('div', { class: 'row' }, h('span', { class: 'row-label' }, control.label), group);

  function sync() {
    const index = control.options.findIndex(([value]) => value === app.state[control.key]);
    thumb.style.transform = `translateX(${index * 100}%)`;
    buttons.forEach((b, i) => {
      b.setAttribute('aria-checked', String(i === index));
      b.tabIndex = i === index ? 0 : -1;
    });
  }
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
  };
  const syncAll = () => {
    panel.classList.add('gliding');
    fields.forEach((f) => f.sync());
    refresh();
    setTimeout(() => panel.classList.remove('gliding'), 260);
  };
  const applyLook = (values, name) => {
    app.apply(values, name);
    syncAll();
  };

  // Looks
  for (const name of Object.keys(presets)) {
    chips[name] = h('button', { type: 'button', class: 'chip', onclick: () => applyLook(presetValues(name), name) }, name);
  }
  const shuffle = () => applyLook(shuffled(app.state));
  const look = h('section', {},
    h('h2', { class: 'micro' }, 'Look'),
    h('div', { class: 'chips' }, Object.values(chips)));

  // Controls, grouped
  const groups = [...new Set(controls.map((c) => c.group))].map((group) =>
    h('section', {},
      h('h2', { class: 'micro' }, group),
      h('div', { class: 'rows' }, controls.filter((c) => c.group === group).map((c) => {
        const field = c.type === 'choice' ? choice(c, app, refresh) : slider(c, app, refresh);
        fields.push(field);
        return field.el;
      }))));

  // Actions
  const save = h('button', { type: 'button', class: 'pill pill-primary', onclick: () => saveImage() }, 'save image');
  const recordLabel = h('span', {}, 'record 8s');
  const record = h('button', { type: 'button', class: 'pill', onclick: () => recordVideo() }, h('i', { class: 'rec-dot' }), recordLabel);
  const copy = h('button', { type: 'button', class: 'pill', onclick: () => copyLink() }, 'copy link');

  const head = h('div', { class: 'panel-head' },
    h('span', { class: 'micro micro-strong' }, 'Parameters'),
    h('div', { class: 'panel-head-actions' },
      h('button', { type: 'button', class: 'text-button micro', onclick: shuffle, 'aria-label': 'Shuffle (R)' }, 'Shuffle'),
      h('button', { type: 'button', class: 'text-button micro', onclick: () => applyLook(presetValues('original'), 'original') }, 'Reset'),
      h('button', { type: 'button', class: 'text-button micro', onclick: () => setOpen(false), 'aria-label': 'Hide parameters (H)' }, 'Hide')));

  panel.append(head, look, ...groups,
    h('div', { class: 'actions' }, save, record, copy),
    h('p', { class: 'micro keys' }, 'Space pause · R shuffle · H hide'));
  fields.forEach((f) => f.sync());
  refresh();

  // Toast
  let toastTimer;
  function toast(message) {
    toastEl.textContent = message;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2200);
  }

  async function saveImage() {
    save.disabled = true;
    try {
      const size = await app.saveImage();
      toast(`image saved · ${size}`);
    } catch (e) {
      toast(e.message);
    } finally {
      save.disabled = false;
    }
  }

  async function recordVideo() {
    if (app.recording) return app.stopRecording();
    record.classList.add('recording');
    try {
      const ext = await app.recordVideo((p) => { recordLabel.textContent = `stop · ${Math.ceil(8 - p * 8)}s`; });
      toast(`video saved · ${ext}`);
    } catch (e) {
      toast(e.message);
    } finally {
      record.classList.remove('recording');
      recordLabel.textContent = 'record 8s';
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(location.href);
      toast('link copied');
    } catch {
      toast('copy the address bar to share');
    }
  }

  // Open / hide. Keyboard toggles are instant: animating something done with a shortcut feels slow.
  function setOpen(open, instant = false) {
    panel.classList.toggle('instant', instant);
    reopen.classList.toggle('instant', instant);
    panel.toggleAttribute('data-hidden', !open);
    panel.inert = !open;
    reopen.toggleAttribute('data-shown', !open);
    app.layoutChanged();
    document.body.style.setProperty('--reserve-x', `${reserve().x}px`);
  }
  reopen.addEventListener('click', () => setOpen(true));

  function reserve() {
    if (panel.hasAttribute('data-hidden')) return { x: 0, y: 0 };
    if (matchMedia('(max-width: 720px)').matches) return { x: 0, y: panel.offsetHeight + 8 };
    return { x: panel.offsetWidth + 16, y: 0 };
  }

  addEventListener('resize', () => document.body.style.setProperty('--reserve-x', `${reserve().x}px`));
  document.body.style.setProperty('--reserve-x', `${reserve().x}px`);

  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('button, [role=slider], input, a')) return;
    const key = e.key.toLowerCase();
    if (key === ' ') {
      e.preventDefault();
      toast(app.togglePause() ? 'paused' : 'playing');
    } else if (key === 'r') shuffle();
    else if (key === 's') saveImage();
    else if (key === 'h') setOpen(panel.hasAttribute('data-hidden'), true);
  });

  // The export frame drawn on screen, so you see what a 9:16, 4:5 or 1:1 file will hold.
  const guide = document.querySelector('.format-guide');
  function showFormat(format) {
    const ratio = { '9:16': 9 / 16, '4:5': 4 / 5, '1:1': 1 }[format];
    guide.toggleAttribute('data-shown', Boolean(ratio));
    if (ratio) guide.style.setProperty('--ratio', ratio);
  }

  return { reserve, toast, showFormat, sync: () => fields.forEach((f) => f.sync()) };
}
