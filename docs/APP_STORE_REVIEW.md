# Bootbox: App Store review plan

Working checklist for the first App Store submission (not TestFlight). Status as of 2026-11-03.

Precedent: Apple approved **UTM SE** (a PC emulator with no JIT) in 2024 under guideline 4.7 after
first rejecting it. Bootbox has the same shape: it translates x86 to WebAssembly in software and runs it
in WKWebView. It has no native code generation and no private entitlements.

## Done (in the working tree, not yet in a build)

- [x] Removed WebKit's private `_webView:webContentProcessDidTerminateWithReason:` callback (2.5.1, private
      API). The crash ladder still works through the public `webViewWebContentProcessDidTerminate`.
- [x] Removed the private `allowFileAccessFromFileURLs` / `allowUniversalAccessFromFileURLs` KVC keys. Pages
      load from the local HTTP server or the app scheme, never `file://`.
- [x] Permission prompts no longer say "MiniOS" and describe the real use. Removed the unused Photos-add
      permission.
- [x] **A** Removed the one-tap Windows 98 SE / 2000 entries from the boot menu (user decision: the GitHub
      release `windows-v1` stays up). The emulator still boots images the user supplies.
- [x] **B** Removed the silent-audio keep-alive and the `audio` background mode. A standard background task
      (~30 s) runs, then the guest pauses in memory. UEFI Setup "Run in Background" is now "About 30 s" or "Off".
- [x] **C** Checked: the App Center runs only its built-in packages (in the binary). Imported `.mapp` files are
      stored, never executed, and the mini-app API has no camera/mic/native bridges. No change needed.
- [x] **D** Removed ExternalAccessory from USBBridge (only removable-volume detection remains).
- [x] Privacy policy text: [PRIVACY.md](PRIVACY.md) (the user hosts it on their GitHub Pages).

## Blockers to resolve before submitting

| # | Issue | Guideline | Recommendation |
|---|-------|-----------|----------------|
| A | One-tap **Windows 98 SE / Windows 2000** downloads (biosmenu.js, GitHub release `windows-v1`) distribute Microsoft software | 5.2.1 / 5.2.2 (IP) | Remove both entries. Users can still boot their own images ("Windows / ISO / disk image…"). Also consider taking the `windows-v1` release down |
| B | **Silent audio loop** keeps the app alive in the background (BackgroundKeepAlive.swift + `UIBackgroundModes: audio`) | 2.5.4 | Remove the silent loop and the audio mode. Use `beginBackgroundTask` for a short grace period; guests pause in the background and resume on return |
| C | **App Center** runs imported `.mapp` packages (JavaScript not in the binary) with a native-permissions API (camera, mic, files, ML, Python bridges) | 2.5.2 / 4.7.2 | Keep the built-in catalog, but disable importing outside `.mapp` files (or give imported ones no native bridges) |
| D | **ExternalAccessory** used by USBBridge with no MFi protocols declared | 2.5.1 / MFi | Remove the ExternalAccessory part of USBBridge |
| E | App targets **iPhone and iPad** (`TARGETED_DEVICE_FAMILY = 1,2`); review also tests on an iPhone | 2.1 / 4.0 | User decision: KEEP iPhone. To do: make the UI and guests work on iPhone (simulator: iPhone 18 Pro) |
| F | Review iPads may have 4 GB of RAM: the Android guest needs about 2.4 GB of page memory | 2.1 (crashes) | Hide or disable Android when the memory limit is too low (a warning is shown today) |

Lower risk, worth a look:
- The guest's own web browser (WebKitGTK inside the emulator) vs 2.5.6 (browsing must use WebKit). The guest
  browser already opens normal web links in the iPad's own browser (bbweb `open_native`), and UTM SE runs
  whole OSes with browsers. Mention it in the review notes.
- The MiniOS shell's "Windows-10-style" apps (Task Manager, Notepad, Paint…): keep the names generic and use
  no Microsoft logos.
- CPU-Z (CPUID freeware) ships in the desktop image. Its terms allow free redistribution; confirm before
  any paid pricing.
