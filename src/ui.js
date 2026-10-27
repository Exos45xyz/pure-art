import { controls, defaults, lookCode, matchingPreset, presets, presetValues, shuffled } from './settings.js';

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

// A row with its label on the left and a sliding thumb behind the chosen option. bare: no label, for a
// row that is the only control in its section (the section's title already names it).
function choice(control, app, onChange, bare = false) {
  const thumb = h('div', { class: 'choice-thumb' });
  // One option's share of the row inside its 3 px padding, so the last one ends at the padding too.
  thumb.style.width = `calc((100% - 6px) / ${control.options.length})`;
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
  const el = h('div', { class: bare ? 'row bare' : 'row' }, bare ? [] : h('span', { class: 'row-label' }, control.label), group);

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

  // Actions
  const save = h('button', { type: 'button', class: 'pill pill-wide', onclick: () => saveImage() }, 'save image');
  const record = h('button', { type: 'button', class: 'pill', onclick: (e) => openRecord(true, { keyboard: e.detail === 0 }) }, h('i', { class: 'rec-dot' }), 'record');
  const copy = h('button', { type: 'button', class: 'pill', onclick: () => copyCode() }, 'copy code');

  // Controls. The everyday path comes first: a look, a colour, then save or share. The rest waits one
  // level deeper under Fine-tune, so a first visit asks for three choices instead of twenty.
  const field = (control, bare = false) => {
    const f = control.type === 'choice' ? choice(control, app, refresh, bare) : slider(control, app, refresh);
    fields.push({ ...f, control });
    return f.el;
  };
  const byKey = (key) => controls.find((c) => c.key === key);
  const section = (title, ...children) => h('section', {}, h('h2', { class: 'micro' }, title), ...children);

  // Colour from an image: pick "image" (it asks for one the first time), or drop one on the page.
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
  const change = h('button', { type: 'button', class: 'text-button micro', hidden: true, onclick: () => fileInput.click() }, 'change');
  const imageRow = h('div', { class: 'image-row', hidden: true }, thumb, h('div', { class: 'image-meta' }, imageName, strip), change);
  const colour = section('Colour', h('div', { class: 'rows' }, field(byKey('colour'), true), imageRow, fileInput));

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

  // The colours in use (a bundled palette or an uploaded image), or none for white. The strip shows
  // the picture's main colours at the share of it each one covers.
  function showColours(picked) {
    imageRow.hidden = !picked;
    change.hidden = app.state.colour !== 'image';
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

  panel.append(head, quick, look, colour, share, tuneSection,
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

  // A large image takes a second or two to encode: the button says so while it does.
  async function saveImage() {
    if (save.getAttribute('aria-busy') === 'true') return;
    save.disabled = true;
    save.setAttribute('aria-busy', 'true');
    save.textContent = 'saving…';
    try {
      const size = await app.saveImage();
      toast(`image saved · ${size}`);
    } catch (e) {
      toast(e.message);
    } finally {
      save.disabled = false;
      save.removeAttribute('aria-busy');
      save.textContent = 'save image';
    }
  }

  // The record window, in the panel's place: choose the frame (the canvas becomes it), then save an
  // image of it or record a video. Each option names itself, so the rows need no labels.
  const startLabel = h('span', {}, 'start recording');
  const start = h('button', { type: 'button', class: 'pill pill-primary pill-start', onclick: () => recordVideo() },
    h('i', { class: 'rec-dot' }), startLabel);
  const statusText = h('span');
  const statusFill = h('i');
  const status = h('div', { class: 'record-status', role: 'status', hidden: true },
    h('p', { class: 'micro' }, statusText),
    h('div', { class: 'bar' }, statusFill));
  const back = h('button', { type: 'button', class: 'text-button micro', onclick: (e) => openRecord(false, { keyboard: e.detail === 0 }) }, 'Back');
  const frameRow = h('div', { class: 'rows' }, field(byKey('format'), true));
  const recordRows = h('div', { class: 'rows' }, ['length', 'loop', 'fps'].map((key) => field(byKey(key), true)));
  const recordPanel = h('aside', { class: 'panel record-panel', 'aria-label': 'Record', 'data-hidden': true, tabindex: -1 },
    h('div', { class: 'panel-head' }, h('span', { class: 'micro micro-strong' }, 'Record'), back),
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
    const { length, loop, fps } = app.state;
    const doing = app.canLoop ? `${length} s ${loop === 'loop' ? 'loop' : 'video'} · ${fps} fps` : `${length} s live`;
    const show = (p) => {
      statusText.textContent = `${doing} · ${Math.floor(p * 100)}%`;
      statusFill.style.transform = `scaleX(${p})`;
    };
    show(0);
    status.hidden = false;
    startLabel.textContent = 'cancel';
    start.classList.add('recording');
    back.disabled = true;
    // The settings hold still while a video is being made.
    recordRows.inert = frameRow.inert = save.disabled = true;
    try {
      const ext = await app.recordVideo(show);
      toast(`${app.canLoop && loop === 'loop' ? 'loop' : 'video'} saved · ${ext}`);
    } catch (e) {
      toast(e.message);
    } finally {
      status.hidden = true;
      startLabel.textContent = 'start recording';
      start.classList.remove('recording');
      back.disabled = false;
      recordRows.inert = frameRow.inert = save.disabled = false;
    }
  }

  // The look as code (every parameter, as a preset for src/settings.js), for anyone building on it.
  async function copyCode() {
    try {
      await navigator.clipboard.writeText(lookCode(app.state));
      toast('code copied · paste into settings.js');
    } catch {
      toast('this browser blocked the clipboard');
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
    if (e.target.closest('button, [role=slider], input, a')) return;
    const key = e.key.toLowerCase();
    if (key === ' ') {
      e.preventDefault();
      toast(app.togglePause() ? 'paused' : 'playing', true);
    } else if (key === 'r') shuffle(true);
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
