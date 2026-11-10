/* bbgpu_proto.h - Bootbox GPU bridge protocol, shared by the QEMU device, the renderer and the guest
 * driver. See docs/GPU_BRIDGE.md. SPDX-License-Identifier: MIT */
#ifndef BBGPU_PROTO_H
#define BBGPU_PROTO_H

#define BBGPU_PCI_VENDOR     0xbb0b      /* private: only ever seen inside a Bootbox VM */
#define BBGPU_PCI_DEVICE     0x0001
#define BBGPU_MAGIC          0x50474242u /* "BBGP" */
#define BBGPU_PROTO_VERSION  1
#define BBGPU_RING_SIZE      (4u << 20)  /* BAR2 [0, 4 MB) = command ring, the rest = heap */

/* BAR0 registers (32-bit) */
#define BBGPU_REG_MAGIC      0x00
#define BBGPU_REG_VERSION    0x04
#define BBGPU_REG_KICK       0x08  /* W: new ring head (byte offset, monotonic mod 2^32) */
#define BBGPU_REG_FENCE_DONE 0x0c  /* R: last completed fence id */
#define BBGPU_REG_RING_SIZE  0x10
#define BBGPU_REG_SHM_SIZE   0x14
#define BBGPU_REG_TAIL       0x18  /* R: renderer's ring tail */
#define BBGPU_REG_ERROR      0x1c
#define BBGPU_REG_OPS        0x20
#define BBGPU_REG_RESET      0x24  /* W: any value */

/* errors */
#define BBGPU_ERR_RING   1
#define BBGPU_ERR_OP     2
#define BBGPU_ERR_RANGE  3

/* ops: every command = u32 op, u32 dwords (total, incl. these two), payload */
#define BBGPU_OP_NOP     0
#define BBGPU_OP_WRAP    1   /* padding to the end of the ring */
#define BBGPU_OP_ECHO    2   /* src_off, dst_off, size: heap memmove (transport test) */
#define BBGPU_OP_FENCE   3   /* id */

#endif
