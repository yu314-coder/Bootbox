/* bbgpu_render.c - Bootbox GPU bridge renderer: executes protocol v1 commands on OpenGL ES 3.0, using only
 * what WebGL2 provides (the engine runs it on WebGL2; native tests run it on Mesa GLES 3.0).
 * The caller owns the GL context (current on the calling thread). SPDX-License-Identifier: MIT */
#include <GLES3/gl3.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "bbgpu_proto.h"
#include "bbgpu_render.h"

enum { K_NONE, K_BUFFER, K_TEXTURE, K_RENDERBUF, K_SHADER, K_PROGRAM };
typedef struct {
    uint8_t kind, fmt;
    GLuint gl;
    GLuint gl_index;               /* buffers: twin bound only as ELEMENT_ARRAY_BUFFER (WebGL: an index
                                      buffer can never be used for other data, nor the other way round) */
    uint8_t *shadow;               /* buffers: host copy, fills the index twin */
    uint32_t w, h, levels, bind;
    GLint loc_vc, loc_fc, loc_flip; /* programs: uniform arrays, y flip */
} Obj;

typedef struct { uint32_t buffer, offset, size, type, normalized, integer, divisor; } VElem;
typedef struct { uint32_t res, stride, offset; } VBuf;

struct BBRenderer {
    uint8_t *shm, *heap;
    uint32_t shm_size, heap_size;
    Obj *obj; uint32_t nobj;
    GLuint fbo, read_fbo, draw_fbo, vao, sampler[16];
    uint32_t program;
    float vc[256][4], fc[256][4]; uint32_t vc_n, fc_n; int uniforms_dirty;
    VElem ve[16]; uint32_t nve;
    VBuf vb[16]; uint32_t nvb;
    uint32_t ib_res, ib_size, ib_off;
    uint32_t fb_w, fb_h;
    int flip, front_ccw;
    char log[BBGPU_LOG_SIZE];
    uint64_t draws;
};

static uint32_t U(const uint32_t *p, int i) { return p[i]; }
static float F(const uint32_t *p, int i) { float f; memcpy(&f, &p[i], 4); return f; }

static void logf_(BBRenderer *r, const char *fmt, const char *a, const char *b)
{
    size_t n = strlen(r->log);
    if (n + 512 < sizeof r->log) snprintf(r->log + n, sizeof r->log - n, fmt, a, b);
    if (r->heap_size > BBGPU_LOG_SIZE) memcpy(r->heap + r->heap_size - BBGPU_LOG_SIZE, r->log, sizeof r->log);
}

static Obj *obj_get(BBRenderer *r, uint32_t id, int create)
{
    if (id == 0 || id >= (1u << 20)) return NULL;
    if (id >= r->nobj) {
        if (!create) return NULL;
        uint32_t n = r->nobj ? r->nobj : 256;
        while (n <= id) n *= 2;
        r->obj = realloc(r->obj, n * sizeof(Obj));
        memset(r->obj + r->nobj, 0, (n - r->nobj) * sizeof(Obj));
        r->nobj = n;
    }
    return &r->obj[id];
}
static Obj *obj_kind(BBRenderer *r, uint32_t id, int kind) { Obj *o = obj_get(r, id, 0); return o && o->kind == kind ? o : NULL; }

