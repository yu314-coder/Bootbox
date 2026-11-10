/* bbgpu_context.c - Bootbox GPU bridge Gallium driver: context (state, transfers, shaders, draws).
 * Everything is sent to the host renderer as protocol v1 commands (bbgpu_proto.h); state is emitted
 * lazily at draw time from dirty bits. SPDX-License-Identifier: MIT */
#include <math.h>
#include <stdio.h>
#include <GLES3/gl3.h>
#include "pipe/p_defines.h"
#include "util/u_inlines.h"
#include "util/u_memory.h"
#include "util/u_transfer.h"
#include "util/u_framebuffer.h"
#include "util/u_upload_mgr.h"
#include "util/format/u_format.h"
#include "util/hash_table.h"
#include "tgsi/tgsi_dump.h"
#include "tgsi/tgsi_parse.h"
#include "nir/nir_to_tgsi.h"
#include "bbgpu_context.h"

#define INDEX_STREAM_SIZE (1u << 20)

/* ---------------- uploads through the heap ---------------- */
void bbgpu_upload(struct bbgpu_dev *dev, uint32_t res, unsigned level, unsigned x, unsigned y, unsigned w,
                  unsigned h, const uint8_t *src, unsigned src_stride, unsigned bpp, bool buffer)
{
   if (buffer) {                                /* x = byte offset, w = bytes */
      unsigned max = dev->heap_size / 4;
      for (unsigned done = 0; done < w; ) {
         unsigned n = MIN2(max, w - done);
         uint32_t off = bbgpu_heap_alloc(dev, n);
         memcpy(dev->heap + off, src + done, n);
         BBGPU_CMD(dev, BBGPU_OP_RES_WRITE, res, 0, x + done, 0, 0, n, 1, 1, off, 0, 0);
         done += n;
         dev->stat_bytes_up += n;
      }
      return;
   }
   unsigned row = w * bpp, max_rows = MAX2(1u, (dev->heap_size / 4) / MAX2(row, 1u));
   for (unsigned r = 0; r < h; r += max_rows) {
      unsigned n = MIN2(max_rows, h - r);
      uint32_t off = bbgpu_heap_alloc(dev, n * row);
      for (unsigned i = 0; i < n; i++)
         memcpy(dev->heap + off + (size_t)i * row, src + (size_t)(r + i) * src_stride, row);
      BBGPU_CMD(dev, BBGPU_OP_RES_WRITE, res, level, x, y + r, 0, w, n, 1, off, row, 0);
      dev->stat_bytes_up += n * row;
   }
}

/* ---------------- GL enum mapping ---------------- */
static unsigned gl_blendfactor(unsigned f)
{
   switch (f) {
   case PIPE_BLENDFACTOR_ONE: return GL_ONE;
   case PIPE_BLENDFACTOR_SRC_COLOR: return GL_SRC_COLOR;
   case PIPE_BLENDFACTOR_SRC_ALPHA: return GL_SRC_ALPHA;
   case PIPE_BLENDFACTOR_DST_ALPHA: return GL_DST_ALPHA;
   case PIPE_BLENDFACTOR_DST_COLOR: return GL_DST_COLOR;
   case PIPE_BLENDFACTOR_SRC_ALPHA_SATURATE: return GL_SRC_ALPHA_SATURATE;
   case PIPE_BLENDFACTOR_CONST_COLOR: return GL_CONSTANT_COLOR;
   case PIPE_BLENDFACTOR_CONST_ALPHA: return GL_CONSTANT_ALPHA;
   case PIPE_BLENDFACTOR_INV_SRC_COLOR: return GL_ONE_MINUS_SRC_COLOR;
   case PIPE_BLENDFACTOR_INV_SRC_ALPHA: return GL_ONE_MINUS_SRC_ALPHA;
   case PIPE_BLENDFACTOR_INV_DST_ALPHA: return GL_ONE_MINUS_DST_ALPHA;
   case PIPE_BLENDFACTOR_INV_DST_COLOR: return GL_ONE_MINUS_DST_COLOR;
   case PIPE_BLENDFACTOR_INV_CONST_COLOR: return GL_ONE_MINUS_CONSTANT_COLOR;
   case PIPE_BLENDFACTOR_INV_CONST_ALPHA: return GL_ONE_MINUS_CONSTANT_ALPHA;
   default: return GL_ZERO;
   }
}
static unsigned gl_blendfunc(unsigned f)
{
   switch (f) {
   case PIPE_BLEND_SUBTRACT: return GL_FUNC_SUBTRACT;
   case PIPE_BLEND_REVERSE_SUBTRACT: return GL_FUNC_REVERSE_SUBTRACT;
   case PIPE_BLEND_MIN: return GL_MIN;
   case PIPE_BLEND_MAX: return GL_MAX;
   default: return GL_FUNC_ADD;
   }
}
static unsigned gl_stencil_op(unsigned op)
{
   static const unsigned map[] = { GL_KEEP, GL_ZERO, GL_REPLACE, GL_INCR, GL_DECR, GL_INCR_WRAP, GL_DECR_WRAP, GL_INVERT };
   return op < 8 ? map[op] : GL_KEEP;
}
static unsigned gl_wrap(unsigned w)
{
   switch (w) {
   case PIPE_TEX_WRAP_REPEAT: return GL_REPEAT;
   case PIPE_TEX_WRAP_MIRROR_REPEAT: return GL_MIRRORED_REPEAT;
   default: return GL_CLAMP_TO_EDGE;            /* WebGL2: no border clamp */
   }
}

