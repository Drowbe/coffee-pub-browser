'use strict';

// Persistent configuration for Coffee Pub Browser.
// Stored as JSON in Electron's per-user data directory, e.g.
// ~/Library/Application Support/Coffee Pub Browser/config.json

const fs = require('fs');
const path = require('path');

const CONFIG_VERSION = 1;

const LIMITS = {
  minSize: 100,
  maxSize: 7680,
  minZoom: 0.25,
  maxZoom: 5,
};

function defaultConfig() {
  return {
    version: CONFIG_VERSION,
    openOnLaunch: true,
    showGrips: true,
    views: [
      {
        id: 'game',
        label: 'Game',
        url: 'https://game.coffeepub.live/game',
        width: 1920,
        height: 1080,
        x: null,
        y: null,
        zoom: 1,
        muted: false,
        enabled: true,
      },
      {
        id: 'stream',
        label: 'Stream',
        url: 'https://game.coffeepub.live/stream',
        width: 600,
        height: 1080,
        x: null,
        y: null,
        zoom: 1,
        muted: true,
        enabled: true,
      },
    ],
  };
}

function toInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function toNum(value, fallback) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function sanitizeUrl(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
    return u.toString();
  } catch (err) {
    return fallback;
  }
}

function sanitizeView(input, fallback) {
  const src = input && typeof input === 'object' ? input : {};
  const x = src.x === null || src.x === undefined || src.x === '' ? null : toInt(src.x, null);
  const y = src.y === null || src.y === undefined || src.y === '' ? null : toInt(src.y, null);
  return {
    id: fallback.id,
    label: typeof src.label === 'string' && src.label.trim() ? src.label.trim().slice(0, 40) : fallback.label,
    url: sanitizeUrl(src.url, fallback.url),
    width: clamp(toInt(src.width, fallback.width), LIMITS.minSize, LIMITS.maxSize),
    height: clamp(toInt(src.height, fallback.height), LIMITS.minSize, LIMITS.maxSize),
    x,
    y,
    zoom: clamp(toNum(src.zoom, fallback.zoom), LIMITS.minZoom, LIMITS.maxZoom),
    muted: Boolean(src.muted),
    enabled: src.enabled === undefined ? fallback.enabled : Boolean(src.enabled),
  };
}

// Normalise any object into a valid config. Unknown views are dropped and the
// two required views (game, stream) are always present.
function sanitizeConfig(input) {
  const defaults = defaultConfig();
  const src = input && typeof input === 'object' ? input : {};
  const inputViews = Array.isArray(src.views) ? src.views : [];
  return {
    version: CONFIG_VERSION,
    openOnLaunch: src.openOnLaunch === undefined ? defaults.openOnLaunch : Boolean(src.openOnLaunch),
    showGrips: src.showGrips === undefined ? defaults.showGrips : Boolean(src.showGrips),
    views: defaults.views.map((def) => sanitizeView(inputViews.find((v) => v && v.id === def.id), def)),
  };
}

class ConfigStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = this.load();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return sanitizeConfig(JSON.parse(raw));
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
}

module.exports = { ConfigStore, defaultConfig, sanitizeConfig, LIMITS, CONFIG_VERSION };
