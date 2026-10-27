// The loading screen (index.html). It shows the real loading: the code is here, the grains are built,
// the shaders are compiled. The glass cube builds itself from the floor up, one part per step (the
// base, the uprights, the top), and the count reaches 100% only when the smoke is ready.

const steps = [...document.querySelectorAll('.loader-steps [data-step]')];
const edges = [...document.querySelectorAll('.loader-cube i')];
const num = document.querySelector('.loader-num');
const order = ['code', 'grains', 'shaders'];
// Each step's share of the count: the grains take the longest, the shaders next.
const marks = { code: 12, grains: 64, shaders: 100 };

let done = -1;
let since = performance.now();
let shown = 0;
let last = since;

// Mark a step done. Its part of the cube completes, and the next part draws slowly toward most of its
// length while the next step runs; it only closes when that step is done too.
export function step(name) {
  done = order.indexOf(name);
  since = performance.now();
  const state = (i) => (i <= done ? 'done' : i === done + 1 ? 'now' : 'next');
  steps.forEach((s, i) => { s.dataset.state = state(i); });
  edges.forEach((e, i) => { e.dataset.state = state(Math.floor(i / 4)); });
}

function count(now) {
  // Between steps the count creeps toward the next mark without reaching it; once the smoke is ready it
  // runs to 100. Eased by time, so a slow frame (the page is busy) doesn't make it lag.
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  const next = order[done + 1];
  const target = next ? marks[order[done]] + (marks[next] - 2 - marks[order[done]]) * (1 - Math.exp(-(now - since) / 700)) : 100;
  shown += (target - shown) * (1 - Math.exp(-dt * 12));
  if (!next && shown > 99.5) shown = 100;
  num.textContent = String(Math.floor(shown)).padStart(3, '0');
  if (shown >= 100) document.body.classList.add('loaded');
  else requestAnimationFrame(count);
}
requestAnimationFrame(count);

// This module running means the code has arrived.
step('code');
