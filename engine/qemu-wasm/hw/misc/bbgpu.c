/*
 * bbgpu.c - Bootbox GPU bridge device (QEMU side), protocol v1, phase 1 (transport).
 *
 * PCI device with two BARs:
 *   BAR0  4 KB MMIO registers (see BBGPU_REG_*), KICK is the doorbell
 *   BAR2  host RAM shared with the guest: [0, RING) command ring, [RING, size) data heap
 * The guest maps both from userspace (/sys/bus/pci/devices/.../resource0, resource2) - no kernel driver.
 *
 * Phase 1 executes the transport ops (NOP, ECHO, FENCE) on the main loop when the guest kicks.
 * The renderer (phase 2+) replaces bbgpu_execute() and runs on a GPU thread.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later  (it links into QEMU)
 */
#include "qemu/osdep.h"
#include "qemu/module.h"
#include "qemu/units.h"
#include "qapi/error.h"
#include "hw/pci/pci_device.h"
#include "hw/qdev-properties.h"
#include "qom/object.h"
#include "qemu/thread.h"
#include "migration/register.h"
#include "migration/qemu-file-types.h"
#include "migration/vmstate.h"
#include "qemu/error-report.h"
#include "bbgpu_proto.h"
#ifdef BBGPU_RENDER
#include "bbgpu_render.h"
/* the embedder provides the GL context for the GPU thread (native: EGL surfaceless; wasm: WebGL2) */
extern int bbgpu_gl_context_init(void);
#endif

#define TYPE_BBGPU "bbgpu"
OBJECT_DECLARE_SIMPLE_TYPE(BBGPUState, BBGPU)

struct BBGPUState {
    PCIDevice parent_obj;
    MemoryRegion regs;
    MemoryRegion shm;
    uint32_t shm_mb;
    uint32_t slots;        /* client slots (property) */
    uint8_t *mem;          /* host pointer to BAR2 */
    uint32_t ring_tail;    /* byte offset of the next unread command */
    uint32_t fence_done;
    uint32_t error, err_op;
    uint64_t ops, bytes;
#ifdef BBGPU_RENDER
    /* GPU thread: owns the GL context and executes the rings; the doorbells only record the heads.
       Slot 0 is also the single client of the legacy registers (whole BAR2, BBGPU_RING_SIZE ring). */
    QemuThread thread;
    QemuMutex lock;
    QemuCond cond;
    uint32_t nslots;
    struct BBSlot {
        uint32_t head, ring_tail, fence_done, error, err_op;
        bool head_dirty, reset, legacy;
        void *r;                       /* BBRenderer */
    } slot[BBGPU_MAX_SLOTS];
    /* snapshots: save/load run on the GPU thread (it owns the GL context); the migration thread waits */
    int xfer_op;                       /* 0 none, 1 save, 2 load */
    void *xfer_file;
    int xfer_result;
    QemuCond xfer_done;
#endif
    uint32_t status;       /* BBGPU_STATUS_* */
};

/* shared with the host viewer (wasm: the page writes [0] and [1] straight into this memory) */
volatile uint32_t bbgpu_host[4];

/* Direct touch (wasm): the page's touch mailbox. The viewer writes finger events straight into this shared
 * memory and wakes the injector thread, which feeds them to the guest's virtio-multitouch device under the
 * BQL - no network hop, no guest process in the input path (the VNC bridge stays the fallback).
 * [0] events written (page), [1] events consumed (engine), [2] multitouch device present (engine),
 * then BBTOUCH_N entries of 4 words: kind | slot << 8, then by kind:
 *   0 down, 1 move, 2 up (touch):  x, y (0..32767)
 *   3 pointer (tablet):            x, y (0..32767), buttons (1 left, 2 middle, 4 right)
 *   4 key:                         Linux key code, down (0/1)
 *   5 wheel:                       vertical steps (signed, + = down), horizontal steps (+ = right) */
#define BBTOUCH_N 64
volatile uint32_t bbtouch_ring[4 + BBTOUCH_N * 4] __attribute__((aligned(16)));

/* Direct display (wasm): the guest's virtio-gpu scanout, published for the page. The viewer reads the
 * pixels straight out of the engine's memory on its own animation frames - no VNC server in the guest,
 * no encoding, no network hop. Words (written under the BQL by the engine; lock = [BBD_LOCK]):
 *   [0] change counter  [1] surface generation  [2] pixels (address)  [3] width  [4] height  [5] stride
 *   [6] pixman format   [7..10] damage x0 y0 x1 y1 (union since the page last took it; x1 <= x0 = none)
 *   [11] lock (0/1)     [12] cursor generation  [13] cursor w  [14] h  [15] hot x  [16] hot y
 *   [17] pointer x      [18] pointer y          [19] cursor visible   [20] input devices (1 tablet, 2 keyboard)
 *   [21] listener registered   [22] guest scanout live (not QEMU's placeholder)   [32..] cursor pixels, BBD_CUR x BBD_CUR ARGB */
