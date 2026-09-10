'use strict';

const api = window.coffeePub;

const $ = (id) => document.getElementById(id);
const viewsEl = $('views');
const viewTabsEl = $('view-tabs');
const template = $('view-template');
const saveStateEl = $('save-state');
const openOnLaunchEl = $('open-on-launch');
const showGripsEl = $('show-grips');
const menuBarIconEl = $('menu-bar-icon');
const hideDockIconEl = $('hide-dock-icon');
const arrangeDisplayEl = $('arrange-display');
const retinaHintEl = $('retina-hint');
const obsHostEl = $('obs-host');
const obsPortEl = $('obs-port');
const obsPasswordEl = $('obs-password');
const obsStatusEl = $('obs-status');
const obsTagEl = $('obs-tag');
const obsDotEl = $('obs-dot');
const obsConnectEl = $('obs-connect');
const collapseEl = $('collapse');

let config = null;
let status = { views: [], displays: [], obs: { state: 'disabled', inputs: [] }, collapsed: false };
let limits = { minViews: 1, maxViews: 5 };
/** @type {Map<string, HTMLElement>} */
const cards = new Map();
let saveTimer = null;
let activeTab = 'general';

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

function reportError(err) {
  setSaveState(String((err && err.message) || err).replace(/^.*Error: /, ''), 'error');
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function rememberTab(name) {
  try {
    localStorage.setItem('activeTab', name);
  } catch (err) {
    // ignore
  }
}

function recallTab() {
  try {
    return localStorage.getItem('activeTab') || 'general';
  } catch (err) {
    return 'general';
  }
}

function selectTab(name) {
  if (name.startsWith('view:') && !config.views.some((v) => `view:${v.id}` === name)) name = 'general';
  activeTab = name;
  rememberTab(name);
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === name);
  }
  $('tab-general').hidden = name !== 'general';
  $('tab-obs').hidden = name !== 'obs';
  for (const [id, card] of cards) card.hidden = name !== `view:${id}`;
}

function renderTabs() {
  viewTabsEl.textContent = '';
  for (const view of config.views) {
    const tab = document.createElement('button');
    tab.type = 'button';
    tab.className = 'tab';
    tab.dataset.tab = `view:${view.id}`;
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.dataset.viewDot = view.id;
    tab.appendChild(dot);
    tab.append(view.label);
    viewTabsEl.appendChild(tab);
  }
  $('tabs').querySelector('.tab-add').hidden = config.views.length >= limits.maxViews;
  selectTab(activeTab);
}

$('tabs').addEventListener('click', async (event) => {
  const tab = event.target.closest('.tab');
  if (!tab) return;
  if (tab.dataset.tab === 'add') {
    await flushSave();
    try {
      const view = await api.addView();
      // The status broadcast may have re-rendered the tabs already.
      activeTab = `view:${view.id}`;
      selectTab(activeTab);
    } catch (err) {
      reportError(err);
    }
    return;
  }
  selectTab(tab.dataset.tab);
});

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
  renderTabs();
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
    config &&
    config.views.length === next.views.length &&
    config.views.every((v, i) => v.id === next.views[i].id && v.label === next.views[i].label);
  config = next;
  openOnLaunchEl.checked = config.openOnLaunch;
  showGripsEl.checked = config.showGrips;
  menuBarIconEl.checked = config.menuBarIcon;
  hideDockIconEl.checked = config.hideDockIcon;
  hideDockIconEl.disabled = !config.menuBarIcon;
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
  const connected = o.state === 'connected';
  obsTagEl.hidden = !connected;
  obsDotEl.classList.toggle('on', connected);
  const enabled = config && config.obs.enabled;
  obsConnectEl.textContent = enabled ? 'Disconnect' : 'Connect';
  obsConnectEl.classList.toggle('btn-primary', !enabled);
  const labels = {
    disabled: 'OBS connection is off.',
    disconnected: o.message || 'Not connected.',
    connecting: o.message || 'Connecting...',
    connected: o.message || 'Connected.',
    error: o.message || 'Connection failed.',
  };
  let text = labels[o.state] || '';
  if (connected) {
    text += ` ${o.inputs.length} window-capture source${o.inputs.length === 1 ? '' : 's'} found.`;
    if (o.lastSync) {
      const bits = [];
      if (o.lastSync.pointed.length) bits.push(`re-pointed ${o.lastSync.pointed.join(', ')}`);
      if (o.lastSync.cropped && o.lastSync.cropped.length) bits.push(`cropped ${o.lastSync.cropped.join(', ')}`);
      if (o.lastSync.detected.length) bits.push(`linked ${o.lastSync.detected.map((d) => d.input).join(', ')}`);
      if (o.lastSync.missing.length) bits.push(`missing in OBS: ${o.lastSync.missing.join(', ')}`);
      text += bits.length ? ` Last sync ${bits.join('; ')}.` : ' Last sync: everything already in place.';
    }
  }
  obsStatusEl.textContent = text;
  obsStatusEl.classList.toggle('hint-error', o.state === 'error');
  obsPasswordEl.placeholder = o.hasPassword ? 'saved' : 'not set';
  $('obs-sync').disabled = !connected;
}

