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
const obsEnabledEl = document.getElementById('obs-enabled');
const obsHostEl = document.getElementById('obs-host');
const obsPortEl = document.getElementById('obs-port');
const obsPasswordEl = document.getElementById('obs-password');
const obsStatusEl = document.getElementById('obs-status');
const obsTagEl = document.getElementById('obs-tag');

let config = null;
let status = { views: [], displays: [], obs: { state: 'disabled', inputs: [] } };
let limits = { minViews: 1, maxViews: 5 };
/** @type {Map<string, HTMLElement>} */
const cards = new Map();
let saveTimer = null;

const NUMBER_FIELDS = new Set(['width', 'height']);
const BOOL_FIELDS = new Set(['enabled', 'muted']);

function setSaveState(text, cls = '') {
  saveStateEl.textContent = text;
  saveStateEl.className = cls;
}

function isDirty() {
  return saveStateEl.classList.contains('dirty');
}

function isEditing(el) {
  return el.contains(document.activeElement);
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
    card.querySelector('[data-role="link-select"]').addEventListener('change', onLinkSelect);
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
  obsEnabledEl.checked = config.obs.enabled;
  if (document.activeElement !== obsHostEl) obsHostEl.value = config.obs.host;
  if (document.activeElement !== obsPortEl) obsPortEl.value = String(config.obs.port);
  if (!sameViews) {
    renderViewCards();
    return;
  }
  for (const view of config.views) {
    const card = cards.get(view.id);
    if (card && !isEditing(card)) fillCard(card, view);
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
      `Retina note: on a ${hiDpi[0].scaleFactor}x display OBS captures ${hiDpi[0].scaleFactor}x the window size in pixels. ` +
      'Either scale the source in OBS or halve the width/height here.';
  } else {
    retinaHintEl.textContent = 'Window size and captured pixel size match on this display.';
  }
}

function renderObs() {
  const o = status.obs || { state: 'disabled', inputs: [] };
  obsTagEl.hidden = o.state !== 'connected';
  const labels = {
    disabled: 'OBS connection is off.',
    disconnected: o.message || 'Not connected.',
    connecting: o.message || 'Connecting...',
    connected: o.message || 'Connected.',
    error: o.message || 'Connection failed.',
  };
  let text = labels[o.state] || '';
  if (o.state === 'connected') {
    text += ` ${o.inputs.length} window-capture source${o.inputs.length === 1 ? '' : 's'} found.`;
    if (o.lastSync) {
      const bits = [];
      if (o.lastSync.pointed.length) bits.push(`re-pointed ${o.lastSync.pointed.join(', ')}`);
      if (o.lastSync.detected.length) bits.push(`linked ${o.lastSync.detected.map((d) => d.input).join(', ')}`);
      if (o.lastSync.missing.length) bits.push(`missing in OBS: ${o.lastSync.missing.join(', ')}`);
      text += bits.length ? ` Last sync ${bits.join('; ')}.` : ' Last sync: everything already in place.';
    }
  }
  obsStatusEl.textContent = text;
  obsStatusEl.classList.toggle('hint-error', o.state === 'error');
  obsPasswordEl.placeholder = o.hasPassword ? 'saved' : 'not set';
  document.getElementById('obs-sync').disabled = o.state !== 'connected';
}