#define BBD_CUR 64
#define BBD_LOCK 11
volatile uint32_t bbdisp[32 + BBD_CUR * BBD_CUR] __attribute__((aligned(16)));

#if defined(BBGPU_RENDER) && defined(__EMSCRIPTEN__)
#include <emscripten/threading.h>
#include "qemu/main-loop.h"
#include "ui/input.h"
#include "hw/virtio/virtio-input.h"
#include "ui/console.h"
#include "ui/surface.h"
#include "sysemu/sysemu.h"

static bool bbtouch_has_device(void)
{
    bool found = false;
    /* the multitouch backend lives under its PCI proxy: look for any object of the type */
    Object *o = object_resolve_path_type("", TYPE_VIRTIO_MULTITOUCH, &found);
    return o != NULL || found;      /* found = ambiguous (several): still present */
}

/* pointer / keyboard / wheel from the page (kinds 3-5) -> the guest's virtio tablet and keyboard */
static void bbinput_event(uint32_t kind, const volatile uint32_t *e)
{
    static uint32_t buttons;
    static const InputButton map[3] = { INPUT_BUTTON_LEFT, INPUT_BUTTON_MIDDLE, INPUT_BUTTON_RIGHT };
    if (kind == 3) {
        uint32_t b = e[3] & 7;
        qemu_input_queue_abs(NULL, INPUT_AXIS_X, (int)(e[1] & 0x7fff), 0, 32767);
        qemu_input_queue_abs(NULL, INPUT_AXIS_Y, (int)(e[2] & 0x7fff), 0, 32767);
        for (int i = 0; i < 3; i++) {
            if ((b ^ buttons) & (1u << i)) qemu_input_queue_btn(NULL, map[i], (b >> i) & 1);
        }
        buttons = b;
        qemu_input_event_sync();
    } else if (kind == 4) {
        int q = qemu_input_linux_to_qcode(e[1] & 0x3ff);
        if (q > 0) qemu_input_event_send_key_qcode(NULL, q, e[2] != 0);
    } else if (kind == 5) {
        int dy = (int32_t)e[1], dx = (int32_t)e[2];
        for (int n = 0; n < 16 && (dy || dx); n++) {
            InputButton w = dy > 0 ? INPUT_BUTTON_WHEEL_DOWN : dy < 0 ? INPUT_BUTTON_WHEEL_UP
                          : dx > 0 ? INPUT_BUTTON_WHEEL_RIGHT : INPUT_BUTTON_WHEEL_LEFT;
            if (dy) dy += dy > 0 ? -1 : 1; else dx += dx > 0 ? -1 : 1;
            qemu_input_queue_btn(NULL, w, true);
            qemu_input_event_sync();
            qemu_input_queue_btn(NULL, w, false);
            qemu_input_event_sync();
        }
    }
}

/* ---- the display listener ---- */
static void bbd_lock(void)
{
    while (qatomic_cmpxchg(&bbdisp[BBD_LOCK], 0, 1) != 0) { /* the page holds it for a few loads */ }
}
static void bbd_unlock(void) { qatomic_store_release(&bbdisp[BBD_LOCK], 0); }

static void bbd_damage(int x, int y, int w, int h)
{
    if (w <= 0 || h <= 0) return;
    bbd_lock();
    uint32_t x0 = bbdisp[7], y0 = bbdisp[8], x1 = bbdisp[9], y1 = bbdisp[10];
    if (x1 <= x0 || y1 <= y0) { x0 = x; y0 = y; x1 = x + w; y1 = y + h; }
    else {
        if ((uint32_t)x < x0) x0 = x;
        if ((uint32_t)y < y0) y0 = y;
        if ((uint32_t)(x + w) > x1) x1 = x + w;
        if ((uint32_t)(y + h) > y1) y1 = y + h;
    }
    bbdisp[7] = x0; bbdisp[8] = y0; bbdisp[9] = x1; bbdisp[10] = y1;
    bbd_unlock();
    qatomic_inc(&bbdisp[0]);
}

static void bbd_update(DisplayChangeListener *dcl, int x, int y, int w, int h) { bbd_damage(x, y, w, h); }

