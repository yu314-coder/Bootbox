# Bootbox GPU bridge (bbgpu) - design

Goal: Linux guest OpenGL draws on the iPad GPU. App-Store safe (no JIT, public WebKit APIs only).
The bridge is Bootbox's own code; the guest keeps Mesa's OpenGL front end. No virglrenderer, no virgl
protocol, no ANGLE/MoltenVK of our own (WebKit's WebGL2 already runs on Metal).

```
guest app (OpenGL 2.1 / GLES 2-3)
  -> Mesa GL front end (unchanged, MIT)
  -> bbgpu Gallium driver            [ours]  guest: src/gallium/drivers/bbgpu + winsys
       shaders: NIR -> GLSL ES 3.00   [ours]  translated once per shader, in the guest
  -> command ring + data heap in the bbgpu PCI BAR (guest maps it from userspace: no kernel driver)
  -> bbgpu device in QEMU            [ours]  engine: hw/misc/bbgpu.c
  -> renderer on WebGL2              [ours]  engine: GPU thread with an OffscreenCanvas
  -> WebKit WebGL2 -> Metal -> GPU
```

## Why these choices
- **No kernel driver.** The device exposes one PCI BAR backed by host memory (rings + upload/readback heap).
  The guest driver mmaps `/sys/bus/pci/devices/<bbgpu>/resource2` (root, like the rest of the guest).
  The host reads commands and data straight from that memory: no guest-physical addresses, no DMA.
- **Shaders translated in the guest.** The host only ever sees GLSL ES 3.00 text, so the renderer stays
  small and needs no compiler. Translation runs once per shader on the emulated CPU (cached by hash).
- **Feature level = what WebGL2 can do exactly:** OpenGL 2.1 + GLSL 1.20-1.30 class, GLES 3.0. Nothing is
  emulated on the host that WebGL2 lacks; the driver reports only real capabilities.
- **Fences are completed by the renderer** after it has executed the commands (WebGL fence status
  never changes while a thread does not yield - measured in the P2 prototype).
- **Display, phase 1:** finished frames are read back into the BAR heap and the driver puts them into
  the X window with MIT-SHM (works with today's Xvnc desktop, no app changes). Phase 2: frames go
  straight to the screen canvas (no read-back), together with the display-path work.

## Direct present (display phase 2, Nov 2026)
Read-back was the cost: every frame went GPU -> heap -> guest X image -> Xvnc -> VNC encoder (all on the
emulated CPU) -> noVNC. Now:
- **The viewer is on the GPU.** noVNC's display is `novnc/core/gldisplay.js`: the desktop framebuffer is a
  WebGL2 texture (decoded rectangles uploaded straight from the decoder's arrays, fills = scissored clears,
  copies = blits), drawn as one quad per animation frame. Falls back to the 2D display without WebGL2.
- **GL windows skip X.** The driver finds the X window of the drawable (GLX drisw: `xDrawable` of the loader's
  drawable; EGL x11: `dri2_egl_surface.drawable`, offset 320 in Mesa 24.0 - both verified with the X server
  through xcb, loaded at run time), sets its background to the colour key (red_mask|blue_mask = magenta) and
  sends `PRESENT(win, res, src rect, screen x, y)` per frame - no read-back, no X image.
- **Renderer -> page.** The GPU thread blits the texture into its OffscreenCanvas, takes it out with
  `transferToImageBitmap()` (needs no event-loop turn) and posts it to the page (`{bbgpu:'present'}`); run.js
  hooks every engine worker's messages. The viewer draws the frame wherever the desktop shows the key, so
  menus and windows on top stay correct. Frames are acknowledged when shown: at most two in flight, a newer
  frame is held in a copy and re-offered (the app is never blocked by the display rate).
- **Register `PRESENT` (0x30)** = 1 while a viewer composites (the page writes `bbgpu_host[0]` in shared
  memory); when the viewer goes away the driver removes the key and reads frames back again.
Mac (Chrome): glmark2 build 400x300 24 fps (read-back) -> 230-260 fps, guest CPU ~9%.

## Protocol (v1)
BAR layout: `[0, 4 KB)` registers + ring indices, `[4 KB, 4 MB)` command ring, `[4 MB, BAR end)` heap.
Doorbell = 32-bit write to register `KICK` (QEMU MMIO callback wakes the GPU thread).
Every command: `u32 op, u32 dwords` then payload (little endian, 4-byte aligned). Objects are named by
32-bit ids the guest allocates. Bulk data lives in the heap; commands carry `heap_off, size`.

| op | payload |
|---|---|
| RES_CREATE | id, target, format, width, height, depth, levels, bind |
| RES_DESTROY | id |
| RES_WRITE | id, level, box(x,y,z,w,h,d), heap_off, stride, layer_stride |
| RES_READ | id, level, box, heap_off, stride, fence (renderer writes pixels then completes fence) |
| SHADER_CREATE | id, stage, heap_off, len (GLSL ES 3.00 source), attribute/varying/sampler map |
| PROGRAM_CREATE | id, vs, fs (+ bindings) |
| STATE_* | blend, depth/stencil, rasterizer, sampler, vertex elements (Gallium CSOs, flattened) |
| BIND_* | framebuffer (cbufs, zsbuf), viewport, scissor, vertex buffers, index buffer, textures, uniforms |
| CLEAR | buffers, color, depth, stencil |
| DRAW | mode, start, count, index_size, instance_count, index_bias |
| BLIT / COPY | src, dst, boxes, filter |
| FENCE | id (renderer writes `completed = id` in the registers after executing everything before it) |

Versioned by a `PROTO_VERSION` register; caps (formats, limits) are read from a caps block in the BAR.

## Phases
1. **Transport** - bbgpu QEMU device (native QEMU first, then the wasm engine), a guest test tool that maps
   the BAR, writes commands and waits for a fence; host side counts and echoes.
2. **Renderer core** - resources, uploads, framebuffer, clear, read-back, on GLES 3.0 (native test: Mesa
   llvmpipe in a Linux container with GLES 3.0 forced, so WebGL2 limits show up early).
3. **Guest driver** - bbgpu Gallium driver + sw-winsys display target in Mesa 24 (Alpine), NIR -> GLSL ES.
   First target: glxgears / glmark2 `build` and `texture` scenes.
4. **Engine** - device + renderer in the wasm engine; WebGL2 on a GPU thread; harness + WebKit test.
5. **Display phase 2** (direct present, done), iPad tuning, shader cache, more of GL, several GL clients.

If Mesa's Gallium interface turns out to be the obstacle (size, guest CPU cost of its front end), the
fallback is a fully original guest GL library speaking the same protocol.
