// The loading screen (index.html): the name and a bar. The bar follows the real loading: the code is
// here, the grains are built, the shaders are compiled. Between steps it creeps toward the next one
// without reaching it, and it fills only when the smoke is ready.

const bar = document.querySelector('.loader .bar i');
const order = ['code', 'grains', 'shaders'];
// Each step's share of the bar: the grains take the longest, the shaders next.
const marks = { code: 0.12, grains: 0.64, shaders: 1 };

let done = -1;
let since = performance.now();
let shown = 0;
let last = since;

export function step(name) {
  done = order.indexOf(name);
  since = performance.now();
}

function fill(now) {
  // Eased by time, so a slow frame (the page is busy) doesn't make it lag.
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  const next = order[done + 1];
  const from = done < 0 ? 0 : marks[order[done]];
  const target = next ? from + (marks[next] - 0.02 - from) * (1 - Math.exp(-(now - since) / 700)) : 1;
  shown += (target - shown) * (1 - Math.exp(-dt * 12));
  if (!next && shown > 0.995) shown = 1;
  bar.style.transform = `scaleX(${shown})`;
  if (shown >= 1) document.body.classList.add('loaded');
  else requestAnimationFrame(fill);
}
requestAnimationFrame(fill);

// This module running means the code has arrived.
step('code');
