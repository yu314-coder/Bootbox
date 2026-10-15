/* ============================================================================
 * x86 Emulator — REAL software x86 CPU via v86 (WebAssembly interpreter, no JIT,
 * App-Store legal). Boots a guest OS image and actually executes real 16/32-bit
 * x86 code. This is the genuine way to run real .exe / .apk-class systems on iPad.
 *
 * Engine + BIOS are bundled locally (web/vendor/v86) so the emulator runs OFFLINE.
 * Default guests are the project's own built ISOs, streamed from the app via the
 * native `vmres://` scheme (range requests — the 400MB+ ISO is NOT loaded whole
 * into RAM):
 *   • MiniLinux i386  (vmres://iso/minilinux-i386.iso) — Linux + Wine, runs .exe
 *   • Android-x86 32  (vmres://iso/android-i386.iso)   — runs .apk
 *
 * Limits (honest): 32-bit only (no x86-64); v86 is an interpreter, so a full
 * distro boots slowly and is memory-hungry. With JIT (sideloaded build) it is
 * far faster. Modern 64-bit Windows cannot run here.
 * ============================================================================ */
(function () {
  // Local (offline) engine; CDN is only a fallback if a file is missing.
  const LIB = "vendor/v86/libv86.js";
  const WASM = "vendor/v86/v86.wasm";
  const BIOS = "vendor/v86/bios/seabios.bin";
  const VGABIOS = "vendor/v86/bios/vgabios.bin";
  const LIB_CDN = "https://cdn.jsdelivr.net/npm/v86@latest/build/libv86.js";

  // Guest profiles. No OS image is bundled in the app — every system is an ISO
  // the user downloads (Bootbox BIOS) or imports themselves, booted via "custom".
  //  • boot:"cdrom" → boot an ISO/disk image.   • boot:"q64" → 64-bit via QEMU-Wasm.
  //  • state        → optional gzipped v86 snapshot for instant restore: a hosted URL,
  //                   or an imported NAME.img auto-pairs with a NAME.img.state.gz beside it.
  const GUESTS = [
    { id: "custom",    name: "Windows / ISO / disk image…",                          boot: "cdrom",
      url: "", kind: "cdrom", ram: 512, vga: 32 },
    // tune max: Linux + X + Wine compile ~34K distinct blocks across 2 vCPUs; with the default 15000
    // the engine evicted and recompiled them nonstop, and under JavaScriptCore every recompiled block
    // leaves memory behind (a CPU-Z run grew the page by ~15 MB/s until WebKit killed it). 40000 holds
    // the working set (Mac-measured: no recompiles, growth ~5 MB/s); the engine still evicts the
    // least-recently-run blocks past it, and lowers the cap itself if the host refuses a compile.
    { id: "x64pw",     name: "Linux (Terminal)",  boot: "q64",
      base: "vendor/qemu-aload/", url: "", ram: 1536, tune: { max: 40000 } },
    // Lightweight graphical desktop: its OWN image (no Wine). openbox/tint2 (v8) + terminal, PCManFM,
    // Dillo, Claude Code, Python, mc. Reuses the x86_64 engine (wasm shared from
    // qemu-aload — no duplication). The image auto-starts the desktop, so boot64 sends no start-desktop.
    { id: "x64pwd",    name: "Linux (Desktop)",  boot: "q64",
      base: "vendor/qemu-desktop/", wasm: "../qemu-aload/qemu-system-x86_64.wasm", url: "", ram: 1536, gui: true,
      tune: { max: 40000 } },   // same reason as x64pw
    { id: "android64", name: "Android", boot: "q64",
      base: "vendor/qemu-android/", engineBase: "vendor/qemu-aload/", wasm: "qemu-system-x86_64.wasm",   // shared x86_64 engine
      url: "", ram: 1280, minRam: 1280, maxRam: 1280, cores: 4, minCores: 4, maxCores: 4, gui: true, android: true,   // RAM + cores fixed by the warm snapshot
      // Android's code footprint overflows the engine's default 15000 live compiled blocks (shared by
      // all 4 vCPUs) → constant evict/recompile churn. Mac-measured cold Settings launch: v3 1-core 605s,
      // v4 4-core 314s, v4 + max=45000 53-109s. A host that can't hold that many just interprets past it.
      tune: { max: 45000 } },
    // (The ARM64 guest — vendor/qemu-aarch64/, its own engine — is no longer offered: the systems are
    // Linux Desktop, Linux Terminal, Android, and the Windows images through the ISO/disk path.)
  ];

  // The 64-bit Linux rootfs (~213 MB compressed) is NOT bundled in the app — it's hosted on a GitHub
  // release and downloaded ONCE on first boot, then cached in the imports store (LocalServer.swift
  // serves it from there for subsequent boots). Keeps the app download small. Keyed by guest base.
  // Each base lists the file(s) to fetch on first boot. Cache filenames are TAGGED with the inflated
  // byte size so a rebuilt image (different size → different name → fresh download) can never stale-
  // cache against the bundled load.js. The amd64 engine wasm is bundled (only the rootfs downloads);
  // the aarch64 guest downloads BOTH its engine wasm AND rootfs (neither is bundled — keeps the app
  // small). LocalServer.swift resolves these same names. BUMP the size tag when re-uploading an image.
  const ROOTFS_REMOTE = {
    // `size` = the exact release-asset byte count: the native side re-downloads on any
    // mismatch (build 64 — heals caches poisoned by a saved GitHub error body, the
    // on-device "TypeError: Load failed" bug) and rejects truncated transfers.
    "vendor/qemu-aload/": { files: [
      // v5 (build 71): WINE-OPTIMIZED (manim unbundled per user direction — download back to
      // ~310MB). WINEESYNC=1 + WINEDEBUG=-all defaults (PATH wrapper + profile), deeper warm-up
      // (cmd/notepad/winecfg/regedit/winemine first-runs paid at build time), FontSmoothing off,
      // Xvnc early-start kept. Pairs with the 3392MB-heap cx16 engine + tb-size 256 (wine's PE
      // working set). Mac-verified: boot t+25s, wrapper+esync live, X-IS-UP.
      { url: "https://github.com/yu314-coder/Bootbox/releases/download/linux64-v5/qemu64-v5-rootfs.data.gz",
        name: "qemu64-v5-rootfs-945742898.data.gz", mb: 310, size: 309846482 },
    ] },
    "vendor/qemu-aarch64/": { files: [
      { url: "https://github.com/yu314-coder/Bootbox/releases/download/linux-arm64-v1/qemu-aarch64-engine.wasm.gz",
        name: "qemu-aarch64-engine-16240484.wasm.gz", mb: 4, size: 4142861 },
      { url: "https://github.com/yu314-coder/Bootbox/releases/download/linux-arm64-v1/qemu-aarch64-rootfs.data.gz",
        name: "qemu-aarch64-rootfs-265519785.data.gz", mb: 57, size: 60000998 },
    ] },
    "vendor/qemu-desktop/": { files: [   // x86_64 engine shared from qemu-aload; only the rootfs downloads
      // desktop v9 (build 95): v8's openbox desktop + a Benchmarks section in the Apps menu - CPU-Z
      // (64-bit Wine, warmed prefix) and glmark2 on Mesa llvmpipe, preinstalled; Xvnc -DeferUpdate 10.
      { url: "https://github.com/yu314-coder/Bootbox/releases/download/linux-desktop-v9/qemu-desktop9-rootfs.data.gz",
        name: "qemu-desktop9-rootfs-1300120755.data.gz", mb: 410, size: 430297987 },
    ] },
    // Android is a full AOSP x86_64 userspace on Bootbox's QEMU guest kernel.
    // The rootfs is download-on-demand; the x86_64 engine is shared with Linux.
    "vendor/qemu-android/": { files: [
      // v6 (build 95): 800x600 @125 dpi (same layout, ~40% fewer pixels to render and compose) with HWUI
      // on Skia/Vulkan instead of ANGLE GL (cold app launches ~2x faster); Settings, Files, the WebView
      // browser, Gallery, Contacts, Clock and Calendar were launched before the snapshot so the ones
      // still in memory resume instead of cold-starting; plain touchscreen + keyboard (v5), no bg dexopt.
      { url: "https://github.com/yu314-coder/Bootbox/releases/download/android64-v6/qemu-android64-warm6-2141954248.data.gz",
        name: "qemu-android64-warm6-2141954248.data.gz", mb: 911, size: 954588021 },
    ] },
  };
  // Ensure the guest's rootfs is present before booting: trigger the native download (BinaryBridge
  // "download" → Downloader, progress via "downloadProgress" events) and wait for it. No-op for
  // bundled guests or when the native bridge isn't present (e.g. the Mac test harness).
  // Expand a downloaded guest pack (NAME.data.gz → NAME.data) once, on disk (BinaryBridge "gunzip":
  // atomic .part → rename, deletes the .gz on success). LocalServer then serves the raw pack with Range
  // and load.js reads the guest disk on demand (vendor/qemu/lazypack.js) instead of loading the whole
  // pack — up to 1.9 GB — into page memory, which failed on the iPad ("TypeError: Load failed").
  // Resolves true when NAME.data exists (already or now); false when the .gz isn't downloaded yet.
  async function expandPack(gzName, rawName, g, status) {
    let r;
    try { r = await Bridge.call("binary", "gunzip", { src: gzName, dst: rawName }); }
    catch (e) { return false; }                      // "source not found": download it first
    if (r && r.cached) return true;
    const label = g.android ? "Android image" : "Linux image";
    await new Promise((resolve, reject) => {
      const handler = (p) => {
        if (!p || p.name !== rawName) return;
        if (p.done) { if (Bridge.offEvent) Bridge.offEvent("gunzipProgress", handler); p.ok ? resolve() : reject(new Error(p.error || "expand failed")); return; }
        const pct = p.total > 0 ? Math.round(p.received / p.total * 100) + "%" : ((p.received / 1048576) | 0) + " MB";
        try { status.textContent = "Preparing the " + label + " (one-time, stays on this iPad)… " + pct; } catch (e) {}
      };
      Bridge.onEvent("gunzipProgress", handler);
    });
    return true;
  }

  async function ensureRootfs(g, status, setState) {
    const cfg = ROOTFS_REMOTE[g && g.base];
    if (!cfg) return;
    if (!window.Bridge || typeof Bridge.call !== "function") return;
    for (const f of cfg.files) {                     // download each part (aarch64 = engine + rootfs)
      const raw = /\.data\.gz$/.test(f.name) ? f.name.replace(/\.gz$/, "") : null;   // guest packs only
      if (raw) {
        try { if (await expandPack(f.name, raw, g, status)) continue; }   // expanded already (or just now)
        catch (e) { console.warn("pack expand failed; using the compressed pack:", e); continue; }
      }
      let r;
      try { r = await Bridge.call("binary", "download", { url: f.url, name: f.name, size: f.size || 0 }); }
      catch (e) { throw new Error("couldn't start the image download — " + ((e && e.message) || e)); }
      if (r && r.cached) continue;                   // already downloaded on a previous boot
      try { if (setState) setState("Downloading…"); } catch (e) {}
      await new Promise((resolve, reject) => {
        let last = -1;
        const handler = (p) => {
          if (!p || p.name !== f.name) return;
          if (p.done) { if (Bridge.offEvent) Bridge.offEvent("downloadProgress", handler); p.ok ? resolve() : reject(new Error(p.error || "download failed")); return; }
          const mb = (p.received / 1048576) | 0;
          const pct = p.total > 0 ? (Math.round(p.received / p.total * 100) + "% ") : "";
          if (mb !== last) {
            last = mb;
            try {
              const label = g.android ? "Android image" : "Linux image";
              status.textContent = "Downloading " + label + " (one-time, ~" + f.mb + " MB)… " + pct + mb + " MB";
            } catch (e) {}
          }
        };
        Bridge.onEvent("downloadProgress", handler);
      });
      if (raw) {
        try { await expandPack(f.name, raw, g, status); }
        catch (e) { console.warn("pack expand failed; using the compressed pack:", e); }
      }
    }
  }

  // Fetch + gunzip a bundled .gz into an ArrayBuffer (for instant-boot snapshots).
  async function fetchGunzip(url) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("state fetch failed");
    if (typeof DecompressionStream !== "undefined") {
      const ds = new DecompressionStream("gzip");
      return await new Response(resp.body.pipeThrough(ds)).arrayBuffer();
    }
    return await resp.arrayBuffer(); // assume already raw
  }
  const CFG = "/Apps/.emulator.json";
  let cachedPerf = null; // device emulation-speed benchmark (run once)

  function cfg() { try { return JSON.parse(VFS.read(CFG) || "{}"); } catch (e) { return {}; } }
  function setCfg(c) { VFS.write(CFG, JSON.stringify(Object.assign(cfg(), c))); }

  // When the app is served from the loopback HTTP server (http://127.0.0.1), fetch
  // VM images SAME-ORIGIN — LocalServer serves /vmres/<…> with HTTP range support,
  // so there is no cross-origin CORS hiding the Content-Range header, which is what
  // breaks v86's async streaming ("Range: bytes=… header not supported (Got '')").
  // Falls back to the vmres:// custom scheme when not on http (e.g. app:// origin).
  function resolveVmres(url) {
    if (typeof url === "string" && url.indexOf("vmres://") === 0 && location.protocol === "http:") {
      return location.origin + "/vmres/" + url.slice(8);
    }
    return url;
  }

  // Touch-as-mouse for v86 on iPad: the guest pointer goes WHERE THE FINGER IS. Tap = left click
  // (+ summon the keyboard), press & drag = drag, two-finger tap = right click, two-finger drag =
  // wheel. A Magic Keyboard trackpad / mouse drives the same absolute pointer.
  //
  // v86 only has a RELATIVE PS/2 mouse, so "put the cursor at (x, y)" = slam it into the top-left
  // corner, then move by known amounts. Two guest facts make naive deltas land wrong (measured on
  // Win98 in the simulator, 2026-10):
  //   1. Windows drops a PS/2 packet that arrives while it is still handling the previous one, and
  //      v86 delivers everything sent in one JS turn back-to-back in guest time: of a burst only the
  //      FIRST packet counted. The old code sent the corner slam + the move + the button press in one
  //      burst — taps landed near the corner and presses vanished ("cannot click"). So packets go out
  //      one per guest time slice from a queue (pump() runs inside v86's tick, once the guest has
  //      drained the previous packet).
  //   2. Windows accelerates: a packet bigger than MouseThreshold1 moves 2x (4x past Threshold2), per
  //      the user's mouse settings (this Win98 image: 1-2 px -> 1:1, 3..127 px -> 2x). So a one-time
  //      calibration measures what each packet size really moves — it finds the cursor by diffing
  //      the top rows of the framebuffer — and moves are composed from those measured sizes (cached
  //      per disk image; one probe re-checks it each session).
  // A packet axis is 9-bit (-256..255), so every packet stays within +-127.
  function installV86TouchMouse(emulator, opts) {
    opts = opts || {};
    const container = opts.container || document.getElementById(opts.containerId || "screen_container");
    if (!container || !emulator || !emulator.bus) return;
    const kbd = opts.keyboardInput || null;
    const statusEl = opts.status || null;
    const bus = emulator.bus;
    const TAP_TOL = 10, TAP_MS = 250;
    const say = (t, ms) => { if (!statusEl) return; try { statusEl._hold = nowMs() + (ms || 4000); statusEl.textContent = t; } catch (e) {} };

    // v86 internals (guarded: without them we fall back to timer pacing).
    const v86 = () => { try { return emulator.v86 || null; } catch (e) { return null; } };
    const ps2 = () => { try { return emulator.v86.cpu.devices.ps2; } catch (e) { return null; } };
    const screenCanvas = () => container.querySelector(":scope > canvas");
    // v86's own mouse adapter would ALSO turn touch/trackpad motion into relative deltas (and send
    // its own unpaced clicks/wheel) — double movement. All pointer input is driven from here.
    try { emulator.mouse_set_status(false); } catch (e) {}
    try { if (emulator.mouse_adapter) Object.defineProperty(emulator.mouse_adapter, "is_running", { get() { return false; }, set() {}, configurable: true }); } catch (e) {}

    // ---- paced packet queue ----
    // ops: {k:"slam"} corner-home | {k:"go",x,y} chase a guest pixel | {k:"btn",b:[l,m,r]} |
    //      {k:"wheel",d} | {k:"raw",dx,dy} | {k:"fn",f} callback once everything before it is sent.
    const ops = [];
    let cur = null;                 // believed guest cursor position (guest px); null = unknown
    let lastSentTick = -1, tick = 0, lastSentMs = 0, hooked = false, kickTimer = 0, lastDownMs = -1e9, homedMs = -1e9;
    const size = () => { const cv = screenCanvas(); return cv && cv.width ? [cv.width, cv.height] : [800, 600]; };
    const send = (dx, dy) => { try { bus.send("mouse-delta", [dx, dy]); } catch (e) {} };
    function step() {
      const p = ps2();
      if (p && p.mouse_buffer && p.mouse_buffer.length) return;    // guest hasn't read the last packet yet
      while (ops.length) {
        const op = ops[0];
        if (op.k === "fn") { ops.shift(); try { op.f(); } catch (e) {} continue; }
        if (op.k === "go") {
          if (ops[1] && ops[1].k === "go") { ops.shift(); continue; }      // only the latest target matters
          if (!cur) { ops.unshift({ k: "slam" }); continue; }
          const [w, h] = size();
          const tx = Math.max(0, Math.min(w - 1, Math.round(op.x))), ty = Math.max(0, Math.min(h - 1, Math.round(op.y)));
          // One axis per packet (Windows accelerates on the larger axis, so mixing them would skew
          // the smaller one). A remainder no packet can make (e.g. 1 px when 1 px moves 2) is dropped.
          const mx = tx !== cur.x ? pick(tx - cur.x) : null;
          if (mx) { send(mx[0], 0); cur.x += mx[1]; return true; }
          cur.x = tx;
          const my = ty !== cur.y ? pick(ty - cur.y) : null;
          if (my) { send(0, -my[0]); cur.y += my[1]; return true; }      // v86: +dy = up
          cur.y = ty;
          ops.shift();
          continue;
        }
        if (op.k === "slam") {
          if (op.n === undefined) { const [w, h] = size(); op.n = Math.ceil((Math.max(w, h) + 64) / 100); }
          send(-100, 100);
          if (--op.n <= 0) { ops.shift(); cur = { x: 0, y: 0 }; homedMs = nowMs(); }
          return true;
        }
        if (op.k === "btn") {
          // Hold a press >= 80 ms before releasing: Windows 2000 ignores a down/up that arrive in
          // back-to-back slices (the button just takes focus), and a quick tap is shorter than that
          // once the press has waited behind the cursor move.
          const isDown = op.b[0] || op.b[1] || op.b[2];
          if (!isDown && nowMs() - lastDownMs < 80) return false;
          ops.shift();
          try { bus.send("mouse-click", op.b); } catch (e) {}
          if (isDown) lastDownMs = nowMs();
          return true;
        }
        ops.shift();
        if (op.k === "wheel") { try { bus.send("mouse-wheel", [op.d, 0]); } catch (e) {} return true; }
        if (op.k === "raw") { send(op.dx, op.dy); return true; }
      }
      return false;
    }
    // One packet per v86 tick (= one guest time slice), so the guest finishes handling a packet
    // before the next arrives. Hooked into v86's own loop; until that exists, a 6 ms timer paces.
    function hook() {
      if (hooked) return true;
      const g = v86();
      if (!g || typeof g.do_tick !== "function") return false;
      const orig = g.do_tick;
      g.do_tick = function () {
        tick++;
        // >= 1 whole guest slice AND >= 3 ms since the last packet (natural ticks are ~3.5 ms on an
        // idle Win98 desktop; never force extra ticks — shorter slices = dropped packets again).
        if (ops.length && tick - lastSentTick >= 1 && nowMs() - lastSentMs >= 3 && step()) { lastSentTick = tick; lastSentMs = nowMs(); }
        return orig.apply(this, arguments);
      };
      hooked = true;
      return true;
    }
    function kick() {
      if (hook() || kickTimer) return;
      kickTimer = setTimeout(function k3() {
        kickTimer = 0;
        if (hook()) { kick(); return; }
        if (nowMs() - lastSentMs >= 6 && step()) lastSentMs = nowMs();
        if (ops.length) kickTimer = setTimeout(k3, 6);
      }, 6);
    }
    const push = (op) => { ops.push(op); kick(); };
    const done = () => new Promise((r) => push({ k: "fn", f: r }));

    // ---- acceleration curve: measured pairs [packet px, guest px moved], ascending ----
    let curve = [[1, 1], [2, 2]];   // safe until calibrated (small packets are 1:1 under any usual setting)
    let calibrated = false, calibrating = null, calibTries = 0, calibNote = "";
    // Cached per disk image in the emulator config (the app's persistent VFS — localStorage would
    // not survive a relaunch: LocalServer gets a new port, i.e. a new origin, every launch).
    const key = String(opts.key || "default").slice(-120);
    const savedCurves = () => { try { return cfg().v86curves || {}; } catch (e) { return {}; } };
    const saveCurve = (c) => { try { const all = savedCurves(); if (c) all[key] = c; else delete all[key]; setCfg({ v86curves: all }); } catch (e) {} };
    { const c = savedCurves()[key]; if (Array.isArray(c) && c.length >= 2) curve = c; }
    // Largest packet whose measured (or same-ratio interpolated) movement doesn't overshoot |e|.
    function pick(e) {
      const a = Math.abs(e), sg = e < 0 ? -1 : 1;
      let best = null;
      for (let i = 0; i < curve.length; i++) {
        const [p0, f0] = curve[i], r = f0 / p0;
        let p1 = p0;   // extend through following points with the same ratio (Windows' curve is stepwise)
        for (let j = i + 1; j < curve.length && Math.abs(curve[j][1] / curve[j][0] - r) < 1e-6; j++) p1 = curve[j][0];
        const p = Math.min(p1, Math.floor(a / r + 1e-9));
        if (p >= p0) { const mv = Math.round(r * p); if (mv > 0 && (!best || mv > best[1])) best = [p, mv]; }
      }
      return best ? [sg * best[0], sg * best[1]] : null;
    }
    // Find the cursor: probe moves along the top edge. Diff the top rows of the framebuffer just
    // before (cursor in the corner, columns [0, cw)) and just after the probe (cursor at [f, f+cw)):
    // the rightmost changed column is f + cw - 1. cw (the cursor's width) comes from a probe big
    // enough that the two cursor images don't touch. Before/after are ~0.1 s apart, so desktop
    // changes (an icon getting selected, the clock) don't leak into the measurement.
    const ROWS = 16;
    function strip() {
      const cv = screenCanvas(); if (!cv || !cv.width) return null;
      // Copy the guest framebuffer to the canvas now: v86 otherwise paints on animation frames, and
      // WebKit pauses those briefly (e.g. while the iPad keyboard comes up after a tap) — two equal
      // stale frames then looked "settled" and the probe saw no cursor at all.
      try { const sa = emulator.screen_adapter; if (sa && typeof sa.update_graphical === "function") sa.update_graphical(); } catch (e) {}
      try { return { w: cv.width, d: cv.getContext("2d").getImageData(0, 0, cv.width, ROWS).data }; } catch (e) { return null; }
    }
    function changedCols(a, b) {   // per column: does any of the top rows differ?
      if (!a || !b || a.w !== b.w) return null;
      const out = new Uint8Array(a.w);
      for (let x = 0; x < a.w; x++) for (let y = 0; y < ROWS; y++) {
        const i = (y * a.w + x) * 4;
        if (Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1]) + Math.abs(a.d[i + 2] - b.d[i + 2]) > 24) { out[x] = 1; break; }
      }
      return out;
    }
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function settled() {      // the strip once the guest has redrawn (two equal reads in a row)
      for (let i = 0; i < 50; i++) { const p = ps2(); if (!p || !p.mouse_buffer || !p.mouse_buffer.length) break; await sleep(4); }
      await sleep(90);              // guest handles the packet, Windows redraws, v86 paints (next frame)
      let prev = strip();
      for (let i = 0; i < 15; i++) {
        await sleep(35);
        const s2 = strip(), c = changedCols(prev, s2);
        if (c && c.indexOf(1) < 0) return s2;
        prev = s2;
      }
      return prev;
    }
    let cw = 0;
    async function probe(px) {      // -> [movement of a +px packet, or -1; changed columns]
      push({ k: "slam" }); await done();
      const a = await settled();
      push({ k: "raw", dx: px, dy: 0 }); await done();
      const b = await settled();
      cur = null;
      const c = changedCols(a, b);
      if (!c) return [-1, null];
      const R = c.lastIndexOf(1);
      if (R < 0 || !cw) return [-1, c];
      return [R - (cw - 1), c];
    }
    async function calibrate() {
      const [w] = size();
      if (w < 320) { calibNote = "no desktop (" + w + " px wide)"; return false; }   // text mode / no desktop yet
      say("Calibrating touch → Windows pointer (one-time)…", 6000);
      // Cursor width: a 32 px probe moves 32..128 px, clear of a ~11 px arrow -> two runs of
      // changed columns; the first run (from column 0) is the cursor that left the corner.
      const c32 = (await probe(32))[1];
      if (!c32 || !c32[0]) {
        calibNote = "no cursor in the corner (" + (c32 ? "changed columns " + c32.reduce((n, v) => n + v, 0) + ", first " + c32.indexOf(1) + ", last " + c32.lastIndexOf(1) : "no frame") + ")";
        return false;
      }
      let k = 0; while (k < c32.length && c32[k]) k++;
      if (k < 4 || k > 40 || c32.indexOf(1, k) < 0) { calibNote = "cursor width " + k; return false; }
      cw = k;
      // Re-check a cached curve with one probe; otherwise measure the whole curve.
      if (curve.length > 2) {
        const want = curve.find((c) => c[0] === 64);
        if (want && Math.abs((await probe(64))[0] - want[1]) <= 1) return true;
      }
      const sizes = [1, 2, 3, 4, 5, 6, 8, 12, 16, 24, 32, 64, 100, 127], got = [];
      for (const p of sizes) {
        const mv = (await probe(p))[0];
        if (mv <= 0) { if (p <= 2) { calibNote = "probe " + p + " not seen"; return false; } break; }
        if (got.length && mv < got[got.length - 1][1]) { calibNote = "not monotonic " + JSON.stringify(got.concat([[p, mv]])); return false; }
        got.push([p, mv]);
        if (mv >= w - 2 * cw) break;                                   // can't measure any further
      }
      if (got.length < 3 || got[0][1] < 1) { calibNote = "too few points " + JSON.stringify(got); return false; }
      curve = got;
      saveCurve(curve);
      return true;
    }
    let calibLast = -1e9;
    function ensureCalibrated() {
      // Retry a failed calibration on a later touch (e.g. it ran while Windows still showed the
      // animated "starting up" cursor) — at most every 8 s, 6 tries. Until then the safe curve
      // (1-2 px packets) still lands taps exactly, just slower.
      if (calibrated || calibrating || calibTries >= 6 || nowMs() - calibLast < 8000) return;
      calibTries++; calibLast = nowMs();
      calibrating = calibrate().then((ok) => {
        calibrated = ok; calibrating = null; cur = null;
        try { console.log("[pointer] calibration " + (ok ? "ok " + JSON.stringify(curve) : "failed: " + calibNote)); } catch (e) {}
        if (ok) say("Pointer calibrated — taps land where you touch.", 2500);
      }, () => { calibrating = null; cur = null; });
    }
    // Queue input behind a running calibration (it owns the pointer while it measures).
    let pending = [];
    function input(list) {
      if (calibrating) { pending = pending.concat(list); calibrating.then(() => { const l = pending; pending = []; l.forEach(push); }); return; }
      list.forEach(push);
    }

    // Map a client point to the guest pixel under it; the canvas is object-fit:contain, so the
    // letterbox bars are excluded.
    const mapGuest = (clientX, clientY) => {
      const cv = screenCanvas();
      if (!cv || !cv.width || !cv.height) return null;
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const scale = Math.min(r.width / cv.width, r.height / cv.height);
      return [
        Math.max(0, Math.min(cv.width - 1, (clientX - (r.left + (r.width - cv.width * scale) / 2)) / scale)),
        Math.max(0, Math.min(cv.height - 1, (clientY - (r.top + (r.height - cv.height * scale) / 2)) / scale)),
      ];
    };
    // fresh: re-home through the corner first (kills any drift) — unless that happened in the last
    // 3 s with a measured curve, so a quick double-tap clicks twice in place (a real double-click).
    const goTo = (clientX, clientY, fresh) => {
      const g = mapGuest(clientX, clientY); if (!g) return [];
      const home = fresh && !(calibrated && cur && nowMs() - homedMs < 3000);
      return home ? [{ k: "slam" }, { k: "go", x: g[0], y: g[1] }] : [{ k: "go", x: g[0], y: g[1] }];
    };
    const BTN_UP = { k: "btn", b: [false, false, false] }, LEFT_DOWN = { k: "btn", b: [true, false, false] };
    const RIGHT_CLICK = [{ k: "btn", b: [false, false, true] }, BTN_UP];

    let active = false, moved = false, twoFinger = false, scrolled = false, down = false;
    let startX = 0, startY = 0, startT = 0, scrollY = 0;
    const refocusKbd = () => { if (kbd && document.activeElement !== kbd) { try { kbd.focus({ preventScroll: true }); } catch (e) { try { kbd.focus(); } catch (e2) {} } } };
    const twoAvg = (e) => [(e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2];
    container.addEventListener("touchstart", (e) => {
      if (kbd && e.target === kbd) return; e.preventDefault();
      ensureCalibrated();
      if (e.touches.length >= 2) {                       // two fingers = scroll / right-click (never a left press)
        twoFinger = true; scrolled = false;
        const m = twoAvg(e); scrollY = m[1];
        const l = goTo(m[0], m[1], false);
        if (down) { l.unshift(BTN_UP); down = false; }   // cancel the one-finger press the 2nd finger interrupts
        input(l);                                        // cursor under the fingers so the wheel scrolls THAT content
        return;
      }
      const t = e.touches[0]; startX = t.clientX; startY = t.clientY; startT = nowMs();
      active = true; moved = false; twoFinger = false; scrolled = false;
      // Direct touch: the finger IS the pointer — home, go under it, press. Moving then drags;
      // a quick lift is a click.
      input(goTo(t.clientX, t.clientY, true).concat([LEFT_DOWN])); down = true;
    }, { passive: false });
    container.addEventListener("touchmove", (e) => {
      if (kbd && e.target === kbd) return; e.preventDefault();
      if (e.touches.length >= 2) {                       // two-finger drag => mouse wheel
        twoFinger = true;
        const y = twoAvg(e)[1]; const STEP = 16; const n = ((y - scrollY) / STEP) | 0;
        if (n) { const l = []; for (let i = 0; i < Math.abs(n); i++) l.push({ k: "wheel", d: n > 0 ? -1 : 1 }); input(l); scrollY += n * STEP; scrolled = true; }
        return;
      }
      if (!active) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - startX) > TAP_TOL || Math.abs(t.clientY - startY) > TAP_TOL) moved = true;
      input(goTo(t.clientX, t.clientY, false));          // drag: the cursor chases the finger (button held)
    }, { passive: false });
    const endSeq = () => {
      if (!active && !twoFinger) return;
      const wasTwo = twoFinger, wasScroll = scrolled, wasTap = !moved && (nowMs() - startT) <= TAP_MS;
      if (down) { input([BTN_UP]); down = false; }       // release (ends a click or a drag)
      active = false; twoFinger = false; scrolled = false;
      if (wasTwo) { if (!wasScroll) input(RIGHT_CLICK); return; }   // two-finger tap (no scroll) = right-click
      if (wasTap) refocusKbd();
    };
    container.addEventListener("touchend", (e) => { if (kbd && e.target === kbd) return; e.preventDefault(); if (e.touches.length === 0) endSeq(); }, { passive: false });
    container.addEventListener("touchcancel", () => { if (down) input([BTN_UP]); active = false; down = false; twoFinger = false; scrolled = false; }, { passive: false });

    // --- Trackpad / hardware mouse. iPad may deliver it as POINTER events (pointerType "mouse") or
    // plain MOUSE events depending on the WKWebView, so drive off both, deduped (the mouse path
    // skips while pointer events are arriving). Finger touches are pointerType "touch" (ignored here;
    // their compat mouse events are suppressed by the touch handlers' preventDefault).
    let lastPtr = 0, homed = false;
    const ptrMouse = (e) => e.pointerType && e.pointerType !== "touch";
    const hover = (x, y) => { input(goTo(x, y, !homed)); homed = true; };
    const press = (e) => {
      ensureCalibrated();
      if (e.button === 2) input(goTo(e.clientX, e.clientY, true).concat(RIGHT_CLICK));
      else { input(goTo(e.clientX, e.clientY, true).concat([LEFT_DOWN])); down = true; refocusKbd(); }
      homed = true;
    };
    const release = (e) => { if (e.button !== 2 && down) { input([BTN_UP]); down = false; } };
    container.addEventListener("pointermove", (e) => { if (!ptrMouse(e)) return; lastPtr = nowMs(); hover(e.clientX, e.clientY); });
    container.addEventListener("pointerdown", (e) => { if (!ptrMouse(e)) return; lastPtr = nowMs(); e.preventDefault(); press(e); });
    container.addEventListener("pointerup", (e) => { if (!ptrMouse(e)) return; lastPtr = nowMs(); release(e); });
    container.addEventListener("pointerleave", (e) => { if (!ptrMouse(e)) return; homed = false; });
    const stale = () => nowMs() - lastPtr > 600;   // no pointer event is currently handling it
    container.addEventListener("mousemove", (e) => { if (stale()) hover(e.clientX, e.clientY); });
    container.addEventListener("mousedown", (e) => { if (!stale()) return; e.preventDefault(); press(e); });
    container.addEventListener("mouseup", (e) => { if (stale()) release(e); });
    container.addEventListener("wheel", (e) => {   // trackpad two-finger scroll
      e.preventDefault();
      const n = Math.max(-3, Math.min(3, Math.round(e.deltaY / 40))) || (e.deltaY ? (e.deltaY > 0 ? 1 : -1) : 0);
      if (n) { const l = []; for (let i = 0; i < Math.abs(n); i++) l.push({ k: "wheel", d: n > 0 ? -1 : 1 }); input(l); }   // v86: +1 = wheel up
    }, { passive: false });
    container.addEventListener("contextmenu", (e) => e.preventDefault());
    try { window.__bbPointer = { ops, curve: () => curve, cur: () => cur, reset: () => { calibrated = false; calibTries = 0; calibLast = -1e9; }, calibrate: () => { calibrated = false; calibTries = 0; calibLast = -1e9; saveCurve(null); curve = [[1, 1], [2, 2]]; ensureCalibrated(); return calibrating; } }; } catch (e) {}
  }
  function nowMs() { return (window.performance && performance.now) ? performance.now() : (+new Date()); }

  function loadLib() {
    return new Promise((res, rej) => {
      if (window.V86 || window.V86Starter) return res();
      const s = document.createElement("script");
      s.src = LIB;
      s.onload = res;
      s.onerror = () => {
        // offline engine missing — try CDN once
        const s2 = document.createElement("script");
        s2.src = LIB_CDN; s2.onload = res;
        s2.onerror = () => rej(new Error("v86 engine not found (bundled or network)"));
        document.head.appendChild(s2);
      };
      document.head.appendChild(s);
    });
  }

  // Render the full emulator UI into `body` — a WM window body OR a full-screen
  // Bootbox container. args: { guest, customUrl, customKind, ram, autoboot, onExit }.
  function renderEmulator(body, args) {
        args = args || {};
        // A custom medium chosen in the Bootbox BIOS (imported ISO / arbitrary URL).
        if (args.customUrl) { setCfg({ guest: "custom", img: args.customUrl, kind: args.customKind || "cdrom" }); args.guest = "custom"; }
        const c = cfg();
        const startGuest = args.guest || c.guest || "custom";
        const opts = GUESTS.map(g => `<option value="${g.id}" ${g.id === startGuest ? "selected" : ""}>${g.name}</option>`).join("");
        body.innerHTML = `<div class="emu-root">
          <style>
            .emu-root{display:flex;flex-direction:column;height:100%;background:#0b0b0d;
              font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif}
            .emu-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;flex-wrap:wrap;
              background:linear-gradient(180deg,#fbfcfe,#eef2f8);border-bottom:1px solid #e5e7eb}
            .emu-bar .e-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;
              border-radius:6px;border:1px solid #e5e7eb;background:#fff;color:#1b1b1f;font-size:13px;
              font-weight:600;cursor:pointer;transition:background .12s}
            .emu-bar .e-btn:hover{background:#f4f7fb}
            .emu-bar .e-btn.accent{background:#0067c0;border-color:#005fb8;color:#fff;box-shadow:0 1px 2px rgba(0,103,192,.4)}
            .emu-bar .e-btn.accent:hover{background:#005fb8}
            .emu-bar .e-sel,.emu-bar .e-in{height:30px;border-radius:6px;border:1px solid #e5e7eb;background:#fff;
              color:#1b1b1f;font-size:13px;font-weight:600;padding:0 10px}
            .emu-bar .e-sel{appearance:none;padding-right:26px;cursor:pointer;
              background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' stroke='%235b5f66' stroke-width='1.4' fill='none'/></svg>");
              background-repeat:no-repeat;background-position:right 8px center}
            .emu-bar .grow{flex:1}
            .emu-pill{display:inline-flex;align-items:center;gap:7px;height:26px;padding:0 11px;border-radius:999px;
              background:#eaf6ee;color:#0f7b3f;font-size:12px;font-weight:600;border:1px solid #c9ead4}
            .emu-pill .led{width:8px;height:8px;border-radius:50%;background:#16a34a;box-shadow:0 0 0 3px rgba(22,163,74,.18)}
            .emu-perf{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:999px;
              font-size:12px;font-weight:600;border:1px solid #e5e7eb;background:#f4f7fb;color:#5b5f66;cursor:default}
            .emu-perf.fast{background:#eaf6ee;color:#0f7b3f;border-color:#c9ead4}
            .emu-perf.medium{background:#fff7e6;color:#9a6b00;border-color:#f3e0b8}
            .emu-perf.slow{background:#fdeaea;color:#b42318;border-color:#f3c9c9}
            .emu-keys{display:flex;gap:6px;align-items:center;padding:6px 8px;background:#0c0c10;border-top:1px solid #23232a;overflow-x:auto;-webkit-overflow-scrolling:touch}
            .emu-keys .kbtn{flex:0 0 auto;min-width:42px;height:34px;padding:0 12px;border-radius:7px;border:1px solid #2a2a33;background:#17171d;color:#d6d6de;font:600 14px/1 "Cascadia Mono",Consolas,monospace;cursor:pointer}
            .emu-keys .kbtn:active{background:#26262f}
            .emu-keys .kbtn.primary{background:#0067c0;border-color:#1f86e0;color:#fff}
            .emu-keys .kbtn.on{background:#b45309;border-color:#d97706;color:#fff}
            .emu-status{height:28px;display:flex;align-items:center;padding:0 12px;font-size:12px;color:#5b5f66;
              background:#f7f9fc;border-top:1px solid #e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
              font-family:"Cascadia Mono",Consolas,monospace}
            #screen_container>div{white-space:pre;font:14px/1.05 "Cascadia Mono",Consolas,monospace;color:#19c37d;transform-origin:center center}
            /* Scale the v86 graphical display to FILL the iPad screen (keep aspect, no
               distortion). v86 sets the canvas to the guest's native pixel size inline,
               so override with !important; object-fit:contain letterboxes as needed.
               ONLY v86's own canvas (a direct child): the 64-bit guests' noVNC canvas lives
               deeper in this container, and stretching ITS box to the pane while the picture
               is letterboxed inside made noVNC map every tap against the wrong rectangle —
               X right, Y off by the letterbox bar (the "cursor not aligned" bug on the Linux
               desktop and Android). noVNC sizes and centres its own canvas. */
            #screen_container>canvas{image-rendering:auto !important;position:absolute !important;
              top:0 !important;left:0 !important;width:100% !important;height:100% !important;
              object-fit:contain !important}
            /* Hide the iPad trackpad/host pointer over the v86 screen: v86's mouse is
               RELATIVE, so a host pointer (absolute) drifts out of sync with the
               guest cursor. With it hidden, the guest cursor is the only one and you
               drive it like a laptop trackpad. (Not over the 64-bit panel: noVNC is
               absolute, so there the iPad pointer IS the cursor.) */
            #screen_container>canvas, #screen_container>div:not(.q64-wrap){cursor:none !important}
          </style>
          <div class="emu-bar">
            <button class="e-btn" id="exit" title="Power off & return to Bootbox BIOS">‹ BIOS</button>
            <button class="e-btn accent" id="boot"><svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6z"/></svg>Start</button>
            <button class="e-btn" id="stop"><svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="3" width="10" height="10" rx="1.5"/></svg>Stop</button>
            <button class="e-btn" id="save" title="Save progress — snapshot this guest so it resumes here on the next boot">💾 Save</button>
            <button class="e-btn" id="share" title="Move files between the Bootbox folder and the VM's /mnt/share — live, no reboot">📂 Share</button>
            <select class="e-sel" id="guest" style="min-width:200px">${opts}</select>
            <input class="e-in" id="img" style="min-width:160px;display:none" placeholder="Image URL (.iso/.img)">
            <select class="e-sel" id="kind" style="width:96px">
              <option value="cdrom">CD/ISO</option><option value="hda">HDD</option><option value="fda">Floppy</option>
            </select>
            <input class="e-in" id="ram" style="width:64px" type="number" value="1536" title="RAM (MB) for the 64-bit guests — up to 1536 (the engine's 3 GB WebAssembly heap must also hold the OS image; QEMU itself caps at 2047). More RAM helps big pip installs and file work; it does NOT speed up the CPU.">
            <select class="e-sel" id="cores" style="width:104px;display:none" title="CPU cores for 64-bit QEMU guests. Changing this reboots the guest to apply it. Each core is a full software-emulated CPU, so more cores run genuinely in parallel but also run hotter and draw more power. Android is capped at 4 cores for memory and stability.">
              <option value="1">1 core</option>
              <option value="2" selected>2 cores</option>
              <option value="4">4 cores</option>
              <option value="6">6 cores</option>
              <option value="8">8 cores</option>
            </select>
            <span class="grow"></span>
            <span class="emu-perf" id="perf" title="Emulation speed of this device (WASM JIT benchmark)">⏱ testing…</span>
            <span class="emu-pill"><span class="led"></span><span id="state">Idle</span></span>
          </div>
          <div id="screen_container" style="flex:1;background:#000;overflow:hidden;position:relative;display:flex;align-items:center;justify-content:center">
            <div></div>
            <canvas style="display:none"></canvas>
            <input id="kbd-capture" autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" aria-hidden="true"
              style="position:absolute;left:0;bottom:0;width:1px;height:1px;opacity:0;border:0;padding:0;font-size:16px;color:transparent;background:transparent">
          </div>
          <div class="emu-keys" id="emu-keys">
            <button class="kbtn primary" data-k="kbd">⌨ Type</button>
            <button class="kbtn" data-k="esc">Esc</button>
            <button class="kbtn" data-k="tab">Tab</button>
            <button class="kbtn" id="kctrl" data-k="ctrl">Ctrl</button>
            <button class="kbtn" data-k="ctrlc">^C</button>
            <span style="flex:1"></span>
            <button class="kbtn" data-k="left">←</button>
            <button class="kbtn" data-k="up">↑</button>
            <button class="kbtn" data-k="down">↓</button>
            <button class="kbtn" data-k="right">→</button>
          </div>
          <div class="emu-status" id="status">Ready.</div>
        </div>`;
        const status = body.querySelector("#status");
        const stateEl = body.querySelector("#state");
        const setState = (s) => { if (stateEl) stateEl.textContent = s; };
        const guestSel = body.querySelector("#guest");
        const imgInput = body.querySelector("#img");
        const kindSel = body.querySelector("#kind");
        const ramInput = body.querySelector("#ram");
        const coresSel = body.querySelector("#cores");
        const perfEl = body.querySelector("#perf");
        let emu = null;
        let qemuTerm = null;   // 64-bit QEMU xterm (set when q64 boots); the keyboard routes here, not to v86 `emu`
        let panel64Ref = null; // the QEMU_PANEL (set in boot64); the keyboard routes to the GUI's noVNC when its tab is active
        let qemuFs = null;     // 64-bit guest /share file API (read/write/list Module.FS "/share") for Save/Share
        // window.__q64Live: a QEMU-Wasm engine has instantiated in THIS page realm. Emscripten/QEMU can't be
        // re-instantiated in the same realm (workers + wasm SharedMemory persist), so a second boot (e.g. after
        // changing CPU cores/RAM) must reload the page for a clean restart — otherwise run.js reuses the live
        // self.Module and the guest is "stuck" at the 1st boot's -smp. Realm-level (not closure-level) so that
        // closing and reopening the emulator window still sees the engine that is already running in the page.

        // Detect emulation speed of this device. WKWebView gets WASM JIT, but its
        // strength varies (sideloaded/real device = fast; constrained = slow). We
        // benchmark a hot loop and tune defaults: slow → stay 32-bit; fast → 64-bit ok.
        if (!cachedPerf) {
          const t0 = performance.now();
          let x = 0; for (let i = 0; i < 4e7; i++) { x = ((x + i * 3) ^ (i >> 2)) >>> 0; }
          window.__perfSink = x;
          const ms = performance.now() - t0;
          const tier = ms < 90 ? "fast" : ms < 380 ? "medium" : "slow";
          cachedPerf = { tier, ms: Math.round(ms), jit: ms < 380 };
          try { console.log("[perf] JS benchmark " + Math.round(ms) + " ms (" + tier + "), " + (navigator.hardwareConcurrency || "?") + " cores"); } catch (e) {}
        }
        (function showPerf() {
          const p = cachedPerf;
          const icon = p.tier === "fast" ? "⚡" : p.tier === "slow" ? "🐢" : "⏱";
          const label = p.tier === "fast" ? "Fast (JIT)" : p.tier === "medium" ? "Medium" : "Slow — enable JIT";
          perfEl.className = "emu-perf " + p.tier;
          perfEl.textContent = icon + " " + label;
          perfEl.title = "Emulation benchmark: " + p.ms + "ms. " +
            (p.tier === "slow" ? "Sideload (AltStore/TrollStore) or attach Xcode to enable full JIT for big speedups." :
             "WASM JIT active — x86 is translated to native ARM by WebKit.");
        })();

        function syncGuest() {
          const g = GUESTS.find(x => x.id === guestSel.value) || GUESTS[0];
          const kernelBoot = g.boot === "kernel";
          kindSel.disabled = kernelBoot;
          if (g.id === "custom") {
            imgInput.style.display = ""; imgInput.value = c.img || "";
            kindSel.value = c.kind || "cdrom";   // reflect the BIOS-chosen medium (ISO → CD/ISO)
          } else {
            imgInput.style.display = "none";
            if (g.kind) kindSel.value = g.kind;
          }
          ramInput.value = Math.min(g.maxRam || 1536,
            Math.max(g.minRam || 64, c.ram || g.ram || 512));   // restore RAM within this guest's safe range
          coresSel.style.display = (g.boot === "q64") ? "" : "none";   // cores apply to the 64-bit guests
          const maxCores = g.maxCores || 8, minCores = g.minCores || 1;
          // A warm-snapshot guest (Android) resumes ONLY at the vCPU count it was captured with, so
          // min == max pins and locks the selector; leaving it restores the user's remembered count.
          const pinned = minCores === maxCores;
          if (!pinned && coresSel.disabled) coresSel.value = String(+c.cores64 || +g.cores || 2);
          coresSel.disabled = pinned;
          if (+coresSel.value > maxCores) coresSel.value = String(maxCores);
          if (+coresSel.value < minCores) coresSel.value = String(minCores);
        }
        guestSel.onchange = syncGuest; syncGuest();
        if (args.ram) ramInput.value = args.ram;   // RAM chosen in the Bootbox BIOS overrides for this boot
        // persist the RAM count whenever the user edits it (so it's remembered)
        ramInput.addEventListener("change", () => { const v = Math.max(64, +ramInput.value || 0); if (v) setCfg({ ram: v }); });
        // CPU cores (64-bit guests): remembered across boots; the UEFI-Setup value seeds this boot.
        const initialGuest = GUESTS.find(x => x.id === guestSel.value) || GUESTS[0];
        coresSel.value = String(+args.cores || +c.cores64 || +initialGuest.cores || 2);
        if (!coresSel.value) coresSel.value = "2";   // guard: unknown value -> select falls back
        if (+coresSel.value > (initialGuest.maxCores || 8)) coresSel.value = String(initialGuest.maxCores || 8);
        if (+coresSel.value < (initialGuest.minCores || 1)) coresSel.value = String(initialGuest.minCores || 1);
        coresSel.addEventListener("change", () => {
          setCfg({ cores64: +coresSel.value || 2 });
          try { status.textContent = "CPU cores set to " + coresSel.value + " — applies on the next boot (press ⏻ Start to reboot)."; } catch (e) {}
        });

        async function boot() {
          const g = GUESTS.find(x => x.id === guestSel.value) || GUESTS[0];
          qemuTerm = null; qemuFs = null;   // reset; boot64 re-sets them once the 64-bit terminal is ready
          // 64-bit mode runs on a different engine (QEMU-Wasm), not v86.
          if (g.boot === "q64") {
            setCfg({ guest: g.id });
            // If a 64-bit engine already ran in this realm, we CANNOT cleanly re-instantiate it (emscripten
            // workers + wasm SharedMemory are one-shot). Reload the page for a fresh realm and auto-resume the
            // boot — this is what makes a new CPU-core / RAM selection actually take effect (the "stuck at 2
            // cores" bug: without this, run.js reused the live Module and the guest kept the first boot's -smp).
            if (window.__q64Live) {
              // Carry cores+RAM in the reboot payload (not just via the debounced config save) so the new
              // selection is applied even if the page reloads before VFS's 250 ms save flushes.
              const reboot = JSON.stringify({ guest: g.id, cores: +coresSel.value || undefined, ram: +ramInput.value || undefined, t: Date.now() });
              try { sessionStorage.setItem("bootbox.reboot", reboot); } catch (e) {}
              try { localStorage.setItem("bootbox.reboot", reboot); } catch (e) {}   // survives a fresh web view
              try { status.textContent = "Rebooting to apply new settings…"; } catch (e) {}
              // Prefer a FRESH web view (new WebContent process): a plain reload keeps the old process,
              // which still held the previous guest's ~2 GB of wasm memory, so the next 64-bit guest
              // failed with "Out of memory". Without the native call (Mac harness, old app) just reload.
              try {
                if (window.Bridge && typeof Bridge.call === "function") { await Bridge.call("system", "freshReload", {}); return; }
              } catch (e) {}
              location.reload();
              return;
            }
            return boot64(g);
          }
          const kernelBoot = g.boot === "kernel";
          const img = g.id === "custom" ? imgInput.value.trim() : g.url;
          let kind = kindSel.value;
          if (/\.iso(\?|$)/i.test(img)) kind = "cdrom";   // an ISO image always boots as a CD-ROM
          const ramMB = Math.max(64, +ramInput.value || g.ram || 512);   // emulator is CPU-bound; more RAM just pressures the host
          // A real distro ISO chosen in the Bootbox BIOS shows up as a custom image.
          const dispName = g.id === "custom" ? ((img.split("/").pop() || "custom image")) : g.name;
          if (!kernelBoot && !img) { status.textContent = "Choose a guest or enter an image URL."; return; }
          setCfg({ guest: g.id, img, kind, ram: ramMB });   // remember the RAM count too
          setState("Booting…");
          status.textContent = "Loading x86 engine…";
          try {
            await loadLib();
            // Instant boot: restore a pre-booted desktop snapshot when present. A hosted
            // guest may carry a `state` URL; an imported disk NAME.img auto-restores from a
            // paired NAME.img.state.gz dropped in beside it (Files app / drag) — that file
            // is a v86 save-state of the already-booted desktop, so the guest resumes in
            // ~1s with drivers + network already up, instead of a multi-minute cold boot +
            // first-run driver setup. A missing snapshot just cold-boots as before.
            let initialState = null;
            // Resume from a saved snapshot unless UEFI Setup → Boot → "Resume Saved State"
            // is off. Try the user's SAVED progress for this image first (written by Save as
            // <image>.state.gz — it shadows a shipped snapshot of the same name), then a
            // shipped `state` snapshot, else cold-boot.
            const resumeOn = cfg().resumeState !== false;
            const savedSrc = (resumeOn && img && (kind === "hda" || kind === "hdb")) ? (img + ".state.gz") : null;
            for (const src of [savedSrc, resumeOn ? g.state : null]) {
              if (!src) continue;
              status.textContent = "Restoring saved desktop…";
              try { initialState = await fetchGunzip(resolveVmres(src)); } catch (e) { initialState = null; }
              if (initialState) break;
            }
            status.textContent = initialState
              ? "Resuming " + dispName + " — restored from snapshot."
              : "Booting " + dispName + " (" + ramMB + " MB RAM) — real x86. ISO streams from disk; a full distro cold-boots slowly in the software CPU.";
            const Ctor = window.V86 || window.V86Starter;
            const o = {
              wasm_path: WASM,
              memory_size: ramMB * 1024 * 1024,
              vga_memory_size: (g.vga || 16) * 1024 * 1024,
              screen_container: body.querySelector("#screen_container"),
              bios: { url: BIOS },
              vga_bios: { url: VGABIOS },
              autostart: true,
              // In-memory 9p share (mount tag "host9p") for LIVE host<->guest file
              // transfer without rebooting. The guest auto-mounts it at /mnt/share; the
              // app pushes files with emu.create_file(path, bytes) and pulls them back
              // with emu.read_file(path). Empty {} = fresh in-memory fs each boot.
              filesystem: {},
            };
            // Internet for the guest: v86 emulates an NE2000 NIC and bridges its
            // Ethernet frames to a WebSocket relay (browsers can't open raw TCP). The
            // guest still needs a DHCP client on eth0. Configurable: emulator cfg
            // `netRelay` = "off" disables it, or set your own wss:// relay URL.
            const netRelay = cfg().netRelay;
            if (netRelay !== "off") {
              o.network_relay_url = (typeof netRelay === "string" && /^wss?:\/\//.test(netRelay))
                ? netRelay : "wss://relay.widgetry.org/";
            }
            if (initialState) o.initial_state = { buffer: initialState };
            // Windows 9x + v86's JIT: VMM patches each VxD call site (INT 20h + device/service dword
            // -> direct call) the first time it runs, and v86's JIT sometimes re-runs the stale INT 20h
            // after its operand was patched -> "Invalid VxD dynamic link call from VMM(06)+00001B6A to
            // device C001" (0xC0010EA4 is the patched-in address) and "Windows protection error".
            // Measured 2026-10: ~70% of Win98 boots failed, Chrome and WebKit alike; with the JIT off
            // the same image booted every time, and the desktop was up just as fast. The patching
            // happens while Windows boots, so boot on the interpreter and turn the JIT on once the
            // desktop has been up for a while (a restored snapshot is past that point already).
            const win9x = !kernelBoot && !initialState && (g.id === "win98" || /win\s*9[58x]|win98|w98|winme/i.test(String(img || "")));
            if (win9x) o.disable_jit = true;
            if (kernelBoot) {
              // Fast path: boot the kernel + initrd directly (no BIOS/disk).
              o.bzimage = { url: g.bzimage };
              if (g.initrd) o.initrd = { url: g.initrd };
              if (g.cmdline) o.cmdline = g.cmdline;
            } else {
              // Stream big ISOs in chunks via HTTP range. Use the same-origin
              // loopback URL when available so the Content-Range header is readable.
              const src = resolveVmres(img);
              o[kind] = (src.indexOf("vmres://") === 0 || src.indexOf("http") === 0) ? { url: src, async: true } : { url: src };
              if (kind === "hda" || kind === "hdb") o.boot_order = 0x312;  // boot the installed system off the hard disk
            }
            emu = new Ctor(o);
            if (win9x) {
              const v86emu = emu, jitT0 = Date.now();
              let gfxSince = 0;
              const jitTimer = setInterval(() => {
                try {
                  if (emu !== v86emu) { clearInterval(jitTimer); return; }    // stopped / replaced
                  const cv = body.querySelector("#screen_container > canvas");
                  const gfx = cv && cv.width >= 640 && getComputedStyle(cv).display !== "none";
                  gfxSince = gfx ? (gfxSince || Date.now()) : 0;
                  if ((gfxSince && Date.now() - gfxSince > 15000) || Date.now() - jitT0 > 180000) {
                    const cpu = v86emu.v86 && v86emu.v86.cpu;
                    if (cpu && cpu.set_jit_config) {
                      cpu.set_jit_config(0, 0);
                      clearInterval(jitTimer);
                      console.log("[v86] Windows is up — JIT on (" + Math.round((Date.now() - jitT0) / 1000) + " s after start)");
                    }
                  }
                } catch (e) {}
              }, 2000);
            }
            // Scale the v86 TEXT-mode console to fill the screen too (CSS object-fit
            // only handles the graphical canvas). Re-fit on mode/size changes + resize.
            const fitText = () => {
              const cont = body.querySelector("#screen_container");
              const txt = cont && cont.querySelector("div");
              const cv = cont && cont.querySelector("canvas");
              if (!cont || !txt) return;
              if (cv && getComputedStyle(cv).display !== "none") { txt.style.transform = ""; return; } // graphical: CSS handles it
              txt.style.transform = "none";
              const sw = txt.scrollWidth, sh = txt.scrollHeight;
              if (sw < 8 || sh < 8) return;
              const s = Math.min(cont.clientWidth / sw, cont.clientHeight / sh);
              if (s > 0 && isFinite(s)) txt.style.transform = "scale(" + s.toFixed(3) + ")";
            };
            renderEmulator._fitText = fitText;
            if (!window.__emuFitHook) { window.__emuFitHook = true; window.addEventListener("resize", () => { try { renderEmulator._fitText && renderEmulator._fitText(); } catch (e) {} }); }
            emu.add_listener && emu.add_listener("emulator-ready", () => {
              setState("Running");
              status.textContent = "Running — real x86 CPU. Type on a hardware keyboard · touch: tap = click, press & drag = drag (like a mouse), two-finger tap = right-click · ⌨ Type = on-screen keyboard.";
              // A restored snapshot brings the guest's already-bound NIC back, but the
              // relay WebSocket lives outside the save-state — nudge it to (re)connect now
              // so the guest's network is live immediately instead of waiting on the timer.
              if (initialState && o.network_relay_url) {
                let netTries = 0;
                (function nudgeNet() {
                  const na = emu.network_adapter;
                  if (na && typeof na.connect === "function" && !na.socket) { try { na.connect(); } catch (e) {} }
                  if (++netTries < 5 && emu.network_adapter && !emu.network_adapter.socket) setTimeout(nudgeNet, 1200);
                })();
              }
              // All pointer input (touch, trackpad, wheel) is driven by installV86TouchMouse: paced
              // PS/2 packets + a measured acceleration curve, so taps land on the touched pixel. (The
              // old "keep v86's adapter on or clicks die" was really the burst problem it describes.)
              try { installV86TouchMouse(emu, { container: body.querySelector("#screen_container"), keyboardInput: body.querySelector("#kbd-capture"), status, key: img || g.id }); } catch (e) {}
              // Trackpad / Magic Keyboard: pointer-lock doesn't work on iPad, so rather than
              // capturing the pointer, installV86TouchMouse intercepts the mouse events and
              // absolutely tracks the system pointer — the guest cursor follows it like touch.
              for (const d of [100, 600, 1500, 4000]) setTimeout(fitText, d);
            });
            emu.add_listener && emu.add_listener("screen-set-size-text", () => setTimeout(fitText, 0));
            emu.add_listener && emu.add_listener("screen-set-mode", () => setTimeout(fitText, 30));
            // Mirror the guest serial console into the status line (boot visibility).
            let serial = "";
            emu.add_listener && emu.add_listener("serial0-output-byte", (b) => {
              const ch = String.fromCharCode(b);
              serial += ch;
              if (serial.length > 400) serial = serial.slice(-400);
              if (status._hold && nowMs() < status._hold) return;   // don't clobber a held Save/Share message
              status.textContent = serial.replace(/\n/g, " ⏎ ").slice(-180);
            });
          } catch (e) {
            status.textContent = "Emulator error: " + e.message;
          }
        }
        // 64-bit mode (x86_64) via QEMU-Wasm. Heavier than v86 but runs modern
        // 64-bit software. The QEMU-Wasm pack is bundled under web/vendor/qemu.
        async function boot64(g) {
          setState("Booting…");
          status.textContent = "Loading 64-bit engine (QEMU-Wasm, x86_64)…";
          try {
            if (!self.crossOriginIsolated) {
              setState("Needs isolation");
              status.textContent = "64-bit (x86_64) needs cross-origin isolation for SharedArrayBuffer. " +
                "Enabling it in the host; meanwhile use the fast 32-bit desktop.";
              return;
            }
            if (!window.QEMU_WASM) {
              await new Promise((res, rej) => {
                const s = document.createElement("script");
                s.src = "vendor/qemu/run.js";
                s.onload = res; s.onerror = () => rej(new Error("missing QEMU-Wasm pack"));
                document.head.appendChild(s);
              });
            }
            if (!window.QEMU_PANEL) {
              await new Promise((res, rej) => {
                const s = document.createElement("script");
                s.src = "vendor/qemu/panel.js";
                s.onload = res; s.onerror = () => rej(new Error("missing QEMU panel"));
                document.head.appendChild(s);
              });
            }
            if (cachedPerf && cachedPerf.tier === "slow") {
              status.textContent = "64-bit on a slow device is very sluggish — enable JIT (sideload) or use the 32-bit desktop. Loading anyway…";
            }
            // "Desktop" guest → full-screen graphical desktop (no console); plain 64-bit → [ terminal | GUI-only ].
            const panel64 = window.QEMU_PANEL.make(body.querySelector("#screen_container"), { mode: g.gui ? "desktop" : "console" });
            // Download the rootfs on first boot (hosted on GitHub; cached after). No-op if bundled/cached.
            try { await ensureRootfs(g, status, setState); }
            catch (e) {
              setState("Download needed");
              status.textContent = "Couldn't download the " + (g.android ? "Android" : "64-bit Linux") + " image (needs internet on first boot): " + ((e && e.message) || e);
              return;
            }
            // Fit the guest into what this iPad lets one web page use: the app measures it once per iOS
            // version (MemoryProbe; 0/unknown on a Mac or in a browser) and iOS kills the page outright
            // past it. Besides guest RAM the page needs ~1 GB (engine, WebKit's compiled code, buffers).
            let ramMB = Math.min(g.maxRam || 1536, Math.max(g.minRam || 64, +ramInput.value || g.ram || 1536));
            let memNote = "";
            try {
              // The app measures it once per iOS version, right after launch (~30 s). Don't compete
              // with that measurement for memory: wait for it to finish.
              if (window.Bridge && Bridge.onDevice) {
                for (let i = 0; i < 60; i++) {
                  const info = await Bridge.call("system", "info").catch(() => null);
                  if (!info || !info.memProbeRunning) break;
                  status.textContent = "Measuring how much memory this iPad gives the emulator (first launch only)… " + i + " s";
                  await new Promise((r) => setTimeout(r, 1000));
                }
              }
              const ml = (window.Bridge && Bridge.onDevice) ? await Bridge.call("system", "memLimit") : null;
              const lim = (ml && +ml.limitMB) || 0;
              if (lim) {
                console.log("[mem] a page may use ~" + lim + " MB here (" + (ml.how || "?") + ")");
                const fit = Math.floor((lim - 1000) / 128) * 128;
                if (g.android) {
                  if (lim < 2400) memNote = " Heads-up: Android needs about 2.4 GB, and this iPad lets a page use about " + lim + " MB — iPadOS may stop it.";
                } else if (fit < ramMB) {
                  ramMB = Math.max(512, fit);
                  memNote = " Guest RAM set to " + ramMB + " MB to fit this iPad (a page may use ~" + lim + " MB).";
                }
              }
            } catch (e) {}
            if (memNote) { try { console.log("[mem]" + memNote); status.textContent += memNote; } catch (e) {} }
            // Device-compatibility ladder. On the iPad (TestFlight 87-89) the page's process crashed the
            // moment a resumed/booted guest started executing, though the same engine runs in the iOS
            // simulator and in macOS WebKit: some engine feature trips the device's WebKit. Each time a
            // 64-bit boot's page crashes before it has run 75 s, the next boot turns one more of the
            // newer features off; the first level that runs is kept (and logged).
            // q64safe2 (build 93): level 0 on the iPad = NESTED TB chaining (chain=2: call_indirect +
            // return, no wasm tail calls - the tail-call form killed the page on iPadOS 27.2, TestFlight
            // 90). New key so a device parked on the old ladder's "no tail calls" level tries it once;
            // if it crashes too, the next boot steps down to "no TB chaining" = the build 91 setup.
            const SAFE_LEVELS = [
              { name: "full speed" },
              { name: "no TB chaining", tune: { chain: 0 } },
              { name: "no TB chaining, no SIMD float inlining", tune: { chain: 0, fpinline: 0 } },
              { name: "no chaining/float inlining/register locals", tune: { chain: 0, fpinline: 0, regloc: 0 } },
              { name: "the above + fixed-size memory, fewer compiled blocks", tune: { chain: 0, fpinline: 0, regloc: 0, max: 8000 }, presize: true },
              { name: "interpreter only (slow)", tune: { chain: 0, fpinline: 0, regloc: 0, max: 8000, jit: 1000000000 }, presize: true },
            ];
            let safe = cfg().q64safe2 || { level: 0 };
            try {
              const lc = (window.Bridge && Bridge.onDevice) ? await Bridge.call("system", "takeLastCrash") : null;
              console.log("[safe] last page crash " + JSON.stringify(lc) + ", previous boot " + JSON.stringify(safe));
              if (lc && lc.at && safe.startedAt && lc.at * 1000 > safe.startedAt && !safe.ok) {
                safe.level = Math.min(SAFE_LEVELS.length - 1, (safe.level || 0) + 1);
                console.log("[safe] the last 64-bit boot crashed the page (code " + lc.code + ") — stepping down");
              }
            } catch (e) {}
            const level = SAFE_LEVELS[Math.min(SAFE_LEVELS.length - 1, safe.level || 0)];
            safe = { level: safe.level || 0, startedAt: Date.now(), ok: false };
            setCfg({ q64safe2: safe });
            console.log("[safe] engine level " + safe.level + ": " + level.name);
            if (safe.level) { try { status.textContent += " Safer engine settings: " + level.name + "."; } catch (e) {} }
            setTimeout(() => {
              const s2 = cfg().q64safe2 || {};
              if (s2.startedAt === safe.startedAt) { s2.ok = true; setCfg({ q64safe2: s2 }); console.log("[safe] level " + safe.level + " has run 75 s — keeping it"); }
            }, 75000);
            // Wasm tail calls (the engine's TB-to-TB chaining) crash the page on the iPad (iPadOS 27.2
            // WebKit, arm64e) the moment the guest starts running - found by the ladder on the user's
            // iPad Air M3 (TestFlight 90). On iOS the engine chains with ordinary nested calls instead.
            const iosBase = (window.Bridge && Bridge.onDevice) ? { chain: 2 } : {};
            const tune = Object.assign({}, g.tune || {}, iosBase, level.tune || {});
            if (g.tune && g.tune.max && level.tune && level.tune.max) tune.max = Math.min(g.tune.max, level.tune.max);
            await window.QEMU_WASM.run({
              screen_container: panel64.termHost,
              base: g.base || "vendor/qemu/",   // per-guest engine/rootfs dir (qemu-aload = the Python/Wine Alpine)
              engineBase: g.engineBase || undefined,   // terminal support files; Android may use a distinct engine module
              engineModuleBase: g.engineModuleBase || undefined,
              wasm: g.wasm || "qemu-system-x86_64.wasm",   // engine binary name (aarch64 guest = qemu-system-aarch64.wasm)
              netWs: "ws://127.0.0.1:8889/",   // in-app gVisor netstack (MiniOSApp.startNetStack) -> real internet
              vnc: "ws://127.0.0.1:8889/vnc",   // noVNC GUI bridge: netstack /vnc endpoint -> vn.Dial(guest x11vnc:5900)
              ram: ramMB,
              smp: Math.max(g.minCores || 1, Math.min(g.maxCores || 8, +coresSel.value || (args && +args.cores) || 0)) || undefined,
              tune,   // engine JIT tunables (run.js writes /bootbox-tune; build-84+ engine reads it)
              initialMemoryMB: level.presize ? ramMB + 900 : undefined,
              compressedVnc: !!g.android,
              touchGuest: !!g.android,   // touches go straight to Android's touchscreen (run.js installDirectTouch)
              vncLabel: g.android ? "Android" : undefined,
              onStatus: (m) => { try { status.textContent = m; } catch (e) {} },
              onReady: (r) => {
                setState("Running");
                window.__q64Live = true;   // engine is live in this realm → a later reboot must reload (see boot()).
                qemuTerm = r && (r.xterm || r.term); qemuFs = r && r.fs; panel64Ref = panel64;
                try { panel64.setFs && panel64.setFs(qemuFs); } catch (e) {}   // Files tab ⬆/⬇ transfers
                try { panel64.setXterm(qemuTerm); } catch (e) {}
                try { if (r && r.connectGui) panel64.onGuiOpen = (host) => r.connectGui(host, panel64.setGuiStatus); } catch (e) {}
                if (g.gui) {   // full-screen desktop/Android guest
                  try { panel64.showGui(); } catch (e) {}   // the desktop IS the GUI → connect immediately
                  status.textContent = g.android
                    ? "Running — full Android 12 AOSP (64-bit x86_64) in QEMU. This is a warm-boot image: it resumes to the home screen in a few seconds (no cold boot). Touch the screen directly and use ⌨ Type for text."
                    : "Running — x86_64 Linux desktop. The panel appears ~1–2 min after the first boot. Tap Apps (bottom-left) or right-click/long-press the desktop for programs and the CPU-Z / GPU benchmarks; ⌨ Type or the Magic Keyboard types into the focused window.";
                } else {        // [ terminal | GUI ]: blank GUI until you launch an X program from the terminal
                  // LAZY DISPLAY (power/heat): do NOT connect noVNC on boot — a connected viewer renders
                  // the (blank) Xvnc framebuffer continuously = wasted CPU/GPU even with nothing on screen.
                  // Connect only when the user first taps the GUI pane (i.e. actually wants to see output).
                  try { panel64.setGuiStatus("Graphical output appears here. Launch an X app (e.g. `xeyes &`) or a Wine `.exe` in the terminal, then TAP here to show it."); } catch (e) {}
                  try {
                    const guiHost = panel64.guiHost;
                    if (guiHost) {
                      const connectOnce = () => { guiHost.removeEventListener("pointerdown", connectOnce, true); try { panel64.showGui(); } catch (e) {} };
                      guiHost.addEventListener("pointerdown", connectOnce, true);
                    }
                  } catch (e) {}
                  status.textContent = "Running — x86_64 Linux. Type in the left terminal; the GUI stays OFF (saves power) until you launch a graphical program and TAP the right pane to show it.";
                }
              },
              onError: (e) => { setState("64-bit error"); status.textContent = e.message; },
            });
          } catch (e) {
            setState("64-bit pack needed");
            status.textContent = "64-bit mode error: " + e.message;
          }
        }

        body.querySelector("#boot").onclick = boot;
        body.querySelector("#stop").onclick = () => { try { emu && emu.stop && emu.stop(); setState("Stopped"); status.textContent = "Stopped."; } catch (e) {} };
        // Save progress: capture the live v86 state, gzip it (matching the restore path),
        // and POST it to the loopback server, which writes <image>.state.gz into the
        // snapshots store. The next boot of this image then auto-restores from it.
        // Visible top-bar feedback: briefly recolor + relabel a toolbar button so Save/Share confirm
        // RIGHT where the user tapped (the bottom status line is easy to miss / gets overwritten).
        const flashBtn = (btn, label, ok) => {
          if (!btn) return;
          const o = btn._orig || (btn._orig = btn.textContent);
          btn.textContent = label;
          btn.style.background = ok ? "#0a7d28" : "#b00020"; btn.style.color = "#fff"; btn.style.borderColor = "transparent";
          clearTimeout(btn._t); btn._t = setTimeout(() => { btn.textContent = o; btn.style.background = ""; btn.style.color = ""; btn.style.borderColor = ""; }, 4000);
        };
        const saveBtn = body.querySelector("#save");
        if (saveBtn) saveBtn.onclick = async () => {
          status._hold = nowMs() + 20000;   // keep our messages visible; the serial mirror won't overwrite them
          const g = GUESTS.find(x => x.id === guestSel.value) || GUESTS[0];
          if (g.boot === "q64") {   // 64-bit: "Save" copies the guest's /share files out to the Bootbox folder (Files app)
            if (!qemuFs) { status.textContent = "Boot the 64-bit Linux first."; flashBtn(saveBtn, "boot first", false); return; }
            saveBtn.disabled = true; status.textContent = "Saving files from /share…";
            let cnt = 0;
            try {
              for (const f of (qemuFs.list() || [])) {
                if (!f || f[0] === ".") continue;
                try { const b = qemuFs.read(f); if (b && b.length && (await fetch("/save/" + encodeURIComponent(f), { method: "POST", body: b })).ok) cnt++; } catch (e) {}
              }
            } catch (e) {}
            saveBtn.disabled = false;
            status.textContent = cnt ? ("Saved " + cnt + " file(s) from /share to the Bootbox folder.") : "Nothing in /share yet — in the guest, copy files there (e.g. cp file /share/).";
            flashBtn(saveBtn, cnt ? ("✓ saved " + cnt) : "/share empty", cnt > 0);
            return;
          }
          if (!emu || !emu.save_state || g.boot === "kernel") {
            status.textContent = "Save progress works for a booted disk/ISO guest."; flashBtn(saveBtn, "needs a disk guest", false); return;
          }
          const img = g.id === "custom" ? imgInput.value.trim() : g.url;
          const base = (img.split("/").pop() || "guest.img");
          saveBtn.disabled = true; setState("Saving…"); status.textContent = "Capturing state…";
          try {
            const state = await emu.save_state();
            let payload = state;
            if (typeof CompressionStream !== "undefined") {
              const cs = new CompressionStream("gzip");
              payload = await new Response(new Response(state).body.pipeThrough(cs)).arrayBuffer();
            }
            status.textContent = "Saving " + (payload.byteLength >> 20) + " MB…";
            const resp = await fetch("/save/" + encodeURIComponent(base + ".state.gz"), { method: "POST", body: payload });
            if (!resp.ok) throw new Error("HTTP " + resp.status);
            setState("Running"); status.textContent = "Saved — the next boot of " + base + " resumes right here."; flashBtn(saveBtn, "✓ Saved", true);
          } catch (e) {
            setState("Running"); status.textContent = "Save failed: " + (e.message || e); flashBtn(saveBtn, "✗ Save failed", false);
          } finally { saveBtn.disabled = false; }
        };
        // Live file transfer over the v86 9p share (the guest auto-mounts it at /mnt/share).
        // OUT: pull files the VM wrote there back into the Bootbox folder (visible in Files).
        // IN: push small files from the Bootbox folder into the VM. No reboot needed.
        const _pushedToVM = new Set();
        const shareBtn = body.querySelector("#share");
        if (shareBtn) shareBtn.onclick = async () => {
          status._hold = nowMs() + 15000;   // keep our messages visible; the serial mirror won't overwrite them
          if (qemuFs) {   // 64-bit: sync Module.FS "/share" <-> the Bootbox folder
            shareBtn.disabled = true; status.textContent = "Syncing /share with the Bootbox folder…";
            let inN = 0, outN = 0;
            try {                                  // OUT: guest /share -> Bootbox folder (Files app)
              for (const n of (qemuFs.list() || [])) {
                if (!n || n[0] === "." || _pushedToVM.has(n)) continue;
                try { const b = qemuFs.read(n); if (b && b.length && (await fetch("/save/" + encodeURIComponent(n), { method: "POST", body: b })).ok) outN++; } catch (e) {}
              }
            } catch (e) {}
            try {                                  // IN: Bootbox folder -> guest /share
              const imports = (window.Bridge && await Bridge.call("binary", "list")) || [];
              for (const n of imports) {
                if (!n || _pushedToVM.has(n) || /\.(img|iso|gz|bin|wasm|part)$/i.test(n)) continue;
                try {
                  const resp = await fetch(resolveVmres("vmres://iso/" + n));
                  if (!resp.ok) continue;
                  const buf = new Uint8Array(await resp.arrayBuffer());
                  if (buf.length > 64 * 1024 * 1024) continue;
                  if (qemuFs.write(n, buf)) { _pushedToVM.add(n); inN++; }
                } catch (e) {}
              }
            } catch (e) {}
            shareBtn.disabled = false;
            status.textContent = "Shared " + inN + " in / pulled " + outN + " out (guest /share ↔ Bootbox folder).";
            flashBtn(shareBtn, "✓ " + inN + " in / " + outN + " out", true);
            return;
          }
          if (!emu || !emu.create_file || !emu.fs9p || typeof emu.fs9p.read_dir !== "function") { status.textContent = "Start the VM first to share files."; flashBtn(shareBtn, "start VM first", false); return; }
          shareBtn.disabled = true; status.textContent = "Syncing files with the VM…";
          let inN = 0, outN = 0;
          try {                                  // OUT: VM /mnt/share -> Bootbox folder
            for (const n of (emu.fs9p.read_dir("/") || [])) {
              if (!n || n[0] === "." || _pushedToVM.has(n)) continue;   // skip dotfiles + ones we pushed in
              try {
                const bytes = await emu.read_file(n);
                if (!bytes) continue;
                if ((await fetch("/save/" + encodeURIComponent(n), { method: "POST", body: bytes })).ok) outN++;
              } catch (e) {}
            }
          } catch (e) {}
          try {                                  // IN: Bootbox folder -> VM /mnt/share
            const imports = (window.Bridge && await Bridge.call("binary", "list")) || [];
            for (const n of imports) {
              if (!n || _pushedToVM.has(n)) continue;
              if (/\.(img|iso|gz|bin|wasm|part)$/i.test(n) || /\.state\.gz$/i.test(n)) continue;  // skip VM disks/engine
              try {
                const resp = await fetch(resolveVmres("vmres://iso/" + n));
                if (!resp.ok) continue;
                const buf = new Uint8Array(await resp.arrayBuffer());
                if (buf.length > 64 * 1024 * 1024) continue;     // 64 MB cap
                await emu.create_file(n, buf);
                _pushedToVM.add(n); inN++;
              } catch (e) {}
            }
          } catch (e) {}
          shareBtn.disabled = false;
          status.textContent = "Shared " + inN + " file(s) into the VM (/mnt/share) · pulled " + outN + " out to the Bootbox folder."; flashBtn(shareBtn, "✓ " + inN + " in / " + outN + " out", true);
        };
        const exitBtn = body.querySelector("#exit");
        if (exitBtn) {
          if (args.onExit) exitBtn.onclick = () => { try { emu && emu.stop && emu.stop(); } catch (e) {} args.onExit(); };
          else exitBtn.remove();   // windowed mode has the title-bar close button
        }

        // ---- Touch keyboard for v86 (iPad has no physical keys) ----
        // A hidden input summons the iOS soft keyboard on a tap; printable chars
        // go to keyboard_send_text, special/terminal keys to keyboard_send_scancodes
        // (XT set-1 codes). The key bar covers what iOS can't easily produce.
        (function setupKeyboard() {
          const kbd = body.querySelector("#kbd-capture");
          const screen = body.querySelector("#screen_container");
          const keysBar = body.querySelector("#emu-keys");
          const ctrlBtn = body.querySelector("#kctrl");
          if (!kbd || !screen) return;
          let ctrlOn = false;
          const setCtrl = (v) => { ctrlOn = v; if (ctrlBtn) ctrlBtn.classList.toggle("on", v); };
          const LETTER = { a:0x1E,b:0x30,c:0x2E,d:0x20,e:0x12,f:0x21,g:0x22,h:0x23,i:0x17,j:0x24,k:0x25,
            l:0x26,m:0x32,n:0x31,o:0x18,p:0x19,q:0x10,r:0x13,s:0x1F,t:0x14,u:0x16,v:0x2F,w:0x11,x:0x2D,y:0x15,z:0x2C };
          const SPECIAL = { Enter:[0x1C], Backspace:[0x0E], Tab:[0x0F], Escape:[0x01], Delete:[0xE0,0x53],
            ArrowUp:[0xE0,0x48], ArrowDown:[0xE0,0x50], ArrowLeft:[0xE0,0x4B], ArrowRight:[0xE0,0x4D] };
          const scan = (make) => {
            if (!emu || !emu.keyboard_send_scancodes) return;
            const brk = make.slice();
            for (let i = brk.length - 1; i >= 0; i--) { if (brk[i] !== 0xE0) { brk[i] |= 0x80; break; } }
            try { emu.keyboard_send_scancodes(make.concat(brk)); } catch (e) {}
          };
          const ctrlChar = (ch) => {
            const code = LETTER[(ch || "").toLowerCase()];
            if (emu && emu.keyboard_send_scancodes && code != null) { try { emu.keyboard_send_scancodes([0x1D, code, code | 0x80, 0x9D]); } catch (e) {} }
            else if (emu && emu.keyboard_send_text) { try { emu.keyboard_send_text(ch); } catch (e) {} }
          };
          const text = (s) => { if (emu && emu.keyboard_send_text) { try { emu.keyboard_send_text(s); } catch (e) {} } };
          const focusKbd = () => { try { kbd.focus({ preventScroll: true }); } catch (e) { try { kbd.focus(); } catch (e2) {} } };
          // --- 64-bit path: the QEMU guest reads a real terminal, so send ANSI bytes to the
          // xterm/pty (xterm.paste) instead of v86 PS/2 scancodes. qemuTerm is set in boot64. ---
          const send64 = (s) => { try { qemuTerm && qemuTerm.paste(s); } catch (e) {} };
          // Cursor keys must respect the terminal's DECCKM (application-cursor-keys) mode: full-screen
          // TUIs (mc, ncdu, vi, htop) send ESC[?1h then expect ESC O A for ↑ (not ESC [ A). We paste
          // bytes directly (bypassing xterm's own mode-aware keymap), so we read the mode off xterm and
          // emit the right form — otherwise arrows do nothing inside those apps.
          const ARROW_L = { ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D" };
          const appCursor = () => {
            try {
              const t = qemuTerm; if (!t) return false;
              if (t.modes && typeof t.modes.applicationCursorKeysMode === "boolean") return t.modes.applicationCursorKeysMode;
              const c = t._core || t.__core;
              const dm = c && ((c.coreService && c.coreService.decPrivateModes) || (c._coreService && c._coreService.decPrivateModes));
              return !!(dm && dm.applicationCursorKeys);
            } catch (e) { return false; }
          };
          const arrowSeq = (keyName) => { const L = ARROW_L[keyName]; return L ? ("\x1b" + (appCursor() ? "O" : "[") + L) : null; };
          const ANSI = { Enter: "\r", Backspace: "\x7f", Tab: "\t", Escape: "\x1b", Delete: "\x1b[3~",
            ArrowUp: "\x1b[A", ArrowDown: "\x1b[B", ArrowLeft: "\x1b[D", ArrowRight: "\x1b[C" };
          const ctrlByte = (ch) => String.fromCharCode(String(ch).toLowerCase().charCodeAt(0) & 0x1f);
          // --- GUI path: when the right pane shows the noVNC desktop (its tab is active and the RFB
          // is connected), route keys to the guest's X server via rfb.sendKey (keysym-based) instead
          // of the serial pty. For printable ASCII the X keysym == the char code; specials below. ---
          const GUIKS = { Enter: 0xff0d, Backspace: 0xff08, Tab: 0xff09, Escape: 0xff1b, Delete: 0xffff,
            ArrowUp: 0xff52, ArrowDown: 0xff54, ArrowLeft: 0xff51, ArrowRight: 0xff53 };
          const guiRfb = () => { const r = self.__rfb; return (r && r._rfbConnectionState === "connected") ? r : null; };
          const guiOn = () => { try { return !!(panel64Ref && panel64Ref.isGuiActive && panel64Ref.isGuiActive() && guiRfb()); } catch (e) { return false; } };
          // Android's VNC bridge turns a keysym into the bare Linux key ('A' -> KEY_A, '!' -> KEY_1),
          // so capitals/symbols need a real Shift around them there (X servers add Shift themselves).
          const SHIFTED = "ABCDEFGHIJKLMNOPQRSTUVWXYZ~!@#$%^&*()_+{}|:\"<>?";
          const guiKey = (ks, ctrl) => {
            const r = guiRfb(); if (!r || !ks) return;
            const shift = !!(r._sock && r._sock.__bbTouch) && ks < 0x80 && SHIFTED.indexOf(String.fromCharCode(ks)) >= 0;
            try {
              if (ctrl) r.sendKey(0xffe3, "ControlLeft", true);     // hold Ctrl_L
              if (shift) r.sendKey(0xffe1, "ShiftLeft", true);
              r.sendKey(ks, null, true); r.sendKey(ks, null, false);
              if (shift) r.sendKey(0xffe1, "ShiftLeft", false);
              if (ctrl) r.sendKey(0xffe3, "ControlLeft", false);
            } catch (e) {}
          };
          const guiText = (s, ctrl) => { const str = String(s); for (let i = 0; i < str.length; i++) guiKey(str.charCodeAt(i), ctrl && i === str.length - 1); };
          // Hardware keyboards (iPad Magic Keyboard etc.) are captured NATIVELY in
          // HostView.swift and delivered via window.__emuKey (below): iPadOS routes
          // physical keys to the UIKit responder chain, NOT to the WKWebView page when
          // no web <input> is focused, so a web-only/focus-based path can't see them.
          // We therefore do NOT auto-focus the hidden input (focusing it would divert
          // hardware keys back to that unreliable web path). #kbd-capture is only for the
          // on-screen soft keyboard, summoned by "⌨ Type" or a touch tap.

          // Translate a key event into guest input; returns true if it consumed the key.
          const handleKey = (e) => {
            if (qemuTerm) {                                    // 64-bit
              if (guiOn()) {                                   // GUI tab active -> keys to the X desktop
                if (GUIKS[e.key]) { guiKey(GUIKS[e.key], ctrlOn || e.ctrlKey); if (ctrlOn) setCtrl(false); return true; }
                if (e.key && e.key.length === 1) { guiText(e.key, ctrlOn || e.ctrlKey); if (ctrlOn) setCtrl(false); return true; }
                return false;
              }
              if (ARROW_L[e.key]) { send64(arrowSeq(e.key)); return true; }  // DECCKM-aware cursor keys
              if (ANSI[e.key]) { send64(ANSI[e.key]); return true; }   // else feed the serial pty
              if (e.key && e.key.length === 1) {
                if (ctrlOn || e.ctrlKey) { send64(ctrlByte(e.key)); setCtrl(false); } else send64(e.key);
                return true;
              }
              return false;
            }
            if (!emu) return false;
            if (SPECIAL[e.key]) { scan(SPECIAL[e.key]); return true; }
            if (e.key && e.key.length === 1) {                 // printable char (hardware keyboard)
              if (ctrlOn || e.ctrlKey) { ctrlChar(e.key); setCtrl(false); } else text(e.key);
              return true;
            }
            return false;
          };
          kbd.addEventListener("keydown", (e) => { if (handleKey(e)) e.preventDefault(); });
          // Backstop: if a hardware key lands on the document instead of the (focused)
          // hidden input — e.g. focus was momentarily lost — still forward it. Bubble
          // phase so the input's own handler runs first (defaultPrevented => skip here,
          // no double-send). Self-removes once this emulator view is gone (no leak).
          const onDocKey = (e) => {
            if (!document.body.contains(kbd)) { window.removeEventListener("keydown", onDocKey); return; }
            if (e.target === kbd || e.defaultPrevented) return;
            if (handleKey(e)) e.preventDefault();
          };
          window.addEventListener("keydown", onDocKey);

          // Native hardware-keyboard bridge. HostView.swift (UIPress/UIKey) forwards
          // every physical key here, because WKWebView doesn't deliver hardware keys to
          // the page when no <input> is focused. info = {key,char,ctrl,alt,shift}.
          window.__emuKey = (info) => {
            try {
              if (!info) return;
              if (status) status.textContent = "⌨ " + (info.key || info.char || "?");   // on-screen proof a key arrived
              if (qemuTerm) {                                  // 64-bit
                const qk = info.key;
                if (guiOn()) {                                 // GUI tab active -> X desktop
                  if (GUIKS[qk]) { guiKey(GUIKS[qk], info.ctrl || ctrlOn); if (ctrlOn) setCtrl(false); return; }
                  const gch = info.char || (qk && qk.length === 1 ? qk : "");
                  if (gch) { guiText(gch, info.ctrl || ctrlOn); if (ctrlOn) setCtrl(false); }
                  return;
                }
                if (ARROW_L[qk]) { send64(arrowSeq(qk)); return; }   // DECCKM-aware cursor keys
                if (ANSI[qk]) { send64(ANSI[qk]); return; }    // else serial pty
                const qch = info.char || (qk && qk.length === 1 ? qk : "");
                if (!qch) return;
                if (info.ctrl || ctrlOn) { send64(ctrlByte(qch)); setCtrl(false); } else send64(qch);
                return;
              }
              if (!emu) return;
              const k = info.key;
              if (SPECIAL[k]) { scan(SPECIAL[k]); return; }
              const ch = info.char || (k && k.length === 1 ? k : "");
              if (!ch) return;
              if (info.ctrl || ctrlOn) { ctrlChar(ch); setCtrl(false); } else text(ch);
            } catch (e) {}
          };

          kbd.addEventListener("input", () => {                // soft keyboard (keydown is 229)
            const v = kbd.value; kbd.value = "";
            if (!v) return;
            if (qemuTerm) {
              if (guiOn()) { guiText(v, ctrlOn); if (ctrlOn) setCtrl(false); return; }   // GUI tab active -> X desktop
              if (ctrlOn) { send64(ctrlByte(v[v.length - 1])); setCtrl(false); } else send64(v); return;
            }
            if (ctrlOn) { ctrlChar(v[v.length - 1]); setCtrl(false); } else text(v);
          });
          if (keysBar) keysBar.addEventListener("click", (e) => {
            const b = e.target.closest("[data-k]"); if (!b) return;
            const k = b.dataset.k;
            if (k === "kbd") return focusKbd();
            if (k === "ctrl") return setCtrl(!ctrlOn);
            if (qemuTerm) {                                    // 64-bit
              if (guiOn()) {                                   // GUI tab active -> X desktop
                if (k === "ctrlc") { guiKey(0x63, true); }     // Ctrl+C
                else { const GK = { esc: GUIKS.Escape, tab: GUIKS.Tab, up: GUIKS.ArrowUp, down: GUIKS.ArrowDown, left: GUIKS.ArrowLeft, right: GUIKS.ArrowRight }; if (GK[k]) guiKey(GK[k]); }
                return;
              }
              const BTN2ARROW = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
              if (BTN2ARROW[k]) { send64(arrowSeq(BTN2ARROW[k])); return; }   // DECCKM-aware cursor keys
              const SEQ = { ctrlc: "\x03", esc: "\x1b", tab: "\t" };
              if (SEQ[k]) send64(SEQ[k]);   // else ANSI to the serial pty
              return;
            }

            if (k === "ctrlc") { if (emu && emu.keyboard_send_scancodes) { try { emu.keyboard_send_scancodes([0x1D, 0x2E, 0xAE, 0x9D]); } catch (e) {} } return; }
            const map = { esc:[0x01], tab:[0x0F], up:[0xE0,0x48], down:[0xE0,0x50], left:[0xE0,0x4B], right:[0xE0,0x4D] };
            if (map[k]) scan(map[k]);
          });
        })();

        if (args && args.autoboot) boot();
  }

  // Windowed launch (desktop app). The Bootbox flow uses renderFull() instead.
  function launch(args) {
    args = args || {};
    const win = WM.open({
      appId: "emulator", title: "x86 Emulator", icon: "🖥️", width: 820, height: 600,
      render(body) { renderEmulator(body, args); },
    });
    if (args && args.maximize && win) { try { WM.toggleMax(win.id); } catch (e) {} }
    return win;
  }

  // Full-screen render (Bootbox flow): fills `container`, no window chrome.
  function renderFull(container, args) {
    container.style.background = "#000";
    renderEmulator(container, args || {});
  }

  Apps.register({ id: "emulator", name: "x86 Emulator", icon: "🖥️", desktop: true, launch });
  window.Emulator = { renderFull, launch };
})();
