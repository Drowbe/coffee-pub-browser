'use strict';

const api = window.coffeePub;

const viewsEl = document.getElementById('views');
const template = document.getElementById('view-template');
const saveStateEl = document.getElementById('save-state');
const openOnLaunchEl = document.getElementById('open-on-launch');
const showGripsEl = document.getElementById('show-grips');
const arrangeDisplayEl = document.getElementById('arrange-display');
const retinaHintEl = document.getElementById('retina-hint');
const countValueEl = document.getElementById('count-value');
const countDownEl = document.getElementById('count-down');
const countUpEl = document.getElementById('count-up');

let config = null;
let status = { views: [], displays: [] };
let limits = { minViews: 1, maxViews: 5 };
/** @type {Map<string, HTMLElement>} */
const cards = new Map();
let saveTimer = null;

const NUMBER_FIELDS = new Set(['width', 'height', 'x', 'y']);
const BOOL_FIELDS = new Set(['enabled', 'muted']);

function setSaveState(text, cls = '') {
  saveStateEl.textContent = text;
  saveStateEl.className = cls;
}

function isDirty() {
  return saveStateEl.classList.contains('dirty');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderViewCards() {
  viewsEl.textContent = '';
  cards.clear();
  for (const view of config.views) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.viewId = view.id;
    cards.set(view.id, card);
    fillCard(card, view);
    card.addEventListener('input', onFieldInput);
    card.addEventListener('change', onFieldInput);
    card.addEventListener('click', onCardClick);
    viewsEl.appendChild(card);
  }
  renderLabelWarnings();
}

function fillCard(card, view) {
  card.querySelector('.view-title').textContent = `${view.label} window`;
  for (const input of card.querySelectorAll('[data-field]')) {
    const field = input.dataset.field;
    if (BOOL_FIELDS.has(field)) {
      input.checked = Boolean(view[field]);
    } else {
      input.value = view[field] === null || view[field] === undefined ? '' : String(view[field]);
    }
  }
}

// Apply a config coming from the main process without disturbing the field
// the user is typing in. Re-renders the cards if the set of windows changed.
function applyConfig(next) {
  const sameViews =
    config && config.views.length === next.views.length && config.views.every((v, i) => v.id === next.views[i].id);
  config = next;
  openOnLaunchEl.checked = config.openOnLaunch;
  showGripsEl.checked = config.showGrips;
  countValueEl.value = String(config.views.length);
  countDownEl.disabled = config.views.length <= limits.minViews;
  countUpEl.disabled = config.views.length >= limits.maxViews;
  if (!sameViews) {
    renderViewCards();
    return;
  }
  for (const view of config.views) {
    const card = cards.get(view.id);
    if (card && !card.contains(document.activeElement)) fillCard(card, view);
  }
  renderLabelWarnings();
}

function renderLabelWarnings() {
  const counts = new Map();
  for (const view of config.views) {
    const key = view.label.trim().toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  for (const view of config.views) {
    const card = cards.get(view.id);
    if (!card) continue;
    card.querySelector('[data-role="label-warning"]').hidden = counts.get(view.label.trim().toLowerCase()) < 2;
  }
}

function renderDisplays() {
  const previous = arrangeDisplayEl.value;
  arrangeDisplayEl.textContent = '';
  for (const display of status.displays) {
    const option = document.createElement('option');
    option.value = String(display.id);
    const scale = display.scaleFactor !== 1 ? ` @${display.scaleFactor}x` : '';
    option.textContent = `${display.label}${display.primary ? ' (main)' : ''} - ${display.bounds.width}x${display.bounds.height}${scale}`;
    arrangeDisplayEl.appendChild(option);
  }
  if ([...arrangeDisplayEl.options].some((o) => o.value === previous)) {
    arrangeDisplayEl.value = previous;
  }
  const hiDpi = status.displays.filter((d) => d.scaleFactor > 1);
  if (hiDpi.length) {
    retinaHintEl.textContent =
      `Retina note: on a ${hiDpi[0].scaleFactor}x display OBS captures ${hiDpi[0].scaleFactor}x the window size in pixels ` +
      '(see "Captured pixels" on each window). Either scale the source in OBS or halve the width/height here.';
  } else {
    retinaHintEl.textContent = 'Window size and captured pixel size match on this display.';
  }
}

function renderStatus() {
  for (const view of config.views) {
    const card = cards.get(view.id);
    if (!card) continue;
    const s = status.views.find((v) => v.id === view.id) || { open: false };
    const badge = card.querySelector('[data-role="badge"]');
    if (!s.open) {
      badge.textContent = 'Closed';
      badge.className = 'badge badge-closed';
    } else if (s.loading) {
      badge.textContent = 'Loading';
      badge.className = 'badge badge-loading';
    } else {
      badge.textContent = 'Open';
      badge.className = 'badge badge-open';
    }

    const set = (name, value) => {
      card.querySelector(`[data-status="${name}"]`).textContent = value;
    };
    set('title', s.open ? s.title : `Coffee Pub Browser - ${view.label}`);
    set('size', s.open ? `${s.width} x ${s.height}` : `${view.width} x ${view.height} (when opened)`);
    set(
      'capture',
      s.open
        ? `${s.captureWidth} x ${s.captureHeight}${s.scaleFactor !== 1 ? ` (${s.scaleFactor}x on ${s.displayLabel})` : ''}`
        : '-',
    );
    set('position', s.open ? `${s.x}, ${s.y}` : view.x === null ? 'auto' : `${view.x}, ${view.y}`);
    set('url', s.open && s.url && !s.url.startsWith('data:') ? s.url : s.open ? 'no URL set' : '-');

    const toggle = (action, enabled) => {
      card.querySelector(`[data-action="${action}"]`).disabled = !enabled;
    };
    toggle('open', !s.open);
    toggle('focus', s.open);
    toggle('reload', s.open);
    toggle('devtools', s.open);
    toggle('close', s.open);
  }
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function readCard(card, view) {
  const next = { ...view };
  for (const input of card.querySelectorAll('[data-field]')) {
    const field = input.dataset.field;
    if (BOOL_FIELDS.has(field)) {
      next[field] = input.checked;
    } else if (NUMBER_FIELDS.has(field)) {
      next[field] = input.value.trim() === '' ? null : Number(input.value);
    } else {
      next[field] = input.value;
    }
  }
  return next;
}

function onFieldInput(event) {
  const card = event.currentTarget;
  const view = config.views.find((v) => v.id === card.dataset.viewId);
  if (!view) return;
  Object.assign(view, readCard(card, view));
  if (event.target.dataset.field === 'label') {
    card.querySelector('.view-title').textContent = `${view.label || 'Untitled'} window`;
    renderLabelWarnings();
  }
  scheduleSave();
}

async function onCardClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = event.currentTarget.dataset.viewId;
  await flushSave();
  switch (button.dataset.action) {
    case 'open':
      await api.openView(id);
      break;
    case 'close':
      await api.closeView(id);
      break;
    case 'reload':
      await api.reloadView(id);
      break;
    case 'focus':
      await api.focusView(id);
      break;
    case 'devtools':
      await api.devToolsView(id);
      break;
    case 'center':
      await api.centerView(id, Number(arrangeDisplayEl.value));
      break;
    default:
      break;
  }
}

function scheduleSave() {
  setSaveState('Unsaved changes...', 'dirty');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 400);
}

