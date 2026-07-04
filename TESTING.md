# MiniOS — Test Checklist & Smoke Tests

## Automated smoke test (in-guest)

Open **Command Prompt** in MiniOS and run:

```
selftest
```

It exercises the kernel, VFS, NVRAM, window manager, runtimes, and launches
every registered app, printing `[PASS]`/`[FAIL]` per check and a summary.
You can also run `SelfTest.run()` from the web inspector — it returns
`{ pass, fail, total, results }`.

During web development you can drive it headless:

```js
// in the browser console after MiniOS boots
SelfTest.run()
```

## Manual on-device checklist (after installing the IPA)

### Boot & shell
- [ ] First launch shows the **setup wizard** (name → theme → wallpaper → PIN → done)
- [ ] **Lock screen** appears on boot; clock updates; click/Enter → login → desktop
- [ ] Startup chime plays (if enabled) and a welcome notification shows
- [ ] Taskbar: Start, Widgets (🌤️), Task View (🗂️), search, tray, 🔔, clock

### Windows
- [ ] Open/close/minimize/maximize animate smoothly
- [ ] Drag to move; drag to edge to **snap** (halves / corners / maximize)
- [ ] Hover **maximize** → Snap Layouts flyout; pick a zone
- [ ] **Aero Shake** a title bar → other windows minimize
- [ ] **Win/Alt+arrows** snap; **Alt+Tab** switcher; **Win+Tab** Task View
- [ ] Resize handle works

### Virtual desktops
- [ ] Task View: add/remove desktops, move windows, switch (Win+Ctrl+←/→)
- [ ] Taskbar shows only the current desktop's windows

### Apps
- [ ] **File Explorer**: breadcrumb, List/Details/Icons views, multi-select,
      cut/copy/paste, rename, drag-drop between windows
- [ ] **Command Prompt**: `dir`, `cd`, `type`, `tree`, `set`, `selftest`, `exit`
- [ ] **Browser**: loads Google/YouTube (native engine), tabs, downloads → /Downloads
- [ ] **Settings**: left nav + search; change theme/accent/wallpaper, PIN, 24h clock
- [ ] **Task Manager**: Processes (heat columns) + Performance graphs + other tabs
- [ ] **Snipping Tool**: capture → crop → save to Pictures
- [ ] **Sticky Notes**, **Paint**, **Photos**, **Notepad**, **Calculator**, **Clock**
- [ ] **Camera / Voice Memo / ML Vision** prompt for permission and work
- [ ] **Compatibility Center**: import an .apk/.exe → inspect → Run on-device
- [ ] **Downloads**, **Recycle Bin**, **App Center**

### Tray / flyouts
- [ ] 🔔 opens Action Center (volume + brightness sliders, toggles, history)
- [ ] Notification **badge** increments; clears on opening Action Center
- [ ] Clock opens **calendar/agenda**; add an event
- [ ] Tray **overflow** (˄) popup; **Show desktop** sliver peeks/minimizes

### Power
- [ ] Start/power button → Sleep/Lock, Sign out, Restart, Shut down
- [ ] Win+L locks

### Native bridges (device only)
- [ ] Files persist across relaunch (host disk)
- [ ] Clipboard copy/paste interops with other iPad apps
- [ ] Open an EXE/APK from Files / AirDrop → lands in Compatibility Center
- [ ] USB drive / MFi accessory connect → toast + tray indicator
- [ ] MiniOS folder appears in the iPad **Files app** (File Provider)
- [ ] Console shows `[MiniOS][SelfCheck] ✅ all checks passed`

## Build sanity
- [ ] `./build.sh archive` succeeds (Team set on both targets)
- [ ] `./build.sh export` produces an `.ipa` (teamID set in ExportOptions.plist)
