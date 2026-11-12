#!/system/bin/sh
# GPU mode: SurfaceFlinger composites every layer on the GPU (client composition) - the app buffers live in
# GPU textures, ReDroid's hwcomposer would otherwise compose them on the CPU from memory the GPU never wrote.
for i in $(seq 1 120); do
    service check SurfaceFlinger | grep -q "found" && break
    sleep 0.5
done
service call SurfaceFlinger 1008 i32 1 >/dev/null
