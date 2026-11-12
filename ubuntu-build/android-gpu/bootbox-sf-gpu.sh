#!/system/bin/sh
# GPU mode: SurfaceFlinger composites every layer on the GPU (client composition) - the app buffers live in
# GPU textures, ReDroid's hwcomposer would otherwise compose them on the CPU from memory the GPU never wrote.
# Run when SurfaceFlinger starts and again when the boot completes (a call during SurfaceFlinger's start-up
# can be lost); each call is followed by a repaint so the setting takes effect at once.
for i in $(seq 1 120); do
    service check SurfaceFlinger | grep -q "found" && break
    sleep 0.5
done
service call SurfaceFlinger 1008 i32 1 >/dev/null
service call SurfaceFlinger 1004 >/dev/null 2>&1   # repaint
