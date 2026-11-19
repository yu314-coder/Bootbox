/*
 *  Host code generation
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

#include "trace.h"
#include "disas/disas.h"
#include "exec/exec-all.h"
#include "tcg/tcg.h"
#if defined(CONFIG_USER_ONLY)
#include "qemu.h"
#if defined(__FreeBSD__) || defined(__FreeBSD_kernel__)
#include <sys/param.h>
#if __FreeBSD_version >= 700104
#define HAVE_KINFO_GETVMMAP
#define sigqueue sigqueue_freebsd  /* avoid redefinition */
#include <sys/proc.h>
#include <machine/profile.h>
#define _KERNEL
#include <sys/user.h>
#undef _KERNEL
#undef sigqueue
#include <libutil.h>
#endif
#endif
#else
#include "exec/ram_addr.h"
#endif

#include "exec/cputlb.h"
#include "exec/translate-all.h"
#include "exec/translator.h"
#include "exec/tb-flush.h"
#include "qemu/bitmap.h"
#include "qemu/qemu-print.h"
#include "qemu/main-loop.h"
#include "qemu/cacheinfo.h"
#include "qemu/timer.h"
#include "exec/log.h"
#include "sysemu/cpus.h"
#include "sysemu/cpu-timers.h"
#include "sysemu/tcg.h"
#include "qapi/error.h"
#include "hw/core/tcg-cpu-ops.h"
#include "tb-jmp-cache.h"
#include "tb-hash.h"
#include "tb-context.h"
#include "internal-common.h"
#include "internal-target.h"
#include "perf.h"
#include "tcg/insn-start-words.h"

TBContext tb_ctx;

/*
 * Encode VAL as a signed leb128 sequence at P.
 * Return P incremented past the encoded value.
 */
static uint8_t *encode_sleb128(uint8_t *p, int64_t val)
{
    int more, byte;

    do {
        byte = val & 0x7f;
        val >>= 7;
        more = !((val == 0 && (byte & 0x40) == 0)
                 || (val == -1 && (byte & 0x40) != 0));
        if (more) {
            byte |= 0x80;
        }
        *p++ = byte;
    } while (more);

    return p;
}

/*
 * Decode a signed leb128 sequence at *PP; increment *PP past the
 * decoded value.  Return the decoded value.
 */
static int64_t decode_sleb128(const uint8_t **pp)
{
    const uint8_t *p = *pp;
    int64_t val = 0;
    int byte, shift = 0;

    do {
        byte = *p++;
        val |= (int64_t)(byte & 0x7f) << shift;
        shift += 7;
    } while (byte & 0x80);
    if (shift < TARGET_LONG_BITS && (byte & 0x40)) {
        val |= -(int64_t)1 << shift;
    }

    *pp = p;
    return val;
}

/* Encode the data collected about the instructions while compiling TB.
   Place the data at BLOCK, and return the number of bytes consumed.

   The logical table consists of TARGET_INSN_START_WORDS target_ulong's,
   which come from the target's insn_start data, followed by a uintptr_t
   which comes from the host pc of the end of the code implementing the insn.

   Each line of the table is encoded as sleb128 deltas from the previous
   line.  The seed for the first line is { tb->pc, 0..., tb->tc.ptr }.
   That is, the first column is seeded with the guest pc, the last column
   with the host pc, and the middle columns with zeros.  */

static int encode_search(TranslationBlock *tb, uint8_t *block)
{
    uint8_t *highwater = tcg_ctx->code_gen_highwater;
    uint64_t *insn_data = tcg_ctx->gen_insn_data;
    uint16_t *insn_end_off = tcg_ctx->gen_insn_end_off;
    uint8_t *p = block;
    int i, j, n;

    for (i = 0, n = tb->icount; i < n; ++i) {
        uint64_t prev, curr;

        for (j = 0; j < TARGET_INSN_START_WORDS; ++j) {
            if (i == 0) {
                prev = (!(tb_cflags(tb) & CF_PCREL) && j == 0 ? tb->pc : 0);
            } else {
                prev = insn_data[(i - 1) * TARGET_INSN_START_WORDS + j];
            }
            curr = insn_data[i * TARGET_INSN_START_WORDS + j];
            p = encode_sleb128(p, curr - prev);
        }
        prev = (i == 0 ? 0 : insn_end_off[i - 1]);
        curr = insn_end_off[i];
        p = encode_sleb128(p, curr - prev);

        /* Test for (pending) buffer overflow.  The assumption is that any
           one row beginning below the high water mark cannot overrun
           the buffer completely.  Thus we can test for overflow after
           encoding a row without having to check during encoding.  */
        if (unlikely(p > highwater)) {
            return -1;
        }
    }

    return p - block;
}

static int cpu_unwind_data_from_tb(TranslationBlock *tb, uintptr_t host_pc,
                                   uint64_t *data)
{
    uintptr_t iter_pc = (uintptr_t)tb->tc.ptr;
    const uint8_t *p = tb->tc.ptr + tb->tc.size;
    int i, j, num_insns = tb->icount;

    host_pc -= GETPC_ADJ;

    if (host_pc < iter_pc) {
        return -1;
    }

    memset(data, 0, sizeof(uint64_t) * TARGET_INSN_START_WORDS);
    if (!(tb_cflags(tb) & CF_PCREL)) {
        data[0] = tb->pc;
    }

    /*
     * Reconstruct the stored insn data while looking for the point
     * at which the end of the insn exceeds host_pc.
     */
    for (i = 0; i < num_insns; ++i) {
        for (j = 0; j < TARGET_INSN_START_WORDS; ++j) {
            data[j] += decode_sleb128(&p);
        }
        iter_pc += decode_sleb128(&p);
        if (iter_pc > host_pc) {
            return num_insns - i;
        }
    }
    return -1;
}

