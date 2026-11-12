/* bbgpu_present.c - direct present: instead of reading every frame back into the guest and drawing it
 * through X (and through the VNC encoder after that), the host viewer draws the window itself.
 *
 * The guest side only has to say WHERE: the window's X id is found from the drawable the loader hands us
 * (GLX drisw and EGL x11 swrast keep it at known offsets; both are verified with the X server), its
 * background is set to the colour key (pure red + pure blue = the visual's red_mask | blue_mask), and every
 * frame sends BBGPU_OP_PRESENT with the window's screen position. The viewer shows the GPU frame only where
 * the screen shows the key, so menus, other windows and the desktop on top of it stay correct.
 *
 * xcb is loaded at run time (no new link dependency for the driver; no Xlib error handler is touched).
 * Anything unexpected = 0 = the caller reads the frame back as before. SPDX-License-Identifier: MIT */
#ifdef BBGPU_X11
#include <dlfcn.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <xcb/xcb.h>
#include "pipe/p_context.h"
#include "dri_drawable.h"
#include "bbgpu_present.h"

static struct {
   int tried, ok;
   xcb_connection_t *c;
   xcb_window_t root;
   __typeof__(&xcb_connect) connect;
   __typeof__(&xcb_connection_has_error) has_error;
   __typeof__(&xcb_get_setup) get_setup;
   __typeof__(&xcb_setup_roots_iterator) roots;
   __typeof__(&xcb_get_geometry) geom;
   __typeof__(&xcb_get_geometry_reply) geom_reply;
   __typeof__(&xcb_translate_coordinates) translate;
   __typeof__(&xcb_translate_coordinates_reply) translate_reply;
   __typeof__(&xcb_change_window_attributes) change_attrs;
   __typeof__(&xcb_clear_area) clear_area;
   __typeof__(&xcb_flush) flush;
} X;

static bool x_open(void)
{
   if (X.tried)
      return X.ok;
   X.tried = 1;
   if (getenv("BBGPU_NO_PRESENT"))
      return false;
   void *h = dlopen("libxcb.so.1", RTLD_NOW | RTLD_LOCAL);
   if (!h)
      return false;
#define S(f, n) if (!(X.f = (__typeof__(X.f))dlsym(h, n))) return false
   S(connect, "xcb_connect"); S(has_error, "xcb_connection_has_error"); S(get_setup, "xcb_get_setup");
   S(roots, "xcb_setup_roots_iterator"); S(geom, "xcb_get_geometry"); S(geom_reply, "xcb_get_geometry_reply");
   S(translate, "xcb_translate_coordinates"); S(translate_reply, "xcb_translate_coordinates_reply");
   S(change_attrs, "xcb_change_window_attributes"); S(clear_area, "xcb_clear_area"); S(flush, "xcb_flush");
#undef S
   int screen = 0;
   X.c = X.connect(NULL, &screen);
   if (!X.c || X.has_error(X.c))
      return false;
   xcb_screen_iterator_t it = X.roots(X.get_setup(X.c));
   if (screen != 0 || !it.rem)            /* Xvnc has one screen */
      return false;
   X.root = it.data->root;
   X.ok = 1;
   return true;
}

/* the window's depth, size and screen position; false if `win` is not a window of that size */
static bool window_at(uint32_t win, unsigned w, unsigned h, uint8_t *depth, int *x, int *y)
{
   xcb_generic_error_t *e = NULL;
   xcb_get_geometry_reply_t *g = X.geom_reply(X.c, X.geom(X.c, win), &e);
   free(e);
   if (!g)
      return false;
   bool ok = g->width == w && g->height == h;
   *depth = g->depth;
   free(g);
   if (!ok)
      return false;
   e = NULL;
   xcb_translate_coordinates_reply_t *t = X.translate_reply(X.c, X.translate(X.c, win, X.root, 0, 0), &e);
   free(e);
   if (!t)
      return false;                       /* a pixmap: no position */
   *x = t->dst_x; *y = t->dst_y;
   free(t);
   return true;
}

/* EGL (x11 swrast): struct dri2_egl_surface keeps the xcb window after _EGLSurface + __DRIdrawable * +
 * __DRIbuffer[5] + bool (Mesa 24.0, x86-64); measured with the Mesa headers, see BBGPU_EGL_XID_OFF */
