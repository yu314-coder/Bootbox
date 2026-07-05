# Bootbox

**A boot manager for your iPad.** Bootbox is a native iOS app that boots real operating
systems — 64-bit Linux (x86-64 *and* ARM64), classic Windows, graphical desktops — inside
a WebKit-hosted emulation stack, with real internet, real multi-core, a built-in file
browser, guest files in the iOS Files app, and one-tap downloads for every guest image.

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
| **64-bit Linux + Python & Wine** | x86-64 | **1–8 (default 2)** | Alpine · Python 3.12 + pip · real internet · file browser · `mc` · Wine present (limited — see Windows-programs note) | ~220 MB, once |
| **64-bit Linux — Desktop** | x86-64 | 1 | Full-screen twm desktop + taskbar + terminal + `links` browser + `mc` | ~129 MB, once |
| **64-bit Linux — ARM64** | aarch64 | 2 | *Genuine* ARM64 Alpine (`uname -m` = aarch64) · Python · internet · up to 1.5 GB RAM | ~61 MB, once |
| **Windows 98 SE** | i686 (v86) | 1 | Boots to the desktop | ~89 MB, once |
| **Windows 2000 Pro** | i686 (v86) | 1 | Working internet (NT NDIS via the relay) | ~340 MB, once |
| **Your own images** | i686 (v86) | 1 | Import `.iso`/`.img` via the Files app; paired save-states resume in ~1 s | — |

The **app itself is ~68 MB.** Guest images are **not bundled** — each system downloads
once from GitHub Releases and is cached (delete it in the Files app to reclaim space). The
64-bit engines ship inside the app, but the multi-hundred-MB rootfs images (and the ARM64
engine, which few users boot) are fetched on demand.

---

## Feature highlights

### Real multi-core (x86-64, up to 8 cores) — and it *actually* parallelizes
The x86-64 console guest boots **dual-core by default** (`nproc` = 2) and scales to **8**.
This is genuine parallelism, not a cosmetic core count: each vCPU is its own WebAssembly
worker running MTTCG, and a direct measurement (four CPU spinners for 8 s wall-clock,
integrating `/proc/stat`) shows the guest accruing **~4 cores' worth of CPU-time at
`-smp 4`** — i.e. ~4× throughput on parallel work (builds, `numpy`, compiles). A busy
program no longer freezes the shell.