function renderStatus() {
  const o = status.obs || { state: 'disabled', inputs: [] };
  const connected = o.state === 'connected';
  collapseEl.textContent = status.collapsed ? 'Expand' : 'Collapse';
  collapseEl.disabled = !status.views.some((v) => v.open);

  for (const view of config.views) {
    const card = cards.get(view.id);
    if (!card) continue;
    const s = status.views.find((v) => v.id === view.id) || { open: false };

    const dot = document.querySelector(`[data-view-dot="${view.id}"]`);
    if (dot) dot.classList.toggle('on', Boolean(s.open));

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
    card.querySelector('[data-role="session-note"]').hidden = !s.open;
    card.querySelector('[data-action="remove-view"]').disabled = config.views.length <= limits.minViews;

    const size = s.open ? `${s.width} × ${s.height}` : `${view.width} × ${view.height}`;
    const captured = s.open && s.scaleFactor !== 1 ? ` (${s.captureWidth} × ${s.captureHeight} captured)` : '';
    card.querySelector('[data-status="title"]').textContent = `Coffee Pub Browser - ${view.label}  ·  ${size}${captured}`;

    renderSources(card, view, s, o, connected);
    renderRegions(card, view, s, o, connected);
  }
}

function makeChip(name, { missing = false, dim = false, title = '' } = {}) {
  const chip = document.createElement('span');
  chip.className = 'chip';
  if (missing) chip.classList.add('chip-missing');
  if (dim) chip.classList.add('chip-dim');
  if (title) chip.title = title;
  chip.append(name);
  return chip;
}

function makeSmallButton(text, action, { danger = false, disabled = false, title = '' } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `btn btn-small${danger ? ' btn-danger' : ''}`;
  button.textContent = text;
  button.dataset.action = action;
  button.disabled = disabled;
  if (title) button.title = title;
  return button;
}

