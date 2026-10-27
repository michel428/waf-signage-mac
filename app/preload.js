// Expose window.WafApp — même API que l'appli Android (boot.html et player signage.js)
const { contextBridge, ipcRenderer } = require('electron');
const s = (fn, a, b) => ipcRenderer.sendSync('waf:sync', fn, a, b);
const d = (fn) => ipcRenderer.send('waf:do', fn);

contextBridge.exposeInMainWorld('WafApp', {
  platform: () => 'mac',
  baseUrl: () => s('baseUrl'),
  version: () => s('version'),
  device: () => s('device'),
  screenName: () => s('screenName'),
  slug: () => s('slug'),
  label: () => s('label'),
  setScreen: (slug, label) => s('setScreen', slug, label),
  clearScreen: () => s('clearScreen'),
  online: () => navigator.onLine,
  autostartOk: () => s('autostartOk'),
  isLauncher: () => true,
  start: () => d('start'),
  pair: () => d('pair'),
  restart: () => d('restart'),
  openAutostart: () => d('openAutostart'),
  openLauncherSettings: () => {},
  openSettings: () => d('openSettings'),
  http: (id, url) => ipcRenderer.send('waf:http', id, url),
  // Revenir seul à l'affichage
  keepFront: () => s('keepFront'),
  keepFrontMinutes: () => s('keepFrontMinutes'),
  setKeepFront: (on) => s('setKeepFront', !!on),
  // Diagnostic (Monitoring) + infos système (menu)
  deviceDiag: () => s('deviceDiag'),
  androidInfo: () => s('systemInfo'),
  // Lumières : lyres DMX + ruban LED Bluetooth
  dmxSet: (json, fade) => ipcRenderer.send('waf:dmx', String(json || '{}'), fade | 0),
  dmxStatus: () => s('dmxStatus'),
  bleStatus: () => s('bleStatus'),
  bleConnected: () => s('bleConnected'),
  bleConnect: () => d('bleConnect'),
  bleTest: () => d('bleTest'),
  openBluetoothSettings: () => d('openBluetoothSettings'),
  // Vidéos gardées sur le Mac (signage.js les annonce dès le chargement de la playlist)
  videoPrefetch: (url) => ipcRenderer.send('waf:prefetch', String(url || '')),
  // TV par HDMI-CEC (adaptateur USB Pulse-Eight) + accès à distance
  cecStatus: () => s('cecStatus'),
  tvOn: () => d('tvOn'),
  tvOff: () => d('tvOff'),
  remoteInfo: () => s('remoteInfo'),
  openSharing: () => d('openSharing'),
  // Commandes à distance (Monitoring)
  appRestart: () => d('appRestart'),
  reboot: () => d('reboot'),
  updateNow: () => d('updateNow'),
  // Mises à jour (menu)
  updateInfo: () => s('updateInfo'),
  checkUpdate: () => d('checkUpdate'),
  updatesOk: () => s('updatesOk'),
  openUpdatesPermission: () => d('openUpdatesPermission')
});

// Clics dans le coin haut-gauche (sur l'affichage) → menu
window.addEventListener('mousedown', (e) => {
  if (e.clientX < 140 && e.clientY < 140) ipcRenderer.send('waf:corner-click');
}, true);

// Mode veille du player (club fermé) → l'appli éteint vraiment les écrans
window.addEventListener('DOMContentLoaded', () => {
  let last = null;
  const check = () => {
    const sleeping = !!document.querySelector('.sg-root-sleeping');
    if (sleeping !== last) { last = sleeping; ipcRenderer.send('waf:sleep', sleeping); }
  };
  new MutationObserver(check).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['class'] });
  check();
});
