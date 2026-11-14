/*
 * Bootbox direct display: an RFB "server" that lives in the page.
 *
 * noVNC connects to this channel instead of a WebSocket to a VNC server in the guest. Nothing is
 * encoded or sent over a network:
 *   - pixels: the engine publishes the guest's virtio-gpu scanout (bbdisp block, see engine/bbgpu/bbgpu.c);
 *     on every animation frame the damaged rectangle is uploaded straight from the engine's shared memory
 *     into the viewer's texture;
 *   - cursor: the guest's hardware cursor image goes to noVNC's local cursor, which follows the finger or
 *     pointer at the display's rate;
 *   - input: pointer, wheel and key events are written into the engine's input mailbox (bbtouch ring) and
 *     reach the guest's virtio tablet and keyboard under the engine lock - no guest process in the path.
 * The handshake below is just enough RFB 3.8 for noVNC to consider itself connected.
 * Licensed under MPL 2.0 like noVNC.
 */

const W = { CHANGE: 0, GEN: 1, PTR: 2, WIDTH: 3, HEIGHT: 4, STRIDE: 5, FMT: 6, DX0: 7, DY0: 8, DX1: 9, DY1: 10,
            LOCK: 11, CGEN: 12, CW: 13, CH: 14, CHX: 15, CHY: 16, MX: 17, MY: 18, CVIS: 19, INPUT: 20,
            LISTENER: 21, LIVE: 22, CPIX: 32 };
const CUR = 64;

// X keysym -> Linux key code (US layout); bit 0x1000 = needs Shift
const SHIFT = 0x1000;
const KEYSYM = (() => {
    const m = new Map();
    const row = (chars, shifted, first) => {
        for (let i = 0; i < chars.length; i++) {
            m.set(chars.charCodeAt(i), first + i);
            if (shifted && shifted[i] !== ' ') m.set(shifted.charCodeAt(i), (first + i) | SHIFT);
        }
    };
    row("1234567890-=", "!@#$%^&*()_+", 2);
    row("qwertyuiop[]", "QWERTYUIOP{}", 16);
    row("asdfghjkl;'`", "ASDFGHJKL:\"~", 30);
    row("\\zxcvbnm,./", "|ZXCVBNM<>?", 43);
    m.set(0x20, 57);
    const sp = { 0xff08: 14, 0xff09: 15, 0xff0d: 28, 0xff1b: 1, 0xffff: 111, 0xff50: 102, 0xff51: 105,
        0xff52: 103, 0xff53: 106, 0xff54: 108, 0xff55: 104, 0xff56: 109, 0xff57: 107, 0xff63: 110,
        0xffe1: 42, 0xffe2: 54, 0xffe3: 29, 0xffe4: 97, 0xffe9: 56, 0xffea: 100, 0xffe7: 125, 0xffe8: 126,
        0xffeb: 125, 0xffec: 126, 0xffe5: 58, 0xff67: 127, 0xff8d: 96, 0xff61: 99, 0xff13: 119, 0xff14: 70,
        0xff7f: 69, 0xfe03: 100, 0xffaa: 55, 0xffab: 78, 0xffad: 74, 0xffae: 83, 0xffaf: 98 };
    for (const k in sp) m.set(+k, sp[k]);
    for (let i = 0; i < 10; i++) m.set(0xffb0 + i, [82, 79, 80, 81, 75, 76, 77, 71, 72, 73][i]);  // keypad digits
    for (let i = 0; i < 12; i++) m.set(0xffbe + i, i < 10 ? 59 + i : 87 + i - 10);              // F1-F12
    return m;
})();

// noVNC's XT scancodes (0xe0xx = extended) -> Linux key codes
const XT_E0 = { 0x1c: 96, 0x1d: 97, 0x35: 98, 0x37: 99, 0x38: 100, 0x47: 102, 0x48: 103, 0x49: 104,
    0x4b: 105, 0x4d: 106, 0x4f: 107, 0x50: 108, 0x51: 109, 0x52: 110, 0x53: 111, 0x5b: 125, 0x5c: 126,
    0x5d: 127, 0x10: 165, 0x19: 163, 0x20: 113, 0x22: 164, 0x24: 166, 0x2e: 114, 0x30: 115 };
function xtToLinux(xt) {
    if (xt < 0x80) return xt === 0x56 ? 86 : xt;      // set-1 make codes are Linux codes up to 0x58
    if ((xt & 0xff00) === 0xe000) return XT_E0[xt & 0xff] || 0;
    return 0;
}

