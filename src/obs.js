'use strict';

// Bridge to OBS Studio over its built-in WebSocket server (obs-websocket v5,
// OBS 28+). Keeps OBS "macOS Screen Capture" inputs pointed at this app's
// windows, whose system window IDs change on every launch.

const EventEmitter = require('events');
// JSON encoding: human-readable on the wire and easy to test; OBS speaks both.
const { OBSWebSocket } = require('obs-websocket-js/json');

const INPUT_KIND = 'screen_capture'; // macOS Screen Capture (ScreenCaptureKit)
const CAPTURE_TYPE_WINDOW = 1; // settings.type: 0 display, 1 window, 2 application
const CROP_FILTER_KIND = 'crop_filter'; // OBS "Crop/Pad"
const CROP_FILTER_NAME = 'Coffee Pub Crop';
const RECONNECT_MS = 10000;

class ObsBridge extends EventEmitter {
  /**
   * @param {object} options
   * @param {() => {enabled: boolean, host: string, port: number}} options.getSettings
   * @param {() => string} options.getPassword
   */
  constructor({ getSettings, getPassword }) {
    super();
    this.getSettings = getSettings;
    this.getPassword = getPassword;
    this.obs = new OBSWebSocket();
    this.state = 'disabled';
    this.message = '';
    this.obsVersion = '';
    this.inputs = []; // window-capture inputs known in OBS: [{ name, window }]
    this.lastSync = null;
    this.reconnectTimer = null;
    this.connecting = null;

    this.obs.on('ConnectionClosed', (err) => {
      const wasConnected = this.state === 'connected';
      this.setState('disconnected', wasConnected ? 'Connection to OBS closed.' : (err && err.message) || '');
      this.scheduleReconnect();
    });
    this.obs.on('InputCreated', () => this.refreshInputs().catch(() => {}));
    this.obs.on('InputRemoved', () => this.refreshInputs().catch(() => {}));
    this.obs.on('InputNameChanged', () => this.refreshInputs().catch(() => {}));
  }

  status() {
    return {
      state: this.state,
      message: this.message,
      obsVersion: this.obsVersion,
      inputs: this.inputs.map((i) => i.name),
      lastSync: this.lastSync,
    };
  }

  setState(state, message = '') {
    this.state = state;
    this.message = message;
    this.emit('status', this.status());
  }

  get connected() {
    return this.state === 'connected';
  }

  // Apply the current settings: connect when enabled, disconnect otherwise.
  async start() {
    const settings = this.getSettings();
    clearTimeout(this.reconnectTimer);
    if (!settings.enabled) {
      if (this.connected) await this.obs.disconnect().catch(() => {});
      this.inputs = [];
      this.setState('disabled', '');
      return;
    }
    await this.connect();
  }

  async stop() {
    clearTimeout(this.reconnectTimer);
    await this.obs.disconnect().catch(() => {});
  }

  scheduleReconnect() {
    clearTimeout(this.reconnectTimer);
    if (!this.getSettings().enabled) return;
    this.reconnectTimer = setTimeout(() => this.connect().catch(() => {}), RECONNECT_MS);
  }

  async connect() {
    if (this.connecting) return this.connecting;
    const { host, port } = this.getSettings();
    this.setState('connecting', `Connecting to ${host}:${port}...`);
    this.connecting = (async () => {
      try {
        const password = this.getPassword();
        const hello = await this.obs.connect(`ws://${host}:${port}`, password || undefined, { rpcVersion: 1 });
        this.obsVersion = hello.obsWebSocketVersion || '';
        const version = await this.obs.call('GetVersion');
        this.obsVersion = version.obsVersion || this.obsVersion;
        await this.refreshInputs();
        this.setState('connected', `Connected to OBS ${this.obsVersion}.`);
        this.emit('connected');
      } catch (err) {
        const text = describeError(err);
        this.setState('error', text);
        this.scheduleReconnect();
        throw new Error(text);
      } finally {
        this.connecting = null;
      }
    })();
    return this.connecting;
  }

  // All macOS Screen Capture inputs in window mode, with the window ID each
  // one currently points at.
  async refreshInputs() {
    if (!this.connected && this.state !== 'connecting') return [];
    const { inputs } = await this.obs.call('GetInputList', { inputKind: INPUT_KIND });
    const result = [];
    for (const input of inputs) {
      const { inputSettings } = await this.obs.call('GetInputSettings', { inputName: input.inputName });
      const type = inputSettings.type === undefined ? CAPTURE_TYPE_WINDOW : inputSettings.type;
      if (type !== CAPTURE_TYPE_WINDOW) continue;
      result.push({ name: input.inputName, window: inputSettings.window || 0 });
    }
    this.inputs = result;
    this.emit('status', this.status());
    return result;
  }

  // OBS's own list of capturable windows: [{ itemName, itemValue }]. Needs at
  // least one window-capture input to read the property from.
  async windowChoices() {
    const probe = this.inputs[0];
    if (!probe) return [];
    const { propertyItems } = await this.obs.call('GetInputPropertiesListPropertyItems', {
      inputName: probe.name,
      propertyName: 'window',
    });
    return propertyItems || [];
  }

  async pointInput(inputName, windowId) {
    await this.obs.call('SetInputSettings', {
      inputName,
      inputSettings: { type: CAPTURE_TYPE_WINDOW, window: windowId },
      overlay: true,
    });
  }

