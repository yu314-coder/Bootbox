# Android 12 x86-64 guest

Bootbox runs a real Android 12 AOSP x86-64 userspace in the same full-system
QEMU-Wasm engine as its x86-64 Linux guests. It does not try to boot an Android
Studio AVD: those images depend on the Android Emulator's ranchu/goldfish devices,
which generic QEMU-Wasm does not implement. The guest uses ReDroid's AOSP userspace
with a Bootbox kernel that supplies Binder and the ordinary virtio devices already
supported by the WebAssembly QEMU build.

## Runtime layout

- `rootfs.bin`: immutable LZ4 SquashFS containing the container wrapper and Android.
- `userdata.qcow2`: thin 2 GiB ext4 `/data`; the ext4 security xattrs are required by
  Android's user and package managers.
- `bzImage`: x86-64 kernel with Android base configuration, Binder, dma-heap, uinput,
  virtio, ext4 security/ACL support and SquashFS LZ4.
- `bootbox_android_vnc.c`: maps ReDroid's linear compositor buffer, exposes VNC on
  port 5900 and translates noVNC pointer/key events to an Android uinput device.
- `Bootbox/web/vendor/qemu-android`: the packaged-file metadata and QEMU arguments.

Android uses `vendor/qemu-android-engine`, a dedicated 3 GiB fixed-heap QEMU-Wasm
engine. This avoids changing the memory contract of the existing Linux guests. The
release disk pack is downloaded only when Android is selected.

## Rebuild

Requirements are Docker Buildx, Git, QEMU (`qemu-img`) and the Bootbox `c2w` binary.
The Dockerfile downloads the official Android NDK r27d toolchain used to compile the
x86-64 Android VNC/input bridge.

```bash
docker buildx build --platform linux/amd64 --load \
  -t bootbox-android64:vnc \
  -f ubuntu-build/Dockerfile.android64 ubuntu-build

git clone -b lowpower https://github.com/yu314-coder/container2wasm android-c2w
git -C android-c2w apply "$PWD/ubuntu-build/android64-container2wasm.patch"

c2w --dockerfile "$PWD/android-c2w/Dockerfile" \
  --assets "$PWD/android-c2w" \
  --target-stage rootfs-amd64-export \
  bootbox-android64:vnc ./android-rootfs
```

Build/export the patched `linux-amd64-kernel-export` stage for `bzImage`, create a
2 GiB ext4 qcow2 userdata drive, and place the kernel, rootfs, userdata and the QEMU
BIOS/ROM files under `/pack`. The final Emscripten file pack must preserve those
absolute `/pack/...` names and be generated as `qemu-system-x86_64.data` plus
`load.js`. Gzip the data file for the release asset; `LocalServer.swift` serves it
with `Content-Encoding: gzip`, so WebKit inflates it directly while streaming.

The checked release candidate has these identities:

| Artifact | Bytes | SHA-256 |
|---|---:|---|
| `qemu-system-x86_64.data` | 622,982,112 | `669f07c0dc4c2eb2ea7d34ab8e45a84951e9ae6d0336026a0167b8f77e974cbb` |
| `qemu-system-x86_64.data.gz` | 619,631,072 | `967f7fccb3873f4f94b1acd9fe6305e14756a0955a3c4382ed7880d4b8fd7081` |
| `rootfs.bin` (qcow2, virtual raw disk 709,595,136 bytes) | 613,783,552 | `0f705ff9ae36fe7bd48264017851098f6558aa22b7b418d49285b4c0da2ad04c` |
| `bzImage` | 4,363,744 | `fd1cf9353de42f6b0c7d86491a9968cbd768a4f6dcb770fe27fef5d6a9f0e735` |
| `userdata.qcow2` | 4,361,728 | `4db4d253c10e40673486bf73ea8ca60bef71bdeb70ddb9b3005fd4b17388a1d5` |
| shared QEMU engine (`.wasm`) | — | `7775543d7cf0f5b5238d6e574271638f988896abf5ae5fc7ea81b68538681cf3` |

The memory-optimized release asset name is `qemu-android64-rootfs-qcow2.data.gz` under the `android64-v1`
GitHub release. When rebuilding, change the uncompressed-size tag in both
`emulator.js` and `LocalServer.swift`, and update the exact compressed byte count.

## Scope and performance

- Android ABI: x86-64 (the included native bridge also advertises arm64-v8a app
  translation support).
- Display: 1024×768, 160 dpi, 15 fps, software rendering.
- Default VM: four MTTCG vCPUs and 1,280 MiB RAM; the UI caps Android at that value
  to preserve WebKit/iPadOS memory headroom.
- CPU model: `qemu64` plus Android's SSSE3/SSE4/POPCNT baseline. The patched Wasm
  TCG backend also runs `-cpu max`, but measured slower because software-translated
  AVX paths cost more than they save. `GODEBUG=cpu.all=off` keeps the Go-based container
  wrapper on generic amd64 routines without hiding required features from Android.
- Included: AOSP framework, ART, Package Manager, System UI and Launcher3.
- Not included: Google Play, GMS, Play certification or hardware GPU acceleration.

Native QEMU reached `sys.boot_completed=1`, mounted `/data` as ext4, displayed
Launcher3 through VNC and accepted browser touch input. In Chrome's WebAssembly
runtime the shared QEMU engine initializes in 0.81 seconds, but Android cold boot is
slow: the final clean qemu64 run reached VNC in 250.90 seconds and the framebuffer was
still entirely black at 613.56 seconds. `-cpu max` had not reached VNC after seven
minutes. Lazy Zygote preload reduced its blocking preload phase from roughly
249 seconds to 6.4 seconds, although later framework class loading still dominates.
These are development-Mac measurements; iPad speed varies by SoC and WebKit version.

A QEMU migration-state prototype restored successfully and reduced VNC availability to
about 198 seconds, but added roughly 63 MB and still resumed before a visible System UI.
It is therefore not included in this release candidate. A production warm image must be
captured only after an identically networked guest confirms `sys.boot_completed=1`.
