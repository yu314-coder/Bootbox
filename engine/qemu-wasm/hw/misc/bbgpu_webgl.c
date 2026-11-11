/* bbgpu_webgl.c - GL context for the bbgpu GPU thread in the wasm engine: a WebGL2 context on a 1x1
 * OffscreenCanvas created inside the GPU thread's own worker (rendering goes to textures; frames are read
 * back, so no visible canvas has to be transferred), registered with emscripten's GL layer.
 * SPDX-License-Identifier: MIT */
#include <emscripten.h>
#include <emscripten/html5.h>
#include <stdio.h>

EM_JS(int, bbgpu_webgl_create, (void), {
    try {
        var c = new OffscreenCanvas(1, 1);
        var ctx = c.getContext('webgl2', { alpha: false, depth: false, stencil: false, antialias: false,
                                           preserveDrawingBuffer: false, powerPreference: 'high-performance' });
        if (!ctx) { console.log('[bbgpu] no WebGL2 in the GPU worker'); return 0; }
        return GL.registerContext(ctx, { majorVersion: 2, minorVersion: 0, enableExtensionsByDefault: 1 });
    } catch (e) { console.log('[bbgpu] WebGL2 context failed: ' + e); return 0; }
});

int bbgpu_gl_context_init(void)
{
    int h = bbgpu_webgl_create();
    if (h <= 0 || emscripten_webgl_make_context_current(h) != EMSCRIPTEN_RESULT_SUCCESS)
        return -1;
    emscripten_log(EM_LOG_CONSOLE, "[bbgpu] GPU thread on WebGL2 (OffscreenCanvas in its worker)");
    return 0;
}
