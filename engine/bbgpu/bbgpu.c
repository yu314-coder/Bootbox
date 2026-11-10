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
    uint8_t *mem;          /* host pointer to BAR2 */
    uint32_t ring_tail;    /* byte offset of the next unread command */
    uint32_t fence_done;
    uint32_t error, err_op;
    uint64_t ops, bytes;
#ifdef BBGPU_RENDER
    /* GPU thread: owns the GL context and executes the ring; the doorbell only records the head */
    QemuThread thread;
    QemuMutex lock;
    QemuCond cond;
    uint32_t head;
    bool head_dirty, reset;
#endif
};

static uint32_t rd32(BBGPUState *s, uint32_t off) { uint32_t v; memcpy(&v, s->mem + off, 4); return le32_to_cpu(v); }

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

#ifdef BBGPU_RENDER
static void *bbgpu_gpu_thread(void *opaque)
{
    BBGPUState *s = opaque;
    if (bbgpu_gl_context_init()) {
        s->error = BBGPU_ERR_GL;
        return NULL;
    }
    BBRenderer *r = bbr_create(s->mem, (uint32_t)s->shm_mb * MiB);
    for (;;) {
        qemu_mutex_lock(&s->lock);
        while (!s->head_dirty && !s->reset)
            qemu_cond_wait(&s->cond, &s->lock);
        uint32_t head = s->head;
        s->head_dirty = false;
        if (s->reset) { s->reset = false; s->ring_tail = 0; s->error = 0; qatomic_set(&s->fence_done, 0); }
        qemu_mutex_unlock(&s->lock);
        if (s->error)
            continue;
        uint32_t tail = s->ring_tail, done = s->fence_done, op = 0;
        uint32_t e = bbr_execute(r, &tail, head, &done, &op);
        qatomic_set(&s->ring_tail, tail);
        qatomic_set(&s->fence_done, done);
        if (e) { s->err_op = op; qatomic_set(&s->error, e); }
    }
    return NULL;
}
#endif

static uint64_t bbgpu_reg_read(void *opaque, hwaddr addr, unsigned size)
{
    BBGPUState *s = opaque;
    switch (addr) {
    case BBGPU_REG_MAGIC:      return BBGPU_MAGIC;
    case BBGPU_REG_VERSION:    return BBGPU_PROTO_VERSION;
    case BBGPU_REG_FENCE_DONE: return s->fence_done;
    case BBGPU_REG_RING_SIZE:  return BBGPU_RING_SIZE;
    case BBGPU_REG_SHM_SIZE:   return (uint64_t)s->shm_mb * MiB;
    case BBGPU_REG_TAIL:       return s->ring_tail;
    case BBGPU_REG_ERROR:      return s->error;
    case BBGPU_REG_OPS:        return (uint32_t)s->ops;
    case BBGPU_REG_ERR_OP:     return s->err_op;
    }
    return 0;
}

static void bbgpu_reg_write(void *opaque, hwaddr addr, uint64_t val, unsigned size)
{
    BBGPUState *s = opaque;
    switch (addr) {
#ifdef BBGPU_RENDER
    case BBGPU_REG_KICK:
        qemu_mutex_lock(&s->lock); s->head = (uint32_t)val; s->head_dirty = true; qemu_cond_signal(&s->cond); qemu_mutex_unlock(&s->lock);
        break;
    case BBGPU_REG_RESET:
        qemu_mutex_lock(&s->lock); s->reset = true; s->fence_done = 0; qemu_cond_signal(&s->cond); qemu_mutex_unlock(&s->lock);
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
    qemu_mutex_init(&s->lock);
    qemu_cond_init(&s->cond);
    qemu_thread_create(&s->thread, "bbgpu", bbgpu_gpu_thread, s, QEMU_THREAD_DETACHED);
#endif
}

static Property bbgpu_props[] = {
    DEFINE_PROP_UINT32("shm-mb", BBGPUState, shm_mb, 64),
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
