#!/system/bin/sh
# Bootbox: GPU mode by device. The Bootbox GPU bridge (PCI 0xbb0b) + a DRM node (vgem) -> Mesa on the bridge
# ("host" mode: gralloc gbm allocates on the DRM node, Mesa renders on the iPad's GPU through bbgpu);
# otherwise ANGLE over SwiftShader on the CPU (redroid's guest mode).
bbgpu=
for d in /sys/bus/pci/devices/*; do
    [ "$(cat $d/vendor 2>/dev/null)" = "0xbb0b" ] && bbgpu=$d
done
node=/dev/dri/card0
if [ -n "$bbgpu" ] && [ -e "$node" ]; then
    echo "bootbox: GPU bridge at $bbgpu, DRM node $node"
    chmod 0666 $bbgpu/resource0 $bbgpu/resource2 "$node"
    chmod 0777 /dev/bbgpu
    setprop gralloc.gbm.device "$node"
    setprop ro.hardware.egl mesa
    setprop ro.hardware.gralloc gbm
    setprop debug.hwui.renderer skiagl
else
    echo "bootbox: no GPU bridge - software rendering (ANGLE/SwiftShader)"
    setprop ro.hardware.egl angle
    setprop ro.hardware.gralloc redroid
    setprop ro.hardware.vulkan pastel
fi

# Bootbox direct touch: the engine's virtio-multitouch device (input from the viewer, no VNC hop). Android's
# init has no ueventd here, so the kernel's event node never appears in /dev/input: create it - world-open at
# creation, because EventHub opens a new node at once and never retries (then tightened to the input group).
for e in /sys/class/input/event*; do
    n=${e##*/}
    case "$(cat $e/device/name 2>/dev/null)" in *Virtio*) ;; *) continue ;; esac
    [ -e /dev/input/$n ] && continue
    IFS=: read ma mi < $e/dev
    mkdir -p /dev/input
    mknod -m 666 /dev/input/$n c $ma $mi && chown root:input /dev/input/$n && chmod 660 /dev/input/$n
done
