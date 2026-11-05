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
- 1.1, off by default (`hammock=1`): a short forward `jcc` stays inside the TB
  (`target/i386/tcg/translate.c`). CPU-Z single-core +5% on the Mac, but the desktop's WebKit renders
  blank pages with it - an open bug

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