/* ---- formats: internal format, upload format, type, bytes/pixel, needs RB swap (BGRA has no WebGL2 format) ---- */
typedef struct { GLenum ifmt, fmt, type; uint8_t bpp, swap_rb, depth; } FmtInfo;
static const FmtInfo fmt_info[BBGPU_FMT_COUNT] = {
    [BBGPU_FMT_RGBA8]   = { GL_RGBA8, GL_RGBA, GL_UNSIGNED_BYTE, 4, 0, 0 },
    [BBGPU_FMT_BGRA8]   = { GL_RGBA8, GL_RGBA, GL_UNSIGNED_BYTE, 4, 1, 0 },
    [BBGPU_FMT_RGBX8]   = { GL_RGBA8, GL_RGBA, GL_UNSIGNED_BYTE, 4, 0, 0 },
    [BBGPU_FMT_BGRX8]   = { GL_RGBA8, GL_RGBA, GL_UNSIGNED_BYTE, 4, 1, 0 },
    [BBGPU_FMT_R8]      = { GL_R8, GL_RED, GL_UNSIGNED_BYTE, 1, 0, 0 },
    [BBGPU_FMT_RG8]     = { GL_RG8, GL_RG, GL_UNSIGNED_BYTE, 2, 0, 0 },
    [BBGPU_FMT_A8]      = { GL_R8, GL_RED, GL_UNSIGNED_BYTE, 1, 0, 0 },   /* guest swizzles .r -> .a in GLSL */
    [BBGPU_FMT_RGB565]  = { GL_RGB565, GL_RGB, GL_UNSIGNED_SHORT_5_6_5, 2, 0, 0 },
    [BBGPU_FMT_RGBA16F] = { GL_RGBA16F, GL_RGBA, GL_HALF_FLOAT, 8, 0, 0 },
    [BBGPU_FMT_RGBA32F] = { GL_RGBA32F, GL_RGBA, GL_FLOAT, 16, 0, 0 },
    [BBGPU_FMT_Z16]     = { GL_DEPTH_COMPONENT16, GL_DEPTH_COMPONENT, GL_UNSIGNED_SHORT, 2, 0, 1 },
    [BBGPU_FMT_Z24X8]   = { GL_DEPTH_COMPONENT24, GL_DEPTH_COMPONENT, GL_UNSIGNED_INT, 4, 0, 1 },
    [BBGPU_FMT_Z24S8]   = { GL_DEPTH24_STENCIL8, GL_DEPTH_STENCIL, GL_UNSIGNED_INT_24_8, 4, 0, 2 },
    [BBGPU_FMT_Z32F]    = { GL_DEPTH_COMPONENT32F, GL_DEPTH_COMPONENT, GL_FLOAT, 4, 0, 1 },
};

static void swap_rb(uint8_t *p, uint32_t w, uint32_t h, uint32_t stride)
{
    for (uint32_t y = 0; y < h; y++) {
        uint8_t *q = p + (size_t)y * stride;
        for (uint32_t x = 0; x < w; x++, q += 4) { uint8_t t = q[0]; q[0] = q[2]; q[2] = t; }
    }
}

static int range_ok(BBRenderer *r, uint64_t off, uint64_t len) { return off + len <= r->heap_size - BBGPU_LOG_SIZE; }

/* ---- commands ---- */
static int res_create(BBRenderer *r, const uint32_t *p)
{
    Obj *o = obj_get(r, U(p, 0), 1);
    uint32_t target = U(p, 1), fmt = U(p, 2), w = U(p, 3), h = U(p, 4), levels = U(p, 6), bind = U(p, 7);
    if (!o || o->kind != K_NONE) return BBGPU_ERR_OBJECT;
    o->w = w; o->h = h; o->levels = levels ? levels : 1; o->bind = bind; o->fmt = fmt;
    if (target == BBGPU_TARGET_BUFFER) {
        o->kind = K_BUFFER;
        o->shadow = calloc(1, w ? w : 1);
        glGenBuffers(1, &o->gl);
        glBindBuffer(GL_ARRAY_BUFFER, o->gl);
        glBufferData(GL_ARRAY_BUFFER, w, NULL, GL_DYNAMIC_DRAW);
        return 0;
    }
    if (fmt == 0 || fmt >= BBGPU_FMT_COUNT || !fmt_info[fmt].ifmt) return BBGPU_ERR_RANGE;
    o->kind = K_TEXTURE;
    glGenTextures(1, &o->gl);
    glBindTexture(GL_TEXTURE_2D, o->gl);
    glTexStorage2D(GL_TEXTURE_2D, o->levels, fmt_info[fmt].ifmt, w, h);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, o->levels - 1);
    return 0;
}

