#!/bin/bash
# iter.sh : rebuild the bbgpu Mesa driver + Linux QEMU renderer + guest image, boot, run the guest tests
export PATH="/Volumes/D/homebrew/bin:/opt/homebrew/bin:$PATH" COLIMA_HOME=/Volumes/D/colima
E=/Volumes/D/github/iso/engine; G=/Volumes/D/ai_cache/virgl/bbguest
(cd $E && tar -cf - bbgpu | docker exec -i mesab sh -c 'rm -rf /bbgpu && tar -x -C / && rm -rf /bb && mv /bbgpu /bb')
docker exec mesab sh -c 'cd /src/mesa-24.0.9 && sh /bb/mesa/apply.sh /src/mesa-24.0.9 >/dev/null && ninja -C build src/gallium/targets/dri/libgallium_dri.so 2>&1 | grep -E " error|FAILED" | head; cp build/src/gallium/targets/dri/libgallium_dri.so /out/dri/ && cc -O2 -o /out/gltest /bb/guest/gltest.c -lGL -lX11' || exit 1
(cd $E/bbgpu && tar -cf - bbgpu.c bbgpu_proto.h bbgpu_render.c bbgpu_render.h bbgpu_egl.c | docker exec -i qemub tar -x -C /bb)
docker exec qemub sh -c 'cd /qemu && cp /bb/bbgpu.c /bb/bbgpu_proto.h /bb/bbgpu_render.c /bb/bbgpu_render.h /bb/bbgpu_egl.c hw/misc/ && ninja -C build qemu-system-x86_64 2>&1 | grep -E " error|FAILED" | head' || exit 1
cd $G && rm -rf out && docker cp mesab:/out ./out && docker build -q --platform linux/amd64 -t bbguest . >/dev/null || exit 1
cid=$(docker create --platform linux/amd64 bbguest /bin/true)
docker export $cid | docker exec -i qemub sh -c 'rm -rf /g/root /g/guest.img && mkdir -p /g/root && tar -x -C /g/root && mkdir -p /g/root/proc /g/root/sys /g/root/dev /g/root/tmp && mke2fs -q -t ext4 -d /g/root /g/guest.img 3G'
docker rm $cid >/dev/null
docker exec -e BBGPU_TRACE=${BBGPU_TRACE:-0} -e MESA_GLES_VERSION_OVERRIDE=3.0 -e MESA_GLSL_VERSION_OVERRIDE=300 qemub sh -c 'timeout 1500 /qemu/build/qemu-system-x86_64 -m 1G -smp 2 -accel tcg,thread=multi -cpu qemu64,+rdrand -kernel /g/bzImage -append "root=/dev/vda rw console=ttyS0 init=/init.sh loglevel=3" -drive file=/g/guest.img,format=raw,if=virtio,snapshot=on -device bbgpu -nic none -display none -serial stdio -monitor none -L /qemu/pc-bios 2>&1' > $G/run.log 2>&1
grep -vE "^\s*$|memory ordering|strange/hard" $G/run.log | tail -${TAILN:-45}