/*
 * Bootbox split hints. QEMU 8.2 requires MMIO to be the last insn of its TB (can_do_io);
 * cpu_io_recompile() enforces it by running the I/O insn as a one-off TB after a longjmp, but
 * the long TB stays cached, so a hot block that touches a device mid-TB (local-APIC EOI/TPR/ICR,
 * ~3,900/s while CPU-Z runs) paid a longjmp - a JavaScript exception on wasm - on EVERY run.
 * Remember, per TB start (ram address), that the TB must end at that insn and retire the long
 * TB: its next translation stops there, with the I/O insn last as the rule requires.
 */
#define BB_SPLIT_BITS 14
static struct { uint32_t key, n; } bb_split[1 << BB_SPLIT_BITS];
int bb_split_enabled = 1;   /* /bootbox-tune split=0 turns it off */

static inline unsigned bb_split_slot(uint32_t k)
{
    return (k * 2654435761u) >> (32 - BB_SPLIT_BITS);
}

/* code-buffer flush generation, for keys of TB modules shared between vCPU threads (tcg/wasm32.c) */
uint32_t bb_tb_flush_gen(void)
{
    return qatomic_read(&tb_ctx.tb_flush_count);
}

int bb_split_hint(tb_page_addr_t a)
{
    unsigned i = bb_split_slot((uint32_t)a);
    if (a == -1 || qatomic_read(&bb_split[i].key) != (uint32_t)a) {
        return 0;
    }
    return qatomic_read(&bb_split[i].n);
}

static void bb_split_set(tb_page_addr_t a, uint32_t n)
{
    unsigned i = bb_split_slot((uint32_t)a);
    qatomic_set(&bb_split[i].n, n);
    qatomic_set(&bb_split[i].key, (uint32_t)a);
}

/*
 * The cpu state corresponding to 'host_pc' is restored in
 * preparation for exiting the TB.
 */
void cpu_restore_state_from_tb(CPUState *cpu, TranslationBlock *tb,
                               uintptr_t host_pc)
{
    uint64_t data[TARGET_INSN_START_WORDS];
    int insns_left = cpu_unwind_data_from_tb(tb, host_pc, data);

    if (insns_left < 0) {
        return;
    }

    if (tb_cflags(tb) & CF_USE_ICOUNT) {
        assert(icount_enabled());
        /*
         * Reset the cycle counter to the start of the block and
         * shift if to the number of actually executed instructions.
         */
        cpu->neg.icount_decr.u16.low += insns_left;
    }

    cpu->cc->tcg_ops->restore_state_to_opc(cpu, tb, data);
}

bool cpu_restore_state(CPUState *cpu, uintptr_t host_pc)
{
    /*
     * The host_pc has to be in the rx region of the code buffer.
     * If it is not we will not be able to resolve it here.
     * The two cases where host_pc will not be correct are:
     *
     *  - fault during translation (instruction fetch)
     *  - fault from helper (not using GETPC() macro)
     *
     * Either way we need return early as we can't resolve it here.
     */
    if (in_code_gen_buffer((const void *)(host_pc - tcg_splitwx_diff))) {
        TranslationBlock *tb = tcg_tb_lookup(host_pc);
        if (tb) {
            cpu_restore_state_from_tb(cpu, tb, host_pc);
            return true;
        }
    }
    return false;
}

bool cpu_unwind_state_data(CPUState *cpu, uintptr_t host_pc, uint64_t *data)
{
    if (in_code_gen_buffer((const void *)(host_pc - tcg_splitwx_diff))) {
        TranslationBlock *tb = tcg_tb_lookup(host_pc);
        if (tb) {
            return cpu_unwind_data_from_tb(tb, host_pc, data) >= 0;
        }
    }
    return false;
}

void page_init(void)
{
    page_size_init();
    page_table_config_init();
}

/*
 * Isolate the portion of code gen which can setjmp/longjmp.
 * Return the size of the generated code, or negative on error.
 */
static int setjmp_gen_code(CPUArchState *env, TranslationBlock *tb,
                           vaddr pc, void *host_pc,
                           int *max_insns, int64_t *ti)
{
    int ret = sigsetjmp(tcg_ctx->jmp_trans, 0);
    if (unlikely(ret != 0)) {
        return ret;
    }

    tcg_func_start(tcg_ctx);

    tcg_ctx->cpu = env_cpu(env);
    gen_intermediate_code(env_cpu(env), tb, max_insns, pc, host_pc);
    assert(tb->size != 0);
    tcg_ctx->cpu = NULL;
    *max_insns = tb->icount;

    return tcg_gen_code(tcg_ctx, tb, pc);
}

