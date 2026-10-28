import { controls, defaults, lookCode, lookOf, matchingPreset, presets, presetValues, sameLook, shuffled } from './settings.js';

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

// A button's face: an optional mark, a check (shown while the button says it's done) and its words.
const TICK = '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M1.6 5.3 4 7.6 8.4 2.7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function face(words, ...marks) {
  const tick = h('i', { class: 'tick', 'aria-hidden': 'true' });
  tick.innerHTML = TICK;
  return h('span', { class: 'face' }, ...marks, tick, h('span', { class: 'words', 'aria-live': 'polite' }, words));
}

// A full-width row you drag anywhere on. Click jumps, drag scrubs, Shift is fine, double-click resets,
// arrows step by 1 (Shift or Page keys: 10). A finger might be scrolling the sheet instead: the row waits
// until it moves sideways (a drag) or lifts where it landed (a tap), and lets a vertical swipe scroll.
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

  const at = (e) => {
    const box = el.getBoundingClientRect();
    return clamp01((e.clientX - box.left) / box.width);
  };
  // Direct manipulation is never animated, even if a look was applied a moment ago.
  const still = () => el.closest('.panel')?.classList.remove('gliding');
  let start = null;
  let touch = null;
  const scrub = (e) => set(start.value + ((e.clientX - start.x) / start.width) * (e.shiftKey ? 0.2 : 1));
  const grab = (e, x, value) => {
    still();
    el.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    start = { x, value, width: el.getBoundingClientRect().width };
    scrub(e);
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    if (e.pointerType === 'touch') touch = { id: e.pointerId, x: e.clientX, value: at(e) };
    else grab(e, e.clientX, at(e));
  });
  el.addEventListener('pointermove', (e) => {
    if (touch?.id === e.pointerId) {
      if (Math.abs(e.clientX - touch.x) < 6) return;
      const { x, value } = touch;
      touch = null;
      return grab(e, x, value);
    }
    if (start && el.hasPointerCapture(e.pointerId)) scrub(e);
  });
  const end = () => { start = null; el.classList.remove('dragging'); };
  el.addEventListener('pointerup', (e) => {
    if (touch?.id === e.pointerId) {
      still();
      set(touch.value);
    }
    touch = null;
    end();
  });
  // The browser took the finger to scroll the sheet: the value stays as it was.
  el.addEventListener('pointercancel', () => { touch = null; end(); });
  el.addEventListener('dblclick', () => set(defaults[control.key]));
  el.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const now = app.state[control.key];
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set(now + step);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set(now - step);
    else if (e.key === 'PageUp') set(now + 0.1);
    else if (e.key === 'PageDown') set(now - 0.1);
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
  // instant: from the keyboard, where an animation would only feel slow. A look that brings a colour
  // (aura, or one of yours) wears it, and takes it off again when a look without one follows, unless the
  // colour was changed by hand in between. Randomize keeps whatever colour is on.
  let worn = null;
  const applyLook = (values, name, instant = false) => {
    app.apply(values, name);
    if (name && values.colour) {
      worn = { colour: values.colour, before: worn?.before ?? app.state.colour };
      app.set('colour', values.colour);
    } else if (name && worn) {
      if (app.state.colour === worn.colour) app.set('colour', worn.before);
      worn = null;
    }
    syncAll(instant);
  };

  // Looks
  for (const name of Object.keys(presets)) {
    chips[name] = h('button', { type: 'button', class: 'chip', onclick: () => applyLook(presetValues(name), name) }, name);
  }
  const shuffle = (instant = false) => applyLook(shuffled(app.state), undefined, instant);
  // Your own looks: + save keeps the look on screen as a chip (mine 1, mine 2…), in this browser. The one
  // on screen shows × beside it to remove it. Copy code turns any look into a preset for src/settings.js,
  // and the address bar link shares it with anyone.
  const MINE_KEY = 'pure-smoke-looks';
  const MAX_MINE = 6;
  let mine = [];
  try { mine = JSON.parse(localStorage.getItem(MINE_KEY)) ?? []; } catch {}
  if (!Array.isArray(mine)) mine = [];
  mine = mine.filter((m) => typeof m?.name === 'string' && m.values && typeof m.values === 'object').slice(0, MAX_MINE);
  const keepMine = () => { try { localStorage.setItem(MINE_KEY, JSON.stringify(mine)); } catch {} };
  const valuesOf = (m) => ({ ...presetValues('smoke'), ...m.values });
  // Numbered after the highest kept, so the chips read in the order they were made.
  const nextName = () => `mine ${Math.max(0, ...mine.map((m) => Number(m.name.match(/\d+$/)?.[0]) || 0)) + 1}`;
  const saveChip = h('button', { type: 'button', class: 'chip chip-save', onclick: (e) => saveLook(e.detail === 0) }, '+ save');
  const looksRow = h('div', { class: 'chips', role: 'group', 'aria-label': 'Look' });
  let mineChips = [];
  function drawMine() {
    mineChips = mine.map((m) => {
      const chip = h('button', { type: 'button', class: 'chip', onclick: () => applyLook(valuesOf(m), m.name) }, m.name);
      const remove = h('button', {
        type: 'button', class: 'chip chip-remove', 'aria-label': `Remove ${m.name}`, hidden: true,
        onclick: () => forget(m),
      }, '×');
      return { m, chip, remove, el: h('span', { class: 'mine' }, chip, remove) };
    });
    looksRow.replaceChildren(...Object.values(chips), ...mineChips.map((c) => c.el), saveChip);
    showMine();
  }
  // Which of yours is on screen, and whether + save has anything new to keep.
  function showMine() {
    let found = false;
    for (const { m, chip, remove } of mineChips) {
      const on = !found && sameLook(valuesOf(m), app.state) && (!m.values.colour || m.values.colour === app.state.colour);
      found ||= on;
      chip.setAttribute('aria-pressed', String(on));
      remove.hidden = !on;
    }
    const known = found || matchingPreset(app.state) !== undefined;
    saveChip.disabled = known || mine.length >= MAX_MINE;
    saveChip.title = known ? 'This look is already a chip' : mine.length >= MAX_MINE ? 'Six looks kept: remove one to keep another' : 'Keep this look as a chip, in this browser';
  }
  function saveLook(keyboard) {
    // A saved look keeps its colour, but not an uploaded image (it's gone once the page closes).
    const m = { name: nextName(), values: { ...lookOf(app.state), ...(app.state.colour !== 'image' && { colour: app.state.colour }) } };
    mine.push(m);
    keepMine();
    drawMine();
    // + save is now off (this look is a chip): keyboard focus goes to the new chip.
    if (keyboard) mineChips.at(-1).chip.focus();
  }
  function forget(m) {
    mine = mine.filter((x) => x !== m);
    keepMine();
    drawMine();
    saveChip.focus({ preventScroll: true });
  }
  const look = h('section', {}, h('h2', { class: 'micro' }, 'Look'), looksRow);
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
  const field = (control, bare = false) => {
    const f = control.type === 'choice' ? choice(control, app, refresh, bare) : slider(control, app, refresh);
    fields.push({ ...f, control });
    return f.el;
  };
  const byKey = (key) => controls.find((c) => c.key === key);
  const section = (title, ...children) => h('section', {}, h('h2', { class: 'micro' }, title), ...children);

  // Colour: an orb for each palette, filled with its own colours and lit like a sphere, and apart from
  // them the image: + brings one (or drop one anywhere on the page), and it joins as an orb of its own
  // picture. The colour worn has a ring and its name by the title; an image's main colours show below at
  // the share of the picture each covers, the proportions the smoke wears them in.
  const fileInput = h('input', {
    type: 'file', accept: 'image/*', hidden: true,
    onchange: () => {
      if (fileInput.files[0]) loadImage(fileInput.files[0]);
      fileInput.value = '';
    },
  });
  const PLUS = '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M5 1.6v6.8M1.6 5h6.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
  const orbs = {};
  for (const value of ['white', 'dusk', 'pearl', 'image']) {
    const fill = h('i', { class: 'orb-fill', 'aria-hidden': 'true' });
    if (app.bundled[value]) fill.style.setProperty('--picture', `url("${app.bundled[value]}")`);
    orbs[value] = h('button', {
      type: 'button', role: 'radio', class: `orb orb-${value}`, 'aria-label': value, title: value,
      onclick: () => wearColour(value), onkeydown: (e) => stepColour(e, value),
    }, fill);
  }
  orbs.image.hidden = true;
  const addImage = h('button', {
    type: 'button', class: 'orb orb-add', 'aria-label': 'Colour from an image',
    title: 'Colour the smoke from an image (or drop one anywhere)', onclick: () => fileInput.click(),
  });
  addImage.innerHTML = PLUS;
  const colourName = h('span', { class: 'micro colour-name' });
  const strip = h('div', { class: 'swatches', 'aria-hidden': 'true', hidden: true });
  let imageLabel = 'image';
  const colourField = {
    control: byKey('colour'),
    el: h('div', { class: 'colour-row' },
      h('div', { class: 'orbs', role: 'radiogroup', 'aria-label': 'Colour' },
        orbs.white, orbs.dusk, orbs.pearl, h('i', { class: 'orb-split', 'aria-hidden': 'true' }), orbs.image),
      addImage),
    sync() {
      const on = app.state.colour;
      for (const [value, o] of Object.entries(orbs)) {
        o.setAttribute('aria-checked', String(value === on));
        o.tabIndex = value === on ? 0 : -1;
      }
      colourName.textContent = on === 'image' ? imageLabel : on;
      strip.hidden = on !== 'image';
    },
  };
  fields.push(colourField);
  function wearColour(value) {
    app.set('colour', value);
    colourField.sync();
    refresh();
  }
  // Arrows move along the orbs (and wear each one), as in any group of choices.
  function stepColour(e, value) {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const shown = Object.keys(orbs).filter((v) => !orbs[v].hidden);
    const next = shown[(shown.indexOf(value) + d + shown.length) % shown.length];
    orbs[next].focus();
    wearColour(next);
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
      orbs.image.querySelector('.orb-fill').style.setProperty('--picture', `url("${picked.thumbnail}")`);
      orbs.image.hidden = false;
      orbs.image.setAttribute('aria-label', picked.name);
      orbs.image.title = picked.name;
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
    if (!file.type.startsWith('image/')) return toast('that file is not an image');
    try {
      await app.useImage(file);
      fields.forEach((f) => f.sync());
      refresh();
      // The orb and its strip say it where the panel shows; with the panel away, a toast does.
      if (panel.hasAttribute('data-hidden') || recordOpen) toast('image colours · same proportions');
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
    h('button', { type: 'button', class: 'text-button micro', onclick: () => setOpen(false), 'aria-label': 'Hide parameters (H)', 'aria-keyshortcuts': 'H' }, 'Hide'));
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

  panel.append(head, quick, look, colour, share, tuneSection,
    h('p', { class: 'micro keys' }, 'Space pause · R randomize · H hide'));
  fields.forEach((f) => f.sync());
  refresh();

  // Toast, with Sonner's manners: it stays long enough to read (a longer message, longer), its clock
  // stops while the page is hidden (a video can finish while you are in another tab), and a message
  // that replaces one on screen blurs across instead of snapping.
  // instant: raised by a key, so it appears at once (it still fades out when it leaves).
  let toastTimer;
  let toastLeft = 0;
  let toastSince = 0;
  function toast(message, instant = false) {
    const text = h('span', {}, message);
    const replacing = toastEl.classList.contains('show') && !instant;
    toastEl.replaceChildren(text);
    if (replacing) {
      text.animate([{ opacity: 0, filter: 'blur(2px)' }, { opacity: 1, filter: 'blur(0)' }],
        { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' });
    }
    toastEl.classList.toggle('instant', instant);
    toastEl.classList.add('show');
    toastLeft = Math.max(2000, 1200 + message.length * 45);
    runToastClock();
  }
  function runToastClock() {
    clearTimeout(toastTimer);
    if (document.hidden) return;
    toastSince = performance.now();
    toastTimer = setTimeout(() => toastEl.classList.remove('show', 'instant'), toastLeft);
  }
  document.addEventListener('visibilitychange', () => {
    if (!toastEl.classList.contains('show')) return;
    if (!document.hidden) return runToastClock();
    clearTimeout(toastTimer);
    toastLeft -= performance.now() - toastSince;
  });

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
      toast(e.message);
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
      toast(e.message);
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
