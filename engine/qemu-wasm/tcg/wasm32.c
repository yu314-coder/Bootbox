/*
 * Tiny Code Generator for QEMU
 *
 * Wasm integration + ported TCI interpreter from tci.c
 *
 * Copyright (c) 2009, 2011, 2016 Stefan Weil
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

#if !defined(CONFIG_TCG_INTERPRETER) && defined(EMSCRIPTEN)

#include "qemu/osdep.h"
#include "exec/cpu_ldst.h"
#include "tcg/tcg-op.h"
#include "tcg/tcg-ldst.h"
#include <string.h>
#include <sched.h>
#include <emscripten.h>
#include <emscripten/threading.h>
#include "wasm32.h"

__thread uintptr_t tci_tb_ptr;

/* Disassemble TCI bytecode. */
int print_insn_tci(bfd_vma addr, disassemble_info *info)
{
    return 0; //nop
}

/*
 * Bootbox module sharing (/bootbox-tune share=1): every vCPU thread compiled its own copy of each hot
 * TB's module (wasm tables are per thread), so a block run on 4 vCPUs was compiled - and, under WebKit,
 * tiered up by its optimizing compiler - 4 times, and a thread the guest moved to another vCPU ran
 * interpreted there until that vCPU compiled the block too. The compiling thread now posts the
 * WebAssembly.Module (code is shared, instances stay per thread) on a page-unique BroadcastChannel;
 * the others keep the last few (bounded: pinned modules hold executable memory) and instantiate a
 * received module instead of re-translating and compiling. WebKit delivers Modules over
 * BroadcastChannel; Chrome delivers null (ignored - no sharing).
 * key = live TB address + code-buffer flush generation * 2^32.
 */
EM_JS(int, bb_share_has, (uint32_t tb, uint32_t gen), {
        const s = Module.__bbShare;
        return s && s.mods.has(tb + gen * 4294967296) ? 1 : 0;
});

/* yield to this worker's event loop (receive posted modules): a MessageChannel round trip, not
 * emscripten_sleep's setTimeout (nested timers are clamped to >= 4 ms) */
EM_ASYNC_JS(void, bb_yield_js, (), {
        const s = Module.__bbShare, t0 = performance.now();
        await new Promise((r) => {
            const c = new MessageChannel();
            c.port1.onmessage = () => { c.port1.close(); r(); };
            c.port2.postMessage(0);
        });
        if (s) { s.yields++; s.yieldMs += performance.now() - t0; }
});

/* returns the table index of the new instance's entry, 0 if the host refused the compile; *posted
 * (if share) is set to 1 when this thread compiled the module and posted it */
EM_JS(int, instantiate_wasm, (uint32_t key_tb, uint32_t gen, int share), {
        const s = share ? Module.__bbShare : null;
        const key = key_tb + gen * 4294967296;
        let mod = null, helperIdx = null;
        if (s) {
            const e = s.mods.get(key);
            if (e) {
                s.mods.delete(key); mod = e.m; helperIdx = e.h;
                if (++s.used % 500 == 0) err("[bbshare] core " + Module.__wasm32_tb.cur_core_num + ": used " + s.used + " received " + s.recv + " posted " + s.posted + " yields " + s.yields + " yieldms " + Math.round(s.yieldMs));
            }
        }
        if (!mod) {
        const memory_v = new DataView(HEAP8.buffer);

        const tb_ptr = memory_v.getInt32(Module.__wasm32_tb.tb_ptr_ptr, true);
        const export_vec_size = memory_v.getInt32(tb_ptr + 4, true);
        const export_vec_begin = tb_ptr + 4 + 4;

        const counter_vec_size = memory_v.getInt32(export_vec_begin + export_vec_size, true);
        const counter_vec_begin = export_vec_begin + export_vec_size + 4;
        
        const tmp_body_size = memory_v.getInt32(counter_vec_begin + counter_vec_size, true);
        const tmp_body_begin = counter_vec_begin + counter_vec_size + 4;
        const wasm_size = memory_v.getInt32(tmp_body_begin + tmp_body_size, true);
        const wasm_begin = tmp_body_begin + tmp_body_size + 4;
        const import_vec_size = memory_v.getInt32(wasm_begin + wasm_size, true);
        const import_vec_begin = wasm_begin + wasm_size + 4;

        const wasmBytes = HEAPU8.slice(wasm_begin, wasm_begin + wasm_size);
        helperIdx = [];
        for (var i = 0; i < import_vec_size / 4; i++) {
            helperIdx.push(memory_v.getInt32(import_vec_begin + i * 4, true));
        }
        try {
            mod = new WebAssembly.Module(wasmBytes);
        } catch (e) {
            if (!Module.__wasm32_tb.compile_err_logged) {
                Module.__wasm32_tb.compile_err_logged = true;
                err("[bootbox] TB compile refused (" + e + "); interpreting and lowering the live cap");
            }
            return 0;
        }
        if (s) {
            try { s.bc.postMessage({ k: key, m: mod, h: helperIdx, t: Date.now() }); s.posted++; } catch (e) {}
        }
        }
        var helper = {};
        for (var i = 0; i < helperIdx.length; i++) {
            helper[i] = wasmTable.get(helperIdx[i]);
        }
        let inst;
        try {
            inst = new WebAssembly.Instance(mod, {
                    "env": {
                        "buffer": wasmMemory,
                        "table": wasmTable,   /* Bootbox: TB chaining tail-calls through it */
                            },
                        "helper": helper,
                            });
        } catch (e) {
            if (!Module.__wasm32_tb.compile_err_logged) {
                Module.__wasm32_tb.compile_err_logged = true;
                err("[bootbox] TB instantiate refused (" + e + "); interpreting and lowering the live cap");
            }
            return 0;
        }

        const fidx = addFunction(inst.exports.start, 'ii');

        return fidx;
});

__thread bool initdone = false;
__thread int cur_core_num = -1;
__thread int export_vec_off = -1;
__thread int counter_vec_off = -1;
__thread int all_cores_num = -1;
int cur_core_num_max = 0;

/*
 * Bootbox: evicted TB instances are garbage, but their compiled code is only freed when the JS GC
 * runs, and nothing tells the GC about that code: under JavaScriptCore a vCPU worker compiling
 * ~1000 TBs/s let ~5 GB of dead instances pile up and the page was killed (a 15000-instance live
 * set is ~215 MB). A transient ArrayBuffer sized to the evicted batch (16 KB per instance, one page
 * touched) is reported to the GC as allocated memory and gets the dead instances collected: peak
 * footprint of the same churn 4.9 GB -> 0.75 GB in the JSC shell. Harmless under V8.
 */
EM_JS(void, remove_module_js, (), {
        const memory_v = new DataView(HEAP8.buffer);
        const remove_n = memory_v.getInt32(Module.__wasm32_tb.to_remove_instance_idx_ptr, true);
        for (var i = 0; i < remove_n * 4; i += 4) {
            removeFunction(memory_v.getInt32(Module.__wasm32_tb.to_remove_instance_ptr + i, true));
        }
        memory_v.setInt32(Module.__wasm32_tb.to_remove_instance_idx_ptr, 0, true);
        if (remove_n > 0) {
            const ballast = new Uint8Array(Math.min(remove_n * 16384, 64 << 20));
            ballast[0] = 1;
        }
    });

int instance_alive_global = 0;
__thread int instance_alive_local = 0;
__thread int instance_running_local = 0;
__thread uint32_t instance_garbage_collected_local = 0;

/* Layout is read by generated code (TB chaining): tb at 0, fidx at 4, used at 8. */
struct instance_info {
    uint8_t *tb;
    int fidx;
    int used;
};
QEMU_BUILD_BUG_ON(offsetof(struct instance_info, fidx) != 4);
QEMU_BUILD_BUG_ON(offsetof(struct instance_info, used) != INSTANCE_USED_OFF);

/* Live compiled-TB cap (all threads). Above it, the thread that wants to compile evicts its
 * least-recently-run instances back to the interpreter. Default 15000; tunable at startup via
 * /bootbox-tune ("max="), bounded by the per-thread slot table below. */
#define MAX_INSTANCE_ALIVE 15000
#define INSTANCE_RUNNING_LEN 65536
int wasm_instantiate_num = INSTANTIATE_NUM;
/*
 * Bootbox: every vCPU compiles its own instance of a TB (function tables are per thread) and counts
 * its own runs, so when a multi-threaded guest program spreads hot code to more cores, each extra
 * core re-interpreted it wasm_instantiate_num times and then paid its own compile - under WebKit,
 * where compiles are costly and the iPad needs jit=10000, CPU-Z's multi-thread phase was mostly
 * other cores warming up (4 cores = ~1.4x one core). A TB already compiled on another core is hot
 * code: compile it here after 1/16 of the runs. (Not 0, so a host that refuses compiles still
 * backs off.)
 */
int wasm_hot_num = INSTANTIATE_NUM / 16;
int wasm_hot_share;            /* /bootbox-tune hotshare=1 (off by default: Android keeps the old path) */
int bootbox_tsc_lockfree;      /* /bootbox-tune tsc=1: system/cpu-timers.c lock-free cpu_get_ticks */
static int wasm_max_instance_alive = MAX_INSTANCE_ALIVE;
__thread struct instance_info instance_running[INSTANCE_RUNNING_LEN];
__thread int instance_slots_hw = 0;      /* slots ever handed out */
__thread int instance_clock_hand = 0;
__thread int instance_free_slots[INSTANCE_RUNNING_LEN];
__thread int instance_free_n = 0;

#define TO_REMOVE_INSTANCE_SIZE 50000
__thread static int to_remove_instance[TO_REMOVE_INSTANCE_SIZE];
__thread static int to_remove_instance_idx = 0;

static bool can_add_instance()
{
    return qatomic_read(&instance_alive_global) < wasm_max_instance_alive;
}

static void inc_instance_local()
{
    instance_running_local++;
    instance_alive_local++;
}

/*
 * Bootbox: evicted instances stop counting against the live cap AT EVICTION. They used to stay
 * counted until the JS GC finalized them, and no further eviction was allowed meanwhile - but a
 * busy vCPU worker allocates little JS memory and rarely yields, so GC almost never ran: once a
 * big working set (llvmpipe + LLVM, Android, Wine) hit the cap, nothing new was ever compiled
 * again and the guest ran fully interpreted (glmark2: 0% of vCPU time in compiled blocks). An
 * evicted instance is unreachable (its table slot is freed), so the GC reclaims it whenever it
 * runs; if the host ever refuses a compile meanwhile, instantiate_wasm() falls back to TCI.
 * The FinalizationRegistry count is informational only now.
 */
static void check_instance_garbage_collected()
{
    instance_garbage_collected_local = 0;
}

/*
 * Bootbox: CLOCK (second-chance) eviction. This used to evict the OLDEST half of the thread's
 * instances (FIFO), hot or not. A Linux + X + Wine working set is ~20K blocks per vCPU, so with
 * the 15000 cap the hottest blocks were thrown out every ~0.5 s and recompiled at once: a CPU-Z
 * run compiled 1.96M modules for 22.8K distinct blocks (86x), ~17% of the vCPU in
 * Module/Instance creation, and the hot code never lived long enough to reach the browser's
 * optimizing tier. Now every run of an instance (dispatcher or chained tail call) sets its `used`
 * bit; the sweep clears set bits and evicts only instances not run since the previous sweep,
 * 1/8 of this thread's instances at a time. Slots never move, so nothing is ever written into a
 * TB that may have been freed by tb_flush (a stale slot just ages out); a TB whose slot was
 * reused sees slot->tb != tb and recompiles, exactly as before.
 */
