/**
 * WAF Signage — appli Mac (macOS 10.13 High Sierra et plus récent).
 *
 * Mêmes fonctions que l'appli Android :
 *  - une fenêtre plein écran par écran branché (Écran 1 = le plus à gauche…),
 *    animation de lancement → écran configuré (compte à rebours) ou configuration
 *    (code d'association, ou écran existant) → /player/?screen=<slug> ;
 *  - démarrage automatique à l'ouverture de session + relance si l'appli plante
 *    (agent launchd), écran jamais en veille, retour automatique à l'affichage ;
 *  - veille réelle des moniteurs quand le club est fermé ;
 *  - lumières : lyres DMX (adaptateur USB Open DMX / FTDI) + ruban LED Bluetooth ;
 *  - diagnostic du Mac pour le Monitoring, commandes à distance (redémarrer l'appli,
 *    redémarrer le Mac, mise à jour), mises à jour automatiques la nuit.
 *
 * Raccourcis : F1 / Ctrl+M / Cmd+M → menu · Ctrl+Alt+R (ou Cmd+Alt+R) → tout recharger
 *              Ctrl+Alt+Q (ou Cmd+Alt+Q) → quitter · 5 clics dans le coin haut-gauche → menu
 */
const { app, BrowserWindow, screen, ipcMain, powerSaveBlocker, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');

const BASE = 'https://signage.waf-forme.fr';
const BOOT = path.join(__dirname, 'boot.html');
const AGENT_LABEL = 'fr.wafforme.signage';
const UA_TAG = () => 'WAFSignageApp/mac-' + app.getVersion();

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'Translate,MediaSessionService,CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-pinch');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('enable-web-bluetooth');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const run = (cmd, args) => new Promise(res => execFile(cmd, args, { timeout: 15000 }, (err, out) => res(err ? '' : String(out || '').trim())));

// ── Configuration (un écran WAF par sortie vidéo) ──
const CFG = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() { try { return JSON.parse(fs.readFileSync(CFG(), 'utf8')); } catch (e) { return { screens: {} }; } }
function saveCfg(c) { try { fs.mkdirSync(path.dirname(CFG()), { recursive: true }); fs.writeFileSync(CFG(), JSON.stringify(c, null, 2)); } catch (e) {} }
let cfg = { screens: {} };

