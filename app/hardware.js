/*
 * WAF Signage (Mac) — lumières du club, calculées par l'appli :
 *  - lyres DMX512 par adaptateur USB « Open DMX » (puce FTDI) vu comme port série
 *    (/dev/cu.usbserial-…) : BREAK, puis code de départ 0 + 512 canaux à 250 000 bauds, 8N2 ;
 *  - ruban LED Bluetooth (ELK-BLEDOM / MELK… de l'appli Lotus Lantern X).
 * Même logique que DmxOutput.java / BleStrip.java de l'appli Android.
 * Tourne dans une fenêtre cachée ; reçoit les ambiances via window.HW (preload-hw.js).
 */
(function () {
  'use strict';
  const { DmxProgram, safe } = window.WafDmx;
  const HW = window.HW;
  const FRAME_MS = 40;                       // 25 trames / s (la trame dure ≈ 23 ms à 250 kbauds)

  // ─────────────────────────── Ambiance (séquences + fondus) ───────────────────────────
  function mkStep(program, strip, dur, fade) {
    const s = { p: new DmxProgram(program || {}), sOff: !!(strip && strip.off), s: null, map: null };
    if (strip && !s.sOff) s.s = new DmxProgram(strip);
    if (strip && strip.follow && Array.isArray(strip.map) && strip.map.length) s.map = strip.map.map(x => [x.r | 0, x.g | 0, x.b | 0, x.w | 0, x.dim | 0]);
    s.dur = Math.max(1000, +dur || 60000);
    s.fade = Math.max(0, Math.min(30000, +fade || 0));
    return s;
  }
  const frame = new Uint8Array(513), from = new Float32Array(513), cur = new Float32Array(513), sCur = [0, 0, 0];
  let steps = [mkStep(null, null, 60000, 0)], total = 60000, seqStart = 0, curStep = 0, fadeStart = 0, fadeMs = 0;
  let stripCfg = null, lastJson = null;

  function setProgram(json, fade) {
    if (json === lastJson) return;
    lastJson = json;
    let o; try { o = JSON.parse(json || '{}'); } catch (e) { return; }
    let ns, sc = o.strip && typeof o.strip === 'object' ? o.strip : null;
    if (Array.isArray(o.seq) && o.seq.length) {
      ns = [];
      for (const it of o.seq) {
        if (!it || typeof it !== 'object') continue;
        if (!sc && it.strip) sc = it.strip;
        ns.push(mkStep(it.program || {}, it.strip || null, it.dur != null ? it.dur : 60000, it.fade != null ? it.fade : 2000));
      }
      if (!ns.length) ns = [mkStep(null, null, 60000, 0)];
    } else ns = [mkStep(o, sc, 60000, 0)];
    from.set(cur);
    steps = ns; total = ns.reduce((a, s) => a + s.dur, 0); curStep = 0;
    seqStart = Date.now(); fadeMs = Math.max(0, Math.min(30000, fade | 0)); fadeStart = seqStart;
    stripCfg = sc;
    Strip.configure(!!sc, sc ? String(sc.name || '') : '', sc ? (sc.bright != null ? +sc.bright : 100) : 100, sc ? String(sc.order || 'rgb') : 'rgb', !!(sc && +sc.noblue === 1));
  }

  function computeFrame() {
    const now = Date.now();
    let idx = 0;
    if (steps.length > 1 && total > 0) {
      const t = (now - seqStart) % total; let acc = 0;
      for (let i = 0; i < steps.length; i++) { acc += steps[i].dur; if (t < acc) { idx = i; break; } }
      if (idx !== curStep) { curStep = idx; from.set(cur); fadeStart = now; fadeMs = steps[idx].fade; }
    }
    const st = steps[idx], target = st.p.compute(now);
    const p = fadeMs <= 0 ? 1 : Math.min(1, (now - fadeStart) / fadeMs);
    frame[0] = 0;
    for (let i = 1; i <= 512; i++) {
      const cv = st.p.curve[i];
      cur[i] = (cv === 5 || cv === 6) ? target[i] : from[i] + (target[i] - from[i]) * p;
      frame[i] = safe(cv, Math.round(Math.max(0, Math.min(255, cur[i])))) & 0xff;
    }
    for (let i = 3; i <= 512; i++) {          // vitesse Nicols : selon le mode réellement envoyé
      if (st.p.curve[i] === 4) {
        let m = 0;
        for (let j = i - 1; j >= Math.max(1, i - 12); j--) if (st.p.curve[j] === 5) { m = frame[j]; break; }
        if (m < 120 || m > 239) frame[i] = 0;
      }
    }
    return st;
  }

  function lyresColor(map) {
    let r = 0, g = 0, b = 0, peak = 0, n = 0;
    for (const f of map) {
      const w = f[3] > 0 ? cur[f[3]] : 0, k = f[4] > 0 ? cur[f[4]] / 255 : 1;
      const fr = Math.min(255, (f[0] > 0 ? cur[f[0]] : 0) + w) * k, fg = Math.min(255, (f[1] > 0 ? cur[f[1]] : 0) + w) * k, fb = Math.min(255, (f[2] > 0 ? cur[f[2]] : 0) + w) * k;
      const mx = Math.max(fr, fg, fb);
      if (mx < 3) continue;
      r += fr; g += fg; b += fb; n++; peak = Math.max(peak, mx);
    }
    if (!n) return [0, 0, 0];
    r /= n; g /= n; b /= n;
    const mx = Math.max(r, g, b), k = mx > 0 ? peak / mx : 0;
    return [r * k, g * k, b * k];
  }

  function tick() {
    const st = computeFrame();
    const follow = st.map && !st.sOff ? lyresColor(st.map) : null;
    if (Strip.used()) {
      if (st.sOff || (!st.s && !follow)) Strip.push(0, 0, 0, false);
      else if (follow) { for (let i = 0; i < 3; i++) sCur[i] += (follow[i] - sCur[i]) * 0.5; Strip.push(Math.round(sCur[0]), Math.round(sCur[1]), Math.round(sCur[2]), true); }
      else {
        const v = st.s.compute(Date.now()), k = v[4] / 255;
        for (let i = 0; i < 3; i++) sCur[i] += (v[i + 1] * k - sCur[i]) * 0.25;
        Strip.push(Math.round(sCur[0]), Math.round(sCur[1]), Math.round(sCur[2]), true);
      }
    }
    Dmx.send(frame);
  }

  // ─────────────────────────── Sortie DMX (Web Serial) ───────────────────────────
  const Dmx = {
    port: null, writer: null, busy: false, fails: 0, reconnects: 0, status: 'aucun adaptateur', opening: false,
    async connect() {
      if (this.port || this.opening || !navigator.serial) { if (!navigator.serial) this.status = 'port série indisponible'; return; }
      this.opening = true;
      try {
        let port = null;
        try { const ports = await navigator.serial.getPorts(); port = ports.find(p => { const i = p.getInfo ? p.getInfo() : {}; return i.usbVendorId === 0x0403 && p !== Cec.port; }) || null; } catch (e) {}
        if (!port) port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x0403 }] });
        await port.open({ baudRate: 250000, dataBits: 8, stopBits: 2, parity: 'none', flowControl: 'none', bufferSize: 2048 });
        this.port = port; this.writer = port.writable.getWriter(); this.fails = 0;
        this.status = 'ok';
      } catch (e) {
        const msg = String(e && (e.name || e.message) || e);
        this.status = /NotFound/i.test(msg) ? 'aucun adaptateur' : 'adaptateur illisible (' + msg + ')';
        this.port = null; this.writer = null;
      } finally { this.opening = false; report(); }
    },
    async close(why) {
      const p = this.port, w = this.writer;
      this.port = null; this.writer = null; this.busy = false;
      try { if (w) { w.releaseLock(); } } catch (e) {}
      try { if (p) await p.close(); } catch (e) {}
      if (why) this.status = why;
      report();
    },
    send(f) {
      if (!this.port || !this.writer || this.busy) return;
      this.busy = true;
      const p = this.port, w = this.writer, copy = f.slice(0);
      (async () => {
        try {
          await p.setSignals({ break: true });                 // BREAK ≥ 88 µs
          await new Promise(r => setTimeout(r, 1));
          await p.setSignals({ break: false });                // MARK AFTER BREAK
          await w.write(copy);
          if (this.fails) { this.fails = 0; if (this.status !== 'ok') { this.status = 'ok'; report(); } }
        } catch (e) {
          if (++this.fails >= 25) { this.reconnects++; await this.close('liaison perdue, reconnexion… (' + this.reconnects + ')'); }
        } finally { this.busy = false; }
      })();
    }
  };
  if (navigator.serial) {
    navigator.serial.addEventListener('disconnect', (e) => {
      if (e.target === Cec.port) Cec.close('adaptateur CEC débranché');
      else if (e.target === Dmx.port || !e.target) Dmx.close('adaptateur débranché');
    });
    navigator.serial.addEventListener('connect', () => { HW.wantSerial(); HW.wantCec(); });
  }

  // ─────────────────────────── Ruban LED (Web Bluetooth) ───────────────────────────
  const SVC = '0000fff0-0000-1000-8000-00805f9b34fb', CHR = '0000fff3-0000-1000-8000-00805f9b34fb';
  const OPT = [0xfff0, 0xffe0, 0xffd0, 0xffd5, 0xffe5, 0xff00, 0xfff5].map(n => '0000' + n.toString(16) + '-0000-1000-8000-00805f9b34fb');
  const PREFIXES = ['ELK-', 'MELK', 'BLEDOM', 'LEDBLE', 'ELK_', 'LEDDMX', 'Lotus', 'LED-'];
  const B = (a) => new Uint8Array(a);
  const Strip = {
    status: 'désactivé', wanted: false, manual: false, ready: false, connecting: false, scanning: false,
    filter: '', bright: 100, order: 'rgb', noBlue: false, dev: null, ch: null, devName: '',
    lastScan: 0, lastWrite: 0, lastSent: 0, busy: false, busySince: 0, sr: -1, sg: -1, sb: -1, sentOn: false, powerSent: false,
    testUntil: 0, testStart: 0,
    used() { return this.wanted || this.manual; },
    configure(use, name, bright, ord, nb) {
      if (nb !== this.noBlue) { this.noBlue = nb; this.sr = this.sg = this.sb = -1; }
      if (/^[rgb]{3}$/.test(ord) && ord.includes('r') && ord.includes('g') && ord.includes('b') && ord !== this.order) { this.order = ord; this.sr = this.sg = this.sb = -1; }
      this.filter = (name || '').trim(); this.bright = Math.max(5, Math.min(100, bright | 0 || 100));
      if (use === this.wanted) return;
      this.wanted = use;
      if (!use && !this.manual) { this.disconnect(); this.status = 'désactivé'; report(); }
    },
    manualConnect() { this.manual = true; if (!this.ready && !this.connecting) { this.lastScan = 0; HW.wantBle(this.filter); } },
    test() { this.manualConnect(); this.testStart = Date.now(); this.testUntil = this.testStart + 6000; },
    // Lancé par l'appli (geste utilisateur simulé) : la fenêtre de choix est gérée par l'appli qui choisit le ruban toute seule
    async scan(filter) {
      if (!this.used() || this.scanning || this.connecting || this.ready) return;
      if (!navigator.bluetooth) { this.status = 'pas de Bluetooth sur ce Mac'; report(); return; }
      this.scanning = true; this.lastScan = Date.now();
      this.status = 'recherche du ruban…'; report();
      const filters = filter ? [{ namePrefix: filter }] : PREFIXES.map(p => ({ namePrefix: p })).concat([{ services: [SVC] }]);
      let dev = null;
      try { dev = await navigator.bluetooth.requestDevice({ filters, optionalServices: OPT }); }
      catch (e) {
        this.scanning = false;
        const m = String(e && (e.message || e.name) || e);
        this.status = /globally disabled|adapter|not available|unavailable/i.test(m) ? 'Bluetooth éteint ou absent sur ce Mac' : (HW.lastSeen() || 'ruban introuvable (appli Lotus fermée sur le téléphone ?)');
        report(); return;
      }
      this.scanning = false;
      this.connect(dev);
    },
    async connect(dev) {
      this.connecting = true; this.devName = dev.name || 'ruban';
      this.status = 'connexion à ' + this.devName + '…'; report();
      const to = setTimeout(() => { if (this.connecting && !this.ready) { this.status = 'le ruban ne répond pas'; this.disconnect(); report(); } }, 15000);
      try {
        dev.addEventListener('gattserverdisconnected', () => {
          const was = this.ready; this.ready = false; this.ch = null; this.connecting = false; this.busy = false;
          if (this.used()) this.status = was ? 'ruban déconnecté, reconnexion…' : this.status;
          this.lastScan = Date.now() - 12000; report();
        });
        const g = await dev.gatt.connect();
        let ch = null;
        try { ch = await (await g.getPrimaryService(SVC)).getCharacteristic(CHR); } catch (e) {}
        if (!ch) {
          for (const sv of await g.getPrimaryServices()) {
            if (!sv.uuid.startsWith('0000ff')) continue;
            for (const x of await sv.getCharacteristics()) if (x.properties.write || x.properties.writeWithoutResponse) { ch = x; break; }
            if (ch) break;
          }
        }
        clearTimeout(to);
        if (!ch) { this.status = 'appareil Bluetooth non compatible (' + this.devName + ')'; this.connecting = false; try { g.disconnect(); } catch (e) {} report(); return; }
        this.dev = dev; this.ch = ch; this.connecting = false; this.ready = true; this.powerSent = false; this.busy = false;
        this.status = 'connecté (' + this.devName + ')'; report();
        this.write([0x7e, 0x00, 0x01, 0x64, 0x00, 0x00, 0x00, 0x00, 0xef]);   // luminosité du ruban à fond
      } catch (e) {
        clearTimeout(to); this.connecting = false; this.ready = false;
        this.status = 'connexion impossible (' + String(e && e.message || e) + ')'; report();
      }
    },
    write(bytes) {
      const c = this.ch; if (!c) return;
      this.busy = true; this.busySince = this.lastWrite = Date.now();
      const p = c.writeValueWithoutResponse ? c.writeValueWithoutResponse(B(bytes)) : c.writeValue(B(bytes));
      p.then(() => { this.busy = false; }, () => { this.busy = false; });
    },
    push(r, g, b, on) {
      if (!this.used()) return;
      const now = Date.now();
      if (now < this.testUntil) { const k = Math.floor((now - this.testStart) / 2000) % 3; r = k === 0 ? 255 : 0; g = k === 1 ? 255 : 0; b = k === 2 ? 255 : 0; on = true; }
      if (!this.ready) { if (!this.scanning && !this.connecting && now - this.lastScan > 14000) { this.lastScan = now; HW.wantBle(this.filter); } return; }
      if (!this.wanted && now >= this.testUntil) return;
      if (this.busy && now - this.busySince < 300) return;
      if (now - this.lastWrite < 90) return;
      if (!this.powerSent || on !== this.sentOn) {
        this.write(on ? [0x7e, 0x00, 0x04, 0xf0, 0x00, 0x01, 0xff, 0x00, 0xef] : [0x7e, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0x00, 0xef]);
        this.sentOn = on; this.powerSent = true; this.sr = this.sg = this.sb = -1; return;
      }
      if (!on) return;
      r = Math.floor(r * this.bright / 100); g = Math.floor(g * this.bright / 100); b = Math.floor(b * this.bright / 100);
      if (this.noBlue) { r = Math.max(r, Math.round(b * 0.9)); g = Math.max(g, Math.round(b * 0.3)); b = 0; }
      const changed = Math.abs(r - this.sr) + Math.abs(g - this.sg) + Math.abs(b - this.sb) > 2;
      if (!changed && now - this.lastSent < 10000) return;
      const v = [...this.order].map(c => c === 'r' ? r : (c === 'g' ? g : b));
      this.write([0x7e, 0x00, 0x05, 0x03, v[0] & 0xff, v[1] & 0xff, v[2] & 0xff, 0x00, 0xef]);
      this.sr = r; this.sg = g; this.sb = b; this.lastSent = now;
    },
    disconnect() {
      try { if (this.ready) this.write([0x7e, 0x00, 0x04, 0x00, 0x00, 0x00, 0xff, 0x00, 0xef]); } catch (e) {}
      const d = this.dev; this.ready = false; this.connecting = false; this.ch = null; this.busy = false; this.dev = null;
      setTimeout(() => { try { if (d && d.gatt.connected) d.gatt.disconnect(); } catch (e) {} }, 200);
    }
  };

  // ─────────────────────────── TV par HDMI-CEC (adaptateur USB Pulse-Eight) ───────────────────────────
  // Le HDMI du Mac ne transmet pas le CEC : l'adaptateur se branche entre le Mac et la TV et
  // parle à l'appli par un port série USB (protocole de libCEC). Logique : « appareil de lecture » (adresse 4).
  const CEC_START = 0xff, CEC_END = 0xfe, CEC_ESC = 0xfd;
  const M = { PING: 1, SET_ACK_MASK: 10, TRANSMIT: 11, TRANSMIT_EOM: 12, TRANSMIT_IDLETIME: 13, TRANSMIT_ACK_POLARITY: 14, SET_CONTROLLED: 24,
              ACCEPTED: 8, REJECTED: 9, TX_OK: 16, TX_FAIL_LINE: 17, TX_FAIL_ACK: 18, TX_FAIL_DATA: 19, TX_FAIL_TIMEOUT: 20 };
  const LA = 4;                                       // adresse logique : Playback 1
  const Cec = {
    port: null, writer: null, status: 'aucun adaptateur CEC', opening: false, last: '', lastOk: 0,
    msg(code, params) {
      const out = [CEC_START, code];
      for (const b of params || []) { if (b >= CEC_ESC) out.push(CEC_ESC, b - 3); else out.push(b); }
      out.push(CEC_END);
      return new Uint8Array(out);
    },
    async connect() {
      if (this.port || this.opening || !navigator.serial) return;
      this.opening = true;
      try {
        let port = null;
        try { const ports = await navigator.serial.getPorts(); port = ports.find(p => { const i = p.getInfo ? p.getInfo() : {}; return i.usbVendorId === 0x2548; }) || null; } catch (e) {}
        if (!port) port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x2548 }] });
        await port.open({ baudRate: 38400, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
        this.port = port; this.writer = port.writable.getWriter();
        this.read(port);
        await this.raw(this.msg(M.SET_CONTROLLED, [1]));
        await this.raw(this.msg(M.SET_ACK_MASK, [((1 << LA) >> 8) & 0xff, (1 << LA) & 0xff]));
        this.status = 'adaptateur HDMI-CEC connecté';
        HW.cecReady();
      } catch (e) {
        const m = String(e && (e.name || e.message) || e);
        this.status = /NotFound/i.test(m) ? 'aucun adaptateur CEC' : 'adaptateur CEC illisible (' + m + ')';
        this.port = null; this.writer = null;
      } finally { this.opening = false; report(); }
    },
    async read(port) {
      // On lit les réponses (accusés d'envoi) pour savoir si la TV a bien reçu
      try {
        const rd = port.readable.getReader();
        let cur = null, esc = false;
        for (;;) {
          const { value, done } = await rd.read();
          if (done) break;
          for (const b of value) {
            if (b === CEC_START) { cur = []; esc = false; continue; }
            if (cur === null) continue;
            if (b === CEC_END) { this.onMsg(cur); cur = null; continue; }
            if (b === CEC_ESC) { esc = true; continue; }
            cur.push(esc ? b + 3 : b); esc = false;
          }
        }
      } catch (e) {}
      if (this.port === port) this.close('adaptateur CEC débranché');
    },
    onMsg(m) {
      const code = m[0] & 0x3f;
      if (code === M.TX_OK) { this.lastOk = Date.now(); this.status = 'TV : « ' + this.last + ' » envoyé ✓'; report(); }
      else if (code === M.TX_FAIL_ACK) { this.status = 'TV : pas de réponse (« ' + this.last + ' ») — TV compatible CEC / Anynet+ / SimpLink activé ?'; report(); }
      else if (code >= M.TX_FAIL_LINE && code <= M.TX_FAIL_TIMEOUT) { this.status = 'TV : envoi impossible (ligne HDMI occupée)'; report(); }
    },
    async raw(bytes) { if (!this.writer) throw new Error('fermé'); await this.writer.write(bytes); },
    async frame(bytes) {
      const bc = (bytes[0] & 0x0f) === 0x0f;
      await this.raw(this.msg(M.TRANSMIT_IDLETIME, [3]));
      await this.raw(this.msg(M.TRANSMIT_ACK_POLARITY, [bc ? 1 : 0]));
      for (let i = 0; i < bytes.length; i++) await this.raw(this.msg(i === bytes.length - 1 ? M.TRANSMIT_EOM : M.TRANSMIT, [bytes[i]]));
      await new Promise(r => setTimeout(r, 400));
    },
    async command(cmd) {
      if (!this.port) return;
      const hdr = (LA << 4) | 0;                       // du Mac (4) vers la TV (0)
      try {
        if (cmd === 'on') {
          this.last = 'allumer';
          await this.frame([hdr, 0x04]);                 // Image View On : la TV s'allume
          await this.frame([(LA << 4) | 0x0f, 0x82, 0x10, 0x00]);   // Active Source : la TV passe sur l'entrée du Mac
        } else if (cmd === 'standby') {
          this.last = 'mettre en veille';
          await this.frame([hdr, 0x36]);                 // Standby
        }
      } catch (e) { this.close('adaptateur CEC : erreur d\'envoi'); }
    },
    async close(why) {
      const p = this.port, w = this.writer;
      this.port = null; this.writer = null;
      try { if (w) w.releaseLock(); } catch (e) {}
      try { if (p) await p.close(); } catch (e) {}
      if (why) this.status = why;
      report();
    }
  };

  // ─────────────────────────── Échanges avec l'appli ───────────────────────────
  let lastRep = '';
  function report() {
    const s = { dmx: Dmx.status, connected: !!Dmx.port, strip: Strip.used() ? Strip.status : '', stripUsed: Strip.used(), stripReady: Strip.ready,
                cec: Cec.status, cecConnected: !!Cec.port };
    const k = JSON.stringify(s);
    if (k !== lastRep) { lastRep = k; HW.status(s); }
  }
  window.WafHW = {
    set: (json, fade) => setProgram(json, fade),
    serialConnect: () => Dmx.connect(),
    serialConnected: () => !!Dmx.port,
    bleScan: (f) => Strip.scan(f != null ? f : Strip.filter),
    bleConnect: () => Strip.manualConnect(),
    bleTest: () => Strip.test(),
    stripUsed: () => Strip.used(),
    cecConnect: () => Cec.connect(),
    cec: (cmd) => Cec.command(cmd),
    off: () => { setProgram('{}', 0); Strip.disconnect(); }
  };
  setInterval(() => { try { tick(); } catch (e) { console.error(e); } }, FRAME_MS);
  setInterval(report, 2000);
  HW.ready();
})();
