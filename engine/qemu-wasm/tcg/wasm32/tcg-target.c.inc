/*
 * Tiny Code Generator for QEMU
 *
 * Copyright (c) 2018 SiFive, Inc
 * Copyright (c) 2008-2009 Arnaud Patard <arnaud.patard@rtp-net.org>
 * Copyright (c) 2009 Aurelien Jarno <aurelien@aurel32.net>
 * Copyright (c) 2008 Fabrice Bellard
 * Copyright (c) 2009, 2011 Stefan Weil
 *
 * Based on riscv/tcg-target.c.inc and tci/tcg-target.c
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
 * THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

#include "../wasm32.h"
#include <emscripten.h>
#include <ffi.h>
#include "../tcg-pool.c.inc"

static TCGConstraintSetIndex tcg_target_op_def(TCGOpcode op)
{
    switch (op) {
    case INDEX_op_goto_ptr:
        return C_O0_I1(r);

    case INDEX_op_ld8u_i32:
    case INDEX_op_ld8s_i32:
    case INDEX_op_ld16u_i32:
    case INDEX_op_ld16s_i32:
    case INDEX_op_ld_i32:
    case INDEX_op_ld8u_i64:
    case INDEX_op_ld8s_i64:
    case INDEX_op_ld16u_i64:
    case INDEX_op_ld16s_i64:
    case INDEX_op_ld32u_i64:
    case INDEX_op_ld32s_i64:
    case INDEX_op_ld_i64:
    case INDEX_op_not_i32:
    case INDEX_op_not_i64:
    case INDEX_op_neg_i32:
    case INDEX_op_neg_i64:
    case INDEX_op_ext8s_i32:
    case INDEX_op_ext8s_i64:
    case INDEX_op_ext16s_i32:
    case INDEX_op_ext16s_i64:
    case INDEX_op_ext8u_i32:
    case INDEX_op_ext8u_i64:
    case INDEX_op_ext16u_i32:
    case INDEX_op_ext16u_i64:
    case INDEX_op_ext32s_i64:
    case INDEX_op_ext32u_i64:
    case INDEX_op_ext_i32_i64:
    case INDEX_op_extu_i32_i64:
    case INDEX_op_bswap16_i32:
    case INDEX_op_bswap16_i64:
    case INDEX_op_bswap32_i32:
    case INDEX_op_bswap32_i64:
    case INDEX_op_bswap64_i64:
    case INDEX_op_extract_i32:
    case INDEX_op_extract_i64:
    case INDEX_op_sextract_i32:
    case INDEX_op_sextract_i64:
    case INDEX_op_extrl_i64_i32:
    case INDEX_op_extrh_i64_i32:
    case INDEX_op_ctpop_i32:
    case INDEX_op_ctpop_i64:
        return C_O1_I1(r, r);

    case INDEX_op_st8_i32:
    case INDEX_op_st16_i32:
    case INDEX_op_st_i32:
    case INDEX_op_st8_i64:
    case INDEX_op_st16_i64:
    case INDEX_op_st32_i64:
    case INDEX_op_st_i64:
        return C_O0_I2(r, r);

    case INDEX_op_div_i32:
    case INDEX_op_div_i64:
    case INDEX_op_divu_i32:
    case INDEX_op_divu_i64:
    case INDEX_op_rem_i32:
    case INDEX_op_rem_i64:
    case INDEX_op_remu_i32:
    case INDEX_op_remu_i64:
    case INDEX_op_add_i32:
    case INDEX_op_add_i64:
    case INDEX_op_sub_i32:
    case INDEX_op_sub_i64:
    case INDEX_op_mul_i32:
    case INDEX_op_mul_i64:
    case INDEX_op_and_i32:
    case INDEX_op_and_i64:
    case INDEX_op_andc_i32:
    case INDEX_op_andc_i64:
    case INDEX_op_eqv_i32:
    case INDEX_op_eqv_i64:
    case INDEX_op_nand_i32:
    case INDEX_op_nand_i64:
    case INDEX_op_nor_i32:
    case INDEX_op_nor_i64:
    case INDEX_op_or_i32:
    case INDEX_op_or_i64:
    case INDEX_op_orc_i32:
    case INDEX_op_orc_i64:
    case INDEX_op_xor_i32:
    case INDEX_op_xor_i64:
    case INDEX_op_shl_i32:
    case INDEX_op_shl_i64:
    case INDEX_op_shr_i32:
    case INDEX_op_shr_i64:
    case INDEX_op_sar_i32:
    case INDEX_op_sar_i64:
    case INDEX_op_rotl_i32:
    case INDEX_op_rotl_i64:
    case INDEX_op_rotr_i32:
    case INDEX_op_rotr_i64:
    case INDEX_op_setcond_i32:
    case INDEX_op_setcond_i64:
    case INDEX_op_deposit_i32:
    case INDEX_op_deposit_i64:
    case INDEX_op_clz_i32:
    case INDEX_op_clz_i64:
    case INDEX_op_ctz_i32:
    case INDEX_op_ctz_i64:
        return C_O1_I2(r, r, r);

    case INDEX_op_brcond_i32:
    case INDEX_op_brcond_i64:
        return C_O0_I2(r, r);

    case INDEX_op_add2_i32:
    case INDEX_op_add2_i64:
    case INDEX_op_sub2_i32:
    case INDEX_op_sub2_i64:
        return C_O2_I4(r, r, r, r, r, r);

    case INDEX_op_mulu2_i32:
    case INDEX_op_mulu2_i64:
    case INDEX_op_muls2_i32:
    case INDEX_op_muls2_i64:
        return C_O2_I2(r, r, r, r);

    case INDEX_op_movcond_i32:
    case INDEX_op_movcond_i64:
        return C_O1_I4(r, r, r, r, r);

    case INDEX_op_setcond2_i32:
        return C_O1_I4(r, r, r, r, r);
    case INDEX_op_brcond2_i32:
        return C_O0_I4(r, r, r, r);

    case INDEX_op_qemu_ld_a32_i32:
    case INDEX_op_qemu_ld_a64_i32:
        return C_O1_I1(r, r);

    case INDEX_op_qemu_ld_a32_i64:
    case INDEX_op_qemu_ld_a64_i64:
        return C_O1_I1(r, r);
    case INDEX_op_qemu_st_a32_i32:
    case INDEX_op_qemu_st_a64_i32:
        return C_O0_I2(r, r);
    case INDEX_op_qemu_st_a32_i64:
    case INDEX_op_qemu_st_a64_i64:
        return C_O0_I2(r, r);

    case INDEX_op_muluh_i32:
    case INDEX_op_mulsh_i32:
        return C_O1_I2(r, r, r);
    case INDEX_op_extract2_i32:
    case INDEX_op_extract2_i64:
        return C_O1_I2(r, r, r);

    default:
        g_assert_not_reached();
    }
}

static const int tcg_target_reg_alloc_order[TCG_TARGET_NB_REGS] = {
    TCG_REG_R0,
    TCG_REG_R1,
    TCG_REG_R2,
    TCG_REG_R3,
    TCG_REG_R4,
    TCG_REG_R5,
    TCG_REG_R6,
    TCG_REG_R7,
    TCG_REG_R8,
    TCG_REG_R9,
    TCG_REG_R10,
    TCG_REG_R11,
    TCG_REG_R12,
    TCG_REG_R13,
    TCG_REG_R14,
    TCG_REG_R15,
};

#define NUM_OF_IARG_REGS 5
static const int tcg_target_call_iarg_regs[NUM_OF_IARG_REGS] = {
   TCG_REG_R8,
   TCG_REG_R9,
   TCG_REG_R10,
   TCG_REG_R11,
   TCG_REG_R12,
};

static TCGReg tcg_target_call_oarg_reg(TCGCallReturnKind kind, int slot)
{
    tcg_debug_assert(kind == TCG_CALL_RET_NORMAL);
    tcg_debug_assert(slot >= 0 && slot < 128 / TCG_TARGET_REG_BITS);
    return TCG_REG_R0 + slot;
}

#ifdef CONFIG_DEBUG_TCG
static const char *const tcg_target_reg_names[TCG_TARGET_NB_REGS] = {
    "r00",
    "r01",
    "r02",
    "r03",
    "r04",
    "r05",
    "r06",
    "r07",
    "r08",
    "r09",
    "r10",
    "r11",
    "r12",
    "r13",
    "r14",
    "r15",
};
#endif

#define REG_INDEX_IARG_BASE 8
static const uint8_t tcg_target_reg_index[TCG_TARGET_NB_REGS] = {
    0, // TCG_REG_R0
    1, // TCG_REG_R1
    2, // TCG_REG_R2
    3, // TCG_REG_R3
    4, // TCG_REG_R4
    5, // TCG_REG_R5
    6, // TCG_REG_R6
    7, // TCG_REG_R7
    8, // TCG_REG_R8
    9, // TCG_REG_R9
    10, // TCG_REG_R10
    11, // TCG_REG_R11
    12, // TCG_REG_R12
    13, // TCG_REG_R13
    14, // TCG_REG_R14
    15, // TCG_REG_R15
};

#define BLOCK_PTR_IDX 16

#define CTX_IDX 0
#define TMP32_LOCAL_ENV_IDX 1
#define TMP32_LOCAL_0_IDX 2
#define TMP64_0_IDX 3
#define TMP64_1_IDX 4
#define TMP64_2_IDX 5
#define TMP64_3_IDX 6
#define TMP64_4_IDX 7

/*
 * Bootbox: TCG host registers live in wasm LOCALS (REG_LOCAL_BASE + reg), the block pointer in
 * BP_LOCAL_IDX. They used to be module globals - every register read/write a memory access the
 * browser can't keep in a machine register across the guest loads/stores around it (JSC 2x, V8 4x
 * slower on a TB-shaped microbenchmark). Globals were only needed because a TB is RESUMABLE: a
 * helper may unwind the wasm stack (coroutine fiber switch) and the TB is re-entered at the saved
 * block with fresh locals. So before every call that may unwind, the registers written so far are
 * spilled to their globals (and the resume block to global BLOCK_PTR_IDX); the prologue reloads
 * them only on a resume entry (do_init == 0). Pure helpers (inlined-float slow paths) never
 * unwind and need no spill. tune "regloc=0" restores the all-globals code.
 */
#define REG_LOCAL_BASE 8
#define BP_LOCAL_IDX 24
__thread uint32_t regs_written;

__thread bool env_cached = false;

// function index
#define RETURN_CALL_IDX 0
#define FUNC_HELPER_CALL_IDX 1
#define FUNC_CALL_LD_HELPER_IDX 2
#define FUNC_CALL_ST_HELPER_IDX 3

// table index
#define HELPER_TABLE_IDX 0

static inline void tcg_wasm_out8(TCGContext *s, uint32_t v)
{
    tcg_sub_out8(s, v);
}

static uintptr_t cur_wasm_ptr(TCGContext *s)
{
    return (uintptr_t)cur_sub_buf_ptr();
}

static void tcg_wasm_out_leb128_sint32_t(TCGContext *s, int32_t v) {
    bool more = true;
    bool negative = (v < 0);
    uint8_t b;
    uint32_t low7 = 0x7f;
    uint32_t uv = v;
    while (more) {
        b = uv & low7;
        uv >>= 7;
        if (negative)
            uv |= (~0 << (32 - 7));
        if (((uv == 0) && ((b & 0x40) == 0)) || ((uv == -1) && ((b & 0x40) != 0)))
            more = false;
        else
            b |= 0x80;
        tcg_wasm_out8(s, b);
    }
}

static void tcg_wasm_out_leb128_sint64_t(TCGContext *s, int64_t v) {
    bool more = true;
    bool negative = (v < 0);
    uint8_t b;
    uint64_t low7 = 0x7f;
    uint64_t uv = v;
    while (more) {
        b = uv & low7;
        uv >>= 7;
        if (negative)
            uv |= ((int64_t)(~0) << (64 - 7));
        if (((uv == 0) && ((b & 0x40) == 0)) || (((int64_t)uv == -1) && ((b & 0x40) != 0)))
            more = false;
        else
            b |= 0x80;
        tcg_wasm_out8(s, b);
    }
}

static void tcg_wasm_out_leb128_uint32_t(TCGContext *s, uint32_t v) {
    uint32_t low7 = 0x7f;
    uint8_t b;
    do {
        b = v & low7;
        v >>= 7;
        if (v != 0)
            b |= 0x80;
        tcg_wasm_out8(s, b);
    } while (v != 0);
}

static void tcg_wasm_out_op_br(TCGContext *s, int i)
{
    tcg_wasm_out8(s, 0x0c);
    tcg_wasm_out8(s, i);
}

static void tcg_wasm_out_op_if_noret(TCGContext *s)
{
    tcg_wasm_out8(s, 0x04);
    tcg_wasm_out8(s, 0x40);
}

static void tcg_wasm_out_op_if_ret_i64(TCGContext *s)
{
    tcg_wasm_out8(s, 0x04);
    tcg_wasm_out8(s, 0x7e);
}

static void tcg_wasm_out_op_if_ret_i32(TCGContext *s)
{
    tcg_wasm_out8(s, 0x04);
    tcg_wasm_out8(s, 0x7f);
}

static void tcg_wasm_out_op_else(TCGContext *s)
{
    tcg_wasm_out8(s, 0x05);
}

static void tcg_wasm_out_op_end(TCGContext *s)
{
    tcg_wasm_out8(s, 0x0b);
}

static void tcg_wasm_out_op_i32_eqz(TCGContext *s){ tcg_wasm_out8(s, 0x45); }
static void tcg_wasm_out_op_i32_eq(TCGContext *s){ tcg_wasm_out8(s, 0x46); }
static void tcg_wasm_out_op_i32_and(TCGContext *s){ tcg_wasm_out8(s, 0x71); }
static void tcg_wasm_out_op_i32_or(TCGContext *s){ tcg_wasm_out8(s, 0x72); }
//static void tcg_wasm_out_op_i32_xor(TCGContext *s){ tcg_wasm_out8(s, 0x73); }
static void tcg_wasm_out_op_i32_shl(TCGContext *s){ tcg_wasm_out8(s, 0x74); }
static void tcg_wasm_out_op_i32_shr_s(TCGContext *s){ tcg_wasm_out8(s, 0x75); }
static void tcg_wasm_out_op_i32_shr_u(TCGContext *s){ tcg_wasm_out8(s, 0x76); }
static void tcg_wasm_out_op_i32_rotl(TCGContext *s){ tcg_wasm_out8(s, 0x77); }
static void tcg_wasm_out_op_i32_rotr(TCGContext *s){ tcg_wasm_out8(s, 0x78); }
static void tcg_wasm_out_op_i32_clz(TCGContext *s){ tcg_wasm_out8(s, 0x67); }
static void tcg_wasm_out_op_i32_ctz(TCGContext *s){ tcg_wasm_out8(s, 0x68); }
static void tcg_wasm_out_op_i32_popcnt(TCGContext *s){ tcg_wasm_out8(s, 0x69); }
static void tcg_wasm_out_op_i32_add(TCGContext *s){ tcg_wasm_out8(s, 0x6a); }
//static void tcg_wasm_out_op_i32_sub(TCGContext *s){ tcg_wasm_out8(s, 0x6b); }
//static void tcg_wasm_out_op_i32_mul(TCGContext *s){ tcg_wasm_out8(s, 0x6c); }
//static void tcg_wasm_out_op_i32_div_s(TCGContext *s){ tcg_wasm_out8(s, 0x6d); }
//static void tcg_wasm_out_op_i32_div_u(TCGContext *s){ tcg_wasm_out8(s, 0x6e); }
//static void tcg_wasm_out_op_i32_rem_s(TCGContext *s){ tcg_wasm_out8(s, 0x6f); }
//static void tcg_wasm_out_op_i32_rem_u(TCGContext *s){ tcg_wasm_out8(s, 0x70); }
static void tcg_wasm_out_op_i32_ne(TCGContext *s){ tcg_wasm_out8(s, 0x47); }
//static void tcg_wasm_out_op_i32_le_u(TCGContext *s){ tcg_wasm_out8(s, 0x4d); }

static void tcg_wasm_out_op_i64_eqz(TCGContext *s){ tcg_wasm_out8(s, 0x50); }
static void tcg_wasm_out_op_i64_eq(TCGContext *s){ tcg_wasm_out8(s, 0x51); }
static void tcg_wasm_out_op_i64_and(TCGContext *s){ tcg_wasm_out8(s, 0x83); }
static void tcg_wasm_out_op_i64_or(TCGContext *s){ tcg_wasm_out8(s, 0x84); }
static void tcg_wasm_out_op_i64_xor(TCGContext *s){ tcg_wasm_out8(s, 0x85); }
static void tcg_wasm_out_op_i64_shl(TCGContext *s){ tcg_wasm_out8(s, 0x86); }
static void tcg_wasm_out_op_i64_shr_s(TCGContext *s){ tcg_wasm_out8(s, 0x87); }
static void tcg_wasm_out_op_i64_shr_u(TCGContext *s){ tcg_wasm_out8(s, 0x88); }
static void tcg_wasm_out_op_i64_rotl(TCGContext *s){ tcg_wasm_out8(s, 0x89); }
static void tcg_wasm_out_op_i64_rotr(TCGContext *s){ tcg_wasm_out8(s, 0x8a); }
static void tcg_wasm_out_op_i64_clz(TCGContext *s){ tcg_wasm_out8(s, 0x79); }
static void tcg_wasm_out_op_i64_ctz(TCGContext *s){ tcg_wasm_out8(s, 0x7a); }
static void tcg_wasm_out_op_i64_popcnt(TCGContext *s){ tcg_wasm_out8(s, 0x7b); }
static void tcg_wasm_out_op_i64_add(TCGContext *s){ tcg_wasm_out8(s, 0x7c); }
static void tcg_wasm_out_op_i64_sub(TCGContext *s){ tcg_wasm_out8(s, 0x7d); }
static void tcg_wasm_out_op_i64_mul(TCGContext *s){ tcg_wasm_out8(s, 0x7e); }
static void tcg_wasm_out_op_i64_div_s(TCGContext *s){ tcg_wasm_out8(s, 0x7f); }
static void tcg_wasm_out_op_i64_div_u(TCGContext *s){ tcg_wasm_out8(s, 0x80); }
static void tcg_wasm_out_op_i64_rem_s(TCGContext *s){ tcg_wasm_out8(s, 0x81); }
static void tcg_wasm_out_op_i64_rem_u(TCGContext *s){ tcg_wasm_out8(s, 0x82); }
//static void tcg_wasm_out_op_i64_ne(TCGContext *s){ tcg_wasm_out8(s, 0x52); }
static void tcg_wasm_out_op_i64_le_u(TCGContext *s){ tcg_wasm_out8(s, 0x58); }
static void tcg_wasm_out_op_i64_lt_u(TCGContext *s){ tcg_wasm_out8(s, 0x54); }
static void tcg_wasm_out_op_i64_gt_u(TCGContext *s){ tcg_wasm_out8(s, 0x56); }

static void tcg_wasm_out_op_i32_wrap_i64(TCGContext *s){ tcg_wasm_out8(s, 0xa7); }

static void tcg_wasm_out_op_var(TCGContext *s, uint8_t instr, uint8_t i)
{
    tcg_wasm_out8(s, instr);
    tcg_wasm_out8(s, i);
}

static void tcg_wasm_out_op_local_get(TCGContext *s, uint8_t i)
{
    tcg_wasm_out_op_var(s, 0x20, i);
}

static void tcg_wasm_out_op_local_set(TCGContext *s, uint8_t i)
{
    tcg_wasm_out_op_var(s, 0x21, i);
}

static void tcg_wasm_out_op_local_tee(TCGContext *s, uint8_t i)
{
    tcg_wasm_out_op_var(s, 0x22, i);
}

static void tcg_wasm_out_op_global_get(TCGContext *s, uint8_t i)
{
    tcg_wasm_out_op_var(s, 0x23, i);
}

static void tcg_wasm_out_op_global_set(TCGContext *s, uint8_t i)
{
    if (i == tcg_target_reg_index[TCG_REG_R14]) {
        env_cached = false;
    }
    tcg_wasm_out_op_var(s, 0x24, i);
}

/* "global" in these names is historical: with wasm_reg_locals a register is a local */
static void tcg_wasm_out_op_global_get_r(TCGContext *s, TCGReg r0)
{
    if (wasm_reg_locals) {
        tcg_wasm_out_op_local_get(s, REG_LOCAL_BASE + tcg_target_reg_index[r0]);
    } else {
        tcg_wasm_out_op_global_get(s, tcg_target_reg_index[r0]);
    }
}

static void tcg_wasm_out_op_global_set_r(TCGContext *s, TCGReg r0)
{
    if (wasm_reg_locals) {
        regs_written |= 1u << tcg_target_reg_index[r0];
        tcg_wasm_out_op_local_set(s, REG_LOCAL_BASE + tcg_target_reg_index[r0]);
    } else {
        tcg_wasm_out_op_global_set(s, tcg_target_reg_index[r0]);
    }
}

static void tcg_wasm_out_op_global_get_r_i32(TCGContext *s, TCGReg r0)
{
    if (r0 == TCG_REG_R14) {
        if (!env_cached) {
            tcg_wasm_out_op_global_get_r(s, r0);
            tcg_wasm_out_op_i32_wrap_i64(s);
            tcg_wasm_out_op_local_tee(s, TMP32_LOCAL_ENV_IDX);
            env_cached = true;
        } else {
            tcg_wasm_out_op_local_get(s, TMP32_LOCAL_ENV_IDX);
        }
        return;
    }
    tcg_wasm_out_op_global_get_r(s, r0);
    tcg_wasm_out_op_i32_wrap_i64(s);
}

