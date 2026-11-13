# mkpack-arm.py : ARM Android pack -> raw-packs/android-arm.data + bootbox-harness/android-arm/load.js
import re, json
src = open('/Volumes/D/ai_cache/bootbox-harness/android-gpu/load.js').read()
A = '/Volumes/D/ai_cache/agpu-arm/'
order = [('/pack/Image', '../armcmp/and/kout/Image-arm64-fast'), ('/pack/efi-virtio.rom', 'agpu-arm/snap/efi-virtio.rom'),
         ('/pack/initrd.gz', 'agpu-arm/build/out/initrd.gz'), ('/pack/rootfs.bin', 'agpu-arm/build/out/rootfs.bin'),
         ('/pack/userdata.qcow2', 'agpu-arm/snap/userdata.qcow2'), ('/pack/vm.state', 'agpu-arm/snap/vm.state')]
off = 0; files = []
with open('/Volumes/D/ai_cache/raw-packs/android-arm.data', 'wb') as out:
    for name, f in order:
        p = '/Volumes/D/ai_cache/' + f.replace('../', '')
        b = open(p, 'rb').read(); out.write(b)
        files.append({"filename": name, "start": off, "end": off + len(b)}); off += len(b)
m = re.search(r'"files": \[.*?\]', src, re.S)
s = src[:m.start()] + '"files": ' + json.dumps(files) + src[m.end():]
s = re.sub(r'"remote_package_size": \d+', '"remote_package_size": %d' % off, s)
open('/Volumes/D/ai_cache/bootbox-harness/android-arm/load.js', 'w').write(s)
print('pack', off)
