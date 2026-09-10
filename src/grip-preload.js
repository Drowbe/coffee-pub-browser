'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('grip', {
  onState: (callback) => {
    ipcRenderer.on('grip:state', (_event, state) => callback(state));
  },
  resize: (dw, dh) => ipcRenderer.send('grip:resize', dw, dh),
  focusView: () => ipcRenderer.send('grip:focusView'),
});
