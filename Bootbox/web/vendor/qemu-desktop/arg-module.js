Module['arguments'] =
[
    // Desktop guest — SAME ACPI kernel as the console guest (c2w lowpower branch). MULTI-CORE
    // (build 75): was "-smp 1,sockets=1" + "acpi=off", which forced the SeaBIOS MP-table path
    // (only 1 CPU under wasm) so the toolbar cores selector was IGNORED → desktop stuck at 1 core.
    // Now -smp 2 (run.js overrides from the toolbar, up to 8) + NO acpi=off, so ACPI's MADT is
    // read = REAL multi-core, exactly like the console guest. Plus the console's boot-work cuts
    // (tickless, no watchdog, tsc=reliable, skip crypto self-tests) — the desktop "optimize" pass.
    // tb-size 256 to match the console (GUI apps have a bigger working set than the old default).
    "-nographic", "-m", "256M", "-accel", "tcg,tb-size=256,thread=multi", "-smp", "2",
    "-L", "/pack/",
    "-drive", "if=virtio,format=raw,file=/pack/rootfs.bin",
    "-kernel", "/pack/bzImage",
    "-append", "nohz=on console=ttyS0,115200n8 root=/dev/vda rootwait ro quiet loglevel=4 nowatchdog nosoftlockup audit=0 tsc=reliable no_timer_check cryptomgr.notests random.trust_cpu=on QEMU_MODE=1 init=/sbin/tini -- /sbin/init",
    "-virtfs", "local,path=/,mount_tag=wasi0,security_model=passthrough,id=wasi0",
    "-virtfs", "local,path=/pack,mount_tag=wasi1,security_model=passthrough,id=wasi1",
    "-nic", "none"
]
;
