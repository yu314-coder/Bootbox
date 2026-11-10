/* bbgpu_screen.c - Bootbox GPU bridge Gallium driver: screen (capabilities, formats, resources, fences,
 * present). Capabilities are exactly what the host renderer can do on WebGL2 (GLES 3.0): OpenGL 2.1 /
 * GLSL 1.20 class with float-only shaders, so Mesa's GL front end lowers everything else (quads, user
 * clip planes, alpha test, two-sided colour, flat shading of legacy paths ...). SPDX-License-Identifier: MIT */
#include "pipe/p_defines.h"
#include "pipe/p_screen.h"
#include "util/u_inlines.h"
#include "util/u_memory.h"
#include "util/u_screen.h"
#include "util/format/u_format.h"
#include "frontend/sw_winsys.h"
#include "nir/nir_to_tgsi.h"
#include "bbgpu_context.h"
#include "bbgpu_public.h"

static const char *bbgpu_get_name(struct pipe_screen *s) { return "Bootbox GPU (WebGL2)"; }
static const char *bbgpu_get_vendor(struct pipe_screen *s) { return "Bootbox"; }

static int bbgpu_get_param(struct pipe_screen *screen, enum pipe_cap param)
{
   switch (param) {
   case PIPE_CAP_NPOT_TEXTURES:
   case PIPE_CAP_BLEND_EQUATION_SEPARATE:
   case PIPE_CAP_FS_COORD_ORIGIN_UPPER_LEFT:     /* GL row 0 = memory row 0 = Gallium's top row */
   case PIPE_CAP_FS_COORD_PIXEL_CENTER_HALF_INTEGER:
   case PIPE_CAP_MIXED_COLORBUFFER_FORMATS:
   case PIPE_CAP_VERTEX_COLOR_UNCLAMPED:
   case PIPE_CAP_TEXTURE_MIRROR_CLAMP_TO_EDGE:
   case PIPE_CAP_TGSI_TEXCOORD:
      return param == PIPE_CAP_TEXTURE_MIRROR_CLAMP_TO_EDGE ? 0 : 1;
   case PIPE_CAP_GLSL_FEATURE_LEVEL:
   case PIPE_CAP_GLSL_FEATURE_LEVEL_COMPATIBILITY:
      return 120;
   case PIPE_CAP_ESSL_FEATURE_LEVEL:
      return 100;
   case PIPE_CAP_MAX_TEXTURE_2D_SIZE:
      return 4096;
   case PIPE_CAP_MAX_TEXTURE_3D_LEVELS:
   case PIPE_CAP_MAX_TEXTURE_CUBE_LEVELS:
   case PIPE_CAP_MAX_TEXTURE_ARRAY_LAYERS:
      return 0;
   case PIPE_CAP_MAX_RENDER_TARGETS:
      return 1;
   case PIPE_CAP_TEXTURE_SHADOW_MAP:          /* sampler2DShadow + sampler compare (WebGL2 has both) */
   case PIPE_CAP_MIXED_FRAMEBUFFER_SIZES:     /* GLES 3.0 renders the intersection of the attachments */
   case PIPE_CAP_MIXED_COLOR_DEPTH_BITS:
      return 1;
   case PIPE_CAP_MAX_VIEWPORTS:
      return 1;
   case PIPE_CAP_MAX_VERTEX_ATTRIB_STRIDE:
      return 255;
   case PIPE_CAP_MAX_VERTEX_ELEMENT_SRC_OFFSET:
      return 2047;
   case PIPE_CAP_CONSTANT_BUFFER_OFFSET_ALIGNMENT:
      return 16;
   case PIPE_CAP_MIN_MAP_BUFFER_ALIGNMENT:
      return 64;
   case PIPE_CAP_VERTEX_BUFFER_OFFSET_4BYTE_ALIGNED_ONLY:
   case PIPE_CAP_VERTEX_BUFFER_STRIDE_4BYTE_ALIGNED_ONLY:
   case PIPE_CAP_VERTEX_ELEMENT_SRC_OFFSET_4BYTE_ALIGNED_ONLY:
      return 1;
   case PIPE_CAP_SUPPORTED_PRIM_MODES:
   case PIPE_CAP_SUPPORTED_PRIM_MODES_WITH_RESTART:
      /* WebGL2 primitives: no quads, quad strips, polygons, line loops or adjacency */
      return BITFIELD_BIT(MESA_PRIM_POINTS) | BITFIELD_BIT(MESA_PRIM_LINES) | BITFIELD_BIT(MESA_PRIM_LINE_STRIP) |
             BITFIELD_BIT(MESA_PRIM_TRIANGLES) | BITFIELD_BIT(MESA_PRIM_TRIANGLE_STRIP) |
             BITFIELD_BIT(MESA_PRIM_TRIANGLE_FAN);
   case PIPE_CAP_MAX_TEXEL_BUFFER_ELEMENTS_UINT:
      return 0;
   case PIPE_CAP_CLIP_PLANES:
      return 0;                     /* WebGL2 has no clip distances: lowered to discard */
   case PIPE_CAP_ALPHA_TEST:
   case PIPE_CAP_TWO_SIDED_COLOR:
   case PIPE_CAP_FLATSHADE:
   case PIPE_CAP_POINT_SIZE_FIXED:
   case PIPE_CAP_TEXTURE_SWIZZLE:
   case PIPE_CAP_USER_VERTEX_BUFFERS:
   case PIPE_CAP_PRIMITIVE_RESTART:
   case PIPE_CAP_PRIMITIVE_RESTART_FIXED_INDEX:
   case PIPE_CAP_OCCLUSION_QUERY:
   case PIPE_CAP_QUERY_TIME_ELAPSED:
   case PIPE_CAP_QUERY_TIMESTAMP:
   case PIPE_CAP_VERTEX_ELEMENT_INSTANCE_DIVISOR:
   case PIPE_CAP_INDEP_BLEND_ENABLE:
   case PIPE_CAP_INDEP_BLEND_FUNC:
   case PIPE_CAP_DEPTH_CLIP_DISABLE:
   case PIPE_CAP_SHADER_STENCIL_EXPORT:
   case PIPE_CAP_SEAMLESS_CUBE_MAP:
   case PIPE_CAP_CONDITIONAL_RENDER:
   case PIPE_CAP_TEXTURE_BARRIER:
   case PIPE_CAP_STREAM_OUTPUT_PAUSE_RESUME:
   case PIPE_CAP_MAX_STREAM_OUTPUT_BUFFERS:
   case PIPE_CAP_COMPUTE:
   case PIPE_CAP_TEXTURE_MULTISAMPLE:
   case PIPE_CAP_GLSL_TESS_LEVELS_AS_INPUTS:
      return 0;
   case PIPE_CAP_MAX_TEXTURE_UPLOAD_MEMORY_BUDGET:
      return 32 << 20;
   case PIPE_CAP_ACCELERATED:
      return 1;
   case PIPE_CAP_VIDEO_MEMORY:
      return 256;
   case PIPE_CAP_UMA:
      return 0;
   case PIPE_CAP_MAP_UNSYNCHRONIZED_THREAD_SAFE:
   case PIPE_CAP_BUFFER_MAP_PERSISTENT_COHERENT:   /* guest writes reach the host only through explicit uploads */
      return 0;
   default:
      return u_pipe_screen_get_param_defaults(screen, param);
   }
}