/* ---------------- state objects ---------------- */
static void *create_blend(struct pipe_context *c, const struct pipe_blend_state *s) { return mem_dup(s, sizeof *s); }
static void bind_blend(struct pipe_context *c, void *s) { bbgpu_context(c)->blend = s; bbgpu_context(c)->dirty |= BBGPU_DIRTY_BLEND; }
static void *create_dsa(struct pipe_context *c, const struct pipe_depth_stencil_alpha_state *s) { return mem_dup(s, sizeof *s); }
static void bind_dsa(struct pipe_context *c, void *s) { bbgpu_context(c)->dsa = s; bbgpu_context(c)->dirty |= BBGPU_DIRTY_DSA; }
static void *create_rast(struct pipe_context *c, const struct pipe_rasterizer_state *s) { return mem_dup(s, sizeof *s); }
static void bind_rast(struct pipe_context *c, void *s) { bbgpu_context(c)->rast = s; bbgpu_context(c)->dirty |= BBGPU_DIRTY_RAST | BBGPU_DIRTY_SCISSOR; }
static void delete_state(struct pipe_context *c, void *s) { FREE(s); }

static void *create_sampler(struct pipe_context *c, const struct pipe_sampler_state *s)
{
   struct bbgpu_sampler *b = CALLOC_STRUCT(bbgpu_sampler);
   bool lin = s->min_img_filter == PIPE_TEX_FILTER_LINEAR;
   switch (s->min_mip_filter) {
   case PIPE_TEX_MIPFILTER_NEAREST: b->min_filter = lin ? GL_LINEAR_MIPMAP_NEAREST : GL_NEAREST_MIPMAP_NEAREST; break;
   case PIPE_TEX_MIPFILTER_LINEAR: b->min_filter = lin ? GL_LINEAR_MIPMAP_LINEAR : GL_NEAREST_MIPMAP_LINEAR; break;
   default: b->min_filter = lin ? GL_LINEAR : GL_NEAREST; break;
   }
   b->mag_filter = s->mag_img_filter == PIPE_TEX_FILTER_LINEAR ? GL_LINEAR : GL_NEAREST;
   b->wrap_s = gl_wrap(s->wrap_s);
   b->wrap_t = gl_wrap(s->wrap_t);
   return b;
}
static void bind_samplers(struct pipe_context *c, enum pipe_shader_type sh, unsigned start, unsigned n, void **s)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   if (sh != PIPE_SHADER_FRAGMENT)
      return;
   for (unsigned i = 0; i < n && start + i < 16; i++)
      ctx->samplers[start + i] = s ? s[i] : NULL;
   ctx->dirty |= BBGPU_DIRTY_TEXTURES;
}

static struct pipe_sampler_view *create_view(struct pipe_context *c, struct pipe_resource *tex, const struct pipe_sampler_view *t)
{
   struct pipe_sampler_view *v = CALLOC_STRUCT(pipe_sampler_view);
   *v = *t;
   v->texture = NULL;
   pipe_resource_reference(&v->texture, tex);
   pipe_reference_init(&v->reference, 1);
   v->context = c;
   return v;
}
static void view_destroy(struct pipe_context *c, struct pipe_sampler_view *v)
{
   pipe_resource_reference(&v->texture, NULL);
   FREE(v);
}
static void set_views(struct pipe_context *c, enum pipe_shader_type sh, unsigned start, unsigned n, unsigned unbind,
                      bool take_ownership, struct pipe_sampler_view **views)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   if (sh != PIPE_SHADER_FRAGMENT) {
      if (take_ownership && views)
         for (unsigned i = 0; i < n; i++) pipe_sampler_view_reference(&views[i], NULL);
      return;
   }
   for (unsigned i = 0; i < n + unbind && start + i < 16; i++) {
      struct pipe_sampler_view *v = i < n && views ? views[i] : NULL;
      if (take_ownership) {
         pipe_sampler_view_reference(&ctx->views[start + i], NULL);
         ctx->views[start + i] = v;
      } else {
         pipe_sampler_view_reference(&ctx->views[start + i], v);
      }
   }
   ctx->num_views = 0;
   for (unsigned i = 0; i < 16; i++) if (ctx->views[i]) ctx->num_views = i + 1;
   ctx->dirty |= BBGPU_DIRTY_TEXTURES;
}

static void *create_ve(struct pipe_context *c, unsigned n, const struct pipe_vertex_element *e)
{
   struct bbgpu_vertex_elements *v = CALLOC_STRUCT(bbgpu_vertex_elements);
   v->n = MIN2(n, 16u);
   for (unsigned i = 0; i < v->n; i++) {
      if (!bbgpu_vertex_format(e[i].src_format, &v->e[i].size, &v->e[i].type, &v->e[i].norm)) {
         fprintf(stderr, "bbgpu: unsupported vertex format %s\n", util_format_name(e[i].src_format));
         v->e[i].size = 4; v->e[i].type = GL_FLOAT;
      }
      v->e[i].buffer = e[i].vertex_buffer_index;
      v->e[i].offset = e[i].src_offset;
      v->e[i].divisor = e[i].instance_divisor;
      v->e[i].stride = e[i].src_stride;
   }
   return v;
}
static void bind_ve(struct pipe_context *c, void *v) { bbgpu_context(c)->ve = v; bbgpu_context(c)->dirty |= BBGPU_DIRTY_VERTEX; }

