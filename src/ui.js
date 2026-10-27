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
    // Direct manipulation is never animated, even if a look was applied a moment ago.
    el.closest('.panel')?.classList.remove('gliding');
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
        // Keyboard changes land at once; only clicks glide.
        thumb.style.transition = 'none';
        next.click();
        requestAnimationFrame(() => requestAnimationFrame(() => { thumb.style.transition = ''; }));
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
  let glideTimer;
  const syncAll = (instant) => {
    clearTimeout(glideTimer);
    panel.classList.toggle('gliding', !instant);
    fields.forEach((f) => f.sync());
    refresh();
    glideTimer = setTimeout(() => panel.classList.remove('gliding'), 260);
  };
  // instant: from the keyboard, where an animation would only feel slow.
  const applyLook = (values, name, instant = false) => {
    app.apply(values, name);
    syncAll(instant);
  };

  // Looks
  for (const name of Object.keys(presets)) {
    chips[name] = h('button', { type: 'button', class: 'chip', onclick: () => applyLook(presetValues(name), name) }, name);
  }
  const shuffle = (instant = false) => applyLook(shuffled(app.state), undefined, instant);
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

  // Colour from an image: the upload button, or drop one anywhere on the page.
  const colourRows = groups[0].querySelector('.rows');
  const fileInput = h('input', {
    type: 'file', accept: 'image/*', hidden: true,
    onchange: () => {
      if (fileInput.files[0]) loadImage(fileInput.files[0]);
      fileInput.value = '';
    },
  });
  const thumb = h('img', { class: 'image-thumb', alt: '' });
  const strip = h('div', { class: 'swatches', 'aria-hidden': 'true' });
  const imageName = h('span', { class: 'image-name' });
  const imageRow = h('div', { class: 'image-row', hidden: true }, thumb, h('div', { class: 'image-meta' }, imageName, strip));
  const upload = h('button', { type: 'button', class: 'pill pill-upload', onclick: () => fileInput.click() }, 'upload image');
  colourRows.append(imageRow, upload, fileInput);

  // The colours in use (a bundled palette or an uploaded image), or none for white. The strip shows
  // the picture's main colours at the share of it each one covers.
  function showColours(picked) {
    imageRow.hidden = !picked;
    if (!picked) return;
    thumb.src = picked.thumbnail;
    imageName.textContent = picked.name;
    strip.replaceChildren(...picked.swatches.map((sw) => {
      const bar = h('i', { title: `${Math.round(sw.share * 100)}%` });
      bar.style.background = sw.color;
      bar.style.flexGrow = sw.share;
      return bar;
    }));
  }

  async function loadImage(file) {
    if (!file.type.startsWith('image/')) return toast('that file is not an image');
    try {
      await app.useImage(file);
      upload.textContent = 'change image';
      fields.forEach((f) => f.sync());
      toast('image colours · same proportions');
    } catch (e) {
      toast(e.message);
    }
  }

  let dragDepth = 0;
  const hasFile = (e) => [...(e.dataTransfer?.items ?? [])].some((item) => item.kind === 'file');
  addEventListener('dragenter', (e) => {
    if (!hasFile(e)) return;
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
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (file) loadImage(file);
  });

  // Actions
  const save = h('button', { type: 'button', class: 'pill pill-primary', onclick: () => saveImage() }, 'save image');
  const recordLabel = h('span', {}, 'record 8s');
  const record = h('button', { type: 'button', class: 'pill', onclick: () => recordVideo() }, h('i', { class: 'rec-dot' }), recordLabel);
  const copy = h('button', { type: 'button', class: 'pill', onclick: () => copyLink() }, 'copy link');

  const head = h('div', { class: 'panel-head' },
    h('span', { class: 'micro micro-strong' }, 'Parameters'),
    h('button', { type: 'button', class: 'text-button micro', onclick: () => setOpen(false), 'aria-label': 'Hide parameters (H)' }, 'Hide'));
  // The two buttons people reach for first: a new random look, or back to the default look.
  const quick = h('div', { class: 'quick' },
    h('button', { type: 'button', class: 'pill pill-randomize', onclick: (e) => { rollDie(e.detail === 0); shuffle(); }, title: 'Randomize (R)' },
      h('span', { class: 'die', 'aria-hidden': 'true' }), 'randomize'),
    h('button', { type: 'button', class: 'pill', onclick: () => applyLook(presetValues('pure'), 'pure') }, 'reset'));
  // The die rolls a quarter turn per click (a die looks the same each quarter, so it reads as a roll).
  let turns = 0;
  function rollDie(instant) {
    const die = quick.querySelector('.die');
    turns += 1;
    die.style.transition = instant ? 'none' : '';
    die.style.transform = `rotate(${turns * 90}deg)`;
  }
  // A die face, drawn once.
  quick.querySelector('.die').innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="5.2" cy="5.2" r="1.15" fill="currentColor"/><circle cx="8" cy="8" r="1.15" fill="currentColor"/><circle cx="10.8" cy="10.8" r="1.15" fill="currentColor"/></svg>';

  panel.append(head, quick, look, ...groups,
    h('div', { class: 'actions' }, save, record, copy),
    h('p', { class: 'micro keys' }, 'Space pause · R randomize · H hide'));
  fields.forEach((f) => f.sync());
  refresh();

  // Toast
  let toastTimer;
  // instant: raised by a key, so it appears at once (it still fades out when it leaves).
  function toast(message, instant = false) {
    toastEl.textContent = message;
    toastEl.classList.toggle('instant', instant);
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show', 'instant'), 2200);
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
    app.layoutChanged(instant);
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
      toast(app.togglePause() ? 'paused' : 'playing', true);
    } else if (key === 'r') shuffle(true);
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

  return { reserve, toast, showFormat, showColours, pickImage: () => fileInput.click(), sync: () => fields.forEach((f) => f.sync()) };
}
