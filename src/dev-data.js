// Dev only (imported from main.js under import.meta.env.DEV): worst-case data for the panel, behind a
// switch at the bottom of the page. ?data=worst | empty | one | full puts that set of your looks in place
// of the ones kept in this browser (and keeps nothing while it does); no ?data is the real thing.

import { presetValues } from './settings.js';

// Distinct from every built-in look, so none of them matches one.
const look = (i, colour) => ({ ...presetValues('pure'), flow: 0.31 + i * 0.03, turbulence: 0.22 + i * 0.05, ...(colour && { colour }) });

const sets = {
  // Real names people type, each at a limit: the longest (24), one letter, an emoji first, right to left,
  // one unbreakable word, and markup with stacked accents (it must show as text).
  worst: [
    { name: "aleksandra's foggy dawn", values: look(0, 'pearl') },
    { name: 'J', values: look(1) },
    { name: '🌫️ morning haze', values: look(2, 'dusk') },
    { name: 'ضباب الصباح الباكر', values: look(3) },
    { name: 'Benachrichtigungsnebel24', values: look(4, 'white') },
    { name: 'Đặng <b>bold</b> fog', values: look(5) },
  ],
  empty: [],
  one: [{ name: 'mine 1', values: look(0) }],
  full: Array.from({ length: 6 }, (_, i) => ({ name: `mine ${i + 1}`, values: look(i) })),
};

// The looks to use instead of the kept ones, or null for the real thing.
export function devLooks() {
  const which = new URLSearchParams(location.search).get('data');
  return which in sets ? structuredClone(sets[which]) : null;
}

// The switch: fixed at the bottom centre, plain on purpose (it is not part of the design under test). It
// shows only when the address asks for test data (?data=…), so the dev server looks like the real page.
export function mountDataToggle() {
  if (!new URLSearchParams(location.search).has('data')) return;
  const current = new URLSearchParams(location.search).get('data') ?? 'demo';
  const bar = document.createElement('div');
  bar.setAttribute('style', 'position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:99;display:flex;gap:2px;padding:2px;border-radius:8px;background:#444;font:12px system-ui;');
  for (const state of ['demo', 'worst', 'empty', 'one', 'full']) {
    const b = document.createElement('button');
    b.textContent = state;
    b.setAttribute('style', `padding:3px 9px;border:0;border-radius:6px;cursor:pointer;color:${state === current ? '#000' : '#ddd'};background:${state === current ? '#fff' : 'transparent'};`);
    b.onclick = () => {
      const url = new URL(location.href);
      if (state === 'demo') url.searchParams.delete('data');
      else url.searchParams.set('data', state);
      location.href = url.href;
    };
    bar.append(b);
  }
  document.body.append(bar);
}