static void set_vertex_buffers(struct pipe_context *c, unsigned n, unsigned unbind, bool take_ownership,
                               const struct pipe_vertex_buffer *vb)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   for (unsigned i = 0; i < n + unbind && i < 16; i++) {
      pipe_vertex_buffer_unreference(&ctx->vb[i]);
      if (i < n && vb) {
         if (take_ownership) ctx->vb[i] = vb[i];
         else pipe_vertex_buffer_reference(&ctx->vb[i], &vb[i]);
      }
   }
   ctx->num_vb = MIN2(n, 16u);
   ctx->dirty |= BBGPU_DIRTY_VERTEX;
}

static void set_constant_buffer(struct pipe_context *c, enum pipe_shader_type sh, uint index, bool take_ownership,
                                const struct pipe_constant_buffer *cb)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   if (index != 0 || (sh != PIPE_SHADER_VERTEX && sh != PIPE_SHADER_FRAGMENT)) {
      if (take_ownership && cb) pipe_resource_reference((struct pipe_resource **)&cb->buffer, NULL);
      return;
   }
   int s = sh == PIPE_SHADER_VERTEX ? 0 : 1;
   if (cb) {
      const uint8_t *src = cb->user_buffer ? cb->user_buffer :
                           cb->buffer ? bbgpu_resource(cb->buffer)->shadow + cb->buffer_offset : NULL;
      unsigned bytes = MIN2(cb->buffer_size, (unsigned)sizeof ctx->consts[s]);
      if (src && bytes)
         memcpy(ctx->consts[s], src, bytes);
      ctx->const_bytes[s] = bytes;
      if (take_ownership && cb->buffer) pipe_resource_reference((struct pipe_resource **)&cb->buffer, NULL);
   } else {
      ctx->const_bytes[s] = 0;
   }
   ctx->dirty |= s ? BBGPU_DIRTY_CONST_FS : BBGPU_DIRTY_CONST_VS;
}

static void set_framebuffer(struct pipe_context *c, const struct pipe_framebuffer_state *fb)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   util_copy_framebuffer_state(&ctx->fb, fb);
   ctx->dirty |= BBGPU_DIRTY_FB | BBGPU_DIRTY_VIEWPORT;
}
static void set_viewports(struct pipe_context *c, unsigned start, unsigned n, const struct pipe_viewport_state *v)
{
   if (start == 0 && n) { bbgpu_context(c)->vp = v[0]; bbgpu_context(c)->dirty |= BBGPU_DIRTY_VIEWPORT; }
}
static void set_scissors(struct pipe_context *c, unsigned start, unsigned n, const struct pipe_scissor_state *s)
{
   if (start == 0 && n) { bbgpu_context(c)->scissor = s[0]; bbgpu_context(c)->dirty |= BBGPU_DIRTY_SCISSOR; }
}
static void set_blend_color(struct pipe_context *c, const struct pipe_blend_color *bc) { bbgpu_context(c)->blend_color = *bc; bbgpu_context(c)->dirty |= BBGPU_DIRTY_BLEND; }
static void set_stencil_ref(struct pipe_context *c, const struct pipe_stencil_ref ref) { bbgpu_context(c)->stencil_ref = ref; bbgpu_context(c)->dirty |= BBGPU_DIRTY_DSA; }
static void set_sample_mask(struct pipe_context *c, unsigned m) {}
static void set_min_samples(struct pipe_context *c, unsigned m) {}
static void set_clip_state(struct pipe_context *c, const struct pipe_clip_state *s) {}
static void set_polygon_stipple(struct pipe_context *c, const struct pipe_poly_stipple *s) {}
static void set_active_query_state(struct pipe_context *c, bool enable) {}

/* ---------------- shaders ---------------- */
static uint32_t shader_serial;
static void *create_shader(struct pipe_context *c, const struct pipe_shader_state *s, enum pipe_shader_type stage)
{
   struct bbgpu_shader *sh = CALLOC_STRUCT(bbgpu_shader);
   const struct tgsi_token *tokens;
   if (s->type == PIPE_SHADER_IR_NIR) {
      struct nir_to_tgsi_options opts = { .lower_fabs = true, .unoptimized_ra = true };
      tokens = nir_to_tgsi_options(s->ir.nir, c->screen, &opts);   /* takes ownership of the NIR */
      sh->tokens = (struct tgsi_token *)tokens;
   } else {
      sh->tokens = tgsi_dup_tokens(s->tokens);
   }
   sh->stage = stage;
   tgsi_scan_shader(sh->tokens, &sh->info);
   sh->const_vec4s = sh->info.file_max[TGSI_FILE_CONSTANT] + 1;
   sh->serial = ++shader_serial;
   if (getenv("BBGPU_DUMP"))
      tgsi_dump(sh->tokens, 0);
   return sh;
}
static void *create_vs(struct pipe_context *c, const struct pipe_shader_state *s) { return create_shader(c, s, PIPE_SHADER_VERTEX); }
static void *create_fs(struct pipe_context *c, const struct pipe_shader_state *s) { return create_shader(c, s, PIPE_SHADER_FRAGMENT); }
static void bind_vs(struct pipe_context *c, void *s) { bbgpu_context(c)->vs = s; bbgpu_context(c)->dirty |= BBGPU_DIRTY_PROGRAM | BBGPU_DIRTY_CONST_VS; }
static void bind_fs(struct pipe_context *c, void *s) { bbgpu_context(c)->fs = s; bbgpu_context(c)->dirty |= BBGPU_DIRTY_PROGRAM | BBGPU_DIRTY_CONST_FS; }
static void delete_shader(struct pipe_context *c, void *s)
{
   struct bbgpu_shader *sh = s;
   FREE(sh->tokens);   /* programs that used it stay in the cache (keyed by serial; never reused) */
   FREE(sh);
}

