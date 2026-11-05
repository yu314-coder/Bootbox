# Bootbox engine (QEMU-Wasm)

`qemu-wasm/` is the source of the x86-64 emulator that ships in the app as
`Bootbox/web/vendor/qemu-aload/qemu-system-x86_64.wasm` + `out.js`. The Linux Desktop, Linux Terminal
and Android guests all run on it. It is [ktock/qemu-wasm](https://github.com/ktock/qemu-wasm) (QEMU 8.2
with a WebAssembly TCG backend) plus the Bootbox engine work. QEMU is GPL-2.0, see `qemu-wasm/COPYING`.

The Bootbox changes are mostly in `tcg/wasm32.c`, `tcg/wasm32/tcg-target.c.inc` and `accel/tcg/`:

- lazy wasm modules: a block gets its wasm module only when it turns hot (`lazywasm=1`)
- a compact hot-loop interpreter, the default since 1.0 (`fasttci=1`)
- TCG registers in wasm locals; SSE float ops as native wasm; block chaining
- 16-byte atomics via a spinlock CAS, with no stop-the-world per kernel allocation
- sticky block splits at mid-block device I/O; a 4× per-vCPU jump cache
- a lock-free guest TSC; a pre-grown function table; a cached clock
- the typed helper-call dispatch split into small functions (`tcg/wasm32-tci-calls.c.inc`, generated; the
  generator script was not recovered with this tree, so edit the generated file directly)
- an experimental cross-vCPU module sharing mode (`share=1`, off)
- 1.1: leaner inlined SSE scalar ops (one NaN test on the result, no upper-lane copy when the
  destination is the source, `comiss`/`cvtt*` read each operand once); `fpcheck` stays bit-identical
- 1.1: TCI `br` decodes a zero displacement as "next instruction" (it used to jump to address 0)
- 1.1 (`hammock=1`, off by default): a short forward `jcc` stays inside the TB
  (`target/i386/tcg/translate.c`). Correct, and faster in Chrome (desktop sysbench +38%, 7-Zip +10%),
  but much slower under WebKit/JavaScriptCore (desktop CPU-Z 12.1 -> 3.4, glmark2 30 -> 5)

- 1.1: bulk `REP MOVS`/`REP STOS` (`target/i386/tcg/translate.c` `gen_rep_bulk` + `helper_rep_bulk` in
  `mem_helper.c`, `repbulk=0` turns it off). TCG ran one iteration per block exit; the helper does every
  iteration that cannot fault or touch I/O in one call (plain-RAM pages from the TLB, forward direction), the
  ordinary iteration handles the rest with precise faults. Guest memset/memcpy 49 -> 10,800 MB/s; Terminal
  glmark2 30 -> 53 (the clear scene was a third string-op iterations: frame copies, `clear_page`, `copy_user`)
- 1.1: SSE integer shuffles/packs/multiplies and packed float<->int conversions as wasm SIMD
  (`tcg_wasm_out_simd_inline`, `simdinline=0` turns it off); shuffle immediates come from the call's constant
  arguments. The pure SSE helpers are `TCG_CALL_NO_RWG` (the `comis*` helpers now return the flags), so guest
  registers are no longer written back and reloaded around every SSE op: CPU-Z single-thread +15% (WebKit
  desktop 11.6 -> 13.4, Chrome Terminal 14.6 -> 17.0)
- 1.1, opt-in (`gvecool=1`): the generic 16-byte vector ops (add/sub/saturating/min/max/logic/compare/shift/
  move) too - `tcg-op-gvec.c` routes them to their out-of-line helper, which the backend emits as one SIMD
  instruction instead of 8-16 64-bit ops. Off by default: in macOS WebKit 2 of 3 Terminal glmark2 runs with it
  collapsed to a score of 7-9 (0 of 5 without it)
- Correctness rigs for these (all identical to native QEMU and to Docker x86): `fpcheck`, `simdtest`
  (every inlined op, all shuffle immediates, all rounding modes), `reptest` (overlaps, DF=1, addr32, the
  register state at a page fault mid-copy)

Runtime switches are read from `/bootbox-tune` (written by `Bootbox/web/vendor/qemu/run.js`).

## Building

`Dockerfile.engine` is the container2wasm build recipe the engine is built with (emscripten 4.0.10,
1 MB stacks, growable memory up to 3392 MB, symbol map). Point its `qemu-repo` stage at this source:

```bash
docker buildx build --platform linux/amd64 --load -t bootbox-engine \
  --build-context qemu-repo=engine/qemu-wasm \
  --target qemu-emscripten-engine-amd64 -f engine/Dockerfile.engine .
id=$(docker create bootbox-engine true)
docker cp $id:/qemu/build/qemu-system-x86_64.wasm Bootbox/web/vendor/qemu-aload/
docker cp $id:/qemu/build/qemu-system-x86_64      Bootbox/web/vendor/qemu-aload/out.js
cp Bootbox/web/vendor/qemu-aload/out.js Bootbox/web/vendor/qemu-desktop/out.js
docker rm $id
```

For day-to-day work, keep the build tree from that stage in a long-lived container, copy changed
source files in, and run `emmake make qemu-system-x86_64` there; an incremental build takes minutes,
a clean one about half an hour.
