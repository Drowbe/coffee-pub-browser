'use strict';

// Exposes a small, explicit API to the control panel renderer.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('coffeePub', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  resetConfig: () => ipcRenderer.invoke('config:reset'),
  getStatus: () => ipcRenderer.invoke('status:get'),
  getDisplays: () => ipcRenderer.invoke('displays:get'),
  openView: (id) => ipcRenderer.invoke('view:open', id),
  closeView: (id) => ipcRenderer.invoke('view:close', id),
  reloadView: (id) => ipcRenderer.invoke('view:reload', id),
  resetView: (id) => ipcRenderer.invoke('view:reset', id),
  devToolsView: (id) => ipcRenderer.invoke('view:devtools', id),
  obsSetSettings: (settings) => ipcRenderer.invoke('obs:setSettings', settings),
  obsSetPassword: (password) => ipcRenderer.invoke('obs:setPassword', password),
  obsConnect: () => ipcRenderer.invoke('obs:connect'),
  obsSync: () => ipcRenderer.invoke('obs:sync'),
  obsCreateSource: (id) => ipcRenderer.invoke('obs:createSource', id),
  obsLinkSource: (id, inputName) => ipcRenderer.invoke('obs:linkSource', id, inputName),
  obsUnlinkSource: (id, inputName) => ipcRenderer.invoke('obs:unlinkSource', id, inputName),
  obsCreateRegionSource: (id, regionId) => ipcRenderer.invoke('obs:createRegionSource', id, regionId),
  snapshotView: (id) => ipcRenderer.invoke('view:snapshot', id),
  measureView: (id, selector) => ipcRenderer.invoke('view:measure', id, selector),
  saveRegion: (id, region) => ipcRenderer.invoke('regions:save', id, region),
  removeRegion: (id, regionId) => ipcRenderer.invoke('regions:remove', id, regionId),
  regionLimits: () => ipcRenderer.invoke('regions:limits'),
  arrangeViews: (displayId) => ipcRenderer.invoke('views:arrange', displayId),
  setShowGrips: (visible) => ipcRenderer.invoke('grips:set', visible),
  setViewCount: (count) => ipcRenderer.invoke('views:setCount', count),
  openAll: () => ipcRenderer.invoke('views:openAll'),
  closeAll: () => ipcRenderer.invoke('views:closeAll'),
  clearSession: () => ipcRenderer.invoke('session:clear'),
  revealConfig: () => ipcRenderer.invoke('config:reveal'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('status', listener);
    return () => ipcRenderer.removeListener('status', listener);
  },
});