static uint32_t upload_glsl(struct bbgpu_dev *dev, uint32_t id, unsigned stage, const char *src)
{
   unsigned len = strlen(src);
   uint32_t off = bbgpu_heap_alloc(dev, len + 1);
   memcpy(dev->heap + off, src, len + 1);
   BBGPU_CMD(dev, BBGPU_OP_SHADER_CREATE, id, stage, off, len);
   if (getenv("BBGPU_SYNC_SHADERS") && getenv("BBGPU_VERBOSE"))
      fprintf(stderr, "bbgpu: SHADER_CREATE id %u at heap %u len %u (head %u tail %u)\n", id, off, len, dev->heap_head, dev->heap_tail);
   if (getenv("BBGPU_SYNC_SHADERS")) {
      bbgpu_fence_wait(dev, bbgpu_dev_flush(dev));
      if (memcmp(dev->heap + off, src, len))
         fprintf(stderr, "bbgpu: shader text at heap %u (len %u) CHANGED before the host compiled it (head %u tail %u chunks %u)\n",
                 off, len, dev->heap_head, dev->heap_tail, dev->nchunks);
      else if (bbgpu_dev_error(dev))
         fprintf(stderr, "bbgpu: shader text at heap %u intact but the host failed (err %u)\n", off, bbgpu_dev_error(dev));
   }
   return id;
}

static uint32_t get_program(struct bbgpu_context *ctx)
{
   uint64_t key = ((uint64_t)ctx->vs->serial << 32) | ctx->fs->serial;
   struct hash_entry *e = _mesa_hash_table_search(ctx->programs, (void *)(uintptr_t)key);
   if (e)
      return (uint32_t)(uintptr_t)e->data;
   char *vsrc = bbgpu_glsl(ctx->vs, ctx->fs), *fsrc = bbgpu_glsl(ctx->fs, ctx->vs);
   uint32_t pid = 0;
   if (vsrc && fsrc) {
      uint32_t v = upload_glsl(ctx->dev, bbgpu_new_id(ctx->dev), BBGPU_STAGE_VS, vsrc);
      uint32_t f = upload_glsl(ctx->dev, bbgpu_new_id(ctx->dev), BBGPU_STAGE_FS, fsrc);
      pid = bbgpu_new_id(ctx->dev);
      BBGPU_CMD(ctx->dev, BBGPU_OP_PROGRAM_CREATE, pid, v, f);
      if (getenv("BBGPU_DUMP"))
         fprintf(stderr, "---- bbgpu VS ----\n%s---- bbgpu FS ----\n%s", vsrc, fsrc);
   } else {
      fprintf(stderr, "bbgpu: shader translation failed\n");
      tgsi_dump(vsrc ? ctx->fs->tokens : ctx->vs->tokens, 0);
   }
   free(vsrc);
   free(fsrc);
   _mesa_hash_table_insert(ctx->programs, (void *)(uintptr_t)key, (void *)(uintptr_t)pid);
   return pid;
}

/* ---------------- surfaces ---------------- */
static struct pipe_surface *create_surface(struct pipe_context *c, struct pipe_resource *tex, const struct pipe_surface *t)
{
   struct pipe_surface *s = CALLOC_STRUCT(pipe_surface);
   pipe_reference_init(&s->reference, 1);
   pipe_resource_reference(&s->texture, tex);
   s->context = c;
   s->format = t->format;
   s->u.tex.level = t->u.tex.level;
   s->width = u_minify(tex->width0, t->u.tex.level);
   s->height = u_minify(tex->height0, t->u.tex.level);
   return s;
}
static void surface_destroy(struct pipe_context *c, struct pipe_surface *s)
{
   pipe_resource_reference(&s->texture, NULL);
   FREE(s);
}

/* ---------------- transfers ---------------- */
struct bbgpu_transfer { struct pipe_transfer base; uint8_t *staging; };

static void *buffer_map(struct pipe_context *c, struct pipe_resource *res, unsigned level, unsigned usage,
                        const struct pipe_box *box, struct pipe_transfer **out)
{
   struct bbgpu_transfer *t = CALLOC_STRUCT(bbgpu_transfer);
   pipe_resource_reference(&t->base.resource, res);
   t->base.level = level;
   t->base.usage = usage;
   t->base.box = *box;
   *out = &t->base;
   return bbgpu_resource(res)->shadow + box->x;     /* buffers are only written by the CPU: the copy is current */
}
static void buffer_unmap(struct pipe_context *c, struct pipe_transfer *pt)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   struct bbgpu_resource *r = bbgpu_resource(pt->resource);
   if ((pt->usage & PIPE_MAP_WRITE) && !(pt->usage & PIPE_MAP_FLUSH_EXPLICIT))
      bbgpu_upload(ctx->dev, r->id, 0, pt->box.x, 0, pt->box.width, 1, r->shadow + pt->box.x, 0, 1, true);
   pipe_resource_reference(&pt->resource, NULL);
   FREE(pt);
}
static void transfer_flush_region(struct pipe_context *c, struct pipe_transfer *pt, const struct pipe_box *box)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   struct bbgpu_resource *r = bbgpu_resource(pt->resource);
   if (pt->resource->target == PIPE_BUFFER) {
      unsigned x = pt->box.x + box->x;
      bbgpu_upload(ctx->dev, r->id, 0, x, 0, box->width, 1, r->shadow + x, 0, 1, true);
   }
}

