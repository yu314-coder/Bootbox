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
    { id: "custom",    name: "ISO / disk image…",                          boot: "cdrom",
      url: "", kind: "cdrom", ram: 512, vga: 32 },
    { id: "x64pw",     name: "64-bit Linux + Python & Wine (x86_64) — QEMU-Wasm",  boot: "q64",
      base: "vendor/qemu-aload/", url: "", ram: 1536 },
    // Lightweight graphical desktop: its OWN image (no Wine, no browser — browsers freeze Xvnc under
    // TCG). twm/tint2 + a terminal + mc file manager. Reuses the x86_64 engine (wasm shared from
    // qemu-aload — no duplication). The image auto-starts the desktop, so boot64 sends no start-desktop.
    { id: "x64pwd",    name: "64-bit Linux — Desktop (x86_64) — QEMU-Wasm",  boot: "q64",
      base: "vendor/qemu-desktop/", wasm: "../qemu-aload/qemu-system-x86_64.wasm", url: "", ram: 1536, gui: true },
    // REAL 64-bit ARM (aarch64) Linux — separate QEMU engine (qemu-system-aarch64). Alpine + Python +
    // internet; no Wine (x86-only). wasm names the engine binary so run.js fetches the right one.
    { id: "arm64",     name: "64-bit Linux — ARM64 (aarch64) — QEMU-Wasm",  boot: "q64",
      base: "vendor/qemu-aarch64/", wasm: "qemu-system-aarch64.wasm", url: "", ram: 1536, arch: "arm64" },
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
    "vendor/qemu-aload/": { files: [
      { url: "https://github.com/yu314-coder/Bootbox/releases/download/linux64-v1/qemu64-rootfs.data.gz",
        name: "qemu64-rootfs-718508644.data.gz", mb: 260 },
    ] },
    "vendor/qemu-aarch64/": { files: [
      { url: "https://github.com/yu314-coder/Bootbox/releases/download/linux-arm64-v1/qemu-aarch64-engine.wasm.gz",
        name: "qemu-aarch64-engine-58401341.wasm.gz", mb: 20 },
      { url: "https://github.com/yu314-coder/Bootbox/releases/download/linux-arm64-v1/qemu-aarch64-rootfs.data.gz",
        name: "qemu-aarch64-rootfs-265429461.data.gz", mb: 57 },
    ] },
    "vendor/qemu-desktop/": { files: [   // x86_64 engine shared from qemu-aload; only the rootfs downloads
      { url: "https://github.com/yu314-coder/Bootbox/releases/download/linux-desktop-v1/qemu-desktop-rootfs.data.gz",
        name: "qemu-desktop-rootfs-375997966.data.gz", mb: 129 },
    ] },
  };
  // Ensure the guest's rootfs is present before booting: trigger the native download (BinaryBridge
  // "download" → Downloader, progress via "downloadProgress" events) and wait for it. No-op for
  // bundled guests or when the native bridge isn't present (e.g. the Mac test harness).
  async function ensureRootfs(g, status, setState) {
    const cfg = ROOTFS_REMOTE[g && g.base];
    if (!cfg) return;
    if (!window.Bridge || typeof Bridge.call !== "function") return;
    for (const f of cfg.files) {                     // download each part (aarch64 = engine + rootfs)
      let r;
      try { r = await Bridge.call("binary", "download", { url: f.url, name: f.name }); }
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
          if (mb !== last) { last = mb; try { status.textContent = "Downloading Linux image (one-time, ~" + f.mb + " MB)… " + pct + mb + " MB"; } catch (e) {} }
        };
        Bridge.onEvent("downloadProgress", handler);
      });
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

  // Touch-as-mouse for v86 on iPad: drag = move (relative PS/2 mouse; v86 inverts Y),
  // tap = left click + summon keyboard, two-finger tap = right click, hold-drag = drag.
  // Verified against the bundled v86 API (emulator.bus / mouse_set_status / mouse-delta+click).
  function installV86TouchMouse(emulator, opts) {
    opts = opts || {};
    const container = opts.container || document.getElementById(opts.containerId || "screen_container");
    if (!container || !emulator || !emulator.bus) return;
    const kbd = opts.keyboardInput || null;
    const SENS = opts.sensitivity != null ? opts.sensitivity : 1.5;
    const TAP_TOL = 10, TAP_MS = 250, HOLD_MS = 300;
    // v86's PS/2 mouse packs a whole delta into ONE packet, and a packet axis is only 9-bit
    // (-256..255): libv86 send_mouse_packet pushes the raw byte with NO multi-packet split.
    // So a big motion (e.g. the -1104 corner-home slam in anchor()) is truncated to a tiny
    // step and the cursor never lands where intended — THE cause of the touch misalignment.
    // Emit motion in <=120px steps so every packet stays in range and the full distance is
    // actually travelled. (Guest pointer accel is set flat, so the steps sum to 1:1.)
    const sendStep = (dx, dy) => {
      let rx = Math.round(dx), ry = Math.round(dy), guard = 0;
      while ((rx !== 0 || ry !== 0) && guard++ < 200) {
        const sx = rx > 120 ? 120 : rx < -120 ? -120 : rx;
        const sy = ry > 120 ? 120 : ry < -120 ? -120 : ry;
        try { emulator.bus.send("mouse-delta", [sx, sy]); } catch (e) {}
        rx -= sx; ry -= sy;
      }
    };
    const sendDelta = (dx, dy) => sendStep(dx * SENS, -(dy * SENS));
    const sendButtons = (l, m, r) => { try { emulator.bus.send("mouse-click", [!!l, !!m, !!r]); } catch (e) {} };
    const leftDown = () => sendButtons(1, 0, 0), leftUp = () => sendButtons(0, 0, 0);
    const rightClick = () => { sendButtons(0, 0, 1); sendButtons(0, 0, 0); };
    const leftClick = () => { leftDown(); leftUp(); };
    // Absolute positioning so a tap lands WHERE the finger touches. v86 only exposes a
    // RELATIVE PS/2 mouse, so we: (1) map the touch point to the guest pixel under it
    // (accounting for object-fit:contain letterboxing), (2) slam the cursor to the
    // top-left corner with an overshooting delta, (3) move it to that pixel. v86's dy is
    // inverted (positive dy = up). Precise when the guest's pointer acceleration is OFF
    // (shipped images set MouseSpeed/Threshold1/2 = 0); with accel on it still lands close.
    const sendRaw = (dx, dy) => sendStep(dx, dy);
    const mapGuest = (clientX, clientY) => {
      const cv = container.querySelector("canvas");
      if (!cv || !cv.width || !cv.height) return null;
      const r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return null;
      const scale = Math.min(r.width / cv.width, r.height / cv.height);
      return [
        Math.max(0, Math.min(cv.width - 1, (clientX - (r.left + (r.width - cv.width * scale) / 2)) / scale)),
        Math.max(0, Math.min(cv.height - 1, (clientY - (r.top + (r.height - cv.height * scale) / 2)) / scale)),
        cv.width, cv.height,
      ];
    };
    // Absolute positioning (with v86's mouse left ENABLED so clicks work). On each touch/press we
    // anchor the cursor to the EXACT guest pixel under the finger via mapGuest, which already
    // EXCLUDES the object-fit letterbox (the black side bars) so it isn't pushed toward centre.
    // We can't read the guest cursor back, so we corner-slam then place (kills drift). DRAG motion
    // is left to v86's own relative touch handler (touch), while the trackpad — which v86 doesn't
    // handle — is driven by our own absolute tracking (track()).
    let gCur = null;                          // our tracked guest-cursor position (guest px); null = unknown
    const anchor = (clientX, clientY) => {    // re-establish a known position AT the pointer
      const g = mapGuest(clientX, clientY); if (!g) return;
      sendRaw(-(g[2] + 80), g[3] + 80);                 // slam into the top-left corner (overshoot)
      sendRaw(Math.round(g[0]), -Math.round(g[1]));     // then to the exact guest pixel
      gCur = { x: g[0], y: g[1] };
    };
    const track = (clientX, clientY) => {     // follow the pointer with one cheap exact delta
      const g = mapGuest(clientX, clientY); if (!g) return;
      if (!gCur) { anchor(clientX, clientY); return; }
      sendRaw(Math.round(g[0] - gCur.x), -Math.round(g[1] - gCur.y));
      gCur = { x: g[0], y: g[1] };
    };
    let active = false, dragging = false, moved = false, twoFinger = false, scrolled = false;
    let startX = 0, startY = 0, startT = 0, scrollY = 0;
    const refocusKbd = () => { if (kbd && document.activeElement !== kbd) { try { kbd.focus({ preventScroll: true }); } catch (e) { try { kbd.focus(); } catch (e2) {} } } };
    const twoAvgY = (e) => (e.touches[0].clientY + e.touches[1].clientY) / 2;
    container.addEventListener("touchstart", (e) => {
      if (kbd && e.target === kbd) return; e.preventDefault();
      if (e.touches.length >= 2) {                       // two fingers = scroll / right-click (never a left press)
        twoFinger = true; scrolled = false; scrollY = twoAvgY(e);
        if (dragging) { leftUp(); dragging = false; }    // cancel the one-finger press the 2nd finger interrupts
        anchor((e.touches[0].clientX + e.touches[1].clientX) / 2, scrollY);   // put the cursor under the fingers so the wheel scrolls THAT content
        return;
      }
      const t = e.touches[0]; startX = t.clientX; startY = t.clientY; startT = nowMs();
      active = true; moved = false; twoFinger = false; scrolled = false;
      // Direct touch: the finger IS the pointer. Anchor the cursor under it and press NOW — moving
      // then drags (the cursor follows the finger via track()), a quick lift is a click.
      anchor(t.clientX, t.clientY); leftDown(); dragging = true;
    }, { passive: false });
    container.addEventListener("touchmove", (e) => {
      if (kbd && e.target === kbd) return; e.preventDefault();
      if (e.touches.length >= 2) {                       // two-finger drag => mouse wheel (scroll)
        twoFinger = true;
        const y = twoAvgY(e); const STEP = 16; const n = ((y - scrollY) / STEP) | 0;   // whole wheel clicks since last move
        if (n) { for (let i = 0; i < Math.abs(n); i++) { try { emulator.bus.send("mouse-wheel", [n > 0 ? -1 : 1, 0]); } catch (e2) {} } scrollY += n * STEP; scrolled = true; }
        return;
      }
      if (!active) return;
      const t = e.touches[0];
      if (Math.abs(t.clientX - startX) > TAP_TOL || Math.abs(t.clientY - startY) > TAP_TOL) moved = true;
      track(t.clientX, t.clientY);                       // one-finger drag: cursor follows the finger (button held)
    }, { passive: false });
    const endSeq = () => {
      if (!active && !twoFinger) return;
      const wasTwo = twoFinger, wasScroll = scrolled, wasTap = !moved && (nowMs() - startT) <= TAP_MS;
      if (dragging) { leftUp(); dragging = false; }      // release the held button (ends a click or a drag)
      active = false; twoFinger = false; scrolled = false;
      if (wasTwo) { if (!wasScroll) rightClick(); return; }   // two-finger tap (no scroll) = right-click
      if (wasTap) refocusKbd();
    };
    container.addEventListener("touchend", (e) => { if (kbd && e.target === kbd) return; e.preventDefault(); if (e.touches.length === 0) endSeq(); }, { passive: false });
    container.addEventListener("touchcancel", () => { if (dragging) leftUp(); active = false; dragging = false; twoFinger = false; scrolled = false; }, { passive: false });

    // --- Trackpad / hardware mouse: absolute tracking. iPad may deliver the trackpad as POINTER
    // events (pointerType "mouse") OR as plain MOUSE events depending on the WKWebView, so we drive
    // off BOTH, deduped (the mouse path skips if a pointer event just fired). Touch is unaffected:
    // it fires pointerType "touch" (filtered out) and its compat mouse events are preventDefaulted.
    // noteInput() briefly shows which path actually fires, so we can see what the trackpad sends.
    let lastPtr = 0;
    const noteInput = (k, e) => { try { status._hold = nowMs() + 4000; status.textContent = "input: " + k + " (" + (e.pointerType || "mouse") + ") — driving the cursor"; } catch (_e) {} };
    const ptrMouse = (e) => e.pointerType && e.pointerType !== "touch";   // mouse/trackpad/pen only (not finger)
    container.addEventListener("pointermove", (e) => { if (!ptrMouse(e)) return; lastPtr = nowMs(); track(e.clientX, e.clientY); });
    container.addEventListener("pointerdown", (e) => { if (!ptrMouse(e)) return; lastPtr = nowMs(); noteInput("pointerdown", e); e.preventDefault(); anchor(e.clientX, e.clientY); if (e.button === 2) rightClick(); else { leftDown(); refocusKbd(); } });
    container.addEventListener("pointerup", (e) => { if (!ptrMouse(e)) return; lastPtr = nowMs(); if (e.button !== 2) leftUp(); });
    container.addEventListener("pointercancel", (e) => { if (!ptrMouse(e)) return; gCur = null; });
    container.addEventListener("pointerleave", (e) => { if (!ptrMouse(e)) return; gCur = null; });
    // Fallback for a trackpad/mouse that emits only MOUSE events (no pointer events):
    const stale = () => nowMs() - lastPtr > 600;   // a pointer event isn't currently handling it
    container.addEventListener("mousemove", (e) => { if (stale()) track(e.clientX, e.clientY); });
    container.addEventListener("mousedown", (e) => { if (!stale()) return; noteInput("mousedown", e); e.preventDefault(); anchor(e.clientX, e.clientY); if (e.button === 2) rightClick(); else { leftDown(); refocusKbd(); } });
    container.addEventListener("mouseup", (e) => { if (!stale()) return; if (e.button !== 2) leftUp(); });
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
               so override with !important; object-fit:contain letterboxes as needed. */
            #screen_container canvas{image-rendering:auto !important;position:absolute !important;
              top:0 !important;left:0 !important;width:100% !important;height:100% !important;
              object-fit:contain !important}
            /* Hide the iPad trackpad/host pointer over the screen: v86's mouse is
               RELATIVE, so a host pointer (absolute) drifts out of sync with the
               guest cursor. With it hidden, the guest cursor is the only one and you
               drive it like a laptop trackpad. */
            #screen_container, #screen_container *{cursor:none !important}
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
            <select class="e-sel" id="cores" style="width:104px;display:none" title="CPU cores for the 64-bit Linux guests (applies at boot). 2 = balanced default: real parallel execution, and idle power stays as low as 1 core. More cores help CPU-heavy parallel jobs; disk-heavy jobs gain little beyond 2. 1 = simplest. Power is only spent while cores are actually busy.">
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
          ramInput.value = c.ram || g.ram || 512;   // restore the RAM the user last set
          coresSel.style.display = (g.boot === "q64") ? "" : "none";   // cores apply to the 64-bit guests
        }
        guestSel.onchange = syncGuest; syncGuest();
        if (args.ram) ramInput.value = args.ram;   // RAM chosen in the Bootbox BIOS overrides for this boot
        // persist the RAM count whenever the user edits it (so it's remembered)
        ramInput.addEventListener("change", () => { const v = Math.max(64, +ramInput.value || 0); if (v) setCfg({ ram: v }); });
        // CPU cores (64-bit guests): remembered across boots; the UEFI-Setup value seeds this boot.
        coresSel.value = String(+args.cores || +c.cores64 || 2);
        if (!coresSel.value) coresSel.value = "2";   // guard: unknown value -> select falls back
        coresSel.addEventListener("change", () => {
          setCfg({ cores64: +coresSel.value || 2 });
          try { status.textContent = "CPU cores set to " + coresSel.value + " — applies on the next boot (press ⏻ Start to reboot)."; } catch (e) {}
        });

        async function boot() {
          const g = GUESTS.find(x => x.id === guestSel.value) || GUESTS[0];
          qemuTerm = null; qemuFs = null;   // reset; boot64 re-sets them once the 64-bit terminal is ready
          // 64-bit mode runs on a different engine (QEMU-Wasm), not v86.
          if (g.boot === "q64") { setCfg({ guest: g.id }); return boot64(g); }
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
              // Keep v86's built-in mouse ENABLED — it is LOAD-BEARING: with it off the guest never
              // sees our clicks (bus.send mouse-click only reaches the guest while v86's mouse adapter
              // is active — disabling it = "cannot click"). We still position ABSOLUTELY ourselves on
              // each touch/press; v86's own relative handler does the drag movement.
              try { emu.mouse_set_status && emu.mouse_set_status(true); } catch (e) {}
              try { installV86TouchMouse(emu, { container: body.querySelector("#screen_container"), keyboardInput: body.querySelector("#kbd-capture") }); } catch (e) {}
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
            catch (e) { setState("Download needed"); status.textContent = "Couldn't download the 64-bit Linux image (needs internet on first boot): " + ((e && e.message) || e); return; }
            await window.QEMU_WASM.run({
              screen_container: panel64.termHost,
              base: g.base || "vendor/qemu/",   // per-guest engine/rootfs dir (qemu-aload = the Python/Wine Alpine)
              wasm: g.wasm || "qemu-system-x86_64.wasm",   // engine binary name (aarch64 guest = qemu-system-aarch64.wasm)
              netWs: "ws://127.0.0.1:8889/",   // in-app gVisor netstack (MiniOSApp.startNetStack) -> real internet
              vnc: "ws://127.0.0.1:8889/vnc",   // noVNC GUI bridge: netstack /vnc endpoint -> vn.Dial(guest x11vnc:5900)
              ram: Math.min(1536, Math.max(64, +ramInput.value || g.ram || 1536)),   // toolbar drives QEMU -m; cap 1536 (Mac-verified boot; 2047 = QEMU wasm hard max but doesn't fit the 3GB heap beside the rootfs)
              smp: Math.max(1, Math.min(8, +coresSel.value || (args && +args.cores) || 0)) || undefined,   // toolbar "cores" (falls back to UEFI setup, then the guest's baked -smp)
              onStatus: (m) => { try { status.textContent = m; } catch (e) {} },
              onReady: (r) => {
                setState("Running");
                qemuTerm = r && (r.xterm || r.term); qemuFs = r && r.fs; panel64Ref = panel64;
                try { panel64.setFs && panel64.setFs(qemuFs); } catch (e) {}   // Files tab ⬆/⬇ transfers
                try { panel64.setXterm(qemuTerm); } catch (e) {}
                try { if (r && r.connectGui) panel64.onGuiOpen = (host) => r.connectGui(host, panel64.setGuiStatus); } catch (e) {}
                if (g.gui) {   // full-screen desktop (the qemu-desktop image auto-starts twm/tint2 + terminal + mc)
                  try { panel64.showGui(); } catch (e) {}   // the desktop IS the GUI → connect immediately
                  status.textContent = "Running — full-screen x86_64 Linux desktop (terminal + mc file manager). It comes up ~20–40s after boot; tap a window, then ⌨ Type to use the keyboard.";
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
          const guiKey = (ks, ctrl) => {
            const r = guiRfb(); if (!r || !ks) return;
            try {
              if (ctrl) r.sendKey(0xffe3, "ControlLeft", true);     // hold Ctrl_L
              r.sendKey(ks, null, true); r.sendKey(ks, null, false);
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
