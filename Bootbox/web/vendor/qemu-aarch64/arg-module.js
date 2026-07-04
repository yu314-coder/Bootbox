Module['arguments'] =
[
    // REAL DUAL-CORE (Mac-verified 2026-07-03): -smp 2 gives nproc=2 with genuine parallel
    // execution (/proc/stat: both cpus accumulate user ticks under load). Works on ARM because
    // secondary-CPU wake-up is PSCI (handled inside QEMU) — unlike x86, where SeaBIOS's SIPI
    // AP-wake race under wasm leaves the 2nd vCPU out of the MP table (thread exists, unused).
    "-cpu", "cortex-a53", "-machine", "virt",
    "-bios", "/pack/edk2-aarch64-code.fd",
    "-nographic", "-m", "128M", "-accel", "tcg,tb-size=500,thread=multi", "-smp", "2,sockets=1",
    "-L", "/pack/",
    "-drive", "if=virtio,format=raw,file=/pack/rootfs.bin",
    "-kernel", "/pack/bzImage",
    "-append", "earlyprintk=ttyS0 console=ttyS0 root=/dev/vda rootwait no_console_suspend ro loglevel=0 QEMU_MODE=1 init=/sbin/tini -- /sbin/init",
    "-virtfs", "local,path=/,mount_tag=wasi0,security_model=passthrough,id=wasi0",
    "-virtfs", "local,path=/pack,mount_tag=wasi1,security_model=passthrough,id=wasi1",
    "-netdev", "socket,id=vmnic,connect=127.0.0.1:8888", "-device", "virtio-net-pci,netdev=vmnic"
]
;