static void *texture_map(struct pipe_context *c, struct pipe_resource *res, unsigned level, unsigned usage,
                         const struct pipe_box *box, struct pipe_transfer **out)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   struct bbgpu_resource *r = bbgpu_resource(res);
   struct bbgpu_transfer *t = CALLOC_STRUCT(bbgpu_transfer);
   unsigned bpp = util_format_get_blocksize(res->format);
   pipe_resource_reference(&t->base.resource, res);
   t->base.level = level;
   t->base.usage = usage;
   t->base.box = *box;
   t->base.stride = box->width * bpp;
   t->base.layer_stride = t->base.stride * box->height;
   t->staging = CALLOC(1, t->base.layer_stride ? t->base.layer_stride : 1);
   if ((usage & PIPE_MAP_READ) && !(usage & PIPE_MAP_DISCARD_WHOLE_RESOURCE) && bpp == 4 &&
       !util_format_is_depth_or_stencil(res->format)) {
      unsigned row = box->width * 4, max_rows = MAX2(1u, (ctx->dev->heap_size / 4) / row);
      for (int y = 0; y < box->height; y += max_rows) {
         unsigned n = MIN2(max_rows, (unsigned)(box->height - y));
         uint32_t off = bbgpu_heap_alloc(ctx->dev, n * row);
         BBGPU_CMD(ctx->dev, BBGPU_OP_RES_READ, r->id, level, box->x, box->y + y, box->width, n, off, row);
         bbgpu_fence_wait(ctx->dev, bbgpu_dev_flush(ctx->dev));
         memcpy(t->staging + (size_t)y * row, ctx->dev->heap + off, (size_t)n * row);
         ctx->dev->stat_bytes_down += n * row;
      }
   }
   *out = &t->base;
   return t->staging;
}
static void texture_unmap(struct pipe_context *c, struct pipe_transfer *pt)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   struct bbgpu_transfer *t = (struct bbgpu_transfer *)pt;
   struct bbgpu_resource *r = bbgpu_resource(pt->resource);
   if (pt->usage & PIPE_MAP_WRITE)
      bbgpu_upload(ctx->dev, r->id, pt->level, pt->box.x, pt->box.y, pt->box.width, pt->box.height, t->staging,
                   pt->stride, util_format_get_blocksize(pt->resource->format), false);
   FREE(t->staging);
   pipe_resource_reference(&pt->resource, NULL);
   FREE(t);
}

/* ---------------- copies ---------------- */
static void resource_copy_region(struct pipe_context *c, struct pipe_resource *dst, unsigned dst_level, unsigned dx,
                                 unsigned dy, unsigned dz, struct pipe_resource *src, unsigned src_level,
                                 const struct pipe_box *b)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   if (dst->target == PIPE_BUFFER && src->target == PIPE_BUFFER) {
      struct bbgpu_resource *d = bbgpu_resource(dst);
      memmove(d->shadow + dx, bbgpu_resource(src)->shadow + b->x, b->width);
      bbgpu_upload(ctx->dev, d->id, 0, dx, 0, b->width, 1, d->shadow + dx, 0, 1, true);
      return;
   }
   BBGPU_CMD(ctx->dev, BBGPU_OP_COPY_RES, bbgpu_resource(dst)->id, dst_level, bbgpu_resource(src)->id, src_level,
             b->x, b->y, b->x + b->width, b->y + b->height, dx, dy, dx + b->width, dy + b->height, 0);
}
static void blit(struct pipe_context *c, const struct pipe_blit_info *info)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   const struct pipe_box *s = &info->src.box, *d = &info->dst.box;
   /* blitFramebuffer takes signed rectangles: flips and scaling come for free */
   BBGPU_CMD(ctx->dev, BBGPU_OP_COPY_RES, bbgpu_resource(info->dst.resource)->id, info->dst.level,
             bbgpu_resource(info->src.resource)->id, info->src.level, s->x, s->y, s->x + s->width, s->y + s->height,
             d->x, d->y, d->x + d->width, d->y + d->height, info->filter == PIPE_TEX_FILTER_LINEAR);
}
static void flush_resource(struct pipe_context *c, struct pipe_resource *r) {}

