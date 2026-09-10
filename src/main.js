'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, screen, shell, Menu, Tray, nativeImage, session, dialog, safeStorage } = require('electron');
const { ConfigStore, LIMITS, REGION_LIMITS } = require('./config');
const { Grips } = require('./grips');
const { ObsBridge } = require('./obs');

const APP_NAME = 'Coffee Pub Browser';

// Git revision recorded by scripts/write-build-info.js (absent in a bare checkout).
function readBuildInfo() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8'));
  } catch (err) {
    return { commit: 'unknown', branch: '', dirty: false };
  }
}
const BUILD_INFO = readBuildInfo();
const APP_VERSION = require('../package.json').version;
const REVISION = `v${APP_VERSION} (${BUILD_INFO.commit}${BUILD_INFO.dirty ? '+' : ''})`;
// The shared, persistent session: windows set to "shared" log in together.
// Windows set to "separate" get their own partition (persist:view-<id>).
const PARTITION = 'persist:coffeepub';
const PARK_STRIP = 40; // points of a collapsed window left visible at the display edge

function partitionFor(view) {
  return view.session === 'separate' ? `persist:view-${view.id}` : PARTITION;
}

// CSS selector helper: a bare list of class names ("a b") becomes ".a.b".
function normalizeSelector(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (!trimmed) return '';
  if (/[.#\[\]>:+~*,="']/.test(trimmed)) return trimmed;
  return trimmed
    .split(/\s+/)
    .map((c) => `.${c}`)
    .join('');
}

app.setName(APP_NAME);

// Keep the view windows rendering at full rate even when they are not focused
// or are behind other windows. OBS captures whatever the window paints, so
// throttled rendering would show up as a stuttering source.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Let Foundry play audio without a click first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const configStore = new ConfigStore(path.join(app.getPath('userData'), 'config.json'));

/** @type {Map<string, BrowserWindow>} */
const viewWindows = new Map();
const grips = new Grips({
  isEnabled: () => configStore.get().showGrips,
  onViewMoved: (id, x, y) => {
    if (parked.has(id)) {
      // Dragging a collapsed window out of its parking spot un-parks it.
      parked.delete(id);
      if (parked.size === 0) collapsed = false;
    }
    configStore.updateView(id, { x, y });
    broadcastStatus();
  },
  onViewResized: (id, width, height) => {
    configStore.updateView(id, { width, height });
    broadcastStatus();
  },
  sizeLimits: { min: LIMITS.minSize, max: LIMITS.maxSize },
});

// Shown in a window that has no URL configured yet.
const PLACEHOLDER_URL =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>No URL</title></head>' +
    '<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;' +
    'background:#1a1410;color:#a8998a;font:16px -apple-system,Helvetica,Arial,sans-serif;text-align:center">' +
    '<div><div style="font-size:40px">&#9749;</div>No URL set for this window.<br>Enter one in the Control Panel (Cmd+0).</div>' +
    '</body></html>',
  );
/** @type {BrowserWindow | null} */
let controlWindow = null;
/** @type {Tray | null} */
let tray = null;
let quitting = false;
// Collapsed windows: id -> position to restore on expand.
const parked = new Map();
let collapsed = false;

// ---------------------------------------------------------------------------
// OBS password (kept out of config.json, encrypted with the OS keychain)
// ---------------------------------------------------------------------------

const OBS_SECRET_PATH = path.join(app.getPath('userData'), 'obs-secret.bin');

function readObsPassword() {
  try {
    const raw = fs.readFileSync(OBS_SECRET_PATH);
    if (raw.length === 0) return '';
    if (safeStorage.isEncryptionAvailable()) return safeStorage.decryptString(raw);
    return raw.toString('utf8');
  } catch (err) {
    return '';
  }
}

function writeObsPassword(password) {
  const text = typeof password === 'string' ? password : '';
  if (!text) {
    fs.rmSync(OBS_SECRET_PATH, { force: true });
    return;
  }
  const data = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text, 'utf8');
  fs.writeFileSync(OBS_SECRET_PATH, data);
}

