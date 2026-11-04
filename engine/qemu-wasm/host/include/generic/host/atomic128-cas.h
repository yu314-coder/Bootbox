/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Compare-and-swap for 128-bit atomic operations, generic version.
 *
 * Copyright (C) 2018, 2023 Linaro, Ltd.
 *
 * See docs/devel/atomics.rst for discussion about the guarantees each
 * atomic primitive is meant to provide.
 */

#ifndef HOST_ATOMIC128_CAS_H
#define HOST_ATOMIC128_CAS_H

#if defined(CONFIG_ATOMIC128)
static inline Int128 ATTRIBUTE_ATOMIC128_OPT
atomic16_cmpxchg(Int128 *ptr, Int128 cmp, Int128 new)
{
    __int128_t *ptr_align = __builtin_assume_aligned(ptr, 16);
    Int128Alias r, c, n;

    c.s = cmp;
    n.s = new;
    r.i = qatomic_cmpxchg__nocheck(ptr_align, c.i, n.i);
    return r.s;
}
# define HAVE_CMPXCHG128 1
#elif defined(CONFIG_CMPXCHG128)
static inline Int128 ATTRIBUTE_ATOMIC128_OPT
atomic16_cmpxchg(Int128 *ptr, Int128 cmp, Int128 new)
{
    Int128Aligned *ptr_align = __builtin_assume_aligned(ptr, 16);
    Int128Alias r, c, n;

    c.s = cmp;
    n.s = new;
    r.i = __sync_val_compare_and_swap_16(ptr_align, c.i, n.i);
    return r.s;
}
# define HAVE_CMPXCHG128 1
#elif defined(__EMSCRIPTEN__)
/*
 * wasm32 has no 128-bit atomics, and the EXCP_ATOMIC fallback turns every
 * guest cmpxchg16b into a stop-the-world exclusive section — Windows/wine
 * x64 code leans on cmpxchg16b for its lock-free SLISTs (loader work queues,
 * LFH heap lookasides), which serialized every allocation against ALL vCPUs
 * and froze wine outright.  Emulate it with one global spinlock instead:
 * CAS-vs-CAS atomicity is preserved (all mutators funnel through the lock),
 * and a plain racing 16-byte read can tear exactly like it can on real x86
 * hardware doing two 8-byte loads — the SLIST sequence counter exists to
 * tolerate that.  Hold time is ~30 host instructions, so contention is
 * cheap; vastly cheaper than parking every vCPU per op.
 */
extern unsigned qemu_wasm128_lock;

static inline Int128 atomic16_cmpxchg(Int128 *ptr, Int128 cmp, Int128 new)
{
    Int128 *ptr_align = __builtin_assume_aligned(ptr, 16);
    Int128 old;

    while (qatomic_xchg(&qemu_wasm128_lock, 1u)) {
        /* spin — hold times are tens of instructions */
    }
    old = *ptr_align;
    /*
     * Skip the store when the value would not change.  This is not an
     * optimization but a CORRECTNESS requirement for the CAS-read idiom
     * (atomic16_cmpxchg(p, 0, 0) in load_atom_16 & co): plain stores do
     * not take this lock, so writing old-equals-new back would clobber a
     * plain store that landed between our read and our write-back — on
     * real hardware the compare and store are one indivisible bus-locked
     * operation, so that interleaving cannot happen.  Skipping the no-op
     * store makes CAS-reads pure reads.  (Linux SLUB keeps NULL freelist
     * heads, so the 0->0 clobber corrupted freelists 0.5s into boot.)
     */
    if (int128_eq(old, cmp) && !int128_eq(old, new)) {
        *ptr_align = new;
    }
    qatomic_store_release(&qemu_wasm128_lock, 0u);
    return old;
}
# define HAVE_CMPXCHG128 1
#else
/* Fallback definition that must be optimized away, or error.  */
Int128 QEMU_ERROR("unsupported atomic")
    atomic16_cmpxchg(Int128 *ptr, Int128 cmp, Int128 new);
# define HAVE_CMPXCHG128 0
#endif

#endif /* HOST_ATOMIC128_CAS_H */
