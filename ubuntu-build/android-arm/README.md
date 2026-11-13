# Android 12 ARM64 guest (Android v10, Nov 2026)

Bootbox's Android is real arm64-v8a Android (redroid 12.0.0_64only, arm64), so apps that ship only ARM native
code install and run. It runs on the aarch64 build of the Bootbox engine (`engine/Dockerfile.engine`
target `engine-only-aarch64`, shipped as `Bootbox/web/vendor/qemu-aarch64/`).

No container runtime: `init` (busybox initramfs) does what Docker does for redroid - devtmpfs, Binder nodes
0666, clock from the host info share, DHCP, read-only SquashFS root under a tmpfs overlay, `/data` on the
userdata disk - then `switch_root`s into Android's own `/init` with the redroid boot properties.

- kernel: Linux 6.1, `make ARCH=arm64 defconfig` merged with `kernel-arm64.fragment` (the x86 Android
  guest's options: Binder, DRM+VGEM, dma-heap, uinput, PSI, ...), debug options off (`kernel-arm64.config`).
- image: `assemble.sh` (arm64 alpine container, `/in` = `docker export` of redroid arm64 as redroid.tar, the
  GPU overlay `ubuntu-build/android-gpu`, Mesa from `engine/bbgpu/mesa/android/Dockerfile --build-arg ABI=aarch64`,
  the display bridge from `Dockerfile.android-vnc-arm64`, `android-config/init.zygote64.rc`).
- native rig (qemub container, its QEMU built with `--target-list=x86_64-softmmu,aarch64-softmmu`):
  `aboot-arm.sh` (adb :6558), `asetup-arm.sh` + `arestart.sh` + `alayout.sh` (Lawnchair home, wallpaper,
  gesture nav -> userdata-lawn), `capture-arm.sh` (capnet + `acap-arm.sh` + `android-gpu/aprep.sh` + migrate),
  `mkpack-arm.py` (pack + load.js).
- Gotchas: a framework soft restart (`stop; start`) leaves user 0 in BOOTING (home = FallbackHome) - reboot the
  VM instead; zombie QEMU processes in the container fool `pgrep` loops.
