# Bootbox

A clean **32-bit x86 Linux emulator for iPad** — boot real Linux on your iPad with a retro firmware/boot-menu, download or import your own ISOs, and drive the desktop by touch.

Bootbox runs a genuine software x86 (i686) CPU inside the web engine (v86 → WebAssembly), so it actually executes real 16/32-bit x86 code — fully on-device, no cloud.

## ✨ Features

- **Real PC firmware flow** — a Bootbox UEFI **boot menu** to pick an operating system, plus a tabbed **BIOS/UEFI Setup** (Main · Advanced · Boot · Security · Save & Exit) for RAM, boot order, and more.
- **Real distros** — download & boot official 32-bit ISOs (**Arch Linux i686**, **Ubuntu i386**), or **import your own** `.iso` / `.img` by dragging it onto the app.
- **Touch-first input** — drag = move the mouse · tap = click + keyboard · two-finger tap = right-click · hold-drag = drag. An on-screen key bar covers Esc / Tab / Ctrl / ^C / arrows.
- **Hard-disk images** — import a pre-installed `.img` and boot it as a persistent **hard disk**.
- **Files integration** — a File Provider extension surfaces your imported images in the iPad Files app.

## 📦 Pre-built images

Ready-to-boot disk images live under **[Releases](../../releases)**. Bootbox can pull them straight from the boot menu — download once → decompress on-device → boot.

| Image | What it is |
|---|---|
| **GUI Arch Linux** (`archgui.img.gz`) | Arch Linux 32 (i686) + Xorg + the **twm** window manager + xterm — a real, tap-around graphical desktop. |

> ⚠️ These run on a **software** x86 CPU, so a graphical desktop is **usable-but-slow**. Text-mode distros (the Arch/Ubuntu console ISOs) are far snappier.

## 🚀 Using a hosted image

1. Open Bootbox → the boot menu lists the hosted image as a download entry.
2. Tap it → it downloads once over Wi-Fi, decompresses to a raw disk on the device, and boots as a hard disk.
3. Drive the desktop by touch (see the input table above).

Prefer manual import? Download the `.img` to the **Files** app and drag it onto the running Bootbox app.

## 🛠️ How the GUI Arch image is built

It's built on a Mac with QEMU — a minimal **automated `archlinux32` + Xorg + twm** install onto a raw disk (VESA driver pinned to 1024×768×16 to match v86's emulated VGA), then gzip-compressed for hosting. On the iPad, v86 boots the raw image via legacy BIOS (SeaBIOS) → extlinux → root autologin → `startx`.

---

*Bootbox is an educational, on-device emulator. Distro ISOs and disk images are © their respective projects (Arch Linux 32, Ubuntu, …) and distributed under their own licenses.*
