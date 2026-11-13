#!/bin/bash
# capture-arm.sh: ARM64 Android warm snapshot: fresh userdata-lawn -> capnet + acap-arm -> aprep -> migrate -> pack
export PATH="/Volumes/D/homebrew/bin:/opt/homebrew/bin:$PATH" COLIMA_HOME=/Volumes/D/colima
docker exec qemub sh -c 'pkill -x qemu-system-aar; pkill -x qemu-system-x86; pkill -x capnet; sleep 3; cp /apack-arm/userdata-lawn.qcow2 /apack-arm/userdata.qcow2; rm -f /tmp/vm.state /tmp/mon-arm.sock; cp /qemu/pc-bios/efi-virtio.rom /apack-arm/'
docker exec -d qemub sh -c '/capnet > /tmp/capnet.log 2>&1'; sleep 2
docker exec -d qemub sh -c 'sh /apack-arm/acap-arm.sh > /tmp/aboot-arm.log 2>&1'
docker exec qemub sh -c 'A="adb -s 127.0.0.1:6555"; sleep 30; for i in $(seq 1 150); do adb connect 127.0.0.1:6555 >/dev/null 2>&1; b=$(timeout 8 $A shell getprop sys.boot_completed 2>/dev/null | tr -d "\r"); [ "$b" = 1 ] && break; sleep 8; done; echo boot=$b after $i; sh /aprep.sh 2>&1 | tail -14'
docker exec qemub sh -c 'A="adb -s 127.0.0.1:6555"; for i in $(seq 1 40); do l=$($A shell cat /proc/loadavg | cut -d" " -f1); case "$l" in 0.*) break;; esac; sleep 10; done; echo "load $l"; echo "gpu slots held: $($A shell ls /dev/bbgpu | tr "\n" " ") ; bbgpu warnings: $($A shell logcat -d | grep -c "not protocol")"; $A exec-out screencap -p > /tmp/arm-cap.png 2>/dev/null; adb disconnect >/dev/null 2>&1; adb kill-server >/dev/null 2>&1; sleep 3; T=$(date +%s); echo "migrate -d file:/tmp/vm.state" | socat - unix:/tmp/mon-arm.sock >/dev/null; for i in $(seq 1 200); do s=$(echo "info migrate" | timeout 10 socat - unix:/tmp/mon-arm.sock | grep -a "Migration status"); case "$s" in *completed*|*failed*) break;; esac; sleep 3; done; echo "$s in $(( $(date +%s) - T ))s"; echo quit | timeout 10 socat - unix:/tmp/mon-arm.sock >/dev/null; sleep 3; ls -la /tmp/vm.state'
mkdir -p /Volumes/D/ai_cache/agpu-arm/snap
docker cp qemub:/tmp/arm-cap.png /Volumes/D/ai_cache/agpu-arm/snap/cap.png
docker cp qemub:/tmp/vm.state /Volumes/D/ai_cache/agpu-arm/snap/vm.state && docker cp qemub:/apack-arm/userdata.qcow2 /Volumes/D/ai_cache/agpu-arm/snap/userdata.qcow2 && docker cp qemub:/apack-arm/efi-virtio.rom /Volumes/D/ai_cache/agpu-arm/snap/efi-virtio.rom && echo CAPTURE-DONE