static void bbd_switch(DisplayChangeListener *dcl, DisplaySurface *sf)
{
    bbd_lock();
    if (sf) {
        bbdisp[2] = (uint32_t)(uintptr_t)surface_data(sf);
        bbdisp[3] = surface_width(sf); bbdisp[4] = surface_height(sf);
        bbdisp[5] = surface_stride(sf); bbdisp[6] = surface_format(sf);
        bbdisp[22] = is_placeholder(sf) ? 0 : 1;     /* 1 = the guest really drives the scanout */
    } else {
        bbdisp[2] = 0; bbdisp[3] = bbdisp[4] = 0; bbdisp[22] = 0;
    }
    bbdisp[7] = bbdisp[8] = 0; bbdisp[9] = bbdisp[3]; bbdisp[10] = bbdisp[4];   /* everything is new */
    bbd_unlock();
    qatomic_inc(&bbdisp[1]);
    qatomic_inc(&bbdisp[0]);
}

static bool bbd_check_format(DisplayChangeListener *dcl, pixman_format_code_t f)
{
    return f == PIXMAN_x8r8g8b8 || f == PIXMAN_a8r8g8b8;    /* what the viewer uploads (BGRA bytes) */
}

static void bbd_mouse(DisplayChangeListener *dcl, int x, int y, int on)
{
    bbdisp[17] = x; bbdisp[18] = y; bbdisp[19] = on ? 1 : 0;
    qatomic_inc(&bbdisp[12]);
}

static void bbd_cursor(DisplayChangeListener *dcl, QEMUCursor *c)
{
    int w = c->width < BBD_CUR ? c->width : BBD_CUR, h = c->height < BBD_CUR ? c->height : BBD_CUR;
    for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) bbdisp[32 + y * BBD_CUR + x] = c->data[y * c->width + x];
    }
    bbdisp[13] = w; bbdisp[14] = h; bbdisp[15] = c->hot_x; bbdisp[16] = c->hot_y;
    qatomic_inc(&bbdisp[12]);
}

static const DisplayChangeListenerOps bbd_ops = {
    .dpy_name = "bbdisplay",
    .dpy_gfx_update = bbd_update,
    .dpy_gfx_switch = bbd_switch,
    .dpy_gfx_check_format = bbd_check_format,
    .dpy_mouse_set = bbd_mouse,
    .dpy_cursor_define = bbd_cursor,
};

static bool bbd_has(const char *type)
{
    bool found = false;
    Object *o = object_resolve_path_type("", type, &found);
    return o != NULL || found;
}

/* machine ready: attach to the first graphic console (the virtio-gpu scanout) if there is one */
static void bbd_machine_ready(Notifier *n, void *data)
{
    static DisplayChangeListener dcl;
    QemuConsole *con = NULL;
    /* the virtio GPU's console if there is one (a PC also has its VGA console), else the first graphic one */
    for (int i = 0; ; i++) {
        QemuConsole *c = qemu_console_lookup_by_index(i);
        if (!c) break;
        if (!qemu_console_is_graphic(c)) continue;
        Object *dev = object_property_get_link(OBJECT(c), "device", NULL);
        if (dev && object_dynamic_cast(dev, "virtio-gpu-base")) { con = c; break; }
        if (!con) con = c;
    }
    bbdisp[20] = (bbd_has(TYPE_VIRTIO_TABLET) ? 1 : 0) | (bbd_has(TYPE_VIRTIO_KEYBOARD) ? 2 : 0);
    if (!con) return;
    dcl.ops = &bbd_ops;
    dcl.con = con;
    register_displaychangelistener(&dcl);
    bbdisp[21] = 1;
}

