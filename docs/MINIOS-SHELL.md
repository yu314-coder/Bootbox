# MiniOS Runtime for iPad

A lightweight, Windows-10-inspired **MiniOS** that runs inside a secure iPad host
app. The desktop, window manager, and apps run as a sandboxed guest; the host
Swift app exposes a controlled **iPadOS bridge** for real hardware. The guest
never touches hardware directly.

```
iPad hardware
  → iPadOS
  → Host iPad app (Swift / WKWebView / bridges)
  → MiniOS runtime (kernel + window manager, in JS)
  → MiniOS desktop and apps
```

## What works in this first version (Phase 1–7)

- **BIOS / firmware setup** — theme, accent, boot delay, startup sound, device
  name, and per-device toggles (GPU / Audio / Network / Camera / ML). Persists in
  NVRAM on the host disk. Enter via the power button during POST, `F2`, or
  Settings → BIOS.
- **POST + boot splash**, soft power button.
- **Win10-style desktop**: wallpaper, desktop icons, taskbar, Start menu,
  search, system tray, clock, notifications, right-click / long-press context menu.
- **Window manager**: drag, resize, minimize, maximize, close, focus, taskbar
  buttons. Touch + mouse + Apple Pencil friendly.
- **Built-in apps**: File Explorer (+ Notepad), Settings, Terminal, App Center,
  About.
- **Virtual filesystem** (`/Desktop`, `/Documents`, `/Downloads`, `/Apps`,
  `/Trash`) persisted through the host **Files bridge**.
- **Native `.mapp` apps**: installable, permission-mediated sample apps
  (Calculator, Sticky Notes, World Clock).
- **APK import/inspection only** (Phase 7): shows package, SDK levels,
  permissions, and a compatibility report. Running APKs is a later phase.
- **Bridges**: Files (persistent disk), Clipboard (real iPad pasteboard),
  System (device info, haptics, logging). The JS layer falls back to a browser
  mock so you can develop without a device.

## v0.2 additions

- **Open EXE & APK files** — registered document types + UTIs (`.exe`, `.apk`,
  `.mapp`). “Open in MiniOS” from Files / AirDrop / a USB drive imports the file
  and pops the **Compatibility Center**. Inspection is **real**:
  - **APK** → dependency-free ZIP reader + binary `AndroidManifest.xml` (AXML)
    parser: package, label, version, min/target SDK, permissions, activities,
    native `.so` ABIs, DEX presence, Play-Services detection, compat verdict.
  - **EXE** → PE parser: PE32/PE32+, machine (x86/x64/ARM64), subsystem,
    sections, size.
  - *Executing* x86/ART code locally stays out of scope (design rule); heavy
    apps are the future cloud-streaming fallback.
- **USB / external-device detection** — `ExternalAccessory` connect/disconnect
  events for MFi accessories + polling of mounted **removable volumes** (USB
  drives / SD). Live toasts, haptics, and a taskbar `🔌` indicator. (iPadOS has
  no public hot-plug event for generic mass storage, so volumes are polled.)
- **File Provider extension** — `MiniOSFileProvider.appex` exposes the MiniOS
  shared disk inside the **Files app** (enumerate / read / write / delete),
  sharing a common App Group container with the host.
- **App Group** `group.com.euleryu.minios` shared by app + extension.
- **Bundle id** `com.euleryu.minios` (extension `com.euleryu.minios.FileProvider`).
- **Optimizations** — warm WebView process pool, disabled scroll/bounce/inset
  adjustment, debounced (coalesced) virtual-disk writes, host-event push channel.

## v0.3 additions — Phases 6, 8–11

- **Phase 6 — hardware bridges (real, native):**
  - **Camera** ([MediaBridge](MiniOS/Bridge/MediaBridge.swift)) → `UIImagePickerController`, returns a captured JPEG as a data URL. Guest app: **Camera**.
  - **Microphone** → `AVAudioRecorder` (timed record) + playback. Guest app: **Voice Memo**.
  - **Core ML / Vision** ([MLBridge](MiniOS/Bridge/MLBridge.swift)) → built-in `VNClassifyImageRequest` (image labels) + `VNRecognizeTextRequest` (OCR), runs on the Neural Engine, **no bundled model needed**. Guest app: **ML Vision**.
