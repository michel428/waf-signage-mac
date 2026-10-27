// Fenêtre cachée « lumières » : pont entre hardware.js et l'appli (main.js)
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('HW', {
  ready: () => ipcRenderer.send('hw:ready'),
  status: (s) => ipcRenderer.send('hw:status', s),
  wantSerial: () => ipcRenderer.send('hw:want-serial'),
  wantCec: () => ipcRenderer.send('hw:want-cec'),
  cecReady: () => ipcRenderer.send('hw:cec-ready'),
  wantBle: (filter) => ipcRenderer.send('hw:want-ble', filter || ''),
  lastSeen: () => ipcRenderer.sendSync('hw:last-seen')
});