static int bbgpu_get_shader_param(struct pipe_screen *screen, enum pipe_shader_type shader, enum pipe_shader_cap param)
{
   if (shader != PIPE_SHADER_VERTEX && shader != PIPE_SHADER_FRAGMENT)
      return 0;
   switch (param) {
   case PIPE_SHADER_CAP_MAX_INSTRUCTIONS:
   case PIPE_SHADER_CAP_MAX_ALU_INSTRUCTIONS:
   case PIPE_SHADER_CAP_MAX_TEX_INSTRUCTIONS:
   case PIPE_SHADER_CAP_MAX_TEX_INDIRECTIONS:
      return 16384;
   case PIPE_SHADER_CAP_MAX_CONTROL_FLOW_DEPTH:
      return 64;
   case PIPE_SHADER_CAP_MAX_INPUTS:
      return shader == PIPE_SHADER_VERTEX ? 16 : 15;
   case PIPE_SHADER_CAP_MAX_OUTPUTS:
      return shader == PIPE_SHADER_VERTEX ? 16 : 1;
   case PIPE_SHADER_CAP_MAX_CONST_BUFFER0_SIZE:
      return 256 * 16;              /* uniform vec4 bb_vc[256] / bb_fc[256] */
   case PIPE_SHADER_CAP_MAX_CONST_BUFFERS:
      return 1;
   case PIPE_SHADER_CAP_MAX_TEMPS:
      return 256;
   case PIPE_SHADER_CAP_CONT_SUPPORTED:
   case PIPE_SHADER_CAP_INDIRECT_CONST_ADDR:
   case PIPE_SHADER_CAP_INDIRECT_TEMP_ADDR:
      return 1;
   case PIPE_SHADER_CAP_TGSI_SQRT_SUPPORTED:
      return 1;
   case PIPE_SHADER_CAP_INTEGERS:            /* float-only shaders keep the GLSL translator small */
   case PIPE_SHADER_CAP_INT64_ATOMICS:
   case PIPE_SHADER_CAP_FP16:
   case PIPE_SHADER_CAP_FP16_DERIVATIVES:
   case PIPE_SHADER_CAP_FP16_CONST_BUFFERS:
   case PIPE_SHADER_CAP_INT16:
   case PIPE_SHADER_CAP_GLSL_16BIT_CONSTS:
   case PIPE_SHADER_CAP_TGSI_ANY_INOUT_DECL_RANGE:
   case PIPE_SHADER_CAP_SUBROUTINES:
   case PIPE_SHADER_CAP_MAX_SHADER_BUFFERS:
   case PIPE_SHADER_CAP_MAX_SHADER_IMAGES:
   case PIPE_SHADER_CAP_MAX_HW_ATOMIC_COUNTERS:
   case PIPE_SHADER_CAP_MAX_HW_ATOMIC_COUNTER_BUFFERS:
   case PIPE_SHADER_CAP_INDIRECT_OUTPUT_ADDR:
   case PIPE_SHADER_CAP_INDIRECT_INPUT_ADDR:
      return 0;
   case PIPE_SHADER_CAP_MAX_TEXTURE_SAMPLERS:
   case PIPE_SHADER_CAP_MAX_SAMPLER_VIEWS:
      return shader == PIPE_SHADER_FRAGMENT ? 16 : 0;
   case PIPE_SHADER_CAP_SUPPORTED_IRS:
      return (1 << PIPE_SHADER_IR_TGSI) | (1 << PIPE_SHADER_IR_NIR);
   default:
      return 0;
   }
}

