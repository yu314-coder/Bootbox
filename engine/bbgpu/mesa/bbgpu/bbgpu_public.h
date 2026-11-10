/* bbgpu_public.h - Bootbox GPU bridge Gallium driver entry point. SPDX-License-Identifier: MIT */
#ifndef BBGPU_PUBLIC_H
#define BBGPU_PUBLIC_H
struct pipe_screen;
struct sw_winsys;
struct pipe_screen *bbgpu_create_screen(struct sw_winsys *winsys);
#endif
