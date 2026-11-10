/* bbgpu-selftest.c - drives the bbgpu renderer through the protocol only and checks the pixels.
 * Native: EGL surfaceless + Mesa, GLES 3.0 (run with MESA_GLES_VERSION_OVERRIDE=3.0). SPDX-License-Identifier: MIT */
#ifdef __EMSCRIPTEN__
#include <emscripten/html5.h>
#else
#include <EGL/egl.h>
#include <EGL/eglext.h>
#endif
#include <GLES3/gl3.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../bbgpu_proto.h"
#include "../bbgpu_render.h"

static uint8_t *shm; static uint32_t head, tail, fence, fence_done, err_op;
static BBRenderer *R;
static uint32_t heap_top;  /* bump allocator in the heap */
#define HEAP (shm + BBGPU_RING_SIZE)

static void emit(uint32_t op, const uint32_t *p, uint32_t n)
{
    uint32_t dw = 2 + n, at = head % BBGPU_RING_SIZE;
    if (at + dw * 4 > BBGPU_RING_SIZE) { uint32_t pad[2] = { BBGPU_OP_WRAP, (BBGPU_RING_SIZE - at) / 4 }; memcpy(shm + at, pad, 8); head += BBGPU_RING_SIZE - at; at = 0; }
    uint32_t h[2] = { op, dw }; memcpy(shm + at, h, 8); memcpy(shm + at + 8, p, n * 4); head += dw * 4;
}
#define E(op, ...) do { uint32_t a_[] = { __VA_ARGS__ }; emit(op, a_, sizeof a_ / 4); } while (0)
static uint32_t fu(float f) { uint32_t u; memcpy(&u, &f, 4); return u; }
static uint32_t put(const void *d, uint32_t n) { uint32_t o = heap_top; memcpy(HEAP + o, d, n); heap_top += (n + 255) & ~255u; return o; }
static int flush(void)
{
    uint32_t id = ++fence; E(BBGPU_OP_FENCE, id);
    uint32_t e = bbr_execute(R, &tail, head, &fence_done, &err_op);
    if (e) { printf("  renderer error %u at op %u\n%s", e, err_op, bbr_log(R)); return 0; }
    return fence_done == id;
}

static int fails;
static void check(const char *what, const uint8_t *px, const uint8_t want[4])
{
    int ok = 1; for (int i = 0; i < 4; i++) if (abs(px[i] - want[i]) > 2) ok = 0;
    printf("  %-44s %3d %3d %3d %3d  %s\n", what, px[0], px[1], px[2], px[3], ok ? "ok" : "FAIL");
    fails += !ok;
}

static const char *VS =
    "#version 300 es\n"
    "layout(location=0) in vec4 bb_a0; layout(location=1) in vec2 bb_a1; out vec2 v; uniform vec4 bb_vc[1];\n"
    "void main() { gl_Position = bb_a0 + bb_vc[0]; v = bb_a1; }\n";
static const char *FS =
    "#version 300 es\nprecision mediump float;\n"
    "in vec2 v; uniform sampler2D bb_s0; uniform vec4 bb_fc[1]; layout(location=0) out vec4 bb_o0;\n"
    "void main() { bb_o0 = texture(bb_s0, v) * bb_fc[0]; }\n";

int main(void)
{
#ifdef __EMSCRIPTEN__
    EmscriptenWebGLContextAttributes a; emscripten_webgl_init_context_attributes(&a);
    a.majorVersion = 2; a.minorVersion = 0;
    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx = emscripten_webgl_create_context("#canvas", &a);
    if (ctx <= 0 || emscripten_webgl_make_context_current(ctx) != EMSCRIPTEN_RESULT_SUCCESS) { printf("no WebGL2\n"); return 1; }
#else
    EGLDisplay d = eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL);
    if (!eglInitialize(d, NULL, NULL)) { printf("no EGL\n"); return 1; }
    eglBindAPI(EGL_OPENGL_ES_API);
    EGLint ca[] = { EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 0, EGL_NONE };
    EGLConfig cfg; EGLint n; EGLint attrs[] = { EGL_RENDERABLE_TYPE, EGL_OPENGL_ES3_BIT, EGL_NONE };
    eglChooseConfig(d, attrs, &cfg, 1, &n);
    EGLContext c = eglCreateContext(d, n ? cfg : EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, ca);
    if (!eglMakeCurrent(d, EGL_NO_SURFACE, EGL_NO_SURFACE, c)) { printf("no GLES 3.0 context\n"); return 1; }