export function directInfo() {
    const h = self.__bbgpuHello;
    if (!h || !h.disp || !h.touch) return null;
    try {
        const d = new Int32Array(h.buffer, h.disp, 32);
        return { buffer: h.buffer, disp: h.disp, touch: h.touch, d,
                 listener: d[W.LISTENER] === 1, live: d[W.LIVE] === 1, input: d[W.INPUT] };
    } catch (e) { return null; }
}

// true once the guest drives the virtio-gpu scanout and the tablet + keyboard exist
export function directReady() {
    const i = directInfo();
    return !!(i && i.listener && i.live && (i.input & 3) === 3);
}

export class DirectChannel {
    constructor() {
        const info = directInfo();
        this._d = info.d;
        this._buf = info.buffer;
        this._u8 = new Uint8Array(info.buffer);
        this._ring = new Int32Array(info.buffer, info.touch, 4 + 64 * 4);
        this._cursorPx = new Int32Array(info.buffer, info.disp + W.CPIX * 4, CUR * CUR);
        this.binaryType = 'arraybuffer';
        this.protocol = '';
        this.readyState = 0;                  // CONNECTING
        this.onopen = this.onmessage = this.onclose = this.onerror = null;
        this._state = 'version';
        this._in = new Uint8Array(0);
        this._rfb = null;
        this._raf = 0;
        this._gen = -1; this._cgen = -1; this._seen = -1;
        this._w = 0; this._h = 0;
        this._buttons = 0;
        this._shifted = new Map();            // keysym -> whether we pressed Shift for it
        this._shiftHeld = 0;
        this._keyQ = []; this._keyT = 0; this._keyWin = 0; this._keyN = 0;
        this.frames = 0; this.pixels = 0;
        const open = () => {                  // once noVNC has attached its handlers
            if (this.readyState !== 0) return;
            if (!this.onopen || !this.onmessage) { setTimeout(open, 10); return; }
            this.readyState = 1;
            this.onopen(new Event('open'));
            this._push(new TextEncoder().encode("RFB 003.008\n"));
        };
        setTimeout(open, 0);
    }

    // the RFB object that owns this channel (for the display, the resize and the cursor)
    attachRFB(rfb) { this._rfb = rfb; }

    send(data) {
        const b = data instanceof ArrayBuffer ? new Uint8Array(data)
            : data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(0);
        const n = new Uint8Array(this._in.length + b.length);
        n.set(this._in); n.set(b, this._in.length);
        this._in = n;
        this._parse();
    }

    close() {
        if (this.readyState === 3) return;
        this.readyState = 3;
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = 0;
        this._releaseAll();
        setTimeout(() => { if (this.onclose) this.onclose({ code: 1000, reason: '', wasClean: true }); }, 0);
    }

    // like a socket: delivered after the current call returns (noVNC's send() must finish its state change)
    _push(bytes) {
        const ab = bytes.buffer.byteLength === bytes.length ? bytes.buffer : bytes.slice().buffer;
        queueMicrotask(() => { if (this.readyState === 1 && this.onmessage) this.onmessage({ data: ab }); });
    }

    _parse() {
        for (;;) {
            const b = this._in;
            let used = 0;
            if (this._state === 'version') {
                if (b.length < 12) return;
                used = 12;
                this._push(new Uint8Array([1, 1]));          // one security type: None
                this._state = 'security';
            } else if (this._state === 'security') {
                if (b.length < 1) return;
                used = 1;
                this._push(new Uint8Array([0, 0, 0, 0]));    // SecurityResult OK
                this._state = 'init';
            } else if (this._state === 'init') {
                if (b.length < 1) return;
                used = 1;
                this._serverInit();
                this._state = 'normal';
            } else {
                if (b.length < 1) return;
                const t = b[0];
                const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
                if (t === 0) { if (b.length < 20) return; used = 20; }                        // SetPixelFormat
                else if (t === 2) { if (b.length < 4) return; used = 4 + 4 * dv.getUint16(2); if (b.length < used) return; }
                else if (t === 3) { if (b.length < 10) return; used = 10; this._kick(); }      // update request
                else if (t === 4) { if (b.length < 8) return; used = 8; this._keysym(dv.getUint32(4), b[1] !== 0); }
                else if (t === 5) { if (b.length < 6) return; used = 6; this._pointer(b[1], dv.getUint16(2), dv.getUint16(4)); }
                else if (t === 6) { if (b.length < 8) return; used = 8 + dv.getUint32(4); if (b.length < used) return; }
                else if (t === 255) {                                                            // QEMU messages
                    if (b.length < 2) return;
                    if (b[1] === 0) {
                        if (b.length < 12) return;
                        used = 12;
                        const down = dv.getUint16(2) !== 0, sym = dv.getUint32(4), xt = dv.getUint32(8);
                        const code = xtToLinux(xt);
                        if (code) this._key(code, down); else this._keysym(sym, down);
                    } else { used = b.length; }
                } else if (t === 248 || t === 250 || t === 251) { used = b.length; }            // not offered
                else { used = b.length; }
            }
            this._in = b.subarray(used);
            if (!this._in.length) return;
        }
    }