static void obj_free(Obj *o)
{
    switch (o->kind) {
    case K_BUFFER: glDeleteBuffers(1, &o->gl); if (o->gl_index) glDeleteBuffers(1, &o->gl_index); free(o->shadow); break;
    case K_TEXTURE: glDeleteTextures(1, &o->gl); break;
    case K_SHADER: glDeleteShader(o->gl); break;
    case K_PROGRAM: glDeleteProgram(o->gl); break;
    }
    memset(o, 0, sizeof *o);
}

static int res_write(BBRenderer *r, const uint32_t *p)
{
    Obj *o = obj_get(r, U(p, 0), 0);
    uint32_t level = U(p, 1), x = U(p, 2), y = U(p, 3), w = U(p, 5), h = U(p, 6), off = U(p, 8), stride = U(p, 9);
    if (!o) return BBGPU_ERR_OBJECT;
    if (o->kind == K_BUFFER) {                       /* x = byte offset, w = byte size */
        if (!range_ok(r, off, w) || x + w > o->w) return BBGPU_ERR_RANGE;
        memcpy(o->shadow + x, r->heap + off, w);
        glBindBuffer(GL_ARRAY_BUFFER, o->gl);
        glBufferSubData(GL_ARRAY_BUFFER, x, w, r->heap + off);
        if (o->gl_index) { glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, o->gl_index); glBufferSubData(GL_ELEMENT_ARRAY_BUFFER, x, w, r->heap + off); }
        return 0;
    }
    if (o->kind != K_TEXTURE) return BBGPU_ERR_OBJECT;
    const FmtInfo *f = &fmt_info[o->fmt];
    if (!stride) stride = w * f->bpp;
    if (!range_ok(r, off, (uint64_t)stride * h) || stride % f->bpp) return BBGPU_ERR_RANGE;
    if (f->swap_rb) swap_rb(r->heap + off, w, h, stride);   /* in place: the guest no longer needs it */
    glBindTexture(GL_TEXTURE_2D, o->gl);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
    glPixelStorei(GL_UNPACK_ROW_LENGTH, stride / f->bpp);
    glTexSubImage2D(GL_TEXTURE_2D, level, x, y, w, h, f->fmt, f->type, r->heap + off);
    glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
    return 0;
}

static int res_read(BBRenderer *r, const uint32_t *p)
{
    Obj *o = obj_kind(r, U(p, 0), K_TEXTURE);
    uint32_t level = U(p, 1), x = U(p, 2), y = U(p, 3), w = U(p, 4), h = U(p, 5), off = U(p, 6), stride = U(p, 7);
    if (!o) return BBGPU_ERR_OBJECT;
    const FmtInfo *f = &fmt_info[o->fmt];
    if (f->depth || f->bpp != 4) return BBGPU_ERR_RANGE;     /* WebGL2: no depth read-back; RGBA8 class only */
    if (!stride) stride = w * 4;
    if (!range_ok(r, off, (uint64_t)stride * h)) return BBGPU_ERR_RANGE;
    glBindFramebuffer(GL_READ_FRAMEBUFFER, r->read_fbo);
    glFramebufferTexture2D(GL_READ_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, o->gl, level);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glPixelStorei(GL_PACK_ROW_LENGTH, stride / 4);
    glReadPixels(x, y, w, h, GL_RGBA, GL_UNSIGNED_BYTE, r->heap + off);
    glPixelStorei(GL_PACK_ROW_LENGTH, 0);
    if (f->swap_rb) swap_rb(r->heap + off, w, h, stride);
    return 0;
}

static int shader_create(BBRenderer *r, const uint32_t *p)
{
    Obj *o = obj_get(r, U(p, 0), 1);
    uint32_t stage = U(p, 1), off = U(p, 2), len = U(p, 3);
    if (!o || o->kind != K_NONE) return BBGPU_ERR_OBJECT;
    if (!range_ok(r, off, len)) return BBGPU_ERR_RANGE;
    o->kind = K_SHADER;
    o->gl = glCreateShader(stage == BBGPU_STAGE_VS ? GL_VERTEX_SHADER : GL_FRAGMENT_SHADER);
    const char *src = (const char *)r->heap + off; GLint n = (GLint)len;
    glShaderSource(o->gl, 1, &src, &n);
    glCompileShader(o->gl);
    GLint ok = 0; glGetShaderiv(o->gl, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char buf[2048]; glGetShaderInfoLog(o->gl, sizeof buf, NULL, buf);
        logf_(r, "shader compile failed: %s\n%s\n", buf, "");
        return BBGPU_ERR_SHADER;
    }
    return 0;
}