static void *bbtouch_thread(void *opaque)
{
    static int track[INPUT_EVENT_SLOTS_MAX], next_id = 1;
    uint32_t done = qatomic_read(&bbtouch_ring[1]);
    for (int i = 0; i < INPUT_EVENT_SLOTS_MAX; i++) track[i] = -1;
    for (;;) {
        uint32_t seq = qatomic_load_acquire(&bbtouch_ring[0]);
        if (seq == done) {
            if (!qatomic_read(&bbtouch_ring[2])) {      /* devices are realized by now; publish once */
                qemu_mutex_lock_iothread();
                qatomic_set(&bbtouch_ring[2], bbtouch_has_device() ? 1 : 2);
                qemu_mutex_unlock_iothread();
            }
            emscripten_futex_wait((void *)&bbtouch_ring[0], seq, 1000.0);
            continue;
        }
        if (seq - done > BBTOUCH_N) done = seq - BBTOUCH_N;   /* overrun: drop the oldest */
        qemu_mutex_lock_iothread();
        while (done != seq) {
            const volatile uint32_t *e = &bbtouch_ring[4 + (done % BBTOUCH_N) * 4];
            uint32_t kind = e[0] & 0xff, slot = (e[0] >> 8) & 0xff;
            int x = (int)(e[1] & 0x7fff), y = (int)(e[2] & 0x7fff);
            done++;
            if (kind >= 3) { bbinput_event(kind, e); continue; }
            if (slot >= INPUT_EVENT_SLOTS_MAX) continue;
            if (kind == 2) {
                if (track[slot] < 0) continue;
                track[slot] = -1;
                qemu_input_queue_mtt(NULL, INPUT_MULTI_TOUCH_TYPE_END, slot, -1);
                bool any = false;
                for (int i = 0; i < INPUT_EVENT_SLOTS_MAX; i++) any |= track[i] >= 0;
                if (!any) qemu_input_queue_btn(NULL, INPUT_BUTTON_TOUCH, false);
            } else {
                InputMultiTouchType t = INPUT_MULTI_TOUCH_TYPE_UPDATE;
                if (kind == 0 || track[slot] < 0) {
                    t = INPUT_MULTI_TOUCH_TYPE_BEGIN;
                    track[slot] = next_id; next_id = next_id >= 0xffff ? 1 : next_id + 1;
                }
                qemu_input_queue_mtt(NULL, t, slot, track[slot]);
                qemu_input_queue_btn(NULL, INPUT_BUTTON_TOUCH, true);
                qemu_input_queue_mtt_abs(NULL, INPUT_AXIS_X, x, 0, 32767, slot, track[slot]);
                qemu_input_queue_mtt_abs(NULL, INPUT_AXIS_Y, y, 0, 32767, slot, track[slot]);
            }
            qemu_input_event_sync();
        }
        qemu_mutex_unlock_iothread();
        qatomic_store_release(&bbtouch_ring[1], done);
    }
    return NULL;
}
#endif

static inline uint32_t rd32(BBGPUState *s, uint32_t off) { uint32_t v; memcpy(&v, s->mem + off, 4); return le32_to_cpu(v); }

#ifndef BBGPU_RENDER
/* Execute every complete command between ring_tail and head (byte offsets, wrapping at BBGPU_RING_SIZE). */
static void bbgpu_execute(BBGPUState *s, uint32_t head)
{
    uint64_t heap_size = (uint64_t)s->shm_mb * MiB - BBGPU_RING_SIZE;
    while (s->ring_tail != head) {
        uint32_t at = s->ring_tail % BBGPU_RING_SIZE;
        if (at + 8 > BBGPU_RING_SIZE) { s->error = BBGPU_ERR_RING; return; }
        uint32_t op = rd32(s, at), dw = rd32(s, at + 4);
        if (dw < 2 || at + dw * 4 > BBGPU_RING_SIZE) { s->error = BBGPU_ERR_RING; return; }
        const uint32_t *p = (const uint32_t *)(s->mem + at + 8);
        switch (op) {
        case BBGPU_OP_NOP:
            break;
        case BBGPU_OP_WRAP:                  /* the rest of the ring is padding: continue at 0 */
            s->ring_tail += BBGPU_RING_SIZE - at;
            s->ops++;
            continue;
        case BBGPU_OP_ECHO: {                /* src_off, dst_off, size (heap offsets) */
            uint64_t src = le32_to_cpu(p[0]), dst = le32_to_cpu(p[1]), n = le32_to_cpu(p[2]);
            if (src + n > heap_size || dst + n > heap_size) { s->error = BBGPU_ERR_RANGE; break; }
            memmove(s->mem + BBGPU_RING_SIZE + dst, s->mem + BBGPU_RING_SIZE + src, n);
            s->bytes += n;
            break;
        }
        case BBGPU_OP_FENCE:                 /* everything before it is done */
            s->fence_done = le32_to_cpu(p[0]);
            break;
        default:
            s->error = BBGPU_ERR_OP;
            break;
        }
        s->ring_tail += dw * 4;
        s->ops++;
    }
}

#endif

#ifdef BBGPU_RENDER
static void slot_layout(BBGPUState *s, uint32_t i, uint8_t **mem, uint32_t *size, uint32_t *ring)
{
    uint64_t total = (uint64_t)s->shm_mb * MiB;
    if (s->slot[i].legacy) { *mem = s->mem; *size = (uint32_t)total; *ring = BBGPU_RING_SIZE; return; }
    *size = (uint32_t)(total / s->nslots);
    *mem = s->mem + (uint64_t)i * *size;
    *ring = BBGPU_SLOT_RING;
}

