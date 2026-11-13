/* bbgpu_dev.c - guest side of the Bootbox GPU bridge transport. The device's BARs are mapped from
 * userspace (no kernel driver): BAR0 registers + doorbell, BAR2 = command ring + data heap.
 * SPDX-License-Identifier: MIT */
#include <dirent.h>
#include <fcntl.h>
#include <pthread.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sched.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>
#include "bbgpu_dev.h"

/* where the per-slot lock files live: a directory every GL process can write */
static const char *lock_dir(void)
{
#ifdef __ANDROID__
   return "/dev/bbgpu";          /* created 0777 by the Bootbox init script (Android has no /tmp) */
#else
   return "/tmp";
#endif
}

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

static bool null_open(struct bbgpu_dev *d)
{
   uint32_t *r = calloc(1, 4096);
   d->shm_size = 16u << 20;
   d->shm = calloc(1, d->shm_size);
   if (!r || !d->shm)
      return false;
   r[BBGPU_REG_MAGIC / 4] = BBGPU_MAGIC; r[BBGPU_REG_VERSION / 4] = BBGPU_PROTO_VERSION;
   r[BBGPU_REG_STATUS / 4] = BBGPU_STATUS_READY; r[BBGPU_REG_SHM_SIZE / 4] = d->shm_size;
   d->regs = r;
   d->null = true;
   d->bar = d->shm; d->bar_size = d->shm_size; d->ring_size = BBGPU_RING_SIZE; d->slot = -1; d->slot_fd = -1;
   d->r_kick = &r[BBGPU_REG_KICK / 4]; d->r_fence = &r[BBGPU_REG_FENCE_DONE / 4]; d->r_tail = &r[BBGPU_REG_TAIL / 4];
   d->r_error = &r[BBGPU_REG_ERROR / 4]; d->r_errop = &r[BBGPU_REG_ERR_OP / 4]; d->r_reset = &r[BBGPU_REG_RESET / 4];
   d->heap = d->shm + BBGPU_RING_SIZE;
   d->heap_size = d->shm_size - BBGPU_RING_SIZE - BBGPU_LOG_SIZE;
   d->next_id = 1;
   return true;
}