/* ---------------- emit state ---------------- */
static void emit_state(struct bbgpu_context *ctx)
{
   struct bbgpu_dev *d = ctx->dev;
   unsigned dirty = ctx->dirty;
   if (dirty & BBGPU_DIRTY_FB) {
      uint32_t p[2 + 8];
      unsigned n = MIN2(ctx->fb.nr_cbufs, 8u);
      p[0] = n;
      p[1] = ctx->fb.zsbuf ? bbgpu_resource(ctx->fb.zsbuf->texture)->id : 0;
      for (unsigned i = 0; i < n; i++)
         p[2 + i] = ctx->fb.cbufs[i] ? bbgpu_resource(ctx->fb.cbufs[i]->texture)->id : 0;
      bbgpu_cmd(d, BBGPU_OP_SET_FRAMEBUFFER, p, 2 + n);
   }
   if (dirty & BBGPU_DIRTY_VIEWPORT) {
      const struct pipe_viewport_state *v = &ctx->vp;
      float sy = fabsf(v->scale[1]);
      BBGPU_CMD(d, BBGPU_OP_SET_VIEWPORT, bbgpu_f2u(v->translate[0] - v->scale[0]), bbgpu_f2u(v->translate[1] - sy),
                bbgpu_f2u(2 * v->scale[0]), bbgpu_f2u(2 * sy), bbgpu_f2u(v->translate[2] - v->scale[2]),
                bbgpu_f2u(v->translate[2] + v->scale[2]), v->scale[1] < 0);
   }
   if (dirty & BBGPU_DIRTY_SCISSOR) {
      const struct pipe_scissor_state *s = &ctx->scissor;
      bool on = ctx->rast && ctx->rast->scissor;
      BBGPU_CMD(d, BBGPU_OP_SET_SCISSOR, on, s->minx, s->miny, s->maxx - s->minx, s->maxy - s->miny);
   }
   if ((dirty & BBGPU_DIRTY_BLEND) && ctx->blend) {
      const struct pipe_rt_blend_state *b = &ctx->blend->rt[0];
      const float *k = ctx->blend_color.color;
      BBGPU_CMD(d, BBGPU_OP_SET_BLEND, b->blend_enable, gl_blendfunc(b->rgb_func), gl_blendfactor(b->rgb_src_factor),
                gl_blendfactor(b->rgb_dst_factor), gl_blendfunc(b->alpha_func), gl_blendfactor(b->alpha_src_factor),
                gl_blendfactor(b->alpha_dst_factor), b->colormask, bbgpu_f2u(k[0]), bbgpu_f2u(k[1]), bbgpu_f2u(k[2]),
                bbgpu_f2u(k[3]));
   }
   if ((dirty & BBGPU_DIRTY_DSA) && ctx->dsa) {
      const struct pipe_depth_stencil_alpha_state *z = ctx->dsa;
      const struct pipe_stencil_state *s = &z->stencil[0];
      BBGPU_CMD(d, BBGPU_OP_SET_DEPTH_STENCIL, z->depth_enabled, z->depth_writemask, GL_NEVER + z->depth_func,
                s->enabled, GL_NEVER + s->func, ctx->stencil_ref.ref_value[0], s->valuemask, gl_stencil_op(s->fail_op),
                gl_stencil_op(s->zfail_op), gl_stencil_op(s->zpass_op), s->writemask);
   }
   if ((dirty & BBGPU_DIRTY_RAST) && ctx->rast) {
      const struct pipe_rasterizer_state *r = ctx->rast;
      unsigned cull = r->cull_face == PIPE_FACE_FRONT ? GL_FRONT : r->cull_face == PIPE_FACE_BACK ? GL_BACK :
                      r->cull_face == PIPE_FACE_FRONT_AND_BACK ? GL_FRONT_AND_BACK : 0;
      BBGPU_CMD(d, BBGPU_OP_SET_RASTER, cull, r->front_ccw, r->offset_tri, bbgpu_f2u(r->offset_scale),
                bbgpu_f2u(r->offset_units * 2.0f));
   }
   if ((dirty & BBGPU_DIRTY_PROGRAM) && ctx->vs && ctx->fs) {
      ctx->cur_program = get_program(ctx);
      if (ctx->cur_program)
         BBGPU_CMD(d, BBGPU_OP_USE_PROGRAM, ctx->cur_program);
      dirty |= BBGPU_DIRTY_CONST_VS | BBGPU_DIRTY_CONST_FS;
   }
   for (int s = 0; s < 2; s++) {
      struct bbgpu_shader *sh = s ? ctx->fs : ctx->vs;
      if (!(dirty & (s ? BBGPU_DIRTY_CONST_FS : BBGPU_DIRTY_CONST_VS)) || !sh)
         continue;
      unsigned n = MIN2(sh->const_vec4s, MIN2(256u, ctx->const_bytes[s] / 16));
      if (!n)
         continue;
      uint32_t *p = MALLOC((3 + n * 4) * 4);
      p[0] = s ? BBGPU_STAGE_FS : BBGPU_STAGE_VS; p[1] = 0; p[2] = n;
      memcpy(p + 3, ctx->consts[s], n * 16);
      bbgpu_cmd(d, BBGPU_OP_SET_UNIFORMS, p, 3 + n * 4);
      FREE(p);
   }
   if ((dirty & BBGPU_DIRTY_VERTEX) && ctx->ve) {
      uint32_t p[1 + 16 * 7], q[1 + 16 * 3];
      unsigned stride[16] = { 0 };
      p[0] = ctx->ve->n;
      for (unsigned i = 0; i < ctx->ve->n; i++) {
         const __typeof__(ctx->ve->e[0]) *e = &ctx->ve->e[i];
         uint32_t *x = p + 1 + i * 7;
         x[0] = e->buffer; x[1] = e->offset; x[2] = e->size; x[3] = e->type; x[4] = e->norm; x[5] = 0; x[6] = e->divisor;
         if (e->buffer < 16) stride[e->buffer] = e->stride;
      }
      bbgpu_cmd(d, BBGPU_OP_SET_VERTEX_ELEMENTS, p, 1 + ctx->ve->n * 7);
      q[0] = ctx->num_vb;
      for (unsigned i = 0; i < ctx->num_vb; i++) {
         struct pipe_resource *res = ctx->vb[i].is_user_buffer ? NULL : ctx->vb[i].buffer.resource;
         q[1 + i * 3] = res ? bbgpu_resource(res)->id : 0;
         q[2 + i * 3] = stride[i];
         q[3 + i * 3] = ctx->vb[i].buffer_offset;
      }
      bbgpu_cmd(d, BBGPU_OP_SET_VERTEX_BUFFERS, q, 1 + ctx->num_vb * 3);
   }
   if (dirty & BBGPU_DIRTY_TEXTURES) {
      uint32_t p[2 + 16 * 6];
      unsigned n = ctx->num_views;
      p[0] = 0; p[1] = n;
      for (unsigned i = 0; i < n; i++) {
         struct pipe_sampler_view *v = ctx->views[i];
         struct bbgpu_sampler *s = ctx->samplers[i];
         uint32_t *x = p + 2 + i * 6;
         x[0] = v && v->texture ? bbgpu_resource(v->texture)->id : 0;
         x[1] = s ? s->min_filter : GL_NEAREST; x[2] = s ? s->mag_filter : GL_NEAREST;
         x[3] = s ? s->wrap_s : GL_CLAMP_TO_EDGE; x[4] = s ? s->wrap_t : GL_CLAMP_TO_EDGE; x[5] = 0x03020100;
      }
      bbgpu_cmd(d, BBGPU_OP_SET_TEXTURES, p, 2 + n * 6);
   }
   ctx->dirty = 0;
}

