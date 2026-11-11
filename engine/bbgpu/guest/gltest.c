/* gltest.c - first guest test for the bbgpu Mesa driver: GLX window, clear, a fixed-function triangle,
 * a textured quad, read-back checks, then N frames for a speed figure. SPDX-License-Identifier: MIT */
#include <GL/gl.h>
#include <GL/glx.h>
#include <X11/Xlib.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

static int fails;
static void expect(const char *what, int x, int y, int r, int g, int b)
{
   unsigned char p[4];
   glReadPixels(x, y, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, p);
   int ok = abs(p[0] - r) < 12 && abs(p[1] - g) < 12 && abs(p[2] - b) < 12;   /* 16-bit visuals round */
   printf("  %-34s %3d %3d %3d  %s\n", what, p[0], p[1], p[2], ok ? "ok" : "FAIL");
   fails += !ok;
}
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec * 1e-9; }

int main(int argc, char **argv)
{
   Display *dpy = XOpenDisplay(NULL);
   if (!dpy) { printf("gltest: no X display\n"); return 1; }
   int attr[] = { GLX_RGBA, GLX_DOUBLEBUFFER, GLX_DEPTH_SIZE, 16, None };   /* any colour depth (the desktop is 16-bit) */
   XVisualInfo *vi = glXChooseVisual(dpy, DefaultScreen(dpy), attr);
   if (!vi) { printf("gltest: no visual\n"); return 1; }
   XSetWindowAttributes swa = { .colormap = XCreateColormap(dpy, RootWindow(dpy, vi->screen), vi->visual, AllocNone), .border_pixel = 0 };
   Window w = XCreateWindow(dpy, RootWindow(dpy, vi->screen), 0, 0, 128, 128, 0, vi->depth, InputOutput, vi->visual, CWColormap | CWBorderPixel, &swa);
   XMapWindow(dpy, w);
   GLXContext ctx = glXCreateContext(dpy, vi, NULL, True);
   glXMakeCurrent(dpy, w, ctx);
   printf("GL_RENDERER: %s\nGL_VERSION: %s\n", glGetString(GL_RENDERER), glGetString(GL_VERSION));
   glViewport(0, 0, 128, 128);

   printf("1 clear\n");
   glClearColor(0.0f, 0.0f, 1.0f, 1.0f);
   glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
   expect("clear blue", 64, 64, 0, 0, 255);

   printf("2 fixed-function triangle\n");
   glBegin(GL_TRIANGLES);
   glColor3f(1, 0, 0); glVertex2f(-1, -1);
   glColor3f(1, 0, 0); glVertex2f(1, -1);
   glColor3f(1, 0, 0); glVertex2f(-1, 1);
   glEnd();
   expect("inside triangle (red)", 20, 20, 255, 0, 0);
   expect("outside triangle (blue)", 110, 110, 0, 0, 255);

   printf("3 textured quad\n");
   unsigned char tex[2 * 2 * 4] = { 255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255 };
   GLuint t; glGenTextures(1, &t); glBindTexture(GL_TEXTURE_2D, t);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
   glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
   glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 2, 2, 0, GL_RGBA, GL_UNSIGNED_BYTE, tex);
   glEnable(GL_TEXTURE_2D);
   glColor3f(1, 1, 1);
   glBegin(GL_QUADS);   /* quads: lowered by Mesa's front end (WebGL2 has none) */
   glTexCoord2f(0, 0); glVertex2f(-1, -1); glTexCoord2f(1, 0); glVertex2f(1, -1);
   glTexCoord2f(1, 1); glVertex2f(1, 1); glTexCoord2f(0, 1); glVertex2f(-1, 1);
   glEnd();
   glDisable(GL_TEXTURE_2D);
   expect("bottom-left texel (red)", 16, 16, 255, 0, 0);
   expect("bottom-right texel (green)", 112, 16, 0, 255, 0);
   expect("top-left texel (blue)", 16, 112, 0, 0, 255);
   expect("top-right texel (white)", 112, 112, 255, 255, 255);

   printf("4 depth test\n");
   glEnable(GL_DEPTH_TEST);
   glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
   glBegin(GL_TRIANGLES); glColor3f(0, 1, 0);
   glVertex3f(-1, -1, -0.5f); glVertex3f(3, -1, -0.5f); glVertex3f(-1, 3, -0.5f); glEnd();
   glBegin(GL_TRIANGLES); glColor3f(1, 1, 0);
   glVertex3f(-1, -1, 0.5f); glVertex3f(3, -1, 0.5f); glVertex3f(-1, 3, 0.5f); glEnd();
   glDisable(GL_DEPTH_TEST);
   expect("near green beats later far yellow", 64, 64, 0, 255, 0);

   int frames = argc > 1 ? atoi(argv[1]) : 50;
   double t0 = now();
   for (int i = 0; i < frames; i++) {
      glClearColor((i & 1) ? 0.2f : 0.0f, 0.1f, 0.3f, 1);
      glClear(GL_COLOR_BUFFER_BIT);
      glBegin(GL_TRIANGLES); glColor3f(1, 0.5f, 0); glVertex2f(-0.5f, -0.5f); glVertex2f(0.5f, -0.5f); glVertex2f(0, 0.5f); glEnd();
      glXSwapBuffers(dpy, w);
   }
   glFinish();
   double dt = now() - t0;
   printf("%d frames (128x128, swap = read-back + put image) in %.2f s = %.1f fps\n", frames, dt, frames / dt);
   printf("%s (%d failed)\n", fails ? "GLTEST FAILED" : "GLTEST OK", fails);
   return fails != 0;
}