static void remove_instance_running_local()
{
    int want = instance_running_local / 8;
    if (want < 1) {
        want = instance_running_local;
    }
    int freed = 0;
    for (int scanned = 0; freed < want && scanned < 2 * instance_slots_hw; scanned++) {
        struct instance_info *e = &instance_running[instance_clock_hand];
        int idx = instance_clock_hand;
        if (++instance_clock_hand >= instance_slots_hw) {
            instance_clock_hand = 0;
        }
        if (e->tb == NULL) {
            continue;
        }
        if (e->used) {
            e->used = 0;
            continue;
        }
        e->tb = NULL;
        to_remove_instance[to_remove_instance_idx++] = e->fidx;
        instance_free_slots[instance_free_n++] = idx;
        freed++;
    }
    if (to_remove_instance_idx > 0) {
        remove_module_js();
    }
    instance_running_local -= freed;
    instance_alive_local -= freed;
    qatomic_sub(&instance_alive_global, freed);
}

static void add_instance_running_local(int fidx, void *tb_ptr)
{
    int idx;
    if (instance_free_n == 0 && instance_slots_hw >= INSTANCE_RUNNING_LEN) {
        remove_instance_running_local();    /* every slot live: only if the cap is near the table size */
    }
    if (instance_free_n > 0) {
        idx = instance_free_slots[--instance_free_n];
    } else {
        idx = instance_slots_hw++;
    }
    instance_running[idx].tb = tb_ptr;
    instance_running[idx].fidx = fidx;
    instance_running[idx].used = 1;

    int tb_export_ptr = (uint32_t)tb_ptr + export_vec_off;
    *(uint32_t*)tb_export_ptr = (uint32_t)(&(instance_running[idx]));

    inc_instance_local();
    qatomic_inc(&instance_alive_global);
}

static int get_instance_running_local(void *tb_ptr)
{
    int tb_export_ptr = (uint32_t)tb_ptr + export_vec_off;
    struct instance_info *elm = (struct instance_info *)(*(uint32_t*)tb_export_ptr);
    if (elm == NULL) {
        return 0;
    }
    if (elm->tb != tb_ptr) {
        *(uint32_t*)tb_export_ptr = 0;
        int tb_counter_ptr = (uint32_t)tb_ptr + counter_vec_off;
        *(uint32_t*)tb_counter_ptr = wasm_instantiate_num; // will be instanciated immediately
        return 0;
    }
    elm->used = 1;
    return elm->fidx;
}

/* Another vCPU holds (or held) a compiled instance of this TB: its export-vector slot is set. */
static inline bool tb_hot_elsewhere(void *tb_ptr)
{
    const uint32_t *ev = (const uint32_t *)((uint8_t *)tb_ptr + 8);
    for (int i = 0; i < all_cores_num; i++) {
        if (i != cur_core_num && qatomic_read(&ev[i])) {
            return true;
        }
    }
    return false;
}

/*
 * Bootbox sumcnt=1: the runs of a TB on ALL cores count towards its compile. The guest moves a busy
 * thread between vCPUs, and every vCPU counts its own runs, so a TB could run jit x (cores) times
 * interpreted - or never compile at all when its runs were split (CPU-Z's single-thread phase ran
 * mostly interpreted on 4 vCPUs). Checked every 64 local runs.
 */
int wasm_sum_count;
static __attribute__((noinline)) bool tb_hot_in_sum(void *tb_ptr)
{
    const int32_t *cv = (const int32_t *)((uint8_t *)tb_ptr + 4 + 4 + all_cores_num * 4 + 4);
    int32_t sum = 0;
    for (int i = 0; i < all_cores_num; i++) {
        int32_t v = qatomic_read(&cv[i]);
        if (v > 0) {
            sum += v;
        }
    }
    return sum >= wasm_instantiate_num;
}

/* Bootbox module sharing: post a TB's module only if another vCPU has run the TB too (most compiled
 * blocks run on one vCPU; broadcasting all of them made every worker deserialize thousands of unused
 * modules) */
static inline bool tb_run_elsewhere(void *tb_ptr)
{
    const int32_t *cv = (const int32_t *)((uint8_t *)tb_ptr + 4 + 4 + all_cores_num * 4 + 4);
    for (int i = 0; i < all_cores_num; i++) {
        if (i != cur_core_num && qatomic_read(&cv[i]) != 0) {
            return true;
        }
    }
    return false;
}

/* Keep interpreting this TB (vs compile it now) at run count `cnt` on this core. */
static inline bool tb_wants_tci(int32_t cnt, void *tb_ptr)
{
    if (cnt < wasm_hot_num) {
        return true;
    }
    if (cnt >= wasm_instantiate_num) {
        return false;
    }
    if (wasm_hot_share && tb_hot_elsewhere(tb_ptr)) {
        return false;
    }
    if (wasm_sum_count && (cnt & 63) == 0 && tb_hot_in_sum(tb_ptr)) {
        return false;
    }
    return true;
}

uint32_t bb_share_id;                /* page-unique BroadcastChannel name (shared memory) */
int bb_share_on;                     /* /bootbox-tune share=1 */
uint32_t bb_share_posted;            /* modules posted by all threads */
static __thread uint32_t bb_share_seen;
static __thread double bb_share_last_yield;
double bb_clock_ms(void);
uint32_t bb_tb_flush_gen(void);     /* accel/tcg/translate-all.c */
void bootbox_tune_init(void);

#define MAX_EXEC_NUM 50000
__thread int exec_cnt = MAX_EXEC_NUM;
static inline void trysleep()
{
    if (bb_share_on && (exec_cnt & 2047) == 0) {
        /* take in modules other vCPUs posted: only when enough are pending, at most every 5 ms */
        uint32_t p = qatomic_read(&bb_share_posted);
        if (p - bb_share_seen >= 8) {
            double now = bb_clock_ms();
            if (now - bb_share_last_yield > 5) {
                bb_share_seen = p;
                bb_share_last_yield = now;
                bb_yield_js();
            }
        }
    }
    if (--exec_cnt == 0) {
        if (!can_add_instance()) {
            emscripten_sleep(0); // return to the browser main loop
            check_instance_garbage_collected();
        }
        exec_cnt = MAX_EXEC_NUM;
    }
}

__thread struct wasmContext ctx = {
    .tb_ptr = 0,
    .stack = NULL,
    /* .func_ptr = 0, */
    /* .next_func_ptr = 0, */
    .do_init = 1,
    .stack128 = NULL,
};

void set_done_flag()
{
    ctx.done_flag = 1;
}

void set_unwinding_flag()
{
    ctx.unwinding = 1;
}

typedef uint32_t (*wasm_func_ptr)(struct wasmContext*);

/*
 * Per-core slots in every TB's export/counter vectors: one per vCPU thread = TCG's context count
 * (-smp's maximum; set at accel init, before anything is translated). It was max(host cores, 8):
 * 64-80 bytes per TB where a 4-vCPU guest uses 32 - code-buffer space (full flushes). Before TCG is
 * initialised (never expected) the old safe size is used, and kept, so every TB agrees. Cached: this
 * was a JS call on every translation (~1.7% of an Android app launch).
 */
#define WASM_MIN_CORE_SLOTS 8
extern unsigned int tcg_max_ctxs;
int get_core_nums()
{
    static int n;
    int v = qatomic_read(&n);
    if (!v) {
        v = tcg_max_ctxs > 0 ? (int)tcg_max_ctxs
                             : MAX(emscripten_num_logical_cores(), WASM_MIN_CORE_SLOTS);
        qatomic_set(&n, v);
    }
    return v;
}

/* see get_clock() in include/qemu/timer.h: `performance` and its timeOrigin cached per thread */
EM_JS(double, bb_clock_ms, (), {
        var p = Module.__bbPerf;
        if (!p) {
            p = Module.__bbPerf = performance;
            Module.__bbOrigin = p.timeOrigin;
        }
        return Module.__bbOrigin + p.now();
});

EM_JS(void, init_wasm32_js, (int tb_ptr_ptr, int cur_core_num, int to_remove_instance_ptr, int to_remove_instance_idx_ptr, int instance_garbage_collected_ptr, uint32_t share_id, int share_on), {
        if (share_on && typeof BroadcastChannel === "function") {
            try {
                const s = Module.__bbShare = { mods: new Map(), bc: new BroadcastChannel("bbtb-" + share_id), used: 0, recv: 0, posted: 0, yields: 0, yieldMs: 0 };
                s.bc.onmessage = (e) => {
                    const d = e.data;
                    if (!d || !d.m) {
                        return;      /* Chrome cannot send Modules over BroadcastChannel */
                    }
                    s.mods.set(d.k, d);
                    s.recv++;
                    /* bounded: 1000 entries, none older than 3 s (each pins compiled code) */
                    const old = Date.now() - 3000;
                    for (const [k, v] of s.mods) {
                        if (s.mods.size <= 1000 && v.t >= old) {
                            break;
                        }
                        s.mods.delete(k);
                    }
                };
            } catch (e) {
                Module.__bbShare = null;
            }
        }
        /*
         * Bootbox: every compiled TB instance takes a table slot (addFunction). emscripten grows
         * the table ONE slot at a time when no freed slot is left, and WebKit's Table::grow is
         * linear in the table size - with tens of thousands of instances it was 10-25% of the
         * busy time sampled in a CPU-Z run under WebKit. Grow this thread's table once, up front,
         * and hand the slots to emscripten's free list (lowest first).
         */
        try {
            var add = 70000, base = wasmTable.length;
            wasmTable.grow(add);
            for (var i = base + add - 1; i >= base; i--) freeTableIndexes.push(i);
        } catch (e) {}
        Module.__wasm32_tb = {
            tb_ptr_ptr: tb_ptr_ptr,
            cur_core_num: cur_core_num,
            to_remove_instance_ptr: to_remove_instance_ptr,
            to_remove_instance_idx_ptr: to_remove_instance_idx_ptr,
            instance_garbage_collected_ptr: instance_garbage_collected_ptr,
            inst_gc_registry: new FinalizationRegistry((i) => {
                    if (i == "instance") {
                        const memory_v = new DataView(HEAP8.buffer);
                        let v = memory_v.getInt32(Module.__wasm32_tb.instance_garbage_collected_ptr, true);
                        memory_v.setInt32(Module.__wasm32_tb.instance_garbage_collected_ptr, v + 1, true);
                    }
            })
        };
});

