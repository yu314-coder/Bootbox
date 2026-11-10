/* bbgpu_egl.c - native GL context for the bbgpu GPU thread: EGL surfaceless, OpenGL ES 3.0
 * (run with MESA_GLES_VERSION_OVERRIDE=3.0 to keep Mesa at WebGL2's level). SPDX-License-Identifier: MIT */
#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <stdio.h>
int bbgpu_gl_context_init(void)
{
    EGLDisplay d = eglGetPlatformDisplay(EGL_PLATFORM_SURFACELESS_MESA, EGL_DEFAULT_DISPLAY, NULL);
    if (!eglInitialize(d, NULL, NULL)) return -1;
    eglBindAPI(EGL_OPENGL_ES_API);
    EGLint ca[] = { EGL_CONTEXT_MAJOR_VERSION, 3, EGL_CONTEXT_MINOR_VERSION, 0, EGL_NONE };
    EGLContext c = eglCreateContext(d, EGL_NO_CONFIG_KHR, EGL_NO_CONTEXT, ca);
    if (c == EGL_NO_CONTEXT || !eglMakeCurrent(d, EGL_NO_SURFACE, EGL_NO_SURFACE, c)) return -1;
    fprintf(stderr, "bbgpu: GPU thread on GLES 3.0 (EGL surfaceless)\n");
    return 0;
}