Pick the count in the emulator toolbar (also in UEFI Setup → Advanced). Because a live
WebAssembly engine **cannot be re-instantiated in place** (its pthread workers and shared
memory are one-shot), changing cores or RAM **cleanly reloads the page and auto-resumes the
guest** with the new setting — so the selector always takes effect (an earlier build could
get "stuck" at the first boot's core count). More cores run genuinely faster **and hotter**
under load, since each core is a full software-emulated CPU — the selector is an honest
speed/heat knob: **1 = coolest, 2 = balanced, 4–8 for heavy parallel compute.**

### Cooling: three independent wins
Every guest instruction is software-translated by WebKit's WASM JIT — there's no
Hypervisor.framework on iOS, so the translation *is* the heat. Bootbox attacks it three ways:

1. **Idle busy-poll → futex sleep (engine).** Emscripten's `poll()` returns immediately
   regardless of timeout, so QEMU's `qemu_poll_ns()` degenerated into a busy-spin — **~1.2
   host cores at an idle shell prompt.** The patched engine polls non-blocking and sleeps
   the *remaining* timeout on a real zero-CPU futex in adaptive 1→8 ms slices. Idle host CPU
   **~120% → ~32%**, and boot/parallel workloads got *faster* (the spin had been starving
   the vCPU threads).
2. **Tickless guest kernels.** The guest kernels are built `NO_HZ_IDLE` + `HIGH_RES_TIMERS`,
   so an idle CPU stops taking the 100 Hz scheduler tick — under emulation each avoided tick
   is an emulated LAPIC IRQ + TB execution + a worker wake-up saved. Combined with the futex
   engine, **idle drops to ~3–6% host CPU.**
3. **Stripped engine binaries (`-g`).** The shipped engines were compiled with `-g`, which
   embedded full DWARF debug info — that was the *bulk* of the binary. Dropping it for
   release cut **x86-64 41.2 MB → 11.4 MB** and **aarch64 55.7 MB → 15.5 MB (−72%)** with
   byte-identical codegen (same `-O3`) — so zero runtime-speed cost, just far less to fetch,
   parse, instantiate and keep resident (~30 MB less memory per engine), and lower WebKit JIT
   pressure. Cooler startup, cooler idle, a smaller app.

Under *sustained* heavy load, heat is `N_cores × cost-per-instruction × duty-cycle` — you
can't make an emulated instruction cheap, so the honest levers are fewer cores / less
duty-cycle (hence the cores knob above). The three wins here cut everything *around* the
core emulation: idle, startup, memory, and the engine tax.

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
- Common TUI/file tools are pre-installed (`ncdu`, `htop`, `tree`, `tmux`, `nano`, `less`).

### A built-in file browser + iPad ↔ guest transfers
The 64-bit console has a **📁 Files tab** — an iOS-Files-style, point-and-tap browser of the
live guest filesystem (it drives `ls`/`cat`/`cp`/`rm` over the serial pty, no extra daemon).
Browse folders, view text files, **⬇ save a guest file to the iPad** (Files app → Bootbox),
**⬆ copy an iPad file into the guest** (via a shared 9p folder), and delete. Hidden dotfiles
are shown. The first listing right after boot is slow only because the emulated CPU is still
finishing boot; once settled a listing is **<0.5 s**.

### Windows programs
Classic Windows (98/2000) boots natively in **v86**, and 32-bit `.exe` run in **BoxedWine**
(import an `.exe` → Compatibility Center → 🍷 Run with Wine → the window renders via noVNC).

Wine 9.0 is also present inside the 64-bit Linux guest, **but it is not practical there**:
under the QEMU-Wasm engine's threading model, Wine's device services (`wineusb`, `winebus`,
`Winedevice2`) deadlock on `RtlpWaitForCriticalSection` during startup, so most `.exe` hang.
(This is separate from the "prefix not initialized" `kernel32.dll` error — that part is
avoidable, but the service deadlock is a fundamental wasm-TCG limitation.) Heavy GUI apps —
e.g. PyInstaller-packed Python/Qt apps — are beyond emulated Wine regardless. **For Windows
software, prefer v86 (98/2000) or BoxedWine.**

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
keyboard routing follows your last tap, and full-screen TUIs (`ncdu`, `mc`, `vi`) get the
right arrow-key sequences (application-cursor mode). A 🔧 File-Sync diagnostics panel is
built into the boot menu.

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
    js/boot.js                  power-on → POST → boot manager (+ reboot-to-apply resume)
    js/apps/biosmenu.js         boot menu + UEFI setup
    js/apps/emulator.js         guest orchestration, toolbar (RAM/cores), download-on-demand
    vendor/qemu/                QEMU-Wasm glue: run.js (boot, RAM/-smp overrides, noVNC
                                pre-warm), panel.js (terminal/GUI/Files panes)
    vendor/qemu-aload/          x86-64 engine (patched QEMU-Wasm, -g-stripped) + loader
    vendor/qemu-aarch64/        ARM64 engine loader (engine wasm + rootfs download on demand)
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
| `Dockerfile.base` → `Dockerfile.pw` | Alpine + Python 3.12 + pip/uv + Wine + Xvnc + TUI tools (+ constraints, timeouts) | x86-64 console guest |
| `Dockerfile.desktop` | Alpine + twm/tint2 desktop + links + mc | x86-64 desktop guest |
| `Dockerfile.arm64` | aarch64 Alpine + Python | ARM64 guest |

Two small public forks carry the fixes that make multi-core, low-power and small binaries
possible (single-purpose branches over the upstream pins — diff them to see exactly what
changed):

- **[yu314-coder/container2wasm](https://github.com/yu314-coder/container2wasm)**, branch
  `lowpower` — (a) enables `CONFIG_ACPI` in the guest kernel so CPU discovery uses QEMU's
  MADT table (SMP), (b) builds the kernel tickless (`NO_HZ_IDLE` + `HIGH_RES_TIMERS`), and
  (c) drops `-g` from the QEMU/emscripten build flags for a release-size engine.
- **[yu314-coder/qemu-wasm](https://github.com/yu314-coder/qemu-wasm)**, branch
  `idle-sleep` — replaces the event-loop busy-poll with adaptive futex sleeps.

Example (x86-64 console pack) — note `--dockerfile` selects the fork's `-g`-stripped build
recipe instead of `c2w`'s embedded default:

```bash
docker buildx build --platform linux/amd64 -t alpine-pw:latest \
  -f ubuntu-build/Dockerfile.pw ubuntu-build
c2w --to-js \
  --dockerfile /path/to/container2wasm-fork/Dockerfile \
  --build-arg SOURCE_REPO=https://github.com/yu314-coder/container2wasm \
  --build-arg SOURCE_REPO_VERSION=lowpower \
  --build-arg QEMU_REPO=https://github.com/yu314-coder/qemu-wasm \
  --build-arg QEMU_REPO_VERSION=idle-sleep \
  alpine-pw:latest ./out/           # add --target-arch=aarch64 for the ARM64 pack
```

The output pack is stripped of its dead migration snapshot, gzipped, uploaded to a GitHub
Release, and referenced by a **size-tagged filename** (`qemu64-rootfs-<bytes>.data.gz`,
`qemu-aarch64-engine-<bytes>.wasm.gz`, …) in `emulator.js` + `LocalServer.swift`. The size
tag is the cache-buster: change the image → the tag changes → devices re-download exactly
once. (The x86-64 engine binary ships in the app; the ARM64 engine and all rootfs images
are download-on-demand.)

---

## Engineering notes (the fun bugs)

Six of the problems this app had to solve are unusual enough to write down:

**1. Why `-smp 2` used to boot with one CPU.**
QEMU parsed it, created both vCPUs, both threads ran, the second CPU even *answered the
BIOS's wake-up call* — and Linux still saw one CPU. The culprit: SeaBIOS counts responding
CPUs into a bitmap written by the *application processor's thread*, and under the wasm
engine's memory model that write wasn't visible to the boot CPU when it built the MP
table, so the table listed one processor. Fix: enable **ACPI in the guest kernel** — QEMU
builds the MADT itself (single-threaded, lists every CPU), the kernel does its own
INIT/SIPI bring-up, and every core comes online.

**2. Why the core count could get "stuck."**
Selecting more cores wrote the setting and re-launched the guest — but a running
WebAssembly engine can't be re-instantiated in the same page realm (its emscripten pthread
workers and `SharedArrayBuffer` memory are one-shot), so the loader silently reused the live
module and kept the *first* boot's `-smp`. Fix: a 64-bit reboot now stashes the target
guest + cores + RAM in `sessionStorage` and reloads the page; the firmware boot path
(`boot.js`) picks that up and auto-resumes the guest in a fresh realm with the new setting.

**3. Why the emulator burned a core doing nothing.**
Emscripten's `poll()` returns immediately regardless of timeout, so QEMU's
`qemu_poll_ns()` degenerated into a busy-spin — ~1.2 host cores at an idle shell prompt.
The `idle-sleep` engine patch polls non-blocking and sleeps the *remaining* timeout on a
real futex in adaptive 1→8 ms slices; the tickless guest kernel then stops even the idle
scheduler tick. Idle host CPU dropped from ~120% to ~3–6%, and boot/parallel workloads got
*faster* — the spin had been starving the vCPU threads all along.

**4. Why the shipped engines were 3–4× too big.**
The QEMU/emscripten builds passed `-g`, which retained full DWARF debug sections in the
production `.wasm` (and extra debug metadata in the JS glue) — the majority of the binary.
Dropping `-g` for release cut the x86-64 engine 41.2 → 11.4 MB and the aarch64 engine
55.7 → 15.5 MB with **byte-identical codegen** (`-O3` unchanged), so no runtime-speed cost —
purely faster download/parse/instantiate, less resident memory, and lower JIT pressure.
`c2w` embeds its own Dockerfile, so the strip only takes effect when the build passes
`--dockerfile` pointing at the fork's recipe.

**5. Why the ARM64 guest crashed at 1.5 GB RAM.**
The aarch64 engine has a *fixed* 2300 MB WebAssembly heap. Booting with `-m 1536` and the
inherited `tb-size=500` (a 500 MB translation-block buffer) plus the `virt` machine's edk2
firmware overflowed it — *"memory access out of bounds"* the moment QEMU started, before the
guest kernel ran. (This was a latent crash in the shipped 1.5 GB ARM config too.) Fix:
lower the ARM `tb-size` to 192 (matching x86-64), freeing ~308 MB — now it boots at 1536 MB.

**6. Why `pip install numpy` needs NumPy 1.x here.**
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