- **Phases 8–9 — Android runtime** ([android.js](MiniOS/web/js/runtime/android.js)): Activity lifecycle (onCreate→onResume→…→onDestroy), an Android-style **widget toolkit** (LinearLayout / TextView / Button / EditText / ImageView), **Intents**, a **Binder-like** service registry, and Android device chrome (status/app/nav bars). Imported APKs render a demo Activity built from the parsed manifest.
- **Phase 10 — Win32 subset** ([win32.js](MiniOS/web/js/runtime/win32.js)): a console host, a small Win32-ish API (`stdout`, `MessageBox`, `GetComputerName`), and a **fake registry** persisted in the VFS. Samples: `hello.exe`, `reg.exe`, `dialog.exe`.
- **Phase 11 — Cloud PC** ([cloudpc.js](MiniOS/web/js/apps/cloudpc.js)): thin-client shell that embeds a remote VM stream URL; MiniOS supplies the local desktop, input, clipboard and audio bridges.
- New apps: **Camera, Voice Memo, ML Vision, Runtimes, Cloud PC**. The **Compatibility Center** now has **Run** buttons (APK → Android runtime, EXE → Win32 subset).

> **Honesty about execution:** the Android and Win32 runtimes are *compatibility
> harnesses*, not a Dalvik/ART VM or an x86 emulator — iPadOS cannot host those.
> They run declarative app specs and manifest-derived demos to exercise the full
> lifecycle/UI/IPC surface. Truly running arbitrary APK/EXE bytecode is the
> **Cloud PC** path. This is the project's stated design rule, not a shortcut.

## v1.4 — Final polish (taskbar previews, Photos zoom, icon, CI)

- **Taskbar hover previews + jump lists** ([shell.js](MiniOS/web/js/shell.js)) —
  hover a taskbar button for a preview card (focus/close); right-click for a jump
  list (Minimize/Restore, Close).
- **Photos viewer with zoom** ([win10apps.js](MiniOS/web/js/apps/win10apps.js)) —
  click a thumbnail for a fullscreen viewer with +/− and scroll zoom, drag to pan,
  and prev/next navigation.
- **App icon + launch screen** — a generated 1024px Windows-style
  [app icon](MiniOS/Assets.xcassets/AppIcon.appiconset/icon-1024.png) (regenerate via
  `node tools/icongen.js`) and a launch screen using it.
- **GitHub Actions CI** ([.github/workflows/ci.yml](.github/workflows/ci.yml)) —
  lints every JS file, validates JSON assets, checks index.html script refs, and
  builds the iOS app (no signing) on a macOS runner.

This is the feature-complete milestone — see [TESTING.md](TESTING.md) and run
`selftest` in the Command Prompt (35/35 passing).

## v1.3 — Window animations, full Settings, smoke tests

- **Window animations** ([wm.js](MiniOS/web/js/kernel/wm.js),
  [desktop.css](MiniOS/web/css/desktop.css)) — open scale-in, close scale-out, and
  minimize/restore transitions.
- **Windows-10 Settings** ([settings.js](MiniOS/web/js/apps/settings.js)) — left
  navigation + **search** ("Find a setting") and full pages: Home, System,
  Personalization, Devices, Network, Accounts (name + PIN), Time & Language
  (24-hour clock), Apps, Update & Security (check, BIOS, reset to re-run setup).
- **Smoke tests** ([selftest.js](MiniOS/web/js/selftest.js), [TESTING.md](TESTING.md)) —
  `selftest` in the Command Prompt (or `SelfTest.run()`) exercises kernel, VFS,
  NVRAM, window manager, runtimes, and launches every app. **35/35 passing.**
  TESTING.md adds a full manual on-device checklist.

## v1.2 — Aero Shake/Peek, tray overflow, Sticky Notes, self-check

- **Aero Shake** ([wm.js](MiniOS/web/js/kernel/wm.js)) — shake a window's title bar to
  minimize all others.
