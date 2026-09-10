'use strict';

const api = window.coffeePub;

const $ = (id) => document.getElementById(id);
const viewsEl = $('views');
const viewTabsEl = $('view-tabs');
const template = $('view-template');
const saveStateEl = $('save-state');
const openOnLaunchEl = $('open-on-launch');
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
const obsAutoEl = $('obs-auto');
const collapseEl = $('collapse');
const dockEnabledEl = $('dock-enabled');
const dockSideEl = $('dock-side');

let config = null;
let status = { views: [], displays: [], obs: { state: 'disconnected', inputs: [] }, collapsed: false };
let limits = { minViews: 1, maxViews: 5 };
/** @type {Map<string, HTMLElement>} */
const cards = new Map();
let saveTimer = null;
let activeTab = 'session';

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
    return localStorage.getItem('activeTab') || 'session';
  } catch (err) {
    return 'session';
  }
}

function selectTab(name) {
  if (name === 'general' || name === 'obs') name = 'session';
  if (name.startsWith('view:') && !config.views.some((v) => `view:${v.id}` === name)) name = 'session';
  activeTab = name;
  rememberTab(name);
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === name);
  }
  $('tab-session').hidden = name !== 'session';
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
  menuBarIconEl.checked = config.menuBarIcon;
  dockEnabledEl.checked = config.dock.enabled;
  dockSideEl.value = config.dock.side;
  dockSideEl.disabled = !config.dock.enabled;
  renderSessionGroups();
  hideDockIconEl.checked = config.hideDockIcon;
  hideDockIconEl.disabled = !config.menuBarIcon;
  obsAutoEl.checked = config.obs.autoConnect;
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

