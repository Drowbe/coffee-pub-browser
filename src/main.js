'use strict';

const path = require('path');
const { app, BrowserWindow, ipcMain, screen, shell, Menu, session, dialog } = require('electron');
const { ConfigStore } = require('./config');
const { Grips } = require('./grips');

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
});
/** @type {BrowserWindow | null} */
let controlWindow = null;
let quitting = false;

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
    zoom: wc.getZoomFactor(),
  };
}

function fullStatus() {
  return {
    views: configStore.get().views.map(viewStatus),
    displays: screen.getAllDisplays().map(displaySummary),
    showGrips: configStore.get().showGrips,
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
      zoomFactor: view.zoom,
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
  };

  // Foundry rewrites document.title constantly; keep our stable title so the
  // window is easy to find in the OBS "Window Capture" list.
  win.on('page-title-updated', (event) => event.preventDefault());

  // Anything Foundry tries to open in a new window goes to the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(view.zoom);
    broadcastStatus();
  });
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
  win.on('closed', () => {
    viewWindows.delete(view.id);
    broadcastStatus();
  });

  win.once('ready-to-show', showView);
  // Safety net: never leave a window invisible if the page stalls.
  setTimeout(showView, 8000);

  win.loadURL(view.url);
  grips.attach(view.id, win, view.label);
  broadcastStatus();
  return win;
}

// Push the saved size/position/zoom/mute into an already-open window.
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
  if (win.webContents.getZoomFactor() !== view.zoom) {
    win.webContents.setZoomFactor(view.zoom);
  }
  if (win.webContents.getURL() !== view.url) {
    win.loadURL(view.url);
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

function focusView(id) {
  const win = viewWindows.get(id);
  if (isAlive(win)) {
    win.show();
    win.focus();
  }
}

function resolveDisplay(displayId) {
  const all = screen.getAllDisplays();
  return all.find((d) => d.id === displayId) || screen.getPrimaryDisplay();
}

function centerView(id, displayId) {
  const view = getView(id);
  const display = resolveDisplay(displayId);
  const area = display.workArea;
  const x = Math.round(area.x + (area.width - view.width) / 2);
  const y = Math.round(area.y + (area.height - view.height) / 2);
  configStore.updateView(id, { x, y });
  applyViewSettings(getView(id));
  broadcastStatus();
}

// Put the Game window at the top-left of the display and the Stream window
// immediately to its right. If they do not fit side by side, stack them.
function arrangeViews(displayId) {
  const display = resolveDisplay(displayId);
  const area = display.workArea;
  const [game, stream] = configStore.get().views;
  const fitsSideBySide = game.width + stream.width <= area.width;
  configStore.updateView(game.id, { x: area.x, y: area.y });
  if (fitsSideBySide) {
    configStore.updateView(stream.id, { x: area.x + game.width, y: area.y });
  } else {
    configStore.updateView(stream.id, { x: area.x, y: area.y + game.height });
  }
  configStore.get().views.forEach(applyViewSettings);
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

  ipcMain.on('grip:nudge', (event, dx, dy) => {
    const id = grips.idFor(event.sender);
    if (id && Number.isInteger(dx) && Number.isInteger(dy)) grips.nudge(id, dx, dy);
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
  ipcMain.handle('view:focus', (_event, id) => focusView(id));
  ipcMain.handle('view:devtools', (_event, id) => {
    const win = viewWindows.get(id);
    if (isAlive(win)) win.webContents.toggleDevTools();
  });
  ipcMain.handle('view:center', (_event, id, displayId) => centerView(id, displayId));
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

    screen.on('display-added', broadcastStatus);
    screen.on('display-removed', broadcastStatus);
    screen.on('display-metrics-changed', broadcastStatus);
  });

  app.on('activate', () => createControlWindow());
  app.on('before-quit', () => {
    quitting = true;
  });
  // Standard macOS behaviour: the app stays alive in the Dock with no windows.
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