/* block pointer: read/written as a local; the global copy is only the resume point */
static void tcg_wasm_out_bp_get(TCGContext *s)
{
    if (wasm_reg_locals) {
        tcg_wasm_out_op_local_get(s, BP_LOCAL_IDX);
    } else {
        tcg_wasm_out_op_global_get(s, BLOCK_PTR_IDX);
    }
}

static void tcg_wasm_out_bp_set(TCGContext *s)
{
    if (wasm_reg_locals) {
        tcg_wasm_out_op_local_set(s, BP_LOCAL_IDX);
    } else {
        tcg_wasm_out_op_global_set(s, BLOCK_PTR_IDX);
    }
}

/*
 * Before a call that may unwind: every register written so far in this TB goes to its global, so
 * a resume entry can reload it. (Within a TB, values only live in registers along straight-line
 * code, so "written so far in emission order" covers everything live here.)
 */
static void tcg_wasm_out_spill_regs(TCGContext *s)
{
    if (!wasm_reg_locals) {
        return;
    }
    uint32_t m = regs_written & ~((1u << tcg_target_reg_index[TCG_REG_R14]) |
                                  (1u << tcg_target_reg_index[TCG_REG_R15]));
    for (int i = 0; m; i++, m >>= 1) {
        if (m & 1) {
            tcg_wasm_out_op_local_get(s, REG_LOCAL_BASE + i);
            tcg_wasm_out_op_global_set(s, i);
        }
    }
}

static void tcg_wasm_out_op_i32_const(TCGContext *s, int32_t v)
{
    tcg_wasm_out8(s, 0x41);
    tcg_wasm_out_leb128_sint32_t(s, v);
}

static void tcg_wasm_out_op_i64_const(TCGContext *s, int64_t v)
{
    tcg_wasm_out8(s, 0x42);
    tcg_wasm_out_leb128_sint64_t(s, v);
}

static void tcg_wasm_out_op_loadstore(TCGContext *s, uint8_t instr, uint32_t a, uint32_t o)
{
    tcg_wasm_out8(s, instr);
    tcg_wasm_out_leb128_uint32_t(s, a);
    tcg_wasm_out_leb128_uint32_t(s, o);
}

static void tcg_wasm_out_op_i64_store(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x37, a, o);
}

static void tcg_wasm_out_op_i32_store(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x36, a, o);
}

static void tcg_wasm_out_op_i64_store8(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x3c, a, o);
}
    
static void tcg_wasm_out_op_i64_store16(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x3d, a, o);
}

static void tcg_wasm_out_op_i64_store32(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x3e, a, o);
}

static void tcg_wasm_out_op_i64_load(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x29, a, o);
}

static void tcg_wasm_out_op_i32_load(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x28, a, o);
}

 static void tcg_wasm_out_op_i64_load8_s(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x30, a, o);
}

static void tcg_wasm_out_op_i64_load8_u(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x31, a, o);
}

static void tcg_wasm_out_op_i64_load16_s(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x32, a, o);
}

static void tcg_wasm_out_op_i64_load16_u(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x33, a, o);
}

static void tcg_wasm_out_op_i64_load32_u(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x35, a, o);
}

static void tcg_wasm_out_op_i64_load32_s(TCGContext *s, uint32_t a, uint32_t o)
{
    tcg_wasm_out_op_loadstore(s, 0x34, a, o);
}

static void tcg_wasm_out_op_return(TCGContext *s)
{
    tcg_wasm_out8(s, 0x0f);
}

static void tcg_wasm_out_op_call(TCGContext *s, uint32_t func_idx)
{
    tcg_wasm_out8(s, 0x10);
    tcg_wasm_out_leb128_uint32_t(s, func_idx);
}

static void tcg_wasm_out_op_i64_extend_i32_u(TCGContext *s)
{
    tcg_wasm_out8(s, 0xad);
}

static void tcg_wasm_out_op_i64_extend_i32_s(TCGContext *s)
{
    tcg_wasm_out8(s, 0xac);
}

static void tcg_wasm_out_op_i64_extend8_s(TCGContext *s)
{
    tcg_wasm_out8(s, 0xc2);
}

static void tcg_wasm_out_op_i64_extend16_s(TCGContext *s)
{
    tcg_wasm_out8(s, 0xc3);
}

static void tcg_wasm_out_op_not(TCGContext *s){
    tcg_wasm_out_op_i64_const(s, -1);
    tcg_wasm_out_op_i64_xor(s);
}

static void tcg_wasm_out_op_set_r_as_i64(TCGContext *s, TCGReg al, TCGReg ah)
{
    tcg_wasm_out_op_local_set(s, TMP64_4_IDX);

    // set lower bits
    tcg_wasm_out_op_local_get(s, TMP64_4_IDX);
    tcg_wasm_out_op_i64_const(s, 0xffffffff);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_global_set_r(s, al);

    // set higher bits
    tcg_wasm_out_op_local_get(s, TMP64_4_IDX);
    tcg_wasm_out_op_i64_const(s, 32);
    tcg_wasm_out_op_i64_shr_u(s);
    tcg_wasm_out_op_i64_const(s, 0xffffffff);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_global_set_r(s, ah);
}

static const struct {
    uint8_t i32;
    uint8_t i64;
} tcg_cond_to_inst[] = {
    [TCG_COND_EQ] =  { 0x46 /* i32.eq */   , 0x51 /* i64.eq */},
    [TCG_COND_NE] =  { 0x47 /* i32.ne */   , 0x52 /* i64.ne */},
    [TCG_COND_LT] =  { 0x48 /* i32.lt_s */ , 0x53 /* i64.lt_s */},
    [TCG_COND_GE] =  { 0x4e /* i32.ge_s */ , 0x59 /* i64.ge_s */},
    [TCG_COND_LE] =  { 0x4c /* i32.le_s */ , 0x57 /* i64.le_s */},
    [TCG_COND_GT] =  { 0x4a /* i32.gt_s */ , 0x55 /* i64.gt_s */},
    [TCG_COND_LTU] = { 0x49 /* i32.lt_u */ , 0x54 /* i64.lt_u */},
    [TCG_COND_GEU] = { 0x4f /* i32.ge_u */ , 0x5a /* i64.ge_u */},
    [TCG_COND_LEU] = { 0x4d /* i32.le_u */ , 0x58 /* i64.le_u */},
    [TCG_COND_GTU] = { 0x4b /* i32.gt_u */ , 0x56 /* i64.gt_u */}
};

static void tcg_wasm_out_op_cond_i64(TCGContext *s, TCGCond cond, TCGReg arg1, TCGReg arg2)
{
    uint8_t op = tcg_cond_to_inst[cond].i64;
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out8(s, op);
}

static void tcg_wasm_out_op_cond_i32(TCGContext *s, TCGCond cond, TCGReg arg1, TCGReg arg2)
{
    uint8_t op = tcg_cond_to_inst[cond].i32;
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out8(s, op);
}

#define tcg_wasm_out_i64_calc(op)                                            \
    static void tcg_wasm_out_i64_calc_##op(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){ \
        tcg_wasm_out_op_global_get_r(s, arg1);                               \
        tcg_wasm_out_op_global_get_r(s, arg2);                               \
        tcg_wasm_out_op_i64_##op(s);                                         \
        tcg_wasm_out_op_global_set_r(s, ret);                                \
    }
tcg_wasm_out_i64_calc(and);
tcg_wasm_out_i64_calc(or);
tcg_wasm_out_i64_calc(xor);
tcg_wasm_out_i64_calc(shl);
tcg_wasm_out_i64_calc(shr_s);
tcg_wasm_out_i64_calc(shr_u);
tcg_wasm_out_i64_calc(rotl);
tcg_wasm_out_i64_calc(rotr);
tcg_wasm_out_i64_calc(add);
tcg_wasm_out_i64_calc(sub);
tcg_wasm_out_i64_calc(mul);
tcg_wasm_out_i64_calc(div_s);
tcg_wasm_out_i64_calc(div_u);
tcg_wasm_out_i64_calc(rem_s);
tcg_wasm_out_i64_calc(rem_u);