function renderSessionGroups() {
  const list = $('session-groups');
  list.textContent = '';
  const names = new Set(['Main', ...config.views.map((v) => v.session).filter(Boolean)]);
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    list.appendChild(option);
  }
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
  // Prefer the current selection, then the remembered one from the config.
  const previous = arrangeDisplayEl.value || (config && config.arrangeDisplayId !== null ? String(config.arrangeDisplayId) : '');
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
  const o = status.obs || { state: 'disconnected', inputs: [] };
  const connected = o.state === 'connected';
  const connecting = o.state === 'connecting';
  obsTagEl.hidden = !connected;
  obsDotEl.classList.toggle('on', connected);
  obsConnectEl.textContent = connected ? 'Disconnect' : connecting ? 'Connecting...' : 'Connect';
  obsConnectEl.disabled = connecting;
  obsConnectEl.classList.toggle('btn-primary', !connected && !connecting);
  const labels = {
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
  const o = status.obs || { state: 'disconnected', inputs: [] };
  const connected = o.state === 'connected';
  collapseEl.textContent = status.collapsed ? 'Restore all' : 'Park all';
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
    card.querySelector('[data-status="title"]').textContent = `Coffee Pub Browser - ${view.label}  ·  page ${size}${captured}`;
    card.querySelector('[data-status="crop"]').textContent = s.open
      ? `The window has a ${s.barHeight} pt bar above the page. Linked OBS sources get a crop of ${s.cropTop} px at the top automatically; for a source you manage yourself, crop the top by ${s.cropTop} px in OBS.`
      : 'Each window has a bar above the page that the app crops out of linked OBS sources.';

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

const REGION_NUMBER_FIELDS = new Set(['x', 'y', 'width', 'height']);
const regionTemplate = $('region-template');
const regionSaveTimers = new Map();

function regionCardFor(card, region) {
  let el = card.querySelector(`.region-card[data-region="${region.id}"]`);
  if (el) return el;
  el = regionTemplate.content.firstElementChild.cloneNode(true);
  el.dataset.region = region.id;
  for (const radio of el.querySelectorAll('[data-rfield="mode"]')) radio.name = `mode-${card.dataset.viewId}-${region.id}`;
  el.addEventListener('input', onRegionInput);
  el.addEventListener('change', onRegionInput);
  card.querySelector('[data-role="region-list"]').appendChild(el);
  return el;
}

function fillRegionCard(el, region) {
  for (const input of el.querySelectorAll('[data-rfield]')) {
    const field = input.dataset.rfield;
    if (field === 'enabled') input.checked = region.enabled;
    else if (field === 'mode') input.checked = input.value === region.mode;
    else input.value = region[field] === undefined || region[field] === null ? '' : String(region[field]);
  }
  el.classList.toggle('disabled', !region.enabled);
  el.querySelector('[data-role="selector-row"]').hidden = region.mode !== 'selector';
}

function renderRegions(card, view, s, o, connected) {
  const list = card.querySelector('[data-role="region-list"]');
  const keep = new Set(view.regions.map((r) => r.id));
  for (const el of [...list.querySelectorAll('.region-card')]) {
    if (!keep.has(el.dataset.region)) el.remove();
  }
  for (const region of view.regions) {
    const el = regionCardFor(card, region);
    if (!isEditing(el)) fillRegionCard(el, region);

    const obsEl = el.querySelector('[data-role="region-obs"]');
    obsEl.textContent = '';
    if (connected) {
      const exists = region.obsSource && o.inputs.includes(region.obsSource);
      if (exists) {
        obsEl.appendChild(makeChip(region.obsSource, { title: 'OBS source' }));
        obsEl.appendChild(makeSmallButton('Remove from OBS', 'remove-region-source', { danger: true, title: 'Delete this source in OBS' }));
      } else {
        obsEl.appendChild(
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
      obsEl.appendChild(label);
    } else {
      const label = document.createElement('span');
      label.className = 'hint';
      label.textContent = 'connect to OBS to add a source';
      obsEl.appendChild(label);
    }
    el.querySelector('[data-action="pick-region"]').disabled = !s.open;
    el.querySelector('[data-action="measure-region"]').disabled = !s.open;
    el.querySelector('[data-role="region-note"]').textContent = s.open ? '' : 'Start the window to use the snapshot or Measure.';
  }
  const add = card.querySelector('[data-action="add-region"]');
  add.disabled = !s.open;
  add.title = s.open ? '' : 'Start the window first';
}

function readRegionCard(el, region) {
  const next = { ...region };
  for (const input of el.querySelectorAll('[data-rfield]')) {
    const field = input.dataset.rfield;
    if (field === 'enabled') continue; // handled through setRegionEnabled
    if (field === 'mode') {
      if (input.checked) next.mode = input.value;
    } else if (REGION_NUMBER_FIELDS.has(field)) {
      next[field] = Number(input.value);
    } else {
      next[field] = input.value;
    }
  }
  return next;
}

async function onRegionInput(event) {
  if (!event.target.matches('[data-rfield]')) return;
  const el = event.currentTarget;
  const card = el.closest('.view-tab');
  const viewId = card.dataset.viewId;
  const view = config.views.find((v) => v.id === viewId);
  const region = view && view.regions.find((r) => r.id === el.dataset.region);
  if (!region) return;
  if (event.target.dataset.rfield === 'enabled') {
    if (event.type !== 'change') return;
    try {
      await api.setRegionEnabled(viewId, region.id, event.target.checked);
    } catch (err) {
      reportError(err);
    }
    return;
  }
  Object.assign(region, readRegionCard(el, region));
  el.querySelector('[data-role="selector-row"]').hidden = region.mode !== 'selector';
  clearTimeout(regionSaveTimers.get(region.id));
  regionSaveTimers.set(
    region.id,
    setTimeout(async () => {
      try {
        await api.saveRegion(viewId, region);
      } catch (err) {
        reportError(err);
      }
    }, 400),
  );
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
  if (event.target.matches('[data-rfield]')) return; // region inputs are handled by onRegionInput
  const regionEl = event.target.closest('[data-region]');
  const regionId = regionEl ? regionEl.dataset.region : null;
  const region = regionId ? view.regions.find((r) => r.id === regionId) : null;
  await flushSave();
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
          activeTab = 'session';
          await api.removeView(id);
        }
        break;
      case 'add-region': {
        const st = status.views.find((v) => v.id === id) || {};
        const w = st.width || view.width;
        const h = st.height || view.height;
        await api.saveRegion(id, {
          name: `Region ${view.regions.length + 1}`,
          mode: 'rect',
          x: 0,
          y: 0,
          width: Math.max(1, Math.round(w / 2)),
          height: Math.max(1, Math.round(h / 2)),
        });
        break;
      }
      case 'pick-region':
        await openPicker(id, region);
        break;
      case 'measure-region': {
        const el = regionEl;
        const out = el.querySelector('[data-role="measure-out"]');
        const selector = el.querySelector('[data-rfield="selector"]').value;
        const rect = await api.measureView(id, selector).catch(() => null);
        if (!rect) {
          out.textContent = 'Element not found in the page.';
          out.className = 'field-warning';
          break;
        }
        out.textContent = `Found: ${rect.x}, ${rect.y}  ·  ${rect.width} × ${rect.height}`;
        out.className = 'hint';
        for (const key of ['x', 'y', 'width', 'height']) el.querySelector(`[data-rfield="${key}"]`).value = String(rect[key]);
        Object.assign(region, rect, { mode: 'selector', selector });
        await api.saveRegion(id, region);
        break;
      }
      case 'delete-region':
        if (region && window.confirm(`Delete region "${region.name}"? Its OBS source, if any, stays in OBS.`)) {
          await api.removeRegion(id, regionId);
        }
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
  const id = select.closest('.view-tab').dataset.viewId;
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
    config.menuBarIcon = menuBarIconEl.checked;
    config.hideDockIcon = hideDockIconEl.checked;
    config.dock = { enabled: dockEnabledEl.checked, side: dockSideEl.value === 'left' ? 'left' : 'right' };
    if (arrangeDisplayEl.value) config.arrangeDisplayId = Number(arrangeDisplayEl.value);
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
arrangeDisplayEl.addEventListener('change', () => {
  config.arrangeDisplayId = Number(arrangeDisplayEl.value);
  scheduleSave();
});
for (const el of [openOnLaunchEl, menuBarIconEl, hideDockIconEl, dockEnabledEl, dockSideEl]) el.addEventListener('change', scheduleSave);
$('clear-session').addEventListener('click', () => api.clearSession());
$('reveal-config').addEventListener('click', () => api.revealConfig());
$('reset-config').addEventListener('click', async () => {
  if (!window.confirm('Reset URLs, sizes and positions to the defaults?')) return;
  const saved = await api.resetConfig();
  setSaveState('All changes saved');
  activeTab = 'session';
  applyConfig(saved);
  renderStatus();
});

// --- OBS ---
async function saveObsSettings() {
  await flushSave();
  const next = {
    autoConnect: obsAutoEl.checked,
    host: obsHostEl.value.trim() || '127.0.0.1',
    port: Number(obsPortEl.value) || 4455,
  };
  config.obs = { ...config.obs, ...next };
  status.obs = await api.obsSetSettings(next);
  renderObs();
}
obsHostEl.addEventListener('change', saveObsSettings);
obsPortEl.addEventListener('change', saveObsSettings);
obsAutoEl.addEventListener('change', saveObsSettings);
obsConnectEl.addEventListener('click', async () => {
  await flushSave();
  try {
    if (status.obs.state === 'connected') status.obs = await api.obsDisconnect();
    else status.obs = await api.obsConnect();
  } catch (err) {
    // The status line carries the reason.
  }
  renderObs();
});
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
  nameEl: $('picker-region-name'),
  img: $('picker-img'),
  wrap: $('snapshot-wrap'),
  sel: $('picker-sel'),
  x: $('region-x'),
  y: $('region-y'),
  w: $('region-w'),
  h: $('region-h'),
  statusEl: $('picker-status'),
  viewId: null,
  region: null,
  size: { width: 1, height: 1 },
  drag: null,
};

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
    picker.statusEl.textContent = `Page is ${snap.width} × ${snap.height}.`;
  } catch (err) {
    picker.statusEl.textContent = String(err.message).replace(/^.*Error: /, '');
  }
  drawSelection();
}

