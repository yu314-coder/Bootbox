FROM ubuntu:22.04 AS build
RUN apt-get update && apt-get install -y gcc-x86-64-linux-gnu git make gperf flex bison bc libelf-dev libssl-dev >/dev/null
WORKDIR /w
RUN git clone -b v6.1 --depth 1 https://github.com/torvalds/linux
WORKDIR /w/linux
COPY new_config .config
RUN make ARCH=x86 CROSS_COMPILE=x86_64-linux-gnu- olddefconfig && grep -E "CONFIG_(DRM|DRM_VIRTIO_GPU|INPUT_EVDEV|VIRTIO_INPUT)=" .config
RUN make ARCH=x86 CROSS_COMPILE=x86_64-linux-gnu- -j8 bzImage && cp arch/x86/boot/bzImage /bzImage && cp .config /final_config
FROM scratch
COPY --from=build /bzImage /bzImage
COPY --from=build /final_config /final_config