static float bbgpu_get_paramf(struct pipe_screen *screen, enum pipe_capf param)
{
   switch (param) {
   case PIPE_CAPF_MIN_LINE_WIDTH:
   case PIPE_CAPF_MIN_LINE_WIDTH_AA:
   case PIPE_CAPF_MIN_POINT_SIZE:
   case PIPE_CAPF_MIN_POINT_SIZE_AA:
   case PIPE_CAPF_MAX_LINE_WIDTH:
   case PIPE_CAPF_MAX_LINE_WIDTH_AA:
   case PIPE_CAPF_POINT_SIZE_GRANULARITY:
   case PIPE_CAPF_LINE_WIDTH_GRANULARITY:
      return 1.0f;
   case PIPE_CAPF_MAX_POINT_SIZE:
   case PIPE_CAPF_MAX_POINT_SIZE_AA:
      return 64.0f;
   case PIPE_CAPF_MAX_TEXTURE_ANISOTROPY:
      return 1.0f;
   case PIPE_CAPF_MAX_TEXTURE_LOD_BIAS:
      return 15.0f;
   default:
      return 0.0f;
   }
}

int bbgpu_format(enum pipe_format f)
{
   switch (f) {
   case PIPE_FORMAT_R8G8B8A8_UNORM: return BBGPU_FMT_RGBA8;
   case PIPE_FORMAT_B8G8R8A8_UNORM: return BBGPU_FMT_BGRA8;
   case PIPE_FORMAT_R8G8B8X8_UNORM: return BBGPU_FMT_RGBX8;
   case PIPE_FORMAT_B8G8R8X8_UNORM: return BBGPU_FMT_BGRX8;
   case PIPE_FORMAT_R8_UNORM:       return BBGPU_FMT_R8;
   case PIPE_FORMAT_R8G8_UNORM:     return BBGPU_FMT_RG8;
   case PIPE_FORMAT_B5G6R5_UNORM:   return BBGPU_FMT_RGB565;
   case PIPE_FORMAT_R16G16B16A16_FLOAT: return BBGPU_FMT_RGBA16F;
   case PIPE_FORMAT_R32G32B32A32_FLOAT: return BBGPU_FMT_RGBA32F;
   case PIPE_FORMAT_Z16_UNORM:      return BBGPU_FMT_Z16;
   case PIPE_FORMAT_Z24X8_UNORM:    return BBGPU_FMT_Z24X8;
   case PIPE_FORMAT_Z24_UNORM_S8_UINT: return BBGPU_FMT_Z24S8;
   case PIPE_FORMAT_Z32_FLOAT:      return BBGPU_FMT_Z32F;
   case PIPE_FORMAT_R8G8B8A8_SRGB:  return BBGPU_FMT_SRGBA8;
   case PIPE_FORMAT_B8G8R8A8_SRGB:  return BBGPU_FMT_SBGRA8;
   default: return 0;
   }
}