bool bbgpu_dev_open(struct bbgpu_dev *d)
{
   char dev[512];
   memset(d, 0, sizeof *d);
   if (getenv("BBGPU_NULL"))
      return null_open(d);
   if (find_device(dev, sizeof dev))
      return false;
   d->regs = map_bar(dev, 0, 4096);
   if (!d->regs || d->regs[BBGPU_REG_MAGIC / 4] != BBGPU_MAGIC ||
       d->regs[BBGPU_REG_VERSION / 4] != BBGPU_PROTO_VERSION) {
      bbgpu_log("bbgpu: device at %s is not protocol v%d\n", dev, BBGPU_PROTO_VERSION);
      return false;
   }
   /* the renderer starts with the VM; give it a moment, and never use a device whose GL context failed */
   for (int i = 0; i < 300 && d->regs[BBGPU_REG_STATUS / 4] == BBGPU_STATUS_STARTING; i++)
      usleep(10000);
   if (d->regs[BBGPU_REG_STATUS / 4] != BBGPU_STATUS_READY) {
      bbgpu_log("bbgpu: the host renderer is not available (status %u); using software rendering\n",
              d->regs[BBGPU_REG_STATUS / 4]);
      munmap((void *)d->regs, 4096);
      d->regs = NULL;
      return false;
   }
   d->bar_size = d->regs[BBGPU_REG_SHM_SIZE / 4];
   d->bar = map_bar(dev, 2, d->bar_size);
   if (!d->bar)
      return false;
   volatile uint32_t *R = d->regs;
   uint32_t slots = R[BBGPU_REG_SLOTS / 4];
   d->slot = -1; d->slot_fd = -1;
   if (slots > 0 && slots <= BBGPU_MAX_SLOTS) {
      /* several clients: take a free slot (a lock file per slot - a crashed program's lock goes with it) */
      for (uint32_t i = 0; i < slots && d->slot < 0; i++) {
         char lp[64];
         snprintf(lp, sizeof lp, "%s/.bbgpu-slot-%u.lock", lock_dir(), i);
         int fd = open(lp, O_RDWR | O_CREAT | O_CLOEXEC, 0666);
         if (fd < 0)
            continue;
         fchmod(fd, 0666);             /* every program (any uid) may take this slot later */
         if (flock(fd, LOCK_EX | LOCK_NB)) { close(fd); continue; }
         d->slot = (int)i; d->slot_fd = fd;
      }
      if (d->slot < 0) {
         bbgpu_log("bbgpu: all %u GPU slots are in use; using software rendering\n", slots);
         munmap(d->bar, d->bar_size);
         return false;
      }
      volatile uint32_t *S = R + BBGPU_SLOT_REG(d->slot) / 4;
      d->r_kick = S + BBGPU_SREG_KICK / 4; d->r_fence = S + BBGPU_SREG_FENCE_DONE / 4; d->r_tail = S + BBGPU_SREG_TAIL / 4;
      d->r_error = S + BBGPU_SREG_ERROR / 4; d->r_errop = S + BBGPU_SREG_ERR_OP / 4; d->r_reset = S + BBGPU_SREG_RESET / 4;
      d->shm_size = d->bar_size / slots;
      d->shm = d->bar + (size_t)d->slot * d->shm_size;
      d->ring_size = BBGPU_SLOT_RING;
      /* waits poll the register mirror in shared memory (no device trap) */
      if (R[BBGPU_REG_CAPS / 4] & BBGPU_CAP_STATUS_MIRROR) {
         volatile uint32_t *mirror = (volatile uint32_t *)(d->shm + d->shm_size - BBGPU_LOG_SIZE);
         d->r_fence = mirror; d->r_tail = mirror + 1; d->r_error = mirror + 2;
         d->mirror = true;
      }
   } else {
      d->r_kick = R + BBGPU_REG_KICK / 4; d->r_fence = R + BBGPU_REG_FENCE_DONE / 4; d->r_tail = R + BBGPU_REG_TAIL / 4;
      d->r_error = R + BBGPU_REG_ERROR / 4; d->r_errop = R + BBGPU_REG_ERR_OP / 4; d->r_reset = R + BBGPU_REG_RESET / 4;
      d->shm_size = d->bar_size; d->shm = d->bar;
      d->ring_size = BBGPU_RING_SIZE;
   }
   *d->r_reset = 1;
   d->heap = d->shm + d->ring_size;
   d->heap_size = d->shm_size - d->ring_size - BBGPU_LOG_SIZE;
   d->next_id = 1;
   return true;
}

void bbgpu_dev_close(struct bbgpu_dev *d)
{
   if (d->null) {
      free(d->shm); free((void *)d->regs);
      memset(d, 0, sizeof *d);
      return;
   }
   if (d->bar)
      munmap(d->bar, d->bar_size);
   if (d->slot_fd >= 0)
      close(d->slot_fd);
   if (d->regs)
      munmap((void *)d->regs, 4096);
   memset(d, 0, sizeof *d);
}

static struct bbgpu_dev *the_dev;
static int the_dev_refs;
static pthread_mutex_t the_dev_lock = PTHREAD_MUTEX_INITIALIZER;

/* one GL client at a time (protocol v1 has a single context per device): an exclusive lock on a file;
 * a second client falls back to software rendering instead of resetting the device under the first */
static int the_lock_fd = -1;
static bool take_client_lock(void)
{
   if (the_lock_fd >= 0)
      return true;
   int fd = open("/tmp/.bbgpu-client.lock", O_RDWR | O_CREAT | O_CLOEXEC, 0666);
   if (fd < 0)
      return true;                      /* no /tmp: do not block rendering */
   if (flock(fd, LOCK_EX | LOCK_NB)) {
      close(fd);
      return false;
   }
   the_lock_fd = fd;
   return true;
}

