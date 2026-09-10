'use strict';

const barEl = document.getElementById('bar');
const labelEl = document.getElementById('label');
const readoutEl = document.getElementById('readout');

window.bar.onState((state) => {
  labelEl.textContent = state.label;
  readoutEl.textContent = '';
  readoutEl.append('x ');
  readoutEl.appendChild(Object.assign(document.createElement('b'), { textContent: String(state.x) }));
  readoutEl.append('  y ');
  readoutEl.appendChild(Object.assign(document.createElement('b'), { textContent: String(state.y) }));
  readoutEl.append(`  ·  ${state.width} × ${state.height}`);
});

// Arrow keys resize the page area by 1px, Shift+arrow by 10px, while the bar
// has focus: Right/Left change the width, Down/Up change the height.
barEl.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 10 : 1;
  const map = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] };
  const delta = map[event.key];
  if (!delta) return;
  event.preventDefault();
  window.bar.resize(delta[0], delta[1]);
});

// Double-clicking the bar focuses the page so you can type into Foundry.
barEl.addEventListener('dblclick', () => window.bar.focusPage());
barEl.focus();
