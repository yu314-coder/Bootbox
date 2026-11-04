/*
 * SPDX-License-Identifier: GPL-2.0-or-later
 * Load/store for 128-bit atomic operations, generic version.
 *
 * Copyright (C) 2018, 2023 Linaro, Ltd.
 *
 * See docs/devel/atomics.rst for discussion about the guarantees each
 * atomic primitive is meant to provide.
 */

#ifndef HOST_ATOMIC128_LDST_H
#define HOST_ATOMIC128_LDST_H

#if defined(CONFIG_ATOMIC128)
# define HAVE_ATOMIC128_RO 1
# define HAVE_ATOMIC128_RW 1

static inline Int128 ATTRIBUTE_ATOMIC128_OPT
atomic16_read_ro(const Int128 *ptr)
{
    const __int128_t *ptr_align = __builtin_assume_aligned(ptr, 16);
    Int128Alias r;

    r.i = qatomic_read__nocheck(ptr_align);
    return r.s;
}

static inline Int128 ATTRIBUTE_ATOMIC128_OPT
atomic16_read_rw(Int128 *ptr)
{
    return atomic16_read_ro(ptr);
}

static inline void ATTRIBUTE_ATOMIC128_OPT
atomic16_set(Int128 *ptr, Int128 val)
{
    __int128_t *ptr_align = __builtin_assume_aligned(ptr, 16);
    Int128Alias v;

    v.s = val;
    qatomic_set__nocheck(ptr_align, v.i);
}

#elif defined(CONFIG_CMPXCHG128) || defined(__EMSCRIPTEN__)
/*
 * Bootbox (wasm32): 16-byte atomic loads/stores go through atomic128-cas.h's spinlock CAS.
 * Without this branch (meson does not set CONFIG_CMPXCHG128 for emscripten) every aligned
 * 16-byte load that must be atomic - e.g. the nonatomic cmpxchgo path that Linux SLUB's
 * per-cpu cmpxchg16b takes on every kmalloc/kfree - fell back to cpu_loop_exit_atomic: a
 * stop-the-world exclusive section, ~1.1 million of them per desktop boot. The CAS-read is a
 * pure read under the lock (atomic16_cmpxchg skips no-op stores).
 */
# define HAVE_ATOMIC128_RO 0
# define HAVE_ATOMIC128_RW 1

Int128 QEMU_ERROR("unsupported atomic") atomic16_read_ro(const Int128 *ptr);

static inline Int128 ATTRIBUTE_ATOMIC128_OPT
atomic16_read_rw(Int128 *ptr)
{
    /* Maybe replace 0 with 0, returning the old value.  */
    Int128 z = int128_make64(0);
    return atomic16_cmpxchg(ptr, z, z);
}

static inline void ATTRIBUTE_ATOMIC128_OPT
atomic16_set(Int128 *ptr, Int128 val)
{
#ifdef __EMSCRIPTEN__
    for (;;) {
        Int128 cur = *ptr;
        if (int128_eq(atomic16_cmpxchg(ptr, cur, val), cur)) {
            return;
        }
    }
#else
    Int128Aligned *ptr_align = __builtin_assume_aligned(ptr, 16);
    __int128_t old;
    Int128Alias new;

    new.s = val;
    do {
        old = *ptr_align;
    } while (!__sync_bool_compare_and_swap_16(ptr_align, old, new.i));
#endif
}

#else
# define HAVE_ATOMIC128_RO 0
# define HAVE_ATOMIC128_RW 0

/* Fallback definitions that must be optimized away, or error.  */
Int128 QEMU_ERROR("unsupported atomic") atomic16_read_ro(const Int128 *ptr);
Int128 QEMU_ERROR("unsupported atomic") atomic16_read_rw(Int128 *ptr);
void QEMU_ERROR("unsupported atomic") atomic16_set(Int128 *ptr, Int128 val);
#endif

#endif /* HOST_ATOMIC128_LDST_H */
