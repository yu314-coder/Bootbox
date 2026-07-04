# Bootbox

**A boot manager for your iPad.** Bootbox is a native iOS app that boots real operating
systems — 64-bit Linux (x86-64 *and* ARM64), classic Windows, graphical desktops — inside
a WebKit-hosted emulation stack, with real internet, real multi-core, files in the iOS
Files app, and one-tap downloads for every guest image.

Everything runs on-device. No servers, no streaming, no jailbreak.

```
┌────────────────────────────────────────────────────────────┐
│  iPad (iOS)                                                │
│  ┌──────────────────────────────────────────────────────┐  │
│  │ Bootbox.app (Swift)                                  │  │
│  │  HostView ── WKWebView (cross-origin isolated)       │  │
│  │  LocalServer       · in-app HTTP w/ COOP/COEP + gzip │  │
│  │  Iosnet.xcframework · gVisor netstack → real TCP/IP  │  │
│  │  BinaryBridge/Downloader · guest images on demand    │  │
│  │  FileProviderExtension   · guest files in Files.app  │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │ web/ — the "firmware" UI (boot menu + UEFI     │  │  │
│  │  │ setup) and the engines:                        │  │  │
│  │  │  · QEMU-Wasm x86-64 (SMP, ACPI, virtio, 9p)    │  │  │
│  │  │  · QEMU-Wasm aarch64 (real ARM64, dual-core)   │  │  │
│  │  │  · v86 (fast 32-bit x86: Win98/2000, i686)     │  │  │
│  │  │  · Boxedwine (Wine in the browser)             │  │  │
│  │  │  · noVNC (graphical output for X11/Wine)       │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────┘
```

---

## What it boots

| System | Arch | Cores | Highlights | Download |
|---|---|---|---|---|
| **64-bit Linux + Python & Wine** | x86-64 | **1–8 (default 2)** | Alpine · Python 3.12 + pip · Wine 9.0 (32 **and** 64-bit `.exe`) · real internet · `mc` | ~220 MB, once |
| **64-bit Linux — Desktop** | x86-64 | 1 | Full-screen twm desktop + taskbar + terminal + `links` browser + `mc` | ~129 MB, once |
| **64-bit Linux — ARM64** | aarch64 | 2 | *Genuine* ARM64 Alpine (`uname -m` = aarch64) · Python · internet | ~77 MB, once |
| **Windows 98 SE** | i686 (v86) | 1 | Boots to the desktop | ~89 MB, once |
| **Windows 2000 Pro** | i686 (v86) | 1 | Working internet (NT NDIS via the relay) | ~340 MB, once |
| **Your own images** | i686 (v86) | 1 | Import `.iso`/`.img` via the Files app; paired save-states resume in ~1 s | — |

Guest images are **not bundled** — the app itself is ~60 MB; each system downloads once
from GitHub Releases and is cached (delete it in the Files app to reclaim space).

---

## Feature highlights

### Real multi-core (x86-64, up to 8 cores)
The x86-64 console guest boots **dual-core by default** (`nproc` = 2) with genuine
parallel execution — two jobs really run at once (measured 2.0× wall-clock speedup), and a
busy program no longer freezes the shell. A **cores selector (1/2/4/6/8)** sits in the
emulator toolbar next to RAM (also in UEFI Setup → Advanced). 2 is the measured sweet
spot; higher counts help CPU-parallel workloads; idle power stays flat at any count.