static int program_create(BBRenderer *r, const uint32_t *p)
{
    Obj *o = obj_get(r, U(p, 0), 1), *vs = obj_kind(r, U(p, 1), K_SHADER), *fs = obj_kind(r, U(p, 2), K_SHADER);
    if (!o || o->kind != K_NONE || !vs || !fs) return BBGPU_ERR_OBJECT;
    o->kind = K_PROGRAM;
    o->gl = glCreateProgram();
    glAttachShader(o->gl, vs->gl); glAttachShader(o->gl, fs->gl);
    glLinkProgram(o->gl);
    GLint ok = 0; glGetProgramiv(o->gl, GL_LINK_STATUS, &ok);
    if (!ok) {
        char buf[2048]; glGetProgramInfoLog(o->gl, sizeof buf, NULL, buf);
        logf_(r, "program link failed: %s%s\n", buf, "");
        return BBGPU_ERR_SHADER;
    }
    glUseProgram(o->gl);
    o->loc_vc = glGetUniformLocation(o->gl, "bb_vc");
    o->loc_fc = glGetUniformLocation(o->gl, "bb_fc");
    o->loc_flip = glGetUniformLocation(o->gl, "bb_flip");
    for (int i = 0; i < 16; i++) {
        char name[16]; snprintf(name, sizeof name, "bb_s%d", i);
        GLint l = glGetUniformLocation(o->gl, name);
        if (l >= 0) glUniform1i(l, i);
    }
    Obj *cur = obj_kind(r, r->program, K_PROGRAM);
    glUseProgram(cur ? cur->gl : 0);
    return 0;
}

static int set_framebuffer(BBRenderer *r, const uint32_t *p, uint32_t ndw)
{
    uint32_t n = U(p, 0), zs = U(p, 1);
    if (n > 8 || ndw < 2 + n) return BBGPU_ERR_RANGE;
    glBindFramebuffer(GL_FRAMEBUFFER, r->fbo);
    GLenum bufs[8];
    r->fb_w = r->fb_h = 0;
    for (uint32_t i = 0; i < 8; i++) {
        Obj *c = i < n ? obj_kind(r, U(p, 2 + i), K_TEXTURE) : NULL;
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0 + i, GL_TEXTURE_2D, c ? c->gl : 0, 0);
        if (i < n) bufs[i] = c ? GL_COLOR_ATTACHMENT0 + i : GL_NONE;
        if (c && !r->fb_w) { r->fb_w = c->w; r->fb_h = c->h; }
    }
    Obj *z = obj_kind(r, zs, K_TEXTURE);
    GLenum zatt = z && fmt_info[z->fmt].depth == 2 ? GL_DEPTH_STENCIL_ATTACHMENT : GL_DEPTH_ATTACHMENT;
    glFramebufferTexture2D(GL_FRAMEBUFFER, GL_DEPTH_STENCIL_ATTACHMENT, GL_TEXTURE_2D, 0, 0);
    if (z) glFramebufferTexture2D(GL_FRAMEBUFFER, zatt, GL_TEXTURE_2D, z->gl, 0);
    if (z && !r->fb_w) { r->fb_w = z->w; r->fb_h = z->h; }
    glDrawBuffers(n, bufs);
    return 0;
}

