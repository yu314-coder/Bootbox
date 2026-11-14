/* bbgpu_render.h - Bootbox GPU bridge renderer API. SPDX-License-Identifier: MIT */
#ifndef BBGPU_RENDER_H
#define BBGPU_RENDER_H
#include <stddef.h>
#include <stdint.h>
typedef struct BBRenderer BBRenderer;
/* shm = the device's shared memory (ring + heap); a GLES 3.0 / WebGL2 context must be current */
BBRenderer *bbr_create(uint8_t *shm, uint32_t shm_size, uint32_t ring_size);
void bbr_layout(BBRenderer *r, uint8_t *shm, uint32_t shm_size, uint32_t ring_size);
void bbr_activate(BBRenderer *r);   /* several clients share the GL context: call before running another one */
uint32_t bbr_execute(BBRenderer *r, uint32_t *tail, uint32_t head, uint32_t *fence_done, uint32_t *err_op);
const char *bbr_log(BBRenderer *r);
void bbr_reset(BBRenderer *r);
uint64_t bbr_draws(BBRenderer *r);
/* direct present: a frame the host was too busy to take is kept and re-offered */
int bbr_present_pending(BBRenderer *r);
void bbr_present_retry(BBRenderer *r);

/* provided by the embedder (wasm: bbgpu_webgl.c, native: bbgpu_egl.c) */
int bbgpu_present_ready(void);                 /* 0: the viewer still has frames in flight - keep this one */
/* draw the read framebuffer's [sx,sy,w,h] (y-down) as window `win` at screen (dx,dy) */
void bbgpu_present_frame(uint32_t win, uint32_t sx, uint32_t sy, uint32_t w, uint32_t h, int32_t dx, int32_t dy);
void bbgpu_present_remove(uint32_t win);       /* win 0 = all (client reset) */
extern volatile uint32_t bbgpu_host[4];        /* [0] viewer composites presents, [1] frames it took, [2] frames sent */
extern volatile uint32_t bbtouch_ring[];       /* direct touch mailbox (see bbgpu.c) */
extern volatile uint32_t bbdisp[];             /* direct display block (see bbgpu.c) */
/* snapshots: the stream is written/read through these (the device maps them to QEMUFile) */
typedef void (*bbr_put_fn)(void *f, const void *p, size_t n);
typedef int (*bbr_get_fn)(void *f, void *p, size_t n);   /* 1 = got n bytes */
void bbr_save_shared(BBRenderer *any, bbr_put_fn put, void *f);
int bbr_load_shared(BBRenderer *any, bbr_get_fn get, void *f);
void bbr_save(BBRenderer *r, bbr_put_fn put, void *f);
int bbr_load(BBRenderer *r, bbr_get_fn get, void *f);
#endif