  // Create or update the crop filter on a region's input. Crop values are in
  // captured pixels: { left, top, right, bottom }.
  async ensureCropFilter(inputName, crop) {
    const filterSettings = { left: crop.left, top: crop.top, right: crop.right, bottom: crop.bottom, relative: true };
    let exists = false;
    try {
      await this.obs.call('GetSourceFilter', { sourceName: inputName, filterName: CROP_FILTER_NAME });
      exists = true;
    } catch (err) {
      exists = false;
    }
    if (exists) {
      await this.obs.call('SetSourceFilterSettings', { sourceName: inputName, filterName: CROP_FILTER_NAME, filterSettings, overlay: true });
    } else {
      await this.obs.call('CreateSourceFilter', { sourceName: inputName, filterName: CROP_FILTER_NAME, filterKind: CROP_FILTER_KIND, filterSettings });
    }
  }

  async removeInput(inputName) {
    await this.obs.call('RemoveInput', { inputName });
    await this.refreshInputs();
  }

  // Show or hide every scene item that references a source, in top-level
  // scenes and inside groups. Returns how many items were changed.
  async setSourceVisible(sourceName, visible) {
    const { scenes } = await this.obs.call('GetSceneList');
    let changed = 0;
    const apply = async (sceneName, items) => {
      for (const item of items) {
        if (item.sourceName === sourceName) {
          await this.obs.call('SetSceneItemEnabled', { sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled: visible });
          changed += 1;
        }
        if (item.isGroup) {
          const { sceneItems } = await this.obs.call('GetGroupSceneItemList', { sceneName: item.sourceName });
          await apply(item.sourceName, sceneItems);
        }
      }
    };
    for (const scene of scenes) {
      const { sceneItems } = await this.obs.call('GetSceneItemList', { sceneName: scene.sceneName });
      await apply(scene.sceneName, sceneItems);
    }
    return changed;
  }

  async createInput(inputName, windowId) {
    const { currentProgramSceneName } = await this.obs.call('GetCurrentProgramScene');
    await this.obs.call('CreateInput', {
      sceneName: currentProgramSceneName,
      inputName,
      inputKind: INPUT_KIND,
      inputSettings: { type: CAPTURE_TYPE_WINDOW, window: windowId, show_cursor: false },
      sceneItemEnabled: true,
    });
    await this.refreshInputs();
    return inputName;
  }

  /**
   * Point every linked OBS input at the current window ID of its app window
   * and detect inputs that already point at one of our windows.
   *
   * @param {Array<{id: string, title: string, windowId: number|null, sources: string[], crop: object|null,
   *   regions: Array<{name: string, obsSource: string, crop: {left: number, top: number, right: number, bottom: number}}>}>} views
   * @returns {Promise<{pointed: string[], cropped: string[], missing: string[], detected: Array<{id: string, input: string}>}>}
   */
  async syncViews(views) {
    if (!this.connected) throw new Error('Not connected to OBS.');
    await this.refreshInputs();
    const choices = await this.windowChoices().catch(() => []);
    const known = new Set(this.inputs.map((i) => i.name));
    const report = { pointed: [], cropped: [], missing: [], detected: [] };

    // Prefer the window ID OBS itself reports for our title; fall back to
    // the ID Electron knows.
    const resolveId = (view) => {
      const match = choices.find((c) => typeof c.itemName === 'string' && c.itemName.endsWith(view.title));
      if (match && Number.isInteger(match.itemValue)) return match.itemValue;
      return view.windowId;
    };

    for (const view of views) {
      const windowId = resolveId(view);
      // Detect unlinked inputs already pointing at this window.
      for (const input of this.inputs) {
        if (windowId && input.window === windowId && !view.sources.includes(input.name)) {
          const takenElsewhere = views.some((v) => v !== view && v.sources.includes(input.name));
          if (!takenElsewhere) report.detected.push({ id: view.id, input: input.name });
        }
      }
      const regionSources = view.regions.filter((r) => r.obsSource).map((r) => r.obsSource);
      for (const name of [...view.sources, ...regionSources]) {
        if (!known.has(name)) {
          report.missing.push(name);
          continue;
        }
        if (!windowId) continue; // window not open
        const current = this.inputs.find((i) => i.name === name);
        if (current && current.window === windowId) continue;
        await this.pointInput(name, windowId);
        report.pointed.push(name);
      }
      // Window-level sources get a crop that removes the app's own bar.
      if (view.crop && windowId) {
        for (const name of view.sources) {
          if (!known.has(name)) continue;
          await this.ensureCropFilter(name, view.crop);
          report.cropped.push(name);
        }
      }
      for (const region of view.regions) {
        if (!region.obsSource || !known.has(region.obsSource) || !region.crop) continue;
        await this.ensureCropFilter(region.obsSource, region.crop);
        report.cropped.push(region.obsSource);
      }
    }
    this.lastSync = { at: Date.now(), ...report };
    this.emit('status', this.status());
    return report;
  }
}

function describeError(err) {
  const msg = (err && err.message) || String(err);
  if (/ECONNREFUSED/.test(msg)) return 'OBS is not running or its WebSocket server is off (Tools > WebSocket Server Settings).';
  if (/4009|auth/i.test(msg)) return 'OBS rejected the password.';
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Host not found.';
  return msg;
}

module.exports = { ObsBridge, INPUT_KIND };
