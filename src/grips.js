'use strict';

// Grip bars: a small companion window docked to the top edge of each view
// window. Dragging the grip moves the view. Because the grip is a separate
// window it never appears in an OBS Window Capture of the view.

const path = require('path');
const { BrowserWindow, screen } = require('electron');

const GRIP_HEIGHT = 28;

function isAlive(win) {
  return Boolean(win) && !win.isDestroyed();
}

class Grips {
  /**
   * @param {object} options
   * @param {() => boolean} options.isEnabled   whether grips should be shown
   * @param {(id: string, x: number, y: number) => void} options.onViewMoved
   *        called after a drag or nudge has moved the view, for persistence
   */
  constructor({ isEnabled, onViewMoved }) {
    this.isEnabled = isEnabled;
    this.onViewMoved = onViewMoved;
    /** @type {Map<string, {grip: BrowserWindow, view: BrowserWindow, label: string, mode: 'above'|'overlay', syncing: boolean}>} */
    this.entries = new Map();
  }

  attach(id, view, label) {
    this.detach(id);
    const [width] = view.getContentSize();
    const grip = new BrowserWindow({
      title: `${label} grip`,
      width,
      height: GRIP_HEIGHT,
      useContentSize: true,
      frame: false,
      roundedCorners: false,
      hasShadow: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#1a1410',
      webPreferences: {
        preload: path.join(__dirname, 'grip-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false,
      },
    });
    const entry = { grip, view, label, mode: 'above', syncing: false };
    this.entries.set(id, entry);

    grip.loadFile(path.join(__dirname, 'grip', 'index.html'));
    grip.webContents.on('did-finish-load', () => this.sendState(id));

    // Grip dragged by the user: the view follows.
    grip.on('move', () => {
      if (entry.syncing || !isAlive(view)) return;
      const [gx, gy] = grip.getPosition();
      const vy = entry.mode === 'above' ? gy + GRIP_HEIGHT : gy;
      entry.syncing = true;
      view.setPosition(gx, vy);
      entry.syncing = false;
      this.sendState(id);
    });
    grip.on('moved', () => {
      if (!isAlive(view)) return;
      // Re-place in case the drag crossed the top of the display.
      this.syncFromView(id);
      const [x, y] = view.getPosition();
      this.onViewMoved(id, x, y);
    });

    // Clicking the grip brings its view forward with it.
    grip.on('focus', () => {
      if (isAlive(view)) view.moveTop();
      if (isAlive(grip)) grip.moveTop();
    });

    // View moved or resized by the app: the grip follows.
    view.on('move', () => {
      if (!entry.syncing) this.syncFromView(id);
    });
    view.on('resize', () => this.syncFromView(id));
    view.on('focus', () => {
      if (isAlive(grip) && grip.isVisible()) grip.moveTop();
    });
    view.on('show', () => {
      this.syncFromView(id);
      if (this.isEnabled() && isAlive(grip)) grip.show();
    });
    view.on('hide', () => {
      if (isAlive(grip)) grip.hide();
    });
    view.on('closed', () => this.detach(id));

    this.syncFromView(id);
    if (this.isEnabled() && view.isVisible()) grip.show();
    return grip;
  }

  detach(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    if (isAlive(entry.grip)) entry.grip.destroy();
  }

  // Position the grip just above the view, or over its top edge when the
  // view is already flush with the top of the display.
  syncFromView(id) {
    const entry = this.entries.get(id);
    if (!entry || !isAlive(entry.grip) || !isAlive(entry.view)) return;
    const { grip, view } = entry;
    const [vx, vy] = view.getPosition();
    const [vw] = view.getContentSize();
    const area = screen.getDisplayMatching(view.getBounds()).workArea;
    entry.mode = vy - GRIP_HEIGHT >= area.y ? 'above' : 'overlay';
    const gy = entry.mode === 'above' ? vy - GRIP_HEIGHT : vy;
    entry.syncing = true;
    const [gw] = grip.getContentSize();
    if (gw !== vw) grip.setContentSize(vw, GRIP_HEIGHT);
    const [gx, gyNow] = grip.getPosition();
    if (gx !== vx || gyNow !== gy) grip.setPosition(vx, gy);
    entry.syncing = false;
    this.sendState(id);
  }

  sendState(id) {
    const entry = this.entries.get(id);
    if (!entry || !isAlive(entry.grip) || !isAlive(entry.view)) return;
    const [x, y] = entry.view.getPosition();
    const [width, height] = entry.view.getContentSize();
    entry.grip.webContents.send('grip:state', { id, label: entry.label, x, y, width, height, mode: entry.mode });
  }

  setLabel(id, label) {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.label = label;
    this.sendState(id);
  }

  nudge(id, dx, dy) {
    const entry = this.entries.get(id);
    if (!entry || !isAlive(entry.view)) return;
    const [x, y] = entry.view.getPosition();
    entry.view.setPosition(x + dx, y + dy);
    this.syncFromView(id);
    this.onViewMoved(id, x + dx, y + dy);
  }

  focusView(id) {
    const entry = this.entries.get(id);
    if (entry && isAlive(entry.view)) entry.view.focus();
  }

  setVisible(visible) {
    for (const [id, entry] of this.entries) {
      if (!isAlive(entry.grip)) continue;
      if (visible && isAlive(entry.view) && entry.view.isVisible()) {
        this.syncFromView(id);
        entry.grip.show();
      } else {
        entry.grip.hide();
      }
    }
  }

  // Map a grip renderer back to its view id (for IPC from the grip page).
  idFor(webContents) {
    for (const [id, entry] of this.entries) {
      if (isAlive(entry.grip) && entry.grip.webContents === webContents) return id;
    }
    return null;
  }
}

module.exports = { Grips, GRIP_HEIGHT };
