# Bootbox GPU bridge Gallium driver. SPDX-License-Identifier: MIT
files_bbgpu = files(
  'bbgpu_context.c', 'bbgpu_dev.c', 'bbgpu_glsl.c', 'bbgpu_present.c', 'bbgpu_screen.c',
)
# direct present into X windows needs the xcb headers (the library itself is loaded at run time)
bbgpu_deps = [idep_nir]
bbgpu_args = with_gallium_softpipe ? ['-DGALLIUM_SOFTPIPE'] : []   # software fallback (no device / GPU busy)
if with_platform_x11
  bbgpu_deps += dep_xcb.partial_dependency(compile_args : true, includes : true)
  bbgpu_args += '-DBBGPU_X11'
endif
libbbgpu = static_library(
  'bbgpu',
  files_bbgpu,
  include_directories : [inc_gallium_aux, inc_gallium, inc_include, inc_src, inc_gallium_drivers, inc_mesa, inc_mapi,
                         include_directories('../../frontends/dri')],   # dri_drawable.h (direct present)
  c_args : bbgpu_args,
  gnu_symbol_visibility : 'hidden',
  dependencies : bbgpu_deps,
)
driver_bbgpu = declare_dependency(
  compile_args : '-DGALLIUM_BBGPU',
  link_with : [libbbgpu],
)
