/* bbgpu_proto.h - Bootbox GPU bridge protocol, shared by the QEMU device, the renderer and the guest
 * driver. See docs/GPU_BRIDGE.md. SPDX-License-Identifier: MIT */
#ifndef BBGPU_PROTO_H
#define BBGPU_PROTO_H

#define BBGPU_PCI_VENDOR     0xbb0b      /* private: only ever seen inside a Bootbox VM */
#define BBGPU_PCI_DEVICE     0x0001
#define BBGPU_MAGIC          0x50474242u /* "BBGP" */
#define BBGPU_PROTO_VERSION  1
#define BBGPU_RING_SIZE      (4u << 20)  /* BAR2 [0, 4 MB) = command ring, the rest = heap */

/* BAR0 registers (32-bit) */
#define BBGPU_REG_MAGIC      0x00
#define BBGPU_REG_VERSION    0x04
#define BBGPU_REG_KICK       0x08  /* W: new ring head (byte offset, monotonic mod 2^32) */
#define BBGPU_REG_FENCE_DONE 0x0c  /* R: last completed fence id */
#define BBGPU_REG_RING_SIZE  0x10
#define BBGPU_REG_SHM_SIZE   0x14
#define BBGPU_REG_TAIL       0x18  /* R: renderer's ring tail */
#define BBGPU_REG_ERROR      0x1c
#define BBGPU_REG_OPS        0x20
#define BBGPU_REG_RESET      0x24  /* W: any value */
#define BBGPU_REG_ERR_OP     0x28  /* R: op of the first failing command */

/* errors */
#define BBGPU_ERR_RING    1
#define BBGPU_ERR_OP      2
#define BBGPU_ERR_RANGE   3
#define BBGPU_ERR_OBJECT  4   /* unknown / wrong-kind id */
#define BBGPU_ERR_SHADER  5   /* compile or link failure (log in the heap at BBGPU_LOG_OFF) */
#define BBGPU_ERR_GL      6

/* The last 64 KB of the heap is the renderer's log area (shader info logs, NUL-terminated). */
#define BBGPU_LOG_SIZE   (64u << 10)

/* ops: every command = u32 op, u32 dwords (total, incl. these two), payload (u32 / f32) */
enum {
    BBGPU_OP_NOP = 0,
    BBGPU_OP_WRAP,           /* padding to the end of the ring */
    BBGPU_OP_ECHO,           /* src_off, dst_off, size: heap memmove (transport test) */
    BBGPU_OP_FENCE,          /* id: everything before it has executed */

    /* resources */
    BBGPU_OP_RES_CREATE,     /* id, target, format, width, height, depth, levels, bind */
    BBGPU_OP_RES_DESTROY,    /* id */
    BBGPU_OP_RES_WRITE,      /* id, level, x, y, z, w, h, d, heap_off, stride, layer_stride */
    BBGPU_OP_RES_READ,       /* id, level, x, y, w, h, heap_off, stride (color or depth 2D only) */

    /* shaders: GLSL ES 3.00 source in the heap */
    BBGPU_OP_SHADER_CREATE,  /* id, stage, heap_off, len */
    BBGPU_OP_PROGRAM_CREATE, /* id, vs, fs */
    BBGPU_OP_OBJ_DESTROY,    /* id (shader or program) */

    /* state */
    BBGPU_OP_SET_FRAMEBUFFER,  /* ncbufs, zs, cbuf[ncbufs] (resource ids; 0 = none / default) */
    BBGPU_OP_SET_VIEWPORT,     /* x, y, w, h (f32), znear, zfar (f32), yflip (u32: Gallium window FBOs are
                                  y-down; the VS multiplies gl_Position.y by bb_flip and the front face flips) */
    BBGPU_OP_SET_SCISSOR,      /* enable, x, y, w, h */
    BBGPU_OP_SET_BLEND,        /* enable, rgb_eq, rgb_src, rgb_dst, a_eq, a_src, a_dst, colormask, color rgba (f32) */
    BBGPU_OP_SET_DEPTH_STENCIL,/* depth_test, depth_write, depth_func, stencil_test, then front: func, ref, mask, fail, zfail,
                                  zpass, writemask, then (optional) back: func, ref, mask, fail, zfail, zpass, writemask */
    BBGPU_OP_SET_RASTER,       /* cull_face (0 none, GL enum), front_ccw, poly_offset_enable, factor (f32), units (f32) */
    BBGPU_OP_USE_PROGRAM,      /* id */
    BBGPU_OP_SET_UNIFORMS,     /* stage, first_vec4, count, then count*4 f32 (uniform vec4 bb_vc[] / bb_fc[]) */
    BBGPU_OP_SET_VERTEX_ELEMENTS, /* n, then per element: buffer, offset, size, gl_type, normalized, integer, divisor */
    BBGPU_OP_SET_VERTEX_BUFFERS,  /* n, then per buffer: res id, stride, offset */
    BBGPU_OP_SET_INDEX_BUFFER,    /* res id (0 = none), index_size (1,2,4), offset */
    BBGPU_OP_SET_TEXTURES,     /* first_unit, n, then per unit (8 dwords): res id, min_filter, mag_filter, wrap_s, wrap_t,
                                  swizzle (4x u8, unused), compare (0 = none, else GL compare func), lod_bias (f32) */

    /* drawing */
    BBGPU_OP_CLEAR,            /* buffers (GL bits), r, g, b, a (f32), depth (f32), stencil */
    BBGPU_OP_DRAW,             /* mode, start, count, instances, index_bias (s32), indexed */
    BBGPU_OP_COPY_RES,         /* dst, dst_level, src, src_level, sx0, sy0, sx1, sy1, dx0, dy0, dx1, dy1, filter:
                                  blitFramebuffer rectangles (flips and scaling allowed) */

    BBGPU_OP_COUNT
};

/* resource targets */
#define BBGPU_TARGET_BUFFER   0
#define BBGPU_TARGET_2D       1
/* resource formats (renderer maps them to GLES 3.0 / WebGL2 internal formats) */
enum {
    BBGPU_FMT_NONE = 0,
    BBGPU_FMT_RGBA8, BBGPU_FMT_BGRA8, BBGPU_FMT_RGBX8, BBGPU_FMT_BGRX8,
    BBGPU_FMT_R8, BBGPU_FMT_RG8, BBGPU_FMT_A8,
    BBGPU_FMT_RGB565, BBGPU_FMT_RGBA16F, BBGPU_FMT_RGBA32F,
    BBGPU_FMT_Z16, BBGPU_FMT_Z24X8, BBGPU_FMT_Z24S8, BBGPU_FMT_Z32F,
    BBGPU_FMT_SRGBA8, BBGPU_FMT_SBGRA8,
    BBGPU_FMT_COUNT
};
/* shader stages */
#define BBGPU_STAGE_VS 0
#define BBGPU_STAGE_FS 1

/* Shader interface conventions (the guest translator emits these names):
 *   vertex inputs        in  ... bb_a0 .. bb_a15       (attribute location = index)
 *   uniforms             uniform vec4 bb_vc[N] (VS), bb_fc[N] (FS)
 *   samplers             uniform sampler2D bb_s0 .. bb_s15 (unit = index)
 *   fragment outputs     out vec4 bb_o0 .. (location = index)
 *   y flip               uniform float bb_flip (VS: gl_Position.y *= bb_flip) */

#endif
