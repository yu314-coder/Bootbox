Module['arguments'] =
[
    // Full Android 12 AOSP x86_64 — WARM-SNAPSHOT resume. The guest was booted
    // once to a drawn Launcher3 and its RAM+device state captured to
    // /pack/vm.state; -incoming resumes it in ~seconds instead of the multi-minute
    // cold boot (which, under this software emulation, tripped Android's 60s
    // watchdog and crash-looped system_server before System UI ever drew).
    //
    // -smp/-m/-drive topology MUST match the capture exactly or the migration
    // stream will not load. Single vCPU: the shared engine's cmpxchg16b path is a
    // stop-the-world under MTTCG, so multi-core made Android pathologically slow;
    // 1 core resumes cleanly. rootfs is a read-only LZ4 SquashFS (format=raw);
    // userdata is the writable 2 GiB ext4 /data captured post-boot.
    // -icount is REQUIRED on resume: the snapshot was captured with an
    // instruction-counted clock (to dilate guest-time so Android's watchdog / ART
    // 32s thread-suspend timeouts don't fire during the ~9x-slow emulated boot),
    // so the migration stream carries icount vmstate. shift here can be milder
    // than the capture's shift=0 — the guest resumes PAST the boot at an idle
    // launcher, so there's no timeout cascade to guard against on-device.
    "-nographic", "-cpu", "qemu64,+ssse3,+sse4.1,+sse4.2,+popcnt", "-m", "1280M",
    "-accel", "tcg,tb-size=256", "-smp", "1", "-icount", "shift=0",
    "-L", "/pack/",
    "-incoming", "file:/pack/vm.state",
    "-drive", "if=virtio,format=raw,readonly=on,file=/pack/rootfs.bin",
    "-drive", "if=virtio,format=qcow2,file=/pack/userdata.qcow2,cache=writeback,discard=unmap",
    "-kernel", "/pack/bzImage",
    "-append", "nohz=on console=ttyS0,115200n8 root=/dev/vda rootwait ro loglevel=6 nowatchdog nosoftlockup audit=0 tsc=reliable no_timer_check cryptomgr.notests random.trust_cpu=on QEMU_MODE=1 init=/sbin/tini -- /bin/busybox env GODEBUG=cpu.all=off /sbin/init",
    "-virtfs", "local,path=/,mount_tag=wasi0,security_model=passthrough,id=wasi0",
    "-virtfs", "local,path=/pack,mount_tag=wasi1,security_model=passthrough,id=wasi1",
    "-nic", "none"
]
;