#if defined(EMSCRIPTEN) && !defined(CONFIG_TCG_INTERPRETER)
extern __thread uint8_t *bb_regen_buf;
extern __thread intptr_t bb_code_bias;
static __thread uint8_t *bb_regen_scratch;
#define BB_REGEN_SCRATCH (512 * 1024)
/* Outcomes, readable from the page (magic first): [4] ok [5] not re-translatable [6] CPU state
 * mismatch [7] code page probe [8] translation error [9] code mismatch; at the last attempt:
 * [10] code-buffer flushes so far, [11] KB of the code buffer in use. */
uint32_t bb_regen_stats[12] __attribute__((used)) = { 0x42424242, 0x5a59414c, 0x44332211, 0x88776655 };

/* One re-translation of tb into buf (see bb_tb_regen_wasm); true if its interpreter code
 * [size word + code] is byte-identical to the live TB's at tc_ptr. */
static bool bb_regen_once(CPUArchState *env, TranslationBlock *tb, const void *tc_ptr,
                          uint8_t *buf, vaddr pc, void *host_pc, int max_insns, int *why)
{
    TCGContext *s = tcg_ctx;
    void *saved_hw = s->code_gen_highwater;
    uint16_t saved_size = tb->size, saved_icount = tb->icount;
    int64_t ti;

    s->gen_tb = tb;
    s->addr_type = TARGET_LONG_BITS == 32 ? TCG_TYPE_I32 : TCG_TYPE_I64;
#ifdef CONFIG_SOFTMMU
    s->page_bits = TARGET_PAGE_BITS;
    s->page_mask = TARGET_PAGE_MASK;
    s->tlb_dyn_max_bits = CPU_TLB_DYN_MAX_BITS;
#endif
    s->insn_start_words = TARGET_INSN_START_WORDS;
#ifdef TCG_GUEST_DEFAULT_MO
    s->guest_mo = TCG_GUEST_DEFAULT_MO;
#else
    s->guest_mo = TCG_MO_ALL;
#endif
    s->code_gen_highwater = bb_regen_scratch + BB_REGEN_SCRATCH - 4096;
    bb_regen_buf = buf;
    bb_code_bias = (intptr_t)tc_ptr - (intptr_t)buf;
    int r = setjmp_gen_code(env, tb, pc, host_pc, &max_insns, &ti);
    bb_regen_buf = NULL;
    bb_code_bias = 0;
    s->code_gen_highwater = saved_hw;
    s->gen_tb = NULL;
    s->cpu = NULL;
    tb->size = saved_size;          /* (rewritten with the same values when the code matches) */
    tb->icount = saved_icount;
    if (r < 0) {
        *why = 8;
        return false;
    }
    uint32_t off = *(const uint32_t *)tc_ptr;
    uint32_t len = *(const uint32_t *)((const uint8_t *)tc_ptr + off - 4);
    if (*(uint32_t *)buf != off || *(uint32_t *)(buf + off - 4) != len ||
        memcmp(buf + off, (const uint8_t *)tc_ptr + off, len)) {
        *why = 9;
        return false;
    }
    return true;
}

/*
 * Bootbox lazy modules: re-translate the live TB at tc_ptr (one about to run on this vCPU) into a
 * per-thread scratch buffer, this time keeping its wasm module (see bb_lazy_wasm in tcg.c). Returns
 * the scratch copy of the TB's code layout (what instantiate_wasm() reads), or NULL when the TB is
 * not safely re-translatable: MMIO or two-page code, CPU state that does not match the TB, or a
 * re-translation whose interpreter code is not byte-identical to the live TB's (the module must
 * agree with it: GETPC positions, the search data). Nothing of the live TB is written, so other
 * vCPUs may run it meanwhile.
 */
uint8_t *bb_tb_regen_wasm(CPUState *cpu, const void *tc_ptr)
{
    CPUArchState *env = cpu_env(cpu);
    TranslationBlock *tb = tcg_tb_lookup((uintptr_t)tc_ptr);
    vaddr pc;
    uint64_t cs_base;
    uint32_t flags;
    void *host_pc = NULL;
    CPUTLBEntryFull *full;
    int why = 5;

    bb_regen_stats[10] = qatomic_read(&tb_ctx.tb_flush_count);
    bb_regen_stats[11] = tcg_code_size() >> 10;

    if (!tb || tb->tc.ptr != tc_ptr || (tb->cflags & CF_INVALID) ||
        tb_page_addr0(tb) == -1 || tb_page_addr1(tb) != -1 || !tb->icount) {
        goto fail;
    }
    cpu_get_tb_cpu_state(env, &pc, &cs_base, &flags);
    if (cs_base != tb->cs_base || flags != tb->flags ||
        (!(tb->cflags & CF_PCREL) && pc != tb->pc)) {
        why = 6;
        goto fail;
    }
    /* the code page, without raising a guest fault (the live TB's lookup already probed it) */
    int tlb_flags = probe_access_full(env, pc, 1, MMU_INST_FETCH, cpu_mmu_index(env, true), true,
                                      &host_pc, &full, 0);
    if ((tlb_flags & (TLB_INVALID_MASK | TLB_MMIO)) || !host_pc ||
        full->lg_page_size < TARGET_PAGE_BITS ||
        qemu_ram_addr_from_host_nofail(host_pc) != tb_page_addr0(tb)) {
        why = 7;
        goto fail;
    }
    if (!bb_regen_scratch) {
        bb_regen_scratch = aligned_alloc(4096, BB_REGEN_SCRATCH);
        if (!bb_regen_scratch) {
            goto fail;
        }
    }
    /* same alignment as the live code: the constant pool is aligned to absolute addresses */
    uint8_t *buf = bb_regen_scratch + ((uintptr_t)tc_ptr & 4095);
    /*
     * The instruction limit is part of the code: the translator allows I/O on the instruction that
     * reaches it. tb_gen_code's limit first; a TB it had to shrink (overflow retry) stopped exactly
     * at its smaller limit, so the second try uses icount.
     */
    int max = tb->cflags & CF_COUNT_MASK ? tb->cflags & CF_COUNT_MASK : TCG_MAX_INSNS;
    if (!(tb->cflags & CF_COUNT_MASK)) {
        int h = bb_split_hint(tb_page_addr0(tb));
        if (h > 0 && h < TCG_MAX_INSNS) {
            max = h;
        }
    }
    if (bb_regen_once(env, tb, tc_ptr, buf, pc, host_pc, max, &why) ||
        (max != tb->icount && bb_regen_once(env, tb, tc_ptr, buf, pc, host_pc, tb->icount, &why))) {
        qatomic_inc(&bb_regen_stats[4]);
        return buf;
    }
fail:
    qatomic_inc(&bb_regen_stats[why]);
    return NULL;
}