struct bbgpu_dev *bbgpu_dev_get(void)
{
   pthread_mutex_lock(&the_dev_lock);
   if (!the_dev) {
      struct bbgpu_dev *d = calloc(1, sizeof *d);
      if (d && bbgpu_dev_open(d)) the_dev = d; else free(d);
      /* an engine without client slots has one ring: one GL program at a time */
      if (the_dev && the_dev->slot < 0 && !the_dev->null && !take_client_lock()) {
         bbgpu_log("bbgpu: another program is using the GPU; using software rendering\n");
         bbgpu_dev_close(the_dev); free(the_dev); the_dev = NULL;
      }
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
      if (the_lock_fd >= 0) { close(the_lock_fd); the_lock_fd = -1; }
   }
   pthread_mutex_unlock(&the_dev_lock);
}

uint32_t bbgpu_new_id(struct bbgpu_dev *d) { return d->next_id++; }
uint32_t bbgpu_dev_error(struct bbgpu_dev *d) { return (*d->r_error); }
const char *bbgpu_dev_log(struct bbgpu_dev *d)
{
   return (const char *)d->shm + d->shm_size - BBGPU_LOG_SIZE + (d->mirror ? BBGPU_SLOT_STATUS_BYTES : 0);
}

bool bbgpu_fence_done(struct bbgpu_dev *d, uint32_t fence)
{
   return (int32_t)((*d->r_fence) - fence) >= 0;
}

void bbgpu_fence_wait(struct bbgpu_dev *d, uint32_t fence)
{
   unsigned spins = 0;
   while (!bbgpu_fence_done(d, fence)) {
      if ((*d->r_error) == BBGPU_ERR_GL || (*d->r_error) == BBGPU_ERR_RING)
         return;                       /* the renderer stopped: do not hang the app */
      /* short waits spin; long ones sleep: a spinning vCPU is taken from the programs that are working */
      if (++spins > 2000)
         usleep(200);
      else if (spins > 64)
         sched_yield();
   }
}

static void kick(struct bbgpu_dev *d)
{
   __sync_synchronize();
   (*d->r_kick) = d->head;
   d->kicked = d->head;
   if (d->null) {                       /* everything "executes" at once */
      (*d->r_tail) = d->head;
      (*d->r_fence) = d->next_fence;
   }
}

/* ring space: the renderer's tail must not be lapped */
static void ring_wait(struct bbgpu_dev *d, uint32_t bytes)
{
   unsigned spins = 0;
   while (d->head + bytes - (*d->r_tail) > d->ring_size - 64) {
      if (d->kicked != d->head)
         kick(d);
      if ((*d->r_error) == BBGPU_ERR_GL || (*d->r_error) == BBGPU_ERR_RING)
         return;
      if (++spins > 2000) usleep(200); else sched_yield();
   }
}

void bbgpu_cmd(struct bbgpu_dev *d, uint32_t op, const uint32_t *payload, uint32_t n)
{
   uint32_t dw = 2 + n, at = d->head % d->ring_size;
   ring_wait(d, dw * 4 + 8);
   if (at + dw * 4 > d->ring_size) {
      /* a WRAP marker where it fits; with only 4 bytes left the reader wraps by itself (writing 8 bytes
         there would run into the heap) */
      if (at + 8 <= d->ring_size) {
         uint32_t pad[2] = { BBGPU_OP_WRAP, (d->ring_size - at) / 4 };
         memcpy(d->shm + at, pad, 8);
      }
      d->head += d->ring_size - at;
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
      bbgpu_log("bbgpu: transfer of %u bytes exceeds the heap\n", size);
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
      if ((*d->r_error) == BBGPU_ERR_GL || (*d->r_error) == BBGPU_ERR_RING)
         return 0;
   }
}
