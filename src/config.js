'use strict';

// Persistent configuration for Coffee Pub Studio.
// Stored as JSON in Electron's per-user data directory, e.g.
// ~/Library/Application Support/Coffee Pub Studio/config.json

const fs = require('fs');
const path = require('path');

// Version 12 reads only the current field names: the old ones (obsSources,
// openOnLaunch, obs.enabled, the pre-0.1.9 Tavern names) are no longer
// migrated.
const CONFIG_VERSION = 12;

// Session groups: windows with the same group name share cookies and storage.
const DEFAULT_GROUP = 'Main';

const LIMITS = {
  minSize: 100,
  maxSize: 7680,
  minViews: 1,
  maxViews: 5,
};

// Defaults for the first two windows on a fresh install.
const SEED_VIEWS = [
  { id: 'game', label: 'Game', url: 'https://game.coffeepub.live/game', width: 1920, height: 1080, muted: false, wholeWindow: true },
  // Same size as the canvas: regions pick out the chat and any widgets a module adds anywhere
  // on the page, so the whole window is not a source by default.
  { id: 'stream', label: 'Stream', url: 'https://game.coffeepub.live/stream', width: 1920, height: 1080, muted: true, wholeWindow: false },
];

// The OBS source name a window gets unless the user picks another.
function defaultSourceName(label) {
  return `Coffee Pub - ${label}`;
}

function defaultView(index) {
  const seed = SEED_VIEWS[index];
  const label = seed ? seed.label : `Window ${index + 1}`;
  return {
    id: seed ? seed.id : `window${index + 1}`,
    label,
    url: seed ? seed.url : '',
    width: seed ? seed.width : 1280,
    height: seed ? seed.height : 720,
    x: null,
    y: null,
    muted: seed ? seed.muted : true,
    enabled: true,
    dockOnLaunch: false,
    wakeAudio: true,
    session: DEFAULT_GROUP,
    windowSource: { enabled: seed ? seed.wholeWindow : true, name: defaultSourceName(label) },
    regions: [],
  };
}

// A free-form session group name; empty means the default group.
function sanitizeSession(value) {
  if (value === undefined || value === null) return DEFAULT_GROUP;
  const text = String(value).trim().slice(0, 40);
  return text || DEFAULT_GROUP;
}

const REGION_LIMITS = { maxRegions: 12, maxSelector: 300 };

// A region is a named rectangle inside a window, in window points. In
// selector mode the rectangle is re-measured from the page element.
function sanitizeRegion(input, index, taken) {
  const src = input && typeof input === 'object' ? input : {};
  let id = sanitizeId(src.id, `region${index + 1}`);
  let n = 2;
  while (taken.has(id)) id = `region${index + 1}-${n++}`;
  taken.add(id);
  const positive = (v, fallback) => Math.max(0, toInt(v, fallback));
  return {
    id,
    name: typeof src.name === 'string' && src.name.trim() ? src.name.trim().slice(0, 40) : `Region ${index + 1}`,
    mode: src.mode === 'selector' ? 'selector' : 'rect',
    selector: typeof src.selector === 'string' ? src.selector.trim().slice(0, REGION_LIMITS.maxSelector) : '',
    x: positive(src.x, 0),
    y: positive(src.y, 0),
    width: Math.max(1, toInt(src.width, 100)),
    height: Math.max(1, toInt(src.height, 100)),
    obsSource: typeof src.obsSource === 'string' ? src.obsSource.trim().slice(0, 200) : '',
    enabled: src.enabled === undefined ? true : Boolean(src.enabled),
  };
}

function sanitizeRegions(value) {
  if (!Array.isArray(value)) return [];
  const taken = new Set();
  return value.slice(0, REGION_LIMITS.maxRegions).map((r, i) => sanitizeRegion(r, i, taken));
}

function defaultDock() {
  // overlap: points of a docked window left on screen (0 = fully off screen).
  return { enabled: true, side: 'right', overlap: 6 };
}

function sanitizeDock(input) {
  const d = defaultDock();
  const src = input && typeof input === 'object' ? input : {};
  return {
    enabled: src.enabled === undefined ? d.enabled : Boolean(src.enabled),
    side: src.side === 'left' ? 'left' : 'right',
    overlap: clamp(toInt(src.overlap, d.overlap), 0, 36),
  };
}

function defaultObs() {
  return { autoConnect: false, host: '127.0.0.1', port: 4455 };
}

// Coffee Pub Tavern: the voice and video server for the people at the table.
// Each published user gets a Player source (video, or their player image when
// the camera is off) and optionally a Character source (their character image
// with talking and muted images on top).
function defaultTavern() {
  return {
    enabled: false, url: '', login: '', autoConnect: true,
    playerWidth: 640, playerHeight: 360, lockRatio: true,
    characterWidth: 256, characterHeight: 256, characterWithPlayer: false,
    room: 'lobby', // the Tavern room whose members the Tavern tab shows
    players: {},
  };
}

