/* bbgpu_dev.c - guest side of the Bootbox GPU bridge transport. The device's BARs are mapped from
 * userspace (no kernel driver): BAR0 registers + doorbell, BAR2 = command ring + data heap.
 * SPDX-License-Identifier: MIT */
#include <dirent.h>
#include <fcntl.h>
#include <pthread.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
#include "bbgpu_dev.h"

static int find_device(char *path, size_t n)
{
   DIR *dir = opendir("/sys/bus/pci/devices");
   struct dirent *e;
   int found = -1;
   while (dir && (e = readdir(dir))) {
      char p[512], buf[32];
      FILE *f;
      snprintf(p, sizeof p, "/sys/bus/pci/devices/%s/vendor", e->d_name);
      if (!(f = fopen(p, "r")))
         continue;
      if (fgets(buf, sizeof buf, f) && strtoul(buf, NULL, 16) == BBGPU_PCI_VENDOR) {
         snprintf(path, n, "/sys/bus/pci/devices/%s", e->d_name);
         found = 0;
      }
      fclose(f);
      if (!found)
         break;
   }
   if (dir)
      closedir(dir);
   return found;
}

static void *map_bar(const char *dev, int bar, size_t len)
{
   char p[600];
   snprintf(p, sizeof p, "%s/resource%d", dev, bar);
   int fd = open(p, O_RDWR | O_SYNC);
   if (fd < 0)
      return NULL;
   void *m = mmap(NULL, len, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
   close(fd);
   return m == MAP_FAILED ? NULL : m;
}

bool bbgpu_dev_open(struct bbgpu_dev *d)
{
   char dev[512];
   memset(d, 0, sizeof *d);
   if (find_device(dev, sizeof dev))
      return false;
   d->regs = map_bar(dev, 0, 4096);
   if (!d->regs || d->regs[BBGPU_REG_MAGIC / 4] != BBGPU_MAGIC ||
       d->regs[BBGPU_REG_VERSION / 4] != BBGPU_PROTO_VERSION) {
      fprintf(stderr, "bbgpu: device at %s is not protocol v%d\n", dev, BBGPU_PROTO_VERSION);
      return false;
   }
   d->shm_size = d->regs[BBGPU_REG_SHM_SIZE / 4];
   d->shm = map_bar(dev, 2, d->shm_size);
   if (!d->shm)
      return false;
   d->regs[BBGPU_REG_RESET / 4] = 1;
   d->heap = d->shm + BBGPU_RING_SIZE;
   d->heap_size = d->shm_size - BBGPU_RING_SIZE - BBGPU_LOG_SIZE;
   d->next_id = 1;
   return true;
}

void bbgpu_dev_close(struct bbgpu_dev *d)
{
   if (d->shm)
      munmap(d->shm, d->shm_size);
   if (d->regs)
      munmap((void *)d->regs, 4096);
   memset(d, 0, sizeof *d);
}

static struct bbgpu_dev *the_dev;
static int the_dev_refs;
static pthread_mutex_t the_dev_lock = PTHREAD_MUTEX_INITIALIZER;

struct bbgpu_dev *bbgpu_dev_get(void)
{
   pthread_mutex_lock(&the_dev_lock);
   if (!the_dev) {
      struct bbgpu_dev *d = calloc(1, sizeof *d);
      if (d && bbgpu_dev_open(d)) the_dev = d; else free(d);
   }
   if (the_dev) the_dev_refs++;
   struct bbgpu_dev *r = the_dev;
   pthread_mutex_unlock(&the_dev_lock);
   return r;
}

void bbgpu_dev_put(struct bbgpu_dev *d)
{
   pthread_mutex_lock(&the_dev_lock);
   if (d == the_dev && --the_dev_refs == 0) {
      bbgpu_dev_close(the_dev);
      free(the_dev);
      the_dev = NULL;
   }
   pthread_mutex_unlock(&the_dev_lock);
}

uint32_t bbgpu_new_id(struct bbgpu_dev *d) { return d->next_id++; }
uint32_t bbgpu_dev_error(struct bbgpu_dev *d) { return d->regs[BBGPU_REG_ERROR / 4]; }
const char *bbgpu_dev_log(struct bbgpu_dev *d) { return (const char *)d->shm + d->shm_size - BBGPU_LOG_SIZE; }

bool bbgpu_fence_done(struct bbgpu_dev *d, uint32_t fence)
{
   return (int32_t)(d->regs[BBGPU_REG_FENCE_DONE / 4] - fence) >= 0;
}

void bbgpu_fence_wait(struct bbgpu_dev *d, uint32_t fence)
{
   unsigned spins = 0;
   while (!bbgpu_fence_done(d, fence)) {
      if (d->regs[BBGPU_REG_ERROR / 4] == BBGPU_ERR_GL || d->regs[BBGPU_REG_ERROR / 4] == BBGPU_ERR_RING)
         return;                       /* the renderer stopped: do not hang the app */
      if (++spins > 64)
         sched_yield();
   }
}

static void kick(struct bbgpu_dev *d)
{
   __sync_synchronize();
   d->regs[BBGPU_REG_KICK / 4] = d->head;
   d->kicked = d->head;
}

/* ring space: the renderer's tail must not be lapped */
static void ring_wait(struct bbgpu_dev *d, uint32_t bytes)
{
   while (d->head + bytes - d->regs[BBGPU_REG_TAIL / 4] > BBGPU_RING_SIZE - 64) {
      if (d->kicked != d->head)
         kick(d);
      if (d->regs[BBGPU_REG_ERROR / 4] == BBGPU_ERR_GL || d->regs[BBGPU_REG_ERROR / 4] == BBGPU_ERR_RING)
         return;
      sched_yield();
   }
}

void bbgpu_cmd(struct bbgpu_dev *d, uint32_t op, const uint32_t *payload, uint32_t n)
{
   uint32_t dw = 2 + n, at = d->head % BBGPU_RING_SIZE;
   ring_wait(d, dw * 4 + 8);
   if (at + dw * 4 > BBGPU_RING_SIZE) {
      uint32_t pad[2] = { BBGPU_OP_WRAP, (BBGPU_RING_SIZE - at) / 4 };
      memcpy(d->shm + at, pad, 8);
      d->head += BBGPU_RING_SIZE - at;
      at = 0;
      ring_wait(d, dw * 4 + 8);
   }
   uint32_t h[2] = { op, dw };
   memcpy(d->shm + at, h, 8);
   if (n)
      memcpy(d->shm + at + 8, payload, n * 4);
   d->head += dw * 4;
   d->stat_cmds++;
}

uint32_t bbgpu_dev_flush(struct bbgpu_dev *d)
{
   uint32_t id = ++d->next_fence;
   bbgpu_cmd(d, BBGPU_OP_FENCE, &id, 1);
   kick(d);
   d->last_submitted_fence = id;
   /* chunks allocated since the previous flush are released by this fence */
   for (int i = (int)d->nchunks - 1; i >= 0 && d->chunks[i].fence == 0; i--)
      d->chunks[i].fence = id;
   return id;
}

static void heap_reclaim(struct bbgpu_dev *d)
{
   uint32_t k = 0;
   while (k < d->nchunks && d->chunks[k].fence && bbgpu_fence_done(d, d->chunks[k].fence))
      k++;
   if (k) {
      d->heap_tail = d->chunks[k - 1].end;
      memmove(d->chunks, d->chunks + k, (d->nchunks - k) * sizeof d->chunks[0]);
      d->nchunks -= k;
   }
   if (!d->nchunks)
      d->heap_head = d->heap_tail = 0;
}

uint32_t bbgpu_heap_alloc(struct bbgpu_dev *d, uint32_t size)
{
   size = (size + 255) & ~255u;
   if (size > d->heap_size / 2) {
      fprintf(stderr, "bbgpu: transfer of %u bytes exceeds the heap\n", size);
      size = d->heap_size / 2;
   }
   for (;;) {
      heap_reclaim(d);
      uint32_t at = d->heap_head % d->heap_size;
      uint32_t need = size + (at + size > d->heap_size ? d->heap_size - at : 0);   /* skip the wrap gap */
      if (d->heap_head + need - d->heap_tail <= d->heap_size && d->nchunks < 1024) {
         d->heap_head += need;
         d->chunks[d->nchunks].end = d->heap_head;
         d->chunks[d->nchunks].fence = 0;
         d->nchunks++;
         return (d->heap_head - size) % d->heap_size;
      }
      /* full: everything outstanding must finish first */
      uint32_t f = d->chunks[d->nchunks - 1].fence ? d->last_submitted_fence : bbgpu_dev_flush(d);
      bbgpu_fence_wait(d, f);
      if (d->regs[BBGPU_REG_ERROR / 4] == BBGPU_ERR_GL || d->regs[BBGPU_REG_ERROR / 4] == BBGPU_ERR_RING)
         return 0;
   }
}