/*
 * Bootbox regions: re-translate a TB that is NOT the one this vCPU is about to run (a linked
 * successor of it), to take its module into the same region. The CPU is not at that TB, so there
 * is no state to compare; the code page comes from the TB's own page address. A TB records
 * everything its translation depends on (flags, cs_base, cflags, and with CF_PCREL only the page
 * offset of its pc), and as for any re-translation the result is used only if its interpreter
 * code is byte-identical to the live TB's.
 */
static uint8_t *bb_tb_regen_member(CPUState *cpu, const void *tc_ptr, vaddr cur_pc)
{
    CPUArchState *env = cpu_env(cpu);
    TranslationBlock *tb = tcg_tb_lookup((uintptr_t)tc_ptr);
    int why = 5;

    if (!tb || tb->tc.ptr != tc_ptr || (tb->cflags & CF_INVALID) ||
        tb_page_addr0(tb) == -1 || tb_page_addr1(tb) != -1 || !tb->icount || !bb_regen_scratch) {
        return NULL;
    }
    vaddr pc = (tb->cflags & CF_PCREL)
        ? ((cur_pc & TARGET_PAGE_MASK) | (tb_page_addr0(tb) & ~TARGET_PAGE_MASK)) : tb->pc;
    void *host_pc = qemu_map_ram_ptr(NULL, tb_page_addr0(tb));
    if (!host_pc) {
        return NULL;
    }
    uint8_t *buf = bb_regen_scratch + ((uintptr_t)tc_ptr & 4095);
    int max = tb->cflags & CF_COUNT_MASK ? tb->cflags & CF_COUNT_MASK : TCG_MAX_INSNS;
    if (!(tb->cflags & CF_COUNT_MASK)) {
        int h = bb_split_hint(tb_page_addr0(tb));
        if (h > 0 && h < TCG_MAX_INSNS) {
            max = h;
        }
    }
    if (bb_regen_once(env, tb, tc_ptr, buf, pc, host_pc, max, &why) ||
        (max != tb->icount && bb_regen_once(env, tb, tc_ptr, buf, pc, host_pc, tb->icount, &why))) {
        return buf;
    }
    return NULL;
}

bool bb_region_begin(void);
int bb_region_count(void);
uint32_t bb_region_member_tb(int i);
bool bb_region_has(uint32_t tb);
bool bb_region_capture(uint32_t tb, uint32_t t0, uint32_t t1);
uint8_t *bb_region_build(uint32_t *len, uint32_t **helpers, uint32_t *nh);
#include "../../tcg/wasm32.h"
uint32_t bb_region_ind_site(int i, int n);
void bb_region_ind_set(int i, int n, uint32_t target, uint32_t tbs, uint32_t ent_off, uint64_t pc,
                       uint32_t tflags, uint64_t tcs, int inl);
uint32_t bb_jc_entry_off(vaddr pc);
uint32_t bb_curr_cflags(CPUState *cpu);
/* [0] magic, [1] regions built, [2] members in them, [3] head not re-translatable,
 * [4] successor not re-translatable, [5] build failed, [6] indirect jumps predicted,
 * [7] of those, lookups answered in place */
uint32_t bb_region_stats[8] __attribute__((used)) = { 0x52474e31 };

static uint32_t bb_tb_slot(const TranslationBlock *tb, int n)
{
    if (!tb || tb->jmp_reset_offset[n] == TB_JMP_OFFSET_INVALID) {
        return 0;
    }
    return (uint32_t)qatomic_read(&tb->jmp_target_addr[n]);
}

/*
 * Where the n-th indirect jump (goto_ptr) of region member i went the last time the interpreter
 * ran it: 0, or the code address of a live TB. Records the prediction with the member; when that
 * TB is of the kind the target described (wasm32_tb_state) and is what a lookup at the recorded pc
 * would be allowed to return, the member may also answer the lookup itself (see tcg_wasm_out_lookup_inline).
 */
