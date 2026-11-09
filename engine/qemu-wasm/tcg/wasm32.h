#ifndef TCG_WASM32_H
#define TCG_WASM32_H

struct wasmContext {
    // 0
    CPUArchState *env;
    // 4
    uint64_t *stack;
    // 8
    uint32_t *tb_ptr;
    // 12
    uint32_t *tci_tb_ptr;
    // 16
    uint32_t do_init;
    // 20
    uint32_t done_flag;
    // 24
    uint64_t *stack128;
    // 28
    uint32_t unwinding;
    // 32: this thread's per-core slot offset in a TB's export vector (TB chaining)
    uint32_t export_vec_off;
    // 36: TB-to-TB tail calls left before control must return to the dispatcher
    int32_t chain_budget;
};

#define ENV_OFF 0
#define STACK_OFF 4
#define TB_PTR_OFF 8
#define HELPER_RET_TB_PTR_OFF 12
#define DO_INIT_OFF 16
#define DONE_FLAG_OFF 20
#define STACK128_OFF 24
#define UNWINDING_OFF 28
#define EXPORT_VEC_OFF_OFF 32
#define CHAIN_BUDGET_OFF 36

/* struct instance_info (wasm32.c): the `used` bit set by a chained tail call, for CLOCK eviction */
#define INSTANCE_USED_OFF 8

/*
 * Bootbox TB chaining: a TB whose successor is already compiled on this core tail-calls it
 * (return_call_indirect through the shared function table) instead of returning to the C
 * dispatcher. Needs wasm tail calls (Chrome 112+, Safari 18.2+): run.js feature-detects and
 * writes "chain=1" to /bootbox-tune; 0 (default) keeps the original return-to-dispatcher path.
 * The budget bounds how long a chain may run before the dispatcher (instance GC, sleeps) runs.
 */
#define WASM_CHAIN_BUDGET 256
extern int wasm_tail_chain;
extern int wasm_chain_nested;   /* chain=2: call_indirect + return (no wasm tail calls) */
extern int wasm_chain_budget;   /* hops per dispatch (chainmax=N; nested default 32) */

/* TCG host registers as wasm locals (spilled to globals only around calls that may unwind).
 * Default on; tune "regloc=0" generates the original all-globals code. */
extern int wasm_reg_locals;

void set_done_flag();

void set_unwinding_flag();

int get_core_nums();

void init_wasm32();

/* Default number of interpreted (TCI) runs before a TB is compiled to its own wasm module.
 * The live value is wasm_instantiate_num, tunable at startup via /bootbox-tune. */
#define INSTANTIATE_NUM 1500
extern int wasm_instantiate_num;

/* Reads /bootbox-tune once (jit=, max=, fpinline=); safe to call from any thread, any time. */
void bootbox_tune_init(void);

/*
 * Target float helpers the wasm backend may emit as native wasm float/SIMD ops instead of a
 * helper call (tcg_wasm_out_fp_inline). A target fills a table at init; NULL = never inline.
 * Every helper here has the shape helper(env, d, v, s) on 16-byte vector registers, except the
 * packed sqrt (WFP_PS/WFP_PD/WFP_PS256/WFP_PD256 x WFP_SQRT), which is helper(env, d, s). The 256-bit
 * kinds (AVX ymm helpers) are done as two 16-byte halves.
 */