const obs = new ObsBridge({
  getSettings: () => configStore.get().obs,
  getPassword: readObsPassword,
});
obs.on('status', () => broadcastStatus());
obs.on('connected', () => syncObs().catch(() => {}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isAlive(win) {
  return Boolean(win) && !win.isDestroyed();
}

function displaySummary(display) {
  return {
    id: display.id,
    label: display.label || `Display ${display.id}`,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor,
    primary: display.id === screen.getPrimaryDisplay().id,
  };
}

function viewStatus(view) {
  const win = viewWindows.get(view.id);
  if (!isAlive(win)) {
    return { id: view.id, open: false };
  }
  const [width, height] = win.getContentSize();
  const [x, y] = win.getPosition();
  const display = screen.getDisplayMatching(win.getBounds());
  const wc = win.webContents;
  return {
    id: view.id,
    open: true,
    title: win.getTitle(),
    x,
    y,
    width,
    height,
    captureWidth: Math.round(width * display.scaleFactor),
    captureHeight: Math.round(height * display.scaleFactor),
    scaleFactor: display.scaleFactor,
    displayId: display.id,
    displayLabel: displaySummary(display).label,
    url: wc.getURL(),
    loading: wc.isLoading(),
    muted: wc.isAudioMuted(),
  };
}

function fullStatus() {
  return {
    views: configStore.get().views.map(viewStatus),
    displays: screen.getAllDisplays().map(displaySummary),
    config: configStore.get(),
    obs: { ...obs.status(), hasPassword: readObsPassword() !== '' },
    collapsed,
  };
}

function broadcastStatus() {
  if (isAlive(controlWindow)) {
    controlWindow.webContents.send('status', fullStatus());
  }
  refreshTrayMenu();
}

function getView(id) {
  const view = configStore.getView(id);
  if (!view) throw new Error(`Unknown view: ${id}`);
  return view;
}

// ---------------------------------------------------------------------------
// View windows (the things OBS captures)
// ---------------------------------------------------------------------------

function windowTitle(view) {
  return `${APP_NAME} - ${view.label}`;
}

// The system window ID macOS assigns to an open view window (changes on
// every launch), or null when the window is not open.
function systemWindowId(win) {
  if (!isAlive(win)) return null;
  const match = /^window:(\d+):/.exec(win.getMediaSourceId() || '');
  return match ? Number.parseInt(match[1], 10) : null;
}

// Measure a page element inside a view window: { x, y, width, height } in
// window points, or null when the element is not found.
async function measureSelector(win, rawSelector) {
  const selector = normalizeSelector(rawSelector);
  if (!isAlive(win) || !selector) return null;
  const code = `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  })()`;
  try {
    const rect = await win.webContents.executeJavaScript(code, true);
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
    return {
      x: Math.max(0, Math.round(rect.x)),
      y: Math.max(0, Math.round(rect.y)),
      width: Math.max(1, Math.round(rect.width)),
      height: Math.max(1, Math.round(rect.height)),
    };
  } catch (err) {
    return null;
  }
}

// Crop/Pad values (captured pixels) that isolate a region of a view window.
function cropFor(win, region) {
  if (!isAlive(win)) return null;
  const [w, h] = win.getContentSize();
  const sf = screen.getDisplayMatching(win.getBounds()).scaleFactor;
  const x = Math.min(region.x, w);
  const y = Math.min(region.y, h);
  const width = Math.max(1, Math.min(region.width, w - x));
  const height = Math.max(1, Math.min(region.height, h - y));
  return {
    left: Math.round(x * sf),
    top: Math.round(y * sf),
    right: Math.round((w - x - width) * sf),
    bottom: Math.round((h - y - height) * sf),
  };
}

// Re-measure selector regions of an open view and save any changes.
async function refreshRegions(view) {
  const win = viewWindows.get(view.id);
  if (!isAlive(win)) return view.regions;
  let changed = false;
  const regions = [];
  for (const region of view.regions) {
    if (region.mode !== 'selector') {
      regions.push(region);
      continue;
    }
    const rect = await measureSelector(win, region.selector);
    if (rect && (rect.x !== region.x || rect.y !== region.y || rect.width !== region.width || rect.height !== region.height)) {
      regions.push({ ...region, ...rect });
      changed = true;
    } else {
      regions.push(region);
    }
  }
  if (changed) configStore.updateView(view.id, { regions });
  return regions;
}

// Point every linked OBS source at the current windows and keep region
// crops current. Newly detected links are saved so they are re-pointed
// automatically from then on.
let obsSyncTimer = null;
async function syncObs() {
  if (!obs.connected) return null;
  const views = [];
  for (const view of configStore.get().views) {
    const win = viewWindows.get(view.id);
    const regions = await refreshRegions(view);
    views.push({
      id: view.id,
      title: windowTitle(view),
      windowId: systemWindowId(win),
      sources: view.obsSources,
      regions: regions.filter((r) => r.enabled).map((r) => ({ name: r.name, obsSource: r.obsSource, crop: cropFor(win, r) })),
    });
  }
  const report = await obs.syncViews(views);
  for (const { id, input } of report.detected) {
    const view = configStore.getView(id);
    if (view && !view.obsSources.includes(input)) {
      configStore.updateView(id, { obsSources: [...view.obsSources, input] });
    }
  }
  broadcastStatus();
  return report;
}

function scheduleObsSync() {
  clearTimeout(obsSyncTimer);
  obsSyncTimer = setTimeout(() => syncObs().catch((err) => console.warn(`[obs] sync failed: ${err.message}`)), 800);
}

function createViewWindow(view) {
  const existing = viewWindows.get(view.id);
  if (isAlive(existing)) {
    existing.show();
    return existing;
  }

  const options = {
    title: windowTitle(view),
    width: view.width,
    height: view.height,
    useContentSize: true,
    // Borderless so the captured window is exactly the page, nothing else.
    frame: false,
    roundedCorners: false,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      partition: partitionFor(view),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  };
  configureSession(partitionFor(view));
  if (Number.isInteger(view.x) && Number.isInteger(view.y)) {
    options.x = view.x;
    options.y = view.y;
  }

  const win = new BrowserWindow(options);
  viewWindows.set(view.id, win);

  const showView = () => {
    if (!isAlive(win) || win.isVisible()) return;
    win.show();
    broadcastStatus();
    scheduleObsSync();
  };

  // Foundry rewrites document.title constantly; keep our stable title so the
  // window is easy to find in the OBS "Window Capture" list.
  win.on('page-title-updated', (event) => event.preventDefault());

  // Anything Foundry tries to open in a new window goes to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-finish-load', broadcastStatus);
  win.webContents.on('did-start-loading', broadcastStatus);
  win.webContents.on('did-stop-loading', broadcastStatus);
  win.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return; // -3 is ERR_ABORTED, e.g. a redirect.
    console.warn(`[${view.id}] Failed to load ${url}: ${description} (${code})`);
    // Still show the window so the Chromium error page is visible and the
    // window can be reloaded once the server is reachable.
    showView();
  });
  win.webContents.on('render-process-gone', (_event, details) => {
    console.warn(`[${view.id}] Renderer gone (${details.reason}), reloading.`);
    if (isAlive(win)) win.webContents.reload();
  });

  win.webContents.setAudioMuted(Boolean(view.muted));

  win.on('moved', () => {
    if (!isAlive(win) || parked.has(view.id)) return;
    const [x, y] = win.getPosition();
    configStore.updateView(view.id, { x, y });
    broadcastStatus();
  });
  win.on('resize', () => {
    broadcastStatus();
    scheduleObsSync();
  });
  win.on('closed', () => {
    viewWindows.delete(view.id);
    broadcastStatus();
  });

  win.once('ready-to-show', showView);
  // Safety net: never leave a window invisible if the page stalls.
  setTimeout(showView, 8000);

  win.loadURL(view.url || PLACEHOLDER_URL);
  grips.attach(view.id, win, view.label);
  broadcastStatus();
  return win;
}

