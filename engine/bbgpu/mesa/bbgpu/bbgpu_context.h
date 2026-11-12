/* bbgpu_context.h - Bootbox GPU bridge Gallium driver: shared structures. SPDX-License-Identifier: MIT */
#ifndef BBGPU_CONTEXT_H
#define BBGPU_CONTEXT_H
#include "pipe/p_context.h"
#include "pipe/p_screen.h"
#include "pipe/p_state.h"
#include "tgsi/tgsi_scan.h"
#include "util/hash_table.h"
#include "bbgpu_dev.h"

struct sw_winsys;
struct sw_displaytarget;

struct bbgpu_screen {
   struct pipe_screen base;
   struct sw_winsys *winsys;
   struct bbgpu_dev *dev;            /* one per process, shared by every screen (bbgpu_dev_get) */
   bool reported_error;
   bool presenting;                  /* the host viewer draws our windows (BBGPU_OP_PRESENT) */
   uint32_t present_fence;           /* the previous frame's: one frame in flight */
};
static inline struct bbgpu_screen *bbgpu_screen(struct pipe_screen *s) { return (struct bbgpu_screen *)s; }

struct bbgpu_resource {
   struct pipe_resource base;
   uint32_t id;
   int fmt;
   uint8_t *shadow;                  /* buffers: guest copy (maps return it; writes are sent on unmap) */
   struct sw_displaytarget *dt;      /* window-system image for present */
   unsigned dt_stride;
};
static inline struct bbgpu_resource *bbgpu_resource(struct pipe_resource *r) { return (struct bbgpu_resource *)r; }

/* a shader keeps its TGSI; GLSL is generated per (VS, FS) program because GLSL ES needs the two stages'
 * varyings to match exactly (names, interpolation qualifiers) */
struct bbgpu_shader {
   enum pipe_shader_type stage;
   struct tgsi_token *tokens;
   struct tgsi_shader_info info;
   unsigned const_vec4s;            /* constants the shader reads */
   uint32_t serial;
};

struct bbgpu_vertex_elements {
   unsigned n;
   struct { unsigned buffer, offset, size, type, norm, divisor, stride; } e[16];
};

struct bbgpu_sampler { unsigned min_filter, mag_filter, wrap_s, wrap_t, compare; float lod_bias; };

struct bbgpu_context {
   struct pipe_context base;
   struct bbgpu_screen *bs;
   struct bbgpu_dev *dev;
   /* state */
   struct pipe_framebuffer_state fb;
   struct pipe_viewport_state vp;
   struct pipe_scissor_state scissor;
   const struct pipe_blend_state *blend;
   const struct pipe_depth_stencil_alpha_state *dsa;
   const struct pipe_rasterizer_state *rast;
   struct pipe_blend_color blend_color;
   struct pipe_stencil_ref stencil_ref;
   struct bbgpu_shader *vs, *fs;
   struct bbgpu_vertex_elements *ve;
   struct pipe_vertex_buffer vb[16];
   unsigned num_vb;
   float consts[2][256][4];
   unsigned const_bytes[2];
   struct pipe_sampler_view *views[16];
   struct bbgpu_sampler *samplers[16];
   unsigned num_views;
   unsigned dirty;
   struct hash_table *programs;     /* (vs serial, fs serial) -> program id */
   uint32_t cur_program;
   /* stream buffer for user index data */
   struct pipe_resource *index_stream;
   unsigned index_stream_off;
   uint64_t draws;
};
static inline struct bbgpu_context *bbgpu_context(struct pipe_context *c) { return (struct bbgpu_context *)c; }

enum {
   BBGPU_DIRTY_FB = 1 << 0, BBGPU_DIRTY_VIEWPORT = 1 << 1, BBGPU_DIRTY_SCISSOR = 1 << 2, BBGPU_DIRTY_BLEND = 1 << 3,
   BBGPU_DIRTY_DSA = 1 << 4, BBGPU_DIRTY_RAST = 1 << 5, BBGPU_DIRTY_PROGRAM = 1 << 6, BBGPU_DIRTY_VERTEX = 1 << 7,
   BBGPU_DIRTY_CONST_VS = 1 << 8, BBGPU_DIRTY_CONST_FS = 1 << 9, BBGPU_DIRTY_TEXTURES = 1 << 10,
   BBGPU_DIRTY_ALL = 0x7ff,
};

struct pipe_context *bbgpu_context_create(struct pipe_screen *screen, void *priv, unsigned flags);
struct pipe_fence_handle *bbgpu_fence_create(uint32_t id);
int bbgpu_format(enum pipe_format f);
bool bbgpu_vertex_format(enum pipe_format f, unsigned *size, unsigned *type, unsigned *norm);
/* GLSL ES 3.00 for one stage of a (vs, fs) pair; returns malloc'ed source or NULL */
char *bbgpu_glsl(const struct bbgpu_shader *sh, const struct bbgpu_shader *other);
void bbgpu_upload(struct bbgpu_dev *dev, uint32_t res, unsigned level, unsigned x, unsigned y, unsigned w,
                  unsigned h, const uint8_t *src, unsigned src_stride, unsigned bpp, bool buffer);

#endif