    _serverInit() {
        const d = this._d;
        this._w = Math.max(1, d[W.WIDTH]); this._h = Math.max(1, d[W.HEIGHT]);
        const name = new TextEncoder().encode("Bootbox (direct)");
        const m = new Uint8Array(24 + name.length);
        const v = new DataView(m.buffer);
        v.setUint16(0, this._w); v.setUint16(2, this._h);
        // 32 bpp, depth 24, little endian, true colour, max 255, shifts R 16 G 8 B 0 (= the guest's XRGB)
        m.set([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0], 4);
        v.setUint32(20, name.length);
        m.set(name, 24);
        this._push(m);
        // one update announcing the QEMU extended key events (noVNC then sends scan codes with each key)
        const u = new Uint8Array(16);
        const uv = new DataView(u.buffer);
        u[0] = 0; uv.setUint16(2, 1);
        uv.setInt32(12, -258);
        this._push(u);
        this._kick();
    }

    // ---- display ----
    _kick() { if (!this._raf && this.readyState === 1) this._raf = requestAnimationFrame(() => { this._raf = 0; this._frame(); }); }

    _frame() {
        if (this.readyState !== 1) return;
        this._raf = requestAnimationFrame(() => { this._raf = 0; this._frame(); });   // keep the loop on vsync
        const r = this._rfb, d = this._d;
        if (!r || !r._display) return;
        const disp = r._display;
        if (Atomics.load(d, W.CGEN) !== this._cgen) this._cursor();
        const ch = Atomics.load(d, W.CHANGE);
        if (ch === this._seen) return;
        this._seen = ch;
        if (!d[W.LIVE]) return;
        const gen = Atomics.load(d, W.GEN);
        // take the damage under the engine's lock word
        while (Atomics.compareExchange(d, W.LOCK, 0, 1) !== 0) { /* the engine holds it for a few stores */ }
        let x0 = d[W.DX0], y0 = d[W.DY0], x1 = d[W.DX1], y1 = d[W.DY1];
        const ptr = d[W.PTR] >>> 0, w = d[W.WIDTH], h = d[W.HEIGHT], stride = d[W.STRIDE];
        d[W.DX1] = d[W.DX0];                              // empty
        Atomics.store(d, W.LOCK, 0);
        if (!ptr || w <= 0 || h <= 0) return;
        if (gen !== this._gen || w !== this._w || h !== this._h) {
            this._gen = gen;
            if (w !== r._fbWidth || h !== r._fbHeight) {
                this._w = w; this._h = h;
                try { r._resize(w, h); } catch (e) { console.warn('[direct] resize', e); }
            }
            x0 = 0; y0 = 0; x1 = w; y1 = h;
        }
        x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
        if (x1 <= x0 || y1 <= y0) return;
        // the engine's memory grows: a view made earlier doesn't reach memory added since
        const mem = self.Module && self.Module.wasmMemory;
        if (mem && this._u8.buffer !== mem.buffer) this._u8 = new Uint8Array(mem.buffer);
        const off = ptr + y0 * stride + x0 * 4;
        if (off + (y1 - y0 - 1) * stride + (x1 - x0) * 4 > this._u8.length) return;
        if (disp.blitBGRX) disp.blitBGRX(x0, y0, x1 - x0, y1 - y0, this._u8, off, stride);
        else this._blit2D(disp, x0, y0, x1 - x0, y1 - y0, off, stride);
        disp.flip();
        this.frames++; this.pixels += (x1 - x0) * (y1 - y0);
    }

    _blit2D(disp, x, y, w, h, off, stride) {      // 2D viewer: swizzle BGRX -> RGBX on the way
        const out = new Uint8Array(w * h * 4), src = this._u8;
        for (let j = 0; j < h; j++) {
            let s = off + j * stride, o = j * w * 4;
            for (let i = 0; i < w; i++, s += 4, o += 4) {
                out[o] = src[s + 2]; out[o + 1] = src[s + 1]; out[o + 2] = src[s]; out[o + 3] = 255;
            }
        }
        disp.blitImage(x, y, w, h, out, 0);
    }