function sanitizeTavern(input) {
  const d = defaultTavern();
  const src = input && typeof input === 'object' ? input : {};
  const players = {};
  if (src.players && typeof src.players === 'object') {
    for (const [key, value] of Object.entries(src.players)) {
      if (!/^[a-z0-9]{4,16}$/.test(key) || !value || typeof value !== 'object') continue;
      const entry = {
        source: typeof value.source === 'string' ? value.source.trim().slice(0, 200) : '',
        characterSource: typeof value.characterSource === 'string' ? value.characterSource.trim().slice(0, 200) : '',
        // The Player and Character ticks
        player: value.player === undefined ? true : Boolean(value.player),
        character: value.character === undefined ? Boolean(value.characterSource) : Boolean(value.character),
      };
      const touched = value.player !== undefined || value.character !== undefined;
      if (entry.source || entry.characterSource || touched) players[key] = entry;
    }
  }
  return {
    enabled: src.enabled === undefined ? d.enabled : Boolean(src.enabled),
    url: sanitizeUrl(src.url).replace(/\/+$/, ''),
    login: typeof src.login === 'string' ? src.login.trim().slice(0, 40) : d.login,
    autoConnect: src.autoConnect === undefined ? d.autoConnect : Boolean(src.autoConnect),
    playerWidth: clamp(toInt(src.playerWidth, d.playerWidth), 64, 3840),
    playerHeight: clamp(toInt(src.playerHeight, d.playerHeight), 64, 2160),
    lockRatio: src.lockRatio === undefined ? d.lockRatio : Boolean(src.lockRatio),
    characterWidth: clamp(toInt(src.characterWidth, d.characterWidth), 32, 3840),
    characterHeight: clamp(toInt(src.characterHeight, d.characterHeight), 32, 2160),
    characterWithPlayer: src.characterWithPlayer === undefined ? d.characterWithPlayer : Boolean(src.characterWithPlayer),
    room: typeof src.room === 'string' && /^[a-z0-9_-]{1,40}$/i.test(src.room) ? src.room : 'lobby',
    players,
  };
}

// Where the control panel was last left; null lets Electron place it.
function sanitizePanel(input) {
  if (!input || typeof input !== 'object') return null;
  const x = toInt(input.x, null);
  const y = toInt(input.y, null);
  const width = toInt(input.width, null);
  const height = toInt(input.height, null);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width: clamp(width, 720, 7680), height: clamp(height, 560, 4320) };
}

function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    panel: null,
    menuBarIcon: true,
    hideDockIcon: false,
    wakeAudioDelay: 30, // seconds after a page loads before its audio is woken
    // On a Retina display OBS captures twice the pixels; false scales the
    // app's sources by half in OBS so they land at the configured size.
    retinaDouble: false,
    arrangeDisplayId: null,
    dock: defaultDock(),
    obs: defaultObs(),
    tavern: defaultTavern(),
    views: [defaultView(0), defaultView(1)],
  };
}

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

// Returns a normalised http(s) URL, or '' when the value is empty or invalid.
function sanitizeUrl(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch (err) {
    return '';
  }
}

function sanitizeId(value, fallback) {
  return typeof value === 'string' && /^[a-z0-9_-]{1,40}$/i.test(value) ? value : fallback;
}

function sanitizeView(input, index) {
  const fallback = defaultView(index);
  const src = input && typeof input === 'object' ? input : {};
  const x = src.x === null || src.x === undefined || src.x === '' ? null : toInt(src.x, null);
  const y = src.y === null || src.y === undefined || src.y === '' ? null : toInt(src.y, null);
  const label = typeof src.label === 'string' && src.label.trim() ? src.label.trim().slice(0, 40) : fallback.label;
  return {
    id: sanitizeId(src.id, fallback.id),
    label,
    url: src.url === undefined ? fallback.url : sanitizeUrl(src.url),
    width: clamp(toInt(src.width, fallback.width), LIMITS.minSize, LIMITS.maxSize),
    height: clamp(toInt(src.height, fallback.height), LIMITS.minSize, LIMITS.maxSize),
    x,
    y,
    muted: src.muted === undefined ? fallback.muted : Boolean(src.muted),
    enabled: src.enabled === undefined ? fallback.enabled : Boolean(src.enabled),
    dockOnLaunch: src.dockOnLaunch === undefined ? fallback.dockOnLaunch : Boolean(src.dockOnLaunch),
    wakeAudio: src.wakeAudio === undefined ? fallback.wakeAudio : Boolean(src.wakeAudio),
    session: sanitizeSession(src.session),
    windowSource: sanitizeWindowSource(src.windowSource, label, fallback),
    regions: sanitizeRegions(src.regions),
  };
}

// The whole window as one OBS source: an on/off switch and the source name.
function sanitizeWindowSource(input, label, fallback) {
  const ws = input && typeof input === 'object' ? input : null;
  const enabled = ws && ws.enabled !== undefined ? Boolean(ws.enabled) : fallback.windowSource.enabled;
  const raw = ws && typeof ws.name === 'string' ? ws.name : '';
  const name = raw.trim().slice(0, 200) || defaultSourceName(label);
  return { enabled, name };
}

