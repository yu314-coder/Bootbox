/*
 *  x86 memory access helpers
 *
 *  Copyright (c) 2003 Fabrice Bellard
 *
 * This library is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * This library is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with this library; if not, see <http://www.gnu.org/licenses/>.
 */

#include "qemu/osdep.h"
#include "cpu.h"
#include "exec/helper-proto.h"
#include "exec/exec-all.h"
#include "exec/cpu_ldst.h"
#include "qemu/int128.h"
#include "qemu/atomic128.h"
#include "tcg/tcg.h"
#include "helper-tcg.h"

void helper_boundw(CPUX86State *env, target_ulong a0, int v)
{
    int low, high;

    low = cpu_ldsw_data_ra(env, a0, GETPC());
    high = cpu_ldsw_data_ra(env, a0 + 2, GETPC());
    v = (int16_t)v;
    if (v < low || v > high) {
        if (env->hflags & HF_MPX_EN_MASK) {
            env->bndcs_regs.sts = 0;
        }
        raise_exception_ra(env, EXCP05_BOUND, GETPC());
    }
}

void helper_boundl(CPUX86State *env, target_ulong a0, int v)
{
    int low, high;

    low = cpu_ldl_data_ra(env, a0, GETPC());
    high = cpu_ldl_data_ra(env, a0 + 4, GETPC());
    if (v < low || v > high) {
        if (env->hflags & HF_MPX_EN_MASK) {
            env->bndcs_regs.sts = 0;
        }
        raise_exception_ra(env, EXCP05_BOUND, GETPC());
    }
}

#ifdef __EMSCRIPTEN__
/*
 * wasm32-only: LOCK CMPXCHG16B via an all-scalar helper call.
 *
 * The generic path (tcg_gen_atomic_cmpxchg_i128 -> gen_helper_atomic_cmpxchgo_le)
 * passes and returns Int128 values through the TCG-emitted call itself; that
 * marshaling had never executed on the wasm32 backend before HAVE_CMPXCHG128
 * was enabled here.  Keep every TCG-visible value scalar (env, addr, oi) and do
 * the Int128 work in plain C, like s390x's CDSG helper: operands come from the
 * guest regs, the CAS runs through cpu_atomic_cmpxchgo_le_mmu (backed by the
 * spinlock atomic16_cmpxchg), and RDX:RAX + ZF are written straight into env.
 *
 * gen_cmpxchg16b() runs gen_compute_eflags() first, so cc_op is CC_OP_EFLAGS
 * and the live flags sit in env->cc_src — updating Z there is enough.  Default
 * helper flags (writes globals) make translated code reload RAX/RDX/cc_src.
 */
void helper_cmpxchg16b_locked(CPUX86State *env, target_ulong a0, uint32_t oi)
{
    uintptr_t ra = GETPC();
    Int128 cmpv = int128_make128(env->regs[R_EAX], env->regs[R_EDX]);
    Int128 newv = int128_make128(env->regs[R_EBX], env->regs[R_ECX]);
    Int128 oldv = cpu_atomic_cmpxchgo_le_mmu(env, a0, cmpv, newv, oi, ra);

    if (int128_eq(oldv, cmpv)) {
        env->cc_src |= CC_Z;
    } else {
        env->cc_src &= ~(target_ulong)CC_Z;
        env->regs[R_EAX] = int128_getlo(oldv);
        env->regs[R_EDX] = int128_gethi(oldv);
    }
}
#endif

/*
 * Bootbox: bulk REP MOVS / REP STOS. TCG runs a rep string instruction one iteration per TB
 * execution (gen_repz jumps back to the instruction itself), so a 4 KiB memset is 512-4096 TB
 * exits + re-entries - each a dispatcher or chained call in the wasm engine (~20 ns). In glmark2 a
 * third of all guest instructions in the clear scene were such iterations (memcpy of frames, the
 * kernel's clear_page and copy_user). This helper runs, in one call, every iteration that cannot
 * fault or touch I/O: forward direction (DF=0), both pages resident in the softmmu TLB as plain RAM
 * (tlb_vaddr_to_host refuses MMIO, watchpoints and not-dirty pages - code pages under SMC tracking,
 * VGA dirty logging - and a probe never raises a guest fault), elements not straddling a page.
 * It stops at the first page it cannot take; the TB's ordinary single iteration then handles that
 * one (with precise faults) and loops back here. Registers are updated exactly as if the
 * iterations had run one by one, so an interrupt or fault in between sees consistent state.
 *   info: [1:0] element size (MemOp), [3:2] address size (MO_32/MO_64), [4] movs (else stos),
 *         [5] 64-bit code segment, [15:8] mmu index
 * MOVS overlap: x86 copies element by element forward, so dst inside (src, src+len) replicates a
 * pattern; such chunks are cut to the overlap distance, which reproduces it exactly (judged on
 * host addresses, so two guest pages aliasing one host page are handled too).
 */
