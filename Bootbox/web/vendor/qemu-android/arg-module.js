Module['arguments'] =
[
    // Full Android 12 AOSP x86_64 — WARM-SNAPSHOT resume. The guest was booted
    // once to a fully-drawn Launcher3 (sys.boot_completed=1) and its RAM+device
    // state captured to /pack/vm.state; -incoming resumes it in ~seconds instead
    // of the multi-minute cold boot.
    //
    // NO -icount. The cold boot survives Android's 60s system_server Watchdog and
    // ART's 32s thread-suspend timeout — which otherwise crash-loop system_server
    // before System UI draws under ~15-30x software emulation — via
    // ro.hw_timeout_multiplier=50 baked into the rootfs build.prop (Google's own
    // slow-host knob: it scales those timeouts up so the boot completes at
    // emulation speed). That lets the whole thing run WITHOUT an instruction-counted
    // clock, which the wasm-TCG engine cannot execute (it crashes at
    // Module.__wasm32_tb on the -icount path). So the migration stream carries no
    // icount vmstate and this resume is a plain, real-time load the wasm engine runs.
    //
    // -smp/-m/-drive/-device topology MUST match the capture exactly or the
    // migration stream will not load. Single vCPU: the shared engine's cmpxchg16b
    // path is a stop-the-world under MTTCG, so multi-core made Android pathologically
    // slow; 1 core resumes cleanly. rootfs is a read-only LZ4 SquashFS (format=raw)
    // with the timeout-multiplier prop injected; userdata is the writable ext4 /data
    // captured post-boot. The virtio-net-pci device is REQUIRED on resume (its rom
    // ramblock is in the migration stream) even though the iPad has no host network
    // — a `hubport` null backend satisfies the device without needing host sockets.
    "-nographic", "-cpu", "qemu64,+ssse3,+sse4.1,+sse4.2,+popcnt", "-m", "1280M",
    "-accel", "tcg,tb-size=256", "-smp", "1",
    "-L", "/pack/",
    "-incoming", "file:/pack/vm.state",
    "-drive", "if=virtio,format=raw,readonly=on,file=/pack/rootfs.bin",
    "-drive", "if=virtio,format=qcow2,file=/pack/userdata.qcow2,cache=writeback,discard=unmap",
    "-kernel", "/pack/bzImage",
    "-append", "nohz=on console=ttyS0,115200n8 root=/dev/vda rootwait ro loglevel=6 nowatchdog nosoftlockup audit=0 tsc=reliable no_timer_check cryptomgr.notests random.trust_cpu=on QEMU_MODE=1 init=/sbin/tini -- /bin/busybox env GODEBUG=cpu.all=off /sbin/init",
    "-virtfs", "local,path=/,mount_tag=wasi0,security_model=passthrough,id=wasi0",
    "-virtfs", "local,path=/pack,mount_tag=wasi1,security_model=passthrough,id=wasi1",
    "-netdev", "hubport,id=vmnic,hubid=0",
    "-device", "virtio-net-pci,netdev=vmnic,mac=02:00:00:00:00:01"
]
;