void init_wasm32()
{
    if (!initdone) {
        cur_core_num = qatomic_fetch_inc(&cur_core_num_max);
        all_cores_num = get_core_nums();
        if (cur_core_num >= all_cores_num) {
            /* a vCPU thread past the per-TB vectors would overwrite its neighbours' slots */
            fprintf(stderr, "[bootbox] vCPU thread %d > TB core slots %d\n", cur_core_num, all_cores_num);
            abort();
        }
        export_vec_off = 4 + 4 + cur_core_num * 4;
        ctx.export_vec_off = export_vec_off;
        counter_vec_off = 4 + 4 + all_cores_num * 4 + 4 + cur_core_num * 4;
        ctx.stack = (uint64_t*)malloc(TCG_STATIC_CALL_ARGS_SIZE + TCG_STATIC_FRAME_SIZE);
        ctx.stack128 = (uint64_t*)malloc(TCG_STATIC_CALL_ARGS_SIZE + TCG_STATIC_FRAME_SIZE);
        ctx.tci_tb_ptr = (uint32_t*)&tci_tb_ptr;
        if (!qatomic_read(&bb_share_id)) {
            qatomic_cmpxchg(&bb_share_id, 0, ((uint32_t)emscripten_get_now() * 2654435761u) | 1);
        }
        bootbox_tune_init();
        init_wasm32_js((int)&ctx.tb_ptr, cur_core_num, (int)to_remove_instance, (int)&to_remove_instance_idx, (int)&instance_garbage_collected_local,
                       qatomic_read(&bb_share_id), bb_share_on);
        initdone = true;
    }
}

__thread uintptr_t tci_tb_ptr;

#include "wasm32-tci-calls.c.inc"

static void tci_write_reg64(tcg_target_ulong *regs, uint32_t high_index,
                            uint32_t low_index, uint64_t value)
{
    regs[low_index] = (uint32_t)value;
    regs[high_index] = value >> 32;
}

/* Create a 64 bit value from two 32 bit values. */
static uint64_t tci_uint64(uint32_t high, uint32_t low)
{
    return ((uint64_t)high << 32) + low;
}

static void tci_args_ldst(uint32_t insn, TCGReg *r0, TCGReg *r1, MemOpIdx *m2, const void *tb_ptr, void **l0)
{
    int diff = sextract32(insn, 12, 20);
    *l0 = diff ? (uint8_t *)tb_ptr + diff : NULL;

    uint64_t *data64 = (uint64_t*)*l0;
    *r0 = (TCGReg)data64[0];
    *r1 = (TCGReg)data64[1];
    *m2 = (MemOpIdx)data64[2];
}

/*
 * Load sets of arguments all at once.  The naming convention is:
 *   tci_args_<arguments>
 * where arguments is a sequence of
 *
 *   b = immediate (bit position)
 *   c = condition (TCGCond)
 *   i = immediate (uint32_t)
 *   I = immediate (tcg_target_ulong)
 *   l = label or pointer
 *   m = immediate (MemOpIdx)
 *   n = immediate (call return length)
 *   r = register
 *   s = signed ldst offset
 */

static void tci_args_l(uint32_t insn, const void *tb_ptr, void **l0)
{
    int diff = sextract32(insn, 12, 20);
    *l0 = diff ? (uint8_t *)tb_ptr + diff : NULL;
}

/*
 * Bootbox: br's label, with NO null mapping. tci_args_l maps displacement 0 to NULL for exit_tb(0),
 * but a br to the very next instruction also encodes 0: TCG keeps insn_start ops (which emit no TCI
 * code) in code its reachable-code pass removed, so "br L; insn_start...; set_label L" survives as a
 * zero-length branch. That jumped to address 0 (seen with short forward jcc kept inside the TB).
 */
static void tci_args_br(uint32_t insn, const void *tb_ptr, void **l0)
{
    *l0 = (uint8_t *)tb_ptr + sextract32(insn, 12, 20);
}

static void tci_args_r(uint32_t insn, TCGReg *r0)
{
    *r0 = extract32(insn, 8, 4);
}

static void tci_args_nl(uint32_t insn, const void *tb_ptr,
                        uint8_t *n0, void **l1)
{
    *n0 = extract32(insn, 8, 4);
    *l1 = sextract32(insn, 12, 20) + (void *)tb_ptr;
}

static void tci_args_rl(uint32_t insn, const void *tb_ptr,
                        TCGReg *r0, void **l1)
{
    *r0 = extract32(insn, 8, 4);
    *l1 = sextract32(insn, 12, 20) + (void *)tb_ptr;
}

static void tci_args_rr(uint32_t insn, TCGReg *r0, TCGReg *r1)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
}

static void tci_args_ri(uint32_t insn, TCGReg *r0, tcg_target_ulong *i1)
{
    *r0 = extract32(insn, 8, 4);
    *i1 = sextract32(insn, 12, 20);
}

static void tci_args_rrr(uint32_t insn, TCGReg *r0, TCGReg *r1, TCGReg *r2)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
}

static void tci_args_rrs(uint32_t insn, TCGReg *r0, TCGReg *r1, int32_t *i2)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *i2 = sextract32(insn, 16, 16);
}

static void tci_args_rrbb(uint32_t insn, TCGReg *r0, TCGReg *r1,
                          uint8_t *i2, uint8_t *i3)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *i2 = extract32(insn, 16, 6);
    *i3 = extract32(insn, 22, 6);
}

static void tci_args_rrrc(uint32_t insn,
                          TCGReg *r0, TCGReg *r1, TCGReg *r2, TCGCond *c3)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *c3 = extract32(insn, 20, 4);
}

static void tci_args_rrrbb(uint32_t insn, TCGReg *r0, TCGReg *r1,
                           TCGReg *r2, uint8_t *i3, uint8_t *i4)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *i3 = extract32(insn, 20, 6);
    *i4 = extract32(insn, 26, 6);
}

static void tci_args_rrrrr(uint32_t insn, TCGReg *r0, TCGReg *r1,
                           TCGReg *r2, TCGReg *r3, TCGReg *r4)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *r3 = extract32(insn, 20, 4);
    *r4 = extract32(insn, 24, 4);
}

static void tci_args_rrrr(uint32_t insn,
                          TCGReg *r0, TCGReg *r1, TCGReg *r2, TCGReg *r3)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *r3 = extract32(insn, 20, 4);
}

static void tci_args_rrrrrc(uint32_t insn, TCGReg *r0, TCGReg *r1,
                            TCGReg *r2, TCGReg *r3, TCGReg *r4, TCGCond *c5)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *r3 = extract32(insn, 20, 4);
    *r4 = extract32(insn, 24, 4);
    *c5 = extract32(insn, 28, 4);
}

static void tci_args_rrrrrr(uint32_t insn, TCGReg *r0, TCGReg *r1,
                            TCGReg *r2, TCGReg *r3, TCGReg *r4, TCGReg *r5)
{
    *r0 = extract32(insn, 8, 4);
    *r1 = extract32(insn, 12, 4);
    *r2 = extract32(insn, 16, 4);
    *r3 = extract32(insn, 20, 4);
    *r4 = extract32(insn, 24, 4);
    *r5 = extract32(insn, 28, 4);
}

static bool tci_compare32(uint32_t u0, uint32_t u1, TCGCond condition)
{
    bool result = false;
    int32_t i0 = u0;
    int32_t i1 = u1;
    switch (condition) {
    case TCG_COND_EQ:
        result = (u0 == u1);
        break;
    case TCG_COND_NE:
        result = (u0 != u1);
        break;
    case TCG_COND_LT:
        result = (i0 < i1);
        break;
    case TCG_COND_GE:
        result = (i0 >= i1);
        break;
    case TCG_COND_LE:
        result = (i0 <= i1);
        break;
    case TCG_COND_GT:
        result = (i0 > i1);
        break;
    case TCG_COND_LTU:
        result = (u0 < u1);
        break;
    case TCG_COND_GEU:
        result = (u0 >= u1);
        break;
    case TCG_COND_LEU:
        result = (u0 <= u1);
        break;
    case TCG_COND_GTU:
        result = (u0 > u1);
        break;
    default:
        g_assert_not_reached();
    }
    return result;
}

static bool tci_compare64(uint64_t u0, uint64_t u1, TCGCond condition)
{
    bool result = false;
    int64_t i0 = u0;
    int64_t i1 = u1;
    switch (condition) {
    case TCG_COND_EQ:
        result = (u0 == u1);
        break;
    case TCG_COND_NE:
        result = (u0 != u1);
        break;
    case TCG_COND_LT:
        result = (i0 < i1);
        break;
    case TCG_COND_GE:
        result = (i0 >= i1);
        break;
    case TCG_COND_LE:
        result = (i0 <= i1);
        break;
    case TCG_COND_GT:
        result = (i0 > i1);
        break;
    case TCG_COND_LTU:
        result = (u0 < u1);
        break;
    case TCG_COND_GEU:
        result = (u0 >= u1);
        break;
    case TCG_COND_LEU:
        result = (u0 <= u1);
        break;
    case TCG_COND_GTU:
        result = (u0 > u1);
        break;
    default:
        g_assert_not_reached();
    }
    return result;
}

static uint64_t tlb_load(CPUArchState *env, uint64_t taddr, MemOp mop, uint64_t* ptr, bool is_ld)
{
    uint64_t *data64 = (uint64_t*)ptr;
    unsigned a_mask = (unsigned)data64[3];
    int mask_ofs = (int)data64[4];
    int8_t page_bits = (int8_t)data64[5];
    uint64_t page_mask = (uint64_t)data64[6];
    int table_ofs = (uint64_t)data64[7];

    unsigned s_bits = mop & MO_SIZE;
    unsigned s_mask = (1u << s_bits) - 1;
    tcg_target_long compare_mask;
    int add_off = offsetof(CPUTLBEntry, addend);

    uint64_t tmp0 = taddr >> (page_bits - CPU_TLB_ENTRY_BITS);
    uint64_t tmp2 = *(uint64_t*)((uint8_t*)env + mask_ofs);
    uint64_t tmp2_b = *(uint64_t*)((uint8_t*)env + table_ofs);
    uint64_t tmp3 = (tmp0 & tmp2) + tmp2_b;
    int off = off = is_ld ? offsetof(CPUTLBEntry, addr_read)
        : offsetof(CPUTLBEntry, addr_write);
    uint64_t target = *(uint64_t*)((uint8_t*)tmp3 + off);
    uint64_t c_addr = taddr;
    if (a_mask < s_mask) {
        c_addr += s_mask - a_mask;
    }
    compare_mask = page_mask | a_mask;
    c_addr &= compare_mask;

    if (c_addr == target) {
        int32_t addend = *(uint32_t*)((uint8_t*)tmp3 + add_off);
        uint64_t target_addr = taddr + addend;
        return target_addr;
    }
    return 0;
}

static uint64_t tci_qemu_ld(CPUArchState *env, uint64_t taddr,
                            MemOpIdx oi, const void *tb_ptr, uint64_t* ptr)
{
    MemOp mop = get_memop(oi);
    uintptr_t ra = (uintptr_t)tb_ptr;

    uint64_t target_addr = tlb_load(env, taddr, mop, ptr, true);
    if (target_addr != 0) {
        switch (mop & MO_SSIZE) {
        case MO_UB:
            return *(uint8_t*)target_addr;
        case MO_SB:
            return *(int8_t*)target_addr;
        case MO_UW:
            return *(uint16_t*)target_addr;
        case MO_SW:
            return *(int16_t*)target_addr;
        case MO_UL:
            return *(uint32_t*)target_addr;
        case MO_SL:
            return *(int32_t*)target_addr;
        case MO_UQ:
            return *(uint64_t*)target_addr;
        default:
            g_assert_not_reached();
        }
    }

    switch (mop & MO_SSIZE) {
    case MO_UB:
        return helper_ldub_mmu(env, taddr, oi, ra);
    case MO_SB:
        return helper_ldsb_mmu(env, taddr, oi, ra);
    case MO_UW:
        return helper_lduw_mmu(env, taddr, oi, ra);
    case MO_SW:
        return helper_ldsw_mmu(env, taddr, oi, ra);
    case MO_UL:
        return helper_ldul_mmu(env, taddr, oi, ra);
    case MO_SL:
        return helper_ldsl_mmu(env, taddr, oi, ra);
    case MO_UQ:
        return helper_ldq_mmu(env, taddr, oi, ra);
    default:
        g_assert_not_reached();
    }
}