static int set_textures(BBRenderer *r, const uint32_t *p, uint32_t ndw)
{
    uint32_t first = U(p, 0), n = U(p, 1);
    if (first + n > 16 || ndw < 2 + n * 6) return BBGPU_ERR_RANGE;
    for (uint32_t i = 0; i < n; i++) {
        const uint32_t *t = p + 2 + i * 6;
        Obj *o = obj_kind(r, U(t, 0), K_TEXTURE);
        GLuint s = r->sampler[first + i];
        glActiveTexture(GL_TEXTURE0 + first + i);
        glBindTexture(GL_TEXTURE_2D, o ? o->gl : 0);
        glBindSampler(first + i, s);
        glSamplerParameteri(s, GL_TEXTURE_MIN_FILTER, U(t, 1));
        glSamplerParameteri(s, GL_TEXTURE_MAG_FILTER, U(t, 2));
        glSamplerParameteri(s, GL_TEXTURE_WRAP_S, U(t, 3));
        glSamplerParameteri(s, GL_TEXTURE_WRAP_T, U(t, 4));
    }
    glActiveTexture(GL_TEXTURE0);
    return 0;
}

static void apply_vertex_state(BBRenderer *r, int32_t index_bias)
{
    for (uint32_t i = 0; i < 16; i++) {
        if (i >= r->nve) { glDisableVertexAttribArray(i); continue; }
        VElem *e = &r->ve[i];
        VBuf *b = e->buffer < r->nvb ? &r->vb[e->buffer] : NULL;
        Obj *o = b ? obj_kind(r, b->res, K_BUFFER) : NULL;
        if (!o) { glDisableVertexAttribArray(i); continue; }
        glBindBuffer(GL_ARRAY_BUFFER, o->gl);
        /* WebGL2 has no base-vertex draws: apply the index bias to the attribute offsets */
        intptr_t off = (intptr_t)b->offset + e->offset + (e->divisor ? 0 : (intptr_t)index_bias * b->stride);
        if (e->integer) glVertexAttribIPointer(i, e->size, e->type, b->stride, (const void *)off);
        else glVertexAttribPointer(i, e->size, e->type, e->normalized ? GL_TRUE : GL_FALSE, b->stride, (const void *)off);
        glVertexAttribDivisor(i, e->divisor);
        glEnableVertexAttribArray(i);
    }
}

static int draw(BBRenderer *r, const uint32_t *p)
{
    uint32_t mode = U(p, 0), start = U(p, 1), count = U(p, 2), inst = U(p, 3), indexed = U(p, 5);
    int32_t bias = (int32_t)U(p, 4);
    Obj *prog = obj_kind(r, r->program, K_PROGRAM);
    if (!prog) return BBGPU_ERR_OBJECT;
    if (r->uniforms_dirty) {
        if (prog->loc_vc >= 0 && r->vc_n) glUniform4fv(prog->loc_vc, r->vc_n, &r->vc[0][0]);
        if (prog->loc_fc >= 0 && r->fc_n) glUniform4fv(prog->loc_fc, r->fc_n, &r->fc[0][0]);
        r->uniforms_dirty = 0;
    }
    if (prog->loc_flip >= 0) glUniform1f(prog->loc_flip, r->flip ? -1.0f : 1.0f);
    glFrontFace((r->front_ccw ^ r->flip) ? GL_CCW : GL_CW);
    apply_vertex_state(r, indexed ? bias : 0);
    if (!inst) inst = 1;
    if (indexed) {
        Obj *ib = obj_kind(r, r->ib_res, K_BUFFER);
        if (!ib) return BBGPU_ERR_OBJECT;
        GLenum t = r->ib_size == 1 ? GL_UNSIGNED_BYTE : r->ib_size == 2 ? GL_UNSIGNED_SHORT : GL_UNSIGNED_INT;
        if (!ib->gl_index) {
            glGenBuffers(1, &ib->gl_index);
            glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ib->gl_index);
            glBufferData(GL_ELEMENT_ARRAY_BUFFER, ib->w, ib->shadow, GL_DYNAMIC_DRAW);
        }
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ib->gl_index);
        glDrawElementsInstanced(mode, count, t, (const void *)(uintptr_t)(r->ib_off + start * r->ib_size), inst);
    } else {
        glDrawArraysInstanced(mode, start, count, inst);
    }
    r->draws++;
    return 0;
}

