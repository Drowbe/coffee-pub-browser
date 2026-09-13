'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bar', {
  onState: (callback) => {
    ipcRenderer.on('bar:state', (_event, state) => callback(state));
  },
  resize: (dw, dh) => ipcRenderer.send('bar:resize', dw, dh),
  focusPage: () => ipcRenderer.send('bar:focusPage'),
});
