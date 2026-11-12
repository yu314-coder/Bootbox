# Mesa 24.0.9 for Android x86-64 (the Bootbox Android guest = redroid 12, which ships Mesa 24.0.8) with the Bootbox
# GPU bridge driver (bbgpu) behind kms_swrast + softpipe, built with the Android NDK like redroid's own Mesa
# (android-stub: libcutils/liblog/libsync/libhardware/libnativewindow are the system's at run time).
# Build from engine/bbgpu:  docker build --platform linux/amd64 -f mesa/android/Dockerfile -t bbgpu-mesa-android:24.0.9 .
FROM debian:bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl unzip xz-utils python3 \
      python3-mako python3-yaml python3-packaging meson ninja-build bison flex pkg-config git file binutils && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /ndk.zip https://dl.google.com/android/repository/android-ndk-r27d-linux.zip && \
    unzip -q /ndk.zip -d / && rm /ndk.zip && mv /android-ndk-r27d /ndk
RUN curl -fsSL -o /mesa.tar.xz https://archive.mesa3d.org/mesa-24.0.9.tar.xz && \
    echo "51aa686ca4060e38711a9e8f60c8f1efaa516baf411946ed7f2c265cd582ca4c  /mesa.tar.xz" | sha256sum -c - && tar -xf /mesa.tar.xz -C / && rm /mesa.tar.xz
COPY mesa/android/android-x86_64.cross /cross
# libdrm for Android (Mesa needs it to build; at run time the system's libdrm.so.2 is used)
RUN printf '#!/bin/sh\nexport PKG_CONFIG_LIBDIR=/deps/lib/pkgconfig PKG_CONFIG_SYSROOT_DIR=\nexec pkg-config "$@"\n' > /usr/local/bin/android-pkg-config && \
    chmod +x /usr/local/bin/android-pkg-config && \
    curl -fsSL -o /drm.tar.xz https://dri.freedesktop.org/libdrm/libdrm-2.4.120.tar.xz && tar -xf /drm.tar.xz -C / && \
    cd /libdrm-2.4.120 && meson setup build --cross-file /cross -Dprefix=/deps -Dintel=disabled -Dradeon=disabled \
      -Damdgpu=disabled -Dnouveau=disabled -Dvmwgfx=disabled -Dfreedreno=disabled -Dvc4=disabled -Detnaviv=disabled \
      -Dexynos=disabled -Domap=disabled -Dtegra=disabled -Dcairo-tests=disabled -Dman-pages=disabled -Dvalgrind=disabled \
      -Dtests=false -Dinstall-test-programs=false -Dudev=false && ninja -C build install && ls /deps/lib /deps/lib/pkgconfig
COPY . /bb
RUN sh /bb/mesa/apply.sh /mesa-24.0.9
RUN cd /mesa-24.0.9 && meson setup build --cross-file /cross -Dprefix=/vendor -Dlibdir=lib64 -Dbuildtype=release \
      -Dplatforms=android -Dplatform-sdk-version=31 -Dandroid-stub=true -Dandroid-libbacktrace=disabled \
      -Dgallium-drivers=swrast,bbgpu -Dvulkan-drivers= -Dllvm=disabled -Dglx=disabled -Degl=enabled \
      -Dgbm=enabled -Dgles1=enabled -Dgles2=enabled -Dshared-glapi=enabled -Dopengl=true -Dxmlconfig=disabled \
      -Dzstd=disabled -Dlibunwind=disabled -Dvalgrind=disabled -Dbuild-tests=false -Dgallium-va=disabled \
      -Dgallium-vdpau=disabled -Dgallium-xa=disabled -Dgallium-nine=false -Dgallium-opencl=disabled \
      -Dvideo-codecs= -Dosmesa=false -Dmicrosoft-clc=disabled -Dintel-clc=disabled -Dexpat=disabled \
      -Dcpp_rtti=false -Degl-lib-suffix=_mesa -Dgles-lib-suffix=_mesa --force-fallback-for=zlib > /meson.log 2>&1 || \
      (tail -60 /meson.log; exit 1)
RUN cd /mesa-24.0.9 && ninja -C build 2>&1 | tail -3 && \
    mkdir -p /out/lib64/egl /out/lib64/dri && \
    cp -L build/src/egl/libEGL_mesa.so /out/lib64/egl/ && \
    cp -L build/src/mapi/es1api/libGLESv1_CM_mesa.so build/src/mapi/es2api/libGLESv2_mesa.so /out/lib64/egl/ && \
    cp -L build/src/mapi/shared-glapi/libglapi.so /out/lib64/ && \
    cp -L build/src/gbm/libgbm_mesa.so /out/lib64/libgbm.so.1 && \
    cp -L /deps/lib/libdrm.so /out/lib64/ && \
    cp -L build/src/gallium/targets/dri/libgallium_dri.so /out/lib64/dri/ && \
    R=/ndk/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf && \
    for f in /out/lib64/dri/*.so /out/lib64/egl/*.so /out/lib64/*.so*; do echo "$f: $($R -d $f | grep -E "NEEDED|SONAME" | sed "s/.*\[//; s/\]//" | tr "\n" " ")"; done && \
    strings /out/lib64/dri/libgallium_dri.so | grep -q "Bootbox GPU (WebGL2)" && echo "BBGPU-ANDROID-OK"
FROM scratch
COPY --from=build /out /out
