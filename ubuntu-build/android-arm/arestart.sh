#!/bin/sh
# arestart.sh [script]: restart the ARM QEMU (aboot-arm.sh), wait for boot_completed on :6558
pkill -x qemu-system-aar; while ps -eo stat,comm | grep -v "^Z" | grep -q qemu-system-aar; do sleep 1; done
sh /apack-arm/${1:-aboot-arm.sh} > /tmp/aboot-arm.log 2>&1 &
sleep 20; A="adb -s 127.0.0.1:6558"
for i in $(seq 1 150); do adb connect 127.0.0.1:6558 >/dev/null 2>&1; b=$(timeout 8 $A shell getprop sys.boot_completed 2>/dev/null | tr -d "\r"); [ "$b" = 1 ] && break; sleep 4; done
echo "boot=$b after $((20+i*4))s+"
