// The loading screen (index.html). It is there from the first paint, counts while the smoke is built,
// and fades once the first frame is drawn. The count is honest: on its own it only creeps toward 90%,
// and it reaches 100 when the smoke is ready.

const num = document.querySelector('.loader-num');
const start = performance.now();
let shown = 0;
let ready = false;

function count(now) {
  const target = ready ? 100 : 90 * (1 - Math.exp(-(now - start) / 1200));
  if (shown < target) shown = Math.min(target, shown + Math.max(1, (target - shown) * 0.25));
  num.textContent = String(Math.floor(shown)).padStart(2, '0');
  if (shown >= 100) document.body.classList.add('loaded');
  else requestAnimationFrame(count);
}
requestAnimationFrame(count);

// Called by main.js once the first frame of smoke is on screen.
export function loaded() {
  ready = true;
}