enum { WFP_ADD, WFP_SUB, WFP_MUL, WFP_DIV, WFP_MIN, WFP_MAX, WFP_SQRT, WFP_NOPS };
enum { WFP_SS, WFP_SD, WFP_PS, WFP_PD, WFP_PS256, WFP_PD256, WFP_NKINDS };   /* scalar f32/f64, packed f32x4/f64x2, AVX f32x8/f64x4 */
/* Scalar compares and conversions (shapes in tcg_wasm_out_fp_inline_x). */
enum {
    WFPX_UCOMISS, WFPX_COMISS, WFPX_UCOMISD, WFPX_COMISD,          /* (env, a, b) -> CC_SRC */
    WFPX_CVTTSS2SI, WFPX_CVTTSD2SI, WFPX_CVTTSS2SQ, WFPX_CVTTSD2SQ, /* (env, s) -> int */
    WFPX_CVTSI2SS, WFPX_CVTSI2SD, WFPX_CVTSQ2SS, WFPX_CVTSQ2SD,     /* (env, d, int) */
    WFPX_CVTSS2SD, WFPX_CVTSD2SS,                                  /* (env, d, v, s) */
    WFPX_N
};
typedef struct WasmFpInline {
    const void *helper[WFP_NKINDS][WFP_NOPS];
    const void *xhelper[WFPX_N];
    /* byte offsets in CPUArchState of the guest's rounding mode, flush-to-zero, inputs-to-zero */
    int round_off, ftz_off, daz_off;
    int cc_src_off;   /* the comis* helpers write the condition codes here (target_ulong) */
} WasmFpInline;
extern const WasmFpInline *wasm32_fp_inline;
extern int wasm_fp_inline_enabled;   /* /bootbox-tune "fpinline=0" turns it off */

/*
 * Target integer-SIMD helpers the wasm backend emits as wasm SIMD (tcg_wasm_out_simd_inline): exact
 * integer shuffles/packs/multiplies, plus packed float<->int conversions (exact; MXCSR's sticky
 * flags are not updated, as with the float ops above). Shapes:
 *   WSI_SHUF/OP/PMULUDQ/PMULH/PSHUFB  helper(env, d, v, s)
 *   WSI_PSHUFD/LW/HW                  helper(d, s, imm)       imm must be a translation-time constant
 *   WSI_SHUFPS/PD                     helper(d, v, s, imm)
 *   WSI_CVT*                          helper(env, d, s)
 */
enum {
    WSI_SHUF,       /* d = i8x16.shuffle(v, s, lanes) */
    WSI_OP,         /* d = <SIMD opcode op>(v, s) */
    WSI_PMULUDQ,    /* d.q[i] = v.l[2i] * s.l[2i] */
    WSI_PMULH,      /* d.w[i] = high half of v.w[i] * s.w[i]; op = the extmul_low opcode (s/u) */
    WSI_PSHUFB,     /* d.b[i] = s.b[i] & 0x80 ? 0 : v.b[s.b[i] & 15] */
    WSI_PSHUFD, WSI_PSHUFLW, WSI_PSHUFHW,
    WSI_SHUFPS, WSI_SHUFPD,
    WSI_CVTDQ2PS, WSI_CVTPS2DQ, WSI_CVTTPS2DQ,
    /* generic 16-byte gvec helpers (accel/tcg/tcg-runtime-gvec.c), desc = last argument: */
    WSG_3,          /* (d, a, b, desc): d = <op>(a, b) */
    WSG_3ORC,       /* (d, a, b, desc): d = a | ~b */
    WSG_2,          /* (d, a, desc):    d = <op>(a), op 0 = copy */
    WSG_2I,         /* (d, a, desc):    d = <shift op>(a, simd_data(desc)) */
};
typedef struct WasmSimdInline {
    const void *helper;
    uint8_t kind;
    uint16_t op;
    uint8_t lanes[16];
} WasmSimdInline;
extern const WasmSimdInline *wasm32_simd_inline;
extern int wasm32_simd_inline_n;
extern int wasm_simd_inline_enabled;   /* /bootbox-tune "simdinline=0" turns it off */
extern int wasm_gvec_ool_enabled;      /* /bootbox-tune "gvecool=1": gvec->helper routing (off by default) */
extern const WasmSimdInline wasm32_gvec_inline[];   /* tcg/wasm32.c */
extern const int wasm32_gvec_inline_n;
/* tcg-op-gvec.c: expand 16-byte ops with these helpers as an out-of-line call (inlined as SIMD) */
bool wasm32_gvec_prefer_ool(const void *gen_fn, uint32_t oprsz, uint32_t maxsz);

#endif