- **Aero Peek / Show desktop** — a thin sliver at the far-right of the taskbar;
  hover to make windows transparent and peek the desktop, click to minimize all.
- **System tray overflow** ([shell.js](MiniOS/web/js/shell.js)) — a ˄ button opens a
  popup of hidden icons / quick toggles (Camera, ML, Network, Audio) + Snip/Tasks.
- **Sticky Notes** ([stickynotes.js](MiniOS/web/js/apps/stickynotes.js)) — multiple
  colored notes, each its own window, autosaved to the VFS, with new/color/delete.
- **Native self-check** ([SelfCheck.swift](MiniOS/Bridge/SelfCheck.swift)) — at launch,
  verifies the App Group container, bundled web runtime, and camera/mic usage
  strings, logging any misconfig to the console (and to the guest via an event)
  so device builds surface entitlement issues early.

## v1.1 — Alt+Tab switcher, calendar flyout, shortcuts

- **Alt+Tab window switcher** ([shell.js](MiniOS/web/js/shell.js)) — hold Alt, press
  Tab to cycle the current desktop's windows; cards show app icon + title +
  thumbnail; release to focus. Shift+Tab goes backward.
- **Calendar / agenda flyout** — clicking the taskbar clock opens a month
  calendar with today highlighted, prev/next navigation, and a per-day agenda you
  can add events to (saved in the VFS).
- **Notifications split out** — a tray 🔔 button opens the Action Center (with the
  unread badge), matching Win10; the clock is now the calendar.
