/* bbgpu_webgl.c - GL context for the bbgpu GPU thread in the wasm engine: a WebGL2 context on an
 * OffscreenCanvas created inside the GPU thread's own worker, registered with emscripten's GL layer.
 *
 * Direct present: a presented window is blitted into that canvas, taken out as an ImageBitmap
 * (transferToImageBitmap works without returning to the worker's event loop, which the GPU thread never
 * does) and posted to the page, whose viewer draws it wherever the guest screen shows the colour key.
 * The page writes bbgpu_host[0] (it composites presents) and [1] (frames it took) into the shared memory.
 * SPDX-License-Identifier: MIT */
#include <emscripten.h>
#include <emscripten/html5.h>
#include <GLES3/gl3.h>
#include <stdint.h>
#include <stdio.h>
#include "bbgpu_render.h"

EM_JS(int, bbgpu_webgl_create, (void *host, void *touch, void *disp), {
    try {
        var c = new OffscreenCanvas(1, 1);
        var ctx = c.getContext('webgl2', { alpha: false, depth: false, stencil: false, antialias: false,
                                           preserveDrawingBuffer: false, powerPreference: 'high-performance' });
        if (!ctx) { console.log('[bbgpu] no WebGL2 in the GPU worker'); return 0; }
        self.__bbgpuCanvas = c;
        self.__bbgpuSent = 0;
        // hello: the page learns where bbgpu_host lives (the wasm memory is a SharedArrayBuffer)
        try { postMessage({ bbgpu: 'hello', buffer: HEAPU8.buffer, addr: host, touch: touch, disp: disp }); } catch (e) { console.log('[bbgpu] hello failed: ' + e); }
        return GL.registerContext(ctx, { majorVersion: 2, minorVersion: 0, enableExtensionsByDefault: 1 });
    } catch (e) { console.log('[bbgpu] WebGL2 context failed: ' + e); return 0; }
});

EM_JS(void, bbgpu_js_size, (int w, int h), {
    var c = self.__bbgpuCanvas;
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
});

EM_JS(int, bbgpu_js_send, (uint32_t win, int x, int y, int w, int h), {
    try {
        var bm = self.__bbgpuCanvas.transferToImageBitmap();
        postMessage({ bbgpu: 'present', win: win >>> 0, x: x, y: y, w: w, h: h, bitmap: bm }, [bm]);
        return 1;
    } catch (e) { console.log('[bbgpu] present failed: ' + e); return 0; }
});

EM_JS(void, bbgpu_js_remove, (uint32_t win), {
    try { postMessage({ bbgpu: 'remove', win: win >>> 0 }); } catch (e) {}
});

int bbgpu_present_ready(void)
{
    /* at most two frames in flight: the page acknowledges each one it uploads */
    return bbgpu_host[0] == 1 && (int32_t)(bbgpu_host[2] - __atomic_load_n(&bbgpu_host[1], __ATOMIC_ACQUIRE)) < 2;
}

void bbgpu_present_frame(uint32_t win, uint32_t sx, uint32_t sy, uint32_t w, uint32_t h, int32_t dx, int32_t dy)
{
    bbgpu_js_size((int)w, (int)h);
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, 0);
    /* rows are y-down in the texture; the canvas' first row is GL's top row: flip */
    glBlitFramebuffer(sx, sy, sx + w, sy + h, 0, h, w, 0, GL_COLOR_BUFFER_BIT, GL_NEAREST);
    if (bbgpu_js_send(win, dx, dy, (int)w, (int)h))
        __atomic_add_fetch(&bbgpu_host[2], 1, __ATOMIC_RELEASE);
}

void bbgpu_present_remove(uint32_t win) { bbgpu_js_remove(win); }

int bbgpu_gl_context_init(void)
{
    int h = bbgpu_webgl_create((void *)bbgpu_host, (void *)bbtouch_ring, (void *)bbdisp);
    if (h <= 0 || emscripten_webgl_make_context_current(h) != EMSCRIPTEN_RESULT_SUCCESS)
        return -1;
    emscripten_log(EM_LOG_CONSOLE, "[bbgpu] GPU thread on WebGL2 (OffscreenCanvas in its worker)");
    return 0;
}