static uint32_t bb_region_ind_target(CPUState *cpu, int i, int n)
{
    uint32_t site = bb_region_ind_site(i, n);
    if (!site) {
        return 0;
    }
    struct bb_ind_site e = bb_ind_tab[(site >> 2) & (BB_IND_TAB - 1)];
    if (e.site != site || !e.target) {
        return 0;
    }
    const TranslationBlock *tb = tcg_tb_lookup(e.target);
    const TranslationBlock *mtb = tcg_tb_lookup(bb_region_member_tb(i));
    if (!tb || !mtb || (uint32_t)(uintptr_t)tb->tc.ptr != e.target || (tb->cflags & CF_INVALID)) {
        return 0;
    }
    const WasmTbState *d = wasm32_tb_state;
    int inl = d && (tb->cflags & CF_PCREL) && tb_cflags(tb) == bb_curr_cflags(cpu) &&
              (tb->flags & d->need_set) == d->need_set && !(tb->flags & d->need_clr) &&
              (d->cs_off >= 0 || tb->cs_base == 0) &&
              ((e.pc ^ tb_page_addr0(tb)) & ~TARGET_PAGE_MASK) == 0;
    bb_region_ind_set(i, n, e.target, (uint32_t)(uintptr_t)tb, bb_jc_entry_off(e.pc), e.pc,
                      tb->flags, tb->cs_base, inl);
    qatomic_inc(&bb_region_stats[6]);
    if (inl) {
        qatomic_inc(&bb_region_stats[7]);
    }
    return e.target;
}

/*
 * Build the region module of the hot TB at tc_ptr (about to run on this vCPU): the TB itself and,
 * breadth first, the TBs its direct jumps are linked to, up to kmax. NULL when the TB itself
 * cannot be re-translated; a successor that cannot is simply left out.
 */
uint8_t *bb_region_compile(CPUState *cpu, const void *tc_ptr, int kmax,
                           uint32_t *len, uint32_t **helpers, uint32_t *nh)
{
    CPUArchState *env = cpu_env(cpu);
    vaddr pc;
    uint64_t cs_base;
    uint32_t flags;

    if (!bb_region_begin() || !bb_tb_regen_wasm(cpu, tc_ptr)) {
        qatomic_inc(&bb_region_stats[3]);
        return NULL;
    }
    TranslationBlock *tb = tcg_tb_lookup((uintptr_t)tc_ptr);
    if (!bb_region_capture((uint32_t)(uintptr_t)tc_ptr, bb_tb_slot(tb, 0), bb_tb_slot(tb, 1))) {
        qatomic_inc(&bb_region_stats[5]);
        return NULL;
    }
    cpu_get_tb_cpu_state(env, &pc, &cs_base, &flags);
    for (int i = 0; i < bb_region_count() && bb_region_count() < kmax; i++) {
        uint32_t self = bb_region_member_tb(i);
        const TranslationBlock *mtb = tcg_tb_lookup(self);
        for (int n = 0; n < 4 && bb_region_count() < kmax; n++) {
            /* its two direct jumps, then (indreg) where its indirect jumps last went */
            /* indreg 1/2: indirect targets compete with direct ones for the member slots */
            uint32_t t = n < 2 ? bb_tb_slot(mtb, n)
                               : (wasm_region_ind == 1 || wasm_region_ind == 2
                                  ? bb_region_ind_target(cpu, i, n - 2) : 0);
            if (!t || t == self || bb_region_has(t)) {
                continue;
            }
            if (!bb_tb_regen_member(cpu, (const void *)(uintptr_t)t, pc)) {
                qatomic_inc(&bb_region_stats[4]);
                continue;
            }
            const TranslationBlock *ttb = tcg_tb_lookup(t);
            bb_region_capture(t, bb_tb_slot(ttb, 0), bb_tb_slot(ttb, 1));
        }
    }
    if (wasm_region_ind) {
        /* predictions of the members the walk above did not reach (the region filled up first) */
        for (int i = 0; i < bb_region_count(); i++) {
            for (int n = 0; n < 2; n++) {
                uint32_t t = bb_region_ind_target(cpu, i, n);
                /* indreg 4: indirect targets only take the slots the direct walk left free */
                if (wasm_region_ind == 4 && t && bb_region_count() < kmax && !bb_region_has(t) &&
                    bb_tb_regen_member(cpu, (const void *)(uintptr_t)t, pc)) {
                    const TranslationBlock *ttb = tcg_tb_lookup(t);
                    bb_region_capture(t, bb_tb_slot(ttb, 0), bb_tb_slot(ttb, 1));
                }
            }
        }
    }
    uint8_t *mod = bb_region_build(len, helpers, nh);
    if (!mod) {
        qatomic_inc(&bb_region_stats[5]);
        return NULL;
    }
    qatomic_inc(&bb_region_stats[1]);
    qatomic_add(&bb_region_stats[2], bb_region_count());
    return mod;
}
#endif

