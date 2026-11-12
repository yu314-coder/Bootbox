# Android on the Bootbox GPU bridge (work in progress)

ReDroid 12's own "guest" GPU mode renders with ANGLE over SwiftShader on the emulated CPU (the Android lag).
This directory switches Android to Mesa on the bbgpu bridge when the engine provides the device:

- kernel: `android64-drm.patch` (DRM + VGEM: a DRM node for gralloc gbm), applied after
  `android64-container2wasm.patch`; the container spec gets a `/dev/dri` bind mount (rootfs `oci/spec.json`).
- Mesa 24.0.9 for Android with the bbgpu driver: `engine/bbgpu/mesa/android/Dockerfile` (NDK) replaces
  `/vendor/lib64/{egl/*_mesa.so, dri/libgallium_dri.so, libgbm.so.1}` and adds `libglapi.so`, `libdrm.so`.
- `gpu_config.sh` (replaces ReDroid's `/vendor/bin/gpu_config.sh`): bbgpu device + `/dev/dri/card0` -> Mesa
  (`ro.hardware.egl=mesa`, gralloc gbm on card0, skiagl); otherwise ANGLE/SwiftShader as before.
- `bootbox-gpu.rc` (`/vendor/etc/init/`): `LIBGL_ALWAYS_SOFTWARE=1` (EGL takes the vgem primary node and maps
  "vgem" to kms_swrast, whose first choice is bbgpu), the client-slot lock directory, and SurfaceFlinger client
  composition (`bootbox-sf-gpu.sh`): ReDroid's hwcomposer composes DEVICE layers on the CPU from guest memory
  the GPU never wrote.
- `android-vnc/bootbox_android_vnc.c`: takes gbm buffers too (dma-buf size via lseek, padded rows).
- engine: `-device bbgpu,slots=16,shm-mb=128` (every Android GL process is a client).
