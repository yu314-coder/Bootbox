/* bbgpu_render.h - Bootbox GPU bridge renderer API. SPDX-License-Identifier: MIT */
#ifndef BBGPU_RENDER_H
#define BBGPU_RENDER_H
#include <stdint.h>
typedef struct BBRenderer BBRenderer;
/* shm = the device's shared memory (ring + heap); a GLES 3.0 / WebGL2 context must be current */
BBRenderer *bbr_create(uint8_t *shm, uint32_t shm_size);
uint32_t bbr_execute(BBRenderer *r, uint32_t *tail, uint32_t head, uint32_t *fence_done, uint32_t *err_op);
const char *bbr_log(BBRenderer *r);
void bbr_reset(BBRenderer *r);
uint64_t bbr_draws(BBRenderer *r);
#endif