function sanitizeObs(input) {
  const d = defaultObs();
  const src = input && typeof input === 'object' ? input : {};
  const host = typeof src.host === 'string' && src.host.trim() ? src.host.trim().slice(0, 200) : d.host;
  return {
    autoConnect: Boolean(src.autoConnect),
    host,
    port: clamp(toInt(src.port, d.port), 1, 65535),
  };
}

// Normalise any object into a valid config with 1 to 5 views and unique ids.
function sanitizeConfig(input) {
  const defaults = defaultConfig();
  const src = input && typeof input === 'object' ? input : {};
  let inputViews = Array.isArray(src.views) ? src.views : defaults.views;
  if (inputViews.length < LIMITS.minViews) inputViews = defaults.views.slice(0, LIMITS.minViews);
  inputViews = inputViews.slice(0, LIMITS.maxViews);

  const seen = new Set();
  const views = inputViews.map((v, index) => {
    const view = sanitizeView(v, index);
    let id = view.id;
    let n = 2;
    while (seen.has(id)) id = `${view.id}-${n++}`;
    seen.add(id);
    return { ...view, id };
  });

  return {
    version: CONFIG_VERSION,
    menuBarIcon: src.menuBarIcon === undefined ? defaults.menuBarIcon : Boolean(src.menuBarIcon),
    hideDockIcon: src.hideDockIcon === undefined ? defaults.hideDockIcon : Boolean(src.hideDockIcon),
    wakeAudioDelay: clamp(toInt(src.wakeAudioDelay, defaults.wakeAudioDelay), 10, 300),
    retinaDouble: src.retinaDouble === undefined ? defaults.retinaDouble : Boolean(src.retinaDouble),
    arrangeDisplayId: Number.isFinite(Number(src.arrangeDisplayId)) && src.arrangeDisplayId !== null ? Number(src.arrangeDisplayId) : null,
    dock: sanitizeDock(src.dock),
    obs: sanitizeObs(src.obs),
    tavern: sanitizeTavern(src.tavern),
    panel: sanitizePanel(src.panel),
    views,
  };
}

class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.loadedVersion = null;
    this.data = this.load();
    // Rewrite files saved by an older version so they carry the new shape.
    if (this.loadedVersion !== null && this.loadedVersion !== CONFIG_VERSION) {
      this.save(this.data);
    }
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.loadedVersion = parsed && typeof parsed === 'object' ? parsed.version : undefined;
      return sanitizeConfig(parsed);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`[config] Could not read ${this.filePath}, using defaults: ${err.message}`);
      }
      return defaultConfig();
    }
  }

  save(next) {
    this.data = sanitizeConfig(next);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.filePath);
    return this.data;
  }

  get() {
    return JSON.parse(JSON.stringify(this.data));
  }

  getView(id) {
    return this.data.views.find((v) => v.id === id) || null;
  }

  updateView(id, patch) {
    const views = this.data.views.map((v) => (v.id === id ? { ...v, ...patch } : v));
    return this.save({ ...this.data, views });
  }

  getRegion(viewId, regionId) {
    const view = this.getView(viewId);
    return view ? view.regions.find((r) => r.id === regionId) || null : null;
  }

  // Add (no id / unknown id) or replace a region on a view. Returns the saved region.
  saveRegion(viewId, region) {
    const view = this.getView(viewId);
    if (!view) throw new Error(`Unknown view: ${viewId}`);
    const regions = view.regions.slice();
    const index = regions.findIndex((r) => r.id === region.id);
    if (index >= 0) {
      regions[index] = { ...regions[index], ...region, id: regions[index].id };
    } else {
      if (regions.length >= REGION_LIMITS.maxRegions) throw new Error(`At most ${REGION_LIMITS.maxRegions} regions per window.`);
      regions.push({ ...region, id: undefined });
    }
    const saved = this.updateView(viewId, { regions });
    const savedView = saved.views.find((v) => v.id === viewId);
    return index >= 0 ? savedView.regions[index] : savedView.regions[savedView.regions.length - 1];
  }

  removeRegion(viewId, regionId) {
    const view = this.getView(viewId);
    if (!view) return;
    this.updateView(viewId, { regions: view.regions.filter((r) => r.id !== regionId) });
  }

  // Append a new view with defaults. Returns it, or null when at the limit.
  addView() {
    const views = this.data.views.slice();
    if (views.length >= LIMITS.maxViews) return null;
    const taken = new Set(views.map((v) => v.id));
    const view = defaultView(views.length);
    let id = view.id;
    let n = 2;
    while (taken.has(id)) id = `${view.id}-${n++}`;
    views.push({ ...view, id });
    const saved = this.save({ ...this.data, views });
    return saved.views[saved.views.length - 1];
  }

  // Remove a view by id. The last remaining view cannot be removed.
  removeView(id) {
    if (this.data.views.length <= LIMITS.minViews) return false;
    const views = this.data.views.filter((v) => v.id !== id);
    if (views.length === this.data.views.length) return false;
    this.save({ ...this.data, views });
    return true;
  }
}

module.exports = { ConfigStore, defaultConfig, sanitizeConfig, defaultSourceName, LIMITS, REGION_LIMITS, CONFIG_VERSION, DEFAULT_GROUP };
