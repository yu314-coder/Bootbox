# Bootbox GPU bridge Gallium driver. SPDX-License-Identifier: MIT
files_bbgpu = files(
  'bbgpu_context.c', 'bbgpu_dev.c', 'bbgpu_glsl.c', 'bbgpu_screen.c',
)
libbbgpu = static_library(
  'bbgpu',
  files_bbgpu,
  include_directories : [inc_gallium_aux, inc_gallium, inc_include, inc_src, inc_gallium_drivers],
  c_args : with_gallium_softpipe ? ['-DGALLIUM_SOFTPIPE'] : [],   # software fallback (no device / GPU busy)
  gnu_symbol_visibility : 'hidden',
  dependencies : idep_nir,
)
driver_bbgpu = declare_dependency(
  compile_args : '-DGALLIUM_BBGPU',
  link_with : [libbbgpu],
)
