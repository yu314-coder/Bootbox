#!/bin/sh
mount -t proc proc /proc; mount -t sysfs sys /sys; mount -t devtmpfs dev /dev 2>/dev/null; mkdir -p /tmp /dev/shm; mount -t tmpfs tmpfs /tmp; mount -t tmpfs tmpfs /dev/shm
export HOME=/root
Xvnc :0 -geometry 1024x768 -depth 24 -SecurityTypes None >/tmp/xvnc.log 2>&1 &
sleep 6
export DISPLAY=:0
echo "== bbgpu"; LIBGL_DRIVERS_PATH=/opt/bbgpu/dri GALLIUM_DRIVER=bbgpu BBGPU_STATS=1 /gltest 40 2>&1
echo "== softpipe (same build, CPU rendering)"; LIBGL_DRIVERS_PATH=/opt/bbgpu/dri GALLIUM_DRIVER=softpipe /gltest 40 2>&1 | grep -E "GL_RENDERER|fps|GLTEST"
echo "== glmark2 on bbgpu"
LIBGL_DRIVERS_PATH=/opt/bbgpu/dri GALLIUM_DRIVER=bbgpu timeout 400 glmark2 -s 400x300 -b build:duration=6 -b texture:duration=6 -b shading:shading=phong:duration=6 -b bump:duration=6 -b effect2d:duration=6 > /tmp/gm.log 2>&1; grep -E "GL_|FPS|Score" /tmp/gm.log | head -12; grep -E "SHADER_CREATE|CHANGED|compile failed" /tmp/gm.log | head -12
echo "== glmark2 --validate on bbgpu"
LIBGL_DRIVERS_PATH=/opt/bbgpu/dri GALLIUM_DRIVER=bbgpu timeout 600 glmark2 --validate 2>&1 | grep -E "Validation|\]" | head -40
echo "== glmark2 on softpipe (guest CPU)"
LIBGL_DRIVERS_PATH=/opt/bbgpu/dri GALLIUM_DRIVER=softpipe timeout 400 glmark2 -s 400x300 -b build:duration=6 -b texture:duration=6 -b shading:shading=phong:duration=6 -b bump:duration=6 -b effect2d:duration=6 2>&1 | grep -E "FPS|Score"
echo "INIT-DONE"; poweroff -f