/* the slot's register mirror in shared memory (client slots only) */
static uint32_t *slot_status(BBGPUState *s, uint32_t i)
{
    uint8_t *m; uint32_t sz, ring;
    if (s->slot[i].legacy) return NULL;
    slot_layout(s, i, &m, &sz, &ring);
    return (uint32_t *)(m + sz - BBGPU_LOG_SIZE);
}

static bool any_pending(BBGPUState *s)
{
    for (uint32_t i = 0; i < s->nslots; i++)
        if (bbr_present_pending(s->slot[i].r)) return true;
    return false;
}

static void snap_put(void *f, const void *p, size_t n) { qemu_put_buffer((QEMUFile *)f, p, n); }
static int snap_get(void *f, void *p, size_t n) { return qemu_get_buffer((QEMUFile *)f, p, n) == n; }

/* GPU thread: every ring is drained (the guest is stopped); write the slots, the shared textures, then each
 * client's objects and state */
static int snapshot_save(BBGPUState *s)
{
    QEMUFile *f = s->xfer_file;
    qemu_put_be32(f, s->nslots);
    for (uint32_t i = 0; i < s->nslots; i++) {
        struct BBSlot *sl = &s->slot[i];
        qemu_put_be32(f, sl->ring_tail); qemu_put_be32(f, sl->fence_done); qemu_put_be32(f, sl->error);
        qemu_put_be32(f, sl->err_op); qemu_put_be32(f, sl->legacy);
    }
    bbr_save_shared(s->slot[0].r, snap_put, f);
    for (uint32_t i = 0; i < s->nslots; i++)
        bbr_save(s->slot[i].r, snap_put, f);
    return 0;
}

static int snapshot_load(BBGPUState *s)
{
    QEMUFile *f = s->xfer_file;
    if (qemu_get_be32(f) != s->nslots) return -EINVAL;
    for (uint32_t i = 0; i < s->nslots; i++) {
        struct BBSlot *sl = &s->slot[i];
        sl->ring_tail = qemu_get_be32(f); sl->fence_done = qemu_get_be32(f); sl->error = qemu_get_be32(f);
        sl->err_op = qemu_get_be32(f); sl->legacy = qemu_get_be32(f);
        sl->head = sl->ring_tail; sl->head_dirty = false; sl->reset = false;
        uint8_t *m; uint32_t sz, ring;
        slot_layout(s, i, &m, &sz, &ring);
        bbr_layout(s->slot[i].r, m, sz, ring);
    }
    if (bbr_load_shared(s->slot[0].r, snap_get, f)) return -EINVAL;
    for (uint32_t i = 0; i < s->nslots; i++)
        if (bbr_load(s->slot[i].r, snap_get, f)) return -EINVAL;
    return 0;
}

static int xfer(BBGPUState *s, int op, QEMUFile *f)
{
    /* the renderer may still be starting (GL context): wait for it */
    while (qatomic_read(&s->status) == BBGPU_STATUS_STARTING) g_usleep(1000);
    if (qatomic_read(&s->status) != BBGPU_STATUS_READY) return -ENODEV;
    qemu_mutex_lock(&s->lock);
    /* finish what the rings hold before saving */
    for (int waited = 0;; waited++) {
        bool busy = false;
        for (uint32_t i = 0; i < s->nslots; i++)
            busy |= s->slot[i].head_dirty || s->slot[i].reset || s->slot[i].ring_tail != s->slot[i].head;
        /* a client whose ring cannot advance (a bad command stream) must not hang the snapshot: 5 s */
        if (!busy || op == 2 || waited >= 5000) break;
        qemu_mutex_unlock(&s->lock); g_usleep(1000); qemu_mutex_lock(&s->lock);
    }
    s->xfer_file = f; s->xfer_op = op;
    qemu_cond_broadcast(&s->cond);
    while (s->xfer_op) qemu_cond_wait(&s->xfer_done, &s->lock);
    int r = s->xfer_result;
    qemu_mutex_unlock(&s->lock);
    return r;
}

static void bbgpu_save_state(QEMUFile *f, void *opaque)
{
    BBGPUState *s = opaque;
    int r = xfer(s, 1, f);
    if (r) error_report("bbgpu: snapshot save failed (%d)", r);
}

static int bbgpu_load_state(QEMUFile *f, void *opaque, int version_id)
{
    BBGPUState *s = opaque;
    int r = xfer(s, 2, f);
    if (r) error_report("bbgpu: snapshot load failed (%d)", r);
    return r;
}

