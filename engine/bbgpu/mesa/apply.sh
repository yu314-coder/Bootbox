#!/bin/sh
# apply.sh MESA_SRC : add the Bootbox GPU bridge driver (bbgpu) to a Mesa 24.0 tree
set -e
M=$1; H=$(cd "$(dirname "$0")" && pwd)
rm -rf "$M/src/gallium/drivers/bbgpu"; cp -r "$H/bbgpu" "$M/src/gallium/drivers/bbgpu"
cp "$H/../bbgpu_proto.h" "$M/src/gallium/drivers/bbgpu/"
grep -q "'bbgpu'" "$M/meson_options.txt" || sed -i "s/'panfrost', 'iris', 'lima', 'zink', 'd3d12', 'asahi', 'crocus', 'all',/'panfrost', 'iris', 'lima', 'zink', 'd3d12', 'asahi', 'crocus', 'bbgpu', 'all',/" "$M/meson_options.txt"
grep -q "with_gallium_bbgpu" "$M/meson.build" || sed -i "s/^with_gallium_virgl = gallium_drivers.contains('virgl')$/&\nwith_gallium_bbgpu = gallium_drivers.contains('bbgpu')/" "$M/meson.build"
grep -q "drivers/bbgpu" "$M/src/gallium/meson.build" || sed -i "s/^if with_gallium_virgl$/if with_gallium_bbgpu\n  subdir('drivers\/bbgpu')\nelse\n  driver_bbgpu = declare_dependency()\nendif\n&/" "$M/src/gallium/meson.build"
grep -q "driver_bbgpu" "$M/src/gallium/targets/dri/meson.build" || sed -i "s/driver_tegra, driver_i915, driver_svga, driver_virgl,/driver_tegra, driver_i915, driver_svga, driver_virgl, driver_bbgpu,/" "$M/src/gallium/targets/dri/meson.build"
for F in "$M/src/gallium/auxiliary/target-helpers/inline_sw_helper.h" "$M/src/gallium/auxiliary/target-helpers/sw_helper.h"; do
  grep -q "GALLIUM_BBGPU" "$F" && continue
  # include next to the virgl one; create branch before the FIRST softpipe branch (the second is a driver-name list)
  sed -i '0,/^#ifdef GALLIUM_SOFTPIPE$/s||#ifdef GALLIUM_BBGPU\n#include "bbgpu/bbgpu_public.h"\n#endif\n\n#ifdef GALLIUM_SOFTPIPE|' "$F"
  sed -i '0,/^#if defined(GALLIUM_SOFTPIPE)$/s||#if defined(GALLIUM_BBGPU)\n   if (screen == NULL \&\& strcmp(driver, "bbgpu") == 0)\n      screen = bbgpu_create_screen(winsys);\n#endif\n\n#if defined(GALLIUM_SOFTPIPE)|' "$F"
done
# bbgpu is the first automatic choice of the software-driver list (it returns NULL without a device)
for F in "$M/src/gallium/auxiliary/target-helpers/inline_sw_helper.h" "$M/src/gallium/auxiliary/target-helpers/sw_helper.h"; do
  grep -q '"bbgpu"),' "$F" && continue
  sed -i '0,/^      (sw_vk ? "" : debug_get_option("GALLIUM_DRIVER", "")),$/s||&\n#if defined(GALLIUM_BBGPU)\n      (sw_vk ? "" : "bbgpu"),\n#endif|' "$F"
done
F="$M/src/gallium/auxiliary/target-helpers/sw_helper.h"
grep -c "bbgpu" "$M/meson_options.txt" "$M/meson.build" "$M/src/gallium/meson.build" "$M/src/gallium/targets/dri/meson.build" "$F"