static int copy_res(BBRenderer *r, const uint32_t *p)
{
    Obj *d = obj_kind(r, U(p, 0), K_TEXTURE), *s = obj_kind(r, U(p, 2), K_TEXTURE);
    if (!d || !s) return BBGPU_ERR_OBJECT;
    int depth = fmt_info[s->fmt].depth;
    GLbitfield mask = depth ? (GL_DEPTH_BUFFER_BIT | (depth == 2 ? GL_STENCIL_BUFFER_BIT : 0)) : GL_COLOR_BUFFER_BIT;
    GLenum att = depth == 2 ? GL_DEPTH_STENCIL_ATTACHMENT : depth ? GL_DEPTH_ATTACHMENT : GL_COLOR_ATTACHMENT0;
    glBindFramebuffer(GL_READ_FRAMEBUFFER, r->read_fbo);
    glFramebufferTexture2D(GL_READ_FRAMEBUFFER, att, GL_TEXTURE_2D, s->gl, U(p, 3));
    glBindFramebuffer(GL_DRAW_FRAMEBUFFER, r->draw_fbo);
    glFramebufferTexture2D(GL_DRAW_FRAMEBUFFER, att, GL_TEXTURE_2D, d->gl, U(p, 1));
    int scissor = glIsEnabled(GL_SCISSOR_TEST);
    if (scissor) glDisable(GL_SCISSOR_TEST);
    glBlitFramebuffer((GLint)U(p, 4), (GLint)U(p, 5), (GLint)U(p, 6), (GLint)U(p, 7),
                      (GLint)U(p, 8), (GLint)U(p, 9), (GLint)U(p, 10), (GLint)U(p, 11), mask,
                      (U(p, 12) && !depth) ? GL_LINEAR : GL_NEAREST);
    if (scissor) glEnable(GL_SCISSOR_TEST);
    glFramebufferTexture2D(GL_READ_FRAMEBUFFER, att, GL_TEXTURE_2D, 0, 0);
    glFramebufferTexture2D(GL_DRAW_FRAMEBUFFER, att, GL_TEXTURE_2D, 0, 0);
    glBindFramebuffer(GL_FRAMEBUFFER, r->fbo);
    return 0;
}

