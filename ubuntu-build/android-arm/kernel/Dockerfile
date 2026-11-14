FROM debian:bookworm AS build
RUN apt-get update >/dev/null && apt-get install -y gcc make flex bison bc libssl-dev libelf-dev git ca-certificates >/dev/null
WORKDIR /w
RUN git clone -b v6.1 --depth 1 https://github.com/torvalds/linux
WORKDIR /w/linux
COPY new.config .config
RUN make ARCH=arm64 olddefconfig && grep -E "^CONFIG_(ZRAM|ZSMALLOC|CRYPTO_LZ4|ZRAM_DEF_COMP_LZ4)=|RANDOMIZE_BASE" .config
RUN make ARCH=arm64 -j6 Image && cp arch/arm64/boot/Image /Image && cp .config /final_config
FROM scratch
COPY --from=build /Image /Image
COPY --from=build /final_config /final_config