    _cursor() {
        const d = this._d, r = this._rfb;
        this._cgen = Atomics.load(d, W.CGEN);
        const w = d[W.CW], h = d[W.CH];
        if (!r || !r._updateCursor || w <= 0 || h <= 0) return;
        const key = w + ':' + h + ':' + d[W.CHX] + ':' + d[W.CHY] + ':' + this._cursorHash(w, h);
        if (!d[W.CVIS]) {              // the guest hid its cursor
            if (this._curKey !== 'hidden') { this._curKey = 'hidden'; r._updateCursor(new Uint8Array(4), 0, 0, 1, 1); }
            return;
        }
        if (key === this._curKey) return;
        this._curKey = key;
        const rgba = new Uint8Array(w * h * 4), px = this._cursorPx;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const p = px[y * CUR + x], o = (y * w + x) * 4;
                rgba[o] = (p >> 16) & 255; rgba[o + 1] = (p >> 8) & 255; rgba[o + 2] = p & 255; rgba[o + 3] = (p >>> 24) & 255;
            }
        }
        r._updateCursor(rgba, d[W.CHX], d[W.CHY], w, h);
    }

    _cursorHash(w, h) {
        let s = 0;
        const px = this._cursorPx;
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) s = (s * 31 + px[y * CUR + x]) | 0;
        return s;
    }

    // ---- input ----
    _event(kind, a, b, c) {
        const t = this._ring, seq = Atomics.load(t, 0), e = 4 + (seq % 64) * 4;
        t[e] = kind; t[e + 1] = a; t[e + 2] = b; t[e + 3] = c;
        Atomics.store(t, 0, seq + 1);
        Atomics.notify(t, 0);
    }

    _pointer(mask, x, y) {
        const w = Math.max(2, this._w), h = Math.max(2, this._h);
        const ax = Math.round(Math.min(w - 1, x) * 32767 / (w - 1)), ay = Math.round(Math.min(h - 1, y) * 32767 / (h - 1));
        const pressed = mask & ~this._buttons;
        this._buttons = mask;
        this._ax = ax; this._ay = ay;
        this._event(3, ax, ay, mask & 7);
        const dy = (pressed & 8 ? -1 : 0) + (pressed & 16 ? 1 : 0), dx = (pressed & 32 ? -1 : 0) + (pressed & 64 ? 1 : 0);
        if (dy || dx) this._event(5, dy, dx, 0);
    }

    // Keys are paced: the guest's virtio keyboard has a few dozen event buffers, and QEMU drops a whole report
    // when they run out - a pasted line typed in one burst lost its tail. A few events per tick keeps up with
    // typing and with the app's Type/paste.
    _key(code, down) {
        this._keyQ.push(code, down ? 1 : 0);
        if (!this._keyT) this._pumpKeys();
    }

    _pumpKeys() {
        this._keyT = 0;
        const now = performance.now();
        if (now - this._keyWin >= 16) { this._keyWin = now; this._keyN = 0; }   // at most 6 events per 16 ms
        while (this._keyN < 6 && this._keyQ.length) {
            const code = this._keyQ.shift(), down = this._keyQ.shift();
            this._event(4, code, down, 0);
            this._keyN++;
        }
        if (this._keyQ.length) this._keyT = setTimeout(() => this._pumpKeys(), Math.max(1, 16 - (now - this._keyWin)));
    }

    _keysym(sym, down) {
        let k = KEYSYM.get(sym);
        if (k === undefined && sym >= 0x1000000) k = KEYSYM.get(sym - 0x1000000);   // Unicode keysyms of ASCII
        if (k === undefined) { if (down) console.log('[direct] no key for keysym 0x' + sym.toString(16)); return; }
        const code = k & 0xfff;
        if (code === 42 || code === 54) this._shiftHeld = Math.max(0, this._shiftHeld + (down ? 1 : -1));
        if (down) {
            const need = (k & SHIFT) !== 0 && !this._shiftHeld;
            this._shifted.set(sym, need);
            if (need) this._key(42, true);
            this._key(code, true);
        } else {
            this._key(code, false);
            if (this._shifted.get(sym)) this._key(42, false);
            this._shifted.delete(sym);
        }
    }

    _releaseAll() {
        try {
            if (this._buttons & 7) this._event(3, this._ax | 0, this._ay | 0, 0);
            for (const [sym] of this._shifted) this._keysym(sym, false);
        } catch (e) { /* ignore */ }
    }
}