static void tci_qemu_st(CPUArchState *env, uint64_t taddr, uint64_t val,
                        MemOpIdx oi, const void *tb_ptr, uint64_t* ptr)
{
    MemOp mop = get_memop(oi);
    uintptr_t ra = (uintptr_t)tb_ptr;

    uint64_t target_addr = tlb_load(env, taddr, mop, ptr, false);
    if (target_addr != 0) {
        switch (mop & MO_SIZE) {
        case MO_UB:
            *(uint8_t*)target_addr = (uint8_t)val;
            break;
        case MO_UW:
            *(uint16_t*)target_addr = (uint16_t)val;
            break;
        case MO_UL:
            *(uint32_t*)target_addr = (uint32_t)val;
            break;
        case MO_UQ:
            *(uint64_t*)target_addr = (uint64_t)val;
            break;
        default:
            g_assert_not_reached();
        }
        return;
    }
    
    switch (mop & MO_SIZE) {
    case MO_UB:
        helper_stb_mmu(env, taddr, val, oi, ra);
        break;
    case MO_UW:
        helper_stw_mmu(env, taddr, val, oi, ra);
        break;
    case MO_UL:
        helper_stl_mmu(env, taddr, val, oi, ra);
        break;
    case MO_UQ:
        helper_stq_mmu(env, taddr, val, oi, ra);
        break;
    default:
        g_assert_not_reached();
    }
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

__thread tcg_target_ulong regs[TCG_TARGET_NB_REGS];

/*
 * Bootbox: binaryen inlines single-caller functions regardless of noinline; with the 380-way
 * typed-call dispatcher folded in, the interpreter below was a 53 KB function that JavaScriptCore's
 * optimizing tier needed ~1 GB to compile right after a guest resumed. Pinning its address keeps it
 * out of line (one extra call per helper call).
 */
static void *tci_out_of_line_keep[] __attribute__((used)) = { (void *)tci_direct_call };

/* Bootbox: hand-off state between the fast hot loop and this (Asyncify-instrumented) interpreter. */
__thread uint32_t *bb_cold_ptr;     /* hot loop met an op it does not run: execute it here */
__thread uint32_t *bb_resume_ptr;   /* single step done: the hot loop continues here */

/*
 * The full TCI interpreter. start = NULL: run the TB at ctx.tb_ptr (the classic entry). single = 1: finish
 * the TB from `start` (the hot loop met an op it does not run) and, where TCI would chain into the next TB,
 * return with bb_resume_ptr set so the hot loop takes over again (or leave TCI as usual).
 */
static uintptr_t tcg_qemu_tb_exec_tci_full(CPUArchState *env, uint32_t *start, int single)
{
    uint32_t *tb_ptr = start ? start : (uint32_t *)((uint8_t*)ctx.tb_ptr + *(uint32_t*)ctx.tb_ptr);

    uint64_t *stack = ctx.stack;

    regs[TCG_AREG0] = (tcg_target_ulong)env;
    regs[TCG_REG_CALL_STACK] = (uintptr_t)stack;
    
    for (;;) {
        uint32_t insn;
        TCGOpcode opc;
        TCGReg r0, r1, r2, r3, r4, r5;
        tcg_target_ulong t1;
        TCGCond condition;
        uint8_t pos, len;
        uint32_t tmp32;
        uint64_t tmp64, taddr;
        uint64_t T1, T2;
        MemOpIdx oi;
        int32_t ofs;
        void *ptr;

        uint32_t *savep = tb_ptr;
        insn = *tb_ptr++;
        opc = extract32(insn, 0, 8);

        TCGOpDef *def = &tcg_op_defs[opc];

        switch (opc) {
        case INDEX_op_call:
            {
                void *call_slots[MAX_CALL_IARGS];
                ffi_cif *cif;
                void *func;
                unsigned i, s, n;

                tci_args_nl(insn, tb_ptr, &len, &ptr);
                uint64_t *data64 = (uint64_t*)ptr;
                func = (void*)data64[0];
                cif = (void*)data64[1];

                int reg_iarg_base = 8;
                if ((uint32_t)func == (uint32_t)helper_lookup_tb_ptr) {
                    regs[TCG_REG_R0] = (uint32_t)helper_lookup_tb_ptr((CPUArchState *)regs[reg_iarg_base]);
                    break;
                }
                
                int reg_idx = 0;
                int reg_idx_end = 5; // NUM_OF_IARG_REGS
                int stack_idx = 0;
                n = cif->nargs;
                for (i = s = 0; i < n; ++i) {
                    ffi_type *t = cif->arg_types[i];
                    if (reg_idx < reg_idx_end) {
                        call_slots[i] = &regs[reg_iarg_base + reg_idx];
                        reg_idx += DIV_ROUND_UP(t->size, 8);
                    } else {
                        call_slots[i] = &stack[stack_idx];
                        stack_idx += DIV_ROUND_UP(t->size, 8);
                    }
                }

                /* Helper functions may need to access the "return address" */
                tci_tb_ptr = (uintptr_t)tb_ptr;

                /*
                 * Bootbox: call the helper directly (call_indirect) when its shape is i32/i64 args
                 * (<= 6) returning void/i32/i64 - i.e. almost every helper. emscripten's ffi_call is
                 * a JavaScript trampoline (boxing args, wasmTable.get, stackSave/Restore) that cost
                 * ~15% of vCPU time in interpreted code. Int128 shapes keep libffi.
                 */
                if (n <= 6 && len <= 2) {
                    uint64_t av[6], rv = 0;
                    uint32_t mask = 0;
                    bool simple = true;
                    for (i = 0; i < n; ++i) {
                        size_t sz = cif->arg_types[i]->size;
                        if (sz == 8) {
                            mask |= 1u << i;
                            av[i] = *(uint64_t *)call_slots[i];
                        } else if (sz <= 4) {
                            av[i] = *(uint32_t *)call_slots[i];
                        } else {
                            simple = false;
                            break;
                        }
                    }
                    if (simple && tci_direct_call(func, n, mask, len, av, &rv)) {
                        if (len == 1) {
                            regs[TCG_REG_R0] = (uint32_t)rv;
                        } else if (len == 2) {
                            regs[TCG_REG_R0] = rv;
                        }
                        break;
                    }
                }
                /*
                 * Bootbox: the two Int128 shapes skip libffi too - 128-bit guest loads/stores
                 * (helper_ld_i128 / helper_st_i128, SSE moves) were the only helpers left on its
                 * JavaScript trampoline: ~7M + 11M calls in one CPU-Z run, each a wasm -> JS -> wasm
                 * round trip with heap-view checks. The pointer types match the helpers' prototypes.
                 */
                if (len == 3 && n == 3 && cif->arg_types[0]->size <= 4 &&
                    cif->arg_types[1]->size == 8 && cif->arg_types[2]->size <= 4) {
                    Int128 r = ((Int128 (*)(uint32_t, uint64_t, uint32_t))func)(
                        *(uint32_t *)call_slots[0], *(uint64_t *)call_slots[1], *(uint32_t *)call_slots[2]);
                    memcpy(&regs[TCG_REG_R0], &r, 16);
                    break;
                }
                if (len == 0 && n == 4 && cif->arg_types[0]->size <= 4 && cif->arg_types[1]->size == 8 &&
                    cif->arg_types[2]->size == 16 && cif->arg_types[3]->size <= 4) {
                    Int128 v;
                    memcpy(&v, call_slots[2], 16);
                    ((void (*)(uint32_t, uint64_t, Int128, uint32_t))func)(
                        *(uint32_t *)call_slots[0], *(uint64_t *)call_slots[1], v, *(uint32_t *)call_slots[3]);
                    break;
                }
                ffi_call(cif, func, stack, call_slots);
            }

            switch (len) {
            case 0: /* void */
                break;
            case 1: /* uint32_t */
                /*
                 * The result winds up "left-aligned" in the stack[0] slot.
                 * Note that libffi has an odd special case in that it will
                 * always widen an integral result to ffi_arg.
                 */
                if (sizeof(ffi_arg) == 8) {
                    regs[TCG_REG_R0] = (uint32_t)stack[0];
                } else {
                    regs[TCG_REG_R0] = *(uint32_t *)stack;
                }
                break;
            case 2: /* uint64_t */
                /*
                 * For TCG_TARGET_REG_BITS == 32, the register pair
                 * must stay in host memory order.
                 */
                memcpy(&regs[TCG_REG_R0], stack, 8);
                break;
            case 3: /* Int128 */
                memcpy(&regs[TCG_REG_R0], stack, 16);
                break;
            default:
                g_assert_not_reached();
            }
            break;

        case INDEX_op_br:
            tci_args_br(insn, tb_ptr, &ptr);
            tb_ptr = ptr;
            continue;
        case INDEX_op_setcond_i32:
            tci_args_rrrc(insn, &r0, &r1, &r2, &condition);
            regs[r0] = tci_compare32(regs[r1], regs[r2], condition);
            break;
        case INDEX_op_movcond_i32:
            tci_args_rrrrrc(insn, &r0, &r1, &r2, &r3, &r4, &condition);
            tmp32 = tci_compare32(regs[r1], regs[r2], condition);
            regs[r0] = regs[tmp32 ? r3 : r4];
            break;
#if TCG_TARGET_REG_BITS == 32
        case INDEX_op_setcond2_i32:
            tci_args_rrrrrc(insn, &r0, &r1, &r2, &r3, &r4, &condition);
            T1 = tci_uint64(regs[r2], regs[r1]);
            T2 = tci_uint64(regs[r4], regs[r3]);
            regs[r0] = tci_compare64(T1, T2, condition);
            break;
#elif TCG_TARGET_REG_BITS == 64
        case INDEX_op_setcond_i64:
            tci_args_rrrc(insn, &r0, &r1, &r2, &condition);
            regs[r0] = tci_compare64(regs[r1], regs[r2], condition);
            break;
        case INDEX_op_movcond_i64:
            tci_args_rrrrrc(insn, &r0, &r1, &r2, &r3, &r4, &condition);
            tmp32 = tci_compare64(regs[r1], regs[r2], condition);
            regs[r0] = regs[tmp32 ? r3 : r4];
            break;
#endif
        CASE_32_64(mov)
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = regs[r1];
            break;
        case INDEX_op_tci_movi:
            tci_args_ri(insn, &r0, &t1);
            regs[r0] = t1;
            break;
        case INDEX_op_tci_movl:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            regs[r0] = *(tcg_target_ulong *)ptr;
            break;

            /* Load/store operations (32 bit). */

        CASE_32_64(ld8u)
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(uint8_t *)ptr;
            break;
        CASE_32_64(ld8s)
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(int8_t *)ptr;
            break;
        CASE_32_64(ld16u)
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(uint16_t *)ptr;
            break;
        CASE_32_64(ld16s)
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(int16_t *)ptr;
            break;
        case INDEX_op_ld_i32:
        CASE_64(ld32u)
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(uint32_t *)ptr;
            break;
        CASE_32_64(st8)
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(uint8_t *)ptr = regs[r0];
            break;
        CASE_32_64(st16)
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(uint16_t *)ptr = regs[r0];
            break;
        case INDEX_op_st_i32:
        CASE_64(st32)
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(uint32_t *)ptr = regs[r0];
            break;

            /* Arithmetic operations (mixed 32/64 bit). */

        CASE_32_64(add)
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] + regs[r2];
            break;
        CASE_32_64(sub)
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] - regs[r2];
            break;
        CASE_32_64(mul)
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] * regs[r2];
            break;
        CASE_32_64(and)
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] & regs[r2];
            break;
        CASE_32_64(or)
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] | regs[r2];
            break;
        CASE_32_64(xor)
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] ^ regs[r2];
            break;