function renderStatus() {
  const o = status.obs || { state: 'disabled', inputs: [] };
  const connected = o.state === 'connected';
  for (const view of config.views) {
    const card = cards.get(view.id);
    if (!card) continue;
    const s = status.views.find((v) => v.id === view.id) || { open: false };

    const tag = card.querySelector('[data-role="tag"]');
    tag.hidden = !s.open;
    tag.textContent = s.open && s.loading ? 'LOADING' : 'ACTIVE';
    tag.classList.toggle('tag-loading', Boolean(s.open && s.loading));

    const toggle = card.querySelector('[data-action="toggle"]');
    toggle.textContent = s.open ? 'Stop' : 'Start';
    toggle.classList.toggle('btn-primary', !s.open);
    toggle.classList.toggle('btn-danger', s.open);
    toggle.disabled = !s.open && !view.url;
    toggle.title = !s.open && !view.url ? 'Enter a URL first' : '';
    card.querySelector('[data-action="reload"]').disabled = !s.open;
    card.querySelector('[data-action="reset"]').disabled = !s.open;
    card.querySelector('[data-action="devtools"]').disabled = !s.open;

    const size = s.open ? `${s.width} × ${s.height}` : `${view.width} × ${view.height}`;
    const captured = s.open && s.scaleFactor !== 1 ? ` (${s.captureWidth} × ${s.captureHeight} captured)` : '';
    card.querySelector('[data-status="title"]').textContent = `Coffee Pub Browser - ${view.label}  ·  ${size}${captured}`;

    // OBS sources linked to this window
    const chips = card.querySelector('[data-role="chips"]');
    chips.textContent = '';
    for (const name of view.obsSources) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const missing = connected && !o.inputs.includes(name);
      if (missing) {
        chip.classList.add('chip-missing');
        chip.title = 'Not found in OBS';
      }
      chip.append(name);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.title = 'Unlink';
      remove.dataset.unlink = name;
      chip.appendChild(remove);
      chips.appendChild(chip);
    }
    if (!view.obsSources.length) {
      const none = document.createElement('span');
      none.className = 'hint';
      none.textContent = connected ? 'none linked' : 'connect to OBS to link sources';
      chips.appendChild(none);
    }
    const select = card.querySelector('[data-role="link-select"]');
    if (!isEditing(select)) {
      select.textContent = '';
      const first = document.createElement('option');
      first.value = '';
      first.textContent = 'Link existing source...';
      select.appendChild(first);
      const linkedElsewhere = new Set(config.views.flatMap((v) => v.obsSources));
      for (const name of o.inputs) {
        if (linkedElsewhere.has(name)) continue;
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
      }
      select.hidden = !connected || select.options.length === 1;
    }
    const create = card.querySelector('[data-action="create-source"]');
    create.hidden = !connected;
    create.disabled = !s.open;
    create.title = s.open ? '' : 'Start the window first';

    renderRegions(card, view, s, o, connected);
  }
}

