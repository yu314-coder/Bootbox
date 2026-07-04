Module['arguments'] =
[
    // Loaded Alpine (python3.12 + pip + wine). Cold-boot (snapshot dropped) like the base Alpine;
    // same arg structure so run.js's RAM / netWs / m:share logic applies. -m is the baked default
    // (run.js overrides). quiet+loglevel=4 = cleaner boot.
    "-nographic", "-m", "256M", "-accel", "tcg,tb-size=192,thread=multi", "-smp", "1,sockets=1",
    "-L", "/pack/",
    "-drive", "if=virtio,format=raw,file=/pack/rootfs.bin",
    "-kernel", "/pack/bzImage",
    "-append", "console=ttyS0,115200n8 root=/dev/vda rootwait acpi=off ro quiet loglevel=4 QEMU_MODE=1 init=/sbin/tini -- /sbin/init",
    "-virtfs", "local,path=/,mount_tag=wasi0,security_model=passthrough,id=wasi0",
    "-virtfs", "local,path=/pack,mount_tag=wasi1,security_model=passthrough,id=wasi1",
    "-nic", "none"
]
;
