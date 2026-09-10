'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, ipcMain, screen, shell, Menu, session, dialog, safeStorage } = require('electron');
const { ConfigStore, LIMITS } = require('./config');
const { Grips } = require('./grips');
const { ObsBridge } = require('./obs');

const APP_NAME = 'Coffee Pub Browser';
// One shared, persistent session: logging into Foundry in either window logs in both.
const PARTITION = 'persist:coffeepub';

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
let quitting = false;

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
  };
}

function broadcastStatus() {
  if (isAlive(controlWindow)) {
    controlWindow.webContents.send('status', fullStatus());
  }
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

// Point every linked OBS source at the current windows. Newly detected
// links are saved so they are re-pointed automatically from then on.
let obsSyncTimer = null;
async function syncObs() {
  if (!obs.connected) return null;
  const views = configStore.get().views.map((view) => ({
    id: view.id,
    title: windowTitle(view),
    windowId: systemWindowId(viewWindows.get(view.id)),
    sources: view.obsSources,
  }));
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
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  };
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
    if (!isAlive(win)) return;
    const [x, y] = win.getPosition();
    configStore.updateView(view.id, { x, y });
    broadcastStatus();
  });
  win.on('resize', broadcastStatus);
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

// Add or remove windows to match `count`. Removed windows are closed.
function setViewCount(count) {
  const removed = configStore.setViewCount(count);
  removed.forEach(closeView);
  buildMenu();
  broadcastStatus();
  return configStore.get();
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
    title: `${APP_NAME} - Control Panel`,
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
// IPC
// ---------------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('config:get', () => configStore.get());
  ipcMain.handle('config:save', (_event, next) => {
    const saved = configStore.save(next);
    saved.views.forEach(applyViewSettings);
    grips.setVisible(saved.showGrips);
    buildMenu();
    broadcastStatus();
    return saved;
  });
  ipcMain.handle('config:reset', () => {
    const saved = configStore.save({});
    saved.views.forEach(applyViewSettings);
    grips.setVisible(saved.showGrips);
    buildMenu();
    broadcastStatus();
    return saved;
  });
  ipcMain.handle('grips:set', (_event, visible) => setShowGrips(visible));
  ipcMain.handle('views:setCount', (_event, count) => setViewCount(count));

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
    version: app.getVersion(),
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
    const ses = session.fromPartition(PARTITION);
    await ses.clearStorageData();
    await ses.clearCache();
    for (const win of viewWindows.values()) {
      if (isAlive(win)) win.webContents.reload();
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Session permissions
// ---------------------------------------------------------------------------

function configureSession() {
  const ses = session.fromPartition(PARTITION);
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