function renderRegions(card, view, s, o, connected) {
  const list = card.querySelector('[data-role="region-list"]');
  list.textContent = '';
  for (const region of view.regions) {
    const li = document.createElement('li');
    li.className = 'region';
    li.dataset.region = region.id;

    const name = document.createElement('span');
    name.className = 'region-name';
    name.textContent = region.name;
    li.appendChild(name);

    const geom = document.createElement('span');
    geom.className = 'region-geom';
    geom.textContent =
      (region.mode === 'selector' ? `${region.selector || '(no selector)'}  ·  ` : '') +
      `${region.x}, ${region.y}  ·  ${region.width} × ${region.height}`;
    li.appendChild(geom);

    const actions = document.createElement('span');
    actions.className = 'region-actions';
    if (region.obsSource) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      if (connected && !o.inputs.includes(region.obsSource)) {
        chip.classList.add('chip-missing');
        chip.title = 'Not found in OBS';
      }
      chip.append(region.obsSource);
      const unlink = document.createElement('button');
      unlink.type = 'button';
      unlink.textContent = '×';
      unlink.title = 'Forget this OBS source (does not delete it in OBS)';
      unlink.dataset.action = 'unlink-region';
      chip.appendChild(unlink);
      actions.appendChild(chip);
    } else if (connected) {
      const create = document.createElement('button');
      create.type = 'button';
      create.className = 'btn btn-small';
      create.textContent = 'Create in OBS';
      create.dataset.action = 'create-region-source';
      create.disabled = !s.open;
      create.title = s.open ? 'Create a cropped window-capture source for this region' : 'Start the window first';
      actions.appendChild(create);
    }
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-small';
    edit.textContent = 'Edit';
    edit.dataset.action = 'edit-region';
    actions.appendChild(edit);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn btn-small btn-danger';
    remove.textContent = 'Remove';
    remove.dataset.action = 'remove-region';
    actions.appendChild(remove);
    li.appendChild(actions);
    list.appendChild(li);
  }
  list.hidden = view.regions.length === 0;
  const add = card.querySelector('[data-action="add-region"]');
  add.disabled = !s.open;
  add.title = s.open ? '' : 'Start the window first';
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
  if (!event.target.matches('[data-field]')) return;
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
  const id = event.currentTarget.dataset.viewId;
  const unlink = event.target.closest('[data-unlink]');
  if (unlink) {
    await api.obsUnlinkSource(id, unlink.dataset.unlink);
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  await flushSave();
  const s = status.views.find((v) => v.id === id) || { open: false };
  const regionEl = event.target.closest('[data-region]');
  const regionId = regionEl ? regionEl.dataset.region : null;
  const view = config.views.find((v) => v.id === id);
  try {
    switch (button.dataset.action) {
      case 'add-region':
        await openPicker(id, null);
        return;
      case 'edit-region':
        await openPicker(id, view.regions.find((r) => r.id === regionId) || null);
        return;
      case 'remove-region': {
        const region = view.regions.find((r) => r.id === regionId);
        if (region && window.confirm(`Remove region "${region.name}"? Its OBS source, if any, stays in OBS.`)) {
          await api.removeRegion(id, regionId);
        }
        return;
      }
      case 'create-region-source':
        await api.obsCreateRegionSource(id, regionId);
        return;
      case 'unlink-region': {
        const region = view.regions.find((r) => r.id === regionId);
        if (region) await api.saveRegion(id, { ...region, obsSource: '' });
        return;
      }
      default:
        break;
    }
    switch (button.dataset.action) {
      case 'toggle':
        if (s.open) await api.closeView(id);
        else await api.openView(id);
        break;
      case 'reload':
        await api.reloadView(id);
        break;
      case 'reset':
        await api.resetView(id);
        break;
      case 'devtools':
        await api.devToolsView(id);
        break;
      case 'create-source':
        await api.obsCreateSource(id);
        break;
      default:
        break;
    }
  } catch (err) {
    setSaveState(err.message.replace(/^.*Error: /, ''), 'error');
  }
}

async function onLinkSelect(event) {
  const select = event.currentTarget;
  const name = select.value;
  if (!name) return;
  const id = select.closest('.view').dataset.viewId;
  select.value = '';
  select.blur();
  await api.obsLinkSource(id, name);
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

// --- OBS ---
async function saveObsSettings() {
  await flushSave();
  status.obs = await api.obsSetSettings({
    enabled: obsEnabledEl.checked,
    host: obsHostEl.value.trim() || '127.0.0.1',
    port: Number(obsPortEl.value) || 4455,
  });
  renderObs();
}
obsEnabledEl.addEventListener('change', saveObsSettings);
obsHostEl.addEventListener('change', saveObsSettings);
obsPortEl.addEventListener('change', saveObsSettings);
document.getElementById('obs-save-password').addEventListener('click', async () => {
  status.obs = await api.obsSetPassword(obsPasswordEl.value);
  obsPasswordEl.value = '';
  renderObs();
});
obsPasswordEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') document.getElementById('obs-save-password').click();
});
document.getElementById('obs-connect').addEventListener('click', async () => {
  if (!obsEnabledEl.checked) {
    obsEnabledEl.checked = true;
    await saveObsSettings();
  }
  try {
    status.obs = await api.obsConnect();
  } catch (err) {
    // Status text carries the reason.
  }
  renderObs();
});
document.getElementById('obs-sync').addEventListener('click', async () => {
  try {
    await api.obsSync();
  } catch (err) {
    setSaveState(err.message.replace(/^.*Error: /, ''), 'error');
  }
});

