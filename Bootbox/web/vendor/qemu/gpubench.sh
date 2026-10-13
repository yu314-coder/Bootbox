#!/bin/sh
# gpubench - glmark2, the standard open-source OpenGL benchmark, inside the 64-bit guest.
# Bootbox guests have no GPU: OpenGL is rendered by Mesa in SOFTWARE on the EMULATED CPU, so this
# measures the whole stack (engine speed x cores x Mesa), which is exactly what a desktop app sees.
# Pushed into the guest via the 9p /share bridge at button-press (no rootfs rebuild).
#   sh /share/gpubench.sh            -> 2 short scenes (clear + build), 320x240, llvmpipe
#   sh /share/gpubench.sh full       -> the whole default glmark2 suite (very long under emulation)
#   GPU=softpipe sh /share/gpubench.sh -> Mesa's non-JIT rasterizer instead of llvmpipe
# Why EGL (glmark2-es2) and not GLX (glmark2): this Xvnc has no DRI and refuses indirect GLX, so
# every GLX context fails ("GLX version >= 1.3 is required"); Mesa's EGL x11 swrast path just
# XPutImage()s finished frames and works on any X server.
export LIBGL_ALWAYS_SOFTWARE=1 GALLIUM_DRIVER="${GPU:-llvmpipe}"
# llvmpipe rasterizes with one thread per guest core: that's where multi-core shows up in graphics.
LP_NUM_THREADS=$(nproc); export LP_NUM_THREADS

# The rootfs ships Mesa's GL loader (a wine/tigervnc dep) but NOT the gallium drivers or GLES:
# without swrast_dri.so (Alpine: /usr/lib/xorg/modules/dri/) every context fails (eglInitialize 0x3001). mesa-dri-gallium pulls
# llvm17-libs: ~64 MB download, several minutes to unpack under emulation - kept out of the
# rootfs on purpose, installed on first use (once per boot; the rootfs is fresh each boot).
# ONE apk call: every --no-cache call re-downloads and parses the package indexes, which takes
# minutes under emulation. glmark2 exists only in Alpine edge/testing; its deps are in the rootfs.
if ! ls /usr/lib/xorg/modules/dri/swrast_dri.so /usr/lib/libGLESv2.so.2 >/dev/null 2>&1 || ! command -v glmark2-es2 >/dev/null 2>&1; then
  echo "installing Mesa software GL (llvmpipe + GLES) + glmark2, ~65 MB - several minutes, needs internet..."
  apk add --no-cache --repository https://dl-cdn.alpinelinux.org/alpine/edge/testing \
      mesa-dri-gallium mesa-gles glmark2 >/tmp/apk-gpu.log 2>&1 ||
    { echo "install failed:"; tail -3 /tmp/apk-gpu.log; echo "GPUBENCH-DONE"; exit 1; }
fi

# glmark2 renders on its OWN X server (display :1), not the desktop's :0. The boot-time Xvnc can stall
# frame presentation (glmark2 then hangs at 0% CPU, and Xvnc can also wedge after a Wine/CPU-Z run);
# a private, freshly started server is reliable and leaves the user's desktop alone.
pkill -f "Xvnc :1 " 2>/dev/null
(Xvnc :1 -geometry 640x480 -depth 24 -SecurityTypes None -rfbport 5901 -localhost yes \
      -desktop gpubench >/tmp/xvnc-gpubench.log 2>&1 &)
for i in 1 2 3 4 5 6 7 8 9 10; do timeout 5 xwininfo -display :1 -root >/dev/null 2>&1 && break; sleep 1; done
export DISPLAY=:1
trap 'pkill -f "Xvnc :1 " 2>/dev/null' EXIT

# alpha=0: glmark2's default alpha=1 matches no EGL config on Xvnc's alpha-less visuals.
VIS="red=1:green=1:blue=1:alpha=0:depth=1:stencil=0"
echo "=== glmark2-es2 - software OpenGL ES (Mesa $GALLIUM_DRIVER, $LP_NUM_THREADS render threads) ==="
echo "the first frame of each scene compiles its shaders on the emulated CPU, so expect minutes."
START=$(date +%s)
if [ "$1" = "full" ]; then
  glmark2-es2 --visual-config "$VIS" --size 320x240
else
  # Printed straight to the terminal (piping glmark2 block-buffers its output until exit).
  glmark2-es2 --visual-config "$VIS" --size 320x240 -b clear:duration=5 -b build:use-vbo=true:duration=5
fi
echo "(took $(( $(date +%s) - START ))s)"
echo "GPUBENCH-DONE"
