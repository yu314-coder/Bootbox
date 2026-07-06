Module['arguments'] =
[
    // Loaded Alpine (python3.12 + pip + wine). Cold-boot (snapshot dropped) like the base Alpine;
    // same arg structure so run.js's RAM / netWs / m:share logic applies. -m is the baked default
    // (run.js overrides). quiet+loglevel=4 = cleaner boot.
    // PERF NOTES (A/B-measured on the Mac harness 2026-06-29, keep honest):
    //  • ⭐ -smp 2 + ACPI kernel (2026-07-04) = REAL DUAL-CORE (nproc=2). The kernel is built with
    //    CONFIG_ACPI=y (c2w fork yu314-coder/container2wasm@acpi-smp) and reads QEMU's MADT; do NOT
    //    re-add acpi=off (it would drop back to the SeaBIOS MP-table path, which under wasm lists
    //    only 1 CPU — prebuilt-BIOS cross-thread bitmap bug). Engine unchanged (md5-same wasm).
    //  • tb-size 256 (build 71): re-raised from 192 FOR WINE — its PE working set (dozens of
    //    DLLs) is far bigger than python's, and 192 caused retranslation churn on app loads.
    //    The old "within noise" verdict was measured on flask imports, pre-wine. The 3392MB
    //    heap (build 70) has room: ~943 data + 1536 RAM + 256 tb + overhead ≈ 2.9GB.
    //  • mitigations=off is a NO-OP here (the emulated CPU reports "Not affected" → KPTI etc. never on).
    //  • KEPT (free, real boot-work cuts that scale on the ~15× slower iPad): cryptomgr.notests (skip
    //    boot crypto self-tests), nowatchdog/nosoftlockup (no periodic watchdog hrtimers), audit=0,
    //    tsc=reliable + no_timer_check (skip clocksource watchdog/checks), random.trust_cpu=on.
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
