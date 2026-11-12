/*
 * Bootbox: noVNC display on WebGL2 (the GPU draws the guest desktop).
 *
 * The framebuffer lives in a GPU texture: decoded rectangles are uploaded straight from the decoder's
 * arrays, fills are scissored clears, copies are framebuffer blits; there is no hidden 2D canvas and no
 * per-update canvas-to-canvas copy. Presenting is one textured quad per animation frame.
 *
 * Direct present (Bootbox GPU bridge): GL windows of the guest arrive as ImageBitmaps from the engine's
 * GPU thread (see bbgpu_webgl.c) and are drawn over the desktop wherever the guest screen shows the colour
 * key (pure magenta), so whatever X draws on top of them (menus, other windows) stays visible.
 * Licensed under MPL 2.0 like noVNC.
 */
import Display from "./display.js";

const VS = `#version 300 es
in vec2 a;
uniform vec4 u_vp;    // viewport x, y, w, h (fb pixels)
uniform vec2 u_fb;    // fb size
uniform vec4 u_rect;  // quad in fb pixels
out vec2 v_fb, v_ov;
void main() {
  vec2 p = u_rect.xy + a * u_rect.zw;
  vec2 c = (p - u_vp.xy) / u_vp.zw;
  gl_Position = vec4(c.x * 2.0 - 1.0, 1.0 - c.y * 2.0, 0.0, 1.0);
  v_fb = p / u_fb;
  v_ov = a;
}`;
const FS = `#version 300 es
precision mediump float;
uniform sampler2D u_fbt, u_ovt;
uniform int u_mode;
in vec2 v_fb, v_ov;
out vec4 o;
void main() {
  vec4 b = texture(u_fbt, v_fb);
  if (u_mode == 0) { o = vec4(b.rgb, 1.0); return; }
  if (any(greaterThan(abs(b.rgb - vec3(1.0, 0.0, 1.0)), vec3(0.03)))) discard;
  o = vec4(texture(u_ovt, v_ov).rgb, 1.0);
}`;

// ---- the page side of the GPU bridge: one host per page, shared by every display ----
function bbgpuHost() {
    if (self.__bbgpuHost) return self.__bbgpuHost;
    const h = self.__bbgpuHost = {
        flags: null, display: null, frames: 0,
        // frames are acknowledged when shown (or dropped): the GPU thread keeps at most two in flight,
        // so it presents at the display's rate however fast the app draws
        ack(n) { if (h.flags && n) Atomics.add(h.flags, 1, n); },
        setAlive() {
            if (!h.flags) return;
            Atomics.store(h.flags, 0, h.display ? 1 : 0);
        },
        onMessage(d) {
            if (d.bbgpu === 'hello') {
                try { h.flags = new Int32Array(d.buffer, d.addr, 4); } catch (e) { h.flags = null; }
                h.setAlive();
            } else if (d.bbgpu === 'present') {
                h.frames++;
                if (h.display) h.display.setOverlay(d.win, d.bitmap, d.x, d.y, d.w, d.h);
                else { try { d.bitmap.close(); } catch (e) { /* ignore */ } h.ack(1); }
            } else if (d.bbgpu === 'remove') {
                if (h.display) h.display.removeOverlay(d.win);
            }
        },
    };
    if (self.__bbgpuHello) h.onMessage(self.__bbgpuHello);   // the engine started before the viewer loaded
    return h;
}
bbgpuHost();

export default class GLDisplay extends Display {
    static supported() {
        if (self.__bbGLView === false) return false;
        try {
            const c = document.createElement('canvas');
            return !!c.getContext('webgl2');
        } catch (e) { return false; }
    }