// Window-level OBS sources: exists -> chip with forget; missing -> Add to OBS.
function renderSources(card, view, s, o, connected) {
  const chips = card.querySelector('[data-role="chips"]');
  chips.textContent = '';
  for (const name of view.obsSources) {
    const exists = !connected || o.inputs.includes(name);
    const chip = makeChip(name, { missing: connected && !exists, dim: !connected, title: connected && !exists ? 'Not found in OBS' : '' });
    if (connected && !exists) {
      const add = makeSmallButton('Add to OBS', 'recreate-source', {
        disabled: !s.open,
        title: s.open ? 'Re-create this source in OBS with the same name' : 'Start the window first',
      });
      add.dataset.source = name;
      chip.appendChild(add);
    }
    const forget = document.createElement('button');
    forget.type = 'button';
    forget.textContent = '×';
    forget.title = 'Forget this link (keeps the source in OBS)';
    forget.dataset.unlink = name;
    chip.appendChild(forget);
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
    const linked = new Set(config.views.flatMap((v) => [...v.obsSources, ...v.regions.map((r) => r.obsSource)]));
    for (const name of o.inputs) {
      if (linked.has(name)) continue;
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
}

function renderRegions(card, view, s, o, connected) {
  const list = card.querySelector('[data-role="region-list"]');
  list.textContent = '';
  for (const region of view.regions) {
    const li = document.createElement('li');
    li.className = 'region';
    li.dataset.region = region.id;
    if (!region.enabled) li.classList.add('disabled');

    const enabled = document.createElement('input');
    enabled.type = 'checkbox';
    enabled.checked = region.enabled;
    enabled.dataset.action = 'toggle-region';
    enabled.title = region.enabled ? 'Enabled: the app maintains this region in OBS' : 'Disabled: hidden in OBS and not maintained';
    li.appendChild(enabled);

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
    if (connected) {
      const exists = region.obsSource && o.inputs.includes(region.obsSource);
      if (exists) {
        actions.appendChild(makeChip(region.obsSource, { title: 'OBS source' }));
        actions.appendChild(makeSmallButton('Remove from OBS', 'remove-region-source', { danger: true, title: 'Delete this source in OBS' }));
      } else {
        actions.appendChild(
          makeSmallButton('Add to OBS', 'create-region-source', {
            disabled: !s.open,
            title: s.open
              ? region.obsSource
                ? `Re-create "${region.obsSource}" in OBS`
                : 'Create a cropped window-capture source for this region'
              : 'Start the window first',
          }),
        );
      }
    } else if (region.obsSource) {
      const label = document.createElement('span');
      label.className = 'region-source-name';
      label.textContent = region.obsSource;
      actions.appendChild(label);
    }
    actions.appendChild(makeSmallButton('Edit', 'edit-region'));
    actions.appendChild(makeSmallButton('Delete', 'delete-region', { danger: true }));
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
    const tab = document.querySelector(`.tab[data-tab="view:${view.id}"]`);
    if (tab) tab.lastChild.textContent = view.label || 'Untitled';
    renderLabelWarnings();
  }
  scheduleSave();
}

async function onCardClick(event) {
  const id = event.currentTarget.dataset.viewId;
  const view = config.views.find((v) => v.id === id);
  const unlink = event.target.closest('[data-unlink]');
  if (unlink) {
    await api.obsUnlinkSource(id, unlink.dataset.unlink);
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const regionEl = event.target.closest('[data-region]');
  const regionId = regionEl ? regionEl.dataset.region : null;
  const region = regionId ? view.regions.find((r) => r.id === regionId) : null;
  if (button.dataset.action !== 'toggle-region') await flushSave();
  const s = status.views.find((v) => v.id === id) || { open: false };
  try {
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
      case 'recreate-source':
        await api.obsRecreateSource(id, button.dataset.source);
        break;
      case 'remove-view':
        if (window.confirm(`Remove the "${view.label}" window and its settings?`)) {
          activeTab = 'general';
          await api.removeView(id);
        }
        break;
      case 'add-region':
        await openPicker(id, null);
        break;
      case 'edit-region':
        await openPicker(id, region);
        break;
      case 'delete-region':
        if (region && window.confirm(`Delete region "${region.name}"? Its OBS source, if any, stays in OBS.`)) {
          await api.removeRegion(id, regionId);
        }
        break;
      case 'toggle-region':
        await api.setRegionEnabled(id, regionId, button.checked);
        break;
      case 'create-region-source':
        await api.obsCreateRegionSource(id, regionId);
        break;
      case 'remove-region-source':
        if (region && window.confirm(`Delete "${region.obsSource}" from OBS?`)) {
          await api.obsRemoveSource(region.obsSource);
        }
        break;
      default:
        break;
    }
  } catch (err) {
    reportError(err);
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
    config.menuBarIcon = menuBarIconEl.checked;
    config.hideDockIcon = hideDockIconEl.checked;
    const saved = await api.saveConfig(config);
    setSaveState('All changes saved');
    applyConfig(saved);
    renderStatus();
  } catch (err) {
    setSaveState(`Save failed: ${err.message}`, 'error');
  }
}

$('open-all').addEventListener('click', async () => {
  await flushSave();
  await api.openAll();
});
$('close-all').addEventListener('click', () => api.closeAll());
collapseEl.addEventListener('click', () => (status.collapsed ? api.expandViews() : api.collapseViews()));
$('arrange').addEventListener('click', async () => {
  await flushSave();
  await api.arrangeViews(Number(arrangeDisplayEl.value));
});
for (const el of [openOnLaunchEl, menuBarIconEl, hideDockIconEl]) el.addEventListener('change', scheduleSave);
showGripsEl.addEventListener('change', async () => {
  await flushSave();
  await api.setShowGrips(showGripsEl.checked);
});
$('clear-session').addEventListener('click', () => api.clearSession());
$('reveal-config').addEventListener('click', () => api.revealConfig());
$('reset-config').addEventListener('click', async () => {
  if (!window.confirm('Reset URLs, sizes and positions to the defaults?')) return;
  const saved = await api.resetConfig();
  setSaveState('All changes saved');
  activeTab = 'general';
  applyConfig(saved);
  renderStatus();
});

// --- OBS ---
async function saveObsSettings(enabled) {
  await flushSave();
  status.obs = await api.obsSetSettings({
    enabled,
    host: obsHostEl.value.trim() || '127.0.0.1',
    port: Number(obsPortEl.value) || 4455,
  });
  config.obs = { ...config.obs, enabled, host: obsHostEl.value.trim() || '127.0.0.1', port: Number(obsPortEl.value) || 4455 };
  renderObs();
}
obsHostEl.addEventListener('change', () => saveObsSettings(config.obs.enabled));
obsPortEl.addEventListener('change', () => saveObsSettings(config.obs.enabled));
obsConnectEl.addEventListener('click', () => saveObsSettings(!config.obs.enabled));
$('obs-save-password').addEventListener('click', async () => {
  status.obs = await api.obsSetPassword(obsPasswordEl.value);
  obsPasswordEl.value = '';
  renderObs();
});
obsPasswordEl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') $('obs-save-password').click();
});
$('obs-sync').addEventListener('click', async () => {
  try {
    await api.obsSync();
  } catch (err) {
    reportError(err);
  }
});