// ── Emplacement de l'appli (.app) ──
function bundlePath() { const p = process.execPath.split('/Contents/MacOS/')[0]; return p.endsWith('.app') ? p : ''; }
function translocated() { return /\/AppTranslocation\//.test(process.execPath); }
function bundleWritable() {
  const b = bundlePath(); if (!b || translocated()) return false;
  try { fs.accessSync(path.dirname(b), fs.constants.W_OK); fs.accessSync(b, fs.constants.W_OK); return true; } catch (e) { return false; }
}

// ── Démarrage automatique + relance après plantage : agent launchd ──
const AGENT = path.join(os.homedir(), 'Library', 'LaunchAgents', AGENT_LABEL + '.plist');
function agentXml() {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${AGENT_LABEL}</string>
  <key>ProgramArguments</key><array><string>${esc(process.execPath)}</string><string>--autostart</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>15</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
</dict>
</plist>
`;
}
function autostartOk() { try { return fs.readFileSync(AGENT, 'utf8').includes(process.execPath); } catch (e) { return false; } }
function enableAutostart() {
  if (!app.isPackaged || translocated()) return false;
  try {
    fs.mkdirSync(path.dirname(AGENT), { recursive: true });
    const fresh = !fs.existsSync(AGENT);
    fs.writeFileSync(AGENT, agentXml());
    // Déjà lancée à la main : l'agent prend le relais à la prochaine ouverture de session
    if (fresh) execFile('launchctl', ['load', '-w', AGENT], () => {});
    return true;
  } catch (e) { return false; }
}

// ── Écran jamais en veille, pas d'économiseur, pas d'« App Nap » ──
let blockDisplay = null;
function keepAwake() {
  if (blockDisplay === null || !powerSaveBlocker.isStarted(blockDisplay)) blockDisplay = powerSaveBlocker.start('prevent-display-sleep');
}
function letSleep() { if (blockDisplay !== null && powerSaveBlocker.isStarted(blockDisplay)) powerSaveBlocker.stop(blockDisplay); blockDisplay = null; }
function noScreensaver() { execFile('defaults', ['-currentHost', 'write', 'com.apple.screensaver', 'idleTime', '-int', '0'], () => {}); }

// ── Fenêtres ──
const wins = new Map(); // "ecran-1" → { win, key, num, mode, display }
function sortedDisplays() { return screen.getAllDisplays().slice().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y); }

function goFull(w) {
  try { w.win.setBounds(w.display.bounds); w.win.setSimpleFullScreen(true); } catch (e) {}
}
function buildWindows() {
  const displays = sortedDisplays();
  const keep = new Set();
  displays.forEach((d, i) => {
    const key = 'ecran-' + (i + 1);
    keep.add(key);
    let w = wins.get(key);
    if (w && !w.win.isDestroyed()) {
      const moved = JSON.stringify(w.display.bounds) !== JSON.stringify(d.bounds);
      w.display = d;
      if (moved) { w.win.setSimpleFullScreen(false); goFull(w); }
      return;
    }
    const win = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      frame: false, fullscreenable: true, simpleFullscreen: true, backgroundColor: '#0d0b0b', show: false,
      title: 'WAF Signage — Écran ' + (i + 1), enableLargerThanScreen: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required'
      }
    });
    win.webContents.setUserAgent(win.webContents.getUserAgent() + ' ' + UA_TAG());
    w = { win, key, num: i + 1, mode: 'boot', clicks: 0, firstClick: 0, display: d, lastFocus: Date.now() };
    wins.set(key, w);
    wire(w);
    win.once('ready-to-show', () => { win.show(); goFull(w); app.focus({ steal: true }); });
    win.on('focus', () => { w.lastFocus = Date.now(); });
    loadBoot(w, process.argv.includes('--autostart') ? '#boot' : '');
  });
  for (const [key, w] of wins) if (!keep.has(key)) { try { w.win.destroy(); } catch (e) {} wins.delete(key); }
}

function loadBoot(w, hash) {
  w.mode = 'boot';
  sleepState.set(w.key, false);
  setImmediate(applyScreenPower);
  w.win.loadFile(BOOT, { hash: (hash || '').replace(/^#/, '') });
}
function openPlayer(w) {
  const s = (cfg.screens[w.key] || {}).slug;
  if (!s) return loadBoot(w, '');
  w.mode = 'player';
  w.win.loadURL(BASE + '/player/?screen=' + encodeURIComponent(s) + '&app=mac-' + app.getVersion());
}
function openPairing(w) { w.mode = 'pair'; w.win.loadURL(BASE + '/player/pair.php'); }

function catchPaired(w, url) {
  if (w.mode !== 'pair' || !url || !url.startsWith(BASE + '/player/')) return false;
  let slug = null;
  try { slug = new URL(url).searchParams.get('screen'); } catch (e) {}
  if (!slug) return false;
  cfg.screens[w.key] = { slug, label: '' };
  saveCfg(cfg);
  setImmediate(() => loadBoot(w, '#paired'));
  return true;
}

function reloadAll() { for (const x of wins.values()) x.mode === 'player' ? openPlayer(x) : loadBoot(x, ''); }

function wire(w) {
  const wc = w.win.webContents;
  wc.on('will-navigate', (e, url) => { if (catchPaired(w, url)) e.preventDefault(); });
  wc.on('did-start-navigation', (e, url, inPlace, isMain) => { if (isMain) catchPaired(w, url); });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    if (w.mode === 'player' || w.mode === 'pair') loadBoot(w, '#offline');
  });
  wc.on('render-process-gone', () => setTimeout(() => { if (!w.win.isDestroyed()) { w.mode === 'player' ? openPlayer(w) : loadBoot(w, ''); } }, 1500));
  wc.on('unresponsive', () => { if (!w.win.isDestroyed()) wc.reload(); });
  wc.on('did-finish-load', () => { if (w.mode === 'player') wc.insertCSS('*{cursor:none!important}').catch(() => {}); });
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase(), mod = input.control || input.meta;
    if (mod && input.alt && k === 'q') { e.preventDefault(); quitForGood(); }
    else if (mod && input.alt && k === 'r') { e.preventDefault(); reloadAll(); }
    else if ((k === 'f1' || (mod && k === 'm')) && w.mode !== 'boot') { e.preventDefault(); loadBoot(w, '#menu'); }
    else if (k === 'escape' && w.mode === 'pair') { e.preventDefault(); loadBoot(w, '#setup'); }
    else if (input.meta && (k === 'q' || k === 'w' || k === 'h')) e.preventDefault();   // pas de Cmd+Q / W / H par erreur
    else if (k === 'f12' || (input.meta && input.alt && k === 'i')) e.preventDefault();
  });
}
// Quitter volontairement : code 0 → launchd ne relance pas
function quitForGood() { lights.off(); setTimeout(() => app.exit(0), 300); }

ipcMain.on('waf:corner-click', (e) => {
  const w = byEvent(e); if (!w || w.mode === 'boot') return;
  const now = Date.now();
  if (now - w.firstClick > 3000) { w.firstClick = now; w.clicks = 0; }
  if (++w.clicks >= 5) { w.clicks = 0; loadBoot(w, '#menu'); }
});
function byEvent(e) { for (const w of wins.values()) if (!w.win.isDestroyed() && w.win.webContents === e.sender) return w; return null; }

// ── Veille réelle des moniteurs quand tous les écrans sont en mode veille (club fermé) ──
const sleepState = new Map();
let screensOff = false;
function applyScreenPower() {
  const all = [...wins.values()].filter(w => !w.win.isDestroyed());
  const allSleeping = all.length > 0 && all.every(w => w.mode === 'player' && sleepState.get(w.key) === true);
  if (allSleeping && !screensOff) { screensOff = true; letSleep(); execFile('pmset', ['displaysleepnow'], () => {}); }
  else if (!allSleeping && screensOff) { screensOff = false; keepAwake(); execFile('caffeinate', ['-u', '-t', '5'], () => {}); }
}
ipcMain.on('waf:sleep', (e, sleeping) => { const w = byEvent(e); if (!w) return; sleepState.set(w.key, !!sleeping); applyScreenPower(); });
setInterval(() => { if (screensOff) execFile('pmset', ['displaysleepnow'], () => {}); }, 10 * 60 * 1000);

// ── Revenir seul à l'affichage (autre appli ouverte, fenêtre masquée…) ──
const keepFront = () => cfg.keepFront !== false;
const KEEP_MIN = 5;
setInterval(() => {
  if (!keepFront() || screensOff) return;
  if (BrowserWindow.getFocusedWindow()) return;
  const all = [...wins.values()].filter(w => !w.win.isDestroyed());
  if (!all.length || all.some(w => Date.now() - w.lastFocus < KEEP_MIN * 60000)) return;
  for (const w of all) { w.win.show(); goFull(w); }
  app.focus({ steal: true });
  all[0].win.focus();
  all.forEach(w => { w.lastFocus = Date.now(); });
}, 30000);

// ───────────────────────── Lumières (fenêtre cachée) ─────────────────────────
const lights = (() => {
  let hw = null, ready = false, st = { dmx: 'démarrage…', strip: '', stripUsed: false, stripReady: false, connected: false };
  let lastJson = null, lastFade = 0, seen = new Map(), bleCb = null, bleTimer = null, bleDone = true, lastSerialTry = 0;
  const hwSes = () => session.fromPartition('persist:waf-hw');
  function create() {
    const ses = hwSes();
    ses.setPermissionCheckHandler(() => true);
    ses.setDevicePermissionHandler(() => true);
    ses.on('select-serial-port', (e, list, wc, cb) => {
      e.preventDefault();
      const p = list.find(x => /^(0x)?0*403$/i.test(String(x.vendorId || '')) || String(x.vendorId) === '1027')
             || list.find(x => /usbserial|FT232|FTDI|DMX/i.test((x.portName || '') + ' ' + (x.displayName || '')));
      cb(p ? p.portId : '');
    });
    hw = new BrowserWindow({ show: false, width: 320, height: 200, skipTaskbar: true, focusable: false,
      webPreferences: { preload: path.join(__dirname, 'preload-hw.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false, partition: 'persist:waf-hw' } });
    hw.webContents.on('select-bluetooth-device', (e, devices, cb) => {
      e.preventDefault();
      if (bleDone) { try { cb(''); } catch (x) {} return; }
      bleCb = cb;
      if (!bleTimer) bleTimer = setTimeout(() => { bleTimer = null; if (!bleDone) { bleDone = true; try { bleCb(''); } catch (x) {} } }, 12000);
      for (const d of devices) seen.set(d.deviceId, d.deviceName || 'sans nom');
      const f = (cfg.stripName || '').toLowerCase();
      const hit = devices.find(d => d.deviceName && (f ? d.deviceName.toLowerCase().startsWith(f) : /^(ELK|MELK|BLEDOM|LEDBLE|LEDDMX|Lotus|LED-)/i.test(d.deviceName))) || devices.find(d => !d.deviceName && !f);
      if (hit) { bleDone = true; clearTimeout(bleTimer); bleTimer = null; cb(hit.deviceId); }
    });
    hw.webContents.on('render-process-gone', () => { ready = false; setTimeout(() => { try { hw.destroy(); } catch (e) {} create(); }, 2000); });
    hw.loadFile(path.join(__dirname, 'hardware.html'));
  }
  const js = (code, gesture) => { if (hw && ready && !hw.isDestroyed()) hw.webContents.executeJavaScript(code, !!gesture).catch(() => {}); };
  ipcMain.on('hw:ready', () => { ready = true; if (lastJson !== null) js('WafHW.set(' + JSON.stringify(lastJson) + ',' + lastFade + ')'); trySerial(true); });
  ipcMain.on('hw:status', (e, s) => { st = Object.assign(st, s || {}); if (process.env.WAF_DEBUG) console.log('[lumières]', JSON.stringify(st)); });
  ipcMain.on('hw:want-serial', () => trySerial(true));
  ipcMain.on('hw:want-ble', (e, f) => {
    if (typeof f === 'string') cfg.stripName = f;
    seen.clear(); bleDone = false; clearTimeout(bleTimer); bleTimer = null;
    js('WafHW.bleScan(' + JSON.stringify(f || '') + ')', true);
  });
  ipcMain.on('hw:last-seen', (e) => {
    const names = [...seen.values()];
    e.returnValue = !names.length ? 'aucun appareil Bluetooth détecté autour du Mac' : 'ruban introuvable — vus : ' + names.slice(0, 5).join(', ') + (names.length > 5 ? '…' : '') + ' (appli Lotus fermée sur le téléphone ?)';
  });
  function trySerial(now) {
    if (!ready || st.connected) return;
    if (!now && Date.now() - lastSerialTry < 10000) return;
    lastSerialTry = Date.now();
    js('WafHW.serialConnect()', true);
  }
  setInterval(() => trySerial(false), 10000);   // chien de garde : adaptateur absent ou perdu → nouvel essai toutes les 10 s
  return {
    start: create,
    set(json, fade) { if (json === lastJson) return; lastJson = json; lastFade = fade | 0; js('WafHW.set(' + JSON.stringify(json) + ',' + (fade | 0) + ')'); },
    status() { return st.stripUsed ? st.dmx + ' · ruban : ' + st.strip : st.dmx; },
    stripStatus() { return st.stripUsed ? st.strip : 'non utilisé (à activer dans l\'admin, ou « Ruban LED » ici)'; },
    stripConnected() { return !!st.stripReady; },
    stripConnect() { js('WafHW.bleConnect()'); },
    stripTest() { js('WafHW.bleTest()'); },
    off() { js('WafHW.off()'); }
  };
})();

// ───────────────────────── Diagnostic du Mac (Monitoring) ─────────────────────────
let sysInfo = {};
async function collectSysInfo() {
  const [model, cpu, mem, osv, build, df, ports] = await Promise.all([
    run('sysctl', ['-n', 'hw.model']), run('sysctl', ['-n', 'machdep.cpu.brand_string']), run('sysctl', ['-n', 'hw.memsize']),
    run('sw_vers', ['-productVersion']), run('sw_vers', ['-buildVersion']), run('df', ['-k', '/']), run('networksetup', ['-listallhardwareports'])
  ]);
  const types = {};
  let curPort = '';
  ports.split('\n').forEach(l => { let m = l.match(/^Hardware Port: (.+)$/); if (m) curPort = m[1]; m = l.match(/^Device: (\S+)/); if (m) types[m[1]] = curPort; });
  const dfl = df.split('\n')[1] || '', dff = dfl.trim().split(/\s+/);
  sysInfo = { model, cpu: cpu.replace(/\s+/g, ' '), ram: +mem || os.totalmem(), os: osv, build, disk_free_kb: +dff[3] || 0, ports: types };
}
function deviceDiag(w) {
  const o = { maker: 'Apple', model: sysInfo.model || 'Mac', hardware: sysInfo.cpu || '', os: 'macOS ' + (sysInfo.os || os.release()), app: app.getVersion(), platform: 'mac',
              cores: os.cpus().length, ram_mb: Math.round((sysInfo.ram || os.totalmem()) / 1048576), ram_free_mb: Math.round(os.freemem() / 1048576) };
  try {
    const d = w ? w.display : screen.getPrimaryDisplay();
    o.screen = Math.round(d.size.width * d.scaleFactor) + 'x' + Math.round(d.size.height * d.scaleFactor);
    if (d.displayFrequency) o.hz = Math.round(d.displayFrequency);
    o.screens = screen.getAllDisplays().length;
  } catch (e) {}
  if (sysInfo.disk_free_kb) o.disk_free_mb = Math.round(sysInfo.disk_free_kb / 1024);
  const ips = []; let net = '';
  for (const [name, list] of Object.entries(os.networkInterfaces())) for (const a of list || []) {
    if (a.family === 'IPv4' && !a.internal) { ips.push(name + ':' + a.address); if (!net) { const t = (sysInfo.ports || {})[name] || ''; net = /wi-?fi|airport/i.test(t) ? 'WIFI' : (/ethernet|thunderbolt/i.test(t) ? 'ETHERNET' : t); } }
  }
  o.ip = ips; if (net) o.net = net;
  o.dmx = lights.status();
  o.uptime_s = Math.round(os.uptime());
  if (!app.isPackaged || translocated()) o.warn = 'appli lancée hors du dossier Applications : mises à jour impossibles';
  return JSON.stringify(o);
}

// ───────────────────────── Pont « WafApp » (même API qu'Android) ─────────────────────────
ipcMain.on('waf:sync', (e, fn, a, b) => {
  const w = byEvent(e);
  const sc = w ? (cfg.screens[w.key] || {}) : {};
  let r = null;
  switch (fn) {
    case 'baseUrl': r = BASE; break;
    case 'version': r = app.getVersion() + ' (Mac)'; break;
    case 'device': r = (sysInfo.model || 'Mac') + ' · ' + (w ? 'Écran ' + w.num + ' · ' : '') + 'macOS ' + (sysInfo.os || os.release()); break;
    case 'slug': r = sc.slug || ''; break;
    case 'label': r = sc.label || ''; break;
    case 'autostartOk': r = autostartOk(); break;
    case 'isLauncher': r = true; break;
    case 'screenName': r = w ? 'Écran ' + w.num : ''; break;
    case 'keepFront': r = keepFront(); break;
    case 'keepFrontMinutes': r = KEEP_MIN; break;
    case 'setKeepFront': cfg.keepFront = !!a; saveCfg(cfg); break;
    case 'deviceDiag': r = deviceDiag(w); break;
    case 'systemInfo': r = 'macOS ' + (sysInfo.os || '') + ' · moteur Chrome ' + process.versions.chrome.split('.')[0] + ' · ' + (sysInfo.model || 'Mac'); break;
    case 'dmxStatus': r = lights.status(); break;
    case 'bleStatus': r = lights.stripStatus(); break;
    case 'bleConnected': r = lights.stripConnected(); break;
    case 'updatesOk': r = bundleWritable(); break;
    case 'updateInfo': r = JSON.stringify({ current: app.getVersion(), latest: latest.version || '',
                          newer: !!latest.version && cmpVer(latest.version, app.getVersion()) > 0,
                          auto: 'installation automatique la nuit', error: cfg.updateError || '' }); break;
    case 'setScreen': if (w) { cfg.screens[w.key] = { slug: a || '', label: b || '' }; saveCfg(cfg); } break;
    case 'clearScreen': if (w) { delete cfg.screens[w.key]; saveCfg(cfg); } break;
  }
  e.returnValue = r;
});
ipcMain.on('waf:dmx', (e, json, fade) => lights.set(String(json || '{}'), fade | 0));
ipcMain.on('waf:do', (e, fn) => {
  const w = byEvent(e);
  if (fn === 'appRestart') return appRestart();
  if (fn === 'reboot') return rebootMac();
  if (fn === 'updateNow') return installUpdate(null);
  if (fn === 'bleConnect') return lights.stripConnect();
  if (fn === 'bleTest') return lights.stripTest();
  if (fn === 'openBluetoothSettings') return execFile('open', ['/System/Library/PreferencePanes/Bluetooth.prefPane'], () => {});
  if (fn === 'openSettings') return execFile('open', ['-b', 'com.apple.systempreferences'], () => {});
  if (fn === 'openUpdatesPermission') { const bp = bundlePath(); return execFile('open', bp ? ['-R', bp] : ['/Applications'], () => {}); }
  if (!w) return;
  if (fn === 'start') openPlayer(w);
  else if (fn === 'pair') openPairing(w);
  else if (fn === 'restart') w.win.webContents.session.clearCache().finally(() => openPlayer(w));
  else if (fn === 'openAutostart') { enableAutostart(); w.win.webContents.executeJavaScript('window.refreshChecks&&refreshChecks()').catch(() => {}); }
  else if (fn === 'checkUpdate') installUpdate(w);
});
ipcMain.on('waf:http', async (e, id, url) => {
  const w = byEvent(e); if (!w) return;
  let code = 0, body = '';
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await net.fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA_TAG() } });
    clearTimeout(t); code = r.status; body = await r.text();
  } catch (err) { code = 0; body = String(err && err.message || err); }
  if (!w.win.isDestroyed()) w.win.webContents.executeJavaScript('window.__http&&__http(' + JSON.stringify(id) + ',' + code + ',' + JSON.stringify(body) + ')').catch(() => {});
});

// ── Commandes à distance ──
function appRestart() {
  lights.off();
  setTimeout(() => {
    if (process.argv.includes('--autostart') && autostartOk()) {
      // Lancée par launchd : on demande à launchd de la relancer (elle reste surveillée)
      spawn('/bin/bash', ['-c', 'sleep 2; launchctl kickstart gui/$(id -u)/' + AGENT_LABEL], { detached: true, stdio: 'ignore' }).unref();
    } else app.relaunch({ args: ['--autostart'] });
    app.exit(0);
  }, 400);
}
function rebootMac() {
  execFile('osascript', ['-e', 'tell application "System Events" to restart'], (err) => { if (err) appRestart(); });
}

// ───────────────────────── Mises à jour ─────────────────────────
let latest = {}, updating = false;
function cmpVer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
  return 0;
}
async function fetchLatest() {
  try { const r = await net.fetch(BASE + '/api/app-version.php?platform=mac'); const j = await r.json(); if (j && j.success) latest = j.data || {}; } catch (e) {}
}
function tell(w, state, detail) {
  const targets = w ? [w] : [...wins.values()].filter(x => x.mode === 'boot');
  for (const x of targets) if (!x.win.isDestroyed()) x.win.webContents.executeJavaScript('window.onUpdateState&&onUpdateState(' + JSON.stringify(state) + ',' + JSON.stringify(String(detail)) + ')').catch(() => {});
}
async function installUpdate(w) {
  if (updating) return;
  tell(w, 'check', '');
  await fetchLatest();
  if (!latest.version || !latest.url) return tell(w, 'none', '');
  if (cmpVer(latest.version, app.getVersion()) <= 0) return tell(w, 'uptodate', app.getVersion());
  const bp = bundlePath();
  if (!app.isPackaged || !bundleWritable()) { cfg.updateError = 'range l\'appli dans le dossier Applications'; saveCfg(cfg); return tell(w, 'error', cfg.updateError); }
  updating = true;
  try {
    tell(w, 'downloading', latest.version);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'waf-upd-'));
    const zip = path.join(dir, 'update.zip');
    const r = await net.fetch(latest.url);
    if (!r.ok) throw new Error('téléchargement HTTP ' + r.status);
    fs.writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
    tell(w, 'installing', latest.version);
    await new Promise((res, rej) => execFile('ditto', ['-x', '-k', zip, path.join(dir, 'x')], { timeout: 300000 }, e => e ? rej(e) : res()));
    const appName = fs.readdirSync(path.join(dir, 'x')).find(n => n.endsWith('.app'));
    if (!appName) throw new Error('archive sans appli');
    const neu = path.join(dir, 'x', appName);
    const sh = path.join(dir, 'install.sh');
    const q = s => "'" + String(s).replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(sh, [
      '#!/bin/bash',
      'while kill -0 ' + process.pid + ' 2>/dev/null; do sleep 0.5; done',
      'APP=' + q(bp), 'NEW=' + q(neu),
      'rm -rf "$APP.old"',
      'if mv "$APP" "$APP.old" && ditto "$NEW" "$APP"; then rm -rf "$APP.old"; else rm -rf "$APP"; mv "$APP.old" "$APP"; fi',
      'xattr -dr com.apple.quarantine "$APP" 2>/dev/null',
      'if launchctl list | grep -q ' + AGENT_LABEL + '; then launchctl kickstart -k gui/$(id -u)/' + AGENT_LABEL + ' || open "$APP" --args --autostart; else open "$APP" --args --autostart; fi',
      'rm -rf ' + q(dir), ''
    ].join('\n'));
    fs.chmodSync(sh, 0o755);
    cfg.updateError = ''; saveCfg(cfg);
    tell(w, 'installed', latest.version);
    spawn('/bin/bash', [sh], { detached: true, stdio: 'ignore' }).unref();
    lights.off();
    setTimeout(() => app.exit(0), 800);
  } catch (e) {
    updating = false;
    cfg.updateError = String(e && e.message || e); saveCfg(cfg);
    tell(w, 'error', cfg.updateError);
  }
}
// La nuit (3 h – 5 h), et 10 min après le lancement : nouvelle version → installée toute seule
function autoUpdateTick() {
  const h = new Date().getHours();
  fetchLatest().then(() => {
    if (latest.version && cmpVer(latest.version, app.getVersion()) > 0 && (h >= 3 && h < 5 || process.uptime() < 900)) installUpdate(null);
  });
}

// ───────────────────────── Lancement ─────────────────────────
app.whenReady().then(async () => {
  session.defaultSession.setUserAgent(session.defaultSession.getUserAgent() + ' ' + UA_TAG());
  cfg = loadCfg();
  if (app.dock && cfg.hideDock === true) app.dock.hide();
  if (!autostartOk()) enableAutostart();          // (re)crée l'agent si l'appli a été déplacée
  keepAwake();
  powerSaveBlocker.start('prevent-app-suspension');
  noScreensaver();
  collectSysInfo().catch(() => {});
  setInterval(() => collectSysInfo().catch(() => {}), 3600 * 1000);
  lights.start();
  buildWindows();
  fetchLatest();
  setTimeout(autoUpdateTick, 10 * 60 * 1000);
  setInterval(autoUpdateTick, 30 * 60 * 1000);
  let t = null, sig = '';
  const dispSig = () => sortedDisplays().map(d => d.id + ':' + JSON.stringify(d.bounds)).join('|');
  sig = dispSig();
  // Seulement si un écran est branché / débranché / change de résolution (pas pour la barre de menus masquée)
  const rebuild = () => { clearTimeout(t); t = setTimeout(() => { const s2 = dispSig(); if (s2 !== sig) { sig = s2; buildWindows(); } }, 1500); };
  screen.on('display-added', rebuild);
  screen.on('display-removed', rebuild);
  screen.on('display-metrics-changed', rebuild);
});
app.on('second-instance', () => { for (const w of wins.values()) if (!w.win.isDestroyed()) { w.win.show(); goFull(w); } });
app.on('window-all-closed', () => {});
