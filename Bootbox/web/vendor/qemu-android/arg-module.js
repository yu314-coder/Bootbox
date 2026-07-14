Module['arguments'] =
[
    // Full Android 12 AOSP x86_64. The first virtio disk is the immutable
    // container/rootfs; the second is a thin 2 GiB ext4 userdata filesystem
    // stored as qcow2 (small download, normal writable /data inside Android).
    // Four MTTCG vCPUs are the balanced Android default; run.js exposes the
    // same 1–8 core control and caps guest RAM at 1280 MiB for iPad headroom.
    // The Wasm TCG POPCNT operand bug is patched in Bootbox's shared engine.
    // qemu64 plus Android's useful scalar SIMD extensions is measurably faster
    // here than -cpu max: translated AVX paths increase cold-boot time.
    "-nographic", "-cpu", "qemu64,+ssse3,+sse4.1,+sse4.2,+popcnt", "-m", "1280M",
    "-accel", "tcg,tb-size=256,thread=multi", "-smp", "4",
    "-L", "/pack/",
    "-drive", "if=virtio,format=qcow2,readonly=on,file=/pack/rootfs.bin",
    "-drive", "if=virtio,format=qcow2,file=/pack/userdata.qcow2,cache=writeback,discard=unmap",
    "-kernel", "/pack/bzImage",
    // Keep Go-based container2wasm helpers on their generic amd64 routines;
    // Android still sees the SSE4/POPCNT CPU flags above. This avoids a wasm-TCG
    // mis-execution in Go's optional optimized memory path.
    "-append", "nohz=on console=ttyS0,115200n8 root=/dev/vda rootwait ro loglevel=3 nowatchdog nosoftlockup audit=0 tsc=reliable no_timer_check cryptomgr.notests random.trust_cpu=on QEMU_MODE=1 init=/sbin/tini -- /bin/busybox env GODEBUG=cpu.all=off /sbin/init",
    "-virtfs", "local,path=/,mount_tag=wasi0,security_model=passthrough,id=wasi0",
    "-virtfs", "local,path=/pack,mount_tag=wasi1,security_model=passthrough,id=wasi1",
    "-nic", "none"
]
;
