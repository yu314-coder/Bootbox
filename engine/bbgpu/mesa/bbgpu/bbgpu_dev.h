/* bbgpu_dev.h - guest side of the Bootbox GPU bridge transport (BAR mapping, ring, heap, fences).
 * SPDX-License-Identifier: MIT */
#ifndef BBGPU_DEV_H
#define BBGPU_DEV_H
#include <stdbool.h>
#include <stdint.h>
#include "bbgpu_proto.h"

struct bbgpu_dev {
   volatile uint32_t *regs;
   /* this client's registers: its slot's, or the legacy single-client ones (engines before multi-client) */
   volatile uint32_t *r_kick, *r_fence, *r_tail, *r_error, *r_errop, *r_reset;
   uint8_t *bar;                     /* all of BAR2 (shm = this client's part) */
   uint32_t bar_size, ring_size;
   int slot, slot_fd;
   uint8_t *shm, *heap;
   uint32_t shm_size, heap_size;     /* heap_size excludes the renderer's log area */
   uint32_t head;                    /* ring write position (monotonic) */
   uint32_t kicked;                  /* head value last kicked */
   uint32_t next_fence, last_submitted_fence;
   uint32_t next_id;                 /* object ids (shared by all contexts of the screen) */
   /* heap: a ring allocator; every chunk is released when the fence emitted after its use completes */
   uint32_t heap_head, heap_tail;    /* byte offsets, monotonic */
   struct { uint32_t end, fence; } chunks[1024];
   uint32_t nchunks;
   uint64_t stat_bytes_up, stat_bytes_down, stat_cmds;
   bool null;                        /* BBGPU_NULL=1: no device - commands are dropped (image builds fill the
                                        shader cache this way: Mesa compiles every shader as on the bridge) */
};

bool bbgpu_dev_open(struct bbgpu_dev *d);
void bbgpu_dev_close(struct bbgpu_dev *d);
/* the process-wide device (Mesa may create several screens: they must share one ring, heap and id space) */
struct bbgpu_dev *bbgpu_dev_get(void);
void bbgpu_dev_put(struct bbgpu_dev *d);
/* append one command (op + n payload dwords); the ring is kicked by bbgpu_dev_flush */
void bbgpu_cmd(struct bbgpu_dev *d, uint32_t op, const uint32_t *payload, uint32_t n);
/* emit a fence and kick; returns the fence id */
uint32_t bbgpu_dev_flush(struct bbgpu_dev *d);
bool bbgpu_fence_done(struct bbgpu_dev *d, uint32_t fence);
void bbgpu_fence_wait(struct bbgpu_dev *d, uint32_t fence);
/* heap space for an upload / read-back, valid until the next flush's fence completes */
uint32_t bbgpu_heap_alloc(struct bbgpu_dev *d, uint32_t size);
uint32_t bbgpu_new_id(struct bbgpu_dev *d);
const char *bbgpu_dev_log(struct bbgpu_dev *d);
uint32_t bbgpu_dev_error(struct bbgpu_dev *d);

#define BBGPU_CMD(d, op, ...) do { const uint32_t a_[] = { __VA_ARGS__ }; bbgpu_cmd(d, op, a_, sizeof a_ / 4); } while (0)
static inline uint32_t bbgpu_f2u(float f) { union { float f; uint32_t u; } x = { f }; return x.u; }

#endif