// Open the snapshot picker for an existing region; saving updates its rectangle.
async function openPicker(viewId, region) {
  if (!region) return;
  const view = config.views.find((v) => v.id === viewId);
  picker.viewId = viewId;
  picker.region = region;
  picker.title.textContent = `Pick "${region.name}" on ${view.label}`;
  picker.nameEl.textContent =
    region.mode === 'selector'
      ? 'This region follows a CSS selector; the rectangle you pick here is replaced on the next sync unless you switch it to Rectangle.'
      : 'Drag a box on the snapshot or adjust the numbers, then save.';
  picker.sel.hidden = true;
  picker.img.removeAttribute('src');
  picker.el.hidden = false;
  await loadSnapshot();
  setPickerRect(region);
}

function closePicker() {
  picker.el.hidden = true;
  picker.viewId = null;
  picker.region = null;
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
for (const input of [picker.x, picker.y, picker.w, picker.h]) input.addEventListener('input', drawSelection);
window.addEventListener('resize', () => {
  if (!picker.el.hidden) drawSelection();
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
  if (!picker.region) return;
  const view = config.views.find((v) => v.id === picker.viewId);
  const current = view ? view.regions.find((r) => r.id === picker.region.id) : null;
  const region = { ...(current || picker.region), ...pickerRect() };
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