// Blur commits fields immediately so a shortcut right after typing uses the new value.
document.addEventListener('focusout', (event) => {
  if (event.target && event.target.matches('[data-field]') && saveTimer) flushSave();
});

api.onStatus((next) => {
  status = next;
  // Config changes made outside the panel (grip drags, arrow-key resizes,
  // menu toggles, OBS links) arrive here. Skip while the user has unsaved edits.
  if (next.config && !isDirty()) applyConfig(next.config);
  renderDisplays();
  renderObs();
  renderStatus();
});

// ---------------------------------------------------------------------------
// Region picker
// ---------------------------------------------------------------------------

const picker = {
  el: document.getElementById('picker'),
  title: document.getElementById('picker-title'),
  img: document.getElementById('picker-img'),
  wrap: document.getElementById('snapshot-wrap'),
  sel: document.getElementById('picker-sel'),
  name: document.getElementById('region-name'),
  selectorField: document.getElementById('selector-field'),
  selector: document.getElementById('region-selector'),
  measureWarning: document.getElementById('measure-warning'),
  x: document.getElementById('region-x'),
  y: document.getElementById('region-y'),
  w: document.getElementById('region-w'),
  h: document.getElementById('region-h'),
  statusEl: document.getElementById('picker-status'),
  viewId: null,
  regionId: null,
  size: { width: 1, height: 1 }, // window content size in points
  drag: null,
};

function pickerMode() {
  return document.querySelector('input[name="region-mode"]:checked').value;
}

function pickerRect() {
  return {
    x: Math.max(0, Math.round(Number(picker.x.value) || 0)),
    y: Math.max(0, Math.round(Number(picker.y.value) || 0)),
    width: Math.max(1, Math.round(Number(picker.w.value) || 1)),
    height: Math.max(1, Math.round(Number(picker.h.value) || 1)),
  };
}

function setPickerRect(rect) {
  picker.x.value = String(rect.x);
  picker.y.value = String(rect.y);
  picker.w.value = String(rect.width);
  picker.h.value = String(rect.height);
  drawSelection();
}

// Map window points to the displayed snapshot and back.
function pointsToPx() {
  return picker.img.clientWidth / picker.size.width;
}

function drawSelection() {
  const k = pointsToPx();
  const r = pickerRect();
  if (!k || !Number.isFinite(k)) return;
  picker.sel.hidden = false;
  picker.sel.style.left = `${r.x * k}px`;
  picker.sel.style.top = `${r.y * k}px`;
  picker.sel.style.width = `${r.width * k}px`;
  picker.sel.style.height = `${r.height * k}px`;
}

async function loadSnapshot() {
  picker.statusEl.textContent = 'Taking snapshot...';
  try {
    const snap = await api.snapshotView(picker.viewId);
    picker.size = { width: snap.width, height: snap.height };
    await new Promise((resolve) => {
      picker.img.onload = resolve;
      picker.img.onerror = resolve;
      picker.img.src = snap.dataUrl;
    });
    picker.statusEl.textContent = `Window is ${snap.width} × ${snap.height}.`;
  } catch (err) {
    picker.statusEl.textContent = err.message.replace(/^.*Error: /, '');
  }
  drawSelection();
}

async function openPicker(viewId, region) {
  const view = config.views.find((v) => v.id === viewId);
  picker.viewId = viewId;
  picker.regionId = region ? region.id : null;
  picker.title.textContent = region ? `Edit region on ${view.label}` : `New region on ${view.label}`;
  picker.name.value = region ? region.name : `Region ${view.regions.length + 1}`;
  document.querySelector(`input[name="region-mode"][value="${region ? region.mode : 'rect'}"]`).checked = true;
  picker.selector.value = region ? region.selector : '';
  picker.measureWarning.hidden = true;
  picker.selectorField.hidden = pickerMode() !== 'selector';
  picker.sel.hidden = true;
  picker.img.removeAttribute('src');
  picker.el.hidden = false;
  await loadSnapshot();
  setPickerRect(region || { x: 0, y: 0, width: Math.round(picker.size.width / 2), height: Math.round(picker.size.height / 2) });
  picker.name.focus();
}