static const SaveVMHandlers bbgpu_savevm = {
    .save_state = bbgpu_save_state,
    .load_state = bbgpu_load_state,
};

static void *bbgpu_gpu_thread(void *opaque)
{
    BBGPUState *s = opaque;
    if (bbgpu_gl_context_init()) {
        s->error = BBGPU_ERR_GL;
        qatomic_set(&s->status, BBGPU_STATUS_FAILED);
        return NULL;
    }
    for (uint32_t i = 0; i < s->nslots; i++) {
        uint8_t *m; uint32_t sz, ring;
        s->slot[i].legacy = i == 0;
        slot_layout(s, i, &m, &sz, &ring);
        s->slot[i].r = bbr_create(m, sz, ring);
    }
    BBRenderer *cur = NULL;
    uint32_t next = 0;                  /* round robin between clients */
    qatomic_set(&s->status, BBGPU_STATUS_READY);
    for (;;) {
        qemu_mutex_lock(&s->lock);
        int work = -1;
        for (;;) {
            for (uint32_t k = 0; k < s->nslots && work < 0; k++) {
                uint32_t i = (next + k) % s->nslots;
                if (s->slot[i].head_dirty || s->slot[i].reset) work = i;
            }
            if (work >= 0) break;
            if (s->xfer_op) {
                int op = s->xfer_op;
                qemu_mutex_unlock(&s->lock);
                int res = op == 1 ? snapshot_save(s) : snapshot_load(s);
                cur = NULL;                    /* the renderers bound their own state */
                qemu_mutex_lock(&s->lock);
                s->xfer_result = res; s->xfer_op = 0;
                qemu_cond_broadcast(&s->xfer_done);
                continue;
            }
            if (any_pending(s)) {          /* held-back frames: offer them again once the viewer catches up */
                qemu_mutex_unlock(&s->lock);
                for (uint32_t i = 0; i < s->nslots; i++) {
                    BBRenderer *r = s->slot[i].r;
                    if (!bbr_present_pending(r)) continue;
                    if (cur != r) { bbr_activate(r); cur = r; }
                    bbr_present_retry(r);
                }
                qemu_mutex_lock(&s->lock);
                if (any_pending(s)) qemu_cond_timedwait(&s->cond, &s->lock, 4);
                continue;
            }
            qemu_cond_wait(&s->cond, &s->lock);
        }
        next = work + 1;
        struct BBSlot *sl = &s->slot[work];
        BBRenderer *r = sl->r;
        bool do_reset = sl->reset;
        /* a reset rewinds both ends of the ring: the new client starts at 0 (replaying the old
         * client's commands from 0 to its last head would run stale commands over new data) */
        if (sl->reset) {
            sl->reset = false; sl->ring_tail = 0; sl->error = 0; qatomic_set(&sl->fence_done, 0);
            if (work == 0) s->error = 0;
        }
        uint32_t head = sl->head;
        sl->head_dirty = false;
        qemu_mutex_unlock(&s->lock);
        if (cur != r) { bbr_activate(r); cur = r; }
        if (do_reset) {
            uint8_t *m; uint32_t sz, ring;
            slot_layout(s, work, &m, &sz, &ring);
            bbr_layout(r, m, sz, ring);
            bbr_reset(r);
            uint32_t *mirror = slot_status(s, work);
            if (mirror) { qatomic_set(&mirror[0], 0); qatomic_set(&mirror[1], 0); qatomic_set(&mirror[2], 0); }
        }
        /* a failing command is skipped and reported (first error stays in ERROR); execution goes on */
        uint32_t tail = sl->ring_tail, done = sl->fence_done, op = 0;
        uint32_t *mirror = slot_status(s, work);
        for (;;) {
            uint32_t e = bbr_execute(r, &tail, head, &done, &op);
            /* publish unless the slot was reset meanwhile (a new client must never see the old one's fences) */
            qemu_mutex_lock(&s->lock);
            bool stale = sl->reset;
            if (!stale) {
                qatomic_set(&sl->ring_tail, tail);
                qatomic_set(&sl->fence_done, done);
                if (e && !sl->error) { sl->err_op = op; qatomic_set(&sl->error, e); }
                if (mirror) { qatomic_set(&mirror[2], sl->error); qatomic_set(&mirror[1], tail); qatomic_set(&mirror[0], done); }
            }
            qemu_mutex_unlock(&s->lock);
            if (!e || stale || e == BBGPU_ERR_RING) break;   /* RING: the ring itself is corrupt, wait for a reset */
        }
    }
    return NULL;
}

