Module['arguments'] =
[
    // Android 12 AOSP **ARM64** (Nov 2026, Android v10): real arm64-v8a Android, so ARM-only apps (most of
    // the Play Store's native code) install and run. Engine: vendor/qemu-aarch64/ (the same QEMU-Wasm source
    // as the x86-64 engine, built for aarch64-softmmu). WARM-SNAPSHOT resume of a boot captured on the native
    // Linux rig behind the app's netstack config; the device list/order below must match that capture exactly.
    // No container runtime: /pack/initrd.gz prepares devices, the read-only SquashFS root (+ tmpfs overlay) and
    // /data, then becomes Android's own init (ubuntu-build/android-arm/). Graphics: the Bootbox GPU bridge (Mesa
    // bbgpu built for arm64). ro.hw_timeout_multiplier=50 in build.prop (no -icount, see the x86 notes).
    // Network: keep "-nic none" last - run.js swaps it for the netstack socket + virtio-net-pci (also the display path).
    "-nographic", "-M", "virt", "-cpu", "cortex-a76", "-m", "1280M",
    "-accel", "tcg,tb-size=256,thread=multi", "-smp", "4",
    "-L", "/pack/",
    "-incoming", "file:/pack/vm.state",
    "-drive", "if=virtio,format=raw,readonly=on,file=/pack/rootfs.bin",
    "-drive", "if=virtio,format=qcow2,file=/pack/userdata.qcow2,cache=writeback,discard=unmap",
    "-kernel", "/pack/Image", "-initrd", "/pack/initrd.gz",
    "-append", "console=ttyAMA0 loglevel=4 mitigations=off nowatchdog nosoftlockup audit=0 cryptomgr.notests random.trust_cpu=on androidboot.hardware=redroid androidboot.redroid_width=800 androidboot.redroid_height=600 androidboot.redroid_dpi=125 androidboot.redroid_fps=60 androidboot.use_redroid_vnc=1 androidboot.use_redroid_stream=1 androidboot.use_memfd=true androidboot.redroid_gpu_mode=guest androidboot.hw_timeout_multiplier=50 rdinit=/init",
    "-virtfs", "local,path=/,mount_tag=wasi0,security_model=passthrough,id=wasi0",
    "-virtfs", "local,path=/pack,mount_tag=wasi1,security_model=passthrough,id=wasi1",
    "-device", "bbgpu,slots=16,shm-mb=128",
    // v12: direct touch - the viewer writes finger events into the engine's shared mailbox and they reach
    // Android's touchscreen through this device (no VNC/network hop; run.js sendTouch, engine/bbgpu bbtouch)
    "-device", "virtio-multitouch-pci",
    "-nic", "none"
]
;
