#!/bin/sh
# aboot-arm.sh : cold-boot the ARM64 Android pack natively (aarch64 QEMU + bbgpu renderer on Mesa EGL), adb on :6558
printf 't:%s\nm:share\nn:02:00:00:00:00:01\n' "$(date +%s)" > /apack-arm/info
export MESA_GLES_VERSION_OVERRIDE=3.0 MESA_GLSL_VERSION_OVERRIDE=300
mkdir -p /awasi
exec /qemu/build/qemu-system-aarch64 -nographic -L /apack-arm -M virt -cpu cortex-a76 -m 1280M \
  -accel tcg,tb-size=256,thread=multi -smp 4 \
  -drive if=virtio,format=raw,readonly=on,file=/apack-arm/rootfs.bin \
  -drive if=virtio,format=qcow2,file=/apack-arm/userdata.qcow2,cache=writeback,discard=unmap \
  -kernel /apack-arm/Image -initrd /apack-arm/initrd.gz \
  -append "console=ttyAMA0 loglevel=4 mitigations=off nowatchdog nosoftlockup audit=0 cryptomgr.notests random.trust_cpu=on androidboot.hardware=redroid androidboot.redroid_width=800 androidboot.redroid_height=600 androidboot.redroid_dpi=125 androidboot.redroid_fps=15 androidboot.use_redroid_vnc=1 androidboot.use_redroid_stream=1 androidboot.use_memfd=true androidboot.redroid_gpu_mode=guest androidboot.hw_timeout_multiplier=50 rdinit=/init" \
  -virtfs local,path=/awasi,mount_tag=wasi0,security_model=passthrough,id=wasi0 \
  -virtfs local,path=/apack-arm,mount_tag=wasi1,security_model=passthrough,id=wasi1 \
  -device bbgpu,slots=16,shm-mb=128 \
  -netdev ${NETDEV:-user,id=n0,hostfwd=tcp:127.0.0.1:6558-:5555,hostfwd=tcp:127.0.0.1:6901-:5900} \
  -device virtio-net-pci,netdev=n0,mac=02:00:00:00:00:01 \
  -monitor unix:/tmp/mon-arm.sock,server,nowait