// Push the saved size/position/mute into an already-open window.
function applyViewSettings(view) {
  const win = viewWindows.get(view.id);
  if (!isAlive(win)) return;
  if (win.getTitle() !== windowTitle(view)) win.setTitle(windowTitle(view));
  grips.setLabel(view.id, view.label);
  const [w, h] = win.getContentSize();
  if (w !== view.width || h !== view.height) {
    win.setContentSize(view.width, view.height);
  }
  if (Number.isInteger(view.x) && Number.isInteger(view.y)) {
    const [x, y] = win.getPosition();
    if (x !== view.x || y !== view.y) win.setPosition(view.x, view.y);
  }
  win.webContents.setAudioMuted(Boolean(view.muted));
  const target = view.url || PLACEHOLDER_URL;
  const current = win.webContents.getURL();
  const currentIsPlaceholder = current.startsWith('data:');
  if (view.url ? currentIsPlaceholder || current !== view.url : !currentIsPlaceholder) {
    win.loadURL(target);
  }
}

function closeView(id) {
  const win = viewWindows.get(id);
  if (isAlive(win)) win.close();
}

function reloadView(id) {
  const win = viewWindows.get(id);
  if (isAlive(win)) win.webContents.reloadIgnoringCache();
}

// Centre the window on the display it is currently on and bring it forward.
function resetView(id) {
  const view = getView(id);
  const win = viewWindows.get(id);
  if (!isAlive(win)) return;
  const area = screen.getDisplayMatching(win.getBounds()).workArea;
  const x = Math.round(area.x + (area.width - view.width) / 2);
  const y = Math.round(area.y + (area.height - view.height) / 2);
  configStore.updateView(id, { x, y });
  applyViewSettings(getView(id));
  win.show();
  win.focus();
  win.moveTop();
  broadcastStatus();
}