/* Called with mmap_lock held for user mode emulation.  */
TranslationBlock *tb_gen_code(CPUState *cpu,
                              vaddr pc, uint64_t cs_base,
                              uint32_t flags, int cflags)
{
    CPUArchState *env = cpu_env(cpu);
    TranslationBlock *tb, *existing_tb;
    tb_page_addr_t phys_pc, phys_p2;
    tcg_insn_unit *gen_code_buf;
    int gen_code_size, search_size, max_insns;
    int64_t ti;
    void *host_pc;
    extern uint32_t bb_st_tbgen;    /* tcg/wasm32.c: /bootbox-tune stats=1 */
    extern int bb_stats;

    assert_memory_lock();
    if (bb_stats) {
        bb_st_tbgen++;
    }
    qemu_thread_jit_write();

    phys_pc = get_page_addr_code_hostp(env, pc, &host_pc);

    if (phys_pc == -1) {
        /* Generate a one-shot TB with 1 insn in it */
        cflags = (cflags & ~CF_COUNT_MASK) | 1;
    }

    max_insns = cflags & CF_COUNT_MASK;
    if (max_insns == 0) {
        int h = bb_split_hint(phys_pc);   /* Bootbox: end where a device was touched */
        max_insns = h > 0 && h < TCG_MAX_INSNS ? h : TCG_MAX_INSNS;
    }
    QEMU_BUILD_BUG_ON(CF_COUNT_MASK + 1 != TCG_MAX_INSNS);

 buffer_overflow:
    assert_no_pages_locked();
    tb = tcg_tb_alloc(tcg_ctx);
    if (unlikely(!tb)) {
        /* flush must be done */
        tb_flush(cpu);
        mmap_unlock();
        /* Make the execution loop process the flush as soon as possible.  */
        cpu->exception_index = EXCP_INTERRUPT;
        cpu_loop_exit(cpu);
    }

    gen_code_buf = tcg_ctx->code_gen_ptr;
    tb->tc.ptr = tcg_splitwx_to_rx(gen_code_buf);
    if (!(cflags & CF_PCREL)) {
        tb->pc = pc;
    }
    tb->cs_base = cs_base;
    tb->flags = flags;
    tb->cflags = cflags;
    tb_set_page_addr0(tb, phys_pc);
    tb_set_page_addr1(tb, -1);
    if (phys_pc != -1) {
        tb_lock_page0(phys_pc);
    }

    tcg_ctx->gen_tb = tb;
    tcg_ctx->addr_type = TARGET_LONG_BITS == 32 ? TCG_TYPE_I32 : TCG_TYPE_I64;
#ifdef CONFIG_SOFTMMU
    tcg_ctx->page_bits = TARGET_PAGE_BITS;
    tcg_ctx->page_mask = TARGET_PAGE_MASK;
    tcg_ctx->tlb_dyn_max_bits = CPU_TLB_DYN_MAX_BITS;
#endif
    tcg_ctx->insn_start_words = TARGET_INSN_START_WORDS;
#ifdef TCG_GUEST_DEFAULT_MO
    tcg_ctx->guest_mo = TCG_GUEST_DEFAULT_MO;
#else
    tcg_ctx->guest_mo = TCG_MO_ALL;
#endif

 restart_translate:
    trace_translate_block(tb, pc, tb->tc.ptr);

    gen_code_size = setjmp_gen_code(env, tb, pc, host_pc, &max_insns, &ti);
    if (unlikely(gen_code_size < 0)) {
        switch (gen_code_size) {
        case -1:
            /*
             * Overflow of code_gen_buffer, or the current slice of it.
             *
             * TODO: We don't need to re-do gen_intermediate_code, nor
             * should we re-do the tcg optimization currently hidden
             * inside tcg_gen_code.  All that should be required is to
             * flush the TBs, allocate a new TB, re-initialize it per
             * above, and re-do the actual code generation.
             */
            qemu_log_mask(CPU_LOG_TB_OP | CPU_LOG_TB_OP_OPT,
                          "Restarting code generation for "
                          "code_gen_buffer overflow\n");
            tb_unlock_pages(tb);
            tcg_ctx->gen_tb = NULL;
            goto buffer_overflow;

        case -2:
            /*
             * The code generated for the TranslationBlock is too large.
             * The maximum size allowed by the unwind info is 64k.
             * There may be stricter constraints from relocations
             * in the tcg backend.
             *
             * Try again with half as many insns as we attempted this time.
             * If a single insn overflows, there's a bug somewhere...
             */
            assert(max_insns > 1);
            max_insns /= 2;
            qemu_log_mask(CPU_LOG_TB_OP | CPU_LOG_TB_OP_OPT,
                          "Restarting code generation with "
                          "smaller translation block (max %d insns)\n",
                          max_insns);

            /*
             * The half-sized TB may not cross pages.
             * TODO: Fix all targets that cross pages except with
             * the first insn, at which point this can't be reached.
             */
            phys_p2 = tb_page_addr1(tb);
            if (unlikely(phys_p2 != -1)) {
                tb_unlock_page1(phys_pc, phys_p2);
                tb_set_page_addr1(tb, -1);
            }
            goto restart_translate;

        case -3:
            /*
             * We had a page lock ordering problem.  In order to avoid
             * deadlock we had to drop the lock on page0, which means
             * that everything we translated so far is compromised.
             * Restart with locks held on both pages.
             */
            qemu_log_mask(CPU_LOG_TB_OP | CPU_LOG_TB_OP_OPT,
                          "Restarting code generation with re-locked pages");
            goto restart_translate;

        default:
            g_assert_not_reached();
        }
    }
    tcg_ctx->gen_tb = NULL;

    search_size = encode_search(tb, (void *)gen_code_buf + gen_code_size);
    if (unlikely(search_size < 0)) {
        tb_unlock_pages(tb);
        goto buffer_overflow;
    }
    tb->tc.size = gen_code_size;

    /*
     * For CF_PCREL, attribute all executions of the generated code
     * to its first mapping.
     */
    perf_report_code(pc, tb, tcg_splitwx_to_rx(gen_code_buf));

    if (qemu_loglevel_mask(CPU_LOG_TB_OUT_ASM) &&
        qemu_log_in_addr_range(pc)) {
        FILE *logfile = qemu_log_trylock();
        if (logfile) {
            int code_size, data_size;
            const tcg_target_ulong *rx_data_gen_ptr;
            size_t chunk_start;
            int insn = 0;

            if (tcg_ctx->data_gen_ptr) {
                rx_data_gen_ptr = tcg_splitwx_to_rx(tcg_ctx->data_gen_ptr);
                code_size = (const void *)rx_data_gen_ptr - tb->tc.ptr;
                data_size = gen_code_size - code_size;
            } else {
                rx_data_gen_ptr = 0;
                code_size = gen_code_size;
                data_size = 0;
            }

            /* Dump header and the first instruction */
            fprintf(logfile, "OUT: [size=%d]\n", gen_code_size);
            fprintf(logfile,
                    "  -- guest addr 0x%016" PRIx64 " + tb prologue\n",
                    tcg_ctx->gen_insn_data[insn * TARGET_INSN_START_WORDS]);
            chunk_start = tcg_ctx->gen_insn_end_off[insn];
            disas(logfile, tb->tc.ptr, chunk_start);

            /*
             * Dump each instruction chunk, wrapping up empty chunks into
             * the next instruction. The whole array is offset so the
             * first entry is the beginning of the 2nd instruction.
             */
            while (insn < tb->icount) {
                size_t chunk_end = tcg_ctx->gen_insn_end_off[insn];
                if (chunk_end > chunk_start) {
                    fprintf(logfile, "  -- guest addr 0x%016" PRIx64 "\n",
                            tcg_ctx->gen_insn_data[insn * TARGET_INSN_START_WORDS]);
                    disas(logfile, tb->tc.ptr + chunk_start,
                          chunk_end - chunk_start);
                    chunk_start = chunk_end;
                }
                insn++;
            }

            if (chunk_start < code_size) {
                fprintf(logfile, "  -- tb slow paths + alignment\n");
                disas(logfile, tb->tc.ptr + chunk_start,
                      code_size - chunk_start);
            }

            /* Finally dump any data we may have after the block */
            if (data_size) {
                int i;
                fprintf(logfile, "  data: [size=%d]\n", data_size);
                for (i = 0; i < data_size / sizeof(tcg_target_ulong); i++) {
                    if (sizeof(tcg_target_ulong) == 8) {
                        fprintf(logfile,
                                "0x%08" PRIxPTR ":  .quad  0x%016" TCG_PRIlx "\n",
                                (uintptr_t)&rx_data_gen_ptr[i], rx_data_gen_ptr[i]);
                    } else if (sizeof(tcg_target_ulong) == 4) {
                        fprintf(logfile,
                                "0x%08" PRIxPTR ":  .long  0x%08" TCG_PRIlx "\n",
                                (uintptr_t)&rx_data_gen_ptr[i], rx_data_gen_ptr[i]);
                    } else {
                        qemu_build_not_reached();
                    }
                }
            }
            fprintf(logfile, "\n");
            qemu_log_unlock(logfile);
        }
    }

    qatomic_set(&tcg_ctx->code_gen_ptr, (void *)
        ROUND_UP((uintptr_t)gen_code_buf + gen_code_size + search_size,
                 CODE_GEN_ALIGN));

    /* init jump list */
    qemu_spin_init(&tb->jmp_lock);
    tb->jmp_list_head = (uintptr_t)NULL;
    tb->jmp_list_next[0] = (uintptr_t)NULL;
    tb->jmp_list_next[1] = (uintptr_t)NULL;
    tb->jmp_dest[0] = (uintptr_t)NULL;
    tb->jmp_dest[1] = (uintptr_t)NULL;

    /* init original jump addresses which have been set during tcg_gen_code() */
    if (tb->jmp_reset_offset[0] != TB_JMP_OFFSET_INVALID) {
        tb_reset_jump(tb, 0);
    }
    if (tb->jmp_reset_offset[1] != TB_JMP_OFFSET_INVALID) {
        tb_reset_jump(tb, 1);
    }

    /*
     * If the TB is not associated with a physical RAM page then it must be
     * a temporary one-insn TB, and we have nothing left to do. Return early
     * before attempting to link to other TBs or add to the lookup table.
     */
    if (tb_page_addr0(tb) == -1) {
        assert_no_pages_locked();
        return tb;
    }

    /*
     * Insert TB into the corresponding region tree before publishing it
     * through QHT. Otherwise rewinding happened in the TB might fail to
     * lookup itself using host PC.
     */
    tcg_tb_insert(tb);

    /*
     * No explicit memory barrier is required -- tb_link_page() makes the
     * TB visible in a consistent state.
     */
    existing_tb = tb_link_page(tb);
    assert_no_pages_locked();

    /* if the TB already exists, discard what we just translated */
    if (unlikely(existing_tb != tb)) {
        uintptr_t orig_aligned = (uintptr_t)gen_code_buf;

        orig_aligned -= ROUND_UP(sizeof(*tb), tcg_tb_alignment());
        qatomic_set(&tcg_ctx->code_gen_ptr, (void *)orig_aligned);
        tcg_tb_remove(tb);
        return existing_tb;
    }
    return tb;
}

