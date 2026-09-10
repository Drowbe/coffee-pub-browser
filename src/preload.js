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
  focusView: (id) => ipcRenderer.invoke('view:focus', id),
  devToolsView: (id) => ipcRenderer.invoke('view:devtools', id),
  centerView: (id, displayId) => ipcRenderer.invoke('view:center', id, displayId),
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