#if TCG_TARGET_HAS_andc_i32 || TCG_TARGET_HAS_andc_i64
        CASE_32_64(andc)
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] & ~regs[r2];
            break;
#endif
#if TCG_TARGET_HAS_orc_i32 || TCG_TARGET_HAS_orc_i64
        CASE_32_64(orc)
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] | ~regs[r2];
            break;
#endif
#if TCG_TARGET_HAS_eqv_i32 || TCG_TARGET_HAS_eqv_i64
        CASE_32_64(eqv)
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ~(regs[r1] ^ regs[r2]);
            break;
#endif
#if TCG_TARGET_HAS_nand_i32 || TCG_TARGET_HAS_nand_i64
        CASE_32_64(nand)
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ~(regs[r1] & regs[r2]);
            break;
#endif
#if TCG_TARGET_HAS_nor_i32 || TCG_TARGET_HAS_nor_i64
        CASE_32_64(nor)
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ~(regs[r1] | regs[r2]);
            break;
#endif

            /* Arithmetic operations (32 bit). */

        case INDEX_op_div_i32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int32_t)regs[r1] / (int32_t)regs[r2];
            break;
        case INDEX_op_divu_i32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint32_t)regs[r1] / (uint32_t)regs[r2];
            break;
        case INDEX_op_rem_i32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int32_t)regs[r1] % (int32_t)regs[r2];
            break;
        case INDEX_op_remu_i32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint32_t)regs[r1] % (uint32_t)regs[r2];
            break;
#if TCG_TARGET_HAS_clz_i32
        case INDEX_op_clz_i32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp32 = regs[r1];
            regs[r0] = tmp32 ? clz32(tmp32) : regs[r2];
            break;
#endif
#if TCG_TARGET_HAS_ctz_i32
        case INDEX_op_ctz_i32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            tmp32 = regs[r1];
            regs[r0] = tmp32 ? ctz32(tmp32) : regs[r2];
            break;
#endif
#if TCG_TARGET_HAS_ctpop_i32
        case INDEX_op_ctpop_i32:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = ctpop32(regs[r1]);
            break;
#endif

            /* Shift/rotate operations (32 bit). */

        case INDEX_op_shl_i32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint32_t)regs[r1] << (regs[r2] & 31);
            break;
        case INDEX_op_shr_i32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint32_t)regs[r1] >> (regs[r2] & 31);
            break;
        case INDEX_op_sar_i32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int32_t)regs[r1] >> (regs[r2] & 31);
            break;
#if TCG_TARGET_HAS_rot_i32
        case INDEX_op_rotl_i32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = rol32(regs[r1], regs[r2] & 31);
            break;
        case INDEX_op_rotr_i32:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ror32(regs[r1], regs[r2] & 31);
            break;
#endif
#if TCG_TARGET_HAS_deposit_i32
        case INDEX_op_deposit_i32:
            tci_args_rrrbb(insn, &r0, &r1, &r2, &pos, &len);
            regs[r0] = deposit32(regs[r1], pos, len, regs[r2]);
            break;
#endif
#if TCG_TARGET_HAS_extract_i32
        case INDEX_op_extract_i32:
            tci_args_rrbb(insn, &r0, &r1, &pos, &len);
            regs[r0] = extract32(regs[r1], pos, len);
            break;
#endif
#if TCG_TARGET_HAS_sextract_i32
        case INDEX_op_sextract_i32:
            tci_args_rrbb(insn, &r0, &r1, &pos, &len);
            regs[r0] = sextract32(regs[r1], pos, len);
            break;
#endif
        case INDEX_op_brcond_i32:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            if ((uint32_t)regs[r0]) {
                tb_ptr = ptr;
            }
            break;
#if TCG_TARGET_REG_BITS == 32 || TCG_TARGET_HAS_add2_i32
        case INDEX_op_add2_i32:
            tci_args_rrrrrr(insn, &r0, &r1, &r2, &r3, &r4, &r5);
            T1 = tci_uint64(regs[r3], regs[r2]);
            T2 = tci_uint64(regs[r5], regs[r4]);
            tci_write_reg64(regs, r1, r0, T1 + T2);
            break;
#endif
#if TCG_TARGET_REG_BITS == 32 || TCG_TARGET_HAS_sub2_i32
        case INDEX_op_sub2_i32:
            tci_args_rrrrrr(insn, &r0, &r1, &r2, &r3, &r4, &r5);
            T1 = tci_uint64(regs[r3], regs[r2]);
            T2 = tci_uint64(regs[r5], regs[r4]);
            tci_write_reg64(regs, r1, r0, T1 - T2);
            break;
#endif
#if TCG_TARGET_HAS_mulu2_i32
        case INDEX_op_mulu2_i32:
            tci_args_rrrr(insn, &r0, &r1, &r2, &r3);
            tmp64 = (uint64_t)(uint32_t)regs[r2] * (uint32_t)regs[r3];
            tci_write_reg64(regs, r1, r0, tmp64);
            break;
#endif
#if TCG_TARGET_HAS_muls2_i32
        case INDEX_op_muls2_i32:
            tci_args_rrrr(insn, &r0, &r1, &r2, &r3);
            tmp64 = (int64_t)(int32_t)regs[r2] * (int32_t)regs[r3];
            tci_write_reg64(regs, r1, r0, tmp64);
            break;
#endif
#if TCG_TARGET_HAS_ext8s_i32 || TCG_TARGET_HAS_ext8s_i64
        CASE_32_64(ext8s)
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = (int8_t)regs[r1];
            break;
#endif
#if TCG_TARGET_HAS_ext16s_i32 || TCG_TARGET_HAS_ext16s_i64 || \
    TCG_TARGET_HAS_bswap16_i32 || TCG_TARGET_HAS_bswap16_i64
        CASE_32_64(ext16s)
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = (int16_t)regs[r1];
            break;
#endif
#if TCG_TARGET_HAS_ext8u_i32 || TCG_TARGET_HAS_ext8u_i64
        CASE_32_64(ext8u)
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = (uint8_t)regs[r1];
            break;
#endif
#if TCG_TARGET_HAS_ext16u_i32 || TCG_TARGET_HAS_ext16u_i64
        CASE_32_64(ext16u)
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = (uint16_t)regs[r1];
            break;
#endif
#if TCG_TARGET_HAS_bswap16_i32 || TCG_TARGET_HAS_bswap16_i64
        CASE_32_64(bswap16)
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = bswap16(regs[r1]);
            break;
#endif
#if TCG_TARGET_HAS_bswap32_i32 || TCG_TARGET_HAS_bswap32_i64
        CASE_32_64(bswap32)
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = bswap32(regs[r1]);
            break;
#endif
#if TCG_TARGET_HAS_not_i32 || TCG_TARGET_HAS_not_i64
        CASE_32_64(not)
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = ~regs[r1];
            break;
#endif
#if TCG_TARGET_HAS_neg_i32 || TCG_TARGET_HAS_neg_i64
        CASE_32_64(neg)
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = -regs[r1];
            break;
#endif
#if TCG_TARGET_REG_BITS == 64
            /* Load/store operations (64 bit). */

        case INDEX_op_ld32s_i64:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(int32_t *)ptr;
            break;
        case INDEX_op_ld_i64:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            regs[r0] = *(uint64_t *)ptr;
            break;
        case INDEX_op_st_i64:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            ptr = (void *)(regs[r1] + ofs);
            *(uint64_t *)ptr = regs[r0];
            break;

            /* Arithmetic operations (64 bit). */

        case INDEX_op_div_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int64_t)regs[r1] / (int64_t)regs[r2];
            break;
        case INDEX_op_divu_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint64_t)regs[r1] / (uint64_t)regs[r2];
            break;
        case INDEX_op_rem_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int64_t)regs[r1] % (int64_t)regs[r2];
            break;
        case INDEX_op_remu_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (uint64_t)regs[r1] % (uint64_t)regs[r2];
            break;
#if TCG_TARGET_HAS_clz_i64
        case INDEX_op_clz_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] ? clz64(regs[r1]) : regs[r2];
            break;
#endif
#if TCG_TARGET_HAS_ctz_i64
        case INDEX_op_ctz_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] ? ctz64(regs[r1]) : regs[r2];
            break;
#endif
#if TCG_TARGET_HAS_ctpop_i64
        case INDEX_op_ctpop_i64:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = ctpop64(regs[r1]);
            break;
#endif
#if TCG_TARGET_HAS_mulu2_i64
        case INDEX_op_mulu2_i64:
            tci_args_rrrr(insn, &r0, &r1, &r2, &r3);
            mulu64(&regs[r0], &regs[r1], regs[r2], regs[r3]);
            break;
#endif
#if TCG_TARGET_HAS_muls2_i64
        case INDEX_op_muls2_i64:
            tci_args_rrrr(insn, &r0, &r1, &r2, &r3);
            muls64(&regs[r0], &regs[r1], regs[r2], regs[r3]);
            break;
#endif
#if TCG_TARGET_HAS_add2_i64
        case INDEX_op_add2_i64:
            tci_args_rrrrrr(insn, &r0, &r1, &r2, &r3, &r4, &r5);
            T1 = regs[r2] + regs[r4];
            T2 = regs[r3] + regs[r5] + (T1 < regs[r2]);
            regs[r0] = T1;
            regs[r1] = T2;
            break;
#endif
#if TCG_TARGET_HAS_add2_i64
        case INDEX_op_sub2_i64:
            tci_args_rrrrrr(insn, &r0, &r1, &r2, &r3, &r4, &r5);
            T1 = regs[r2] - regs[r4];
            T2 = regs[r3] - regs[r5] - (regs[r2] < regs[r4]);
            regs[r0] = T1;
            regs[r1] = T2;
            break;
#endif

            /* Shift/rotate operations (64 bit). */

        case INDEX_op_shl_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] << (regs[r2] & 63);
            break;
        case INDEX_op_shr_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = regs[r1] >> (regs[r2] & 63);
            break;
        case INDEX_op_sar_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = (int64_t)regs[r1] >> (regs[r2] & 63);
            break;
#if TCG_TARGET_HAS_rot_i64
        case INDEX_op_rotl_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = rol64(regs[r1], regs[r2] & 63);
            break;
        case INDEX_op_rotr_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            regs[r0] = ror64(regs[r1], regs[r2] & 63);
            break;
#endif
#if TCG_TARGET_HAS_deposit_i64
        case INDEX_op_deposit_i64:
            tci_args_rrrbb(insn, &r0, &r1, &r2, &pos, &len);
            regs[r0] = deposit64(regs[r1], pos, len, regs[r2]);
            break;