/* user-mode: call with mmap_lock held */
void tb_check_watchpoint(CPUState *cpu, uintptr_t retaddr)
{
    TranslationBlock *tb;

    assert_memory_lock();

    tb = tcg_tb_lookup(retaddr);
    if (tb) {
        /* We can use retranslation to find the PC.  */
        cpu_restore_state_from_tb(cpu, tb, retaddr);
        tb_phys_invalidate(tb, -1);
    } else {
        /* The exception probably happened in a helper.  The CPU state should
           have been saved before calling it. Fetch the PC from there.  */
        CPUArchState *env = cpu_env(cpu);
        vaddr pc;
        uint64_t cs_base;
        tb_page_addr_t addr;
        uint32_t flags;

        cpu_get_tb_cpu_state(env, &pc, &cs_base, &flags);
        addr = get_page_addr_code(env, pc);
        if (addr != -1) {
            tb_invalidate_phys_range(addr, addr);
        }
    }
}

#ifndef CONFIG_USER_ONLY
/*
 * In deterministic execution mode, instructions doing device I/Os
 * must be at the end of the TB.
 *
 * Called by softmmu_template.h, with iothread mutex not held.
 */
void cpu_io_recompile(CPUState *cpu, uintptr_t retaddr)
{
    TranslationBlock *tb;
    CPUClass *cc;
    uint32_t n;

    tb = tcg_tb_lookup(retaddr);
    if (!tb) {
        cpu_abort(cpu, "cpu_io_recompile: could not find TB for pc=%p",
                  (void *)retaddr);
    }
    cpu_restore_state_from_tb(cpu, tb, retaddr);

    /* Bootbox: make the split stick (see bb_split_hint) */
    if (bb_split_enabled && !(tb_cflags(tb) & CF_COUNT_MASK) && tb_page_addr0(tb) != -1 &&
        tb_page_addr1(tb) == -1) {
        uint64_t d[TARGET_INSN_START_WORDS];
        int left = cpu_unwind_data_from_tb(tb, retaddr, d);
        /* left == 1: already the last insn, but the TB's limit was not its length (a lone
         * rep-string insn into VGA memory): a limit equal to the length allows the I/O */
        if (left >= 1) {
            bb_split_set(tb_page_addr0(tb), tb->icount - left + 1);
            tb_phys_invalidate(tb, -1);
        }
    }

    /*
     * Some guests must re-execute the branch when re-executing a delay
     * slot instruction.  When this is the case, adjust icount and N
     * to account for the re-execution of the branch.
     */
    n = 1;
    cc = CPU_GET_CLASS(cpu);
    if (cc->tcg_ops->io_recompile_replay_branch &&
        cc->tcg_ops->io_recompile_replay_branch(cpu, tb)) {
        cpu->neg.icount_decr.u16.low++;
        n = 2;
    }

    /*
     * Exit the loop and potentially generate a new TB executing the
     * just the I/O insns. We also limit instrumentation to memory
     * operations only (which execute after completion) so we don't
     * double instrument the instruction.
     */
    cpu->cflags_next_tb = curr_cflags(cpu) | CF_MEMI_ONLY | n;

    if (qemu_loglevel_mask(CPU_LOG_EXEC)) {
        vaddr pc = log_pc(cpu, tb);
        if (qemu_log_in_addr_range(pc)) {
            qemu_log("cpu_io_recompile: rewound execution of TB to %016"
                     VADDR_PRIx "\n", pc);
        }
    }

    cpu_loop_exit_noexc(cpu);
}

#else /* CONFIG_USER_ONLY */

void cpu_interrupt(CPUState *cpu, int mask)
{
    g_assert(qemu_mutex_iothread_locked());
    cpu->interrupt_request |= mask;
    qatomic_set(&cpu->neg.icount_decr.u16.high, -1);
}

#endif /* CONFIG_USER_ONLY */

/*
 * Called by generic code at e.g. cpu reset after cpu creation,
 * therefore we must be prepared to allocate the jump cache.
 */
void tcg_flush_jmp_cache(CPUState *cpu)
{
    CPUJumpCache *jc = cpu->tb_jmp_cache;

    /* During early initialization, the cache may not yet be allocated. */
    if (unlikely(jc == NULL)) {
        return;
    }

    /*
     * Bootbox: one bulk memory.fill instead of 4096 seq-cst atomic stores (3.7% of a busy ARM
     * vCPU: every context switch flushes the TLB and with it this cache). Only the owning vCPU
     * stores non-NULL entries; other threads only ever store NULL, so the race is benign.
     */
    memset(jc->array, 0, sizeof(jc->array));
}