#endif
    printf("GL: %s | %s\n", glGetString(GL_VERSION), glGetString(GL_RENDERER));

    uint32_t size = 64u << 20; shm = calloc(1, size); R = bbr_create(shm, size);
    uint8_t px[64 * 64 * 4];
    uint32_t rd = heap_top; heap_top += 64 * 64 * 4;

    /* 1) clear */
    E(BBGPU_OP_RES_CREATE, 1, BBGPU_TARGET_2D, BBGPU_FMT_RGBA8, 64, 64, 1, 1, 0);
    E(BBGPU_OP_RES_CREATE, 2, BBGPU_TARGET_2D, BBGPU_FMT_Z24S8, 64, 64, 1, 1, 0);
    E(BBGPU_OP_SET_FRAMEBUFFER, 1, 2, 1);
    E(BBGPU_OP_SET_VIEWPORT, fu(0), fu(0), fu(64), fu(64), fu(0), fu(1));
    E(BBGPU_OP_CLEAR, GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT, fu(1), fu(0), fu(0), fu(1), fu(1), 0);
    E(BBGPU_OP_RES_READ, 1, 0, 0, 0, 64, 64, rd, 0);
    printf("1 clear: %s\n", flush() ? "executed" : "FAILED");
    memcpy(px, HEAP + rd, sizeof px); check("clear red", px, (uint8_t[]){255, 0, 0, 255});

    /* 2) textured quad from a BGRA8 texture, tinted by a uniform */
    uint32_t vs = put(VS, strlen(VS)), fs = put(FS, strlen(FS));
    E(BBGPU_OP_SHADER_CREATE, 10, BBGPU_STAGE_VS, vs, (uint32_t)strlen(VS));
    E(BBGPU_OP_SHADER_CREATE, 11, BBGPU_STAGE_FS, fs, (uint32_t)strlen(FS));
    E(BBGPU_OP_PROGRAM_CREATE, 12, 10, 11);
    E(BBGPU_OP_USE_PROGRAM, 12);
    float quad[] = { -1,-1,0,1, 0,0,   1,-1,0,1, 1,0,   -1,1,0,1, 0,1,   1,1,0,1, 1,1 };
    E(BBGPU_OP_RES_CREATE, 20, BBGPU_TARGET_BUFFER, 0, sizeof quad, 1, 1, 1, 0);
    uint32_t qo = put(quad, sizeof quad);
    E(BBGPU_OP_RES_WRITE, 20, 0, 0, 0, 0, sizeof quad, 1, 1, qo, 0, 0);
    E(BBGPU_OP_SET_VERTEX_BUFFERS, 1, 20, 24, 0);
    E(BBGPU_OP_SET_VERTEX_ELEMENTS, 2, 0, 0, 4, GL_FLOAT, 0, 0, 0,   0, 16, 2, GL_FLOAT, 0, 0, 0);
    uint8_t bgra[] = { 255,0,0,255,  0,255,0,255,  0,0,255,255,  255,255,255,255 };  /* B G R A: blue, green, red, white */
    E(BBGPU_OP_RES_CREATE, 21, BBGPU_TARGET_2D, BBGPU_FMT_BGRA8, 2, 2, 1, 1, 0);
    uint32_t to = put(bgra, sizeof bgra);
    E(BBGPU_OP_RES_WRITE, 21, 0, 0, 0, 0, 2, 2, 1, to, 8, 0);
    E(BBGPU_OP_SET_TEXTURES, 0, 1, 21, GL_NEAREST, GL_NEAREST, GL_CLAMP_TO_EDGE, GL_CLAMP_TO_EDGE, 0x03020100);
    E(BBGPU_OP_SET_UNIFORMS, BBGPU_STAGE_VS, 0, 1, fu(0), fu(0), fu(0), fu(0));
    E(BBGPU_OP_SET_UNIFORMS, BBGPU_STAGE_FS, 0, 1, fu(1), fu(1), fu(0.5f), fu(1));
    E(BBGPU_OP_SET_BLEND, 0, GL_FUNC_ADD, GL_ONE, GL_ZERO, GL_FUNC_ADD, GL_ONE, GL_ZERO, 15, 0, 0, 0, 0);
    E(BBGPU_OP_SET_DEPTH_STENCIL, 0, 0, GL_LESS, 0, GL_ALWAYS, 0, 0xff, GL_KEEP, GL_KEEP, GL_KEEP, 0xff);
    E(BBGPU_OP_SET_RASTER, 0, 1, 0, 0, 0);
    E(BBGPU_OP_DRAW, GL_TRIANGLE_STRIP, 0, 4, 1, 0, 0);
    E(BBGPU_OP_RES_READ, 1, 0, 0, 0, 64, 64, rd, 0);
    printf("2 textured quad: %s\n", flush() ? "executed" : "FAILED");
    memcpy(px, HEAP + rd, sizeof px);
    check("bottom-left texel (blue, b*0.5)", px + (8 * 64 + 8) * 4, (uint8_t[]){0, 0, 128, 255});
    check("bottom-right texel (green)", px + (8 * 64 + 56) * 4, (uint8_t[]){0, 255, 0, 255});
    check("top-left texel (red)", px + (56 * 64 + 8) * 4, (uint8_t[]){255, 0, 0, 255});
    check("top-right texel (white, b*0.5)", px + (56 * 64 + 56) * 4, (uint8_t[]){255, 255, 128, 255});

    /* 3) indexed draw with an index bias (no base-vertex in WebGL2: renderer offsets the attributes) */
    float quad2[24 + 24]; memset(quad2, 0, 24 * 4); memcpy(quad2 + 24, quad, sizeof quad);   /* 4 dummy vertices first */
    E(BBGPU_OP_RES_CREATE, 30, BBGPU_TARGET_BUFFER, 0, sizeof quad2, 1, 1, 1, 0);
    uint32_t q2 = put(quad2, sizeof quad2);
    E(BBGPU_OP_RES_WRITE, 30, 0, 0, 0, 0, sizeof quad2, 1, 1, q2, 0, 0);
    uint16_t idx[] = { 0, 1, 2, 2, 1, 3 };
    E(BBGPU_OP_RES_CREATE, 31, BBGPU_TARGET_BUFFER, 0, sizeof idx, 1, 1, 1, 0);
    uint32_t io = put(idx, sizeof idx);
    E(BBGPU_OP_RES_WRITE, 31, 0, 0, 0, 0, sizeof idx, 1, 1, io, 0, 0);
    E(BBGPU_OP_SET_VERTEX_BUFFERS, 1, 30, 24, 0);
    E(BBGPU_OP_SET_INDEX_BUFFER, 31, 2, 0);
    E(BBGPU_OP_SET_UNIFORMS, BBGPU_STAGE_FS, 0, 1, fu(0), fu(1), fu(1), fu(1));
    E(BBGPU_OP_CLEAR, GL_COLOR_BUFFER_BIT, fu(0), fu(0), fu(0), fu(1), fu(1), 0);
    E(BBGPU_OP_DRAW, GL_TRIANGLES, 0, 6, 1, 4, 1);
    E(BBGPU_OP_RES_READ, 1, 0, 0, 0, 64, 64, rd, 0);
    printf("3 indexed + bias: %s\n", flush() ? "executed" : "FAILED");
    memcpy(px, HEAP + rd, sizeof px);
    check("top-right (white * (0,1,1))", px + (56 * 64 + 56) * 4, (uint8_t[]){0, 255, 255, 255});

    /* 4) depth: near quad (z=-0.5) drawn after far quad (z=0.5) must win, and the reverse order too */
    E(BBGPU_OP_SET_VERTEX_BUFFERS, 1, 20, 24, 0);
    E(BBGPU_OP_SET_DEPTH_STENCIL, 1, 1, GL_LESS, 0, GL_ALWAYS, 0, 0xff, GL_KEEP, GL_KEEP, GL_KEEP, 0xff);
    E(BBGPU_OP_CLEAR, GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT, fu(0), fu(0), fu(0), fu(1), fu(1), 0);
    E(BBGPU_OP_SET_UNIFORMS, BBGPU_STAGE_VS, 0, 1, fu(0), fu(0), fu(-0.5f), fu(0));
    E(BBGPU_OP_SET_UNIFORMS, BBGPU_STAGE_FS, 0, 1, fu(0), fu(0), fu(0), fu(1));      /* near = black */
    E(BBGPU_OP_DRAW, GL_TRIANGLE_STRIP, 0, 4, 1, 0, 0);
    E(BBGPU_OP_SET_UNIFORMS, BBGPU_STAGE_VS, 0, 1, fu(0), fu(0), fu(0.5f), fu(0));
    E(BBGPU_OP_SET_UNIFORMS, BBGPU_STAGE_FS, 0, 1, fu(1), fu(1), fu(1), fu(1));      /* far = texture colours */
    E(BBGPU_OP_DRAW, GL_TRIANGLE_STRIP, 0, 4, 1, 0, 0);
    E(BBGPU_OP_RES_READ, 1, 0, 0, 0, 64, 64, rd, 0);
    printf("4 depth test: %s\n", flush() ? "executed" : "FAILED");
    memcpy(px, HEAP + rd, sizeof px);
    check("near (black) beats later far quad", px + (8 * 64 + 56) * 4, (uint8_t[]){0, 0, 0, 255});

    /* 5) copy (blit) the framebuffer into another texture and read that */
    E(BBGPU_OP_RES_CREATE, 40, BBGPU_TARGET_2D, BBGPU_FMT_RGBA8, 64, 64, 1, 1, 0);
    E(BBGPU_OP_SET_DEPTH_STENCIL, 0, 0, GL_LESS, 0, GL_ALWAYS, 0, 0xff, GL_KEEP, GL_KEEP, GL_KEEP, 0xff);
    E(BBGPU_OP_CLEAR, GL_COLOR_BUFFER_BIT, fu(0.2f), fu(0.4f), fu(0.6f), fu(1), fu(1), 0);
    E(BBGPU_OP_COPY_RES, 40, 0, 0, 0, 1, 0, 0, 0, 64, 64, 0);
    E(BBGPU_OP_RES_READ, 40, 0, 0, 0, 64, 64, rd, 0);
    printf("5 copy: %s\n", flush() ? "executed" : "FAILED");
    memcpy(px, HEAP + rd, sizeof px);
    check("copied clear colour", px + (32 * 64 + 32) * 4, (uint8_t[]){51, 102, 153, 255});

    printf("%s (%d failed), %llu draws, GL error 0x%x\n", fails ? "SELFTEST FAILED" : "SELFTEST OK", fails,
           (unsigned long long)bbr_draws(R), glGetError());
    return fails != 0;
}