#endif
#if TCG_TARGET_HAS_extract_i64
        case INDEX_op_extract_i64:
            tci_args_rrbb(insn, &r0, &r1, &pos, &len);
            regs[r0] = extract64(regs[r1], pos, len);
            break;
#endif
#if TCG_TARGET_HAS_sextract_i64
        case INDEX_op_sextract_i64:
            tci_args_rrbb(insn, &r0, &r1, &pos, &len);
            regs[r0] = sextract64(regs[r1], pos, len);
            break;
#endif
        case INDEX_op_brcond_i64:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            if (regs[r0]) {
                tb_ptr = ptr;
            }
            break;
        case INDEX_op_ext32s_i64:
        case INDEX_op_ext_i32_i64:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = (int32_t)regs[r1];
            break;
        case INDEX_op_ext32u_i64:
        case INDEX_op_extu_i32_i64:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = (uint32_t)regs[r1];
            break;
#if TCG_TARGET_HAS_bswap64_i64
        case INDEX_op_bswap64_i64:
            tci_args_rr(insn, &r0, &r1);
            regs[r0] = bswap64(regs[r1]);
            break;
#endif
#endif /* TCG_TARGET_REG_BITS == 64 */

            /* QEMU specific operations. */

        case INDEX_op_exit_tb:
            tci_args_l(insn, tb_ptr, &ptr);
            ctx.tb_ptr = 0;
            return (uintptr_t)ptr;

        case INDEX_op_goto_tb:
            tci_args_l(insn, tb_ptr, &ptr);
            if (*(uint32_t **)ptr != 0) {
                tb_ptr = *(uint32_t **)ptr;
                ctx.tb_ptr = tb_ptr;
                int tb_counter_ptr = (uint32_t)tb_ptr + counter_vec_off;
                if ((*(int32_t*)tb_counter_ptr >= 0) && tb_wants_tci(*(int32_t*)tb_counter_ptr, tb_ptr)) {
                    *(int32_t*)tb_counter_ptr += 1;
                } else {
                    // enter to wasm TB
                    return 0;
                }
                tb_ptr = (uint8_t*)tb_ptr + *(uint32_t*)tb_ptr;
                if (single) {
                    bb_resume_ptr = tb_ptr;
                    return 0;
                }
            }
            break;

        case INDEX_op_goto_ptr:
            tci_args_r(insn, &r0);
            ptr = (void *)regs[r0];
            if (!ptr) {
                ctx.tb_ptr = 0;
                return 0;
            }
            tb_ptr = ptr;

            ctx.tb_ptr = tb_ptr;
            int tb_counter_ptr = (uint32_t)tb_ptr + counter_vec_off;
            if ((*(int32_t*)tb_counter_ptr >= 0) && tb_wants_tci(*(int32_t*)tb_counter_ptr, tb_ptr)) {
                *(int32_t*)tb_counter_ptr += 1;
            } else {
                // enter to wasm TB
                return 0;
            }
            tb_ptr = (uint8_t*)tb_ptr + *(uint32_t*)tb_ptr;
            if (single) {
                bb_resume_ptr = tb_ptr;
                return 0;
            }
            break;

        case INDEX_op_qemu_ld_a32_i32:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            taddr = (uint32_t)regs[r1];
            goto do_ld_i32;
        case INDEX_op_qemu_ld_a64_i32:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            taddr = regs[r1];
        do_ld_i32:
            regs[r0] = tci_qemu_ld(env, taddr, oi, tb_ptr, ptr);
            break;

        case INDEX_op_qemu_ld_a32_i64:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            taddr = (uint32_t)regs[r1];
            goto do_ld_i64;
        case INDEX_op_qemu_ld_a64_i64:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            taddr = regs[r1];
        do_ld_i64:
            tmp64 = tci_qemu_ld(env, taddr, oi, tb_ptr, ptr);
            if (TCG_TARGET_REG_BITS == 32) {
                tci_write_reg64(regs, r1, r0, tmp64);
            } else {
                regs[r0] = tmp64;
            }
            break;

        case INDEX_op_qemu_st_a32_i32:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            taddr = (uint32_t)regs[r1];
            goto do_st_i32;
        case INDEX_op_qemu_st_a64_i32:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            taddr = regs[r1];
        do_st_i32:
            tci_qemu_st(env, taddr, regs[r0], oi, tb_ptr, ptr);
            break;

        case INDEX_op_qemu_st_a32_i64:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            tmp64 = regs[r0];
            taddr = (uint32_t)regs[r1];
            goto do_st_i64;
        case INDEX_op_qemu_st_a64_i64:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            tmp64 = regs[r0];
            taddr = regs[r1];
        do_st_i64:
            tci_qemu_st(env, taddr, tmp64, oi, tb_ptr, ptr);
            break;

        case INDEX_op_mb:
            /* Ensure ordering for all kinds */
            smp_mb();
            break;
        default:
            g_assert_not_reached();
        }
    }
}

/*
 * Bootbox: JIT tunables read once from /bootbox-tune, which run.js writes into MEMFS before QEMU
 * starts, so they can be set per guest without rebuilding the engine (vCPU workers cannot see
 * main-thread JS globals, but file reads are proxied). Format: "jit=<N> max=<N> fpinline=<0|1>".
 * Called before the first translation as well as the first execution; vCPU threads translate
 * concurrently, so a thread that loses the race waits until the values are in place.
 */
const WasmFpInline *wasm32_fp_inline;
const WasmSimdInline *wasm32_simd_inline;
/*
 * Generic gvec helpers the backend emits as wasm SIMD when the call's desc is 16/16 bytes
 * (tcg_wasm_out_simd_inline). tcg-op-gvec.c routes 16-byte ops to these helpers instead of
 * expanding them into 64-bit integer ops (wasm32_gvec_prefer_ool) - keep the two lists in step.
 * Opcodes verified against reference semantics in mbench/simd/opcheck.mjs.
 */
#include "exec/helper-proto-common.h"
const WasmSimdInline wasm32_gvec_inline[] = {
    { (const void *)helper_gvec_add8, WSG_3, 0x6e },
    { (const void *)helper_gvec_add16, WSG_3, 0x8e },
    { (const void *)helper_gvec_add32, WSG_3, 0xae },
    { (const void *)helper_gvec_add64, WSG_3, 0xce },
    { (const void *)helper_gvec_sub8, WSG_3, 0x71 },
    { (const void *)helper_gvec_sub16, WSG_3, 0x91 },
    { (const void *)helper_gvec_sub32, WSG_3, 0xb1 },
    { (const void *)helper_gvec_sub64, WSG_3, 0xd1 },
    { (const void *)helper_gvec_mul16, WSG_3, 0x95 },
    { (const void *)helper_gvec_mul32, WSG_3, 0xb5 },
    { (const void *)helper_gvec_mul64, WSG_3, 0xd5 },
    { (const void *)helper_gvec_ssadd8, WSG_3, 0x6f },
    { (const void *)helper_gvec_ssadd16, WSG_3, 0x8f },
    { (const void *)helper_gvec_usadd8, WSG_3, 0x70 },
    { (const void *)helper_gvec_usadd16, WSG_3, 0x90 },
    { (const void *)helper_gvec_sssub8, WSG_3, 0x72 },
    { (const void *)helper_gvec_sssub16, WSG_3, 0x92 },
    { (const void *)helper_gvec_ussub8, WSG_3, 0x73 },
    { (const void *)helper_gvec_ussub16, WSG_3, 0x93 },
    { (const void *)helper_gvec_smin8, WSG_3, 0x76 },
    { (const void *)helper_gvec_smin16, WSG_3, 0x96 },
    { (const void *)helper_gvec_smin32, WSG_3, 0xb6 },
    { (const void *)helper_gvec_umin8, WSG_3, 0x77 },
    { (const void *)helper_gvec_umin16, WSG_3, 0x97 },
    { (const void *)helper_gvec_umin32, WSG_3, 0xb7 },
    { (const void *)helper_gvec_smax8, WSG_3, 0x78 },
    { (const void *)helper_gvec_smax16, WSG_3, 0x98 },
    { (const void *)helper_gvec_smax32, WSG_3, 0xb8 },
    { (const void *)helper_gvec_umax8, WSG_3, 0x79 },
    { (const void *)helper_gvec_umax16, WSG_3, 0x99 },
    { (const void *)helper_gvec_umax32, WSG_3, 0xb9 },
    { (const void *)helper_gvec_and, WSG_3, 0x4e },
    { (const void *)helper_gvec_or, WSG_3, 0x50 },
    { (const void *)helper_gvec_xor, WSG_3, 0x51 },
    { (const void *)helper_gvec_andc, WSG_3, 0x4f },
    { (const void *)helper_gvec_eq8, WSG_3, 0x23 },
    { (const void *)helper_gvec_eq16, WSG_3, 0x2d },
    { (const void *)helper_gvec_eq32, WSG_3, 0x37 },
    { (const void *)helper_gvec_eq64, WSG_3, 0xd6 },
    { (const void *)helper_gvec_ne8, WSG_3, 0x24 },
    { (const void *)helper_gvec_ne16, WSG_3, 0x2e },
    { (const void *)helper_gvec_ne32, WSG_3, 0x38 },
    { (const void *)helper_gvec_ne64, WSG_3, 0xd7 },
    { (const void *)helper_gvec_lt8, WSG_3, 0x25 },
    { (const void *)helper_gvec_lt16, WSG_3, 0x2f },
    { (const void *)helper_gvec_lt32, WSG_3, 0x39 },
    { (const void *)helper_gvec_lt64, WSG_3, 0xd8 },
    { (const void *)helper_gvec_le8, WSG_3, 0x29 },
    { (const void *)helper_gvec_le16, WSG_3, 0x33 },
    { (const void *)helper_gvec_le32, WSG_3, 0x3d },
    { (const void *)helper_gvec_le64, WSG_3, 0xda },
    { (const void *)helper_gvec_ltu8, WSG_3, 0x26 },
    { (const void *)helper_gvec_ltu16, WSG_3, 0x30 },
    { (const void *)helper_gvec_ltu32, WSG_3, 0x3a },
    { (const void *)helper_gvec_leu8, WSG_3, 0x2a },
    { (const void *)helper_gvec_leu16, WSG_3, 0x34 },
    { (const void *)helper_gvec_leu32, WSG_3, 0x3e },
    { (const void *)helper_gvec_orc, WSG_3ORC, 0x00 },
    { (const void *)helper_gvec_mov, WSG_2, 0x00 },
    { (const void *)helper_gvec_not, WSG_2, 0x4d },
    { (const void *)helper_gvec_neg8, WSG_2, 0x61 },
    { (const void *)helper_gvec_neg16, WSG_2, 0x81 },
    { (const void *)helper_gvec_neg32, WSG_2, 0xa1 },
    { (const void *)helper_gvec_neg64, WSG_2, 0xc1 },
    { (const void *)helper_gvec_abs8, WSG_2, 0x60 },
    { (const void *)helper_gvec_abs16, WSG_2, 0x80 },
    { (const void *)helper_gvec_abs32, WSG_2, 0xa0 },
    { (const void *)helper_gvec_abs64, WSG_2, 0xc0 },
    { (const void *)helper_gvec_shl8i, WSG_2I, 0x6b },
    { (const void *)helper_gvec_shl16i, WSG_2I, 0x8b },
    { (const void *)helper_gvec_shl32i, WSG_2I, 0xab },
    { (const void *)helper_gvec_shl64i, WSG_2I, 0xcb },
    { (const void *)helper_gvec_shr8i, WSG_2I, 0x6d },
    { (const void *)helper_gvec_shr16i, WSG_2I, 0x8d },
    { (const void *)helper_gvec_shr32i, WSG_2I, 0xad },
    { (const void *)helper_gvec_shr64i, WSG_2I, 0xcd },
    { (const void *)helper_gvec_sar8i, WSG_2I, 0x6c },
    { (const void *)helper_gvec_sar16i, WSG_2I, 0x8c },
    { (const void *)helper_gvec_sar32i, WSG_2I, 0xac },
    { (const void *)helper_gvec_sar64i, WSG_2I, 0xcc },
};
const int wasm32_gvec_inline_n = ARRAY_SIZE(wasm32_gvec_inline);
int wasm32_simd_inline_n;
int wasm_simd_inline_enabled = 1;
/*
 * /bootbox-tune gvecool=1: route 16-byte gvec ops (paddd, pand, movdqa...) to helpers the backend emits as
 * SIMD. OFF by default: in macOS WebKit (the iPad's engine) 2 of 3 Terminal glmark2 runs with it collapsed
 * (score 7-9 instead of 35-40; 0 of 5 without it), while the x86 SIMD inlining alone is fine. Chrome likes it.
 */
