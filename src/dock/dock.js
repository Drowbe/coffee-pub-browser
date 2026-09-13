'use strict';

const $ = (id) => document.getElementById(id);
let state = { side: 'right', windows: [], obsConnected: false, outputs: {} };

function render() {
  document.body.classList.toggle('side-left', state.side === 'left');
  if (state.collapsed) {
    document.documentElement.style.setProperty('--collapsed-w', `${state.collapsed.width}px`);
    document.documentElement.style.setProperty('--collapsed-h', `${state.collapsed.height}px`);
  }
  const outputs = state.outputs || {};

  // Collapsed strip
  const dots = $('dots');
  dots.textContent = '';
  for (const w of state.windows) {
    const dot = document.createElement('span');
    dot.className = `dot${w.open ? ' on' : ''}${w.parked ? ' parked' : ''}`;
    dot.title = `${w.label}: ${w.parked ? 'docked' : w.open ? 'on screen' : 'stopped'}`;
    dots.appendChild(dot);
  }
  $('rec-dot').hidden = !outputs.recording;
  $('live-dot').hidden = !outputs.streaming;

  // Expanded panel
  const obsState = $('obs-state');
  obsState.textContent = state.obsConnected ? 'OBS connected' : 'OBS offline';
  obsState.classList.toggle('on', state.obsConnected);
  $('rec').hidden = !outputs.recording;
  $('rec-time').textContent = outputs.recordTime || '';
  $('live').hidden = !outputs.streaming;
  $('live-time').textContent = outputs.streamTime || '';
  $('scene').textContent = state.obsConnected && outputs.scene ? `Scene: ${outputs.scene}` : '';

  const cards = $('cards');
  cards.textContent = '';
  for (const w of state.windows) {
    const card = document.createElement('div');
    card.className = `card${w.parked ? ' parked' : ''}`;
    card.dataset.id = w.id;
    card.title = w.open ? (w.parked ? 'Click to undock' : 'Click to dock') : 'Click to start';
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
    const foot = document.createElement('div');
    foot.className = 'card-foot';
    const st = document.createElement('span');
    st.className = 'state';
    st.textContent = w.parked ? 'docked' : w.open ? 'on screen' : 'stopped';
    foot.appendChild(st);
    const src = document.createElement('span');
    src.className = 'src';
    src.textContent = w.sources && w.sources.length ? w.sources.join(', ') : 'no OBS source';
    src.title = src.textContent;
    foot.appendChild(src);
    card.appendChild(foot);
    cards.appendChild(card);
  }
  $('sync').disabled = !state.obsConnected;
}

window.dock.onState((next) => {
  state = next;
  render();
});

// The window is click-through until the pointer is over the pill, and the
// pointer's movement is forwarded to us meanwhile. Expanding is immediate;
// collapsing waits a moment so crossing the pill's edge does not flicker.
let expanded = false;
let collapseTimer = 0;

function setExpanded(next) {
  if (expanded === next) return;
  expanded = next;
  document.body.classList.toggle('expanded', next);
  window.dock.hover(next);
}

function overPill(event) {
  const r = $('pill').getBoundingClientRect();
  return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
}

function scheduleCollapse() {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(() => setExpanded(false), 260);
}

document.addEventListener('mousemove', (event) => {
  if (overPill(event)) {
    clearTimeout(collapseTimer);
    setExpanded(true);
  } else if (expanded) {
    scheduleCollapse();
  }
});
document.addEventListener('mouseleave', () => {
  if (expanded) scheduleCollapse();
});

$('cards').addEventListener('click', (event) => {
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
