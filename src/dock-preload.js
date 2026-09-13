'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dock', {
  onState: (callback) => {
    ipcRenderer.on('dock:state', (_event, state) => callback(state));
  },
  hover: (expanded) => ipcRenderer.send('dock:hover', expanded),
  toggle: (id) => ipcRenderer.send('dock:toggle', id),
  parkAll: () => ipcRenderer.send('dock:parkAll'),
  restoreAll: () => ipcRenderer.send('dock:restoreAll'),
  action: (name) => ipcRenderer.send('dock:action', name),
});