- The Linux images contain GPL software: link to the build recipes and sources from About (GPL compliance;
  App Review doesn't check this).

## App Store Connect metadata (to prepare)

- [ ] Privacy policy URL (required): the user publishes [PRIVACY.md](PRIVACY.md) on their GitHub Pages.
      App Privacy answers: **Data Not Collected** (no analytics, no accounts; guest traffic goes straight to the
      internet).
- [ ] Support URL (the GitHub repo or its Issues page).
- [ ] Age rating questionnaire: **Unrestricted Web Access = Yes**, which gives 18+ / 17+.
- [ ] Category: Utilities (secondary: Developer Tools). Price: free.
- [ ] Description, subtitle, keywords, promotional text.
- [ ] Screenshots: 13-inch iPad (2064 × 2752 portrait or 2752 × 2064 landscape) AND 6.9-inch iPhone (1320 × 2868 or
      2868 × 1320), 3 to 10 each: boot menu, Linux desktop + browser, Terminal + Python, Android, Benchmarks hub.
- [ ] Review contact (name, phone, email): the user enters these.
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption = NO` is already set (HTTPS only).
- [x] Build with a release Xcode/SDK: Build 113 (App Store Connect build 112) processed as
      **APP_STORE_ELIGIBLE** (Xcode 27.1 27A9275).
- [ ] Availability: by default an iPad app is also offered on Apple silicon Macs ("Designed for iPad") and
      on Apple Vision Pro, and review may test there. Untested, so turn both off in Pricing and Availability
      unless we test them.
- [ ] Scan the release binary for private symbols before submitting.

## Draft notes for App Review

> Bootbox is a PC emulator for iPad and iPhone, similar to UTM SE. It emulates an x86-64 computer entirely in
> software: QEMU's CPU emulator is compiled to WebAssembly and runs inside WKWebView. It generates no native
> code and has no JIT entitlement or private API. The operating systems it boots are open-source (Linux,
> Android AOSP 12); they download on first use from the developer's GitHub releases. No account or sign-in
> is needed.
>
> To test: open Bootbox and choose "Linux (Desktop)". The first boot downloads about 240 MB and takes 1–2
> minutes to show the desktop. Tap Apps for programs; the Benchmarks icon runs CPU-Z and a web
> benchmark. "Linux (Terminal)" opens a Linux console with Python.
>
> Links in the guest's browser open in the device's own browser. Everything the guest does stays inside the
> app's sandbox.

## Draft store listing

**Name:** Bootbox
**Subtitle (30 max):** Run Linux on a virtual PC

**Promotional text (170 max):**
Run a real 64-bit Linux desktop or a Linux terminal with Python, inside one app. Everything
runs on a virtual x86 computer emulated on your device.

**Description:**
Bootbox is a virtual PC for iPad and iPhone. It emulates a complete 64-bit x86 computer in software and boots
real operating systems on it, with no jailbreak, sign-in or server.

CHOOSE A SYSTEM
• Linux Desktop: windows, a taskbar, a terminal, a file manager and a WebKit web browser.
• Linux Terminal: a full Linux console with Python 3.12 and pip, internet access, and Wine for Windows
  command-line programs.
• Android 12 (AOSP): the Android home screen with touch and keyboard. It resumes in seconds from a
  ready-made snapshot.
• Your own disk images and ISO files.

A REAL COMPUTER, EMULATED
• Up to 8 virtual CPU cores that really run in parallel.
• Internet inside the virtual machine, through a network stack built into the app.
• Files move between your device and the virtual machine, and machines can be saved and resumed.
• Built-in benchmarks (CPU-Z, 7-Zip, sysbench, GPU and web tests) show what the emulated PC can do.

GOOD TO KNOW
Every instruction of the virtual PC is translated in software, so it runs much slower than a real
computer. It's best for learning Linux, scripting, retro-style computing and experiments, not heavy
work. The systems download on first use (about 240 MB for the Linux desktop, about 900 MB for Android) and
then run offline. Newer devices with more memory run them best.

Bootbox collects no data.

**Keywords (100 max):** linux,emulator,virtual machine,vm,terminal,python,x86,qemu,shell,pc,desktop,os,wine
**Category:** Utilities (secondary: Developer Tools)
**Support URL:** https://github.com/yu314-coder/Bootbox/issues

Note: guideline 2.3.10 discourages naming other mobile platforms in the metadata. "Android" stays out of
the subtitle, promo text and keywords and appears only as a feature line in the description. If review
objects, drop that line too; the feature itself is interactive functionality, which 2.3.10 allows.

## Status in App Store Connect (2026-11-04)

Filled through the API (`/Volumes/D/xcode/asc.py`, screenshots: `/Volumes/D/xcode/asc_shots.py`):
- [x] Subtitle, description, keywords, promotional text, support URL, copyright
- [x] Privacy policy URL: https://yu314-coder.github.io/privacy.html#bootbox
- [x] Categories: Utilities / Developer Tools
- [x] Age rating questionnaire, giving 17+ (unrestricted web access)
- [x] iPad 13-inch screenshots (4): boot menu, desktop + browser, Terminal + Python, web benchmark.
      Android is left out (2.3.10); its shot is in /Volumes/D/xcode/appstore-shots/
- [x] iPhone 6.9-inch screenshots (3): boot menu, desktop + Wikipedia in the Linux browser, Terminal + Python
- [x] Review contact and notes
- [x] App Privacy published: "Data Not Collected"
- [x] Price free (175 regions); availability all 175 regions; Mac + Vision Pro left on; content rights declared
- [x] Build 114 (version 1.0) attached and **submitted for review 2026-11-04**; waiting for review

## Guest bugs found while taking screenshots (fix in the next desktop image)
- The desktop's first Terminal shows a garbled prompt ("root / ooot / toot / @oot ..." one line per prompt
  character): bash draws the prompt before the terminal window has its real width.
- The first page the prewarmed Linux browser shows stays blank (grey) until Reload.
