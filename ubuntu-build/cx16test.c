/* cx16test — cmpxchg16b micro-probe for the Bootbox QEMU-Wasm engine.
 *
 * WHY: qemu64 advertises CX16, so wine's x64 lock-free SLISTs (heap/loader) execute
 * `lock cmpxchg16b`. The wasm32 TCG backend has no 128-bit atomics, so each one takes
 * TCG's EXCP_ATOMIC stop-the-world exclusive path. If that path is pathologically slow
 * (or stalls against the idle-sleep worker patches), wine freezes exactly the way we
 * saw on-device — while pure-Linux code (xterm, python) never touches 16-byte atomics.
 *
 * The 16-byte CAS is explicit inline asm (NOT __atomic builtins) so the instruction is
 * guaranteed present — the build asserts it via objdump. Time-boxed (~2s per bench) so
 * it can't hang the console even at 100 ops/s.
 * Build: gcc -O2 -mcx16 -static -pthread
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdint.h>
#include <pthread.h>
#include <time.h>

static double now(void) {
    struct timespec ts; clock_gettime(CLOCK_MONOTONIC, &ts);
    return ts.tv_sec + ts.tv_nsec / 1e9;
}

typedef struct { uint64_t lo, hi; } __attribute__((aligned(16))) u128;
static u128 g16;
static uint64_t g8;
static volatile int stop2;
static uint64_t thr_ops[2];

/* lock cmpxchg16b m128: compares RDX:RAX with m128; if equal, stores RCX:RBX. */
static inline int cas16(u128 *p, u128 *expected, uint64_t nlo, uint64_t nhi) {
    unsigned char ok;
    __asm__ __volatile__("lock cmpxchg16b %1"
        : "=@ccz"(ok), "+m"(*p), "+a"(expected->lo), "+d"(expected->hi)
        : "b"(nlo), "c"(nhi)
        : "memory");
    return ok;
}

#define BOX 2.0  /* seconds per bench */

static double bench8(void) {
    uint64_t n = 0; double t0 = now();
    while (now() - t0 < BOX) {
        for (int i = 0; i < 4096; i++) {
            uint64_t e = g8;
            __atomic_compare_exchange_n(&g8, &e, e + 1, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST);
        }
        n += 4096;
    }
    return n / (now() - t0);
}

static double bench16(void) {
    uint64_t n = 0; double t0 = now();
    while (now() - t0 < BOX) {
        for (int i = 0; i < 64; i++) {   /* small inner block: each op may cost ms */
            u128 e = g16;
            cas16(&g16, &e, e.lo + 1, e.hi);
        }
        n += 64;
    }
    return n / (now() - t0);
}

static void *thr16(void *a) {
    int idx = (int)(uintptr_t)a;
    uint64_t n = 0;
    while (!stop2) {
        u128 e = g16;
        cas16(&g16, &e, e.lo + 1, e.hi);
        n++;
    }
    thr_ops[idx] = n;
    return 0;
}

int main(void) {
    setvbuf(stdout, 0, _IONBF, 0);
    printf("== cx16 engine probe ==\n");

    double r8 = bench8();
    printf("8-byte  lock cmpxchg : %11.0f ops/s (baseline)\n", r8);

    double r16 = bench16();
    printf("16-byte cmpxchg16b   : %11.0f ops/s (1 thread)\n", r16);

    /* 2-thread contended: this is the wine-like case (SLIST push/pop races). */
    pthread_t a, b; stop2 = 0;
    pthread_create(&a, 0, thr16, (void *)0); pthread_create(&b, 0, thr16, (void *)1);
    double t0 = now();
    struct timespec ts = { 2, 0 }; nanosleep(&ts, 0);
    stop2 = 1;
    pthread_join(a, 0); pthread_join(b, 0);
    double d2 = now() - t0;
    double r2 = (thr_ops[0] + thr_ops[1]) / d2;
    printf("16-byte cmpxchg16b   : %11.0f ops/s (2 threads contended)\n", r2);

    double ratio = r16 > 0 ? r8 / r16 : 1e9;
    printf("cx16 penalty vs 8-byte CAS: %.0fx\n", ratio);
    if (ratio > 500 || r2 < 2000)
        printf("VERDICT: ENGINE STOP-THE-WORLD IS THE WINE KILLER (fix qemu-wasm exclusive path)\n");
    else if (ratio > 50)
        printf("VERDICT: cx16 heavy but survivable — wine slowness partly engine, keep esync test\n");
    else
        printf("VERDICT: engine atomics fine — wine hang is wine-side (sync model), esync is the fix\n");
    return 0;
}
