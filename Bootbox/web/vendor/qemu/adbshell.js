/* BootboxAdb - a minimal adb client for the Android guest's shell, over the in-app netstack.
 *
 * The netstack's ws://127.0.0.1:8889/adb endpoint pipes raw bytes to the guest's adbd
 * (192.168.127.3:5555; the image has ro.adb.secure=0, so there is no key exchange). This speaks the
 * adb wire protocol over that pipe: CNXN, then OPEN of "shell,v2,TERM=xterm-256color,pty:" (or the
 * legacy "shell:" if the device lacks shell_v2), WRTE/OKAY flow control both ways, CLSE.
 * Why: Android's own UI draws on the emulated CPU and can take seconds per frame; a shell only moves
 * text, which the iPad draws, so it stays usable while Android is busy.
 *
 *   const s = BootboxAdb.open(url, { onData(u8), onExit(code), onStatus(text), cols, rows });
 *   s.write(stringOrBytes); s.resize(cols, rows); s.close();
 */
(function () {
  "use strict";
  const A_CNXN = 0x4e584e43, A_OPEN = 0x4e45504f, A_OKAY = 0x59414b4f, A_CLSE = 0x45534c43,
        A_WRTE = 0x45545257, A_AUTH = 0x48545541;
  const A_VERSION = 0x01000001, MAX_PAYLOAD = 256 * 1024;
  const enc = new TextEncoder();

  function header(cmd, a0, a1, data) {
    const h = new DataView(new ArrayBuffer(24));
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum = (sum + data[i]) >>> 0;
    h.setUint32(0, cmd, true); h.setUint32(4, a0 >>> 0, true); h.setUint32(8, a1 >>> 0, true);
    h.setUint32(12, data.length, true); h.setUint32(16, sum, true); h.setUint32(20, (cmd ^ 0xffffffff) >>> 0, true);
    const out = new Uint8Array(24 + data.length);
    out.set(new Uint8Array(h.buffer), 0); out.set(data, 24);
    return out;
  }

  function open(url, opts) {
    opts = opts || {};
    const onData = opts.onData || function () {}, onExit = opts.onExit || function () {},
          onStatus = opts.onStatus || function () {};
    const LOCAL = 1;
    let ws, remote = 0, v2 = false, ready = false, closed = false, maxData = 4096;
    let inbuf = new Uint8Array(0), v2buf = new Uint8Array(0);
    let writing = false; const outq = [];   // adb allows ONE unacknowledged WRTE per stream
    let cols = opts.cols || 80, rows = opts.rows || 24;

    function send(cmd, a0, a1, data) {
      if (!ws || ws.readyState !== 1) return;
      ws.send(header(cmd, a0, a1, data || new Uint8Array(0)));
    }
    function cat(a, b) { const r = new Uint8Array(a.length + b.length); r.set(a); r.set(b, a.length); return r; }
    function v2packet(id, data) {
      const p = new Uint8Array(5 + data.length);
      p[0] = id; new DataView(p.buffer).setUint32(1, data.length, true); p.set(data, 5);
      return p;
    }
    let resizePending = false;
    function pump() {
      if (writing || !ready) return;
      if (resizePending && v2) {   // a window-size change goes ahead of queued keystrokes
        resizePending = false; writing = true;
        send(A_WRTE, LOCAL, remote, windowPacket());
        return;
      }
      if (!outq.length) return;
      let chunk = outq.shift();
      if (chunk.length > maxData - 5) { outq.unshift(chunk.subarray(maxData - 5)); chunk = chunk.subarray(0, maxData - 5); }
      writing = true;
      send(A_WRTE, LOCAL, remote, v2 ? v2packet(0, chunk) : chunk);
    }
    function queue(bytes) { outq.push(bytes); pump(); }
    function windowPacket() {
      // shell v2 id 5: "<rows>x<cols>,<xpixels>x<ypixels>"
      return v2packet(5, enc.encode(rows + "x" + cols + ",0x0\0"));
    }
    function handleV2(data) {
      v2buf = cat(v2buf, data);
      while (v2buf.length >= 5) {
        const id = v2buf[0], len = new DataView(v2buf.buffer, v2buf.byteOffset + 1, 4).getUint32(0, true);
        if (v2buf.length < 5 + len) break;
        const body = v2buf.slice(5, 5 + len); v2buf = v2buf.slice(5 + len);
        if (id === 1 || id === 2) onData(body);
        else if (id === 3) { closed = true; onExit(body.length ? body[0] : 0); }
      }
    }
    function handle(cmd, a0, a1, data) {
      if (cmd === A_CNXN) {
        const banner = new TextDecoder().decode(data);
        maxData = Math.min(MAX_PAYLOAD, a1 || 4096);
        v2 = /features=[^;]*\bshell_v2\b/.test(banner);
        onStatus("connected to Android (" + (v2 ? "pty shell" : "legacy shell") + ")");
        const svc = v2 ? "shell,v2,TERM=xterm-256color,pty:" : "shell:";
        send(A_OPEN, LOCAL, 0, enc.encode(svc + "\0"));
      } else if (cmd === A_AUTH) {
        onStatus("Android asked for adb authorization (this image should not) - can't open a shell");
        try { ws.close(); } catch (e) {}
      } else if (cmd === A_OKAY) {
        if (!ready) {
          remote = a0; ready = true;
          resizePending = v2;   // the pty starts at 80x24: send the real size first
          pump();
        } else { writing = false; pump(); }
      } else if (cmd === A_WRTE) {
        send(A_OKAY, LOCAL, remote, null);
        if (v2) handleV2(data); else onData(data);
      } else if (cmd === A_CLSE) {
        if (!closed) { closed = true; onExit(-1); }
        try { ws.close(); } catch (e) {}
      }
    }
    function parse() {
      for (;;) {
        if (inbuf.length < 24) return;
        const dv = new DataView(inbuf.buffer, inbuf.byteOffset, 24);
        const cmd = dv.getUint32(0, true), a0 = dv.getUint32(4, true), a1 = dv.getUint32(8, true), len = dv.getUint32(12, true);
        if (inbuf.length < 24 + len) return;
        const data = inbuf.slice(24, 24 + len); inbuf = inbuf.slice(24 + len);
        handle(cmd, a0, a1, data);
      }
    }

    onStatus("connecting to Android's adbd…");
    try {
      ws = new WebSocket(url);
    } catch (e) { onStatus("adb bridge unavailable: " + ((e && e.message) || e)); onExit(-2); return null; }
    ws.binaryType = "arraybuffer";
    ws.onopen = function () { send(A_CNXN, A_VERSION, MAX_PAYLOAD, enc.encode("host::features=shell_v2,cmd\0")); };
    ws.onmessage = function (e) { inbuf = cat(inbuf, new Uint8Array(e.data)); parse(); };
    ws.onclose = function () { if (!closed) { closed = true; onExit(-2); } };
    ws.onerror = function () { onStatus("can't reach Android's adbd (is Android still starting?)"); };

    return {
      write: function (x) { if (closed) return; queue(typeof x === "string" ? enc.encode(x) : new Uint8Array(x)); },
      resize: function (c, r) {
        cols = c | 0 || cols; rows = r | 0 || rows;
        if (v2 && !closed) { resizePending = true; pump(); }
      },
      close: function () { closed = true; try { send(A_CLSE, LOCAL, remote, null); ws.close(); } catch (e) {} },
      get ready() { return ready && !closed; },
    };
  }
  self.BootboxAdb = { open: open };
})();