static void rep_bulk_fill(uint8_t *d, uint64_t v, int ot, size_t n)
{
    size_t bytes = n << ot;
    uint64_t rep8 = (uint8_t)v * 0x0101010101010101ull;
    uint64_t mask = ot == MO_64 ? ~0ull : (1ull << (8 << ot)) - 1;
    size_t i;

    if ((v & mask) == (rep8 & mask)) {
        memset(d, (uint8_t)v, bytes);
        return;
    }
    switch (ot) {
    case MO_16:
        for (i = 0; i < bytes; i += 2) {
            stw_le_p(d + i, v);
        }
        break;
    case MO_32:
        for (i = 0; i < bytes; i += 4) {
            stl_le_p(d + i, v);
        }
        break;
    default:
        for (i = 0; i < bytes; i += 8) {
            stq_le_p(d + i, v);
        }
        break;
    }
}

void helper_rep_bulk(CPUX86State *env, target_ulong dst, target_ulong src, uint32_t info)
{
    int ot = info & 3;
    int aflag = (info >> 2) & 3;
    bool movs = info & 16, code64 = info & 32;
    int mmu_idx = (info >> 8) & 0xff;
    target_ulong amask = aflag == MO_64 ? ~(target_ulong)0 : 0xffffffffu;
    uint64_t cnt = env->regs[R_ECX] & amask;
    uint64_t done = 0, lim;
    int chunks = 64;

    if (env->df != 1 || cnt == 0) {
        return;
    }
    /*
     * 32-bit addressing: the offset registers wrap at 4 GiB, and outside 64-bit code so does the
     * linear address. Never cross either, so dst/src stay contiguous for the whole call.
     */
    lim = cnt;
    if (aflag != MO_64) {
        lim = MIN(lim, (0x100000000ull - (env->regs[R_EDI] & 0xffffffffu)) >> ot);
        if (movs) {
            lim = MIN(lim, (0x100000000ull - (env->regs[R_ESI] & 0xffffffffu)) >> ot);
        }
        if (!code64) {
            lim = MIN(lim, (0x100000000ull - (uint32_t)dst) >> ot);
            if (movs) {
                lim = MIN(lim, (0x100000000ull - (uint32_t)src) >> ot);
            }
        }
    }
    while (done < lim && chunks-- > 0) {
        uint64_t n = lim - done;
        uint8_t *hd, *hs = NULL;

        n = MIN(n, (TARGET_PAGE_SIZE - (dst & ~TARGET_PAGE_MASK)) >> ot);
        if (movs) {
            n = MIN(n, (TARGET_PAGE_SIZE - (src & ~TARGET_PAGE_MASK)) >> ot);
        }
        if (n == 0) {
            break;                                  /* an element straddles a page */
        }
        if (movs) {
            hs = tlb_vaddr_to_host(env, src, MMU_DATA_LOAD, mmu_idx);
            if (!hs) {
                break;
            }
        }
        hd = tlb_vaddr_to_host(env, dst, MMU_DATA_STORE, mmu_idx);
        if (!hd) {
            break;
        }
        if (movs) {
            if (hd > hs && hd < hs + (n << ot)) {
                n = MIN(n, (uint64_t)(hd - hs) >> ot);   /* forward overlap: pattern replication */
                if (n == 0) {
                    break;                          /* elements overlap themselves: slow path */
                }
            }
            memmove(hd, hs, n << ot);
            src += n << ot;
        } else {
            rep_bulk_fill(hd, env->regs[R_EAX], ot, n);
        }
        dst += n << ot;
        done += n;
    }
    if (done) {
        env->regs[R_ECX] = (env->regs[R_ECX] - done) & amask;
        env->regs[R_EDI] = (env->regs[R_EDI] + (done << ot)) & amask;
        if (movs) {
            env->regs[R_ESI] = (env->regs[R_ESI] + (done << ot)) & amask;
        }
    }
}