/* ---------------- draw / clear / flush ---------------- */
static void draw_vbo(struct pipe_context *c, const struct pipe_draw_info *info, unsigned drawid_offset,
                     const struct pipe_draw_indirect_info *indirect, const struct pipe_draw_start_count_bias *draws,
                     unsigned num_draws)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   if (indirect || !ctx->vs || !ctx->fs)
      return;
   emit_state(ctx);
   if (!ctx->cur_program)
      return;
   for (unsigned k = 0; k < num_draws; k++) {
      unsigned start = draws[k].start, count = draws[k].count;
      if (!count)
         continue;
      if (info->index_size) {
         uint32_t ib, off = 0;
         if (info->has_user_indices) {
            unsigned bytes = count * info->index_size;
            if (ctx->index_stream_off + bytes > INDEX_STREAM_SIZE)
               ctx->index_stream_off = 0;   /* earlier draws already read their indices when executed in order */
            off = ctx->index_stream_off;
            bbgpu_upload(ctx->dev, bbgpu_resource(ctx->index_stream)->id, 0, off, 0, bytes, 1,
                         (const uint8_t *)info->index.user + start * info->index_size, 0, 1, true);
            ctx->index_stream_off = (off + bytes + 15) & ~15u;
            ib = bbgpu_resource(ctx->index_stream)->id;
            start = 0;
         } else {
            ib = bbgpu_resource(info->index.resource)->id;
         }
         BBGPU_CMD(ctx->dev, BBGPU_OP_SET_INDEX_BUFFER, ib, info->index_size, off);
      }
      BBGPU_CMD(ctx->dev, BBGPU_OP_DRAW, info->mode, start, count, MAX2(info->instance_count, 1u),
                (uint32_t)(info->index_size ? draws[k].index_bias : 0), info->index_size != 0);
      ctx->draws++;
   }
}

static void clear(struct pipe_context *c, unsigned buffers, const struct pipe_scissor_state *ss,
                  const union pipe_color_union *color, double depth, unsigned stencil)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   emit_state(ctx);
   unsigned bits = (buffers & PIPE_CLEAR_COLOR ? GL_COLOR_BUFFER_BIT : 0) | (buffers & PIPE_CLEAR_DEPTH ? GL_DEPTH_BUFFER_BIT : 0) |
                   (buffers & PIPE_CLEAR_STENCIL ? GL_STENCIL_BUFFER_BIT : 0);
   if (ss)
      BBGPU_CMD(ctx->dev, BBGPU_OP_SET_SCISSOR, 1, ss->minx, ss->miny, ss->maxx - ss->minx, ss->maxy - ss->miny);
   else if (ctx->rast && ctx->rast->scissor)
      BBGPU_CMD(ctx->dev, BBGPU_OP_SET_SCISSOR, 0, 0, 0, 0, 0);
   /* clears ignore the colour/depth write masks of the bound state in Gallium: open them */
   BBGPU_CMD(ctx->dev, BBGPU_OP_SET_BLEND, 0, GL_FUNC_ADD, GL_ONE, GL_ZERO, GL_FUNC_ADD, GL_ONE, GL_ZERO, 15, 0, 0, 0, 0);
   BBGPU_CMD(ctx->dev, BBGPU_OP_SET_DEPTH_STENCIL, 0, 1, GL_ALWAYS, 0, GL_ALWAYS, 0, 0xff, GL_KEEP, GL_KEEP, GL_KEEP, 0xff);
   BBGPU_CMD(ctx->dev, BBGPU_OP_CLEAR, bits, bbgpu_f2u(color->f[0]), bbgpu_f2u(color->f[1]), bbgpu_f2u(color->f[2]),
             bbgpu_f2u(color->f[3]), bbgpu_f2u((float)depth), stencil);
   ctx->dirty |= BBGPU_DIRTY_BLEND | BBGPU_DIRTY_DSA | BBGPU_DIRTY_SCISSOR;
}