static int exec_one(BBRenderer *r, uint32_t op, const uint32_t *p, uint32_t ndw, uint32_t *fence_done)
{
    switch (op) {
    case BBGPU_OP_NOP: return 0;
    case BBGPU_OP_ECHO: {
        uint64_t s = U(p, 0), d = U(p, 1), n = U(p, 2);
        if (!range_ok(r, s, n) || !range_ok(r, d, n)) return BBGPU_ERR_RANGE;
        memmove(r->heap + d, r->heap + s, n); return 0;
    }
    case BBGPU_OP_FENCE: *fence_done = U(p, 0); return 0;
    case BBGPU_OP_RES_CREATE: return res_create(r, p);
    case BBGPU_OP_RES_DESTROY: case BBGPU_OP_OBJ_DESTROY: {
        Obj *o = obj_get(r, U(p, 0), 0); if (!o || !o->kind) return BBGPU_ERR_OBJECT;
        if (U(p, 0) == r->program) r->program = 0;
        obj_free(o); return 0;
    }
    case BBGPU_OP_RES_WRITE: return res_write(r, p);
    case BBGPU_OP_RES_READ: return res_read(r, p);
    case BBGPU_OP_SHADER_CREATE: return shader_create(r, p);
    case BBGPU_OP_PROGRAM_CREATE: return program_create(r, p);
    case BBGPU_OP_SET_FRAMEBUFFER: return set_framebuffer(r, p, ndw);
    case BBGPU_OP_SET_VIEWPORT:
        glViewport((GLint)F(p, 0), (GLint)F(p, 1), (GLsizei)F(p, 2), (GLsizei)F(p, 3));
        glDepthRangef(F(p, 4), F(p, 5)); r->flip = ndw > 6 && U(p, 6); return 0;
    case BBGPU_OP_SET_SCISSOR:
        if (U(p, 0)) { glEnable(GL_SCISSOR_TEST); glScissor(U(p, 1), U(p, 2), U(p, 3), U(p, 4)); }
        else glDisable(GL_SCISSOR_TEST);
        return 0;
    case BBGPU_OP_SET_BLEND:
        if (U(p, 0)) glEnable(GL_BLEND); else glDisable(GL_BLEND);
        glBlendEquationSeparate(U(p, 1), U(p, 4));
        glBlendFuncSeparate(U(p, 2), U(p, 3), U(p, 5), U(p, 6));
        glColorMask(U(p, 7) & 1, (U(p, 7) >> 1) & 1, (U(p, 7) >> 2) & 1, (U(p, 7) >> 3) & 1);
        glBlendColor(F(p, 8), F(p, 9), F(p, 10), F(p, 11));
        return 0;
    case BBGPU_OP_SET_DEPTH_STENCIL:
        if (U(p, 0)) glEnable(GL_DEPTH_TEST); else glDisable(GL_DEPTH_TEST);
        glDepthMask(U(p, 1) ? GL_TRUE : GL_FALSE);
        glDepthFunc(U(p, 2));
        if (U(p, 3)) glEnable(GL_STENCIL_TEST); else glDisable(GL_STENCIL_TEST);
        glStencilFunc(U(p, 4), U(p, 5), U(p, 6));
        glStencilOp(U(p, 7), U(p, 8), U(p, 9));
        glStencilMask(U(p, 10));
        return 0;
    case BBGPU_OP_SET_RASTER:
        if (U(p, 0)) { glEnable(GL_CULL_FACE); glCullFace(U(p, 0)); } else glDisable(GL_CULL_FACE);
        r->front_ccw = U(p, 1) != 0;
        if (U(p, 2)) { glEnable(GL_POLYGON_OFFSET_FILL); glPolygonOffset(F(p, 3), F(p, 4)); } else glDisable(GL_POLYGON_OFFSET_FILL);
        return 0;
    case BBGPU_OP_USE_PROGRAM: {
        Obj *o = obj_kind(r, U(p, 0), K_PROGRAM); if (!o) return BBGPU_ERR_OBJECT;
        r->program = U(p, 0); glUseProgram(o->gl); r->uniforms_dirty = 1; return 0;
    }
    case BBGPU_OP_SET_UNIFORMS: {
        uint32_t stage = U(p, 0), first = U(p, 1), n = U(p, 2);
        if (first + n > 256 || ndw < 3 + n * 4) return BBGPU_ERR_RANGE;
        float (*dst)[4] = stage == BBGPU_STAGE_VS ? r->vc : r->fc;
        memcpy(dst[first], p + 3, n * 16);
        uint32_t *cnt = stage == BBGPU_STAGE_VS ? &r->vc_n : &r->fc_n;
        if (first + n > *cnt) *cnt = first + n;
        r->uniforms_dirty = 1; return 0;
    }
    case BBGPU_OP_SET_VERTEX_ELEMENTS: {
        uint32_t n = U(p, 0); if (n > 16 || ndw < 1 + n * 7) return BBGPU_ERR_RANGE;
        memcpy(r->ve, p + 1, n * sizeof(VElem)); r->nve = n; return 0;
    }
    case BBGPU_OP_SET_VERTEX_BUFFERS: {
        uint32_t n = U(p, 0); if (n > 16 || ndw < 1 + n * 3) return BBGPU_ERR_RANGE;
        memcpy(r->vb, p + 1, n * sizeof(VBuf)); r->nvb = n; return 0;
    }
    case BBGPU_OP_SET_INDEX_BUFFER: r->ib_res = U(p, 0); r->ib_size = U(p, 1); r->ib_off = U(p, 2); return 0;
    case BBGPU_OP_SET_TEXTURES: return set_textures(r, p, ndw);
    case BBGPU_OP_CLEAR: {
        GLbitfield b = U(p, 0);
        glClearColor(F(p, 1), F(p, 2), F(p, 3), F(p, 4)); glClearDepthf(F(p, 5)); glClearStencil(U(p, 6));
        glClear(b); return 0;
    }
    case BBGPU_OP_DRAW: return draw(r, p);
    case BBGPU_OP_COPY_RES: return copy_res(r, p);
    }
    return BBGPU_ERR_OP;
}

