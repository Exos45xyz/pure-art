// The loading screen (index.html): the name and a bar. The bar follows the real loading: the code is
// here, the grains are built, the shaders are compiled. Between steps it creeps toward the next one
// without reaching it, and it fills only when the smoke is ready.
//
// The creep is a CSS transition, not a script: building the grains holds the page for a second or
// more, and a transition on transform keeps moving through it for as long as the browser can draw at
// all (it draws it off the page's thread), where a script stands still from the first moment.

const bar = document.querySelector('.loader .bar i');
const order = ['code', 'grains', 'shaders'];
// Each step's share of the bar: the grains take the longest, the shaders next.
const marks = { code: 0.12, grains: 0.64, shaders: 1 };
const easeOut = 'cubic-bezier(0.23, 1, 0.32, 1)';

function fillTo(value, ms) {
  bar.style.transition = `transform ${ms}ms ${easeOut}`;
  bar.style.transform = `scaleX(${value})`;
}

export function step(name) {
  const next = order[order.indexOf(name) + 1];
  if (next) return fillTo(marks[next] - 0.02, 2400);
  // Ready: the bar fills, then the loader leaves. A background tab may never end the transition.
  fillTo(1, 200);
  const loaded = () => document.body.classList.add('loaded');
  bar.addEventListener('transitionend', loaded, { once: true });
  setTimeout(loaded, 300);
}

// This module running means the code has arrived. The empty bar is laid out first, so the creep
// starts from it.
getComputedStyle(bar).transform;
step('code');
