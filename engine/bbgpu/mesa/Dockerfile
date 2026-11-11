# Mesa 24.0.9 (the desktop guest's Mesa version) with the Bootbox GPU bridge driver (bbgpu) and llvmpipe:
# a drop-in replacement for the guest's software DRI driver. bbgpu is tried first and steps aside (llvmpipe)
# when there is no bbgpu device, no writable /sys or another program already owns the GPU.
# Build from engine/bbgpu:  docker build --platform linux/amd64 -f mesa/Dockerfile -t bbgpu-mesa:24.0.9 .
FROM alpine:3.20 AS build
RUN apk add --no-cache build-base meson ninja python3 py3-mako py3-packaging py3-yaml bison flex sed curl \
    libdrm-dev libx11-dev libxext-dev libxfixes-dev libxshmfence-dev libxxf86vm-dev libxrandr-dev libxcb-dev \
    libxdamage-dev expat-dev zlib-dev zstd-dev elfutils-dev linux-headers glslang llvm17-dev
RUN curl -fsSL -o /mesa.tar.xz https://archive.mesa3d.org/mesa-24.0.9.tar.xz && \
    echo "51aa686ca4060e38711a9e8f60c8f1efaa516baf411946ed7f2c265cd582ca4c  /mesa.tar.xz" | sha256sum -c - && tar -xf /mesa.tar.xz -C / && rm /mesa.tar.xz
COPY . /bb
RUN sh /bb/mesa/apply.sh /mesa-24.0.9 && cd /mesa-24.0.9 && \
    meson setup build -Dprefix=/usr -Dbuildtype=release -Dgallium-drivers=swrast,bbgpu -Dvulkan-drivers= \
      -Dplatforms=x11 -Dglx=dri -Degl=disabled -Dgbm=disabled -Dllvm=enabled -Dshared-llvm=enabled -Dgles1=disabled \
      -Dgles2=enabled -Dshared-glapi=enabled -Dvalgrind=disabled -Dlibunwind=disabled -Dvideo-codecs= -Dosmesa=false \
      -Dgallium-vdpau=disabled -Dgallium-va=disabled -Dgallium-xa=disabled -Dgallium-nine=false \
      -Dgallium-opencl=disabled -Dmicrosoft-clc=disabled -Dexpat=enabled && \
    ninja -C build src/gallium/targets/dri/libgallium_dri.so && \
    mkdir -p /out/dri && cp build/src/gallium/targets/dri/libgallium_dri.so /out/dri/ && strip /out/dri/libgallium_dri.so && \
    ls -la /out/dri
FROM scratch
COPY --from=build /out /out