/* vertex attribute formats: size, GL type, normalized */
bool bbgpu_vertex_format(enum pipe_format f, unsigned *size, unsigned *type, unsigned *norm)
{
   const struct util_format_description *d = util_format_description(f);
   if (!d || d->layout != UTIL_FORMAT_LAYOUT_PLAIN || d->nr_channels < 1 || d->nr_channels > 4)
      return false;
   const struct util_format_channel_description *c = &d->channel[0];
   for (unsigned i = 1; i < d->nr_channels; i++)
      if (d->channel[i].type != c->type || d->channel[i].size != c->size || d->channel[i].normalized != c->normalized)
         return false;
   if (d->swizzle[0] != PIPE_SWIZZLE_X)       /* BGRA-ordered vertex data: not in WebGL2 */
      return false;
   *size = d->nr_channels;
   *norm = c->normalized;
   if (c->type == UTIL_FORMAT_TYPE_FLOAT && c->size == 32) { *type = 0x1406; return true; }          /* GL_FLOAT */
   if (c->type == UTIL_FORMAT_TYPE_FLOAT && c->size == 16) { *type = 0x140B; return true; }          /* GL_HALF_FLOAT */
   if (c->pure_integer)
      return false;
   if (c->type == UTIL_FORMAT_TYPE_UNSIGNED && c->size == 8) { *type = 0x1401; return true; }        /* GL_UNSIGNED_BYTE */
   if (c->type == UTIL_FORMAT_TYPE_SIGNED && c->size == 8) { *type = 0x1400; return true; }          /* GL_BYTE */
   if (c->type == UTIL_FORMAT_TYPE_UNSIGNED && c->size == 16) { *type = 0x1403; return true; }       /* GL_UNSIGNED_SHORT */
   if (c->type == UTIL_FORMAT_TYPE_SIGNED && c->size == 16) { *type = 0x1402; return true; }         /* GL_SHORT */
   return false;
}

static bool bbgpu_is_format_supported(struct pipe_screen *screen, enum pipe_format format,
                                      enum pipe_texture_target target, unsigned sample_count,
                                      unsigned storage_sample_count, unsigned bind)
{
   if (sample_count > 1)
      return false;
   if (target == PIPE_BUFFER)
      return !(bind & ~(PIPE_BIND_VERTEX_BUFFER | PIPE_BIND_INDEX_BUFFER | PIPE_BIND_CONSTANT_BUFFER)) &&
             (!(bind & PIPE_BIND_VERTEX_BUFFER) || ({ unsigned a, b, c; bbgpu_vertex_format(format, &a, &b, &c); }));
   if (target != PIPE_TEXTURE_2D && target != PIPE_TEXTURE_RECT)
      return false;
   int f = bbgpu_format(format);
   if (!f)
      return false;
   bool depth = util_format_is_depth_or_stencil(format);
   if ((bind & PIPE_BIND_DEPTH_STENCIL) && !depth)
      return false;
   if ((bind & (PIPE_BIND_RENDER_TARGET | PIPE_BIND_DISPLAY_TARGET)) && depth)
      return false;
   if ((bind & PIPE_BIND_RENDER_TARGET) && (f == BBGPU_FMT_RGBA16F || f == BBGPU_FMT_RGBA32F))
      return false;                 /* float render targets need a WebGL extension: not reported */
   if ((bind & PIPE_BIND_DISPLAY_TARGET)) {
      struct bbgpu_screen *bs = bbgpu_screen(screen);
      return bs->winsys->is_displaytarget_format_supported(bs->winsys, bind, format);
   }
   return true;
}

