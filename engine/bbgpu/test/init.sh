#!/bin/sh
mount -t proc proc /proc; mount -t sysfs sys /sys; mount -t devtmpfs dev /dev 2>/dev/null; mkdir -p /tmp /dev/shm; mount -t tmpfs tmpfs /tmp; mount -t tmpfs tmpfs /dev/shm
export HOME=/root
Xvnc :0 -geometry 1024x768 -depth 24 -SecurityTypes None >/tmp/xvnc.log 2>&1 &
sleep 6
export DISPLAY=:0
echo "== bbgpu"; LIBGL_DRIVERS_PATH=/opt/bbgpu/dri GALLIUM_DRIVER=bbgpu BBGPU_STATS=1 /gltest 40 2>&1
echo "== softpipe (same build, CPU rendering)"; LIBGL_DRIVERS_PATH=/opt/bbgpu/dri GALLIUM_DRIVER=softpipe /gltest 40 2>&1 | grep -E "GL_RENDERER|fps|GLTEST"
echo "INIT-DONE"; poweroff -f
