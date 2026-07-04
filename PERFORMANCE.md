# MiniOS — Performance & JIT (Rosetta-style translation)

The iPad is ARM64; the guests are x86. So every guest runs through **binary
translation** — exactly the problem macOS Rosetta 2 solves (x86‑64 → ARM64).

## How translation works here

- **v86** (32-bit guests) recompiles hot x86 code → **WebAssembly**, which
  **WebKit JIT-compiles to native ARM**. So: `x86 → WASM → (WebKit JIT) → ARM`.
  That's a lightweight Rosetta-style pipeline running inside the web engine.
- **QEMU-Wasm** (64-bit guest) uses TCG to translate, also compiled to WASM —
  correct but heavier, hence slower.

The **emulator window shows a speed badge** (⚡ Fast / ⏱ Medium / 🐢 Slow) from a
one-time benchmark, and tunes guidance accordingly.

## Why it isn't Rosetta-2-fast — and how to get closer

The hard limit is **JIT for the app's own native code**. Apple reserves that for
system processes (Rosetta) and WebKit. WKWebView's JS/WASM **already** get JIT, so
v86/QEMU-Wasm are accelerated — but you can do better:

| Install method | App-code JIT | Speed |
|---|---|---|
| App Store / plain ad-hoc | ❌ | WebKit WASM JIT only (baseline) |
| **AltStore / SideStore** | ✅ (JIT enabled) | Much faster — WebKit JITs aggressively |
| **TrollStore** | ✅ | Same |
| **Xcode run + debugger attached** | ✅ | Same; easiest for development |

### Enabling JIT
1. **Development:** Run from Xcode with the device attached — the debugger grants
   JIT automatically.
2. **AltStore/SideStore:** install the `.ipa`, then use the app's "Enable JIT"
   (SideStore can auto-enable via JitStreamer).
3. **TrollStore:** permanently entitled; JIT is on.

With JIT on, both engines speed up for free.

## The true Rosetta path (future)
To match Rosetta 2 you'd embed a dedicated **x86→ARM translator** (FEX-Emu /
box64-class) — only possible with JIT entitlements (sideloaded), and a large
effort. The **arm64 VMware ISO already ships box64** (real x86→ARM translation),
but that needs a real ARM host (VMware / a JIT-enabled device), not the v86 sandbox.

## Practical guidance
- **Fast device + JIT:** any guest is usable, incl. 64-bit.
- **Slow / no JIT:** stick to the **32-bit modern desktop** (instant boot via
  snapshot); the 64-bit terminal will be sluggish.
- **Heavy full ISOs** (minilinux-i386 Debian+Wine, Android-x86) are **VMware only**
  — too heavy for v86 regardless of JIT.
