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

- [ ] Privacy policy URL (required). Proposed: GitHub Pages on yu314-coder/Bootbox (`docs/privacy.html`).
      App Privacy answers: **Data Not Collected** (no analytics, no accounts; guest traffic goes straight to the
      internet).
- [ ] Support URL (the GitHub repo or its Issues page).
- [ ] Age rating questionnaire: **Unrestricted Web Access = Yes**, which gives 18+ / 17+.
- [ ] Category: Utilities (secondary: Developer Tools). Price: free.
- [ ] Description, subtitle, keywords, promotional text.
- [ ] Screenshots: 13-inch iPad (2064 × 2752 portrait or 2752 × 2064 landscape), 3 to 10 of them: BIOS picker, Linux
      desktop + browser, Terminal + Python, Android, Benchmarks hub.
- [ ] Review contact (name, phone, email): the user enters these.
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption = NO` is already set (HTTPS only).
- [ ] Build with a release Xcode/SDK (Xcode 27.1 27A9275 now) and scan the binary for private symbols
      before submitting.

## Draft notes for App Review

> Bootbox is a PC emulator for iPad, similar to UTM SE. It emulates an x86-64 computer entirely in
> software: QEMU's CPU emulator is compiled to WebAssembly and runs inside WKWebView. It generates no native
> code and has no JIT entitlement or private API. The operating systems it boots are open-source (Linux,
> Android AOSP 12); they download on first use from the developer's GitHub releases. No account or sign-in
> is needed.
>
> To test: open Bootbox and choose "Linux (Desktop)". The first boot downloads about N MB and takes 1–2
> minutes to show the desktop. Tap Apps for programs; the Benchmarks icon runs CPU-Z and a web
> benchmark. "Linux (Terminal)" opens a Linux console with Python.
>
> Links in the guest's browser open in the iPad's own browser. Everything the guest does stays inside the
> app's sandbox.