int wasm_gvec_ool_enabled;
int wasm_fp_inline_enabled = 1;
int wasm_tail_chain;
int wasm_chain_nested;
int wasm_chain_budget = WASM_CHAIN_BUDGET;
int wasm_reg_locals = 1;

/*
 * Bootbox: the common helper calls of the hot loop - helper_lookup_tb_ptr and the direct typed calls
 * (tci_direct_call). Returns 0 for libffi shapes: the full interpreter then runs that op.
 */
static __attribute__((noinline)) int tci_hot_call(uint32_t insn, const uint32_t *tb_ptr, uint64_t *stack)
{
    uint8_t len;
    void *ptr;
    tci_args_nl(insn, tb_ptr, &len, &ptr);
    uint64_t *data64 = (uint64_t *)ptr;
    void *func = (void *)data64[0];
    ffi_cif *cif = (void *)data64[1];
    if ((uint32_t)func == (uint32_t)helper_lookup_tb_ptr) {
        regs[TCG_REG_R0] = (uint32_t)helper_lookup_tb_ptr((CPUArchState *)regs[8]);
        return 1;
    }
    unsigned n = cif->nargs;
    if (n > 6 || len > 2) {
        return 0;
    }
    uint64_t av[6], rv = 0;
    uint32_t mask = 0;
    int reg_idx = 0, stack_idx = 0;
    for (unsigned i = 0; i < n; ++i) {
        size_t sz = cif->arg_types[i]->size;
        void *slot;
        if (reg_idx < 5) {
            slot = &regs[8 + reg_idx];
            reg_idx += DIV_ROUND_UP(sz, 8);
        } else {
            slot = &stack[stack_idx];
            stack_idx += DIV_ROUND_UP(sz, 8);
        }
        if (sz == 8) {
            mask |= 1u << i;
            av[i] = *(uint64_t *)slot;
        } else if (sz <= 4) {
            av[i] = *(uint32_t *)slot;
        } else {
            return 0;
        }
    }
    tci_tb_ptr = (uintptr_t)tb_ptr;
    if (!tci_direct_call(func, n, mask, len, av, &rv)) {
        return 0;
    }
    if (len == 1) {
        regs[TCG_REG_R0] = (uint32_t)rv;
    } else if (len == 2) {
        regs[TCG_REG_R0] = rv;
    }
    return 1;
}

/*
 * Bootbox: the hot loop - the ~35 TCI ops that make up ~99% of what the browser and CPU-Z interpret,
 * excluded from Asyncify (ASYNCIFY_REMOVE=tci_hot_loop) and small enough for JavaScriptCore's optimizing
 * tier (the full interpreter is not: uninstrumented it made JSC's OMG compiler use 5-13 GB). Any other op
 * stops here (bb_cold_ptr) and runs as one step of the full interpreter. Device accesses that could switch
 * coroutines re-run the guest instruction in the full interpreter (bb_guard_mmio / bb_guard_pio).
 */
__attribute__((noinline)) uintptr_t tci_hot_loop(CPUArchState *env, uint32_t *start)
{
    uint32_t *tb_ptr = start ? start : (uint32_t *)((uint8_t *)ctx.tb_ptr + *(uint32_t *)ctx.tb_ptr);
    tcg_target_ulong *R = regs;
    uint64_t *stack = ctx.stack;
    R[TCG_AREG0] = (tcg_target_ulong)env;
    R[TCG_REG_CALL_STACK] = (uintptr_t)stack;
    for (;;) {
        uint32_t *op_ptr = tb_ptr;
        uint32_t insn = *tb_ptr++;
        TCGReg r0, r1, r2, r3, r4;
        TCGCond c;
        int32_t ofs;
        tcg_target_ulong t1;
        uint8_t pos, len;
        MemOpIdx oi;
        void *ptr;
        int tb_counter_ptr;
        switch (extract32(insn, 0, 8)) {
        case INDEX_op_tci_movi:
            tci_args_ri(insn, &r0, &t1);
            R[r0] = t1;
            break;
        case INDEX_op_tci_movl:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            R[r0] = *(tcg_target_ulong *)ptr;
            break;
        case INDEX_op_mov_i32:
        case INDEX_op_mov_i64:
            tci_args_rr(insn, &r0, &r1);
            R[r0] = R[r1];
            break;
        case INDEX_op_ld_i64:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            R[r0] = *(uint64_t *)(R[r1] + ofs);
            break;
        case INDEX_op_ld_i32:
        case INDEX_op_ld32u_i64:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            R[r0] = *(uint32_t *)(R[r1] + ofs);
            break;
        case INDEX_op_ld32s_i64:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            R[r0] = *(int32_t *)(R[r1] + ofs);
            break;
        case INDEX_op_ld8u_i32:
        case INDEX_op_ld8u_i64:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            R[r0] = *(uint8_t *)(R[r1] + ofs);
            break;
        case INDEX_op_st_i64:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            *(uint64_t *)(R[r1] + ofs) = R[r0];
            break;
        case INDEX_op_st_i32:
        case INDEX_op_st32_i64:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            *(uint32_t *)(R[r1] + ofs) = R[r0];
            break;
        case INDEX_op_st8_i32:
        case INDEX_op_st8_i64:
            tci_args_rrs(insn, &r0, &r1, &ofs);
            *(uint8_t *)(R[r1] + ofs) = R[r0];
            break;
        case INDEX_op_add_i32:
        case INDEX_op_add_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            R[r0] = R[r1] + R[r2];
            break;
        case INDEX_op_sub_i32:
        case INDEX_op_sub_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            R[r0] = R[r1] - R[r2];
            break;
        case INDEX_op_and_i32:
        case INDEX_op_and_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            R[r0] = R[r1] & R[r2];
            break;
        case INDEX_op_or_i32:
        case INDEX_op_or_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            R[r0] = R[r1] | R[r2];
            break;
        case INDEX_op_xor_i32:
        case INDEX_op_xor_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            R[r0] = R[r1] ^ R[r2];
            break;
        case INDEX_op_shl_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            R[r0] = R[r1] << (R[r2] & 63);
            break;
        case INDEX_op_shr_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            R[r0] = R[r1] >> (R[r2] & 63);
            break;
        case INDEX_op_sar_i64:
            tci_args_rrr(insn, &r0, &r1, &r2);
            R[r0] = (int64_t)R[r1] >> (R[r2] & 63);
            break;
        case INDEX_op_ext32u_i64:
        case INDEX_op_extu_i32_i64:
            tci_args_rr(insn, &r0, &r1);
            R[r0] = (uint32_t)R[r1];
            break;
        case INDEX_op_ext32s_i64:
        case INDEX_op_ext_i32_i64:
            tci_args_rr(insn, &r0, &r1);
            R[r0] = (int32_t)R[r1];
            break;
        case INDEX_op_ext8u_i64:
            tci_args_rr(insn, &r0, &r1);
            R[r0] = (uint8_t)R[r1];
            break;
        case INDEX_op_deposit_i64:
            tci_args_rrrbb(insn, &r0, &r1, &r2, &pos, &len);
            R[r0] = deposit64(R[r1], pos, len, R[r2]);
            break;
        case INDEX_op_setcond_i32:
            tci_args_rrrc(insn, &r0, &r1, &r2, &c);
            R[r0] = tci_compare32(R[r1], R[r2], c);
            break;
        case INDEX_op_setcond_i64:
            tci_args_rrrc(insn, &r0, &r1, &r2, &c);
            R[r0] = tci_compare64(R[r1], R[r2], c);
            break;
        case INDEX_op_movcond_i64:
            tci_args_rrrrrc(insn, &r0, &r1, &r2, &r3, &r4, &c);
            R[r0] = R[tci_compare64(R[r1], R[r2], c) ? r3 : r4];
            break;
        case INDEX_op_brcond_i32:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            if ((uint32_t)R[r0]) {
                tb_ptr = ptr;
            }
            break;
        case INDEX_op_brcond_i64:
            tci_args_rl(insn, tb_ptr, &r0, &ptr);
            if (R[r0]) {
                tb_ptr = ptr;
            }
            break;
        case INDEX_op_br:
            tci_args_br(insn, tb_ptr, &ptr);
            tb_ptr = ptr;
            break;
        case INDEX_op_mb:
            smp_mb();
            break;
        case INDEX_op_qemu_ld_a64_i32:
        case INDEX_op_qemu_ld_a64_i64:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            R[r0] = tci_qemu_ld(env, R[r1], oi, tb_ptr, ptr);
            break;
        case INDEX_op_qemu_ld_a32_i32:
        case INDEX_op_qemu_ld_a32_i64:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            R[r0] = tci_qemu_ld(env, (uint32_t)R[r1], oi, tb_ptr, ptr);
            break;
        case INDEX_op_qemu_st_a64_i32:
        case INDEX_op_qemu_st_a64_i64:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            tci_qemu_st(env, R[r1], R[r0], oi, tb_ptr, ptr);
            break;
        case INDEX_op_qemu_st_a32_i32:
        case INDEX_op_qemu_st_a32_i64:
            tci_args_ldst(insn, &r0, &r1, &oi, tb_ptr, &ptr);
            tci_qemu_st(env, (uint32_t)R[r1], R[r0], oi, tb_ptr, ptr);
            break;
        case INDEX_op_call:
            if (tci_hot_call(insn, tb_ptr, stack)) {
                break;
            }
            bb_cold_ptr = op_ptr;
            return 0;
        case INDEX_op_exit_tb:
            tci_args_l(insn, tb_ptr, &ptr);
            ctx.tb_ptr = 0;
            return (uintptr_t)ptr;
        case INDEX_op_goto_tb:
            tci_args_l(insn, tb_ptr, &ptr);
            if (*(uint32_t **)ptr != 0) {
                tb_ptr = *(uint32_t **)ptr;
                ctx.tb_ptr = tb_ptr;
                tb_counter_ptr = (uint32_t)tb_ptr + counter_vec_off;
                if ((*(int32_t *)tb_counter_ptr >= 0) && tb_wants_tci(*(int32_t *)tb_counter_ptr, tb_ptr)) {
                    *(int32_t *)tb_counter_ptr += 1;
                } else {
                    return 0;   /* enter the compiled TB */
                }
                tb_ptr = (uint32_t *)((uint8_t *)tb_ptr + *(uint32_t *)tb_ptr);
            }
            break;
        case INDEX_op_goto_ptr:
            tci_args_r(insn, &r0);
            ptr = (void *)R[r0];
            if (!ptr) {
                ctx.tb_ptr = 0;
                return 0;
            }
            tb_ptr = ptr;
            ctx.tb_ptr = tb_ptr;
            tb_counter_ptr = (uint32_t)tb_ptr + counter_vec_off;
            if ((*(int32_t *)tb_counter_ptr >= 0) && tb_wants_tci(*(int32_t *)tb_counter_ptr, tb_ptr)) {
                *(int32_t *)tb_counter_ptr += 1;
            } else {
                return 0;   /* enter the compiled TB */
            }
            tb_ptr = (uint32_t *)((uint8_t *)tb_ptr + *(uint32_t *)tb_ptr);
            break;
        default:
            bb_cold_ptr = op_ptr;   /* not a hot op: the full interpreter finishes this TB */
            return 0;
        }
    }
}
static void *tci_hot_keep[] __attribute__((used)) = { (void *)tci_hot_loop };   /* stay out of line */