- **Keyboard shortcuts** — the **Win/Meta key alone opens Start**; **Win+/** shows a
  shortcuts cheat-sheet. Win+Tab = Task View, Alt+Tab = switcher (no longer
  conflict).

## v1.0 — Explorer views, Snipping Tool, AC sliders

- **File Explorer overhaul** ([filemanager.js](MiniOS/web/js/apps/filemanager.js)) —
  clickable **breadcrumb path bar**, **view toggle** (List / Details / Large icons),
  and **multi-select** (click, Ctrl-click, Shift-range, Ctrl+A) with bulk
  cut/copy/delete and multi-item drag between windows.
- **Snipping Tool** ([snipping.js](MiniOS/web/js/apps/snipping.js)) — captures the
  screen via a native `WKWebView` snapshot ([SystemBridge.swift](MiniOS/Bridge/SystemBridge.swift)),
  drag to crop a region, then Save to Pictures or Copy to clipboard. (Dev preview
  uses a mock image.)
- **Action Center sliders** ([shell.js](MiniOS/web/js/shell.js)) — **volume** and
  **brightness** sliders; brightness drives a web dim overlay and the native
  `UIScreen.brightness` on device. Values persist in NVRAM.

## v0.9 — Explorer clipboard, setup wizard, badge, Win10 Task Manager

- **Explorer rename + cut/copy/paste** ([filemanager.js](MiniOS/web/js/apps/filemanager.js)) —
  right-click (or long-press) any item for Open / Cut / Copy / Rename / Delete; a
  Paste toolbar button drops into the current folder (with conflict-safe naming).
- **First-run setup wizard** ([setup.js](MiniOS/web/js/setup.js)) — OOBE on first
  boot: device name → theme/accent → wallpaper → optional PIN → done. Persists
  `setupDone` so it runs once.
- **Notification badge** ([shell.js](MiniOS/web/js/shell.js)) — unread count on the
  taskbar clock, cleared when the Action Center is opened.
- **Windows-10 Task Manager** ([win10apps.js](MiniOS/web/js/apps/win10apps.js)) —
  seven tabs (Processes, Performance, App history, Startup, Users, Details,
  Services). Processes are grouped (Apps / Background) with **heat-mapped
  CPU/Memory/Disk/Network columns** and End-task. Performance has a CPU/Memory/
  Disk/Network sidebar (live mini-graphs) and a detailed main graph with
  cores/threads/uptime/adapter stats.

## v0.8 — Lock screen, drag & drop, wallpapers

- **Lock / login screen + power menu** ([lock.js](MiniOS/web/js/lock.js)) — boots to
  a Win10-style lock screen (clock/date) → login (optional PIN in NVRAM) → desktop.
  Start menu and hardware power button open a **power menu**: Sleep/Lock, Sign out,
  Restart, Shut down (with a powered-off screen). **Win/Alt+L** locks.
- **Drag & drop** ([filemanager.js](MiniOS/web/js/apps/filemanager.js)) — drag files/
  folders between File Explorer windows or onto folder rows; recursive move with
  replace-confirm. All open Explorer windows refresh live (`fs:change`).
- **Wallpaper picker** ([settings.js](MiniOS/web/js/apps/settings.js),
  [kernel.js](MiniOS/web/js/kernel/kernel.js)) — Settings → Personalization: 7 preset
  gradients + a custom color, persisted in NVRAM and applied instantly.

## v0.7 — Downloads, Virtual Desktops, one-command build

- **Downloads manager** ([downloads.js](MiniOS/web/js/apps/downloads.js)) — list,
  open (text→Notepad, images→Photos), delete, clear, and reveal in File Explorer.
- **Virtual desktops + Task View** ([wm.js](MiniOS/web/js/kernel/wm.js),
  [shell.js](MiniOS/web/js/shell.js)) — multiple desktops, a 🗂️ Task View overview
  to switch/add/remove desktops, move windows between them, and close windows.
  Keys: **Win/Alt+Tab** (Task View), **Win/Alt+Ctrl+←/→** (switch),
  **Win/Alt+Ctrl+D** (new desktop). The taskbar shows only the current desktop's
  windows.
- **One-command build** — [build.sh](build.sh) + [ExportOptions.plist](ExportOptions.plist):
  `./build.sh` archives and exports a signed `.ipa`; `./build.sh upload` pushes to
  App Store Connect via `altool`. Set your `teamID` in `ExportOptions.plist` first.

## v0.6 — Snap Layouts, Widgets, Search, downloads, Task Manager

- **Snap Layouts** — hover the window maximize button for a Win11-style flyout
  (halves / thirds / quadrants); click a zone to snap. Plus drag-to-edge and
  Win/Alt+arrows. ([wm.js](MiniOS/web/js/kernel/wm.js))
- **Widgets panel** — 🌤️ taskbar button (or Win/Alt+W): clock/date, weather
  placeholder, live system card, and a saved quick note. ([shell.js](MiniOS/web/js/shell.js))
- **Search panel** — the taskbar search box opens an app grid that filters as you
  type, with a "search the web" action that launches the Browser.
- **Browser downloads → `/Downloads`** — the native browser captures downloads
  (`WKDownloadDelegate`), saves them to the shared Downloads container, and the
  guest records them in the MiniOS `/Downloads` folder with a toast.
  ([BrowserBridge.swift](MiniOS/Bridge/BrowserBridge.swift))
- **Task Manager** — tabbed **Processes / Performance / Startup**, with End-task
  and live CPU + Memory area graphs. ([win10apps.js](MiniOS/web/js/apps/win10apps.js))

## v0.5 — native browser + Win10 feature set

- **Native browser engine** ([BrowserBridge.swift](MiniOS/Bridge/BrowserBridge.swift) +
  [browser.js](MiniOS/web/js/apps/browser.js)): each tab is a **real `WKWebView`**
  overlaid on the runtime and positioned to match the browser window, so sites
  that block iframes (Google, YouTube, banks) load normally. Live title/loading/
  back-forward state flows back via host events; the overlay tracks window
  move/resize/minimize/focus. In the dev preview it falls back to an iframe.
- **Window snapping** ([wm.js](MiniOS/web/js/kernel/wm.js)): drag a window to a
  screen edge/corner to snap (halves + quadrants + maximize), or use
  **Win/Alt + ←↑→↓**.
- **Action Center**: click the taskbar clock for quick toggles (Network, Sound,
  Light mode, Camera) + scrollable notification history with "Clear all".
- **Taskbar right-click → Task Manager / settings.**
- **New Win10-style apps** ([win10apps.js](MiniOS/web/js/apps/win10apps.js)):
  **Task Manager** (process list + End task), **Notepad**, **Calculator**,
  **Paint** (canvas, save to Pictures), **Photos** (gallery of saved images),
  **Clock** (+ stopwatch), **Recycle Bin** (restore / empty).
- Plus existing: File Explorer, Settings, Command Prompt, App Center,
  Compatibility Center, Camera, Voice Memo, ML Vision, Runtimes, Browser.

## Offline-first (v0.4)

MiniOS now runs **fully offline**. The only component that uses the network is the
**Browser**. Cloud PC / remote-streaming was removed.

- **Command Prompt** ([terminal.js](MiniOS/web/js/apps/terminal.js)) — cmd.exe-style
  shell. Drive `C:\` maps to the VFS root; backslash paths, `<DIR>` listings,
  command history (↑/↓). Commands: `dir cd cls type echo copy move del md rd ren
  tree ver vol date time set title whoami hostname clip start ps sysinfo ipconfig
  ping(offline) exit`.
- **Browser** ([browser.js](MiniOS/web/js/apps/browser.js)) — Chrome-like: multi-tab
  bar with new-tab/close, omnibox (URL or DuckDuckGo search), back/forward/reload/
  home, start page with quick links. Pages load in sandboxed iframes (sites that
  send X-Frame-Options can't be embedded — shown as a notice).
- **EXE/APK** run on-device only via the local harnesses (Android runtime / Win32
  subset). No streaming, no network needed.

## Real execution paths (v1.6)

Two genuine (limited) ways to actually execute real binaries on-device, no JIT:

- **x86 Emulator** ([emulator.js](MiniOS/web/js/apps/emulator.js)) — integrates
  **v86**, a real software x86 CPU (WASM interpreter). Boots a guest OS image
  (FreeDOS to run real DOS `.exe`/`.com`, or Linux for ELF) and executes real
  16/32-bit x86 code. Loads the engine + image over the network on first use.
  Limits: **32-bit only** (no x86-64), slow, needs a bootable disk image, no
  modern 64-bit Windows.
- **DEX interpreter** ([dex.js](MiniOS/web/js/runtime/dex.js)) — parses a real
  Android `classes.dex` (extracted natively from the APK by
  [BinaryBridge](MiniOS/Bridge/BinaryBridge.swift)) and **interprets a subset of
  Dalvik bytecode**: integer arithmetic, branches/loops, static + virtual calls,
  and `System.out.print(ln)`. Trivial Java/Kotlin console programs run for real;
  the first unsupported opcode is reported and execution stops. Not ART — no
  native libs, no Android framework/UI, no Play Services.

In the **Compatibility Center**, an imported EXE shows **"Run in x86 Emulator
(real)"** and an APK shows **"Execute DEX (real)"** alongside the harness.

> Still impossible on stock iPadOS: arbitrary **64-bit** EXEs, modern Windows
> apps, and full Android APKs. That requires JIT / native code loading that Apple
> forbids. The above is the real ceiling; everything heavier is genuinely not
> runnable locally on an unmodified iPad.

## Running "most" EXE & APK — how, and the honest limit

**Hard constraint:** stock iPadOS forbids JIT and arbitrary native-code
execution. Real x86 (EXE) and Dalvik/ART (APK) bytecode therefore **cannot run
locally at good performance** — only slow interpretation, and only for trivial
apps. There is no way around this without a jailbreak. So "most binaries, little
performance cost, locally" is not physically possible on iPad.

**What MiniOS does — the offline Universal Launcher**
([launcher.js](MiniOS/web/js/runtime/launcher.js)) runs every binary on-device:

| Binary | Route |
|--------|-------|
| APK | **Android runtime** harness — Activity lifecycle + widget toolkit (real Activities for simple Java/Kotlin apps; manifest-derived session otherwise) |
| EXE | **Win32 subset** — console host + Win32-ish API + fake registry; PE-derived session |

Imported binaries are inspected (real PE / Android-manifest parsing) in the
**Compatibility Center**; the **Run on-device** button launches the matching
harness. No network is used.

> Honest limit: arbitrary EXE/APK **bytecode cannot execute** on stock iPadOS
> (no JIT / native code — an Apple platform rule). The harnesses run simple apps
> and inspection-derived demos; they are not a Dalvik/ART VM or x86 emulator.

## Project layout

```
MiniOS.xcodeproj/         Xcode project (2 targets, synchronized groups)
MiniOS/
  MiniOSApp.swift         App entry; onOpenURL import + File Provider domain
  HostView.swift          Optimized WKWebView host
  MiniOS.entitlements     App Group
  Bridge/
    BridgeRouter.swift    one channel → bridges; pushes host events to JS
    FilesBridge.swift     persistent virtual disk
    ClipboardBridge.swift system pasteboard
    SystemBridge.swift    device info / haptics / log
    BinaryBridge.swift    EXE (PE) + APK inspection
    ZipReader.swift       dependency-free ZIP (STORE + DEFLATE via Compression)
    AXMLParser.swift      Android binary-XML parser
    USBBridge.swift       ExternalAccessory + removable-volume detection
    ImportManager.swift   incoming EXE/APK/.mapp files
    DomainRegistrar.swift registers the Files-app domain
    HostEvents.swift      host→guest event bus
  Info.plist              document types, UTIs, file sharing
  Assets.xcassets/
  web/                    MiniOS runtime (bundled)
    js/kernel/  js/apps/  js/{bios,boot,shell,main}.js
FileProvider/             File Provider extension target
  FileProviderExtension.swift  FileProviderEnumerator.swift  FileProviderItem.swift
  Info.plist  FileProvider.entitlements
```

> **Signing note:** App Groups, the File Provider extension, and ExternalAccessory
> all require a real **Team** in *Signing & Capabilities* for both targets. Set
> your team once on each target; Xcode provisions the App Group automatically.

## Build & run (Xcode)

Requires **Xcode 16+** on macOS (the project uses a file-system-synchronized
group, `objectVersion = 77`).

1. `open MiniOS.xcodeproj`
2. Select the **MiniOS** scheme, pick an iPad Simulator (or your device).
3. Press **Run** (⌘R).

> The `MiniOS/` folder is a synchronized group, so any file you add under it
> (Swift source or web asset) is picked up automatically — no manual “Add files”.

## Install on a physical iPad

1. In Xcode → project → **Signing & Capabilities**, set your **Team** and a
   unique **Bundle Identifier** (default `com.yu314.minios`).
2. Connect the iPad, select it as the run destination, press **Run**.
3. On the iPad: **Settings → General → VPN & Device Management** → trust your
   developer certificate (only needed for free/personal teams).

## Ship via App Store Connect / TestFlight

1. Set the run destination to **Any iOS Device (arm64)**.
2. **Product → Archive**.
3. In the Organizer: **Distribute App → App Store Connect → Upload**.
4. In [App Store Connect](https://appstoreconnect.apple.com): create the app
   record (matching bundle id), then add the build to **TestFlight** for internal
   testing, or submit for review.

Requires a paid **Apple Developer Program** membership for App Store Connect /
TestFlight distribution.

## Develop the runtime without a device

Open `MiniOS/web/index.html` in any browser (or the inline preview). The bridge
layer detects the absence of the host and uses a `localStorage`-backed mock, so
the entire desktop is usable for fast iteration. On device, the same JS talks to
the Swift bridges instead.

## Roadmap (from the project spec)

- **Phase 8+**: DEX runtime, simple Android Activity/UI, file/network/audio/input
  bridges for limited Java/Kotlin APKs.
- **Camera / Microphone / Core ML bridges** (host side), wired to virtual
  devices toggled in BIOS.
- **`.mapp` signing + an SDK** for third-party native MiniOS apps.
- **Snapshots/backups** and import/export with the iPad Files app via the
  document picker.

## Design rule

This is **not** a full PC/Android emulator — no x86, BIOS-on-metal, PCI, or
Windows drivers. It uses custom paravirtual devices bridged to iPadOS. Full
Windows/Android local compatibility is explicitly out of scope; heavy apps are a
future cloud-streaming fallback.
