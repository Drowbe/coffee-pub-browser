'use strict';

// Bridge to a Coffee Pub Tavern server: signs in as an admin, fetches the
// stream key and the party with live state, and builds OBS view links.

const EventEmitter = require('events');

const POLL_MS = 5000;
const RECONNECT_MS = 15000;
const TIMEOUT_MS = 8000;

class TavernBridge extends EventEmitter {
  /**
   * @param {object} options
   * @param {() => {url: string, login: string, autoConnect: boolean}} options.getSettings
   * @param {() => string} options.getPassword
   */
  constructor({ getSettings, getPassword }) {
    super();
    this.getSettings = getSettings;
    this.getPassword = getPassword;
    this.state = 'disconnected';
    this.message = '';
    this.suspended = false;
    this.token = '';
    this.streamKey = '';
    this.me = null;
    this.branding = null;
    this.party = []; // users with live state, as /api/status reports them
    this.pollTimer = null;
    this.reconnectTimer = null;
    this.connecting = null;
    this.lastPoll = 0;
  }

  status() {
    return {
      state: this.state,
      message: this.message,
      url: this.getSettings().url,
      serverName: this.branding?.serverName || '',
      tableName: this.branding?.tableName || '',
      version: this.branding?.version || '',
      streamKey: this.streamKey,
      party: this.party,
      lastPoll: this.lastPoll,
    };
  }

  get connected() {
    return this.state === 'connected';
  }

  setState(state, message = '') {
    this.state = state;
    this.message = message;
    this.emit('status', this.status());
  }

  async start() {
    clearTimeout(this.reconnectTimer);
    const { enabled, url, autoConnect } = this.getSettings();
    if (!enabled || !autoConnect || !url) return;
    await this.connect().catch(() => {});
  }

  async stop() {
    clearTimeout(this.reconnectTimer);
    this.stopPolling();
  }

  async disconnect() {
    clearTimeout(this.reconnectTimer);
    this.stopPolling();
    this.suspended = true;
    this.token = '';
    this.streamKey = '';
    this.party = [];
    this.setState('disconnected', 'Disconnected.');
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    const { enabled, autoConnect } = this.getSettings();
    if (!enabled || !autoConnect || this.suspended) return;
    this.reconnectTimer = setTimeout(() => this.connect().catch(() => {}), RECONNECT_MS);
  }

  async connect() {
    if (this.connecting) return this.connecting;
    this.suspended = false;
    const { enabled, url, login } = this.getSettings();
    if (!enabled) {
      this.setState('disconnected', 'Coffee Pub Tavern is turned off.');
      throw new Error(this.message);
    }
    if (!url) {
      this.setState('error', 'Enter the Tavern address first.');
      throw new Error(this.message);
    }
    this.setState('connecting', `Signing in to ${url}...`);
    const attempt = (async () => {
      try {
        const password = this.getPassword();
        if (!login || !password) throw new Error('Enter the admin login and password.');
        const auth = await this.request('POST', '/api/login', { login, password }, { anonymous: true });
        this.token = auth.token;
        const me = await this.request('GET', '/api/me');
        if (me.user.role !== 'admin') throw new Error(`${me.user.displayName} is not an admin on this server.`);
        this.me = me.user;
        this.streamKey = me.streamKey || '';
        this.branding = { serverName: me.serverName, tableName: me.tableName, version: me.version };
        await this.poll();
        this.setState('connected', `Signed in to ${this.branding.serverName} as ${me.user.displayName}.`);
        this.startPolling();
        this.emit('connected');
      } catch (err) {
        this.token = '';
        this.setState('error', describeError(err));
        this.scheduleReconnect();
        throw new Error(this.message);
      }
    })();
    // Clear the in-progress marker only once the attempt has settled; a
    // synchronous failure inside the attempt must not leave it set forever.
    this.connecting = attempt.finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  startPolling() {
    this.stopPolling();
    this.pollTimer = setInterval(() => this.poll().catch((err) => this.onPollError(err)), POLL_MS);
  }

  stopPolling() {
    clearInterval(this.pollTimer);
    this.pollTimer = null;
  }

  onPollError(err) {
    if (this.state !== 'connected') return;
    this.stopPolling();
    this.token = '';
    this.setState('error', `Lost the Tavern: ${describeError(err)}`);
    this.scheduleReconnect();
  }

  // The party with live state; emits 'party' when anything changed.
  async poll() {
    const status = await this.request('GET', '/api/status');
    const next = status.users.map((u) => ({
      key: u.key,
      login: u.login,
      displayName: u.displayName,
      role: u.role,
      images: u.images,
      player: u.player,
      viewUrl: u.viewUrl,
      online: u.online,
    }));
    this.branding = { serverName: status.serverName, tableName: status.tableName, version: status.version };
    this.lastPoll = Date.now();
    const changed = JSON.stringify(next) !== JSON.stringify(this.party);
    this.party = next;
    if (changed) {
      this.emit('party', this.party);
      this.emit('status', this.status());
    }
    return this.party;
  }

  // OBS view link for a user: kind is 'player' or 'character'. The name
  // plate, border and badge are the user's Player options on the Tavern.
  viewUrl(user, { kind = 'player' } = {}) {
    const base = `${this.getSettings().url}/view/${encodeURIComponent(user.key)}`;
    const q = new URLSearchParams({ s: this.streamKey, kind });
    return `${base}?${q}`;
  }

  imageUrl(user, slot = 'player') {
    return `${this.getSettings().url}/img/${encodeURIComponent(user.key)}/${slot}?s=${encodeURIComponent(this.streamKey)}`;
  }

  async kick(key) {
    await this.request('POST', `/api/users/${encodeURIComponent(key)}/kick`);
  }

  async mute(key) {
    await this.request('POST', `/api/users/${encodeURIComponent(key)}/mute`, { muted: true });
  }

  async request(method, pathname, body, { anonymous = false } = {}) {
    const { url } = this.getSettings();
    const headers = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (!anonymous) {
      if (!this.token) throw new Error('Not signed in.');
      headers.authorization = `Bearer ${this.token}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${url}${pathname}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal });
      let data = {};
      try {
        data = await res.json();
      } catch (err) {
        data = {};
      }
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
}

function describeError(err) {
  const msg = (err && err.message) || String(err);
  if (/aborted|AbortError/i.test(msg)) return 'The Tavern did not answer in time.';
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|EAI_AGAIN/i.test(msg)) return 'Could not reach the Tavern at that address.';
  if (/wrong login or password/i.test(msg)) return 'The Tavern rejected the login or password.';
  return msg;
}

module.exports = { TavernBridge };
