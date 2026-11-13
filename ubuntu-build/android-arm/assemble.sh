#!/bin/sh
# runs in an arm64 alpine container: /in has init, overlay/, zygote rc, vncserver, mesa/ ; writes /out/{rootfs.bin,initrd.gz,userdata.img}
set -e
apk add -q squashfs-tools e2fsprogs busybox-static cpio >/dev/null
R=/r; mkdir -p $R && tar -C $R -xf /in/redroid.tar 2>/dev/null
cp -a /in/overlay/vendor/. $R/vendor/
cp /in/mesa/lib64/egl/*.so $R/vendor/lib64/egl/; cp /in/mesa/lib64/dri/libgallium_dri.so $R/vendor/lib64/dri/
cp /in/mesa/lib64/libglapi.so /in/mesa/lib64/libdrm.so $R/vendor/lib64/; cp /in/mesa/lib64/libgbm.so.1 $R/vendor/lib64/libgbm.so.1
cp /in/vncserver $R/vendor/bin/vncserver; cp /in/init.zygote64.rc $R/system/etc/init/hw/init.zygote64.rc
# the display bridge starts before ro.boot.redroid_* are readable on this boot path: give it the size itself
printf 'service vendor.vncserver /vendor/bin/vncserver\n    disabled\n    setenv BOOTBOX_ANDROID_WIDTH 800\n    setenv BOOTBOX_ANDROID_HEIGHT 600\n\non property:ro.boot.use_redroid_stream=1 && property:ro.boot.use_redroid_vnc=1\n    start vendor.vncserver\n' > $R/vendor/etc/init/vncserver.rc
for f in system/build.prop vendor/build.prop; do printf '\n# Bootbox: slow-host timeout scaling\nro.hw_timeout_multiplier=50\n' >> $R/$f; done
chmod 644 $R/vendor/etc/init/bootbox-gpu.rc $R/vendor/lib64/*.so* $R/vendor/lib64/dri/*.so $R/vendor/lib64/egl/*.so
chmod 755 $R/vendor/bin/gpu_config.sh $R/vendor/bin/bootbox-sf-gpu.sh $R/vendor/bin/vncserver
mkdir -p /out; mksquashfs $R /out/rootfs.bin -comp lz4 -Xhc -b 262144 -noappend -quiet
I=/i; mkdir -p $I/bin $I/proc $I/sys $I/dev; cp /bin/busybox.static $I/bin/busybox; cp /in/init $I/init; chmod 755 $I/init
(cd $I && find . | cpio -o -H newc 2>/dev/null | gzip -9 > /out/initrd.gz)
mkfs.ext4 -q -L userdata -O ^metadata_csum /out/userdata.img 2048M
ls -la /out