static void slot_kick(BBGPUState *s, uint32_t i, uint32_t head)
{
    qemu_mutex_lock(&s->lock);
    s->slot[i].head = head; s->slot[i].head_dirty = true;
    qemu_cond_signal(&s->cond); qemu_mutex_unlock(&s->lock);
}

static void slot_reset(BBGPUState *s, uint32_t i, bool legacy)
{
    qemu_mutex_lock(&s->lock);
    struct BBSlot *sl = &s->slot[i];
    sl->reset = true; sl->legacy = legacy; sl->head = 0; sl->head_dirty = false; sl->fence_done = 0; sl->ring_tail = 0;
    sl->error = 0;
    uint32_t *mirror = slot_status(s, i);
    if (mirror) { qatomic_set(&mirror[0], 0); qatomic_set(&mirror[1], 0); qatomic_set(&mirror[2], 0); }
    qemu_cond_signal(&s->cond); qemu_mutex_unlock(&s->lock);
}
#endif

static uint64_t bbgpu_reg_read(void *opaque, hwaddr addr, unsigned size)
{
    BBGPUState *s = opaque;
    switch (addr) {
    case BBGPU_REG_MAGIC:      return BBGPU_MAGIC;
    case BBGPU_REG_VERSION:    return BBGPU_PROTO_VERSION;
    case BBGPU_REG_RING_SIZE:  return BBGPU_RING_SIZE;
    case BBGPU_REG_SHM_SIZE:   return (uint64_t)s->shm_mb * MiB;
    case BBGPU_REG_OPS:        return (uint32_t)s->ops;
#ifdef BBGPU_RENDER
    case BBGPU_REG_FENCE_DONE: return qatomic_read(&s->slot[0].fence_done);
    case BBGPU_REG_TAIL:       return qatomic_read(&s->slot[0].ring_tail);
    case BBGPU_REG_ERROR:      return s->slot[0].error ? s->slot[0].error : s->error;
    case BBGPU_REG_ERR_OP:     return s->slot[0].err_op;
    case BBGPU_REG_SLOTS:      return s->nslots;
    case BBGPU_REG_CAPS:       return BBGPU_CAP_STATUS_MIRROR;
    case BBGPU_REG_STATUS:     return qatomic_read(&s->status);
    case BBGPU_REG_PRESENT:    return qatomic_read(&s->status) == BBGPU_STATUS_READY && bbgpu_host[0] == 1;
#else
    case BBGPU_REG_FENCE_DONE: return s->fence_done;
    case BBGPU_REG_TAIL:       return s->ring_tail;
    case BBGPU_REG_ERROR:      return s->error;
    case BBGPU_REG_ERR_OP:     return s->err_op;
    case BBGPU_REG_SLOTS:      return 0;
    case BBGPU_REG_CAPS:       return 0;
    case BBGPU_REG_PRESENT:    return 0;
    case BBGPU_REG_STATUS:     return BBGPU_STATUS_READY;   /* transport-only build */
#endif
    }
#ifdef BBGPU_RENDER
    if (addr >= BBGPU_SLOT_REG(0) && addr < BBGPU_SLOT_REG(s->nslots)) {
        struct BBSlot *sl = &s->slot[(addr - BBGPU_SLOT_REG(0)) / 0x20];
        switch ((addr - BBGPU_SLOT_REG(0)) % 0x20) {
        case BBGPU_SREG_FENCE_DONE: return qatomic_read(&sl->fence_done);
        case BBGPU_SREG_TAIL:       return qatomic_read(&sl->ring_tail);
        case BBGPU_SREG_ERROR:      return qatomic_read(&sl->error);
        case BBGPU_SREG_ERR_OP:     return sl->err_op;
        }
    }
#endif
    return 0;
}

static void bbgpu_reg_write(void *opaque, hwaddr addr, uint64_t val, unsigned size)
{
    BBGPUState *s = opaque;
    switch (addr) {
#ifdef BBGPU_RENDER
    case BBGPU_REG_KICK:  slot_kick(s, 0, (uint32_t)val); break;
    case BBGPU_REG_RESET: slot_reset(s, 0, true); break;   /* a one-client driver: slot 0 owns all of BAR2 */
    default:
        if (addr >= BBGPU_SLOT_REG(0) && addr < BBGPU_SLOT_REG(s->nslots)) {
            uint32_t i = (addr - BBGPU_SLOT_REG(0)) / 0x20;
            switch ((addr - BBGPU_SLOT_REG(0)) % 0x20) {
            case BBGPU_SREG_KICK:  slot_kick(s, i, (uint32_t)val); break;
            case BBGPU_SREG_RESET: slot_reset(s, i, false); break;
            }
        }
        break;
#else
    case BBGPU_REG_KICK:  bbgpu_execute(s, (uint32_t)val); break;
    case BBGPU_REG_RESET: s->ring_tail = 0; s->fence_done = 0; s->error = 0; break;
#endif
    }
}