BBRenderer *bbr_create(uint8_t *shm, uint32_t shm_size)
{
    BBRenderer *r = calloc(1, sizeof *r);
    r->shm = shm; r->shm_size = shm_size;
    r->heap = shm + BBGPU_RING_SIZE; r->heap_size = shm_size - BBGPU_RING_SIZE;
    glGenFramebuffers(1, &r->fbo); glGenFramebuffers(1, &r->read_fbo); glGenFramebuffers(1, &r->draw_fbo);
    glGenVertexArrays(1, &r->vao); glBindVertexArray(r->vao);
    glGenSamplers(16, r->sampler);
    glBindFramebuffer(GL_FRAMEBUFFER, r->fbo);
    return r;
}

/* Execute every complete command from *tail to head. Returns 0 or the first error (stops there). */
uint32_t bbr_execute(BBRenderer *r, uint32_t *tail, uint32_t head, uint32_t *fence_done, uint32_t *err_op)
{
    while (*tail != head) {
        uint32_t at = *tail % BBGPU_RING_SIZE;
        if (at + 8 > BBGPU_RING_SIZE) return BBGPU_ERR_RING;
        const uint32_t *c = (const uint32_t *)(r->shm + at);
        uint32_t op = c[0], dw = c[1];
        if (dw < 2 || at + dw * 4 > BBGPU_RING_SIZE) return BBGPU_ERR_RING;
        if (op == BBGPU_OP_WRAP) { *tail += BBGPU_RING_SIZE - at; continue; }
        uint32_t e = exec_one(r, op, c + 2, dw - 2, fence_done);
#ifndef __EMSCRIPTEN__
        static int trace = -1;
        if (trace < 0) { const char *t = getenv("BBGPU_TRACE"); trace = t && *t == '1'; }
        if (trace) {
            const uint32_t *q = c + 2; GLenum ge = glGetError();
            fprintf(stderr, "[bbr] op %2u dw %4u  %08x %08x %08x %08x %08x %08x  e=%u gl=0x%x\n", op, dw,
                    dw > 2 ? q[0] : 0, dw > 3 ? q[1] : 0, dw > 4 ? q[2] : 0, dw > 5 ? q[3] : 0, dw > 6 ? q[4] : 0, dw > 7 ? q[5] : 0, e, ge);
            if (op == BBGPU_OP_SET_UNIFORMS && dw > 6) fprintf(stderr, "[bbr]   uniforms[0] %g %g %g %g\n", F(q, 3), F(q, 4), F(q, 5), F(q, 6));
            if (op == BBGPU_OP_DRAW) {
                for (uint32_t i = 0; i < r->nve; i++) {
                    VElem *ve = &r->ve[i]; VBuf *vb = ve->buffer < r->nvb ? &r->vb[ve->buffer] : NULL;
                    Obj *o = vb ? obj_kind(r, vb->res, K_BUFFER) : NULL;
                    float f[4] = {0}; if (o && vb->offset + ve->offset + 16 <= o->w) memcpy(f, o->shadow + vb->offset + ve->offset, 16);
                    fprintf(stderr, "[bbr]   attr%u buf%u res%u stride %u off %u size %u type 0x%x: %g %g %g %g\n", i, ve->buffer,
                            vb ? vb->res : 0, vb ? vb->stride : 0, vb ? vb->offset + ve->offset : 0, ve->size, ve->type, f[0], f[1], f[2], f[3]);
                }
                GLint vp[4]; glGetIntegerv(GL_VIEWPORT, vp);
                fprintf(stderr, "[bbr]   viewport %d %d %d %d flip %d prog %u fb %ux%u\n", vp[0], vp[1], vp[2], vp[3], r->flip, r->program, r->fb_w, r->fb_h);
            }
        }
#endif
        *tail += dw * 4;
        if (e) { *err_op = op; return e; }
    }
    return 0;
}

const char *bbr_log(BBRenderer *r) { return r->log; }
uint64_t bbr_draws(BBRenderer *r) { return r->draws; }
