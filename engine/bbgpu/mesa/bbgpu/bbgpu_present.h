/* bbgpu_present.h - direct present helpers (bbgpu_present.c). SPDX-License-Identifier: MIT */
#ifndef BBGPU_PRESENT_H
#define BBGPU_PRESENT_H
#include <stdbool.h>
#include <stdint.h>
/* context_private = the frontend's dri_drawable; true = present window *win at screen (*x, *y) */
bool bbgpu_present_where(void *context_private, unsigned w, unsigned h, uint32_t *win, int *x, int *y);
/* forget the colour key on every window (the viewer went away); returns the window ids to remove */
int bbgpu_present_unkey(uint32_t *removed, int max);
#endif
