/* bbgpu-test.c - guest-side transport test for the Bootbox GPU bridge (phase 1).
 * Finds the bbgpu PCI device, maps BAR0 (registers) and BAR2 (ring + heap) from userspace, then measures
 * command round trips (FENCE) and heap traffic (ECHO). Build: static, x86_64. SPDX-License-Identifier: MIT */
#include <dirent.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <time.h>
#include <unistd.h>
#include "../bbgpu_proto.h"

static volatile uint32_t *regs;
static uint8_t *shm;
static uint32_t head;  /* ring write position (bytes, monotonic) */

static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec * 1e-9; }

static int find_dev(char *path, size_t n)
{
    DIR *d = opendir("/sys/bus/pci/devices");
    struct dirent *e;
    while (d && (e = readdir(d))) {
        char p[512], buf[32]; FILE *f;
        snprintf(p, sizeof p, "/sys/bus/pci/devices/%s/vendor", e->d_name);
        if (!(f = fopen(p, "r"))) continue;
        int ok = fgets(buf, sizeof buf, f) && strtoul(buf, 0, 16) == BBGPU_PCI_VENDOR;
        fclose(f);
        if (ok) { snprintf(path, n, "/sys/bus/pci/devices/%s", e->d_name); closedir(d); return 0; }
    }
    if (d) closedir(d);
    return -1;
}

static void *map_bar(const char *dev, int bar, size_t len)
{
    char p[600]; snprintf(p, sizeof p, "%s/resource%d", dev, bar);
    int fd = open(p, O_RDWR | O_SYNC);
    if (fd < 0) { perror(p); exit(1); }
    void *m = mmap(0, len, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (m == MAP_FAILED) { perror("mmap"); exit(1); }
    return m;
}

static void emit(uint32_t op, const uint32_t *payload, uint32_t n)
{
    uint32_t dw = 2 + n, at = head % BBGPU_RING_SIZE;
    if (at + dw * 4 > BBGPU_RING_SIZE) {               /* pad to the end, continue at 0 */
        uint32_t pad[2] = { BBGPU_OP_WRAP, (BBGPU_RING_SIZE - at) / 4 };
        memcpy(shm + at, pad, 8); head += BBGPU_RING_SIZE - at; at = 0;
    }
    uint32_t h[2] = { op, dw };
    memcpy(shm + at, h, 8); memcpy(shm + at + 8, payload, n * 4); head += dw * 4;
}
static void kick(void) { __sync_synchronize(); regs[BBGPU_REG_KICK / 4] = head; }
static void wait_fence(uint32_t id) { while (regs[BBGPU_REG_FENCE_DONE / 4] != id) ; }

int main(int argc, char **argv)
{
    char dev[512];
    if (find_dev(dev, sizeof dev)) { printf("bbgpu: no device\n"); return 1; }
    regs = map_bar(dev, 0, 4096);
    if (regs[BBGPU_REG_MAGIC / 4] != BBGPU_MAGIC) { printf("bbgpu: bad magic %08x\n", regs[0]); return 1; }
    uint32_t shm_size = regs[BBGPU_REG_SHM_SIZE / 4];
    shm = map_bar(dev, 2, shm_size);
    regs[BBGPU_REG_RESET / 4] = 1; head = 0;
    printf("bbgpu: %s, protocol v%u, shared %u MB (ring %u KB)\n", dev, regs[BBGPU_REG_VERSION / 4], shm_size >> 20, BBGPU_RING_SIZE >> 10);

    /* 1) round trips: FENCE, kick, wait */
    uint32_t fence = 0; int N = argc > 1 ? atoi(argv[1]) : 2000;
    double t0 = now();
    for (int i = 0; i < N; i++) { uint32_t id = ++fence; emit(BBGPU_OP_FENCE, &id, 1); kick(); wait_fence(id); }
    double rt = (now() - t0) / N;
    printf("bbgpu: round trip %.1f us (%d fences)\n", rt * 1e6, N);

    /* 2) batched: 1000 NOPs + fence per kick */
    t0 = now();
    for (int k = 0; k < 50; k++) { for (int i = 0; i < 1000; i++) emit(BBGPU_OP_NOP, 0, 0); uint32_t id = ++fence; emit(BBGPU_OP_FENCE, &id, 1); kick(); wait_fence(id); }
    printf("bbgpu: %.2f us per batched command\n", (now() - t0) / 50050 * 1e6);

    /* 3) heap traffic: guest writes 1 MB, host ECHOes it, guest verifies */
    uint8_t *heap = shm + BBGPU_RING_SIZE; uint32_t M = 1 << 20;
    for (uint32_t i = 0; i < M; i++) heap[i] = (uint8_t)(i * 7 + 3);
    t0 = now();
    for (int k = 0; k < 64; k++) { uint32_t a[3] = { 0, M, M }; emit(BBGPU_OP_ECHO, a, 3); uint32_t id = ++fence; emit(BBGPU_OP_FENCE, &id, 1); kick(); wait_fence(id); }
    double tt = now() - t0;
    int bad = 0; for (uint32_t i = 0; i < M; i++) bad += heap[M + i] != (uint8_t)(i * 7 + 3);
    printf("bbgpu: echo 64 x 1 MB in %.3f s (%.0f MB/s host copy), %s, error=%u ops=%u\n",
           tt, 64 / tt, bad ? "DATA MISMATCH" : "data ok", regs[BBGPU_REG_ERROR / 4], regs[BBGPU_REG_OPS / 4]);
    return bad != 0;
}