int wasm_fast_tci;   /* /bootbox-tune fasttci=1 */
extern int bb_lazy_wasm;  /* /bootbox-tune lazywasm=1 (tcg.c) */
extern int bb_split_enabled;  /* /bootbox-tune split=0 (translate-all.c) */
uint8_t *bb_tb_regen_wasm(CPUState *cpu, const void *tc_ptr);
__thread int bb_fast_tci_depth, bb_force_slow_tci;

static inline uintptr_t tci_exec(CPUArchState *env)
{
    if (!wasm_fast_tci || bb_force_slow_tci) {
        bb_force_slow_tci = 0;   /* (a guard deferred a device access: this run performs it) */
        return tcg_qemu_tb_exec_tci_full(env, NULL, 0);
    }
    uint32_t *p = NULL;
    for (;;) {
        bb_fast_tci_depth = 1;
        uintptr_t r = tci_hot_loop(env, p);
        bb_fast_tci_depth = 0;
        if (!bb_cold_ptr) {
            return r;
        }
        p = bb_cold_ptr;
        bb_cold_ptr = NULL;
        r = tcg_qemu_tb_exec_tci_full(env, p, 1);
        if (!bb_resume_ptr) {
            return r;
        }
        p = bb_resume_ptr;
        bb_resume_ptr = NULL;
    }
}

int bb_hammock;   /* /bootbox-tune hammock=1: short forward jcc kept inside the TB (target/i386/tcg/translate.c) */
int bb_hm_max = 16, bb_hm_mod = 1, bb_hm_sel = 0, bb_hm_cpl = 0;   /* hmmax, hmmod/hmsel (pc filter), hmcpl (3 = user only) */
int bb_sse_atom16 = 1;   /* /bootbox-tune sseatom=0: AVX guests' 16-byte SSE accesses as two 8-byte halves (target/i386/tcg/translate.c) */
int bb_repbulk = 1;   /* /bootbox-tune repbulk=0: REP MOVS/STOS one iteration per TB again (helper_rep_bulk) */

void bootbox_tune_init(void)
{
    static int state;   /* 0 = not read, 1 = reading, 2 = done */
    if (qatomic_read(&state) == 2) {
        return;
    }
    if (qatomic_cmpxchg(&state, 0, 1) != 0) {
        while (qatomic_read(&state) != 2) {
            sched_yield();
        }
        return;
    }
    FILE *f = fopen("/bootbox-tune", "r");
    if (f) {
        char key[16];
        int v;
        while (fscanf(f, " %15[a-z]=%d", key, &v) == 2) {
            if (!strcmp(key, "jit") && v >= 1 && v <= 1000000) {
                wasm_instantiate_num = v;
            } else if (!strcmp(key, "max") && v >= 1000 && v < INSTANCE_RUNNING_LEN) {
                wasm_max_instance_alive = v;
            } else if (!strcmp(key, "fpinline")) {
                wasm_fp_inline_enabled = v != 0;
            } else if (!strcmp(key, "chain")) {
                /*
                 * 1 = tail-call chaining (return_call_indirect). 2 = nested chaining: the same
                 * hand-off as an ordinary call_indirect + return, for hosts whose wasm tail calls
                 * are missing or broken (iPadOS 27.2 beta WebKit kills the page on cross-module
                 * return_call_indirect); the stack grows per hop, so the budget is small.
                 */
                wasm_tail_chain = v != 0;
                wasm_chain_nested = v == 2;
                if (wasm_chain_nested) {
                    wasm_chain_budget = 32;
                }
            } else if (!strcmp(key, "chainmax") && v >= 2 && v <= WASM_CHAIN_BUDGET) {
                wasm_chain_budget = v;
            } else if (!strcmp(key, "regloc")) {
                wasm_reg_locals = v != 0;
            } else if (!strcmp(key, "hotshare")) {
                wasm_hot_share = v != 0;
            } else if (!strcmp(key, "tsc")) {
                qatomic_set(&bootbox_tsc_lockfree, v != 0);
            } else if (!strcmp(key, "fasttci")) {
                wasm_fast_tci = v != 0;
            } else if (!strcmp(key, "lazywasm")) {
                bb_lazy_wasm = v != 0;
            } else if (!strcmp(key, "sumcnt")) {
                wasm_sum_count = v != 0;
            } else if (!strcmp(key, "split")) {
                bb_split_enabled = v != 0;
            } else if (!strcmp(key, "share")) {
                bb_share_on = v != 0;
            } else if (!strcmp(key, "hammock")) {
                bb_hammock = v != 0;
            } else if (!strcmp(key, "hmmax") && v >= 1 && v <= 127) {
                bb_hm_max = v;
            } else if (!strcmp(key, "hmmod") && v >= 1) {
                bb_hm_mod = v;
            } else if (!strcmp(key, "hmsel") && v >= 0) {
                bb_hm_sel = v;
            } else if (!strcmp(key, "hmcpl")) {
                bb_hm_cpl = v;
            } else if (!strcmp(key, "repbulk")) {
                bb_repbulk = v != 0;
            } else if (!strcmp(key, "simdinline")) {
                wasm_simd_inline_enabled = v != 0;
            } else if (!strcmp(key, "gvecool")) {
                wasm_gvec_ool_enabled = v != 0;
            } else if (!strcmp(key, "sseatom")) {
                bb_sse_atom16 = v != 0;
            }
        }
        fclose(f);
        wasm_hot_num = (wasm_hot_share || wasm_sum_count) ? wasm_instantiate_num / 16 : wasm_instantiate_num;
        fprintf(stderr, "[bootbox-tune] jit=%d max=%d fpinline=%d chain=%d/%s/%d regloc=%d hotshare=%d sumcnt=%d tsc=%d fasttci=%d lazywasm=%d hammock=%d repbulk=%d simdinline=%d gvecool=%d sseatom=%d\n",
                wasm_instantiate_num, wasm_max_instance_alive, wasm_fp_inline_enabled,
                wasm_tail_chain, wasm_chain_nested ? "nested" : "tail", wasm_chain_budget,
                wasm_reg_locals, wasm_hot_share, wasm_sum_count, bootbox_tsc_lockfree, wasm_fast_tci, bb_lazy_wasm,
                bb_hammock, bb_repbulk, wasm_simd_inline_enabled, wasm_gvec_ool_enabled, bb_sse_atom16);
    }
    qatomic_set(&state, 2);
}

uintptr_t QEMU_DISABLE_CFI tcg_qemu_tb_exec(CPUArchState *env,
                                            const void *v_tb_ptr)
{
    bootbox_tune_init();
    ctx.env = env;
    ctx.tb_ptr = (uint32_t*)v_tb_ptr;
    ctx.do_init = 1;
    while (true) {
        trysleep();
        int tb_counter_ptr = (uint32_t)ctx.tb_ptr + counter_vec_off;
        uint32_t res;
        int fidx = get_instance_running_local(ctx.tb_ptr);
        if (fidx > 0) {
            ctx.chain_budget = wasm_chain_budget;
            res = ((wasm_func_ptr)(fidx))(&ctx);
        } else if (tb_wants_tci(*(int32_t*)tb_counter_ptr, ctx.tb_ptr)) {
            *(int32_t*)tb_counter_ptr += 1;
            res = tci_exec(env);
        } else if (!can_add_instance()) {
            remove_instance_running_local();
            check_instance_garbage_collected();
            res = tci_exec(env);
        } else {
            int fidx;
            /* no module stored with the TB (lazywasm): build it now, from a re-translation */
            const uint8_t *t = (const uint8_t *)ctx.tb_ptr;
            const uint8_t *body = t + *(const uint32_t *)t;
            uint32_t gen = bb_tb_flush_gen();
            uint32_t key = (uint32_t)(uintptr_t)ctx.tb_ptr;
            if (bb_share_on && bb_share_has(key, gen)) {
                fidx = instantiate_wasm(key, gen, 1);      /* compiled on another vCPU */
            } else if (*(const uint32_t *)(body + *(const uint32_t *)(body - 4)) == 0) {
                uint32_t *live = ctx.tb_ptr;
                uint8_t *copy = bb_tb_regen_wasm(env_cpu(env), live);
                if (copy) {
                    ctx.tb_ptr = (uint32_t *)copy;
                    int post = bb_share_on && tb_run_elsewhere(live);
                    fidx = instantiate_wasm(key, gen, post);
                    ctx.tb_ptr = live;
                    if (post && fidx > 0) {
                        qatomic_inc(&bb_share_posted);
                    }
                } else {
                    fidx = -1;
                }
            } else {
                int post = bb_share_on && tb_run_elsewhere(ctx.tb_ptr);
                fidx = instantiate_wasm(key, gen, post);
                if (post && fidx > 0) {
                    qatomic_inc(&bb_share_posted);
                }
            }
            if (fidx == -1) {
                /* not re-translatable right now: keep interpreting, retry after another round */
                *(int32_t*)tb_counter_ptr = 0;
                res = tci_exec(env);
            } else if (fidx > 0) {
                add_instance_running_local(fidx, ctx.tb_ptr);
                ctx.chain_budget = wasm_chain_budget;
                res = ((wasm_func_ptr)(fidx))(&ctx);
            } else {
                /*
                 * The host refused to compile another module: the cap is above what this
                 * browser can hold. Settle the cap just under the current live count (never
                 * below the 15000 default), evict half of this thread's instances, and run
                 * this TB interpreted; its counter restarts so it retries the compile later.
                 */
                int alive = qatomic_read(&instance_alive_global);
                int cap = MAX(MAX_INSTANCE_ALIVE, alive - alive / 8);
                if (cap < wasm_max_instance_alive) {
                    wasm_max_instance_alive = cap;
                }
                *(int32_t*)tb_counter_ptr = 0;
                remove_instance_running_local();
                res = tci_exec(env);
            }
        }
        if ((uint32_t)ctx.tb_ptr == 0) {
            return res;
        }
    }
}

#endif
