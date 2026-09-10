'use strict';

// Persistent configuration for Coffee Pub Browser.
// Stored as JSON in Electron's per-user data directory, e.g.
// ~/Library/Application Support/Coffee Pub Browser/config.json

const fs = require('fs');
const path = require('path');

const CONFIG_VERSION = 4;

const LIMITS = {
  minSize: 100,
  maxSize: 7680,
  minViews: 1,
  maxViews: 5,
};

// Defaults for the first two windows on a fresh install.
const SEED_VIEWS = [
  { id: 'game', label: 'Game', url: 'https://game.coffeepub.live/game', width: 1920, height: 1080, muted: false },
  { id: 'stream', label: 'Stream', url: 'https://game.coffeepub.live/stream', width: 600, height: 1080, muted: true },
];

function defaultView(index) {
  const seed = SEED_VIEWS[index];
  return {
    id: seed ? seed.id : `window${index + 1}`,
    label: seed ? seed.label : `Window ${index + 1}`,
    url: seed ? seed.url : '',
    width: seed ? seed.width : 1280,
    height: seed ? seed.height : 720,
    x: null,
    y: null,
    muted: seed ? seed.muted : true,
    enabled: true,
    obsSources: [],
    regions: [],
  };
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
  };
}

function sanitizeRegions(value) {
  if (!Array.isArray(value)) return [];
  const taken = new Set();
  return value.slice(0, REGION_LIMITS.maxRegions).map((r, i) => sanitizeRegion(r, i, taken));
}

function defaultObs() {
  return { enabled: false, host: '127.0.0.1', port: 4455 };
}

function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    openOnLaunch: true,
    showGrips: true,
    obs: defaultObs(),
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
  return {
    id: sanitizeId(src.id, fallback.id),
    label: typeof src.label === 'string' && src.label.trim() ? src.label.trim().slice(0, 40) : fallback.label,
    url: src.url === undefined ? fallback.url : sanitizeUrl(src.url),
    width: clamp(toInt(src.width, fallback.width), LIMITS.minSize, LIMITS.maxSize),
    height: clamp(toInt(src.height, fallback.height), LIMITS.minSize, LIMITS.maxSize),
    x,
    y,
    muted: src.muted === undefined ? fallback.muted : Boolean(src.muted),
    enabled: src.enabled === undefined ? fallback.enabled : Boolean(src.enabled),
    obsSources: sanitizeSources(src.obsSources),
    regions: sanitizeRegions(src.regions),
  };
}

// Names of OBS inputs that should follow this window.
function sanitizeSources(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const v of value) {
    if (typeof v !== 'string') continue;
    const name = v.trim().slice(0, 200);
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

function sanitizeObs(input) {
  const d = defaultObs();
  const src = input && typeof input === 'object' ? input : {};
  const host = typeof src.host === 'string' && src.host.trim() ? src.host.trim().slice(0, 200) : d.host;
  return {
    enabled: Boolean(src.enabled),
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
    openOnLaunch: src.openOnLaunch === undefined ? defaults.openOnLaunch : Boolean(src.openOnLaunch),
    showGrips: src.showGrips === undefined ? defaults.showGrips : Boolean(src.showGrips),
    obs: sanitizeObs(src.obs),
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

  // Grow or shrink the list of views to `count`. New views get defaults;
  // removed views are dropped from the end. Returns the ids that were removed.
  setViewCount(count) {
    const target = clamp(toInt(count, this.data.views.length), LIMITS.minViews, LIMITS.maxViews);
    const views = this.data.views.slice(0, target);
    const removed = this.data.views.slice(target).map((v) => v.id);
    const taken = new Set(views.map((v) => v.id));
    while (views.length < target) {
      const view = defaultView(views.length);
      let id = view.id;
      let n = 2;
      while (taken.has(id)) id = `${view.id}-${n++}`;
      taken.add(id);
      views.push({ ...view, id });
    }
    this.save({ ...this.data, views });
    return removed;
  }
}

module.exports = { ConfigStore, defaultConfig, sanitizeConfig, LIMITS, REGION_LIMITS, CONFIG_VERSION };
