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
