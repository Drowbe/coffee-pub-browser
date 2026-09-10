'use strict';

const bar = document.getElementById('bar');
const labelEl = document.getElementById('label');
const readoutEl = document.getElementById('readout');

window.grip.onState((state) => {
  labelEl.textContent = state.label;
  readoutEl.innerHTML = '';
  const pos = document.createElement('span');
  pos.append('x ');
  pos.appendChild(Object.assign(document.createElement('b'), { textContent: String(state.x) }));
  pos.append('  y ');
  pos.appendChild(Object.assign(document.createElement('b'), { textContent: String(state.y) }));
  pos.append(`  ·  ${state.width} × ${state.height}`);
  readoutEl.appendChild(pos);
  bar.classList.toggle('overlay', state.mode === 'overlay');
  document.title = `${state.label} grip`;
});

// Arrow keys resize the view by 1px, Shift+arrow by 10px, while the grip has
// focus: Right/Left change the width, Down/Up change the height.
bar.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 10 : 1;
  const map = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] };
  const delta = map[event.key];
  if (!delta) return;
  event.preventDefault();
  window.grip.resize(delta[0], delta[1]);
});

// Double-clicking the grip focuses its view so you can type into Foundry.
bar.addEventListener('dblclick', () => window.grip.focusView());
bar.focus();
