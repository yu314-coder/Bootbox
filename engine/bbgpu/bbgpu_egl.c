/* bbgpu_egl.c - native GL context for the bbgpu GPU thread: EGL surfaceless, OpenGL ES 3.0
 * (run with MESA_GLES_VERSION_OVERRIDE=3.0 to keep Mesa at WebGL2's level). SPDX-License-Identifier: MIT */
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <stdio.h>
int bbgpu_gl_context_init(void)
{
    EGLDisplay d = eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL);
    if (!eglInitialize(d, NULL, NULL)) return -1;
    eglBindAPI(EGL_OPENGL_ES_API);
    EGLint ca[] = { EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 0, EGL_NONE };
    EGLContext c = eglCreateContext(d, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, ca);
    if (c == EGL_NO_CONTEXT || !eglMakeCurrent(d, EGL_NO_SURFACE, EGL_NO_SURFACE, c)) return -1;
    fprintf(stderr, "bbgpu: GPU thread on GLES 3.0 (EGL surfaceless)\n");
    return 0;
}

/* direct present on the native rig: no viewer; BBGPU_PRESENT_DUMP=dir writes each presented frame as a PPM
 * (and makes the device report a present-capable viewer) */
#include <GLES3/gl3.h>
#include <stdint.h>
#include <stdlib.h>
#include "bbgpu_render.h"
int bbgpu_present_ready(void) { return 1; }
void bbgpu_present_frame(uint32_t win, uint32_t sx, uint32_t sy, uint32_t w, uint32_t h, int32_t dx, int32_t dy)
{
    static unsigned n;
    const char *dir = getenv("BBGPU_PRESENT_DUMP");
    bbgpu_host[1]++; bbgpu_host[2]++;
    if (!dir || (n++ % 30)) return;
    uint8_t *px = malloc((size_t)w * h * 4);
    glReadPixels(sx, sy, w, h, GL_RGBA, GL_UNSIGNED_BYTE, px);
    char p[512]; snprintf(p, sizeof p, "%s/present-%08x.ppm", dir, win);
    FILE *f = fopen(p, "wb");
    if (f) {
        fprintf(f, "P6 %u %u 255\n", w, h);
        for (uint32_t y = 0; y < h; y++) for (uint32_t x = 0; x < w; x++) fwrite(px + ((size_t)y * w + x) * 4, 3, 1, f);
        fclose(f);
    }
    fprintf(stderr, "bbgpu: present win %08x %ux%u at %d,%d\n", win, w, h, dx, dy);
    free(px);
}
void bbgpu_present_remove(uint32_t win) { fprintf(stderr, "bbgpu: present remove %08x\n", win); }
__attribute__((constructor)) static void present_env(void) { if (getenv("BBGPU_PRESENT_DUMP")) bbgpu_host[0] = 1; }