static void flush(struct pipe_context *c, struct pipe_fence_handle **fence, unsigned flags)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   uint32_t id = bbgpu_dev_flush(ctx->dev);
   if (fence)
      c->screen->fence_reference(c->screen, fence, NULL), *fence = bbgpu_fence_create(id);
}

static void destroy(struct pipe_context *c)
{
   struct bbgpu_context *ctx = bbgpu_context(c);
   for (unsigned i = 0; i < 16; i++) {
      pipe_sampler_view_reference(&ctx->views[i], NULL);
      pipe_vertex_buffer_unreference(&ctx->vb[i]);
   }
   util_unreference_framebuffer_state(&ctx->fb);
   pipe_resource_reference(&ctx->index_stream, NULL);
   if (c->stream_uploader)
      u_upload_destroy(c->stream_uploader);
   _mesa_hash_table_destroy(ctx->programs, NULL);
   if (getenv("BBGPU_STATS"))
      fprintf(stderr, "bbgpu: %llu draws, %llu commands, %llu KB up, %llu KB down\n", (unsigned long long)ctx->draws,
              (unsigned long long)ctx->dev->stat_cmds, (unsigned long long)ctx->dev->stat_bytes_up >> 10,
              (unsigned long long)ctx->dev->stat_bytes_down >> 10);
   FREE(ctx);
}

static uint32_t hash_u64(const void *key) { uint64_t k = (uintptr_t)key; return (uint32_t)(k ^ (k >> 29) ^ (k >> 47)); }
static bool eq_u64(const void *a, const void *b) { return a == b; }

struct pipe_context *bbgpu_context_create(struct pipe_screen *screen, void *priv, unsigned flags)
{
   struct bbgpu_context *ctx = CALLOC_STRUCT(bbgpu_context);
   struct pipe_context *c = &ctx->base;
   ctx->bs = bbgpu_screen(screen);
   ctx->dev = ctx->bs->dev;
   c->screen = screen;
   c->priv = priv;
   c->destroy = destroy;
   c->draw_vbo = draw_vbo;
   c->clear = clear;
   c->flush = flush;
   c->create_blend_state = create_blend; c->bind_blend_state = bind_blend; c->delete_blend_state = delete_state;
   c->create_depth_stencil_alpha_state = create_dsa; c->bind_depth_stencil_alpha_state = bind_dsa;
   c->delete_depth_stencil_alpha_state = delete_state;
   c->create_rasterizer_state = create_rast; c->bind_rasterizer_state = bind_rast; c->delete_rasterizer_state = delete_state;
   c->create_sampler_state = create_sampler; c->bind_sampler_states = bind_samplers; c->delete_sampler_state = delete_state;
   c->create_sampler_view = create_view; c->sampler_view_destroy = view_destroy; c->set_sampler_views = set_views;
   c->create_vertex_elements_state = create_ve; c->bind_vertex_elements_state = bind_ve;
   c->delete_vertex_elements_state = delete_state;
   c->create_vs_state = create_vs; c->bind_vs_state = bind_vs; c->delete_vs_state = delete_shader;
   c->create_fs_state = create_fs; c->bind_fs_state = bind_fs; c->delete_fs_state = delete_shader;
   c->set_vertex_buffers = set_vertex_buffers;
   c->set_constant_buffer = set_constant_buffer;
   c->set_framebuffer_state = set_framebuffer;
   c->set_viewport_states = set_viewports;
   c->set_scissor_states = set_scissors;
   c->set_blend_color = set_blend_color;
   c->set_stencil_ref = set_stencil_ref;
   c->set_sample_mask = set_sample_mask;
   c->set_min_samples = set_min_samples;
   c->set_clip_state = set_clip_state;
   c->set_polygon_stipple = set_polygon_stipple;
   c->set_active_query_state = set_active_query_state;
   c->create_surface = create_surface; c->surface_destroy = surface_destroy;
   c->buffer_map = buffer_map; c->buffer_unmap = buffer_unmap;
   c->texture_map = texture_map; c->texture_unmap = texture_unmap;
   c->transfer_flush_region = transfer_flush_region;
   c->buffer_subdata = u_default_buffer_subdata;
   c->texture_subdata = u_default_texture_subdata;
   c->resource_copy_region = resource_copy_region;
   c->blit = blit;
   c->flush_resource = flush_resource;
   c->stream_uploader = u_upload_create_default(c);
   c->const_uploader = c->stream_uploader;
   ctx->programs = _mesa_hash_table_create(NULL, hash_u64, eq_u64);
   struct pipe_resource t = { .target = PIPE_BUFFER, .format = PIPE_FORMAT_R8_UNORM, .width0 = INDEX_STREAM_SIZE,
                              .height0 = 1, .depth0 = 1, .array_size = 1, .bind = PIPE_BIND_INDEX_BUFFER };
   ctx->index_stream = screen->resource_create(screen, &t);
   ctx->dirty = BBGPU_DIRTY_ALL;
   return c;
}