/* ---- resources ---- */
static struct pipe_resource *bbgpu_resource_create(struct pipe_screen *screen, const struct pipe_resource *templ)
{
   struct bbgpu_screen *bs = bbgpu_screen(screen);
   struct bbgpu_resource *r = CALLOC_STRUCT(bbgpu_resource);
   if (!r)
      return NULL;
   r->base = *templ;
   r->base.screen = screen;
   pipe_reference_init(&r->base.reference, 1);
   r->id = bbgpu_new_id(bs->dev);
   if (templ->target == PIPE_BUFFER) {
      r->shadow = CALLOC(1, templ->width0 ? templ->width0 : 1);
      BBGPU_CMD(bs->dev, BBGPU_OP_RES_CREATE, r->id, BBGPU_TARGET_BUFFER, 0, templ->width0, 1, 1, 1, templ->bind);
      return &r->base;
   }
   r->fmt = bbgpu_format(templ->format);
   if (!r->fmt) {
      FREE(r);
      return NULL;
   }
   BBGPU_CMD(bs->dev, BBGPU_OP_RES_CREATE, r->id, BBGPU_TARGET_2D, r->fmt, templ->width0, templ->height0, 1,
             templ->last_level + 1, templ->bind);
   if (templ->bind & (PIPE_BIND_DISPLAY_TARGET | PIPE_BIND_SCANOUT | PIPE_BIND_SHARED)) {
      r->dt = bs->winsys->displaytarget_create(bs->winsys, templ->bind, templ->format, templ->width0,
                                               templ->height0, 64, NULL, &r->dt_stride);
   }
   return &r->base;
}

static void bbgpu_resource_destroy(struct pipe_screen *screen, struct pipe_resource *pres)
{
   struct bbgpu_screen *bs = bbgpu_screen(screen);
   struct bbgpu_resource *r = bbgpu_resource(pres);
   BBGPU_CMD(bs->dev, BBGPU_OP_RES_DESTROY, r->id);
   if (r->dt)
      bs->winsys->displaytarget_destroy(bs->winsys, r->dt);
   FREE(r->shadow);
   FREE(r);
}

/* ---- fences: a fence handle is a heap-allocated id ---- */
struct bbgpu_fence { struct pipe_reference ref; uint32_t id; };

struct pipe_fence_handle *bbgpu_fence_create(uint32_t id)
{
   struct bbgpu_fence *f = CALLOC_STRUCT(bbgpu_fence);
   pipe_reference_init(&f->ref, 1);
   f->id = id;
   return (struct pipe_fence_handle *)f;
}

static void bbgpu_fence_reference(struct pipe_screen *screen, struct pipe_fence_handle **ptr, struct pipe_fence_handle *fence)
{
   struct bbgpu_fence *old = (struct bbgpu_fence *)*ptr, *f = (struct bbgpu_fence *)fence;
   if (pipe_reference(old ? &old->ref : NULL, f ? &f->ref : NULL))
      FREE(old);
   *ptr = fence;
}

static bool bbgpu_fence_finish(struct pipe_screen *screen, struct pipe_context *ctx, struct pipe_fence_handle *fence, uint64_t timeout)
{
   struct bbgpu_screen *bs = bbgpu_screen(screen);
   struct bbgpu_fence *f = (struct bbgpu_fence *)fence;
   if (!timeout)
      return bbgpu_fence_done(bs->dev, f->id);
   bbgpu_fence_wait(bs->dev, f->id);
   return true;
}