    constructor(target) {
        super(target, true);        // no 2D contexts: the GPU owns both buffers
        this._overlays = new Map();
        this._raf = 0;
        this._initGL();
        target.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            this._lost = true;
            for (const o of this._overlays.values()) {      // textures are gone; frames still have to be acknowledged
                if (o.bm) { try { o.bm.close(); } catch (x) { /* ignore */ } o.bm = null; }
                bbgpuHost().ack(o.unacked); o.unacked = 0; o.tex = null; o.w = o.h = 0;
            }
        }, false);
        target.addEventListener('webglcontextrestored', () => {
            this._lost = false;
            this._initGL();
            this._allocFB(this._fbWidth, this._fbHeight, false);
            if (this.onRestore) this.onRestore();   // the RFB asks the server for a full frame
        }, false);
        const host = bbgpuHost();
        host.display = this;
        host.setAlive();
    }

    detach() {
        const host = bbgpuHost();
        if (host.display === this) { host.display = null; host.setAlive(); }
        for (const o of this._overlays.values()) this._dropOverlay(o);
        this._overlays.clear();
    }

    _initGL() {
        const gl = this._gl = this._target.getContext('webgl2', {
            alpha: false, antialias: false, depth: false, stencil: false,
            premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'default' });
        if (!gl) throw new Error("no WebGL2");
        const sh = (type, src) => {
            const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            return s;
        };
        const p = this._prog = gl.createProgram();
        gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
        gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
        gl.bindAttribLocation(p, 0, 'a');
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        this._u = {};
        for (const n of ['u_vp', 'u_fb', 'u_rect', 'u_fbt', 'u_ovt', 'u_mode']) this._u[n] = gl.getUniformLocation(p, n);
        gl.useProgram(p);
        gl.uniform1i(this._u.u_fbt, 0);
        gl.uniform1i(this._u.u_ovt, 1);
        const vb = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vb);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        this._filling = false;
        this._fbo = gl.createFramebuffer();
        this._tmpFbo = gl.createFramebuffer();
        this._tex = null; this._tmp = null; this._tmpW = this._tmpH = 0;
        this._texW = this._texH = 0;
    }

    _newTex(w, h) {
        const gl = this._gl, t = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, Math.max(1, w), Math.max(1, h));
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        return t;
    }

    // (re)allocate the framebuffer texture, keeping what fits of the old contents
    _allocFB(w, h, keep) {
        const gl = this._gl;
        if (!gl || (w === this._texW && h === this._texH && this._tex)) return;
        this._endFill();
        const t = this._newTex(w, h);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._tmpFbo);
        gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        gl.clearColor(0, 0, 0, 1);
        gl.disable(gl.SCISSOR_TEST);
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (keep && this._tex) {
            gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._fbo);
            const cw = Math.min(w, this._texW), ch = Math.min(h, this._texH);
            gl.blitFramebuffer(0, 0, cw, ch, 0, 0, cw, ch, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        }
        if (this._tex) gl.deleteTexture(this._tex);
        this._tex = t; this._texW = w; this._texH = h;
        gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ===== the Display API (drawing goes to the texture) =====

    resize(width, height) {
        this._prevDrawStyle = "";
        this._fbWidth = width;
        this._fbHeight = height;
        this._allocFB(width, height, true);
        const vp = this._viewportLoc;
        this.viewportChangeSize(vp.w, vp.h);
        this.viewportChangePos(0, 0);
    }

    getImageData() {
        const gl = this._gl, w = this._fbWidth, h = this._fbHeight;
        this._endFill();
        const px = new Uint8ClampedArray(w * h * 4);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._fbo);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        for (let i = 3; i < px.length; i += 4) px[i] = 255;
        return new ImageData(px, w, h);
    }

    _snapshotCanvas() {
        const c = document.createElement('canvas');
        c.width = this._fbWidth; c.height = this._fbHeight;
        c.getContext('2d').putImageData(this.getImageData(), 0, 0);
        return c;
    }
    toDataURL(type, encoderOptions) { return this._snapshotCanvas().toDataURL(type, encoderOptions); }
    toBlob(callback, type, quality) { return this._snapshotCanvas().toBlob(callback, type, quality); }

    flip(fromQueue) {
        if (this._renderQ.length !== 0 && !fromQueue) {
            this._renderQPush({ 'type': 'flip' });
            return;
        }
        this._damageBounds.left = this._damageBounds.top = 65535;
        this._damageBounds.right = this._damageBounds.bottom = 0;
        this._schedule();
    }

    fillRect(x, y, width, height, color, fromQueue) {
        if (this._renderQ.length !== 0 && !fromQueue) {
            this._renderQPush({ 'type': 'fill', 'x': x, 'y': y, 'width': width, 'height': height, 'color': color });
            return;
        }
        const gl = this._gl;
        if (this._lost || width <= 0 || height <= 0) return;
        if (!this._filling) {         // hextile sends many small fills in a row: keep the state between them
            gl.bindFramebuffer(gl.FRAMEBUFFER, this._fbo);
            gl.enable(gl.SCISSOR_TEST);
            this._filling = true;
            this._fillRGB = -1;
        }
        gl.scissor(x, y, width, height);
        const rgb = (color[0] << 16) | (color[1] << 8) | color[2];
        if (rgb !== this._fillRGB) {
            gl.clearColor(color[0] / 255, color[1] / 255, color[2] / 255, 1);
            this._fillRGB = rgb;
        }
        gl.clear(gl.COLOR_BUFFER_BIT);
        this._damage(x, y, width, height);
    }

    copyImage(oldX, oldY, newX, newY, w, h, fromQueue) {
        if (this._renderQ.length !== 0 && !fromQueue) {
            this._renderQPush({ 'type': 'copy', 'oldX': oldX, 'oldY': oldY, 'x': newX, 'y': newY, 'width': w, 'height': h });
            return;
        }
        const gl = this._gl;
        if (this._lost || w <= 0 || h <= 0) return;
        this._endFill();
        // through a scratch texture: source and destination may overlap
        if (!this._tmp || this._tmpW < w || this._tmpH < h) {
            if (this._tmp) gl.deleteTexture(this._tmp);
            this._tmpW = Math.max(w, this._tmpW); this._tmpH = Math.max(h, this._tmpH);
            this._tmp = this._newTex(this._tmpW, this._tmpH);
        }
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._fbo);
        gl.bindTexture(gl.TEXTURE_2D, this._tmp);
        gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, oldX, oldY, w, h);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this._tmpFbo);
        gl.framebufferTexture2D(gl.READ_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this._tmp, 0);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this._fbo);
        gl.blitFramebuffer(0, 0, w, h, newX, newY, newX + w, newY + h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        this._damage(newX, newY, w, h);
    }

    blitImage(x, y, width, height, arr, offset, fromQueue) {
        if (this._renderQ.length !== 0 && !fromQueue) {
            const newArr = new Uint8Array(width * height * 4);
            newArr.set(new Uint8Array(arr.buffer, arr.byteOffset + offset, newArr.length));
            this._renderQPush({ 'type': 'blit', 'data': newArr, 'x': x, 'y': y, 'width': width, 'height': height });
            return;
        }
        const gl = this._gl;
        if (this._lost || width <= 0 || height <= 0) return;
        this._endFill();
        gl.bindTexture(gl.TEXTURE_2D, this._tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE,
                         new Uint8Array(arr.buffer, arr.byteOffset + offset, width * height * 4));
        this._damage(x, y, width, height);
    }

    drawImage(img, x, y) {
        const gl = this._gl;
        if (this._lost) return;
        this._endFill();
        gl.bindTexture(gl.TEXTURE_2D, this._tex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, img);
        this._damage(x, y, img.width, img.height);
    }

    _endFill() {
        if (this._filling) { this._gl.disable(this._gl.SCISSOR_TEST); this._filling = false; }
    }

    // ===== GPU-bridge windows =====

    // a new frame of GPU window `win`: kept until the next animation frame (only the newest is uploaded)
    setOverlay(win, bitmap, x, y, w, h) {
        if (this._lost) { try { bitmap.close(); } catch (e) { /* ignore */ } bbgpuHost().ack(1); return; }
        let o = this._overlays.get(win);
        if (!o) { o = { tex: null, w: 0, h: 0, x, y, bm: null, unacked: 0 }; this._overlays.set(win, o); }
        if (o.bm) { try { o.bm.close(); } catch (e) { /* ignore */ } }
        o.bm = bitmap; o.bx = x; o.by = y; o.bw = w; o.bh = h;
        o.unacked++;
        this._schedule();
    }

    _dropOverlay(o) {
        if (o.tex) this._gl.deleteTexture(o.tex);
        if (o.bm) { try { o.bm.close(); } catch (e) { /* ignore */ } }
        bbgpuHost().ack(o.unacked);
    }

    removeOverlay(win) {
        if (!win) {
            for (const o of this._overlays.values()) this._dropOverlay(o);
            this._overlays.clear();
        } else {
            const o = this._overlays.get(win);
            if (o) { this._dropOverlay(o); this._overlays.delete(win); }
        }
        this._schedule();
    }

    _uploadOverlays() {
        const gl = this._gl;
        let acks = 0;
        for (const o of this._overlays.values()) {
            if (!o.bm) continue;
            if (!o.tex || o.w !== o.bw || o.h !== o.bh) {
                if (o.tex) gl.deleteTexture(o.tex);
                o.tex = this._newTex(o.bw, o.bh); o.w = o.bw; o.h = o.bh;
            }
            gl.bindTexture(gl.TEXTURE_2D, o.tex);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, o.bm);
            try { o.bm.close(); } catch (e) { /* ignore */ }
            o.bm = null; o.x = o.bx; o.y = o.by;
            acks += o.unacked; o.unacked = 0;
        }
        bbgpuHost().ack(acks);
    }

    // what the viewer shows (desktop + GPU windows) as a PNG data URL: screenshots and tests
    composedDataURL(type) {
        const gl = this._gl, c = this._target, w = c.width, h = c.height;
        this._render();
        const px = new Uint8Array(w * h * 4);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const img = new ImageData(w, h);
        for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        const out = document.createElement('canvas');
        out.width = w; out.height = h;
        out.getContext('2d').putImageData(img, 0, 0);
        return out.toDataURL(type || 'image/png');
    }

    // ===== presenting =====

    _schedule() {
        if (this._raf) return;
        this._raf = requestAnimationFrame(() => { this._raf = 0; this._render(); });
    }

    _render() {
        const gl = this._gl;
        if (this._lost || !this._tex) return;
        this._endFill();
        const vp = this._viewportLoc, c = this._target;
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, c.width, c.height);
        gl.useProgram(this._prog);
        gl.uniform4f(this._u.u_vp, vp.x, vp.y, vp.w, vp.h);
        gl.uniform2f(this._u.u_fb, this._texW, this._texH);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this._tex);
        gl.uniform1i(this._u.u_mode, 0);
        gl.uniform4f(this._u.u_rect, vp.x, vp.y, vp.w, vp.h);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (this._overlays.size) {
            gl.activeTexture(gl.TEXTURE1);
            this._uploadOverlays();
            gl.uniform1i(this._u.u_mode, 1);
            for (const o of this._overlays.values()) {
                if (!o.tex) continue;
                gl.bindTexture(gl.TEXTURE_2D, o.tex);
                gl.uniform4f(this._u.u_rect, o.x, o.y, o.w, o.h);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
            gl.activeTexture(gl.TEXTURE0);
        }
    }
}
