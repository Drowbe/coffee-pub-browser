'use strict';

const dotsEl = document.getElementById('dots');
const cardsEl = document.getElementById('cards');
const obsEl = document.getElementById('obs');
const syncEl = document.getElementById('sync');
let state = { side: 'right', windows: [], obsConnected: false };

function render() {
  document.body.classList.toggle('side-left', state.side === 'left');
  dotsEl.textContent = '';
  cardsEl.textContent = '';
  for (const w of state.windows) {
    const dot = document.createElement('span');
    dot.className = `dot${w.open ? ' on' : ''}${w.parked ? ' parked' : ''}`;
    dot.title = w.label;
    dotsEl.appendChild(dot);

    const card = document.createElement('div');
    card.className = `card${w.parked ? ' parked' : ''}`;
    card.dataset.id = w.id;
    card.title = w.open ? (w.parked ? 'Click to restore' : 'Click to park under the dock') : 'Click to start';
    const head = document.createElement('div');
    head.className = 'card-head';
    const d = document.createElement('span');
    d.className = `dot${w.open ? ' on' : ''}`;
    head.appendChild(d);
    const label = document.createElement('span');
    label.className = 'card-label';
    label.textContent = w.label;
    head.appendChild(label);
    const size = document.createElement('span');
    size.className = 'card-size';
    size.textContent = `${w.width}×${w.height}`;
    head.appendChild(size);
    card.appendChild(head);
    if (w.thumb) {
      const img = document.createElement('img');
      img.className = 'thumb';
      img.src = w.thumb;
      img.alt = '';
      card.appendChild(img);
    } else {
      const empty = document.createElement('div');
      empty.className = 'thumb-empty';
      empty.textContent = w.open ? 'on screen' : 'stopped';
      card.appendChild(empty);
    }
    const hint = document.createElement('div');
    hint.className = 'card-hint';
    hint.textContent = w.parked ? 'parked' : w.open ? 'on screen' : 'stopped';
    card.appendChild(hint);
    cardsEl.appendChild(card);
  }
  obsEl.classList.toggle('on', state.obsConnected);
  syncEl.disabled = !state.obsConnected;
}

window.dock.onState((next) => {
  state = next;
  render();
});

document.body.addEventListener('mouseenter', () => {
  document.body.classList.add('expanded');
  window.dock.hover(true);
});
document.body.addEventListener('mouseleave', () => {
  document.body.classList.remove('expanded');
  window.dock.hover(false);
});

cardsEl.addEventListener('click', (event) => {
  const card = event.target.closest('.card');
  if (card) window.dock.toggle(card.dataset.id);
});

document.querySelector('.tools').addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'parkAll') window.dock.parkAll();
  else if (action === 'restoreAll') window.dock.restoreAll();
  else window.dock.action(action);
});