// Blur commits fields immediately so a shortcut right after typing uses the new value.
document.addEventListener('focusout', (event) => {
  if (event.target && event.target.matches('[data-field]') && saveTimer) flushSave();
});

api.onStatus((next) => {
  status = next;
  if (next.config && !isDirty()) applyConfig(next.config);
  renderDisplays();
  renderObs();
  renderStatus();
});

// ---------------------------------------------------------------------------
// Region picker
// ---------------------------------------------------------------------------

const picker = {
  el: $('picker'),
  title: $('picker-title'),
  img: $('picker-img'),
  wrap: $('snapshot-wrap'),
  sel: $('picker-sel'),
  name: $('region-name'),
  selectorField: $('selector-field'),
  selector: $('region-selector'),
  measureWarning: $('measure-warning'),
  measureResult: $('measure-result'),
  x: $('region-x'),
  y: $('region-y'),
  w: $('region-w'),
  h: $('region-h'),
  statusEl: $('picker-status'),
  viewId: null,
  regionId: null,
  size: { width: 1, height: 1 },
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
    picker.statusEl.textContent = String(err.message).replace(/^.*Error: /, '');
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
  picker.measureResult.hidden = true;
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

$('picker-close').addEventListener('click', closePicker);
picker.el.addEventListener('click', (event) => {
  if (event.target === picker.el) closePicker();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !picker.el.hidden) closePicker();
});
$('picker-refresh').addEventListener('click', loadSnapshot);
for (const radio of document.querySelectorAll('input[name="region-mode"]')) {
  radio.addEventListener('change', () => {
    picker.selectorField.hidden = pickerMode() !== 'selector';
  });
}
for (const input of [picker.x, picker.y, picker.w, picker.h]) input.addEventListener('input', drawSelection);
window.addEventListener('resize', () => {
  if (!picker.el.hidden) drawSelection();
});

$('region-measure').addEventListener('click', async () => {
  picker.measureWarning.hidden = true;
  picker.measureResult.hidden = true;
  const rect = await api.measureView(picker.viewId, picker.selector.value).catch(() => null);
  if (!rect) {
    picker.measureWarning.textContent = 'Element not found in the page.';
    picker.measureWarning.hidden = false;
    return;
  }
  setPickerRect(rect);
  picker.measureResult.textContent = `Found: ${rect.x}, ${rect.y}  ·  ${rect.width} × ${rect.height}`;
  picker.measureResult.hidden = false;
});

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

$('picker-save').addEventListener('click', async () => {
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
  if (existing) {
    region.obsSource = existing.obsSource;
    region.enabled = existing.enabled;
  }
  try {
    await api.saveRegion(picker.viewId, region);
    closePicker();
  } catch (err) {
    picker.statusEl.textContent = String(err.message).replace(/^.*Error: /, '');
  }
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

(async function init() {
  const [cfg, st, info] = await Promise.all([api.getConfig(), api.getStatus(), api.getAppInfo()]);
  if (info.limits) limits = info.limits;
  status = st;
  activeTab = recallTab();
  applyConfig(cfg);
  renderDisplays();
  renderObs();
  renderStatus();
  $('app-info').textContent =
    `${info.revision}${info.build && info.build.branch ? ` on ${info.build.branch}` : ''} - Electron ${info.electron} - Chromium ${info.chrome}`;
  document.title = `Coffee Pub Browser - Control Panel - ${info.revision}`;
})().catch((err) => setSaveState(`Failed to start: ${err.message}`, 'error'));
