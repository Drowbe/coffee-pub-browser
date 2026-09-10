'use strict';

const api = window.coffeePub;

const viewsEl = document.getElementById('views');
const template = document.getElementById('view-template');
const saveStateEl = document.getElementById('save-state');
const openOnLaunchEl = document.getElementById('open-on-launch');
const showGripsEl = document.getElementById('show-grips');
const arrangeDisplayEl = document.getElementById('arrange-display');
const retinaHintEl = document.getElementById('retina-hint');

let config = null;
let status = { views: [], displays: [] };
/** @type {Map<string, HTMLElement>} */
const cards = new Map();
let saveTimer = null;

const NUMBER_FIELDS = new Set(['width', 'height', 'zoom', 'x', 'y']);
const BOOL_FIELDS = new Set(['enabled', 'muted']);

function setSaveState(text, cls = '') {
  saveStateEl.textContent = text;
  saveStateEl.className = cls;
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
    set('url', s.open && s.url ? s.url : '-');

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
      await refreshConfig();
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
  if (!saveStateEl.classList.contains('dirty')) return;
  try {
    config.openOnLaunch = openOnLaunchEl.checked;
    config.showGrips = showGripsEl.checked;
    config = await api.saveConfig(config);
    // Re-fill so the user sees clamped/normalised values, but do not steal focus.
    for (const view of config.views) {
      const card = cards.get(view.id);
      if (card && !card.contains(document.activeElement)) fillCard(card, view);
    }
    setSaveState('All changes saved');
    renderStatus();
  } catch (err) {
    setSaveState(`Save failed: ${err.message}`, 'error');
  }
}

async function refreshConfig() {
  config = await api.getConfig();
  openOnLaunchEl.checked = config.openOnLaunch;
  showGripsEl.checked = config.showGrips;
  for (const view of config.views) {
    const card = cards.get(view.id);
    if (card && !card.contains(document.activeElement)) fillCard(card, view);
  }
  renderStatus();
}

document.getElementById('open-all').addEventListener('click', async () => {
  await flushSave();
  await api.openAll();
});
document.getElementById('close-all').addEventListener('click', () => api.closeAll());
document.getElementById('arrange').addEventListener('click', async () => {
  await flushSave();
  await api.arrangeViews(Number(arrangeDisplayEl.value));
  await refreshConfig();
});
openOnLaunchEl.addEventListener('change', scheduleSave);
showGripsEl.addEventListener('change', async () => {
  await api.setShowGrips(showGripsEl.checked);
  await refreshConfig();
});
document.getElementById('clear-session').addEventListener('click', () => api.clearSession());
document.getElementById('reveal-config').addEventListener('click', () => api.revealConfig());
document.getElementById('reset-config').addEventListener('click', async () => {
  if (!window.confirm('Reset URLs, sizes and positions to the defaults?')) return;
  config = await api.resetConfig();
  openOnLaunchEl.checked = config.openOnLaunch;
  showGripsEl.checked = config.showGrips;
  renderViewCards();
  renderStatus();
  setSaveState('All changes saved');
});

// Blur commits number fields immediately so a Cmd+1 right after typing uses the new size.
document.addEventListener('focusout', (event) => {
  if (event.target && event.target.matches('[data-field]') && saveTimer) flushSave();
});

api.onStatus((next) => {
  status = next;
  if (typeof next.showGrips === 'boolean' && document.activeElement !== showGripsEl) {
    showGripsEl.checked = next.showGrips;
  }
  renderDisplays();
  renderStatus();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function init() {
  const [cfg, st, info] = await Promise.all([api.getConfig(), api.getStatus(), api.getAppInfo()]);
  config = cfg;
  status = st;
  openOnLaunchEl.checked = config.openOnLaunch;
  showGripsEl.checked = config.showGrips;
  renderViewCards();
  renderDisplays();
  renderStatus();
  document.getElementById('app-info').textContent = `v${info.version} - Electron ${info.electron} - Chromium ${info.chrome}`;
})().catch((err) => setSaveState(`Failed to start: ${err.message}`, 'error'));