function closePicker() {
  picker.el.hidden = true;
  picker.viewId = null;
  picker.drag = null;
}

document.getElementById('picker-close').addEventListener('click', closePicker);
picker.el.addEventListener('click', (event) => {
  if (event.target === picker.el) closePicker();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !picker.el.hidden) closePicker();
});
document.getElementById('picker-refresh').addEventListener('click', loadSnapshot);
for (const radio of document.querySelectorAll('input[name="region-mode"]')) {
  radio.addEventListener('change', () => {
    picker.selectorField.hidden = pickerMode() !== 'selector';
  });
}
for (const input of [picker.x, picker.y, picker.w, picker.h]) {
  input.addEventListener('input', drawSelection);
}
window.addEventListener('resize', () => {
  if (!picker.el.hidden) drawSelection();
});

document.getElementById('region-measure').addEventListener('click', async () => {
  picker.measureWarning.hidden = true;
  const rect = await api.measureView(picker.viewId, picker.selector.value).catch(() => null);
  if (!rect) {
    picker.measureWarning.hidden = false;
    return;
  }
  setPickerRect(rect);
});

// Drag a rectangle on the snapshot.
function snapshotPoint(event) {
  const bounds = picker.img.getBoundingClientRect();
  const k = pointsToPx();
  const x = Math.min(picker.size.width, Math.max(0, (event.clientX - bounds.left) / k));
  const y = Math.min(picker.size.height, Math.max(0, (event.clientY - bounds.top) / k));
  return { x: Math.round(x), y: Math.round(y) };
}
picker.wrap.addEventListener('mousedown', (event) => {
  if (event.button !== 0 || !picker.img.clientWidth) return;
  picker.drag = snapshotPoint(event);
  event.preventDefault();
});
window.addEventListener('mousemove', (event) => {
  if (!picker.drag) return;
  const p = snapshotPoint(event);
  const x = Math.min(picker.drag.x, p.x);
  const y = Math.min(picker.drag.y, p.y);
  setPickerRect({ x, y, width: Math.max(1, Math.abs(p.x - picker.drag.x)), height: Math.max(1, Math.abs(p.y - picker.drag.y)) });
});
window.addEventListener('mouseup', () => {
  picker.drag = null;
});

document.getElementById('picker-save').addEventListener('click', async () => {
  const mode = pickerMode();
  const region = {
    id: picker.regionId || undefined,
    name: picker.name.value.trim() || 'Region',
    mode,
    selector: mode === 'selector' ? picker.selector.value.trim() : '',
    ...pickerRect(),
  };
  if (mode === 'selector' && !region.selector) {
    picker.measureWarning.textContent = 'Enter a selector.';
    picker.measureWarning.hidden = false;
    return;
  }
  const existing = picker.regionId
    ? (config.views.find((v) => v.id === picker.viewId) || { regions: [] }).regions.find((r) => r.id === picker.regionId)
    : null;
  if (existing) region.obsSource = existing.obsSource;
  try {
    await api.saveRegion(picker.viewId, region);
    closePicker();
  } catch (err) {
    picker.statusEl.textContent = err.message.replace(/^.*Error: /, '');
  }
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
  renderObs();
  renderStatus();
  document.getElementById('app-info').textContent = `v${info.version} - Electron ${info.electron} - Chromium ${info.chrome}`;
})().catch((err) => setSaveState(`Failed to start: ${err.message}`, 'error'));