async function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!isDirty()) return;
  try {
    config.openOnLaunch = openOnLaunchEl.checked;
    config.showGrips = showGripsEl.checked;
    const saved = await api.saveConfig(config);
    setSaveState('All changes saved');
    applyConfig(saved);
    renderStatus();
  } catch (err) {
    setSaveState(`Save failed: ${err.message}`, 'error');
  }
}

async function changeCount(delta) {
  await flushSave();
  const target = config.views.length + delta;
  if (target < limits.minViews || target > limits.maxViews) return;
  if (delta < 0) {
    const last = config.views[config.views.length - 1];
    if (last.url && !window.confirm(`Remove the "${last.label}" window? Its settings will be lost.`)) return;
  }
  const saved = await api.setViewCount(target);
  applyConfig(saved);
  renderStatus();
}

countDownEl.addEventListener('click', () => changeCount(-1));
countUpEl.addEventListener('click', () => changeCount(1));

document.getElementById('open-all').addEventListener('click', async () => {
  await flushSave();
  await api.openAll();
});
document.getElementById('close-all').addEventListener('click', () => api.closeAll());
document.getElementById('arrange').addEventListener('click', async () => {
  await flushSave();
  await api.arrangeViews(Number(arrangeDisplayEl.value));
});
openOnLaunchEl.addEventListener('change', scheduleSave);
showGripsEl.addEventListener('change', async () => {
  await flushSave();
  await api.setShowGrips(showGripsEl.checked);
});
document.getElementById('clear-session').addEventListener('click', () => api.clearSession());
document.getElementById('reveal-config').addEventListener('click', () => api.revealConfig());
document.getElementById('reset-config').addEventListener('click', async () => {
  if (!window.confirm('Reset URLs, sizes and positions to the defaults?')) return;
  const saved = await api.resetConfig();
  setSaveState('All changes saved');
  applyConfig(saved);
  renderStatus();
});

// Blur commits fields immediately so a shortcut right after typing uses the new value.
document.addEventListener('focusout', (event) => {
  if (event.target && event.target.matches('[data-field]') && saveTimer) flushSave();
});

api.onStatus((next) => {
  status = next;
  // Config changes made outside the panel (grip drags, arrow-key resizes,
  // menu toggles) arrive here. Skip while the user has unsaved edits.
  if (next.config && !isDirty()) applyConfig(next.config);
  renderDisplays();
  renderStatus();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function init() {
  const [cfg, st, info] = await Promise.all([api.getConfig(), api.getStatus(), api.getAppInfo()]);
  if (info.limits) limits = info.limits;
  status = st;
  applyConfig(cfg);
  renderDisplays();
  renderStatus();
  document.getElementById('app-info').textContent = `v${info.version} - Electron ${info.electron} - Chromium ${info.chrome}`;
})().catch((err) => setSaveState(`Failed to start: ${err.message}`, 'error'));