#ifndef BBGPU_EGL_XID_OFF
#define BBGPU_EGL_XID_OFF 320
#endif

static uint32_t find_window(struct dri_drawable *dd, unsigned w, unsigned h)
{
   const uint8_t *lp = dd ? dd->loaderPrivate : NULL;
   uint8_t depth; int x, y;
   if (!lp)
      return 0;
   /* GLX drisw: struct drisw_drawable { __GLXDRIdrawable base { destroy fn; XID xDrawable; ... } } */
   uint64_t xid64;
   memcpy(&xid64, lp + sizeof(void *), sizeof xid64);
   if (xid64 && xid64 < 0x20000000u && window_at((uint32_t)xid64, w, h, &depth, &x, &y))
      return (uint32_t)xid64;
   if (BBGPU_EGL_XID_OFF) {
      uint32_t xid;
      memcpy(&xid, lp + BBGPU_EGL_XID_OFF, 4);
      if (xid && xid < 0x20000000u && window_at(xid, w, h, &depth, &x, &y))
         return xid;
   }
   return 0;
}

#define MAXWIN 16
static struct { void *dd; uint32_t xid; unsigned w, h; bool keyed; } wins[MAXWIN];

static int slot_for(void *dd, unsigned w, unsigned h)
{
   int free_slot = -1;
   for (int i = 0; i < MAXWIN; i++) {
      if (wins[i].dd == dd && wins[i].w == w && wins[i].h == h)
         return i;
      if (wins[i].dd == dd || (!wins[i].dd && free_slot < 0))
         free_slot = i;
   }
   if (free_slot < 0)
      free_slot = 0;
   uint32_t xid = find_window(dd, w, h);
   wins[free_slot].dd = xid ? dd : NULL;
   wins[free_slot].xid = xid;
   wins[free_slot].w = w; wins[free_slot].h = h;
   wins[free_slot].keyed = false;
   return xid ? free_slot : -1;
}

static void set_key(uint32_t xid, uint8_t depth, bool on)
{
   /* TrueColor with the usual masks: red|blue at full intensity */
   uint32_t v = on ? (depth == 16 ? 0xf81fu : depth == 15 ? 0x7c1fu : 0xff00ffu) : XCB_BACK_PIXMAP_NONE;
   X.change_attrs(X.c, xid, on ? XCB_CW_BACK_PIXEL : XCB_CW_BACK_PIXMAP, &v);
   if (on)
      X.clear_area(X.c, 0, xid, 0, 0, 0, 0);
   X.flush(X.c);
}

bool bbgpu_present_where(void *context_private, unsigned w, unsigned h, uint32_t *win, int *x, int *y)
{
   if (!x_open())
      return false;
   int i = slot_for(context_private, w, h);
   uint8_t depth;
   if (i < 0)
      return false;
   if (!window_at(wins[i].xid, w, h, &depth, x, y)) {   /* gone or resized under us: find it again */
      wins[i].dd = NULL;
      return false;
   }
   if (!wins[i].keyed) {
      set_key(wins[i].xid, depth, true);
      wins[i].keyed = true;
   }
   *win = wins[i].xid;
   return true;
}

/* the viewer stopped presenting: the windows go back to frames drawn through X */
int bbgpu_present_unkey(uint32_t *removed, int max)
{
   int n = 0;
   for (int i = 0; i < MAXWIN; i++) {
      if (!wins[i].dd || !wins[i].keyed)
         continue;
      wins[i].keyed = false;
      if (X.ok) {
         uint32_t v = XCB_BACK_PIXMAP_NONE;
         X.change_attrs(X.c, wins[i].xid, XCB_CW_BACK_PIXMAP, &v);
      }
      if (n < max)
         removed[n++] = wins[i].xid;
   }
   if (X.ok)
      X.flush(X.c);
   return n;
}

#else  /* no X11 (Android): windows are presented by the platform's own path */
#include "bbgpu_present.h"
bool bbgpu_present_where(void *context_private, unsigned w, unsigned h, uint32_t *win, int *x, int *y)
{
   (void)context_private; (void)w; (void)h; (void)win; (void)x; (void)y;
   return false;
}
int bbgpu_present_unkey(uint32_t *removed, int max) { (void)removed; (void)max; return 0; }
#endif