/* ---- present: read the rendered image back and hand it to the window system (MIT-SHM put image) ---- */
static void bbgpu_flush_frontbuffer(struct pipe_screen *screen, struct pipe_context *pctx, struct pipe_resource *pres,
                                    unsigned level, unsigned layer, void *context_private, struct pipe_box *sub_box)
{
   struct bbgpu_screen *bs = bbgpu_screen(screen);
   struct bbgpu_resource *r = bbgpu_resource(pres);
   if (!r->dt)
      return;
   unsigned w = pres->width0, h = pres->height0, y0 = 0, rows = h;
   if (sub_box) { y0 = sub_box->y; rows = sub_box->height; }
   uint8_t *map = bs->winsys->displaytarget_map(bs->winsys, r->dt, PIPE_MAP_WRITE);
   if (!map)
      return;
   /* in slices that fit the heap */
   unsigned row_bytes = w * 4, max_rows = MAX2(1u, (bs->dev->heap_size / 4) / row_bytes);
   for (unsigned y = y0; y < y0 + rows; y += max_rows) {
      unsigned n = MIN2(max_rows, y0 + rows - y);
      uint32_t off = bbgpu_heap_alloc(bs->dev, n * row_bytes);
      BBGPU_CMD(bs->dev, BBGPU_OP_RES_READ, r->id, level, 0, y, w, n, off, row_bytes);
      bbgpu_fence_wait(bs->dev, bbgpu_dev_flush(bs->dev));
      for (unsigned i = 0; i < n; i++)
         memcpy(map + (size_t)(y + i) * r->dt_stride, bs->dev->heap + off + (size_t)i * row_bytes, row_bytes);
      bs->dev->stat_bytes_down += n * row_bytes;
   }
   bs->winsys->displaytarget_unmap(bs->winsys, r->dt);
   bs->winsys->displaytarget_display(bs->winsys, r->dt, context_private, sub_box);
   if (bbgpu_dev_error(bs->dev) && !bs->reported_error) {
      bs->reported_error = true;
      fprintf(stderr, "bbgpu: renderer error %u (op %u)\n%s\n", bbgpu_dev_error(bs->dev),
              bs->dev->regs[BBGPU_REG_ERR_OP / 4], bbgpu_dev_log(bs->dev));
   }
}

static const void *bbgpu_get_compiler_options(struct pipe_screen *screen, enum pipe_shader_ir ir, enum pipe_shader_type shader)
{
   return nir_to_tgsi_get_compiler_options(screen, ir, shader);
}

static void bbgpu_destroy(struct pipe_screen *screen)
{
   struct bbgpu_screen *bs = bbgpu_screen(screen);
   bbgpu_fence_wait(bs->dev, bbgpu_dev_flush(bs->dev));
   bbgpu_dev_put(bs->dev);
   FREE(bs);              /* the winsys belongs to the pipe loader, which destroys it */
}

static int bbgpu_get_screen_fd(struct pipe_screen *screen) { return -1; }

struct pipe_screen *bbgpu_create_screen(struct sw_winsys *winsys)
{
   struct bbgpu_screen *bs = CALLOC_STRUCT(bbgpu_screen);
   if (!bs)
      return NULL;
   bs->dev = bbgpu_dev_get();
   if (!bs->dev) {
      fprintf(stderr, "bbgpu: no Bootbox GPU device (or /sys not writable); falling back\n");
      FREE(bs);
      return NULL;
   }
   bs->winsys = winsys;
   struct pipe_screen *s = &bs->base;
   s->destroy = bbgpu_destroy;
   s->get_name = bbgpu_get_name;
   s->get_vendor = bbgpu_get_vendor;
   s->get_device_vendor = bbgpu_get_vendor;
   s->get_screen_fd = bbgpu_get_screen_fd;
   s->get_param = bbgpu_get_param;
   s->get_shader_param = bbgpu_get_shader_param;
   s->get_paramf = bbgpu_get_paramf;
   s->get_timestamp = u_default_get_timestamp;
   s->is_format_supported = bbgpu_is_format_supported;
   s->context_create = bbgpu_context_create;
   s->resource_create = bbgpu_resource_create;
   s->resource_destroy = bbgpu_resource_destroy;
   s->fence_reference = bbgpu_fence_reference;
   s->fence_finish = bbgpu_fence_finish;
   s->flush_frontbuffer = bbgpu_flush_frontbuffer;
   s->get_compiler_options = bbgpu_get_compiler_options;
   fprintf(stderr, "bbgpu: Bootbox GPU bridge, %u MB shared\n", bs->dev->shm_size >> 20);
   return s;
}