static void tcg_wasm_out_rem_s(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2) {
    switch (type) {
    case TCG_TYPE_I32:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_extend_i32_s(s);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_extend_i32_s(s);
        tcg_wasm_out_op_i64_rem_s(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_rem_s(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_rem_u(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2) {
    switch (type) {
    case TCG_TYPE_I32:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_i64_const(s, 0xffffffff);
        tcg_wasm_out_op_i64_and(s);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_const(s, 0xffffffff);
        tcg_wasm_out_op_i64_and(s);
        tcg_wasm_out_op_i64_rem_u(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_rem_u(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_div_s(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2) {
    switch (type) {
    case TCG_TYPE_I32:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_extend_i32_s(s);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_extend_i32_s(s);
        tcg_wasm_out_op_i64_div_s(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_div_s(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_div_u(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2) {
    switch (type) {
    case TCG_TYPE_I32:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_i64_const(s, 0xffffffff);
        tcg_wasm_out_op_i64_and(s);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_const(s, 0xffffffff);
        tcg_wasm_out_op_i64_and(s);
        tcg_wasm_out_op_i64_div_u(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_div_u(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_shl(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2){
    switch (type) {
    case TCG_TYPE_I32:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_i64_const(s, 0xffffffff);
        tcg_wasm_out_op_i64_and(s);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_const(s, 31);
        tcg_wasm_out_op_i64_and(s);
        tcg_wasm_out_op_i64_shl(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_shl(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_shr_u(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2){
    switch (type) {
    case TCG_TYPE_I32:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_i64_const(s, 0xffffffff);
        tcg_wasm_out_op_i64_and(s);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_const(s, 31);
        tcg_wasm_out_op_i64_and(s);
        tcg_wasm_out_op_i64_shr_u(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_shr_u(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_shr_s(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2){
    switch (type) {
    case TCG_TYPE_I32:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_extend_i32_s(s);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_const(s, 31);
        tcg_wasm_out_op_i64_and(s);
        tcg_wasm_out_op_i64_shr_s(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r(s, arg1);
        tcg_wasm_out_op_global_get_r(s, arg2);
        tcg_wasm_out_op_i64_shr_s(s);
        tcg_wasm_out_op_global_set_r(s, ret);
        break;
    default:
        g_assert_not_reached();
    }
}
static void tcg_wasm_out_i32_rotl(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_i32_rotl(s);
    tcg_wasm_out_op_i64_extend_i32_s(s);
    tcg_wasm_out_op_global_set_r(s, ret); 
}

static void tcg_wasm_out_i32_rotr(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_i32_rotr(s);
    tcg_wasm_out_op_i64_extend_i32_s(s);
    tcg_wasm_out_op_global_set_r(s, ret); 
}

static void tcg_wasm_out_clz64(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i64_eqz(s);
    tcg_wasm_out_op_if_ret_i64(s);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_else(s);
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i64_clz(s);
    tcg_wasm_out_op_end(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_clz32(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i64_eqz(s);
    tcg_wasm_out_op_if_ret_i32(s);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_else(s);
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_i32_clz(s);
    tcg_wasm_out_op_end(s);
    tcg_wasm_out_op_i64_extend_i32_s(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_ctz64(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i64_eqz(s);
    tcg_wasm_out_op_if_ret_i64(s);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_else(s);
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i64_ctz(s);
    tcg_wasm_out_op_end(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_ctz32(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i64_eqz(s);
    tcg_wasm_out_op_if_ret_i32(s);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_else(s);
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_i32_ctz(s);
    tcg_wasm_out_op_end(s);
    tcg_wasm_out_op_i64_extend_i32_s(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_not(TCGContext *s, TCGReg ret, TCGReg arg){
    tcg_wasm_out_op_global_get_r(s, arg);
    tcg_wasm_out_op_not(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_andc(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_not(s);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_orc(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_not(s);
    tcg_wasm_out_op_i64_or(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_eqv(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i64_xor(s);
    tcg_wasm_out_op_not(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_nand(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_not(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_nor(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2){
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i64_or(s);
    tcg_wasm_out_op_not(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_neg(TCGContext *s, TCGReg ret, TCGReg arg){
    tcg_wasm_out_op_global_get_r(s, arg);
    tcg_wasm_out_op_not(s);
    tcg_wasm_out_op_i64_const(s, 1);
    tcg_wasm_out_op_i64_add(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_ld(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_i64_load32_u(s, 0, (uint32_t)offset);
        tcg_wasm_out_op_global_set_r(s, val);
        break;
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_i64_load(s, 0, (uint32_t)offset);
        tcg_wasm_out_op_global_set_r(s, val);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_ld8s(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_i64_load8_s(s, 0, (uint32_t)offset);
        tcg_wasm_out_op_global_set_r(s, val);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_ld8u(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_i64_load8_u(s, 0, (uint32_t)offset);
        tcg_wasm_out_op_global_set_r(s, val);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_ld16s(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_i64_load16_s(s, 0, (uint32_t)offset);
        tcg_wasm_out_op_global_set_r(s, val);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_ld16u(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_i64_load16_u(s, 0, (uint32_t)offset);
        tcg_wasm_out_op_global_set_r(s, val);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_ld32s(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_i64_load32_s(s, 0, (uint32_t)offset);
        tcg_wasm_out_op_global_set_r(s, val);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_ld32u(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_i64_load32_u(s, 0, (uint32_t)offset);
        tcg_wasm_out_op_global_set_r(s, val);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_st(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_global_get_r(s, val);
        tcg_wasm_out_op_i64_store32(s, 0, (uint32_t)offset);
        break;
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_global_get_r(s, val);
        tcg_wasm_out_op_i64_store(s, 0, (uint32_t)offset);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_st8(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_global_get_r(s, val);
        tcg_wasm_out_op_i64_store8(s, 0, (uint32_t)offset);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_st16(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_global_get_r(s, val);
        tcg_wasm_out_op_i64_store16(s, 0, (uint32_t)offset);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_st32(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r_i32(s, base);
        if ((int32_t)offset < 0) {
            tcg_wasm_out_op_i32_const(s, (int32_t)offset);
            tcg_wasm_out_op_i32_add(s);
            offset = 0;
        }
        tcg_wasm_out_op_global_get_r(s, val);
        tcg_wasm_out_op_i64_store32(s, 0, (uint32_t)offset);
        break;
    default:
        g_assert_not_reached();
    }
}

static inline bool tcg_wasm_out_sti(TCGContext *s, TCGType type, TCGArg val,
                               TCGReg base, intptr_t offset)
{
    return false;
}

static bool tcg_wasm_out_mov(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg)
{
   switch (type) {
   case TCG_TYPE_I32:
       tcg_wasm_out_op_global_get_r(s, arg);
       tcg_wasm_out_op_i32_wrap_i64(s);
       tcg_wasm_out_op_i64_extend_i32_u(s);
       tcg_wasm_out_op_global_set_r(s, ret);
       break;
   case TCG_TYPE_I64:
       tcg_wasm_out_op_global_get_r(s, arg);
       tcg_wasm_out_op_global_set_r(s, ret);
       break;
   default:
       g_assert_not_reached();
   }
    return true;
}

static void tcg_wasm_out_movi(TCGContext *s, TCGType type,
                        TCGReg ret, tcg_target_long arg)
{
   switch (type) {
   case TCG_TYPE_I32:
       tcg_wasm_out_op_i64_const(s, (int32_t)arg);
       break;
   case TCG_TYPE_I64:
       tcg_wasm_out_op_i64_const(s, arg);
       break;
   default:
       g_assert_not_reached();
   }
   tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_ext8s(TCGContext *s, TCGType type, TCGReg rd, TCGReg rs)
{
    switch (type) {
    case TCG_TYPE_I32:
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r(s, rs);
        tcg_wasm_out_op_i64_extend8_s(s);
        tcg_wasm_out_op_global_set_r(s, rd);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_ext8u(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_wasm_out_op_global_get_r(s, rs);
    tcg_wasm_out_op_i64_const(s, 0xff);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_global_set_r(s, rd);
}

static void tcg_wasm_out_ext16s(TCGContext *s, TCGType type, TCGReg rd, TCGReg rs)
{
    switch (type) {
    case TCG_TYPE_I32:
    case TCG_TYPE_I64:
        tcg_wasm_out_op_global_get_r(s, rs);
        tcg_wasm_out_op_i64_extend16_s(s);
        tcg_wasm_out_op_global_set_r(s, rd);
        break;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_ext16u(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_wasm_out_op_global_get_r(s, rs);
    tcg_wasm_out_op_i64_const(s, 0xffff);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_global_set_r(s, rd);
}

static void tcg_wasm_out_ext32s(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_wasm_out_op_global_get_r(s, rs);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_i64_extend_i32_s(s);
    tcg_wasm_out_op_global_set_r(s, rd);
}

static void tcg_wasm_out_ext32u(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_wasm_out_op_global_get_r(s, rs);
    tcg_wasm_out_op_i64_const(s, 0xffffffff);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_global_set_r(s, rd);
}

static void tcg_wasm_out_exts_i32_i64(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_wasm_out_ext32s(s, rd, rs);
}

static void tcg_wasm_out_extu_i32_i64(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_wasm_out_ext32u(s, rd, rs);
}

static void tcg_wasm_out_extrl_i64_i32(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_wasm_out_op_global_get_r(s, rs);
    tcg_wasm_out_op_i64_const(s, 0xffffffff);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_global_set_r(s, rd);
}

static void tcg_wasm_out_extrh_i64_i32(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_wasm_out_op_global_get_r(s, rs);
    tcg_wasm_out_op_i64_const(s, 32);
    tcg_wasm_out_op_i64_shr_u(s);
    tcg_wasm_out_op_global_set_r(s, rd);
}

static void tcg_wasm_out_setcond_i32(TCGContext *s, TCGCond cond, TCGReg ret,
                            TCGReg arg1, TCGReg arg2)
{
    tcg_wasm_out_op_cond_i32(s, cond, arg1, arg2);
    tcg_wasm_out_op_i64_extend_i32_u(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_setcond_i64(TCGContext *s, TCGCond cond, TCGReg ret,
                            TCGReg arg1, TCGReg arg2)
{
    tcg_wasm_out_op_cond_i64(s, cond, arg1, arg2);
    tcg_wasm_out_op_i64_extend_i32_u(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_movcond_i32(TCGContext *s, TCGCond cond, TCGReg ret,
                            TCGReg c1, TCGReg c2, TCGReg v1, TCGReg v2)
{
    tcg_wasm_out_op_cond_i32(s, cond, c1, c2);
    tcg_wasm_out_op_if_ret_i64(s);
    tcg_wasm_out_op_global_get_r(s, v1);
    tcg_wasm_out_op_else(s);
    tcg_wasm_out_op_global_get_r(s, v2);
    tcg_wasm_out_op_end(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_movcond_i64(TCGContext *s, TCGCond cond, TCGReg ret,
                            TCGReg c1, TCGReg c2, TCGReg v1, TCGReg v2)
{
    tcg_wasm_out_op_cond_i64(s, cond, c1, c2);
    tcg_wasm_out_op_if_ret_i64(s);
    tcg_wasm_out_op_global_get_r(s, v1);
    tcg_wasm_out_op_else(s);
    tcg_wasm_out_op_global_get_r(s, v2);
    tcg_wasm_out_op_end(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_add2(TCGContext *s, TCGReg retl, TCGReg reth,
                             TCGReg al, TCGReg ah, TCGReg bl, TCGReg bh)
{
    // add higer
    tcg_wasm_out_op_global_get_r(s, ah);
    tcg_wasm_out_op_global_get_r(s, bh);
    tcg_wasm_out_op_i64_add(s);

    // add lower
    tcg_wasm_out_op_global_get_r(s, al);
    tcg_wasm_out_op_global_get_r(s, bl);
    tcg_wasm_out_op_i64_add(s);

    // get carry
    if ((al == retl) && (bl == retl)) {
        tcg_wasm_out_op_local_set(s, TMP64_0_IDX);
        tcg_wasm_out_op_local_get(s, TMP64_0_IDX);
        tcg_wasm_out_op_global_get_r(s, al);
        tcg_wasm_out_op_i64_lt_u(s);
        tcg_wasm_out_op_i64_extend_i32_s(s);
        tcg_wasm_out_op_local_get(s, TMP64_0_IDX);
        tcg_wasm_out_op_global_set_r(s, retl);
    } else {
        tcg_wasm_out_op_global_set_r(s, retl);
        tcg_wasm_out_op_global_get_r(s, retl);
        if (al == retl) {
            tcg_wasm_out_op_global_get_r(s, bl);
        } else {
            tcg_wasm_out_op_global_get_r(s, al);
        }
        tcg_wasm_out_op_i64_lt_u(s);
        tcg_wasm_out_op_i64_extend_i32_s(s);
    }

    // add carry to higher
    tcg_wasm_out_op_i64_add(s);
    tcg_wasm_out_op_global_set_r(s, reth);
}

static void tcg_wasm_out_sub2(TCGContext *s, TCGReg retl, TCGReg reth,
                             TCGReg al, TCGReg ah, TCGReg bl, TCGReg bh)
{
    // sub higher
    tcg_wasm_out_op_global_get_r(s, ah);
    tcg_wasm_out_op_global_get_r(s, bh);
    tcg_wasm_out_op_i64_sub(s);

    // sub lower
    tcg_wasm_out_op_global_get_r(s, al);
    tcg_wasm_out_op_global_get_r(s, bl);
    tcg_wasm_out_op_i64_sub(s);

    // get underflow
    if (al == retl) {
        tcg_wasm_out_op_local_set(s, TMP64_0_IDX);

        tcg_wasm_out_op_local_get(s, TMP64_0_IDX);
        tcg_wasm_out_op_global_get_r(s, al);
        tcg_wasm_out_op_i64_gt_u(s);

        tcg_wasm_out_op_local_get(s, TMP64_0_IDX);
        tcg_wasm_out_op_global_set_r(s, retl);
    } else {
        tcg_wasm_out_op_global_set_r(s, retl);

        tcg_wasm_out_op_global_get_r(s, retl);
        tcg_wasm_out_op_global_get_r(s, al);
        tcg_wasm_out_op_i64_gt_u(s);
    }

    tcg_wasm_out_op_i64_sub(s);
    tcg_wasm_out_op_global_set_r(s, reth);
}

static void tcg_wasm_out_mulu2_i32(TCGContext *s, TCGReg retl, TCGReg reth, TCGReg arg1, TCGReg arg2)
{
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i64_mul(s);
    tcg_wasm_out_op_set_r_as_i64(s, retl, reth);
}

static void tcg_wasm_out_muls2_i32(TCGContext *s, TCGReg retl, TCGReg reth, TCGReg arg1, TCGReg arg2)
{
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i64_mul(s);
    tcg_wasm_out_op_set_r_as_i64(s, retl, reth);
}

static void tcg_wasm_out_muluh_i32(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i64_mul(s);
    tcg_wasm_out_op_i64_const(s, 32);
    tcg_wasm_out_op_i64_shr_u(s);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_mulsh_i32(TCGContext *s, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i64_mul(s);
    tcg_wasm_out_op_i64_const(s, 32);
    tcg_wasm_out_op_i64_shr_u(s);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_global_set_r(s, ret);
}

static void tcg_wasm_out_ctpop_i32(TCGContext *s, TCGReg dest, TCGReg src)
{
    tcg_wasm_out_op_global_get_r(s, src);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_i32_popcnt(s);
    tcg_wasm_out_op_global_set_r(s, dest);
}

static void tcg_wasm_out_ctpop_i64(TCGContext *s, TCGReg dest, TCGReg src)
{
    tcg_wasm_out_op_global_get_r(s, src);
    tcg_wasm_out_op_i64_popcnt(s);
    tcg_wasm_out_op_global_set_r(s, dest);
}

static void tcg_wasm_out_deposit_i32(TCGContext *s, TCGReg dest, TCGReg arg1, TCGReg arg2, int pos, int len)
{
    int32_t mask = ((1<<len)-1)<<pos;
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_i32_const(s, ~mask);
    tcg_wasm_out_op_i32_and(s);

    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_i32_const(s, pos);
    tcg_wasm_out_op_i32_shl(s);
    tcg_wasm_out_op_i32_const(s, mask);
    tcg_wasm_out_op_i32_and(s);

    tcg_wasm_out_op_i32_or(s);

    tcg_wasm_out_op_i64_extend_i32_u(s);
    tcg_wasm_out_op_global_set_r(s, dest);
}

static void tcg_wasm_out_deposit_i64(TCGContext *s, TCGReg dest, TCGReg arg1, TCGReg arg2, int pos, int len)
{
    int64_t mask = (((int64_t)1<<len)-1)<<pos;
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i64_const(s, ~mask);
    tcg_wasm_out_op_i64_and(s);

    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i64_const(s, pos);
    tcg_wasm_out_op_i64_shl(s);
    tcg_wasm_out_op_i64_const(s, mask);
    tcg_wasm_out_op_i64_and(s);

    tcg_wasm_out_op_i64_or(s);
    
    tcg_wasm_out_op_global_set_r(s, dest);
}

static void tcg_wasm_out_extract(TCGContext *s, TCGReg dest, TCGReg arg1, int pos, int len, TCGType type, bool sign)
{
    int rs;
    switch (type) {
    case TCG_TYPE_I32:
        rs = 32 - len;
        break;
    case TCG_TYPE_I64:
        rs = 64 - len;
        break;
    default:
        g_assert_not_reached();
    }
    int sl = rs - pos;
    tcg_wasm_out_op_global_get_r(s, arg1);
    if (sl > 0) {
        tcg_wasm_out_op_i64_const(s, sl);
        tcg_wasm_out_op_i64_shl(s);
    }
    tcg_wasm_out_op_i64_const(s, rs);
    if (sign) {
        tcg_wasm_out_op_i64_shr_s(s);
    } else {
        tcg_wasm_out_op_i64_shr_u(s);
    }
    tcg_wasm_out_op_global_set_r(s, dest);
}

static void tcg_wasm_out_extract2_i32(TCGContext *s, TCGReg dest, TCGReg arg1, TCGReg arg2, int pos)
{
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i64_const(s, 32-pos);
    tcg_wasm_out_op_i64_shl(s);

    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i64_const(s, 0xffffffff);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_i64_const(s, pos);
    tcg_wasm_out_op_i64_shr_u(s);

    tcg_wasm_out_op_i64_or(s);

    tcg_wasm_out_op_i64_const(s, 0xffffffff);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_global_set_r(s, dest);
}

static void tcg_wasm_out_extract2_i64(TCGContext *s, TCGReg dest, TCGReg arg1, TCGReg arg2, int pos)
{
    tcg_wasm_out_op_global_get_r(s, arg2);
    tcg_wasm_out_op_i64_const(s, 64-pos);
    tcg_wasm_out_op_i64_shl(s);
        
    tcg_wasm_out_op_global_get_r(s, arg1);
    tcg_wasm_out_op_i64_const(s, pos);
    tcg_wasm_out_op_i64_shr_u(s);

    tcg_wasm_out_op_i64_or(s);
    tcg_wasm_out_op_global_set_r(s, dest);
}

static void tcg_wasm_out_bswap64(TCGContext *s, TCGReg dest, TCGReg src, int flags)
{
    tcg_wasm_out_op_global_get_r(s, src); // ABCDEFGH
    tcg_wasm_out_op_i64_const(s, 32);
    tcg_wasm_out_op_i64_rotr(s);
    tcg_wasm_out_op_local_set(s, TMP64_0_IDX); // EFGHABCD

    tcg_wasm_out_op_local_get(s, TMP64_0_IDX);
    tcg_wasm_out_op_i64_const(s, 0xff000000ff000000);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_i64_const(s, 24);
    tcg_wasm_out_op_i64_shr_u(s); // ___E___A

    tcg_wasm_out_op_local_get(s, TMP64_0_IDX);
    tcg_wasm_out_op_i64_const(s, 0x00ff000000ff0000);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_i64_const(s, 8);
    tcg_wasm_out_op_i64_shr_u(s); // __F___B_

    tcg_wasm_out_op_i64_or(s);

    tcg_wasm_out_op_local_get(s, TMP64_0_IDX);
    tcg_wasm_out_op_i64_const(s, 0x0000ff000000ff00);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_i64_const(s, 8);
    tcg_wasm_out_op_i64_shl(s); // _G___C__

    tcg_wasm_out_op_local_get(s, TMP64_0_IDX);
    tcg_wasm_out_op_i64_const(s, 0x000000ff000000ff);
    tcg_wasm_out_op_i64_and(s);
    tcg_wasm_out_op_i64_const(s, 24);
    tcg_wasm_out_op_i64_shl(s); // H___D___
    
    tcg_wasm_out_op_i64_or(s);

    tcg_wasm_out_op_i64_or(s); // HGFEDCBA
    tcg_wasm_out_op_global_set_r(s, dest);
}

static void tcg_wasm_out_bswap32(TCGContext *s, TCGReg dest, TCGReg src, int flags)
{
    tcg_wasm_out_op_global_get_r(s, src);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_local_set(s, TMP32_LOCAL_0_IDX);
    
    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX); // ABCD
    tcg_wasm_out_op_i32_const(s, 16);
    tcg_wasm_out_op_i32_rotr(s);
    tcg_wasm_out_op_local_set(s, TMP32_LOCAL_0_IDX); // CDAB

    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_op_i32_const(s, 0xff00ff00);
    tcg_wasm_out_op_i32_and(s);
    tcg_wasm_out_op_i32_const(s, 8);
    tcg_wasm_out_op_i32_shr_u(s); // _C_A

    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_op_i32_const(s, 0x00ff00ff);
    tcg_wasm_out_op_i32_and(s);
    tcg_wasm_out_op_i32_const(s, 8);
    tcg_wasm_out_op_i32_shl(s); // D_B_

    tcg_wasm_out_op_i32_or(s); // DCBA
    tcg_wasm_out_op_i64_extend_i32_u(s);
    tcg_wasm_out_op_global_set_r(s, dest);
}

static void tcg_wasm_out_bswap16(TCGContext *s, TCGReg dest, TCGReg src, int flags)
{
    tcg_wasm_out_op_global_get_r(s, src);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_local_set(s, TMP32_LOCAL_0_IDX);

    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX); // __AB
    tcg_wasm_out_op_i32_const(s, 8);
    tcg_wasm_out_op_i32_rotr(s);
    tcg_wasm_out_op_local_set(s, TMP32_LOCAL_0_IDX); // B__A

    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_op_i32_const(s, 0x000000ff);
    tcg_wasm_out_op_i32_and(s); // ___A

    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_op_i32_const(s, 0xff000000);
    tcg_wasm_out_op_i32_and(s);
    tcg_wasm_out_op_i32_const(s, 16);
    if (flags & TCG_BSWAP_OS) {
        tcg_wasm_out_op_i32_shr_s(s); // SSB_
    } else {
        tcg_wasm_out_op_i32_shr_u(s); // 00B_
    }

    tcg_wasm_out_op_i32_or(s); // **BA
    tcg_wasm_out_op_i64_extend_i32_u(s);
    tcg_wasm_out_op_global_set_r(s, dest);
}

static void tcg_wasm_out_ctx_i32_store_const(TCGContext *s, int off, int32_t v)
{
    tcg_wasm_out_op_local_get(s, CTX_IDX);
    tcg_wasm_out_op_i32_const(s, v);
    tcg_wasm_out_op_i32_store(s, 0, off);
}

static void tcg_wasm_out_ctx_i32_store_r(TCGContext *s, int off, TCGReg r0)
{
    tcg_wasm_out_op_local_get(s, CTX_IDX);
    tcg_wasm_out_op_global_get_r(s, r0);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_i32_store(s, 0, off);
}

static void tcg_wasm_out_ctx_i32_load(TCGContext *s, int off)
{
    tcg_wasm_out_op_local_get(s, CTX_IDX);
    tcg_wasm_out_op_i32_load(s, 0, off);
}

static void tcg_wasm_out_label_idx(TCGContext *s, int label)
{
    int block_idx = wasm_alloc_block_idx(s);
    wasm_add_label_context(s, label, block_idx);

    tcg_wasm_out_op_end(s); // end if of the previous block

    // following block
    tcg_wasm_out_bp_get(s);
    tcg_wasm_out_op_i64_const(s, block_idx);
    tcg_wasm_out_op_i64_le_u(s);
    tcg_wasm_out_op_if_noret(s);
    env_cached = false;
}

__thread int current_label[100];
__thread int current_label_pos;

static void tcg_out_label_cb(TCGContext *s, TCGLabel *l)
{
    if (unlikely(current_label_pos >= ARRAY_SIZE(current_label))) {
        tcg_raise_tb_overflow(s);   /* retranslate smaller; was an unchecked OOB write */
    }
    current_label[current_label_pos++] = l->id;
    tcg_wasm_out_label_idx(s, l->id + 1);
}

static void tcg_wasm_out_op_br_to_label(TCGContext *s, TCGLabel *l, bool br_if)
{
    int toploop_depth = 1;
    if (br_if) {
        tcg_wasm_out_op_if_noret(s);
        toploop_depth++;
    }
    tcg_wasm_out8(s, 0x42); // i64.const
    wasm_add_label_block_ptr_placeholder(l->id + 1, cur_wasm_ptr(s));
    tcg_wasm_out8(s, 0x80); // filled before instantiation
    tcg_wasm_out8(s, 0x80);
    tcg_wasm_out8(s, 0x80);
    tcg_wasm_out8(s, 0x80);
    tcg_wasm_out8(s, 0x00);
    tcg_wasm_out_bp_set(s);
    bool found = false;
    for (int i = 0; i < current_label_pos; i++) {
        if (current_label[i] == l->id) {
            found = true;
            break;
        }
    }
    if (found) {
        tcg_wasm_out_op_br(s, toploop_depth); // br to the top of loop
    } else {
        tcg_wasm_out_op_br(s, toploop_depth - 1); // br to the end of the current block
    }
    if (br_if) {
        tcg_wasm_out_op_end(s);
    }
}

static void tcg_wasm_out_br(TCGContext *s, TCGLabel *l)
{
    tcg_wasm_out_op_br_to_label(s, l, false);
}

static void tcg_wasm_out_brcond_i32(TCGContext *s, TCGCond cond, TCGReg arg1,
                           TCGReg arg2, TCGLabel *l)
{
    tcg_wasm_out_op_cond_i32(s, cond, arg1, arg2);
    tcg_wasm_out_op_br_to_label(s, l, true);
}

static void tcg_wasm_out_brcond_i64(TCGContext *s, TCGCond cond, TCGReg arg1,
                           TCGReg arg2, TCGLabel *l)
{
    tcg_wasm_out_op_cond_i64(s, cond, arg1, arg2);
    tcg_wasm_out_op_br_to_label(s, l, true);
}

static void tcg_wasm_out_exit_tb(TCGContext *s, uintptr_t arg)
{
    tcg_wasm_out_ctx_i32_store_const(s, TB_PTR_OFF, 0);
    tcg_wasm_out_op_i32_const(s, (int32_t)arg);
    tcg_wasm_out_op_return(s);
}

/*
 * Bootbox TB chaining (see wasm32.h). Emitted where a TB has already stored the next TB into
 * ctx.tb_ptr (+ do_init = 1) and is about to return 0 to the dispatcher: if the successor (in
 * TMP32_LOCAL_0, non-zero) has a live compiled instance on this core and the chain budget isn't
 * spent, tail-call it instead. Mirrors get_instance_running_local(): slot = *(tb + export_vec_off),
 * slot->tb must still be this TB, slot->fidx is its function-table index. Anything else falls
 * through to the original return. TMP32_LOCAL_ENV_IDX is free here (the TB is exiting).
 */
static void tcg_wasm_out_chain(TCGContext *s)
{
    bootbox_tune_init();
    if (!wasm_tail_chain) {
        return;
    }
    /* if (--ctx.chain_budget > 0) */
    tcg_wasm_out_op_local_get(s, CTX_IDX);
    tcg_wasm_out_ctx_i32_load(s, CHAIN_BUDGET_OFF);
    tcg_wasm_out_op_i32_const(s, 1);
    tcg_wasm_out8(s, 0x6b);                                    /* i32.sub */
    tcg_wasm_out_op_local_tee(s, TMP32_LOCAL_ENV_IDX);
    tcg_wasm_out_op_i32_store(s, 0, CHAIN_BUDGET_OFF);
    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_ENV_IDX);
    tcg_wasm_out_op_i32_const(s, 0);
    tcg_wasm_out8(s, 0x4a);                                    /* i32.gt_s */
    tcg_wasm_out_op_if_noret(s);

    /*   slot = *(tb + ctx.export_vec_off); if (slot) */
    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_ctx_i32_load(s, EXPORT_VEC_OFF_OFF);
    tcg_wasm_out_op_i32_add(s);
    tcg_wasm_out_op_i32_load(s, 0, 0);
    tcg_wasm_out_op_local_tee(s, TMP32_LOCAL_ENV_IDX);
    tcg_wasm_out_op_if_noret(s);

    /*     if (slot->tb == tb) { slot->used = 1; return_call_indirect(ctx, slot->fidx) } */
    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_ENV_IDX);
    tcg_wasm_out_op_i32_load(s, 0, 0);
    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_op_i32_eq(s);
    tcg_wasm_out_op_if_noret(s);
    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_ENV_IDX);
    tcg_wasm_out_op_i32_const(s, 1);
    tcg_wasm_out_op_i32_store(s, 0, INSTANCE_USED_OFF);
    tcg_wasm_out_op_local_get(s, CTX_IDX);
    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_ENV_IDX);
    tcg_wasm_out_op_i32_load(s, 0, 4);
    if (wasm_chain_nested) {
        tcg_wasm_out8(s, 0x11);                                /* call_indirect */
        tcg_wasm_out8(s, 0x00);                                /*   type 0: (i32) -> i32 */
        tcg_wasm_out8(s, 0x00);                                /*   table 0: env.table */
        tcg_wasm_out_op_return(s);                             /* return its result */
    } else {
        tcg_wasm_out8(s, 0x13);                                /* return_call_indirect */
        tcg_wasm_out8(s, 0x00);                                /*   type 0: (i32) -> i32 */
        tcg_wasm_out8(s, 0x00);                                /*   table 0: env.table */
    }
    tcg_wasm_out_op_end(s);
    tcg_wasm_out_op_end(s);
    tcg_wasm_out_op_end(s);
    env_cached = false;
}

static void tcg_wasm_out_goto_ptr(TCGContext *s, TCGReg arg)
{
    tcg_wasm_out_op_global_get_r(s, arg);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_ctx_i32_load(s, TB_PTR_OFF);
    tcg_wasm_out_op_i32_eq(s);
    tcg_wasm_out_op_if_noret(s);
    tcg_wasm_out_op_i64_const(s, 0);
    tcg_wasm_out_bp_set(s);
    tcg_wasm_out_op_br(s, 2); // br to the top of loop
    tcg_wasm_out_op_end(s);

    tcg_wasm_out_ctx_i32_store_r(s, TB_PTR_OFF, arg);
    tcg_wasm_out_ctx_i32_store_const(s, DO_INIT_OFF, 1);
    if (wasm_tail_chain) {
        /* lookup_tb_ptr returns 0 (no epilogue in this port) when the TB isn't found */
        tcg_wasm_out_op_global_get_r(s, arg);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_local_tee(s, TMP32_LOCAL_0_IDX);
        tcg_wasm_out_op_if_noret(s);
        tcg_wasm_out_chain(s);
        tcg_wasm_out_op_end(s);
    }
    tcg_wasm_out_op_i32_const(s, 0);
    tcg_wasm_out_op_return(s);
}

static void tcg_wasm_out_goto_tb(TCGContext *s, int which)
{
    tcg_wasm_out_op_i32_const(s, (int32_t)get_jmp_target_addr(s, which));
    tcg_wasm_out_op_i32_load(s, 0, 0);
    tcg_wasm_out_op_local_set(s, TMP32_LOCAL_0_IDX);

    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_op_i32_const(s, 0);
    tcg_wasm_out_op_i32_ne(s);
    tcg_wasm_out_op_if_noret(s);

    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_ctx_i32_load(s, TB_PTR_OFF);
    tcg_wasm_out_op_i32_eq(s);
    tcg_wasm_out_op_if_noret(s);
    tcg_wasm_out_op_i64_const(s, 0);
    tcg_wasm_out_bp_set(s);
    tcg_wasm_out_op_br(s, 3); // br to the top of loop
    tcg_wasm_out_op_end(s);
    
    // store jmp target address to buf
    tcg_wasm_out_op_local_get(s, CTX_IDX);
    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX);
    tcg_wasm_out_op_i32_store(s, 0, TB_PTR_OFF);
    tcg_wasm_out_ctx_i32_store_const(s, DO_INIT_OFF, 1);
    tcg_wasm_out_chain(s);

    tcg_wasm_out_op_i32_const(s, 0);
    tcg_wasm_out_op_return(s);
    tcg_wasm_out_op_end(s);
}

static void push_arg_i64(TCGContext *s, int *reg_idx, int *stack_offset) {
    if (*reg_idx < NUM_OF_IARG_REGS) {
        tcg_wasm_out_op_global_get_r(s, REG_INDEX_IARG_BASE + *reg_idx);  // arg register
        int addend = 1;
        *reg_idx = *reg_idx + addend;
    } else {
        tcg_wasm_out_op_global_get_r(s, TCG_REG_CALL_STACK);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_load(s, 0, *stack_offset);
        int addend = 8;
        *stack_offset = *stack_offset + addend;
    }
}

void gen_func_wrapper_code(TCGContext *s, const tcg_insn_unit *func, const TCGHelperInfo *info, int func_idx)
{
    int nargs;
    unsigned typemask = info->typemask;
    int rettype = typemask & 7;

    if (rettype ==  dh_typecode_i128) {
        // receive 128bit return value via the stack buffer
        tcg_wasm_out_op_global_get_r(s, TCG_REG_CALL_STACK);
        tcg_wasm_out_op_i32_wrap_i64(s);
    }
    
    nargs = 32 - clz32(typemask >> 3);
    nargs = DIV_ROUND_UP(nargs, 3);
    int stack_offset = 0;
    int reg_idx = 0;
    int stack128_base = 0;
    bool cached_128base = false;
    for (int j = 0; j < nargs; ++j) {
        int typecode = extract32(typemask, (j + 1) * 3, 3);
        if (typecode == dh_typecode_void) {
            continue;
        }
        switch (typecode) {
        case dh_typecode_i32:
        case dh_typecode_s32:
        case dh_typecode_ptr:
            push_arg_i64(s, &reg_idx, &stack_offset);
            tcg_wasm_out_op_i32_wrap_i64(s);
            break;
        case dh_typecode_i64:
        case dh_typecode_s64:
            push_arg_i64(s, &reg_idx, &stack_offset);
            break;
        case dh_typecode_i128:
            // copy data to 128stack
            if (!cached_128base) {
                tcg_wasm_out_ctx_i32_load(s, STACK128_OFF);
                tcg_wasm_out_op_i64_extend_i32_s(s);
                tcg_wasm_out_op_local_set(s, TMP64_0_IDX);
                cached_128base = true;
            }

            // push current 128stack pointer
            tcg_wasm_out_op_local_get(s, TMP64_0_IDX);
            tcg_wasm_out_op_i32_wrap_i64(s);
            tcg_wasm_out_op_i32_const(s, stack128_base);
            tcg_wasm_out_op_i32_add(s);

            tcg_wasm_out_op_local_get(s, TMP64_0_IDX);
            tcg_wasm_out_op_i32_wrap_i64(s);
            push_arg_i64(s, &reg_idx, &stack_offset);
            tcg_wasm_out_op_i64_store(s, 0, stack128_base);
            stack128_base += 8;

            tcg_wasm_out_op_local_get(s, TMP64_0_IDX);
            tcg_wasm_out_op_i32_wrap_i64(s);
            push_arg_i64(s, &reg_idx, &stack_offset);
            tcg_wasm_out_op_i64_store(s, 0, stack128_base);
            stack128_base += 8;
            break;
        default:
            g_assert_not_reached();
        }
    }

    tcg_wasm_out_op_call(s, func_idx);

    stack_offset = 0;
    if (rettype != dh_typecode_void) {
        switch (rettype) {
        case dh_typecode_i32:
        case dh_typecode_s32:
        case dh_typecode_ptr:
            tcg_wasm_out_op_i64_extend_i32_s(s);
            tcg_wasm_out_op_global_set_r(s, TCG_REG_R0);
            break;
        case dh_typecode_i64:
        case dh_typecode_s64:
            tcg_wasm_out_op_global_set_r(s, TCG_REG_R0);
            break;
        case dh_typecode_i128:
            tcg_wasm_out_op_global_get_r(s, TCG_REG_CALL_STACK);
            tcg_wasm_out_op_i32_wrap_i64(s);
            tcg_wasm_out_op_i64_load(s, 0, stack_offset);
            tcg_wasm_out_op_global_set_r(s, TCG_REG_R0);
            stack_offset += 8;
            
            tcg_wasm_out_op_global_get_r(s, TCG_REG_CALL_STACK);
            tcg_wasm_out_op_i32_wrap_i64(s);
            tcg_wasm_out_op_i64_load(s, 0, stack_offset);
            tcg_wasm_out_op_global_set_r(s, TCG_REG_R1);
            stack_offset += 8;
            break;
        default:
            g_assert_not_reached();
        }
    }

    return;
}

static void gen_func_type(TCGContext *s, const TCGHelperInfo *info)
{
    int nargs;
    unsigned typemask = info->typemask;
    int rettype = typemask & 7;
    uint8_t * buf_start = wasm_get_helper_types_begin(s);
    uint8_t * buf_ptr = buf_start;
    nargs = 32 - clz32(typemask >> 3);
    nargs = DIV_ROUND_UP(nargs, 3);

    *buf_ptr++ = 0x60;
    uint8_t * buf_ptr_vec_size = buf_ptr;
    *buf_ptr += 0x80;
    *buf_ptr += 0x80;
    *buf_ptr += 0x80;
    *buf_ptr += 0x80;
    *buf_ptr += 0x00;
    *buf_ptr++ = 0; // vector size (placeholder)

    int vec_size = 0;
    
    if (rettype == dh_typecode_i128) {
        *buf_ptr++ = 0x7f; // i32 (stack buffer pointer)
        vec_size++;
    }
    
    for (int j = 0; j < nargs; ++j) {
        int typecode = extract32(typemask, (j + 1) * 3, 3);
        if (typecode == dh_typecode_void) {
            continue;
        }
        switch (typecode) {
        case dh_typecode_i32:
        case dh_typecode_s32:
        case dh_typecode_ptr:
            *buf_ptr++ = 0x7f;
            vec_size++;
            break;
        case dh_typecode_i64:
        case dh_typecode_s64:
            *buf_ptr++ = 0x7e;
            vec_size++;
            break;
        case dh_typecode_i128:
            *buf_ptr++ = 0x7f;
            vec_size++;
            break;
        default:
            g_assert_not_reached();
        }
    }
    fill_uint32_leb128((uintptr_t)buf_ptr_vec_size, vec_size); // fill size

    if ((rettype == dh_typecode_void) || (rettype == dh_typecode_i128)) {
        *buf_ptr++ = 0x0; // no return value
    } else {
        *buf_ptr++ = 0x1;
        switch (rettype) {
        case dh_typecode_i32:
        case dh_typecode_s32:
        case dh_typecode_ptr:
            *buf_ptr++ = 0x7f;
            break;
        case dh_typecode_i64:
        case dh_typecode_s64:
            *buf_ptr++ = 0x7e;
            break;
        default:
            g_assert_not_reached();
        }
    }
    int sz = (uint32_t)(buf_ptr - buf_start);
    wasm_add_helper_types_pos(s, sz);
    return;
}

static void gen_func_type_qemu_ld(TCGContext *s, uint32_t oi)
{
    uint8_t * buf_start = wasm_get_helper_types_begin(s);
    uint8_t * buf_ptr = buf_start;
    *buf_ptr++ = 0x60;
    *buf_ptr++ = 0x4;
    *buf_ptr++ = 0x7f;
    *buf_ptr++ = 0x7e;
    *buf_ptr++ = 0x7f;
    *buf_ptr++ = 0x7f;
    *buf_ptr++ = 0x1;
    MemOp mop = get_memop(oi);
    switch (mop & MO_SSIZE) {
    case MO_UQ:
        *buf_ptr++ = 0x7e;
        break;
    default:
        *buf_ptr++ = 0x7e;
        break;
    }
    int sz = (uint32_t)(buf_ptr - buf_start);
    wasm_add_helper_types_pos(s, sz);
}

static void gen_func_type_qemu_st(TCGContext *s, uint32_t oi)
{
    uint8_t * buf_start = wasm_get_helper_types_begin(s);
    uint8_t * buf_ptr = buf_start;
    *buf_ptr++ = 0x60;
    *buf_ptr++ = 0x5;
    *buf_ptr++ = 0x7f;
    *buf_ptr++ = 0x7e;
    MemOp mop = get_memop(oi);
    switch (mop & MO_SSIZE) {
    case MO_UQ:
        *buf_ptr++ = 0x7e;
        break;
    default:
        *buf_ptr++ = 0x7f;
        break;
    }
    *buf_ptr++ = 0x7f;
    *buf_ptr++ = 0x7f;
    *buf_ptr++ = 0x0;
    int sz = (uint32_t)(buf_ptr - buf_start);
    wasm_add_helper_types_pos(s, sz);
}

/*
 * Bootbox: SSE float arithmetic as native wasm float/SIMD ops.
 *
 * Every SSE float instruction was a helper call (~7 ns each on the Mac harness); they dominate
 * scalar-FP code (CPU-Z's benchmark) and llvmpipe's JIT'd shaders (packed). When the guest's
 * MXCSR is round-to-nearest with FTZ/DAZ off and neither the inputs nor the result is a NaN,
 * IEEE binary32/64 arithmetic gives bit-identical results to softfloat, so the op runs inline;
 * otherwise the original helper runs, unchanged. min/max are exact even for NaN and +-0 (they
 * are compare+select, like FPU_MIN/FPU_MAX). The one deliberate difference: MXCSR's sticky
 * exception flags are not updated on the fast path.
 * The result is staged in scratch (the TCG call-args area, unused by these pointer-only helpers)
 * so a NaN result can still fall back to the helper with d, v and s untouched.
 * These helpers never unwind (no I/O, no coroutines), so no rewind block split is needed.
 * Byte sequences validated in /Volumes/D/ai_cache/bootbox-harness/mbench/fpinline-test.js.
 */
#define WFP_ARG(n) (REG_INDEX_IARG_BASE + (n))

static void wfp_ptr(TCGContext *s, int global_idx)
{
    tcg_wasm_out_op_global_get_r(s, global_idx);
    tcg_wasm_out_op_i32_wrap_i64(s);
}

static void wfp_simd(TCGContext *s, uint32_t op)
{
    tcg_wasm_out8(s, 0xfd);
    tcg_wasm_out_leb128_uint32_t(s, op);
}

static void wfp_load(TCGContext *s, int ptr_global, int kind)
{
    wfp_ptr(s, ptr_global);
    if (kind >= WFP_PS) {
        wfp_simd(s, 0x00);                                     /* v128.load */
        tcg_wasm_out_leb128_uint32_t(s, 0);
        tcg_wasm_out_leb128_uint32_t(s, 0);
    } else {
        tcg_wasm_out_op_loadstore(s, kind == WFP_SD ? 0x2b : 0x2a, 0, 0);   /* f64/f32.load */
    }
}

static void wfp_store(TCGContext *s, int kind)
{
    if (kind >= WFP_PS) {
        wfp_simd(s, 0x0b);                                     /* v128.store */
        tcg_wasm_out_leb128_uint32_t(s, 0);
        tcg_wasm_out_leb128_uint32_t(s, 0);
    } else {
        tcg_wasm_out_op_loadstore(s, kind == WFP_SD ? 0x39 : 0x38, 0, 0);   /* f64/f32.store */
    }
}

/* Pushes i32 1 if the value at ptr (any lane, for packed kinds) is a NaN: x != x. */
static void wfp_isnan(TCGContext *s, int ptr_global, int kind)
{
    static const uint8_t ne[WFP_NKINDS] = { 0x5c, 0x62, 0x42, 0x48 };
    wfp_load(s, ptr_global, kind);
    wfp_load(s, ptr_global, kind);
    if (kind >= WFP_PS) {
        wfp_simd(s, ne[kind]);
        wfp_simd(s, 0x53);                                     /* v128.any_true */
    } else {
        tcg_wasm_out8(s, ne[kind]);
    }
}

static void wfp_f32_const(TCGContext *s, float f)
{
    uint32_t u;
    memcpy(&u, &f, 4);
    tcg_wasm_out8(s, 0x43);
    for (int i = 0; i < 4; i++) {
        tcg_wasm_out8(s, (u >> (8 * i)) & 0xff);
    }
}

static void wfp_f64_const(TCGContext *s, double d)
{
    uint64_t u;
    memcpy(&u, &d, 8);
    tcg_wasm_out8(s, 0x44);
    for (int i = 0; i < 8; i++) {
        tcg_wasm_out8(s, (u >> (8 * i)) & 0xff);
    }
}

/* Slow-path tail shared by the guarded shapes: end $slow, exact helper call, end $done. */
static void wfp_slow_call(TCGContext *s, const tcg_insn_unit *func, const TCGHelperInfo *info)
{
    int func_idx = get_wasm_helper_idx(s, (int)func);
    if (func_idx < 0) {
        func_idx = wasm_register_helper_alloc_num(s);
        wasm_register_helper(s, func_idx, (int)func);
        gen_func_type(s, info);
    }
    tcg_wasm_out_op_br(s, 1);                                  /* br $done */
    tcg_wasm_out_op_end(s);                                    /* end $slow */
    tcg_wasm_out_ctx_i32_load(s, HELPER_RET_TB_PTR_OFF);
    tcg_wasm_out_op_i32_const(s, (int32_t)((intptr_t)s->code_ptr + bb_code_bias));
    tcg_wasm_out_op_i32_store(s, 0, 0);
    gen_func_wrapper_code(s, func, info, func_idx);
    tcg_wasm_out_op_end(s);                                    /* end $done */
}

/*
 * Scalar compares and conversions (same rules as below: exact results, flags not updated).
 *  comis/ucomis: CC_SRC = unordered ? Z|P|C : a < b ? C : a == b ? Z : 0 (slow only under DAZ)
 *  cvtt*2si/sq: saturating wasm truncate + range check = x86's "integer indefinite" (no slow path)
 *  cvtsi/sq2ss/sd: exact under round-to-nearest (cvtsi2sd is always exact)
 *  cvtss2sd/cvtsd2ss: promote/demote, slow for NaN input or a non-default MXCSR
 */
extern __thread bool wasm_fp_locals;
static int wfp_local(int kind, int i);
static void wfp_local_isnan(TCGContext *s, int loc, int kind);
static void wfp_copy_upper(TCGContext *s, int d, int v, int kind);

/* Pushes the float at ptr: from local `loc` when it was loaded there once (loc >= 0), else memory. */
static void wfp_get(TCGContext *s, int ptr_global, int kind, int loc)
{
    if (loc >= 0) {
        tcg_wasm_out_op_local_get(s, loc);
    } else {
        wfp_load(s, ptr_global, kind);
    }
}

static bool tcg_wasm_out_fp_inline_x(TCGContext *s, const tcg_insn_unit *func,
                                     const TCGHelperInfo *info, const WasmFpInline *t, int x)
{
    int env = WFP_ARG(0), a1 = WFP_ARG(1), a2 = WFP_ARG(2), a3 = WFP_ARG(3);
    int r0 = tcg_target_reg_index[TCG_REG_R0];

    switch (x) {
    case WFPX_UCOMISS: case WFPX_COMISS: case WFPX_UCOMISD: case WFPX_COMISD: {
        int kind = (x == WFPX_UCOMISS || x == WFPX_COMISS) ? WFP_SS : WFP_SD;
        /* each operand is read once (into a float local) instead of four times */
        int A = wasm_reg_locals ? wfp_local(kind, 0) : -1, B = wasm_reg_locals ? wfp_local(kind, 1) : -1;
        tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);       /* block $done */
        tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);       /* block $slow */
        wfp_ptr(s, env);
        tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->daz_off);
        tcg_wasm_out8(s, 0x0d); tcg_wasm_out8(s, 0);           /* br_if $slow */
        if (A >= 0) {
            wasm_fp_locals = true;
            wfp_load(s, a1, kind);
            tcg_wasm_out_op_local_set(s, A);
            wfp_load(s, a2, kind);
            tcg_wasm_out_op_local_set(s, B);
        }
        tcg_wasm_out_op_i32_const(s, 0x45);                    /* CC_Z | CC_P | CC_C */
        tcg_wasm_out_op_i32_const(s, 0x01);                    /* CC_C */
        tcg_wasm_out_op_i32_const(s, 0x40);                    /* CC_Z */
        tcg_wasm_out_op_i32_const(s, 0);
        wfp_get(s, a1, kind, A);
        wfp_get(s, a2, kind, B);
        tcg_wasm_out8(s, kind == WFP_SS ? 0x5b : 0x61);        /* eq */
        tcg_wasm_out8(s, 0x1b);                                /* select */
        wfp_get(s, a1, kind, A);
        wfp_get(s, a2, kind, B);
        tcg_wasm_out8(s, kind == WFP_SS ? 0x5d : 0x63);        /* lt */
        tcg_wasm_out8(s, 0x1b);
        if (A >= 0) {
            wfp_local_isnan(s, A, kind);
            wfp_local_isnan(s, B, kind);
        } else {
            wfp_isnan(s, a1, kind);
            wfp_isnan(s, a2, kind);
        }
        tcg_wasm_out_op_i32_or(s);
        tcg_wasm_out8(s, 0x1b);
        tcg_wasm_out_op_i64_extend_i32_u(s);
        tcg_wasm_out_op_global_set_r(s, r0);                   /* the helper's return: new CC_SRC */
        wfp_slow_call(s, func, info);
        return true;
    }
    case WFPX_CVTTSS2SI: case WFPX_CVTTSD2SI: case WFPX_CVTTSS2SQ: case WFPX_CVTTSD2SQ: {
        bool src64 = x == WFPX_CVTTSD2SI || x == WFPX_CVTTSD2SQ;
        bool dst64 = x == WFPX_CVTTSS2SQ || x == WFPX_CVTTSD2SQ;
        int kind = src64 ? WFP_SD : WFP_SS;
        int A = wasm_reg_locals ? wfp_local(kind, 0) : -1;     /* the source, read once */
        wfp_load(s, a1, kind);
        if (A >= 0) {
            wasm_fp_locals = true;
            tcg_wasm_out_op_local_tee(s, A);
        }
        tcg_wasm_out8(s, 0xfc);                                /* i32/i64.trunc_sat_f32/f64_s */
        tcg_wasm_out8(s, (dst64 ? 4 : 0) + (src64 ? 2 : 0));
        if (dst64) {
            tcg_wasm_out_op_i64_const(s, INT64_MIN);
        } else {
            tcg_wasm_out_op_i32_const(s, INT32_MIN);
        }
        /* in range (NaN compares false) ? truncated : integer indefinite */
        wfp_get(s, a1, kind, A);
        if (src64) {
            if (dst64) {
                wfp_f64_const(s, -9223372036854775808.0);
                tcg_wasm_out8(s, 0x66);                        /* f64.ge */
            } else {
                wfp_f64_const(s, -2147483649.0);
                tcg_wasm_out8(s, 0x64);                        /* f64.gt */
            }
            wfp_get(s, a1, kind, A);
            wfp_f64_const(s, dst64 ? 9223372036854775808.0 : 2147483648.0);
            tcg_wasm_out8(s, 0x63);                            /* f64.lt */
        } else {
            wfp_f32_const(s, dst64 ? -9223372036854775808.0f : -2147483648.0f);
            tcg_wasm_out8(s, 0x60);                            /* f32.ge */
            wfp_get(s, a1, kind, A);
            wfp_f32_const(s, dst64 ? 9223372036854775808.0f : 2147483648.0f);
            tcg_wasm_out8(s, 0x5d);                            /* f32.lt */
        }
        tcg_wasm_out8(s, 0x71);                                /* i32.and */
        tcg_wasm_out8(s, 0x1b);                                /* select */
        if (!dst64) {
            tcg_wasm_out8(s, 0xac);                            /* i64.extend_i32_s */
        }
        tcg_wasm_out_op_global_set_r(s, r0);
        return true;
    }
    case WFPX_CVTSI2SS: case WFPX_CVTSI2SD: case WFPX_CVTSQ2SS: case WFPX_CVTSQ2SD: {
        bool to64 = x == WFPX_CVTSI2SD || x == WFPX_CVTSQ2SD;
        bool from64 = x == WFPX_CVTSQ2SS || x == WFPX_CVTSQ2SD;
        bool exact = x == WFPX_CVTSI2SD;
        if (!exact) {
            tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);   /* block $done */
            tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);   /* block $slow */
            wfp_ptr(s, env);
            tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->round_off);
            tcg_wasm_out8(s, 0x0d); tcg_wasm_out8(s, 0);       /* br_if $slow */
        }
        wfp_ptr(s, a1);
        tcg_wasm_out_op_global_get_r(s, a2);
        if (!from64) {
            tcg_wasm_out_op_i32_wrap_i64(s);
        }
        /* f32.convert_i32_s b2, f32.convert_i64_s b4, f64.convert_i32_s b7, f64.convert_i64_s b9 */
        tcg_wasm_out8(s, to64 ? (from64 ? 0xb9 : 0xb7) : (from64 ? 0xb4 : 0xb2));
        wfp_store(s, to64 ? WFP_SD : WFP_SS);
        if (!exact) {
            wfp_slow_call(s, func, info);
        }
        return true;
    }
    case WFPX_CVTSS2SD: case WFPX_CVTSD2SS: {
        bool demote = x == WFPX_CVTSD2SS;
        int src_kind = demote ? WFP_SD : WFP_SS;
        tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);       /* block $done */
        tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);       /* block $slow */
        wfp_ptr(s, env);
        tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->daz_off);
        if (demote) {                                          /* rounding + FTZ matter only for demote */
            wfp_ptr(s, env);
            tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->round_off);
            tcg_wasm_out_op_i32_or(s);
            wfp_ptr(s, env);
            tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->ftz_off);
            tcg_wasm_out_op_i32_or(s);
        }
        wfp_isnan(s, a3, src_kind);
        tcg_wasm_out_op_i32_or(s);
        tcg_wasm_out8(s, 0x0d); tcg_wasm_out8(s, 0);           /* br_if $slow */
        wfp_ptr(s, a1);
        wfp_load(s, a3, src_kind);
        tcg_wasm_out8(s, demote ? 0xb6 : 0xbb);                /* f32.demote_f64 / f64.promote_f32 */
        wfp_store(s, demote ? WFP_SS : WFP_SD);
        wfp_copy_upper(s, a1, a2, demote ? WFP_SS : WFP_SD);   /* keep v's upper lanes */
        wfp_slow_call(s, func, info);
        return true;
    }
    }
    return false;
}

/*
 * Bootbox: float/SIMD locals for the inlined SSE ops (wasm_reg_locals mode). Declared only in TBs
 * that use them (wasm_fp_locals, read by the function header in tcg.c): a, b, r per kind.
 */
#define FPL_F32 25
#define FPL_F64 28
#define FPL_V128 31
__thread bool wasm_fp_locals;

static int wfp_local(int kind, int i)
{
    return (kind == WFP_SS ? FPL_F32 : kind == WFP_SD ? FPL_F64 : FPL_V128) + i;
}

/* Pushes i32 != 0 unless MXCSR is round-to-nearest with FTZ and DAZ off: one load when the three
 * float_status bytes share 8 bytes (they do: 2, 5, 6), else three. */
static void wfp_mxcsr_check(TCGContext *s, const WasmFpInline *t, int env)
{
    int lo = MIN(t->round_off, MIN(t->ftz_off, t->daz_off));
    int hi = MAX(t->round_off, MAX(t->ftz_off, t->daz_off));
    if (hi - lo < 8) {
        uint64_t mask = (0xffull << (8 * (t->round_off - lo))) | (0xffull << (8 * (t->ftz_off - lo))) |
                        (0xffull << (8 * (t->daz_off - lo)));
        wfp_ptr(s, env);
        tcg_wasm_out_op_i64_load(s, 0, lo);
        tcg_wasm_out_op_i64_const(s, (int64_t)mask);
        tcg_wasm_out_op_i64_and(s);
        tcg_wasm_out_op_i64_eqz(s);
        tcg_wasm_out_op_i32_eqz(s);
    } else {
        wfp_ptr(s, env);
        tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->round_off);   /* i32.load8_u */
        wfp_ptr(s, env);
        tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->ftz_off);
        tcg_wasm_out_op_i32_or(s);
        wfp_ptr(s, env);
        tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->daz_off);
        tcg_wasm_out_op_i32_or(s);
    }
}

/*
 * Scalar ops write lane 0 of d and keep v's upper lanes. Legacy SSE encodes d == v (mulss xmm1, xmm2
 * computes xmm1 = xmm1 * xmm2), so the copy is skipped unless the pointers differ.
 */
static void wfp_copy_upper(TCGContext *s, int d, int v, int kind)
{
    wfp_ptr(s, d);
    wfp_ptr(s, v);
    tcg_wasm_out_op_i32_ne(s);
    tcg_wasm_out_op_if_noret(s);
    if (kind == WFP_SS) {
        wfp_ptr(s, d);
        wfp_ptr(s, v);
        tcg_wasm_out_op_i32_load(s, 0, 4);
        tcg_wasm_out_op_i32_store(s, 0, 4);
    }
    wfp_ptr(s, d);
    wfp_ptr(s, v);
    tcg_wasm_out_op_i64_load(s, 0, 8);
    tcg_wasm_out_op_i64_store(s, 0, 8);
    tcg_wasm_out_op_end(s);
}

/* Pushes i32 1 if local `loc` (any lane, for packed kinds) is a NaN: x != x. */
static void wfp_local_isnan(TCGContext *s, int loc, int kind)
{
    static const uint8_t ne[WFP_NKINDS] = { 0x5c, 0x62, 0x42, 0x48 };
    tcg_wasm_out_op_local_get(s, loc);
    tcg_wasm_out_op_local_get(s, loc);
    if (kind >= WFP_PS) {
        wfp_simd(s, ne[kind]);
        wfp_simd(s, 0x53);                                     /* v128.any_true */
    } else {
        tcg_wasm_out8(s, ne[kind]);
    }
}

/*
 * The wasm_reg_locals form of the guarded SSE op below: each operand is loaded ONCE into a float
 * local (NaN checks and the op reuse it) and the result goes straight to d - no scratch slot,
 * one MXCSR load. Same guards, same softfloat slow path, bit-identical results (fpcheck).
 */
static void wfp_emit_locals(TCGContext *s, const tcg_insn_unit *func, const TCGHelperInfo *info,
                            int func_idx, const WasmFpInline *t, int kind, int op,
                            const uint16_t arith[WFP_NKINDS][WFP_NOPS])
{
    bool vec = kind >= WFP_PS;
    bool minmax = op == WFP_MIN || op == WFP_MAX;
    int env = WFP_ARG(0), d = WFP_ARG(1), v = WFP_ARG(2);
    int src = (vec && op == WFP_SQRT) ? WFP_ARG(2) : WFP_ARG(3);
    int A = wfp_local(kind, 0), B = wfp_local(kind, 1), R = wfp_local(kind, 2);

    wasm_fp_locals = true;
    tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);           /* block $done */
    tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);           /* block $slow */
    wfp_mxcsr_check(s, t, env);
    if (op != WFP_SQRT) {
        wfp_load(s, v, kind);
        tcg_wasm_out_op_local_set(s, A);
    }
    wfp_load(s, src, kind);
    tcg_wasm_out_op_local_set(s, B);
    /*
     * x86 NaN propagation and default-NaN sign differ from wasm, so NaNs go to softfloat. Only the
     * RESULT is tested: add/sub/mul/div/sqrt of a NaN input always give a NaN, and d is written
     * after the test, so the slow path still sees the original inputs.
     */
    tcg_wasm_out8(s, 0x0d); tcg_wasm_out8(s, 0);               /* br_if $slow */

    if (minmax) {
        /* FPU_MIN: lt(v, s) ? v : s     FPU_MAX: lt(s, v) ? v : s */
        tcg_wasm_out_op_local_get(s, A);
        tcg_wasm_out_op_local_get(s, B);
        tcg_wasm_out_op_local_get(s, op == WFP_MIN ? A : B);
        tcg_wasm_out_op_local_get(s, op == WFP_MIN ? B : A);
        if (vec) {
            wfp_simd(s, arith[kind][op]);
            wfp_simd(s, 0x52);                                 /* v128.bitselect */
        } else {
            tcg_wasm_out8(s, arith[kind][op]);
            tcg_wasm_out8(s, 0x1b);                            /* select */
        }
        tcg_wasm_out_op_local_set(s, R);
    } else {
        if (op != WFP_SQRT) {
            tcg_wasm_out_op_local_get(s, A);
        }
        tcg_wasm_out_op_local_get(s, B);
        if (vec) {
            wfp_simd(s, arith[kind][op]);
        } else {
            tcg_wasm_out8(s, arith[kind][op]);
        }
        tcg_wasm_out_op_local_set(s, R);
        wfp_local_isnan(s, R, kind);                           /* e.g. inf-inf, 0/0, sqrt(-1) */
        tcg_wasm_out8(s, 0x0d); tcg_wasm_out8(s, 0);           /* br_if $slow */
    }

    /* commit: d = r; scalar ops keep v's upper lanes */
    wfp_ptr(s, d);
    tcg_wasm_out_op_local_get(s, R);
    wfp_store(s, kind);
    if (!vec) {
        wfp_copy_upper(s, d, v, kind);
    }
    tcg_wasm_out_op_br(s, 1);                                  /* br $done */
    tcg_wasm_out_op_end(s);                                    /* end $slow */

    tcg_wasm_out_ctx_i32_load(s, HELPER_RET_TB_PTR_OFF);
    tcg_wasm_out_op_i32_const(s, (int32_t)((intptr_t)s->code_ptr + bb_code_bias));
    tcg_wasm_out_op_i32_store(s, 0, 0);
    gen_func_wrapper_code(s, func, info, func_idx);
    tcg_wasm_out_op_end(s);                                    /* end $done */
}

static bool tcg_wasm_out_fp_inline(TCGContext *s, const tcg_insn_unit *func,
                                   const TCGHelperInfo *info)
{
    /* f32 / f64 / f32x4 / f64x2: add sub mul div (min max: lt) sqrt */
    static const uint16_t arith[WFP_NKINDS][WFP_NOPS] = {
        { 0x92, 0x93, 0x94, 0x95, 0x5d, 0x5d, 0x91 },
        { 0xa0, 0xa1, 0xa2, 0xa3, 0x63, 0x63, 0x9f },
        { 0xe4, 0xe5, 0xe6, 0xe7, 0x43, 0x43, 0xe3 },
        { 0xf0, 0xf1, 0xf2, 0xf3, 0x49, 0x49, 0xef },
    };
    const WasmFpInline *t;
    int kind, op;

    bootbox_tune_init();
    t = wasm32_fp_inline;
    if (!t || !wasm_fp_inline_enabled) {
        return false;
    }
    for (kind = 0; kind < WFP_NKINDS; kind++) {
        for (op = 0; op < WFP_NOPS; op++) {
            if (t->helper[kind][op] && t->helper[kind][op] == (const void *)func) {
                goto found;
            }
        }
    }
    for (int x = 0; x < WFPX_N; x++) {
        if (t->xhelper[x] && t->xhelper[x] == (const void *)func) {
            return tcg_wasm_out_fp_inline_x(s, func, info, t, x);
        }
    }
    return false;

found:;
    bool vec = kind >= WFP_PS;
    bool minmax = op == WFP_MIN || op == WFP_MAX;
    int env = WFP_ARG(0), d = WFP_ARG(1), v = WFP_ARG(2);
    int src = (vec && op == WFP_SQRT) ? WFP_ARG(2) : WFP_ARG(3);
    int scr = tcg_target_reg_index[TCG_REG_CALL_STACK];

    int func_idx = get_wasm_helper_idx(s, (int)func);
    if (func_idx < 0) {
        func_idx = wasm_register_helper_alloc_num(s);
        wasm_register_helper(s, func_idx, (int)func);
        gen_func_type(s, info);
    }

    if (wasm_reg_locals) {
        wfp_emit_locals(s, func, info, func_idx, t, kind, op, arith);
        return true;
    }

    tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);           /* block $done */
    tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);           /* block $slow */

    /* slow unless MXCSR is round-to-nearest with FTZ and DAZ off */
    wfp_ptr(s, env);
    tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->round_off);       /* i32.load8_u */
    wfp_ptr(s, env);
    tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->ftz_off);
    tcg_wasm_out_op_i32_or(s);
    wfp_ptr(s, env);
    tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->daz_off);
    tcg_wasm_out_op_i32_or(s);
    if (!minmax) {
        /* x86 NaN propagation and default-NaN sign differ from wasm: leave NaNs to softfloat */
        if (op != WFP_SQRT) {
            wfp_isnan(s, v, kind);
            tcg_wasm_out_op_i32_or(s);
        }
        wfp_isnan(s, src, kind);
        tcg_wasm_out_op_i32_or(s);
    }
    tcg_wasm_out8(s, 0x0d); tcg_wasm_out8(s, 0);               /* br_if $slow */

    /* scratch = v OP s */
    wfp_ptr(s, scr);
    if (minmax) {
        /* FPU_MIN: lt(v, s) ? v : s     FPU_MAX: lt(s, v) ? v : s */
        wfp_load(s, v, kind);
        wfp_load(s, src, kind);
        wfp_load(s, op == WFP_MIN ? v : src, kind);
        wfp_load(s, op == WFP_MIN ? src : v, kind);
        if (vec) {
            wfp_simd(s, arith[kind][op]);
            wfp_simd(s, 0x52);                                 /* v128.bitselect */
        } else {
            tcg_wasm_out8(s, arith[kind][op]);
            tcg_wasm_out8(s, 0x1b);                            /* select */
        }
    } else {
        if (op != WFP_SQRT) {
            wfp_load(s, v, kind);
        }
        wfp_load(s, src, kind);
        if (vec) {
            wfp_simd(s, arith[kind][op]);
        } else {
            tcg_wasm_out8(s, arith[kind][op]);
        }
    }
    wfp_store(s, kind);
    if (!minmax) {
        wfp_isnan(s, scr, kind);                               /* e.g. inf-inf, 0/0, sqrt(-1) */
        tcg_wasm_out8(s, 0x0d); tcg_wasm_out8(s, 0);           /* br_if $slow */
    }

    /* commit: d = scratch; scalar ops keep v's upper lanes */
    wfp_ptr(s, d);
    wfp_load(s, scr, kind);
    wfp_store(s, kind);
    if (!vec) {
        if (kind == WFP_SS) {
            wfp_ptr(s, d);
            wfp_ptr(s, v);
            tcg_wasm_out_op_i32_load(s, 0, 4);
            tcg_wasm_out_op_i32_store(s, 0, 4);
        }
        wfp_ptr(s, d);
        wfp_ptr(s, v);
        tcg_wasm_out_op_i64_load(s, 0, 8);
        tcg_wasm_out_op_i64_store(s, 0, 8);
    }
    tcg_wasm_out_op_br(s, 1);                                  /* br $done */
    tcg_wasm_out_op_end(s);                                    /* end $slow */

    /* slow path: the exact softfloat helper (GETPC position stored as for any helper) */
    tcg_wasm_out_ctx_i32_load(s, HELPER_RET_TB_PTR_OFF);
    tcg_wasm_out_op_i32_const(s, (int32_t)((intptr_t)s->code_ptr + bb_code_bias));
    tcg_wasm_out_op_i32_store(s, 0, 0);
    gen_func_wrapper_code(s, func, info, func_idx);
    tcg_wasm_out_op_end(s);                                    /* end $done */
    return true;
}

/*
 * Bootbox: x86 SSE integer shuffles/packs/multiplies and packed float<->int conversions as wasm SIMD.
 * llvmpipe's JIT'd shaders (the guest's software OpenGL) are full of pshufd, shufps, punpck, pack and
 * cvtps2dq; each was a helper call (~7 ns + the call's spill/reload). All of these are exact in
 * wasm SIMD: integer ops have one meaning, and the conversions map x86's "integer indefinite"
 * (0x80000000 for NaN/out of range) with a compare + bitselect. cvtps2dq/cvtdq2ps depend on the
 * rounding mode, so they run inline only under MXCSR round-to-nearest (else the helper). Shuffle
 * immediates come from the call op's constant argument (wasm_cur_call_op, set by tcg.c).
 * No slow path can unwind (pure helpers), so no resume block is needed.
 */
#define TCG_WASM_CUR_CALL_OP 1
static __thread TCGOp *wasm_cur_call_op;
#include "tcg/tcg-gvec-desc.h"

/* The value of helper argument i when it is a translation-time constant. */
static bool wsi_const_arg(const tcg_insn_unit *func, int i, int64_t *val)
{
    TCGOp *op = wasm_cur_call_op;
    TCGTemp *ts;

    if (!op || op->opc != INDEX_op_call || tcg_call_func(op) != (void *)func ||
        i >= TCGOP_CALLI(op)) {
        return false;
    }
    ts = arg_temp(op->args[TCGOP_CALLO(op) + i]);
    if (ts->kind != TEMP_CONST) {
        return false;
    }
    *val = ts->val;
    return true;
}

static void wsi_load(TCGContext *s, int ptr_arg)
{
    wfp_ptr(s, WFP_ARG(ptr_arg));
    wfp_simd(s, 0x00);                                         /* v128.load */
    tcg_wasm_out_leb128_uint32_t(s, 0);
    tcg_wasm_out_leb128_uint32_t(s, 0);
}

static void wsi_store(TCGContext *s)
{
    wfp_simd(s, 0x0b);                                         /* v128.store */
    tcg_wasm_out_leb128_uint32_t(s, 0);
    tcg_wasm_out_leb128_uint32_t(s, 0);
}

static void wsi_shuffle(TCGContext *s, const uint8_t lanes[16])
{
    wfp_simd(s, 0x0d);                                         /* i8x16.shuffle */
    for (int i = 0; i < 16; i++) {
        tcg_wasm_out8(s, lanes[i]);
    }
}

static void wsi_const_u32x4(TCGContext *s, uint32_t v)
{
    wfp_simd(s, 0x0c);                                         /* v128.const */
    for (int i = 0; i < 16; i++) {
        tcg_wasm_out8(s, v >> (8 * (i & 3)));
    }
}

/* 32-bit lane L of operand o (0 = first, 1 = second) as shuffle byte indices */
static void wsi_lane32(uint8_t *l, int o, int L)
{
    for (int b = 0; b < 4; b++) {
        l[b] = o * 16 + L * 4 + b;
    }
}

static bool tcg_wasm_out_simd_inline(TCGContext *s, const tcg_insn_unit *func,
                                     const TCGHelperInfo *info)
{
    const WasmSimdInline *e = NULL;
    uint8_t lanes[16];
    int64_t imm = 0;
    int i;

    if (!wasm32_simd_inline || !wasm_simd_inline_enabled) {
        return false;
    }
    for (i = 0; i < wasm32_simd_inline_n; i++) {
        if (wasm32_simd_inline[i].helper == (const void *)func) {
            e = &wasm32_simd_inline[i];
            break;
        }
    }
    for (i = 0; !e && i < wasm32_gvec_inline_n; i++) {
        if (wasm32_gvec_inline[i].helper == (const void *)func) {
            e = &wasm32_gvec_inline[i];
        }
    }
    if (!e) {
        return false;
    }
    if (e->kind >= WSG_3) {
        /* generic gvec helper: inline only a constant desc of exactly 16 bytes, no tail to clear */
        int64_t desc;
        if (!wsi_const_arg(func, e->kind <= WSG_3ORC ? 3 : 2, &desc) ||
            simd_oprsz(desc) != 16 || simd_maxsz(desc) != 16) {
            return false;
        }
        wfp_ptr(s, WFP_ARG(0));
        wsi_load(s, 1);
        switch (e->kind) {
        case WSG_3:
            wsi_load(s, 2);
            wfp_simd(s, e->op);
            break;
        case WSG_3ORC:
            wsi_load(s, 2);
            wfp_simd(s, 0x4d);                                 /* v128.not */
            wfp_simd(s, 0x50);                                 /* v128.or */
            break;
        case WSG_2:
            if (e->op) {
                wfp_simd(s, e->op);
            }
            break;
        case WSG_2I:
            tcg_wasm_out_op_i32_const(s, simd_data(desc));
            wfp_simd(s, e->op);
            break;
        }
        wsi_store(s);
        return true;
    }
    switch (e->kind) {
    case WSI_PSHUFD: case WSI_PSHUFLW: case WSI_PSHUFHW:
        if (!wsi_const_arg(func, 2, &imm)) {
            return false;
        }
        break;
    case WSI_SHUFPS: case WSI_SHUFPD:
        if (!wsi_const_arg(func, 3, &imm)) {
            return false;
        }
        break;
    }

    switch (e->kind) {
    case WSI_SHUF:                                             /* (env, d, v, s) */
    case WSI_OP:
        wfp_ptr(s, WFP_ARG(1));
        wsi_load(s, 2);
        wsi_load(s, 3);
        if (e->kind == WSI_SHUF) {
            wsi_shuffle(s, e->lanes);
        } else {
            wfp_simd(s, e->op);
        }
        wsi_store(s);
        return true;
    case WSI_PMULUDQ:
        wfp_ptr(s, WFP_ARG(1));
        wsi_load(s, 2);
        wfp_simd(s, 0x0c);                                     /* v128.const low-dword mask */
        for (i = 0; i < 16; i++) {
            tcg_wasm_out8(s, (i & 7) < 4 ? 0xff : 0);
        }
        wfp_simd(s, 0x4e);                                     /* v128.and */
        wsi_load(s, 3);
        wfp_simd(s, 0x0c);
        for (i = 0; i < 16; i++) {
            tcg_wasm_out8(s, (i & 7) < 4 ? 0xff : 0);
        }
        wfp_simd(s, 0x4e);
        wfp_simd(s, 0xd5);                                     /* i64x2.mul */
        wsi_store(s);
        return true;
    case WSI_PMULH:
        wfp_ptr(s, WFP_ARG(1));
        wsi_load(s, 2);
        wsi_load(s, 3);
        wfp_simd(s, e->op);                                    /* i32x4.extmul_low_i16x8_s/u */
        wsi_load(s, 2);
        wsi_load(s, 3);
        wfp_simd(s, e->op + 1);                                /* i32x4.extmul_high_i16x8_s/u */
        for (i = 0; i < 8; i++) {                              /* the high half of each product */
            lanes[2 * i] = 4 * i + 2;
            lanes[2 * i + 1] = 4 * i + 3;
        }
        wsi_shuffle(s, lanes);
        wsi_store(s);
        return true;
    case WSI_PSHUFB:
        wfp_ptr(s, WFP_ARG(1));
        wsi_load(s, 2);
        wsi_load(s, 3);
        wsi_const_u32x4(s, 0x8f8f8f8f);                        /* bit 7 set -> index >= 16 -> 0 */
        wfp_simd(s, 0x4e);                                     /* v128.and */
        wfp_simd(s, 0x0e);                                     /* i8x16.swizzle */
        wsi_store(s);
        return true;
    case WSI_PSHUFD:                                           /* (d, s, imm) */
        for (i = 0; i < 4; i++) {
            wsi_lane32(lanes + 4 * i, 0, (imm >> (2 * i)) & 3);
        }
        goto unary_shuffle;
    case WSI_PSHUFLW:
    case WSI_PSHUFHW: {
        int base = e->kind == WSI_PSHUFHW ? 4 : 0;
        for (i = 0; i < 8; i++) {
            int w = i;
            if ((i & 4) == base) {
                w = base + ((imm >> (2 * (i & 3))) & 3);
            }
            lanes[2 * i] = 2 * w;
            lanes[2 * i + 1] = 2 * w + 1;
        }
        goto unary_shuffle;
    }
    unary_shuffle:
        wfp_ptr(s, WFP_ARG(0));
        wsi_load(s, 1);
        wsi_load(s, 1);
        wsi_shuffle(s, lanes);
        wsi_store(s);
        return true;
    case WSI_SHUFPS:                                           /* (d, v, s, imm) */
        wsi_lane32(lanes + 0, 0, imm & 3);
        wsi_lane32(lanes + 4, 0, (imm >> 2) & 3);
        wsi_lane32(lanes + 8, 1, (imm >> 4) & 3);
        wsi_lane32(lanes + 12, 1, (imm >> 6) & 3);
        goto binary_imm_shuffle;
    case WSI_SHUFPD:
        for (i = 0; i < 8; i++) {
            lanes[i] = (imm & 1) * 8 + i;
            lanes[8 + i] = 16 + ((imm >> 1) & 1) * 8 + i;
        }
        goto binary_imm_shuffle;
    binary_imm_shuffle:
        wfp_ptr(s, WFP_ARG(0));
        wsi_load(s, 1);
        wsi_load(s, 2);
        wsi_shuffle(s, lanes);
        wsi_store(s);
        return true;
    case WSI_CVTTPS2DQ:                                        /* (env, d, s) */
    case WSI_CVTPS2DQ:
    case WSI_CVTDQ2PS: {
        bool guard = e->kind != WSI_CVTTPS2DQ;                 /* rounding-mode dependent */
        const WasmFpInline *t = wasm32_fp_inline;
        if (guard && !t) {
            return false;
        }
        if (guard) {
            tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);   /* block $done */
            tcg_wasm_out8(s, 0x02); tcg_wasm_out8(s, 0x40);   /* block $slow */
            wfp_ptr(s, WFP_ARG(0));
            tcg_wasm_out_op_loadstore(s, 0x2d, 0, t->round_off);   /* i32.load8_u: != nearest */
            tcg_wasm_out8(s, 0x0d); tcg_wasm_out8(s, 0);       /* br_if $slow */
        }
        wfp_ptr(s, WFP_ARG(1));
        wsi_load(s, 2);
        if (e->kind == WSI_CVTDQ2PS) {
            wfp_simd(s, 0xfa);                                 /* f32x4.convert_i32x4_s */
        } else {
            if (e->kind == WSI_CVTPS2DQ) {
                wfp_simd(s, 0x6a);                             /* f32x4.nearest (ties to even) */
            }
            wfp_simd(s, 0xf8);                                 /* i32x4.trunc_sat_f32x4_s */
            wsi_const_u32x4(s, 0x80000000u);                   /* integer indefinite */
            wsi_load(s, 2);
            wsi_const_u32x4(s, 0x4f000000u);                   /* 2^31 */
            wfp_simd(s, 0x43);                                 /* f32x4.lt: false for NaN, >= 2^31 */
            wfp_simd(s, 0x52);                                 /* v128.bitselect */
        }
        wsi_store(s);
        if (guard) {
            wfp_slow_call(s, func, info);
        }
        return true;
    }
    }
    return false;
}

static void tcg_wasm_out_call(TCGContext *s, const tcg_insn_unit *func,
                         const TCGHelperInfo *info)
{
    if (tcg_wasm_out_fp_inline(s, func, info) || tcg_wasm_out_simd_inline(s, func, info)) {
        return;
    }

    // set return position
    tcg_wasm_out_ctx_i32_load(s, HELPER_RET_TB_PTR_OFF);
    tcg_wasm_out_op_i32_const(s, (int32_t)((intptr_t)s->code_ptr + bb_code_bias));

    tcg_wasm_out_op_i32_store(s, 0, 0);

    int func_idx = get_wasm_helper_idx(s, (int)func);
    if (func_idx < 0) {
        func_idx = wasm_register_helper_alloc_num(s);
        tcg_debug_assert(func >= 0);
        wasm_register_helper(s, func_idx, (int)func);
        gen_func_type(s, info);
    }

    /*
     * Bootbox: a helper without side effects (lookup_tb_ptr on every indirect jump, the lazy-flags
     * cc_compute_*, ...) cannot reach device I/O, so it can never unwind: call it in place, without
     * the resume block, unwinding flag and register spill that a resumable call needs.
     */
    if (wasm_reg_locals && (info->flags & TCG_CALL_NO_SIDE_EFFECTS)) {
        gen_func_wrapper_code(s, func, info, func_idx);
        return;
    }

    int target_block_idx = wasm_block_current_idx(s) + 1;
    tcg_wasm_out_op_i64_const(s, target_block_idx);
    tcg_wasm_out_op_global_set(s, BLOCK_PTR_IDX);   /* resume point */
    tcg_wasm_out_op_end(s); // close if of this block (rewind skips this)
    env_cached = false;

    int block_idx = wasm_alloc_block_idx(s);
    tcg_wasm_out_bp_get(s);
    tcg_wasm_out_op_i64_const(s, block_idx);
    tcg_wasm_out_op_i64_le_u(s);
    tcg_wasm_out_op_if_noret(s);
    tcg_wasm_out_ctx_i32_store_const(s, UNWINDING_OFF, 0);
    tcg_wasm_out_spill_regs(s);
    gen_func_wrapper_code(s, func, info, func_idx);

    tcg_wasm_out_op_i32_const(s, 1);
    tcg_wasm_out_ctx_i32_load(s, UNWINDING_OFF);
    tcg_wasm_out_op_i32_eq(s);
    tcg_wasm_out_op_if_noret(s);
    tcg_wasm_out_op_i32_const(s, 0);
    tcg_wasm_out_op_return(s);
    tcg_wasm_out_op_end(s);
}

void tb_target_set_jmp_target(const TranslationBlock *tb, int n,
                              uintptr_t jmp_rx, uintptr_t jmp_rw)
{
    /* Always indirect, nothing to do */
}

static uint8_t tcg_wasm_out_tlb_load(TCGContext *s, TCGReg addr, MemOpIdx oi, bool is_ld)
{
    MemOp opc = get_memop(oi);
    TCGAtomAlign aa;
    unsigned a_mask;

    aa = atom_and_align_for_opc(s, opc, MO_ATOM_IFALIGN, false);
    a_mask = (1u << aa.align) - 1;

    unsigned s_bits = opc & MO_SIZE;
    unsigned s_mask = (1u << s_bits) - 1;
    tcg_target_long compare_mask;
    int mem_index = get_mmuidx(oi);
    int fast_ofs = tlb_mask_table_ofs(s, mem_index);
    int mask_ofs = fast_ofs + offsetof(CPUTLBDescFast, mask);
    int table_ofs = fast_ofs + offsetof(CPUTLBDescFast, table);
    int add_off = offsetof(CPUTLBEntry, addend);

    tcg_wasm_out_op_global_get_r(s, addr);
    tcg_wasm_out_op_i64_const(s, s->page_bits - CPU_TLB_ENTRY_BITS);
    tcg_wasm_out_op_i64_shr_u(s);
    
    tcg_wasm_out_op_global_get_r_i32(s, TCG_AREG0);
    int off = mask_ofs;
    if ((int64_t)off < 0) {
        tcg_wasm_out_op_i32_const(s, (int64_t)off);
        tcg_wasm_out_op_i32_add(s);
        off = 0;
    }
    tcg_wasm_out_op_i64_load(s, 0, (uint64_t)off);
    tcg_wasm_out_op_local_set(s, TMP64_2_IDX);

    tcg_wasm_out_op_local_get(s, TMP64_2_IDX);

    tcg_wasm_out_op_i64_and(s);

    tcg_wasm_out_op_global_get_r_i32(s, TCG_AREG0);
    off = table_ofs;
    if ((int64_t)off < 0) {
        tcg_wasm_out_op_i32_const(s, (int64_t)off);
        tcg_wasm_out_op_i32_add(s);
        off = 0;
    }
    tcg_wasm_out_op_i64_load(s, 0, (uint64_t)off);
    tcg_wasm_out_op_i64_add(s);
    
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_local_tee(s, TMP32_LOCAL_0_IDX);

    off = is_ld ? offsetof(CPUTLBEntry, addr_read)
        : offsetof(CPUTLBEntry, addr_write);
    if ((int64_t)off < 0) {
        tcg_wasm_out_op_i32_const(s, (int64_t)off);
        tcg_wasm_out_op_i32_add(s);
        off = 0;
    }
    tcg_wasm_out_op_i64_load(s, 0, (uint64_t)off);

    tcg_wasm_out_op_global_get_r(s, addr);
    if (a_mask < s_mask) {
        tcg_wasm_out_op_i64_const(s, s_mask - a_mask);
        tcg_wasm_out_op_i64_add(s);
    }
    compare_mask = (uint64_t)s->page_mask | a_mask;
    tcg_wasm_out_op_i64_const(s, compare_mask);
    tcg_wasm_out_op_i64_and(s);

    tcg_wasm_out_op_i64_eq(s);

    tcg_wasm_out_op_i64_const(s, 0);
    tcg_wasm_out_op_local_set(s, TMP64_0_IDX);
    
    tcg_wasm_out_op_if_noret(s);
    tcg_wasm_out_op_local_get(s, TMP32_LOCAL_0_IDX);
    off = add_off;
    if ((int64_t)off < 0) {
        tcg_wasm_out_op_i32_const(s, (int64_t)off);
        tcg_wasm_out_op_i32_add(s);
        off = 0;
    }
    tcg_wasm_out_op_i32_load(s, 0, (uint64_t)off);
    tcg_wasm_out_op_i64_extend_i32_u(s);
    tcg_wasm_out_op_global_get_r(s, addr);
    tcg_wasm_out_op_i64_add(s);
    tcg_wasm_out_op_local_set(s, TMP64_0_IDX);
    
    tcg_wasm_out_op_end(s);
    
    
    return TMP64_0_IDX;
}

static void tcg_wasm_out_qemu_ld_direct(TCGContext *s, TCGReg r, uint8_t base, MemOp opc)
{
    /* Byte swapping is left to middle-end expansion. */
    tcg_debug_assert((opc & MO_BSWAP) == 0);

    switch (opc & (MO_SSIZE)) {
    case MO_UB:
        tcg_wasm_out_op_local_get(s, base);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_load8_u(s, 0, 0);
        tcg_wasm_out_op_global_set_r(s, r);
        break;
    case MO_SB:
        tcg_wasm_out_op_local_get(s, base);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_load8_s(s, 0, 0);
        tcg_wasm_out_op_global_set_r(s, r);
        break;
    case MO_UW:
        tcg_wasm_out_op_local_get(s, base);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_load16_u(s, 0, 0);
        tcg_wasm_out_op_global_set_r(s, r);
        break;
    case MO_SW:
        tcg_wasm_out_op_local_get(s, base);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_load16_s(s, 0, 0);
        tcg_wasm_out_op_global_set_r(s, r);
        break;
    case MO_UL:
        tcg_wasm_out_op_local_get(s, base);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_load32_u(s, 0, 0);
        tcg_wasm_out_op_global_set_r(s, r);
        break;
    case MO_SL:
        tcg_wasm_out_op_local_get(s, base);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_load32_s(s, 0, 0);
        tcg_wasm_out_op_global_set_r(s, r);
        break;
    case MO_UQ:
        tcg_wasm_out_op_local_get(s, base);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_i64_load(s, 0, 0);
        tcg_wasm_out_op_global_set_r(s, r);
        break;
    default:
        g_assert_not_reached();
    }
}

static void* qemu_ld_helper_ptr(uint32_t oi)
{
    MemOp mop = get_memop(oi);
    switch (mop & MO_SSIZE) {
    case MO_UB:
        return helper_ldub_mmu;
    case MO_SB:
        return helper_ldsb_mmu;
    case MO_UW:
        return helper_lduw_mmu;
    case MO_SW:
        return helper_ldsw_mmu;
    case MO_UL:
        return helper_ldul_mmu;
    case MO_SL:
        return helper_ldsl_mmu;
    case MO_UQ:
        return helper_ldq_mmu;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_qemu_ld(TCGContext *s, const TCGArg *args, bool is_64)
{
    TCGReg addr_reg;
    TCGReg data_reg;
    MemOpIdx oi;
    MemOp opc;

    data_reg = *args++;
    addr_reg = *args++;
    oi = *args++;
    opc = get_memop(oi);

    uint8_t base = tcg_wasm_out_tlb_load(s, addr_reg, oi, true);
    
    tcg_wasm_out_op_local_get(s, base);
    tcg_wasm_out_op_i64_eqz(s);
    tcg_wasm_out_op_if_noret(s);

    // path for miss case
    int helper_func_idx = (uint32_t)qemu_ld_helper_ptr(oi);
    int func_idx = get_wasm_helper_idx(s, helper_func_idx);
    if (func_idx < 0) {
        func_idx = wasm_register_helper_alloc_num(s);
        tcg_debug_assert(helper_func_idx >= 0);
        wasm_register_helper(s, func_idx, helper_func_idx);
        gen_func_type_qemu_ld(s, oi);
    }

    // save function pointer
    tcg_wasm_out_ctx_i32_store_const(s, DONE_FLAG_OFF, 0);

    tcg_wasm_out_op_else(s);

    // fast path
    tcg_wasm_out_qemu_ld_direct(s, data_reg, base, opc);

    tcg_wasm_out_op_end(s);

    int target_block_idx = wasm_block_current_idx(s) + 1;
    tcg_wasm_out_op_i64_const(s, target_block_idx);
    tcg_wasm_out_op_global_set(s, BLOCK_PTR_IDX);   /* resume point */

    tcg_wasm_out_op_end(s); // close if of this block (rewind skips this)
    env_cached = false;
    
    // block for calling helper (+1)
    int block_idx = wasm_alloc_block_idx(s);
    tcg_wasm_out_bp_get(s);
    tcg_wasm_out_op_i64_const(s, block_idx);
    tcg_wasm_out_op_i64_le_u(s);
    tcg_wasm_out_op_if_noret(s);

    tcg_wasm_out_op_local_get(s, base);
    tcg_wasm_out_op_i64_eqz(s);
    tcg_wasm_out_op_if_noret(s);
    tcg_wasm_out_spill_regs(s);

    // call helper
    tcg_wasm_out_op_global_get_r(s, TCG_AREG0);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_global_get_r(s, addr_reg);
    tcg_wasm_out_op_i32_const(s, oi);
    tcg_wasm_out_op_i32_const(s, (int32_t)((intptr_t)s->code_ptr + bb_code_bias));

    tcg_wasm_out_op_call(s, func_idx);
    tcg_wasm_out_op_global_set_r(s, data_reg);
    tcg_wasm_out_ctx_i32_load(s, DONE_FLAG_OFF);
    tcg_wasm_out_op_i32_eqz(s);

    tcg_wasm_out_op_if_noret(s);
    tcg_wasm_out_op_i32_const(s, 0);
    tcg_wasm_out_op_return(s);
    tcg_wasm_out_op_end(s);
    tcg_wasm_out_op_end(s);
}

static void tcg_wasm_out_qemu_st_direct(TCGContext *s, TCGReg lo, uint8_t base, MemOp opc)
{
    /* Byte swapping is left to middle-end expansion. */
    tcg_debug_assert((opc & MO_BSWAP) == 0);

    switch (opc & (MO_SSIZE)) {
    case MO_8:
        tcg_wasm_out_op_local_get(s, base);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_global_get_r(s, lo);
        tcg_wasm_out_op_i64_store8(s, 0, 0);
        break;
    case MO_16:
        tcg_wasm_out_op_local_get(s, base);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_global_get_r(s, lo);
        tcg_wasm_out_op_i64_store16(s, 0, 0);
        break;
    case MO_32:
        tcg_wasm_out_op_local_get(s, base);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_global_get_r(s, lo);
        tcg_wasm_out_op_i64_store32(s, 0, 0);
        break;
    case MO_64:
        tcg_wasm_out_op_local_get(s, base);
        tcg_wasm_out_op_i32_wrap_i64(s);
        tcg_wasm_out_op_global_get_r(s, lo);
        tcg_wasm_out_op_i64_store(s, 0, 0);
        break;
    default:
        g_assert_not_reached();
    }
}

static void* qemu_st_helper_ptr(uint32_t oi)
{
    MemOp mop = get_memop(oi);
    switch (mop & MO_SIZE) {
    case MO_8:
        return helper_stb_mmu;
    case MO_16:
        return helper_stw_mmu;
    case MO_32:
        return helper_stl_mmu;
    case MO_64:
        return helper_stq_mmu;
    case MO_128:
        return helper_st16_mmu;
    default:
        g_assert_not_reached();
    }
}

static void tcg_wasm_out_qemu_st(TCGContext *s, const TCGArg *args, bool is_64)
{
    TCGReg addr_reg;
    TCGReg data_reg;
    MemOpIdx oi;
    MemOp opc;

    data_reg = *args++;
    addr_reg = *args++;
    oi = *args++;
    opc = get_memop(oi);

    uint8_t base = tcg_wasm_out_tlb_load(s, addr_reg, oi, false);

    tcg_wasm_out_op_local_get(s, base);
    tcg_wasm_out_op_i64_eqz(s);
    tcg_wasm_out_op_if_noret(s);

    // path for miss case
    int helper_func_idx = (uint32_t)qemu_st_helper_ptr(oi);
    int func_idx = get_wasm_helper_idx(s, helper_func_idx);
    if (func_idx < 0) {
        func_idx = wasm_register_helper_alloc_num(s);
        tcg_debug_assert(helper_func_idx >= 0);
        wasm_register_helper(s, func_idx, helper_func_idx);
        gen_func_type_qemu_st(s, oi);
    }

    // save function pointer
    tcg_wasm_out_ctx_i32_store_const(s, DONE_FLAG_OFF, 0);

    tcg_wasm_out_op_else(s);

    // fast path
    tcg_wasm_out_qemu_st_direct(s, data_reg, base, opc);

    tcg_wasm_out_op_end(s);

    int target_block_idx = wasm_block_current_idx(s) + 1;
    tcg_wasm_out_op_i64_const(s, target_block_idx);
    tcg_wasm_out_op_global_set(s, BLOCK_PTR_IDX);   /* resume point */

    tcg_wasm_out_op_end(s); // close if of this block (rewind skips this)
    env_cached = false;

    // block for calling helper (+1)
    int block_idx = wasm_alloc_block_idx(s);
    tcg_wasm_out_bp_get(s);
    tcg_wasm_out_op_i64_const(s, block_idx);
    tcg_wasm_out_op_i64_le_u(s);
    tcg_wasm_out_op_if_noret(s);

    tcg_wasm_out_op_local_get(s, base);
    tcg_wasm_out_op_i64_eqz(s);
    tcg_wasm_out_op_if_noret(s);
    tcg_wasm_out_spill_regs(s);

    // call helper
    tcg_wasm_out_op_global_get_r(s, TCG_AREG0);
    tcg_wasm_out_op_i32_wrap_i64(s);
    tcg_wasm_out_op_global_get_r(s, addr_reg);
    MemOp mop = get_memop(oi);
    switch (mop & MO_SSIZE) {
    case MO_UQ:
        tcg_wasm_out_op_global_get_r(s, data_reg);
        break;
    default:
        tcg_wasm_out_op_global_get_r(s, data_reg);
        tcg_wasm_out_op_i32_wrap_i64(s);
        break;
    }
    tcg_wasm_out_op_i32_const(s, oi);
    tcg_wasm_out_op_i32_const(s, (int32_t)((intptr_t)s->code_ptr + bb_code_bias));

    tcg_wasm_out_op_call(s, func_idx);

    tcg_wasm_out_ctx_i32_load(s, DONE_FLAG_OFF);
    tcg_wasm_out_op_i32_eqz(s);
    tcg_wasm_out_op_if_noret(s);
    tcg_wasm_out_op_i32_const(s, 0);
    tcg_wasm_out_op_return(s);
    tcg_wasm_out_op_end(s);
    tcg_wasm_out_op_end(s);
}

static bool patch_reloc(tcg_insn_unit *code_ptr_i, int type,
                        intptr_t value, intptr_t addend)
{
    int32_t *code_ptr = (int32_t*)code_ptr_i;
    intptr_t diff = value - (intptr_t)(code_ptr + 1);

    tcg_debug_assert(addend == 0);
    tcg_debug_assert(type == 20);

    if (diff == sextract32(diff, 0, type)) {
        tcg_patch32(code_ptr, deposit32(*code_ptr, 32 - type, type, diff));
        return true;
    }
    return false;
}

static void stack_bounds_check(TCGReg base, intptr_t offset)
{
    if (base == TCG_REG_CALL_STACK) {
        tcg_debug_assert(offset >= 0);
        tcg_debug_assert(offset < (TCG_STATIC_CALL_ARGS_SIZE +
                                   TCG_STATIC_FRAME_SIZE));
    }
}

static inline void tcg_tci_out32(TCGContext *s, uint32_t v)
{
    tcg_out32(s, v);
}

static uintptr_t cur_tci_ptr(TCGContext *s)
{
    return (uintptr_t)s->code_ptr;
}

static void tcg_tci_out_op_l(TCGContext *s, TCGOpcode op, TCGLabel *l0)
{
    uint32_t insn = 0;

    tcg_out_reloc(s, (void*)cur_tci_ptr(s), 20, l0, 0);
    insn = deposit32(insn, 0, 8, op);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_p(TCGContext *s, TCGOpcode op, void *p0)
{
    uint32_t insn = 0;
    intptr_t diff;

    /* Special case for exit_tb: map null -> 0. */
    if (p0 == NULL) {
        diff = 0;
    } else {
        /* p0 is outside the code (the TB): relative to the live position when re-translating */
        diff = p0 - (void *)((uint8_t*)cur_tci_ptr(s) + bb_code_bias + 4);
        tcg_debug_assert(diff != 0);
        if (diff != sextract32(diff, 0, 20)) {
            tcg_raise_tb_overflow(s);
        }
    }
    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 12, 20, diff);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_r(TCGContext *s, TCGOpcode op, TCGReg r0)
{
    uint32_t insn = 0;

    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_v(TCGContext *s, TCGOpcode op)
{
    tcg_tci_out32(s, (uint8_t)op);
}

static void tcg_tci_out_op_ri(TCGContext *s, TCGOpcode op, TCGReg r0, int32_t i1)
{
    uint32_t insn = 0;

    tcg_debug_assert(i1 == sextract32(i1, 0, 20));
    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 20, i1);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rl(TCGContext *s, TCGOpcode op, TCGReg r0, TCGLabel *l1)
{
    uint32_t insn = 0;

    tcg_out_reloc(s, (void*)cur_tci_ptr(s), 20, l1, 0);
    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rr(TCGContext *s, TCGOpcode op, TCGReg r0, TCGReg r1)
{
    uint32_t insn = 0;

    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 4, r1);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rrm(TCGContext *s, TCGOpcode op,
                           TCGReg r0, TCGReg r1, TCGArg m2)
{
    uint32_t insn = 0;

    tcg_debug_assert(m2 == extract32(m2, 0, 16));
    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 4, r1);
    insn = deposit32(insn, 16, 16, m2);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rrr(TCGContext *s, TCGOpcode op,
                           TCGReg r0, TCGReg r1, TCGReg r2)
{
    uint32_t insn = 0;

    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 4, r1);
    insn = deposit32(insn, 16, 4, r2);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rrs(TCGContext *s, TCGOpcode op,
                           TCGReg r0, TCGReg r1, intptr_t i2)
{
    uint32_t insn = 0;

    tcg_debug_assert(i2 == sextract32(i2, 0, 16));
    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 4, r1);
    insn = deposit32(insn, 16, 16, i2);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rrbb(TCGContext *s, TCGOpcode op, TCGReg r0,
                            TCGReg r1, uint8_t b2, uint8_t b3)
{
    uint32_t insn = 0;

    tcg_debug_assert(b2 == extract32(b2, 0, 6));
    tcg_debug_assert(b3 == extract32(b3, 0, 6));
    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 4, r1);
    insn = deposit32(insn, 16, 6, b2);
    insn = deposit32(insn, 22, 6, b3);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rrrc(TCGContext *s, TCGOpcode op,
                            TCGReg r0, TCGReg r1, TCGReg r2, TCGCond c3)
{
    uint32_t insn = 0;

    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 4, r1);
    insn = deposit32(insn, 16, 4, r2);
    insn = deposit32(insn, 20, 4, c3);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rrrbb(TCGContext *s, TCGOpcode op, TCGReg r0,
                             TCGReg r1, TCGReg r2, uint8_t b3, uint8_t b4)
{
    uint32_t insn = 0;

    tcg_debug_assert(b3 == extract32(b3, 0, 6));
    tcg_debug_assert(b4 == extract32(b4, 0, 6));
    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 4, r1);
    insn = deposit32(insn, 16, 4, r2);
    insn = deposit32(insn, 20, 6, b3);
    insn = deposit32(insn, 26, 6, b4);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rrrrr(TCGContext *s, TCGOpcode op, TCGReg r0,
                             TCGReg r1, TCGReg r2, TCGReg r3, TCGReg r4)
{
    uint32_t insn = 0;

    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 4, r1);
    insn = deposit32(insn, 16, 4, r2);
    insn = deposit32(insn, 20, 4, r3);
    insn = deposit32(insn, 24, 4, r4);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rrrr(TCGContext *s, TCGOpcode op,
                            TCGReg r0, TCGReg r1, TCGReg r2, TCGReg r3)
{
    uint32_t insn = 0;

    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 4, r1);
    insn = deposit32(insn, 16, 4, r2);
    insn = deposit32(insn, 20, 4, r3);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rrrrrc(TCGContext *s, TCGOpcode op,
                              TCGReg r0, TCGReg r1, TCGReg r2,
                              TCGReg r3, TCGReg r4, TCGCond c5)
{
    uint32_t insn = 0;

    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 4, r1);
    insn = deposit32(insn, 16, 4, r2);
    insn = deposit32(insn, 20, 4, r3);
    insn = deposit32(insn, 24, 4, r4);
    insn = deposit32(insn, 28, 4, c5);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_op_rrrrrr(TCGContext *s, TCGOpcode op,
                              TCGReg r0, TCGReg r1, TCGReg r2,
                              TCGReg r3, TCGReg r4, TCGReg r5)
{
    uint32_t insn = 0;

    insn = deposit32(insn, 0, 8, op);
    insn = deposit32(insn, 8, 4, r0);
    insn = deposit32(insn, 12, 4, r1);
    insn = deposit32(insn, 16, 4, r2);
    insn = deposit32(insn, 20, 4, r3);
    insn = deposit32(insn, 24, 4, r4);
    insn = deposit32(insn, 28, 4, r5);
    tcg_tci_out32(s, insn);
}

static void tcg_tci_out_movi(TCGContext *s, TCGType type,
                         TCGReg ret, tcg_target_long arg)
{
    switch (type) {
    case TCG_TYPE_I32:
#if TCG_TARGET_REG_BITS == 64
        arg = (int32_t)arg;
        /* fall through */
    case TCG_TYPE_I64:
#endif
        break;
    default:
        g_assert_not_reached();
    }

    if (arg == sextract32(arg, 0, 20)) {
        tcg_tci_out_op_ri(s, INDEX_op_tci_movi, ret, arg);
    } else {
        uint32_t insn = 0;

        new_pool_label(s, arg, 20, (void*)cur_tci_ptr(s), 0);
        insn = deposit32(insn, 0, 8, INDEX_op_tci_movl);
        insn = deposit32(insn, 8, 4, ret);
        tcg_tci_out32(s, insn);
    }
}

static void tcg_tci_out_ldst(TCGContext *s, TCGOpcode op, TCGReg val,
                         TCGReg base, intptr_t offset)
{
    stack_bounds_check(base, offset);
    if (offset != sextract32(offset, 0, 16)) {
        tcg_tci_out_movi(s, TCG_TYPE_PTR, TCG_REG_TMP, offset);
        tcg_tci_out_op_rrr(s, (TCG_TARGET_REG_BITS == 32
                           ? INDEX_op_add_i32 : INDEX_op_add_i64),
                       TCG_REG_TMP, TCG_REG_TMP, base);
        base = TCG_REG_TMP;
        offset = 0;
    }
    tcg_tci_out_op_rrs(s, op, val, base, offset);
}

static bool tcg_tci_out_mov(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg)
{
    switch (type) {
    case TCG_TYPE_I32:
        tcg_tci_out_op_rr(s, INDEX_op_mov_i32, ret, arg);
        break;
#if TCG_TARGET_REG_BITS == 64
    case TCG_TYPE_I64:
        tcg_tci_out_op_rr(s, INDEX_op_mov_i64, ret, arg);
        break;
#endif
    default:
        g_assert_not_reached();
    }
    return true;
}

static void tcg_tci_out_ext8s(TCGContext *s, TCGType type, TCGReg rd, TCGReg rs)
{
    switch (type) {
    case TCG_TYPE_I32:
        tcg_debug_assert(TCG_TARGET_HAS_ext8s_i32);
        tcg_tci_out_op_rr(s, INDEX_op_ext8s_i32, rd, rs);
        break;
#if TCG_TARGET_REG_BITS == 64
    case TCG_TYPE_I64:
        tcg_debug_assert(TCG_TARGET_HAS_ext8s_i64);
        tcg_tci_out_op_rr(s, INDEX_op_ext8s_i64, rd, rs);
        break;
#endif
    default:
        g_assert_not_reached();
    }
}

static void tcg_tci_out_ext8u(TCGContext *s, TCGReg rd, TCGReg rs)
{
    if (TCG_TARGET_REG_BITS == 64) {
        tcg_debug_assert(TCG_TARGET_HAS_ext8u_i64);
        tcg_tci_out_op_rr(s, INDEX_op_ext8u_i64, rd, rs);
    } else {
        tcg_debug_assert(TCG_TARGET_HAS_ext8u_i32);
        tcg_tci_out_op_rr(s, INDEX_op_ext8u_i32, rd, rs);
    }
}

static void tcg_tci_out_ext16s(TCGContext *s, TCGType type, TCGReg rd, TCGReg rs)
{
    switch (type) {
    case TCG_TYPE_I32:
        tcg_debug_assert(TCG_TARGET_HAS_ext16s_i32);
        tcg_tci_out_op_rr(s, INDEX_op_ext16s_i32, rd, rs);
        break;
#if TCG_TARGET_REG_BITS == 64
    case TCG_TYPE_I64:
        tcg_debug_assert(TCG_TARGET_HAS_ext16s_i64);
        tcg_tci_out_op_rr(s, INDEX_op_ext16s_i64, rd, rs);
        break;
#endif
    default:
        g_assert_not_reached();
    }
}

static void tcg_tci_out_ext16u(TCGContext *s, TCGReg rd, TCGReg rs)
{
    if (TCG_TARGET_REG_BITS == 64) {
        tcg_debug_assert(TCG_TARGET_HAS_ext16u_i64);
        tcg_tci_out_op_rr(s, INDEX_op_ext16u_i64, rd, rs);
    } else {
        tcg_debug_assert(TCG_TARGET_HAS_ext16u_i32);
        tcg_tci_out_op_rr(s, INDEX_op_ext16u_i32, rd, rs);
    }
}

static void tcg_tci_out_ext32s(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_debug_assert(TCG_TARGET_REG_BITS == 64);
    tcg_debug_assert(TCG_TARGET_HAS_ext32s_i64);
    tcg_tci_out_op_rr(s, INDEX_op_ext32s_i64, rd, rs);
}

static void tcg_tci_out_ext32u(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_debug_assert(TCG_TARGET_REG_BITS == 64);
    tcg_debug_assert(TCG_TARGET_HAS_ext32u_i64);
    tcg_tci_out_op_rr(s, INDEX_op_ext32u_i64, rd, rs);
}

static void tcg_tci_out_exts_i32_i64(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_tci_out_ext32s(s, rd, rs);
}

static void tcg_tci_out_extu_i32_i64(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_tci_out_ext32u(s, rd, rs);
}

static void tcg_tci_out_extrl_i64_i32(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_debug_assert(TCG_TARGET_REG_BITS == 64);
    tcg_tci_out_mov(s, TCG_TYPE_I32, rd, rs);
}

static void tcg_tci_out_call(TCGContext *s, const tcg_insn_unit *func,
                         const TCGHelperInfo *info)
{
    ffi_cif *cif = info->cif;
    uint32_t insn = 0;
    uint8_t which;

    if (cif->rtype == &ffi_type_void) {
        which = 0;
    } else {
        tcg_debug_assert(cif->rtype->size == 4 ||
                         cif->rtype->size == 8 ||
                         cif->rtype->size == 16);
        which = ctz32(cif->rtype->size) - 1;
    }
    new_pool_l2(s, 20, (void*)cur_tci_ptr(s), 0, (uintptr_t)func, (uintptr_t)cif);
    insn = deposit32(insn, 0, 8, INDEX_op_call);
    insn = deposit32(insn, 8, 4, which);
    tcg_tci_out32(s, insn);
}

#if TCG_TARGET_REG_BITS == 64
# define CASE_32_64(x) \
        case glue(glue(INDEX_op_, x), _i64): \
        case glue(glue(INDEX_op_, x), _i32):
# define CASE_64(x) \
        case glue(glue(INDEX_op_, x), _i64):
#else
# define CASE_32_64(x) \
        case glue(glue(INDEX_op_, x), _i32):
# define CASE_64(x)
#endif

static void tcg_tci_out_exit_tb(TCGContext *s, uintptr_t arg)
{
    tcg_tci_out_op_p(s, INDEX_op_exit_tb, (void *)arg);
}

static void tcg_tci_out_goto_tb(TCGContext *s, int which)
{
    /* indirect jump method. */
    tcg_tci_out_op_p(s, INDEX_op_goto_tb, (void *)get_jmp_target_addr(s, which));
    set_jmp_reset_offset(s, which);
}

static void tcg_out_nop_fill(tcg_insn_unit *p, int count)
{
    int32_t *p2 = (int32_t*)p;
    memset(p2, 0, sizeof(*p2) * count);
}

static void tcg_out_goto_ptr(TCGContext *s, TCGOpcode opc, TCGReg arg)
{
    tcg_tci_out_op_r(s, opc, arg);
    tcg_wasm_out_goto_ptr(s, arg);
}
static void tcg_out_br(TCGContext *s, TCGOpcode opc, TCGLabel *l)
{
    tcg_tci_out_op_l(s, opc, l);
    tcg_wasm_out_br(s, l);
}
static void tcg_out_setcond_i32(TCGContext *s, TCGOpcode opc, TCGCond cond, TCGReg ret,
                            TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrrc(s, opc, ret, arg1, arg2, cond);
    tcg_wasm_out_setcond_i32(s, cond, ret, arg1, arg2);
}
static void tcg_out_setcond_i64(TCGContext *s, TCGOpcode opc, TCGCond cond, TCGReg ret,
                            TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrrc(s, opc, ret, arg1, arg2, cond);
    tcg_wasm_out_setcond_i64(s, cond, ret, arg1, arg2);
}
static void tcg_out_movcond_i32(TCGContext *s, TCGOpcode opc, TCGCond cond, TCGReg ret,
                            TCGReg c1, TCGReg c2, TCGReg v1, TCGReg v2)
{
    tcg_tci_out_op_rrrrrc(s, opc, ret, c1, c2, v1, v2, cond);
    tcg_wasm_out_movcond_i32(s, cond, ret, c1, c2, v1, v2);
}
static void tcg_out_movcond_i64(TCGContext *s, TCGOpcode opc, TCGCond cond, TCGReg ret,
                            TCGReg c1, TCGReg c2, TCGReg v1, TCGReg v2)
{
    tcg_tci_out_op_rrrrrc(s, opc, ret, c1, c2, v1, v2, cond);
    tcg_wasm_out_movcond_i64(s, cond, ret, c1, c2, v1, v2);
}
static void tcg_out_ld(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
        tcg_tci_out_ldst(s, INDEX_op_ld_i32, val, base, offset);
        break;
    case TCG_TYPE_I64:
        tcg_tci_out_ldst(s, INDEX_op_ld_i64, val, base, offset);
        break;
    default:
        g_assert_not_reached();
    }
    tcg_wasm_out_ld(s, type, val, base, offset);
}
static void tcg_out_ld8s(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    tcg_tci_out_ldst(s, opc, val, base, offset);
    tcg_wasm_out_ld8s(s, type, val, base, offset);
}
static void tcg_out_ld8u(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    tcg_tci_out_ldst(s, opc, val, base, offset);
    tcg_wasm_out_ld8u(s, type, val, base, offset);
}
static void tcg_out_ld16s(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    tcg_tci_out_ldst(s, opc, val, base, offset);
    tcg_wasm_out_ld16s(s, type, val, base, offset);
}
static void tcg_out_ld16u(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    tcg_tci_out_ldst(s, opc, val, base, offset);
    tcg_wasm_out_ld16u(s, type, val, base, offset);
}
static void tcg_out_ld32s(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    tcg_tci_out_ldst(s, opc, val, base, offset);
    tcg_wasm_out_ld32s(s, type, val, base, offset);
}
static void tcg_out_ld32u(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    tcg_tci_out_ldst(s, opc, val, base, offset);
    tcg_wasm_out_ld32u(s, type, val, base, offset);
}
static void tcg_out_st(TCGContext *s, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    switch (type) {
    case TCG_TYPE_I32:
        tcg_tci_out_ldst(s, INDEX_op_st_i32, val, base, offset);
        break;
    case TCG_TYPE_I64:
        tcg_tci_out_ldst(s, INDEX_op_st_i64, val, base, offset);
        break;
    default:
        g_assert_not_reached();
    }
    tcg_wasm_out_st(s, type, val, base, offset);
}
static void tcg_out_st8(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    tcg_tci_out_ldst(s, opc, val, base, offset);
    tcg_wasm_out_st8(s, type, val, base, offset);
}
static void tcg_out_st16(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    tcg_tci_out_ldst(s, opc, val, base, offset);
    tcg_wasm_out_st16(s, type, val, base, offset);
}
static void tcg_out_st32(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg val, TCGReg base,
                       intptr_t offset)
{
    tcg_tci_out_ldst(s, opc, val, base, offset);
    tcg_wasm_out_st32(s, type, val, base, offset);
}
static void tcg_out_i64_calc_add(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i64_calc_add(s, ret, arg1, arg2);
}
static void tcg_out_i64_calc_sub(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i64_calc_sub(s, ret, arg1, arg2);
}
static void tcg_out_i64_calc_mul(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i64_calc_mul(s, ret, arg1, arg2);
}
static void tcg_out_i64_calc_and(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i64_calc_and(s, ret, arg1, arg2);
}
static void tcg_out_i64_calc_or(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i64_calc_or(s, ret, arg1, arg2);
}
static void tcg_out_i64_calc_xor(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i64_calc_xor(s, ret, arg1, arg2);
}
static void tcg_out_shl(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_shl(s, type, ret, arg1, arg2);
}
static void tcg_out_i64_calc_shl(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i64_calc_shl(s, ret, arg1, arg2);
}
static void tcg_out_shr_u(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_shr_u(s, type, ret, arg1, arg2);
}
static void tcg_out_i64_calc_shr_u(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i64_calc_shr_u(s, ret, arg1, arg2);
}
static void tcg_out_shr_s(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_shr_s(s, type, ret, arg1, arg2);
}
static void tcg_out_i64_calc_shr_s(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i64_calc_shr_s(s, ret, arg1, arg2);
}
static void tcg_out_i64_calc_rotl(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i64_calc_rotl(s, ret, arg1, arg2);
}
static void tcg_out_i32_rotl(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i32_rotl(s, ret, arg1, arg2);
}
static void tcg_out_i32_rotr(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i32_rotr(s, ret, arg1, arg2);
}
static void tcg_out_i64_calc_rotr(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_i64_calc_rotr(s, ret, arg1, arg2);
}
static void tcg_out_i64_calc_div_s(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_div_s(s, type, ret, arg1, arg2);
}
static void tcg_out_i64_calc_div_u(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_div_u(s, type, ret, arg1, arg2);
}
static void tcg_out_i64_calc_rem_s(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_rem_s(s, type, ret, arg1, arg2);
}
static void tcg_out_i64_calc_rem_u(TCGContext *s, TCGOpcode opc, TCGType type, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_rem_u(s, type, ret, arg1, arg2);
}
static void tcg_out_andc(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_andc(s, ret, arg1, arg2);
}
static void tcg_out_orc(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_orc(s, ret, arg1, arg2);
}
static void tcg_out_eqv(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_eqv(s, ret, arg1, arg2);
}
static void tcg_out_nand(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_nand(s, ret, arg1, arg2);
}
static void tcg_out_nor(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_nor(s, ret, arg1, arg2);
}
static void tcg_out_clz32(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_clz32(s, ret, arg1, arg2);
}
static void tcg_out_clz64(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_clz64(s, ret, arg1, arg2);
}
static void tcg_out_ctz32(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_ctz32(s, ret, arg1, arg2);
}
static void tcg_out_ctz64(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrr(s, opc, ret, arg1, arg2);
    tcg_wasm_out_ctz64(s, ret, arg1, arg2);
}
static void tcg_out_brcond_i32(TCGContext *s, TCGOpcode opc, TCGCond cond, TCGReg arg1,
                           TCGReg arg2, TCGLabel *l)
{
    tcg_tci_out_op_rrrc(s, (opc == INDEX_op_brcond_i32 ? INDEX_op_setcond_i32 : INDEX_op_setcond_i64), TCG_REG_TMP, arg1, arg2, cond);
    tcg_tci_out_op_rl(s, opc, TCG_REG_TMP, l);
    tcg_wasm_out_brcond_i32(s, cond, arg1, arg2, l);

}
static void tcg_out_brcond_i64(TCGContext *s, TCGOpcode opc, TCGCond cond, TCGReg arg1,
                           TCGReg arg2, TCGLabel *l)
{
    tcg_tci_out_op_rrrc(s, (opc == INDEX_op_brcond_i32 ? INDEX_op_setcond_i32 : INDEX_op_setcond_i64), TCG_REG_TMP, arg1, arg2, cond);
    tcg_tci_out_op_rl(s, opc, TCG_REG_TMP, l);
    tcg_wasm_out_brcond_i64(s, cond, arg1, arg2, l);

}
static void tcg_out_neg(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg)
{
    tcg_tci_out_op_rr(s, opc, ret, arg);
    tcg_wasm_out_neg(s, ret, arg);
}
static void tcg_out_not(TCGContext *s, TCGOpcode opc, TCGReg ret, TCGReg arg)
{
    tcg_tci_out_op_rr(s, opc, ret, arg);
    tcg_wasm_out_not(s, ret, arg);
}
static void tcg_out_ctpop_i32(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg src)
{
    tcg_tci_out_op_rr(s, opc, dest, src);
    tcg_wasm_out_ctpop_i32(s, dest, src);
}
static void tcg_out_ctpop_i64(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg src)
{
    tcg_tci_out_op_rr(s, opc, dest, src);
    tcg_wasm_out_ctpop_i64(s, dest, src);
}
static void tcg_out_add2(TCGContext *s, TCGOpcode opc, TCGReg retl, TCGReg reth,
                         TCGReg al, TCGReg ah, TCGReg bl, TCGReg bh)
{
    tcg_tci_out_op_rrrrrr(s, opc, retl, reth, al, ah, bl, bh);
    tcg_wasm_out_add2(s, retl, reth, al, ah, bl, bh);
}
static void tcg_out_sub2(TCGContext *s, TCGOpcode opc, TCGReg retl, TCGReg reth,
                         TCGReg al, TCGReg ah, TCGReg bl, TCGReg bh)
{
    tcg_tci_out_op_rrrrrr(s, opc, retl, reth, al, ah, bl, bh);
    tcg_wasm_out_sub2(s, retl, reth, al, ah, bl, bh);
}
static void tcg_out_mulu2_i32(TCGContext *s, TCGOpcode opc, TCGReg retl, TCGReg reth, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrrr(s, opc, retl, reth, arg1, arg2);
    tcg_wasm_out_mulu2_i32(s, retl, reth, arg1, arg2);
}
static void tcg_out_muls2_i32(TCGContext *s, TCGOpcode opc, TCGReg retl, TCGReg reth, TCGReg arg1, TCGReg arg2)
{
    tcg_tci_out_op_rrrr(s, opc, retl, reth, arg1, arg2);
    tcg_wasm_out_muls2_i32(s, retl, reth, arg1, arg2);
}

static void tcg_out_bswap16_i32(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg src, int flags)
{
    tcg_tci_out_op_rr(s, opc, dest, src);
    if (flags & TCG_BSWAP_OS) {
        tcg_tci_out_op_rr(s, INDEX_op_ext16s_i32, dest, dest);
    }
    tcg_wasm_out_bswap16(s, dest, src, flags);
    if (flags & TCG_BSWAP_OS) {
        tcg_wasm_out_ext16s(s, TCG_TYPE_I32, dest, dest);
    }
}
static void tcg_out_bswap16_i64(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg src, int flags)
{
    tcg_tci_out_op_rr(s, opc, dest, src);
    if (flags & TCG_BSWAP_OS) {
        tcg_tci_out_op_rr(s, INDEX_op_ext16s_i64, dest, dest);
    }
    tcg_wasm_out_bswap16(s, dest, src, flags);
    if (flags & TCG_BSWAP_OS) {
        tcg_wasm_out_ext16s(s, TCG_TYPE_I64, dest, dest);
    }
}

static void tcg_out_bswap32_i32(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg src, int flags)
{
    tcg_tci_out_op_rr(s, opc, dest, src);
    tcg_wasm_out_bswap32(s, dest, src, flags);
}
static void tcg_out_bswap32_i64(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg src, int flags)
{
    tcg_tci_out_op_rr(s, opc, dest, src);
    if (flags & TCG_BSWAP_OS) {
        tcg_tci_out_op_rr(s, INDEX_op_ext32s_i64, dest, dest);
    }
    tcg_wasm_out_bswap32(s, dest, src, flags);
    if (flags & TCG_BSWAP_OS) {
        tcg_wasm_out_ext32s(s, dest, dest);
    }
}
static void tcg_out_bswap64_i64(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg src, int flags)
{
    tcg_tci_out_op_rr(s, opc, dest, src);
    tcg_wasm_out_bswap64(s, dest, src, flags);
}
static uint8_t tcg_tci_out_qemu_ldst(TCGContext *s, TCGOpcode opc, const TCGArg *args)
{
    TCGReg addr_reg = args[1];
    MemOpIdx oi = args[2];
    
    MemOp mopc = get_memop(oi);
    TCGAtomAlign aa = atom_and_align_for_opc(s, mopc, MO_ATOM_IFALIGN, false);
    unsigned a_mask = (1u << aa.align) - 1;

    int mem_index = get_mmuidx(oi);
    int fast_ofs = tlb_mask_table_ofs(s, mem_index);
    int mask_ofs = fast_ofs + offsetof(CPUTLBDescFast, mask);
    int table_ofs = fast_ofs + offsetof(CPUTLBDescFast, table);

    new_pool_l8(s, 20, (void*)cur_tci_ptr(s), 0,
                (TCGReg)args[0], (TCGReg)args[1], (TCGArg)args[2], (int32_t)a_mask, (int32_t)mask_ofs, (uint64_t)s->page_bits, s->page_mask, table_ofs);

    uint32_t insn = 0;
    insn = deposit32(insn, 0, 8, opc);
    tcg_tci_out32(s, insn);
}
static void tcg_out_qemu_ld(TCGContext *s, TCGOpcode opc, const TCGArg *args, bool is_64)
{
    tcg_tci_out_qemu_ldst(s, opc, args);
    tcg_wasm_out_qemu_ld(s, args, is_64);
}
static void tcg_out_qemu_st(TCGContext *s, TCGOpcode opc, const TCGArg *args, bool is_64)
{
    tcg_tci_out_qemu_ldst(s, opc, args);
    tcg_wasm_out_qemu_st(s, args, is_64);
}
static void tcg_out_deposit_i32(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg arg1, TCGReg arg2, int pos, int len)
{
    TCGArg max = opc == INDEX_op_deposit_i32 ? 32 : 64;
    tcg_tci_out_op_rrrbb(s, opc, dest, arg1, arg2, pos, len);
    tcg_wasm_out_deposit_i32(s, dest, arg1, arg2, pos, len);
}
static void tcg_out_deposit_i64(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg arg1, TCGReg arg2, int pos, int len)
{
    TCGArg max = opc == INDEX_op_deposit_i32 ? 32 : 64;
    tcg_tci_out_op_rrrbb(s, opc, dest, arg1, arg2, pos, len);
    tcg_wasm_out_deposit_i64(s, dest, arg1, arg2, pos, len);
}
static void tcg_out_extract_i32(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg arg1, int pos, int len)
{
    TCGArg max = tcg_op_defs[opc].flags & TCG_OPF_64BIT ? 64 : 32;
    tcg_tci_out_op_rrbb(s, opc, dest, arg1, pos, len);
    tcg_wasm_out_extract(s, dest, arg1, pos, len, TCG_TYPE_I32, false);
}
static void tcg_out_extract_i64(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg arg1, int pos, int len)
{
    TCGArg max = tcg_op_defs[opc].flags & TCG_OPF_64BIT ? 64 : 32;
    tcg_tci_out_op_rrbb(s, opc, dest, arg1, pos, len);
    tcg_wasm_out_extract(s, dest, arg1, pos, len, TCG_TYPE_I64, false);
}
static void tcg_out_sextract_i32(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg arg1, int pos, int len)
{
    TCGArg max = tcg_op_defs[opc].flags & TCG_OPF_64BIT ? 64 : 32;
    tcg_tci_out_op_rrbb(s, opc, dest, arg1, pos, len);
    tcg_wasm_out_extract(s, dest, arg1, pos, len, TCG_TYPE_I32, true);
}
static void tcg_out_sextract_i64(TCGContext *s, TCGOpcode opc, TCGReg dest, TCGReg arg1, int pos, int len)
{
    TCGArg max = tcg_op_defs[opc].flags & TCG_OPF_64BIT ? 64 : 32;
    tcg_tci_out_op_rrbb(s, opc, dest, arg1, pos, len);
    tcg_wasm_out_extract(s, dest, arg1, pos, len, TCG_TYPE_I64, true);
}
static void tcg_out_ext8s(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg)
{
    tcg_tci_out_ext8s(s, type, ret, arg);
    tcg_wasm_out_ext8s(s, type, ret, arg);
}
static void tcg_out_ext16s(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg)
{
    tcg_tci_out_ext16s(s, type, ret, arg);
    tcg_wasm_out_ext16s(s, type, ret, arg);
}
static void tcg_out_ext8u(TCGContext *s, TCGReg ret, TCGReg arg)
{
    tcg_tci_out_ext8u(s, ret, arg);
    tcg_wasm_out_ext8u(s, ret, arg);
}
static void tcg_out_ext16u(TCGContext *s, TCGReg ret, TCGReg arg)
{
    tcg_tci_out_ext16u(s, ret, arg);
    tcg_wasm_out_ext16u(s, ret, arg);
}
static void tcg_out_ext32s(TCGContext *s, TCGReg ret, TCGReg arg)
{
    tcg_tci_out_ext32s(s, ret, arg);
    tcg_wasm_out_ext32s(s, ret, arg);
}
static void tcg_out_ext32u(TCGContext *s, TCGReg ret, TCGReg arg)
{
    tcg_tci_out_ext32u(s, ret, arg);
    tcg_wasm_out_ext32u(s, ret, arg);
}
static void tcg_out_exts_i32_i64(TCGContext *s, TCGReg ret, TCGReg arg)
{
    tcg_tci_out_exts_i32_i64(s, ret, arg);
    tcg_wasm_out_exts_i32_i64(s, ret, arg);
}
static void tcg_out_extu_i32_i64(TCGContext *s, TCGReg ret, TCGReg arg)
{
    tcg_tci_out_extu_i32_i64(s, ret, arg);
    tcg_wasm_out_extu_i32_i64(s, ret, arg);
}

static void tcg_out_extrl_i64_i32(TCGContext *s, TCGReg rd, TCGReg rs)
{
    tcg_tci_out_extrl_i64_i32(s, rd, rs);
    tcg_wasm_out_extrl_i64_i32(s, rd, rs);
}

static bool tcg_out_mov(TCGContext *s, TCGType type, TCGReg ret, TCGReg arg)
{
    tcg_tci_out_mov(s, type, ret, arg);
    tcg_wasm_out_mov(s, type, ret, arg);
    return true;
}
static void tcg_out_movi(TCGContext *s, TCGType type,
                        TCGReg ret, tcg_target_long arg)
{
    tcg_tci_out_movi(s, type, ret, arg);
    tcg_wasm_out_movi(s, type, ret, arg);
}
static void tcg_out_addi_ptr(TCGContext *s, TCGReg rd, TCGReg rs,
                             tcg_target_long imm)
{
    g_assert_not_reached();
}
static bool tcg_out_xchg(TCGContext *s, TCGType type, TCGReg r1, TCGReg r2)
{
    return false;
}
static void tcg_out_exit_tb(TCGContext *s, uintptr_t arg)
{
    tcg_tci_out_exit_tb(s, arg);
    tcg_wasm_out_exit_tb(s, arg);
}
static void tcg_out_goto_tb(TCGContext *s, int which)
{
    tcg_tci_out_goto_tb(s, which);
    tcg_wasm_out_goto_tb(s, which);
}
static bool tcg_out_sti(TCGContext *s, TCGType type, TCGArg val,
                        TCGReg base, intptr_t ofs)
{
    return false;
}
static void tcg_out_call(TCGContext *s, const tcg_insn_unit *target,
                         const TCGHelperInfo *info)
{
    tcg_tci_out_call(s, target, info);
    tcg_wasm_out_call(s, target, info);
}

static void tcg_out_op(TCGContext *s, TCGOpcode opc,
                       const TCGArg args[TCG_MAX_OP_ARGS],
                       const int const_args[TCG_MAX_OP_ARGS])
{
    switch (opc) {
    case INDEX_op_goto_ptr:
        tcg_out_goto_ptr(s, opc, args[0]);
        break;
    case INDEX_op_br:
        tcg_out_br(s, opc, arg_label(args[0]));
        break;
    case INDEX_op_setcond_i32:
        tcg_out_setcond_i32(s, opc, args[3], args[0], args[1], args[2]);//
        break;
    case INDEX_op_setcond_i64:
        tcg_out_setcond_i64(s, opc, args[3], args[0], args[1], args[2]);//
        break;
    case INDEX_op_movcond_i32:
        tcg_out_movcond_i32(s, opc, args[5], args[0], args[1], args[2], args[3], args[4]);//
        break;
    case INDEX_op_movcond_i64:
        tcg_out_movcond_i64(s, opc, args[5], args[0], args[1], args[2], args[3], args[4]);//
        break;
    case INDEX_op_ld_i64:
        tcg_out_ld(s, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_ld8s_i32:
    case INDEX_op_ld8s_i64:
        tcg_out_ld8s(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_ld8u_i32:
    case INDEX_op_ld8u_i64:
        tcg_out_ld8u(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_ld16s_i32:
    case INDEX_op_ld16s_i64:
        tcg_out_ld16s(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_ld16u_i32:
    case INDEX_op_ld16u_i64:
        tcg_out_ld16u(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_ld32u_i64:
        tcg_out_ld32u(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_ld_i32:
    case INDEX_op_ld32s_i64:
        tcg_out_ld32s(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_st_i64:
        tcg_out_st(s, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_st8_i32:
    case INDEX_op_st8_i64:
        tcg_out_st8(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_st16_i32:
    case INDEX_op_st16_i64:
        tcg_out_st16(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_st_i32:
    case INDEX_op_st32_i64:
        tcg_out_st32(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_add_i32:
    case INDEX_op_add_i64:
        tcg_out_i64_calc_add(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_sub_i32:
    case INDEX_op_sub_i64:
        tcg_out_i64_calc_sub(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_mul_i32:
    case INDEX_op_mul_i64:
        tcg_out_i64_calc_mul(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_and_i32:
    case INDEX_op_and_i64:
        tcg_out_i64_calc_and(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_or_i32:
    case INDEX_op_or_i64:
        tcg_out_i64_calc_or(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_xor_i32:
    case INDEX_op_xor_i64:
        tcg_out_i64_calc_xor(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_shl_i32:
        tcg_out_shl(s, opc, TCG_TYPE_I32, args[0], args[1], args[2]);
        break;
    case INDEX_op_shl_i64:
        tcg_out_shl(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_shr_i32:
        tcg_out_shr_u(s, opc, TCG_TYPE_I32, args[0], args[1], args[2]);
        break;
    case INDEX_op_shr_i64:
        tcg_out_shr_u(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_sar_i32:
        tcg_out_shr_s(s, opc, TCG_TYPE_I32, args[0], args[1], args[2]);
        break;
    case INDEX_op_sar_i64:
        tcg_out_shr_s(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_rotl_i32:
        tcg_out_i32_rotl(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_rotl_i64:
        tcg_out_i64_calc_rotl(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_rotr_i32:
        tcg_out_i32_rotr(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_rotr_i64:
        tcg_out_i64_calc_rotr(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_div_i32:
        tcg_out_i64_calc_div_s(s, opc, TCG_TYPE_I32, args[0], args[1], args[2]);
        break;
    case INDEX_op_div_i64:
        tcg_out_i64_calc_div_s(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_divu_i32:
        tcg_out_i64_calc_div_u(s, opc, TCG_TYPE_I32, args[0], args[1], args[2]);
        break;
    case INDEX_op_divu_i64:
        tcg_out_i64_calc_div_u(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_rem_i32:
        tcg_out_i64_calc_rem_s(s, opc, TCG_TYPE_I32, args[0], args[1], args[2]);
        break;
    case INDEX_op_rem_i64:
        tcg_out_i64_calc_rem_s(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_remu_i32:
        tcg_out_i64_calc_rem_u(s, opc, TCG_TYPE_I32, args[0], args[1], args[2]);
        break;
    case INDEX_op_remu_i64:
        tcg_out_i64_calc_rem_u(s, opc, TCG_TYPE_I64, args[0], args[1], args[2]);
        break;
    case INDEX_op_andc_i32:
    case INDEX_op_andc_i64:
        tcg_out_andc(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_orc_i32:
    case INDEX_op_orc_i64:
        tcg_out_orc(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_eqv_i32:
    case INDEX_op_eqv_i64:
        tcg_out_eqv(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_nand_i32:
    case INDEX_op_nand_i64:
        tcg_out_nand(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_nor_i32:
    case INDEX_op_nor_i64:
        tcg_out_nor(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_clz_i32:
        tcg_out_clz32(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_clz_i64:
        tcg_out_clz64(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_ctz_i32:
        tcg_out_ctz32(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_ctz_i64:
        tcg_out_ctz64(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_brcond_i32:
        tcg_out_brcond_i32(s, opc, args[2], args[0], args[1], arg_label(args[3]));
        break;
    case INDEX_op_brcond_i64:
        tcg_out_brcond_i64(s, opc, args[2], args[0], args[1], arg_label(args[3]));
        break;
    case INDEX_op_neg_i32:
    case INDEX_op_neg_i64:
        tcg_out_neg(s, opc, args[0], args[1]);
        break;
    case INDEX_op_not_i32:
    case INDEX_op_not_i64:
        tcg_out_not(s, opc, args[0], args[1]);
        break;
    case INDEX_op_ctpop_i32:   /* 1 output, 1 input: args[0] = dest, args[1] = src */
        tcg_out_ctpop_i32(s, opc, args[0], args[1]);
        break;
    case INDEX_op_ctpop_i64:
        tcg_out_ctpop_i64(s, opc, args[0], args[1]);
        break;
    case INDEX_op_add2_i32:
    case INDEX_op_add2_i64:
        tcg_out_add2(s, opc, args[0], args[1], args[2], args[3], args[4], args[5]);
        break;
    case INDEX_op_sub2_i32:
    case INDEX_op_sub2_i64:
        tcg_out_sub2(s, opc, args[0], args[1], args[2], args[3], args[4], args[5]);
        break;
    case INDEX_op_qemu_ld_a32_i32:
    case INDEX_op_qemu_ld_a64_i32:
        tcg_out_qemu_ld(s, opc, args, false);
        break;
    case INDEX_op_qemu_st_a32_i32:
    case INDEX_op_qemu_st_a64_i32:
        tcg_out_qemu_st(s, opc, args, false);
        break;
    case INDEX_op_qemu_ld_a32_i64:
    case INDEX_op_qemu_ld_a64_i64:
        tcg_out_qemu_ld(s, opc, args, true);
        break;
    case INDEX_op_qemu_st_a32_i64:
    case INDEX_op_qemu_st_a64_i64:
        tcg_out_qemu_st(s, opc, args, true);
        break;
    case INDEX_op_extrl_i64_i32:
        tcg_out_extrl_i64_i32(s, args[0], args[1]);
        break;
    case INDEX_op_mb:
        tcg_tci_out_op_v(s, opc);
        tcg_wasm_out8(s, 0x01); // nop
        break;
    case INDEX_op_extract_i32:
        tcg_out_extract_i32(s, opc, args[0], args[1], args[2], args[3]);
        break;
    case INDEX_op_extract_i64:
        tcg_out_extract_i64(s, opc, args[0], args[1], args[2], args[3]);
        break;
    case INDEX_op_sextract_i32:
        tcg_out_sextract_i32(s, opc, args[0], args[1], args[2], args[3]);
        break;
    case INDEX_op_sextract_i64:
        tcg_out_sextract_i64(s, opc, args[0], args[1], args[2], args[3]);
        break;
    case INDEX_op_deposit_i32:
        tcg_out_deposit_i32(s, opc, args[0], args[1], args[2], args[3], args[4]);
        break;
    case INDEX_op_deposit_i64:
        tcg_out_deposit_i64(s, opc, args[0], args[1], args[2], args[3], args[4]);
        break;
    case INDEX_op_bswap16_i32:
        tcg_out_bswap16_i32(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_bswap16_i64:
        tcg_out_bswap16_i64(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_bswap32_i32:
        tcg_out_bswap32_i32(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_bswap32_i64:
        tcg_out_bswap32_i64(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_bswap64_i64:
        tcg_out_bswap64_i64(s, opc, args[0], args[1], args[2]);
        break;
    case INDEX_op_muls2_i32:
        tcg_out_muls2_i32(s, opc, args[0], args[1], args[2], args[3]);
        break;
    case INDEX_op_mulu2_i32:
        tcg_out_mulu2_i32(s, opc, args[0], args[1], args[2], args[3]);
        break;
    default:
        g_assert_not_reached();
        break;
    }
    return;
}

void tcg_out_init() {
    bootbox_tune_init();
    current_label_pos = 0;
    env_cached = false;
    regs_written = 0;
    wasm_fp_locals = false;
}

/* Test if a constant matches the constraint. */
static bool tcg_target_const_match(int64_t val, TCGType type, int ct, int vece)
{
    return ct & TCG_CT_CONST;
}

static void tcg_out_tb_start(TCGContext *s)
{
    /* nothing to do */
}

bool tcg_target_has_memory_bswap(MemOp memop)
{
    return false;
}

static void tcg_target_init(TCGContext *s)
{
    /* The current code uses uint8_t for tcg operations. */
    tcg_debug_assert(tcg_op_defs_max <= UINT8_MAX);

    /* Registers available for 32 bit operations. */
    tcg_target_available_regs[TCG_TYPE_I64] = BIT(TCG_TARGET_NB_REGS) - 1;
    tcg_target_available_regs[TCG_TYPE_I32] = BIT(TCG_TARGET_NB_REGS) - 1;
    /*
     * The interpreter "registers" are in the local stack frame and
     * cannot be clobbered by the called helper functions.  However,
     * the interpreter assumes a 64-bit return value and assigns to
     * the return value registers.
     */
    tcg_target_call_clobber_regs =
        MAKE_64BIT_MASK(TCG_REG_R0, 128 / TCG_TARGET_REG_BITS);

    s->reserved_regs = 0;
    tcg_regset_set_reg(s->reserved_regs, TCG_REG_TMP);
    tcg_regset_set_reg(s->reserved_regs, TCG_REG_CALL_STACK);

    /* The call arguments come first, followed by the temp storage. */
    tcg_set_frame(s, TCG_REG_CALL_STACK, TCG_STATIC_CALL_ARGS_SIZE,
                  TCG_STATIC_FRAME_SIZE);
}

/* Generate global QEMU prologue and epilogue code. */
static inline void tcg_target_qemu_prologue(TCGContext *s)
{
}