function resolveDisplay(displayId) {
  const all = screen.getAllDisplays();
  return all.find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

// Lay the windows out left to right from the top-left of the display,
// wrapping to a new row when the next one would not fit.
function arrangeViews(displayId) {
  const display = resolveDisplay(displayId);
  const area = display.workArea;
  let x = area.x;
  let y = area.y;
  let rowHeight = 0;
  for (const view of configStore.get().views) {
    if (x > area.x && x + view.width > area.x + area.width) {
      x = area.x;
      y += rowHeight;
      rowHeight = 0;
    }
    configStore.updateView(view.id, { x, y });
    x += view.width;
    rowHeight = Math.max(rowHeight, view.height);
  }
  configStore.get().views.forEach(applyViewSettings);
  broadcastStatus();
}

function addView() {
  const view = configStore.addView();
  if (!view) throw new Error(`At most ${LIMITS.maxViews} windows.`);
  buildMenu();
  broadcastStatus();
  return view;
}

function removeView(id) {
  closeView(id);
  const removed = configStore.removeView(id);
  if (!removed) throw new Error('The last window cannot be removed.');
  parked.delete(id);
  buildMenu();
  broadcastStatus();
  return configStore.get();
}

// Slide every open window to the right edge of its display, leaving a thin
// strip on screen so OBS keeps capturing it. Expand restores the positions.
function collapseViews() {
  for (const [id, win] of viewWindows) {
    if (!isAlive(win) || parked.has(id)) continue;
    const [x, y] = win.getPosition();
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    parked.set(id, { x, y });
    win.setPosition(area.x + area.width - PARK_STRIP, y);
  }
  collapsed = true;
  buildMenu();
  broadcastStatus();
}

function expandViews() {
  for (const [id, pos] of parked) {
    const win = viewWindows.get(id);
    if (isAlive(win)) win.setPosition(pos.x, pos.y);
  }
  parked.clear();
  collapsed = false;
  buildMenu();
  broadcastStatus();
}

function setShowGrips(visible) {
  configStore.save({ ...configStore.get(), showGrips: Boolean(visible) });
  grips.setVisible(Boolean(visible));
  buildMenu();
  broadcastStatus();
}

function openAllViews() {
  configStore
    .get()
    .views.filter((v) => v.enabled)
    .forEach((v) => createViewWindow(v));
}

function closeAllViews() {
  for (const win of viewWindows.values()) {
    if (isAlive(win)) win.close();
  }
}

// ---------------------------------------------------------------------------
// Control panel window
// ---------------------------------------------------------------------------

function createControlWindow() {
  if (isAlive(controlWindow)) {
    controlWindow.show();
    controlWindow.focus();
    return controlWindow;
  }
  controlWindow = new BrowserWindow({
    title: `${APP_NAME} - Control Panel - ${REVISION}`,
    width: 880,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#1a1410',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  controlWindow.loadFile(path.join(__dirname, 'control', 'index.html'));
  controlWindow.once('ready-to-show', () => controlWindow.show());
  // Closing the panel hides it; the app keeps running so OBS keeps its sources.
  controlWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      controlWindow.hide();
    }
  });
  controlWindow.on('closed', () => {
    controlWindow = null;
  });
  return controlWindow;
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function buildMenu() {
  const views = configStore.get().views;
  const template = [
    {
      label: APP_NAME,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Control Panel',
          accelerator: 'CmdOrCtrl+0',
          click: () => createControlWindow(),
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      // Copy/paste must work for typing the Foundry password.
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Views',
      submenu: [
        ...views.map((view, index) => ({
          label: `Open ${view.label}`,
          accelerator: `CmdOrCtrl+${index + 1}`,
          click: () => createViewWindow(getView(view.id)),
        })),
        { type: 'separator' },
        ...views.map((view, index) => ({
          label: `Reload ${view.label}`,
          accelerator: `CmdOrCtrl+Shift+${index + 1}`,
          click: () => reloadView(view.id),
        })),
        { type: 'separator' },
        { label: 'Open All', click: () => openAllViews() },
        { label: 'Close All', click: () => closeAllViews() },
        { type: 'separator' },
        {
          label: 'Show Grip Bars',
          type: 'checkbox',
          checked: configStore.get().showGrips,
          accelerator: 'CmdOrCtrl+G',
          click: (item) => setShowGrips(item.checked),
        },
        {
          label: collapsed ? 'Expand Windows' : 'Collapse Windows to Edge',
          accelerator: 'CmdOrCtrl+Shift+C',
          click: () => (collapsed ? expandViews() : collapseViews()),
        },
        { type: 'separator' },
        {
          label: 'Reload Focused Window',
          accelerator: 'CmdOrCtrl+R',
          click: (_item, win) => {
            if (isAlive(win)) win.webContents.reload();
          },
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: (_item, win) => {
            if (isAlive(win)) win.webContents.toggleDevTools();
          },
        },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---------------------------------------------------------------------------
// Menu bar icon (optional)
// ---------------------------------------------------------------------------

function trayMenuTemplate() {
  const views = configStore.get().views;
  return [
    { label: `${APP_NAME} ${REVISION}`, enabled: false },
    { type: 'separator' },
    { label: 'Show Control Panel', click: () => createControlWindow() },
    { type: 'separator' },
    ...views.map((view) => {
      const open = isAlive(viewWindows.get(view.id));
      return {
        label: `${open ? 'Stop' : 'Start'} ${view.label}`,
        enabled: open || Boolean(view.url),
        click: () => (open ? closeView(view.id) : createViewWindow(getView(view.id))),
      };
    }),
    { label: 'Start All', click: () => openAllViews() },
    { label: 'Stop All', click: () => closeAllViews() },
    { type: 'separator' },
    {
      label: collapsed ? 'Expand Windows' : 'Collapse Windows to Edge',
      enabled: viewWindows.size > 0,
      click: () => (collapsed ? expandViews() : collapseViews()),
    },
    {
      label: 'Sync OBS Sources',
      enabled: obs.connected,
      click: () => syncObs().catch(() => {}),
    },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ];
}

function refreshTrayMenu() {
  if (tray && !tray.isDestroyed()) tray.setContextMenu(Menu.buildFromTemplate(trayMenuTemplate()));
}

function setupTray() {
  const { menuBarIcon, hideDockIcon } = configStore.get();
  if (menuBarIcon && !tray) {
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'trayTemplate.png'));
    icon.setTemplateImage(true);
    tray = new Tray(icon);
    tray.setToolTip(APP_NAME);
    refreshTrayMenu();
  } else if (!menuBarIcon && tray) {
    tray.destroy();
    tray = null;
  }
  if (process.platform === 'darwin' && app.dock) {
    if (menuBarIcon && hideDockIcon) app.dock.hide();
    else app.dock.show();
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('config:get', () => configStore.get());
  ipcMain.handle('config:save', (_event, next) => {
    const saved = configStore.save(next);
    saved.views.forEach(applyViewSettings);
    grips.setVisible(saved.showGrips);
    setupTray();
    buildMenu();
    broadcastStatus();
    return saved;
  });
  ipcMain.handle('config:reset', () => {
    const saved = configStore.save({});
    saved.views.forEach(applyViewSettings);
    grips.setVisible(saved.showGrips);
    setupTray();
    buildMenu();
    broadcastStatus();
    return saved;
  });
  ipcMain.handle('grips:set', (_event, visible) => setShowGrips(visible));
  ipcMain.handle('views:add', () => addView());
  ipcMain.handle('views:remove', (_event, id) => removeView(id));
  ipcMain.handle('views:collapse', () => collapseViews());
  ipcMain.handle('views:expand', () => expandViews());

  // --- OBS ---
  ipcMain.handle('obs:setSettings', async (_event, settings) => {
    const current = configStore.get();
    configStore.save({ ...current, obs: { ...current.obs, ...settings } });
    await obs.start().catch(() => {});
    return fullStatus().obs;
  });
  ipcMain.handle('obs:setPassword', async (_event, password) => {
    writeObsPassword(password);
    if (configStore.get().obs.enabled) await obs.start().catch(() => {});
    return fullStatus().obs;
  });
  ipcMain.handle('obs:connect', async () => {
    await obs.connect();
    return fullStatus().obs;
  });
  ipcMain.handle('obs:sync', () => syncObs());
  ipcMain.handle('obs:createSource', async (_event, id) => {
    const view = getView(id);
    const windowId = systemWindowId(viewWindows.get(id));
    if (!windowId) throw new Error('Start the window first so OBS can capture it.');
    let name = `Coffee Pub - ${view.label}`;
    const taken = new Set(obs.status().inputs);
    let n = 2;
    while (taken.has(name)) name = `Coffee Pub - ${view.label} ${n++}`;
    await obs.createInput(name, windowId);
    configStore.updateView(id, { obsSources: [...view.obsSources, name] });
    broadcastStatus();
    return name;
  });
  ipcMain.handle('obs:linkSource', async (_event, id, inputName) => {
    const view = getView(id);
    if (typeof inputName !== 'string' || !inputName) return;
    if (!view.obsSources.includes(inputName)) {
      configStore.updateView(id, { obsSources: [...view.obsSources, inputName] });
    }
    await syncObs().catch(() => {});
    broadcastStatus();
  });
  // --- Regions ---
  ipcMain.handle('view:snapshot', async (_event, id) => {
    const win = viewWindows.get(id);
    if (!isAlive(win) || !win.isVisible()) throw new Error('Start the window first.');
    const [width, height] = win.getContentSize();
    const image = await win.webContents.capturePage();
    return { dataUrl: image.toJPEG(80).length ? `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}` : image.toDataURL(), width, height };
  });
  ipcMain.handle('view:measure', async (_event, id, selector) => {
    const win = viewWindows.get(id);
    if (!isAlive(win)) throw new Error('Start the window first.');
    return measureSelector(win, selector);
  });
  ipcMain.handle('regions:save', async (_event, id, region) => {
    getView(id);
    const input = region && typeof region === 'object' ? { ...region } : {};
    if (typeof input.selector === 'string') input.selector = normalizeSelector(input.selector);
    const saved = configStore.saveRegion(id, input);
    scheduleObsSync();
    broadcastStatus();
    return saved;
  });
  ipcMain.handle('regions:setEnabled', async (_event, id, regionId, enabled) => {
    const region = configStore.getRegion(id, regionId);
    if (!region) throw new Error('Unknown region.');
    const saved = configStore.saveRegion(id, { ...region, enabled: Boolean(enabled) });
    if (obs.connected && saved.obsSource && obs.status().inputs.includes(saved.obsSource)) {
      await obs.setSourceVisible(saved.obsSource, Boolean(enabled)).catch((err) => console.warn(`[obs] visibility: ${err.message}`));
    }
    scheduleObsSync();
    broadcastStatus();
    return saved;
  });
  ipcMain.handle('obs:recreateSource', async (_event, id, inputName) => {
    const view = getView(id);
    const windowId = systemWindowId(viewWindows.get(id));
    if (!windowId) throw new Error('Start the window first so OBS can capture it.');
    if (typeof inputName !== 'string' || !inputName) throw new Error('No source name.');
    if (obs.status().inputs.includes(inputName)) throw new Error(`"${inputName}" already exists in OBS.`);
    await obs.createInput(inputName, windowId);
    if (!view.obsSources.includes(inputName)) {
      configStore.updateView(id, { obsSources: [...view.obsSources, inputName] });
    }
    broadcastStatus();
    return inputName;
  });
  ipcMain.handle('obs:removeSource', async (_event, inputName) => {
    if (typeof inputName !== 'string' || !inputName) return;
    if (obs.status().inputs.includes(inputName)) await obs.removeInput(inputName);
    // Forget it everywhere.
    for (const view of configStore.get().views) {
      const obsSources = view.obsSources.filter((n) => n !== inputName);
      const regions = view.regions.map((r) => (r.obsSource === inputName ? { ...r, obsSource: '' } : r));
      if (obsSources.length !== view.obsSources.length || regions.some((r, i) => r !== view.regions[i])) {
        configStore.updateView(view.id, { obsSources, regions });
      }
    }
    broadcastStatus();
  });
  ipcMain.handle('regions:remove', (_event, id, regionId) => {
    configStore.removeRegion(id, regionId);
    broadcastStatus();
  });
  ipcMain.handle('regions:limits', () => REGION_LIMITS);
  ipcMain.handle('obs:createRegionSource', async (_event, id, regionId) => {
    const view = getView(id);
    const region = configStore.getRegion(id, regionId);
    if (!region) throw new Error('Unknown region.');
    const win = viewWindows.get(id);
    const windowId = systemWindowId(win);
    if (!windowId) throw new Error('Start the window first so OBS can capture it.');
    const taken = new Set(obs.status().inputs);
    let name = region.obsSource || `${view.label} - ${region.name}`;
    if (!region.obsSource) {
      let n = 2;
      while (taken.has(name)) name = `${view.label} - ${region.name} ${n++}`;
    } else if (taken.has(name)) {
      throw new Error(`"${name}" already exists in OBS.`);
    }
    await obs.createInput(name, windowId);
    await obs.ensureCropFilter(name, cropFor(win, region));
    configStore.saveRegion(id, { ...region, obsSource: name });
    broadcastStatus();
    return name;
  });
  ipcMain.handle('obs:unlinkSource', (_event, id, inputName) => {
    const view = getView(id);
    configStore.updateView(id, { obsSources: view.obsSources.filter((n) => n !== inputName) });
    broadcastStatus();
  });

  ipcMain.on('grip:resize', (event, dw, dh) => {
    const id = grips.idFor(event.sender);
    if (id && Number.isInteger(dw) && Number.isInteger(dh)) grips.resize(id, dw, dh);
  });
  ipcMain.on('grip:focusView', (event) => {
    const id = grips.idFor(event.sender);
    if (id) grips.focusView(id);
  });
  ipcMain.handle('config:reveal', () => shell.showItemInFolder(configStore.filePath));
  ipcMain.handle('status:get', () => fullStatus());
  ipcMain.handle('displays:get', () => screen.getAllDisplays().map(displaySummary));
  ipcMain.handle('app:info', () => ({
    name: APP_NAME,
    limits: LIMITS,
    version: APP_VERSION,
    revision: REVISION,
    build: BUILD_INFO,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    configPath: configStore.filePath,
  }));

  ipcMain.handle('view:open', (_event, id) => {
    createViewWindow(getView(id));
    return viewStatus(getView(id));
  });
  ipcMain.handle('view:close', (_event, id) => closeView(id));
  ipcMain.handle('view:reload', (_event, id) => reloadView(id));
  ipcMain.handle('view:reset', (_event, id) => resetView(id));
  ipcMain.handle('view:devtools', (_event, id) => {
    const win = viewWindows.get(id);
    if (isAlive(win)) win.webContents.toggleDevTools();
  });
  ipcMain.handle('views:arrange', (_event, displayId) => arrangeViews(displayId));
  ipcMain.handle('views:openAll', () => openAllViews());
  ipcMain.handle('views:closeAll', () => closeAllViews());

  ipcMain.handle('session:clear', async () => {
    const { response } = await dialog.showMessageBox(controlWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Sign Out'],
      defaultId: 1,
      cancelId: 0,
      message: 'Sign out of Foundry?',
      detail: 'This clears cookies and site data for both windows. You will need to log in again.',
    });
    if (response !== 1) return false;
    const partitions = new Set([PARTITION, ...configStore.get().views.map(partitionFor)]);
    for (const partition of partitions) {
      const ses = session.fromPartition(partition);
      await ses.clearStorageData();
      await ses.clearCache();
    }
    for (const win of viewWindows.values()) {
      if (isAlive(win)) win.webContents.reload();
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Session permissions
// ---------------------------------------------------------------------------

const configuredPartitions = new Set();
function configureSession(partition = PARTITION) {
  if (configuredPartitions.has(partition)) return;
  configuredPartitions.add(partition);
  const ses = session.fromPartition(partition);
  const allowed = new Set(['media', 'notifications', 'fullscreen', 'pointerLock', 'clipboard-read', 'clipboard-sanitized-write']);
  const configuredOrigins = () =>
    new Set(
      configStore.get().views.map((v) => {
        try {
          return new URL(v.url).origin;
        } catch (err) {
          return null;
        }
      }),
    );
  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    let origin = null;
    try {
      origin = new URL(details.requestingUrl || webContents.getURL()).origin;
    } catch (err) {
      origin = null;
    }
    callback(allowed.has(permission) && configuredOrigins().has(origin));
  });
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => createControlWindow());

  app.whenReady().then(() => {
    app.setAboutPanelOptions({
      applicationName: APP_NAME,
      applicationVersion: app.getVersion(),
      credits: 'Two fixed-size Chromium windows for capturing FoundryVTT in OBS.',
    });
    configureSession();
    registerIpc();
    buildMenu();
    setupTray();
    createControlWindow();
    if (configStore.get().openOnLaunch) openAllViews();
    obs.start().catch(() => {});

    screen.on('display-added', broadcastStatus);
    screen.on('display-removed', broadcastStatus);
    screen.on('display-metrics-changed', broadcastStatus);
  });

  app.on('activate', () => createControlWindow());
  app.on('before-quit', () => {
    quitting = true;
    obs.stop().catch(() => {});
  });
  // Standard macOS behaviour: the app stays alive in the Dock with no windows.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