static const MemoryRegionOps bbgpu_reg_ops = {
    .read = bbgpu_reg_read,
    .write = bbgpu_reg_write,
    .endianness = DEVICE_LITTLE_ENDIAN,
    .valid = { .min_access_size = 4, .max_access_size = 4 },
};

static void bbgpu_realize(PCIDevice *pdev, Error **errp)
{
    BBGPUState *s = BBGPU(pdev);
    if (s->shm_mb < 8 || s->shm_mb > 1024 || (s->shm_mb & (s->shm_mb - 1))) {
        error_setg(errp, "bbgpu: shm-mb must be a power of two between 8 and 1024");
        return;
    }
    memory_region_init_io(&s->regs, OBJECT(s), &bbgpu_reg_ops, s, "bbgpu-regs", 4 * KiB);
    memory_region_init_ram(&s->shm, OBJECT(s), "bbgpu-shm", (uint64_t)s->shm_mb * MiB, errp);
    if (*errp) {
        return;
    }
    s->mem = memory_region_get_ram_ptr(&s->shm);
    pci_register_bar(pdev, 0, PCI_BASE_ADDRESS_SPACE_MEMORY, &s->regs);
    pci_register_bar(pdev, 2, PCI_BASE_ADDRESS_SPACE_MEMORY | PCI_BASE_ADDRESS_MEM_PREFETCH |
                     PCI_BASE_ADDRESS_MEM_TYPE_64, &s->shm);
#ifdef BBGPU_RENDER
    s->nslots = s->slots < 1 ? 1 : s->slots > BBGPU_MAX_SLOTS ? BBGPU_MAX_SLOTS : s->slots;
    qemu_mutex_init(&s->lock);
    qemu_cond_init(&s->cond);
    qemu_cond_init(&s->xfer_done);
    register_savevm_live("bbgpu", 0, 1, &bbgpu_savevm, s);
    qemu_thread_create(&s->thread, "bbgpu", bbgpu_gpu_thread, s, QEMU_THREAD_DETACHED);
#ifdef __EMSCRIPTEN__
    {
        static bool touch_started;
        if (!touch_started) {
            QemuThread t;
            static Notifier ready = { .notify = bbd_machine_ready };
            touch_started = true;
            qemu_thread_create(&t, "bbtouch", bbtouch_thread, NULL, QEMU_THREAD_DETACHED);
            qemu_add_machine_init_done_notifier(&ready);
        }
    }
#endif
#endif
}

static const VMStateDescription vmstate_bbgpu = {
    .name = "bbgpu-pci",
    .version_id = 1,
    .minimum_version_id = 1,
    .fields = (VMStateField[]) {
        VMSTATE_PCI_DEVICE(parent_obj, BBGPUState),
        VMSTATE_END_OF_LIST()
    },
};

static Property bbgpu_props[] = {
    DEFINE_PROP_UINT32("shm-mb", BBGPUState, shm_mb, 64),
    DEFINE_PROP_UINT32("slots", BBGPUState, slots, 4),
    DEFINE_PROP_END_OF_LIST(),
};

static void bbgpu_class_init(ObjectClass *klass, void *data)
{
    DeviceClass *dc = DEVICE_CLASS(klass);
    PCIDeviceClass *k = PCI_DEVICE_CLASS(klass);
    k->realize = bbgpu_realize;
    k->vendor_id = BBGPU_PCI_VENDOR;
    k->device_id = BBGPU_PCI_DEVICE;
    k->revision = BBGPU_PROTO_VERSION;
    k->class_id = PCI_CLASS_DISPLAY_OTHER;
    dc->desc = "Bootbox GPU bridge";
    dc->vmsd = &vmstate_bbgpu;
    device_class_set_props(dc, bbgpu_props);
    set_bit(DEVICE_CATEGORY_DISPLAY, dc->categories);
}

static const TypeInfo bbgpu_info = {
    .name = TYPE_BBGPU,
    .parent = TYPE_PCI_DEVICE,
    .instance_size = sizeof(BBGPUState),
    .class_init = bbgpu_class_init,
    .interfaces = (InterfaceInfo[]) { { INTERFACE_CONVENTIONAL_PCI_DEVICE }, { } },
};

static void bbgpu_register_types(void) { type_register_static(&bbgpu_info); }
type_init(bbgpu_register_types)