### 4× lower idle power
The QEMU-Wasm engine used to burn ~1.2 host cores *while the guest sat idle* — a busy-poll
in the event loop (emscripten's `poll()` never blocks). Bootbox ships a patched engine that
sleeps on a real zero-CPU futex between polls (adaptive 1→8 ms slices). Measured results:
**idle ~120% → ~32% host CPU**, boot 30 s → ~20 s, and parallel compute up to 3× faster
(the spin had been robbing a core from the vCPUs). Cooler iPad, much longer battery.

### Python that actually works
- `pip install` is backed by **uv** (a static Rust resolver — no slow Python import tree)
- ~24 common pure-Python packages **pre-installed** (`flask`, `requests`, `jinja2`, …)
- **10-minute download timeouts** baked in — large wheels (scipy is 35 MB) download fine
  over the emulated NIC
- **`pip install numpy` just works**: a baked-in constraints file resolves to the
  NumPy 1.x line, whose wheels do *runtime* CPU-feature dispatch. (NumPy 2.x wheels are
  compiled for x86-64-v2 and crash on the emulated CPU — and raising the CPUID is unsafe:
  the wasm TCG backend mis-executes SSE4-era instructions.) scipy/pandas/matplotlib/pillow
  ship Alpine (musllinux) wheels; for scikit-learn use `apk add py3-scikit-learn`.

### Windows programs
The console guest includes **Wine 9.0 with both 32-bit and 64-bit support** — run
`wine program.exe` in the terminal and the window appears in the GUI pane (noVNC → Xvnc).
Classic Windows (98/2000) boots natively in v86.

### Your files, in the Files app
An **iSH-style File Provider** exposes the Bootbox folder in the iOS Files app — drop
`.img`/`.iso`/`.exe` files in, pull guest exports out. It deliberately uses the classic
(non-replicated) `NSFileProviderExtension`: the modern replicated API runs iOS's cloud-sync
engine, which permanently shows *"Syncing Paused"* for a purely-local provider. Materialized
files are hard links — zero copies even for multi-GB disk images.

### Real internet, no proxies
`Iosnet.xcframework` embeds a **gVisor userspace TCP/IP stack** (from container2wasm's
`c2w-net`): the guest's virtio NIC frames travel over a local WebSocket into native
sockets. `pip`, `apk`, `wget`, DNS — everything works, fully on-device.

### A boot experience, not a settings screen
GRUB-style **boot menu** with per-system notes → classic Aptio-blue **UEFI Setup**
(functional RAM / CPU-cores / boot-order / network toggles, plus some loving theater) →
serial console on the left, GUI on the right. The terminal fills its pane, taps focus it,
and keyboard routing follows your last tap. A 🔧 File-Sync diagnostics panel is built into
the boot menu.

---

## Repository layout

```
Bootbox.xcodeproj/          Xcode project (app + FileProvider extension targets)
Bootbox/                    Swift host app
  HostView.swift              WKWebView shell (cross-origin isolated)
  LocalServer.swift           in-app HTTP server: COOP/COEP headers, gzip-on-the-fly,
                              size-tagged download cache for guest images
  BackgroundKeepAlive.swift   keeps the VM alive briefly in background, then lets iOS
                              suspend (timed release — battery)
  Bridge/                     native bridges: Downloader, BinaryBridge (import/gunzip),
                              DomainRegistrar (File Provider), System/Media/Clipboard…
  web/                        the whole "firmware" UI + engines (served by LocalServer)
    js/apps/biosmenu.js         boot menu + UEFI setup
    js/apps/emulator.js         guest orchestration, toolbar (RAM/cores), download-on-demand
    vendor/qemu/                QEMU-Wasm glue: run.js (boot, RAM/-smp overrides, noVNC
                                pre-warm), panel.js (terminal/GUI panes)
    vendor/qemu-aload/          x86-64 engine (patched QEMU-Wasm) + loader
    vendor/qemu-aarch64/        ARM64 engine loader (engine wasm downloads on demand)
    vendor/qemu-desktop/        desktop-guest loader (shares the x86-64 engine binary)
    vendor/v86/                 v86 (32-bit x86 in wasm)
    vendor/boxedwine/           Boxedwine
    vendor/novnc/               noVNC (guest GUI)
FileProvider/               Files-app integration (classic NSFileProviderExtension)
Frameworks/Iosnet.xcframework   gVisor netstack (Go, via gomobile)
ubuntu-build/               Dockerfiles for the guest rootfs images (see below)
docs/                       historical design docs (the MiniOS web-shell era)
tools/, build.sh            misc build helpers
```

---

## Building the app

Requirements: Xcode 16+, an Apple developer team for device installs.

```bash
open Bootbox.xcodeproj          # build & run the "Bootbox" scheme on an iPad
```

CLI (unsigned build):

```bash
xcodebuild -project Bootbox.xcodeproj -scheme Bootbox -configuration Release \
  -destination 'generic/platform=iOS' build CODE_SIGNING_ALLOWED=NO
```

> **Speed note:** WKWebView JITs WebAssembly under normal App Store rules, so emulation is
> fast without sideloading; the in-app benchmark badge shows your device's tier.

---

## Rebuilding the guest images

Guest rootfs/kernel/engine packs are produced by
[container2wasm](https://github.com/container2wasm/container2wasm) from ordinary Docker
images. The Dockerfiles live in `ubuntu-build/`:

| Dockerfile | Produces | Used by |
|---|---|---|
| `Dockerfile.base` → `Dockerfile.pw` | Alpine + Python 3.12 + pip/uv + Wine + Xvnc (+ constraints, timeouts) | x86-64 console guest |
| `Dockerfile.desktop` | Alpine + twm/tint2 desktop + links + mc | x86-64 desktop guest |
| `Dockerfile.arm64` | aarch64 Alpine + Python | ARM64 guest |

Two small public forks carry the fixes that make multi-core and low-power possible (both
are single-purpose branches over the upstream pins — diff them to see exactly what
changed):

- **[yu314-coder/container2wasm](https://github.com/yu314-coder/container2wasm)**, branch
  `acpi-smp` — enables `CONFIG_ACPI` in the guest kernel so CPU discovery uses QEMU's MADT
  table (see *Engineering notes*).
- **[yu314-coder/qemu-wasm](https://github.com/yu314-coder/qemu-wasm)**, branch
  `idle-sleep` — replaces the event-loop busy-poll with adaptive futex sleeps.

Example (x86-64 console pack):

```bash
docker buildx build --platform linux/amd64 -t alpine-pw:latest \
  -f ubuntu-build/Dockerfile.pw ubuntu-build
c2w --to-js \
  --build-arg SOURCE_REPO=https://github.com/yu314-coder/container2wasm \
  --build-arg SOURCE_REPO_VERSION=acpi-smp \
  --build-arg QEMU_REPO=https://github.com/yu314-coder/qemu-wasm \
  --build-arg QEMU_REPO_VERSION=idle-sleep \
  alpine-pw:latest ./out/
```

The output pack (`.data` + `load.js`) is stripped of its dead migration snapshot, gzipped,
uploaded to a GitHub Release, and referenced by a **size-tagged filename**
(`qemu64-rootfs-<bytes>.data.gz`) in `emulator.js` + `LocalServer.swift`. The size tag is
the cache-buster: change the image → the tag changes → devices re-download exactly once.

---

## Engineering notes (the fun bugs)

Three of the problems this app had to solve are unusual enough to write down:

**1. Why `-smp 2` used to boot with one CPU.**
QEMU parsed it, created both vCPUs, both threads ran, the second CPU even *answered the
BIOS's wake-up call* — and Linux still saw one CPU. The culprit: SeaBIOS counts responding
CPUs into a bitmap written by the *application processor's thread*, and under the wasm
engine's memory model that write wasn't visible to the boot CPU when it built the MP
table, so the table listed one processor. Fix: enable **ACPI in the guest kernel** — QEMU
builds the MADT itself (single-threaded, lists every CPU), the kernel does its own
INIT/SIPI bring-up, and both cores come online. No BIOS patch needed.

**2. Why the emulator burned a core doing nothing.**
Emscripten's `poll()` returns immediately regardless of timeout, so QEMU's
`qemu_poll_ns()` degenerated into a busy-spin — ~1.2 host cores at an idle shell prompt.
The `idle-sleep` engine patch polls non-blocking and sleeps the *remaining* timeout on a
real futex in adaptive 1→8 ms slices. Idle host CPU dropped 4×, and — the good surprise —
boot and parallel workloads got *faster*, because the spin had been starving the vCPU
threads all along.

**3. Why `pip install numpy` needs NumPy 1.x here.**
NumPy 2.x musllinux wheels are compiled for the x86-64-v2 baseline (SSSE3/SSE4/POPCNT).
The emulated CPU doesn't advertise those — and it must not: advertising them makes guest
code take SIMD paths that the wasm TCG backend *mis-executes* (silently wrong results, Go
runtime crashes). NumPy 1.x wheels detect CPU features at **runtime** and run correctly.
A baked `pip`/`uv` constraints file pins the working line so a plain `pip install numpy`
does the right thing.

---

## Credits

Bootbox stands on excellent open source:

- **[v86](https://github.com/copy/v86)** — x86 virtualization in WebAssembly (BSD-2-Clause)
- **[QEMU](https://www.qemu.org/)** (GPL-2.0) via
  **[ktock/qemu-wasm](https://github.com/ktock/qemu-wasm)** — QEMU compiled to WebAssembly
- **[container2wasm](https://github.com/container2wasm/container2wasm)** (Apache-2.0) —
  container → wasm packaging, guest init, and the `c2w-net`/gVisor networking approach
- **[noVNC](https://github.com/novnc/noVNC)** (MPL-2.0) — the guest GUI viewer
- **[Boxedwine](https://github.com/danoon2/Boxedwine)** (GPL-2.0) — Wine in the browser
- **[xterm.js](https://github.com/xtermjs/xterm.js)** (MIT) +
  [xterm-pty](https://github.com/mame/xterm-pty) — the serial console
- **[iSH](https://github.com/ish-app/ish)** — whose classic File Provider implementation
  showed the way past "Syncing Paused"

Modified engine sources are published in the two forks above, per the GPL. Guest Linux
images are built from Alpine Linux packages; classic-Windows images are user-supplied.

---

## License

App source (Swift + `web/js`): MIT. Vendored engines keep their own licenses (see Credits).
