'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('grip', {
  onState: (callback) => {
    ipcRenderer.on('grip:state', (_event, state) => callback(state));
  },
  nudge: (dx, dy) => ipcRenderer.send('grip:nudge', dx, dy),
  focusView: () => ipcRenderer.send('grip:focusView'),
});
