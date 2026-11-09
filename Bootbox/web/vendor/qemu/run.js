/* MiniOS 64-bit runtime — boots x86_64 Linux via QEMU-Wasm (container2wasm) into
 * an xterm terminal. Exposes window.QEMU_WASM.run({ screen_container, base, onReady, onError }).
 *
 * REQUIRES crossOriginIsolated === true (SharedArrayBuffer) for QEMU's pthreads.
 * In a browser that means COOP/COEP response headers; in the iPad app the host
 * page must be served cross-origin-isolated (see HostView scheme handler).        */
(function () {
  const RUN_JS_URL = (document.currentScript && document.currentScript.src) || location.href;   // for lazypack.js
  function loadScript(src, type) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      if (type) s.type = type;
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("load failed: " + src));
      document.head.appendChild(s);
    });
  }
  function loadCss(href) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l);
  }
  // Does this engine accept wasm tail calls? (func (param i32) (result i32) with return_call_indirect
  // through a funcref table.) Gates the engine's TB chaining.
  function wasmTailCalls() {
    try {
      return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0,
        1, 6, 1, 96, 1, 127, 1, 127,            // type 0: (i32) -> i32
        3, 2, 1, 0,                             // func 0: type 0
        4, 4, 1, 112, 0, 1,                     // table: funcref, min 1
        10, 11, 1, 9, 0, 32, 0, 32, 0, 19, 0, 0, 11]));   // local.get 0 x2, return_call_indirect 0 0
    } catch (e) { return false; }
  }

  async function run(opts) {
    const base = opts.base || "vendor/qemu/";
    // A guest pack can reuse a compatible engine without duplicating its
    // multi-megabyte WASM/JS/xterm files. The Android guest does this: its
    // .data + QEMU arguments live in qemu-android, while the executable engine
    // remains the proven qemu-aload build.
    const engineBase = opts.engineBase || base;
    // A guest that needs a different QEMU binary can point engineModuleBase at it
    // while still sharing the terminal support files. (Android used a separate
    // 3 GiB-heap build until build 83; it now runs on the shared qemu-aload engine.)
    const engineModuleBase = opts.engineModuleBase || engineBase;
    const host = opts.screen_container;
    const sayOut = (typeof opts.onStatus === "function") ? opts.onStatus : function () {};
    let lastSay = "";
    const say = (m) => { lastSay = String(m || ""); sayOut(m); };
    // Start-up card (Linux desktop / Android, opts.bootCard): the screen shows the real start-up steps
    // instead of a black pane. Each step ends on something the guest really does: the engine's
    // instantiate callback, the container init's first "mounting" line on the console (the kernel is
    // up), the shell prompt (the system is up) and the display's VNC connect.
    const bootP = { t0: Date.now(), engine: 0, kernel: 0, system: 0, xt: null, handed: false, connected: false, timer: 0 };
    function bootScan() {
      if (!bootP.xt || (bootP.kernel && bootP.system)) return;
      try {
        const b = bootP.xt.buffer.active;
        for (let i = Math.max(0, b.length - 80); i < b.length; i++) {
          const ln = b.getLine(i); if (!ln) continue;
          const s = ln.translateToString(true);
          if (!bootP.kernel && /^\d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d /.test(s)) bootP.kernel = Date.now();
          if (!bootP.system && /(localhost|bootbox):.*#\s*$/.test(s)) bootP.system = Date.now();
        }
        if (bootP.system && !bootP.kernel) bootP.kernel = bootP.system;
      } catch (e) {}
    }
    function bootInfo() {
      if (bootP.connected) return null;   // a later reconnect: plain text only
      bootScan();
      let p = null; try { p = self.BootboxLazyPack && self.BootboxLazyPack.progress(); } catch (e) {}
      const snap = p && p.snapshot && p.snapshot.size ? p.snapshot : null;
      const marks = opts.touchGuest
        ? [["Start the x86-64 engine", !!bootP.engine], ["Load the saved Android state", !!(snap && snap.read >= snap.size)], ["Connect the screen", false]]
        : [["Start the x86-64 engine", !!bootP.engine], ["Boot the Linux kernel", !!bootP.kernel], ["Start the system", !!bootP.system], ["Open the desktop", false]];
      if (opts.touchGuest && !snap && bootP.engine) marks[1][1] = !!bootP.handed;
      let on = marks.findIndex((m) => !m[1]); if (on < 0) on = marks.length - 1;
      let detail = "";
      if (!bootP.engine) {
        detail = lastSay.replace(/^64-bit:\s*/, "").replace(/^Android:\s*/, "");
        if (/^working…/.test(detail)) detail = "Setting up the virtual machine…";
      }
      else if (/Downloading data\.\.\. \((\d+)\/(\d+)\)/.test(lastSay) && +RegExp.$1 < +RegExp.$2) detail = "Loading the system image: " + Math.floor(100 * RegExp.$1 / RegExp.$2) + "%";
      else if (snap && snap.read < snap.size) detail = "Saved state: " + Math.floor(100 * snap.read / snap.size) + "%";
      else if (p && p.fetched) detail = "Guest data read: " + Math.round(p.fetched / 1048576) + " MB";
      return {
        title: "Starting " + (opts.bootTitle || (opts.touchGuest ? "Android" : "Linux")),
        steps: marks.map((m, i) => ({ label: m[0], done: m[1], on: i === on })),
        step: on + 1, total: marks.length, sec: Math.round((Date.now() - bootP.t0) / 1000), detail,
        note: opts.safeNote ? "Running a slower engine after an earlier crash (" + opts.safeNote + ") — UEFI Setup › Advanced › Reset Engine." : "",
      };
    }
    function bootLine(info) { return info.title + " — step " + info.step + " of " + info.total + ": " + info.steps[info.step - 1].label + " (" + info.sec + " s)"; }
    if (typeof opts.bootCard === "function") {
      const tick = () => {
        if (bootP.handed) { clearInterval(bootP.timer); return; }
        const info = bootInfo(); if (info) { try { opts.bootCard(bootLine(info), info); } catch (e) {} }
      };
      bootP.timer = setInterval(tick, 1000); tick();
    }
    if (!self.crossOriginIsolated) {
      opts.onError && opts.onError(new Error("64-bit mode needs cross-origin isolation (SharedArrayBuffer). " +
        "The host page must send COOP/COEP headers."));
      return;
    }
    // Pre-create Module with locateFile so load.js (.data) and out.js (.wasm)
    // fetch from the vendor/qemu/ subdir rather than the page root.
    const absBase = new URL(base, location.href).href;
    const absEngineBase = new URL(engineBase, location.href).href;
    const absEngineModuleBase = new URL(engineModuleBase, location.href).href;
    self.Module = self.Module || {};
    self.Module.locateFile = (p) => (/\.data(?:$|\?)/.test(p) ? absBase : absEngineModuleBase) + p;
    // load.js starts fetching before the terminal exists.  Preserve its progress
    // here and surface it through the Bootbox status UI immediately; otherwise a
    // WebKit allocation/fetch failure looks exactly like a frozen "Preparing…".
    const earlyBootStages = [];
    self.Module.bootboxStage = (message) => {
      const text = String(message || "");
      if (!text) return;
      earlyBootStages.push(text);
      say("Android: " + text);
    };

    loadCss(engineBase + "xterm.css");
    // xterm + xterm-pty expose globals (Terminal, openpty)
    await loadScript(engineBase + "xterm.js");
    await loadScript(engineBase + "xterm-pty.js");
    // load.js (data preloader) + arg-module.js (qemu args) define/extend global Module.
    // lazypack.js first: load.js reads an expanded, Range-served pack on demand through it.
    await loadScript(new URL("lazypack.js", RUN_JS_URL).href).catch(() => {});
    await loadScript(base + "load.js");
    await loadScript(base + "arg-module.js");
    // RAM control: the toolbar value (opts.ram) overrides the baked "-m" so it's no longer locked.
    if (opts.ram && self.Module && self.Module.arguments) {
      const a = self.Module.arguments, i = a.indexOf("-m");
      if (i >= 0 && a[i + 1] != null) a[i + 1] = opts.ram + "M";
    }
    // CPU name (build 101): the CPUID brand string guests and CPU-Z show ("Specification"). qemu64's
    // default, "QEMU Virtual CPU version 2.5+", reads like real hardware; say what it is. Cold-boot
    // guests only (a resumed snapshot keeps its CPU definition). QEMU caps it at 48 characters.
    if (opts.cpuModelId && self.Module && self.Module.arguments) {
      const a = self.Module.arguments, i = a.indexOf("-cpu");
      if (i >= 0 && a[i + 1] != null && a[i + 1].indexOf("model-id=") < 0)
        a[i + 1] += ",model-id=" + String(opts.cpuModelId).replace(/,/g, " ").slice(0, 48);
    }
    // Extra kernel command-line words for cold-boot guests (opts.kernelArgs), before init's own args.
    if (opts.kernelArgs && self.Module && self.Module.arguments) {
      const a = self.Module.arguments, i = a.indexOf("-append");
      if (i >= 0 && a[i + 1] != null) {
        const extra = String(opts.kernelArgs).replace(/[^a-zA-Z0-9_.,=\- ]/g, "");
        a[i + 1] = a[i + 1].indexOf(" init=") >= 0 ? a[i + 1].replace(" init=", " " + extra + " init=") : a[i + 1] + " " + extra;
      }
    }
    // Extra CPU features for cold-boot guests (opts.cpuFlags, e.g. "+aes,+ssse3"): appended to -cpu.
    if (opts.cpuFlags && self.Module && self.Module.arguments) {
      const a = self.Module.arguments, i = a.indexOf("-cpu");
      if (i >= 0 && a[i + 1] != null) a[i + 1] += "," + String(opts.cpuFlags).replace(/[^+\-a-z0-9_.,]/gi, "");
    }
    // CPU cores: opts.smp overrides the baked "-smp" (the x64 console guest ships dual-core;
    // 1 = battery saver — each vCPU worker costs ~1 host core even at an idle prompt).
    if (opts.smp && self.Module && self.Module.arguments) {
      const a = self.Module.arguments, i = a.indexOf("-smp");
      if (i >= 0 && a[i + 1] != null) a[i + 1] = String(opts.smp);
    }
    // Networking (opt-in): route the guest's -netdev socket over a WebSocket to a netstack
    // (c2w-net / gvisor-tap-vsock) that performs REAL native TCP — no CORS, no service worker.
    // opts.netWs = "ws://host:port/". Swaps the default "-nic none" for a virtio-net NIC whose
    // MAC matches c2w-net's DHCP static lease (02:00:00:00:00:01 -> 192.168.127.3).
    if (opts.netWs && self.Module && self.Module.arguments) {
      self.Module.websocket = self.Module.websocket || {};
      self.Module.websocket.url = opts.netWs;
      const a = self.Module.arguments;
      if (a.indexOf("-netdev") < 0) {   // guest has no NIC yet (Alpine, "-nic none") — add one routed to the netstack
        const host = opts.netWs.replace(/^wss?:\/\//, "").replace(/\/.*$/, "");
        const netArgs = ["-netdev", "socket,id=vmnic,connect=" + host, "-device", "virtio-net-pci,netdev=vmnic,mac=02:00:00:00:00:01"];
        const ni = a.indexOf("-nic");
        if (ni >= 0) a.splice(ni, 2, ...netArgs); else a.push(...netArgs);
      }
      // else: guest already has a "-netdev" (e.g. the Ubuntu snapshot); Module.websocket.url alone
      // routes its existing socket to our netstack — adding another NIC would duplicate it.
      try { console.log("[net] ON via " + opts.netWs); } catch (e) {}
    }

    host.innerHTML = "";
    const termEl = document.createElement("div");
    termEl.style.cssText = "width:100%;height:100%;background:#0b0f1a";
    host.appendChild(termEl);

    const xterm = new Terminal({
      fontSize: 13, theme: { background: "#0b0f1a" },
      scrollback: 10000,          // was default 1000 — keep real history to scroll back through
      scrollSensitivity: 3,       // wheel/trackpad
      fastScrollModifier: "shift",
    });
    xterm.open(termEl);
    const { master, slave } = openpty();
    xterm.loadAddon(master);
    // Guest -> app requests over the console: `printf '\033]7777;open;<url or words>\007' > /dev/console`
    // (desktop v14 bbweb launcher). Only "open" exists; the text goes to opts.onGuestOpenUrl.
    try {
      xterm.parser.registerOscHandler(7777, (data) => {
        const i = data.indexOf(";"), cmd = i < 0 ? data : data.slice(0, i), arg = i < 0 ? "" : data.slice(i + 1);
        if (cmd === "open" && opts.onGuestOpenUrl) { try { opts.onGuestOpenUrl(arg.slice(0, 4096)); } catch (e) {} }
        return true;
      });
    } catch (e) {}

    // --- Touch-drag scrolling of the scrollback (iPad has no scroll wheel). xterm's own touch
    // handling is unreliable here, so drive it directly: a vertical finger drag scrolls by whole
    // rows; a short tap (< ~8 px) is NOT a scroll and falls through to focus/keyboard. Also handles
    // trackpad/wheel via the native 'wheel' event → scrollLines. When a full-screen (alt-buffer) TUI
    // like mc/ncdu/vi is up, the app owns the screen (no scrollback), so we don't hijack the drag —
    // arrow keys navigate instead.
    (function wireScroll() {
      function altBuffer() { try { return xterm.buffer && xterm.buffer.active && xterm.buffer.active.type === "alternate"; } catch (e) { return false; } }
      function cellH() {
        try { var ds = xterm._core && xterm._core._renderService && xterm._core._renderService.dimensions;
          return (ds && (ds.actualCellHeight || (ds.css && ds.css.cell && ds.css.cell.height))) || 17; } catch (e) { return 17; }
      }
      var sy = 0, acc = 0, dragging = false;
      termEl.addEventListener("touchstart", function (e) {
        if (e.touches.length !== 1 || altBuffer()) { dragging = false; return; }
        sy = e.touches[0].clientY; acc = 0; dragging = true;
      }, { passive: true });
      termEl.addEventListener("touchmove", function (e) {
        if (!dragging || e.touches.length !== 1) return;
        var y = e.touches[0].clientY, dy = y - sy; sy = y; acc += dy;
        var h = cellH(), rows = (acc / h) | 0;
        if (rows) { acc -= rows * h; try { xterm.scrollLines(-rows); } catch (er) {} if (e.cancelable) e.preventDefault(); }
      }, { passive: false });
      termEl.addEventListener("wheel", function (e) {
        if (altBuffer()) return;
        var rows = Math.round(e.deltaY / cellH()) || (e.deltaY > 0 ? 1 : -1);
        try { xterm.scrollLines(rows); } catch (er) {}
        if (e.cancelable) e.preventDefault();
      }, { passive: false });
    })();

    // --- Native trackpad / mouse scroll bridge. The WebView's scrollView is disabled (so touch reaches
    // the emulator), which means the Magic Keyboard trackpad's indirect two-finger scroll never becomes a
    // DOM 'wheel' event — the terminal couldn't scroll with a trackpad. HostView adds a UIPanGestureRecognizer
    // (indirect scroll only) that calls this with a pixel delta; we scroll the scrollback here. Skip
    // full-screen (alt-buffer) TUIs — they own the screen and use arrow keys, not scrollback.
    try { self.__q64xterm = xterm; } catch (e) {}   // debugging handle (serial console)
    bootP.xt = xterm;
    self.__trackpadScroll = function (dyPx) {
      try {
        if (xterm.buffer && xterm.buffer.active && xterm.buffer.active.type === "alternate") return;
        var ds = xterm._core && xterm._core._renderService && xterm._core._renderService.dimensions;
        var ch = (ds && (ds.actualCellHeight || (ds.css && ds.css.cell && ds.css.cell.height))) || 17;
        var rows = Math.round(dyPx / ch) || (dyPx > 0 ? 1 : -1);
        xterm.scrollLines(rows);
      } catch (e) {}
    };

    // --- Fit the terminal to its container. Without this xterm is a fixed 80x24 grid that only
    // fills the top-left of the pane; the rest is dead space where taps/drag do nothing (the exact
    // "can only type in the top-left, can't drag" report). We size the grid to the actual pane and
    // xterm-pty propagates the new winsize to the guest pty (SIGWINCH → the shell reflows). No
    // FitAddon is bundled, so measure the rendered cell size directly (works across xterm versions).
    function fitTerm() {
      try {
        const core = xterm._core, ds = core && core._renderService && core._renderService.dimensions;
        const cellW = ds && (ds.actualCellWidth || (ds.css && ds.css.cell && ds.css.cell.width));
        const cellH = ds && (ds.actualCellHeight || (ds.css && ds.css.cell && ds.css.cell.height));
        if (!cellW || !cellH) return;                       // renderer not ready this tick
        const st = getComputedStyle(termEl);
        const w = termEl.clientWidth - (parseInt(st.paddingLeft) || 0) - (parseInt(st.paddingRight) || 0) - 2;
        const h = termEl.clientHeight - (parseInt(st.paddingTop) || 0) - (parseInt(st.paddingBottom) || 0);
        const cols = Math.max(20, Math.floor(w / cellW)), rows = Math.max(6, Math.floor(h / cellH));
        if (cols !== xterm.cols || rows !== xterm.rows) xterm.resize(cols, rows);
      } catch (e) {}
    }
    // Fit now and as layout settles (fonts/render service load async), then on any pane/window resize.
    [0, 250, 900].forEach((t) => setTimeout(fitTerm, t));
    try { new ResizeObserver(fitTerm).observe(termEl); } catch (e) {}
    window.addEventListener("resize", fitTerm);
    // Tap anywhere in the pane → focus the terminal, so the hardware keyboard / trackpad works across
    // the WHOLE pane, not only where the current cursor happens to sit.
    termEl.addEventListener("pointerdown", () => { try { xterm.focus(); } catch (e) {} });

    const Module = self.Module;
    Module.pty = slave;
    Module.mainScriptUrlOrBlob = new URL(engineModuleBase + "out.js", location.href).href;
    // Diagnostics so a hang/crash is VISIBLE: Emscripten data-load status, QEMU stderr, and abort.
    const toTerm = (t) => { try { xterm.write(String(t).replace(/\n/g, "\r\n") + "\r\n"); } catch (e) {} try { console.log("[qemu]", t); } catch (e2) {} };
    earlyBootStages.forEach((stage) => toTerm("[android] " + stage));
    Module.setStatus = (s) => { if (s) say("64-bit: " + s); };
    Module.printErr = (t) => { toTerm(t); if (t) say("64-bit: " + String(t).slice(-140)); };
    Module.print = (t) => { toTerm(t); };
    Module.onAbort = (w) => { say("64-bit ABORTED: " + w); opts.onError && opts.onError(new Error("QEMU aborted: " + w)); };
    // ALWAYS buffer the wasm with a plain fetch → arrayBuffer → WebAssembly.instantiate.
    // Emscripten's default WebAssembly.instantiateStreaming HANGS over Bootbox's LocalServer:
    // it stream-compiles as bytes arrive, but the LocalServer delivers the body in 256KB
    // NWConnection chunks then conn.cancel()s the socket abruptly, which WebKit's streaming
    // compiler never completes. REPRODUCED on the Mac — Safari boots over a normal server but
    // hangs forever at "runtime initialized" against the LocalServer clone; this override boots
    // it. A fully buffered fetch sidesteps streaming and returns {instance, module} so the
    // QEMU pthread workers still get the compiled module. (Custom miniapp:// schemes need it too.)
    Module.instantiateWasm = (imports, receive) => {
      const wurl = absEngineModuleBase + (opts.wasm || "qemu-system-x86_64.wasm");   // per-guest engine (aarch64 differs)
      say("64-bit: fetching engine binary…");
      fetch(wurl)
        .then((r) => { if (!r.ok) throw new Error("wasm HTTP " + r.status); say("64-bit: compiling engine (first load is slow)…"); return r.arrayBuffer(); })
        .then((buf) => WebAssembly.instantiate(buf, imports))
        .then((res) => { bootP.engine = Date.now(); say("64-bit: engine ready — starting CPU…"); receive(res.instance, res.module); })
        .catch((e) => { say("64-bit WASM FAILED: " + ((e && e.message) || e)); opts.onError && opts.onError(e instanceof Error ? e : new Error(String(e))); });
      return {};   // signals async instantiation to Emscripten
    };
    Module.preRun = Module.preRun || [];
    Module.preRun.push((mod) => {
      try { mod.FS.mkdir("/pack"); } catch (e) {}
      try { mod.FS.mkdir("/share"); } catch (e) {}   // host<->guest file share: Module.FS "/share" == guest "/share"
      // The guest's outer init (cmd/init/main.go) reads /pack/info: "n:<mac>" enables networking
      // (eth0 up + udhcpc with that MAC, before the cap-dropped container); "m:<path>" bind-mounts
      // /mnt/wasi0/<path> (== Module.FS /<path> via the wasi0 9p) INTO the container. So "m:share"
      // gives the guest a /share folder the host reads/writes through Module.FS — for Save/Share.
      let info = "t:" + Math.round(Date.now() / 1000) + "\nm:share\n";
      if (opts.netWs) info += "n:02:00:00:00:00:01\n";
      mod.FS.writeFile("/pack/info", info);
      // Native web (desktop v14): the guest's `bbweb` launcher opens pages in the app's native browser
      // (the iPad's own WebKit, ~300x faster than WebKit on the emulated CPU) when this flag exists.
      if (opts.nativeWeb) {
        try { mod.FS.mkdir("/share/.bootbox"); } catch (e) {}
        try { mod.FS.writeFile("/share/.bootbox/native-web", "1\n"); } catch (e) {}
      }
      // wasm-TCG JIT tunables, read once by the engine (build 84+; older engines ignore the file):
      // jit = interpreted runs before a block is compiled to wasm, max = live compiled-block cap,
      // chain = blocks tail-call their compiled successor instead of returning to the dispatcher
      // (needs wasm tail calls: Chrome 112+, Safari 18.2+ - feature-detected, never assumed),
      // fpinline = SSE float ops as native wasm float/SIMD ops (on by default in the engine),
      // regloc = TCG registers as wasm locals instead of globals (build 86+ engine; on by default).
      const t = opts.tune || {};
      let tune = (t.jit ? "jit=" + (t.jit | 0) + "\n" : "") + (t.max ? "max=" + (t.max | 0) + "\n" : "");
      // chain=2 = the same chaining through ordinary nested calls (no tail calls needed; build 93 engine)
      if (t.chain === 2) tune += "chain=2\n" + (t.chainmax ? "chainmax=" + (t.chainmax | 0) + "\n" : "");
      else if (t.chain !== 0 && wasmTailCalls()) tune += "chain=1\n";
      if (t.fpinline === 0) tune += "fpinline=0\n";
      if (t.regloc === 0) tune += "regloc=0\n";
      // tsc=1: lock-free guest RDTSC; hotshare=1: a TB compiled on one vCPU compiles sooner on the
      // others (build 100 engine; older engines ignore both). Multi-threaded Linux guests only.
      if (t.tsc) tune += "tsc=1\n";
      if (t.hotshare) tune += "hotshare=1\n";
      // fasttci=1 (build 104 engine): the hot-loop interpreter (no Asyncify, small enough for WebKit's
      // optimizing tier); device accesses that may switch coroutines re-run in the classic interpreter.
      if (t.fasttci) tune += "fasttci=1\n";
      // lazywasm=1 (build 107 engine): a block's wasm module is built when the block turns hot (a
      // re-translation) instead of stored with every block - 75% of the translation cache was modules
      // for blocks that never ran hot, and the full cache flushed every few seconds under Wine.
      if (t.lazywasm) tune += "lazywasm=1\n";
      // split=0 (build 109 engine): turn off the sticky TB split at mid-block device I/O (safety ladder).
      if (t.split === 0) tune += "split=0\n";
      // hammock=1 (1.1 engine): a conditional jump forward over a few bytes no longer ends the block -
      // the skipped code is translated inline, so loops with small ifs run as one compiled block.
      if (t.hammock) tune += "hammock=1\n";
      // repbulk=0 / simdinline=0 (1.1 engine, both on by default): REP MOVS/STOS one iteration per block
      // again / SSE integer ops and packed conversions as helper calls instead of wasm SIMD (safety ladder).
      if (t.repbulk === 0) tune += "repbulk=0\n";
      if (t.simdinline === 0) tune += "simdinline=0\n";
      if (t.extra) tune += String(t.extra).replace(/[^a-z0-9=\n]/g, "") + "\n";   // harness experiments: raw key=value lines
      if (tune) mod.FS.writeFile("/bootbox-tune", tune);
    });
    let cbs = [];
    Module.pty.onReadable(() => { cbs.forEach((cb) => cb()); cbs = []; });
    Module.preRun.push((Module) => {
      Module.TTY.stream_ops.poll = (stream, timeout, notify) => {
        if (Module.pty.readable) return 1;
        if (notify != null) { notify.registerCleanupFunc(() => { const i = cbs.indexOf(notify); if (i != -1) cbs.splice(i, 1); }); cbs.push(notify); }
        return 0;
      };
    });
    Module.onRuntimeInitialized = () => { toTerm("[boot] runtime initialized — starting QEMU…"); };
    // Pre-warm the noVNC viewer NOW, while memory is still free. Importing its ~50 ES modules AFTER
    // the multi-hundred-MB rootfs is resident can fail ("Failed to fetch dynamically imported module")
    // on a memory-tight device, which used to stick the GUI at "Connecting…". Best-effort; connectGui
    // falls back to a fresh import + retry if this didn't finish or failed.
    let __RFB = null;
    const __rfbWarm = import(new URL("vendor/novnc/core/rfb.js", location.href).href)
      .then((m) => { __RFB = m.default; return m.default; }).catch(() => null);
    toTerm("[boot] serving=" + location.protocol + " isolated=" + self.crossOriginIsolated + " ram=" + (opts.ram || "?") + "M");
    say("64-bit: loading engine module…");
    const engineJs = new URL(engineModuleBase + "out.js", location.href).href;
    // Allocate the engine's shared wasm memory HERE, retrying for a while, and hand it to the engine
    // (emscripten uses a pre-made Module.wasmMemory). Switching 64-bit guests reloads the page, and
    // right after that reload WebKit has not yet released the previous guest's memory, so the engine's
    // own allocation failed with "Out of memory" (seen in the iOS app going Linux Terminal -> Desktop).
    // The sizes come from the engine's own initMemory so they always match its memory import.
    if (!Module.wasmMemory) {
      try {
        const src = await (await fetch(engineJs)).text();
        const ini = +(Module.INITIAL_MEMORY || ((src.match(/INITIAL_MEMORY"\]\|\|(\d+)/) || [])[1]) || 0);
        const mx = src.match(/maximum:(\d+|INITIAL_MEMORY\/65536),shared:true/);
        if (ini && mx) {
          const base = ini / 65536, maxPages = /^INITIAL/.test(mx[1]) ? base : +mx[1];
          // opts.initialMemoryMB: start the memory that big, so it never has to grow while the guest
          // boots (untouched pages cost nothing). Falls back to the engine's own size if refused.
          let pages = Math.min(maxPages, Math.max(base, Math.ceil((+opts.initialMemoryMB || 0) * 16)));
          for (let i = 0; ; i++) {
            try { Module.wasmMemory = new WebAssembly.Memory({ initial: pages, maximum: maxPages, shared: true }); break; }
            catch (e) {
              if (pages > base) { console.warn("[boot] " + (pages >> 4) + " MB up front refused; growing from " + (base >> 4) + " MB"); pages = base; continue; }
              if (i >= 40) throw e;                      // ~20 s: give up, the engine reports the error itself
              if (i === 0) say("64-bit: waiting for the previous guest's memory to be released…");
              // The old page's memory is garbage, but WebKit frees it only after a full GC, which it
              // won't run on its own soon enough. A large short-lived allocation reports memory pressure
              // to the GC (the same nudge the engine uses for evicted code).
              try { new Uint8Array(256 << 20)[0] = 1; } catch (e2) {}
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        }
      } catch (e) { try { console.warn("[boot] memory pre-allocation:", e); } catch (e2) {} }
    }
    const init = (await import(engineJs)).default;
    // Heartbeat — so it VISIBLY does stuff while QEMU sets up and the kernel cold-boots (no output yet).
    let hbN = 0;
    const hb = setInterval(() => { hbN++; say("64-bit: working… " + hbN + "s — booting kernel (watch the terminal below)"); }, 1000);
    try { await init(Module); } finally { clearInterval(hb); }
    toTerm("[boot] QEMU main started.");
    if (!bootP.engine) bootP.engine = Date.now();
    // File-share API over Module.FS "/share" (bind-mounted into the guest as /share). Lets the app
    // move files host<->guest for the 64-bit Save/Share buttons. read() may return null until the
    // guest writes; write() drops a file the guest sees immediately at /share/<name>.
    const shareFs = {
      list: () => { try { return self.Module.FS.readdir("/share").filter((n) => n !== "." && n !== ".." && n !== ".bootbox"); } catch (e) { return []; } },
      read: (name) => { try { return self.Module.FS.readFile("/share/" + name); } catch (e) { return null; } },
      write: (name, bytes) => { try { self.Module.FS.writeFile("/share/" + name, bytes); return true; } catch (e) { return false; } },
    };
    // noVNC GUI: lazily connect to the guest's desktop when the user first opens the GUI tab. The
    // guest runs Xvfb + x11vnc (listening on its eth0:5900); the in-app netstack's /vnc endpoint
    // vn.Dial's it and bridges RFB over this WebSocket. opts.vnc = "ws://127.0.0.1:8889/vnc".
    // Idempotent (no-op if already connected) and reconnects after a disconnect (the panel re-calls
    // this on each GUI-tab open). The LEFT terminal + internet are untouched.
    let rfb = null, guiRetries = 0, lastGuiHost = null, lastStatusCb = null;
    // Introspection + recovery for the "display alive but input dead" failure (seen on-device
    // after a heavy wine load: minesweeper's clock kept ticking while taps went nowhere). The 🔄
    // button on the GUI pane calls __guiReconnect for a fresh RFB session; __guiState feeds the
    // tap logger so the app console shows the connection state on every GUI tap.
    function guiState() {
      try {
        if (!rfb) return "no-rfb";
        const ws = rfb._sock && rfb._sock._websocket;
        return (rfb._rfbConnectionState || "?") + "/ws=" + (ws ? ws.readyState : "?");
      } catch (e) { return "state-err"; }
    }
    function forceReconnectGui(keepCount) {   // keepCount: a watchdog retry, not a user tap
      try { if (rfb) rfb.disconnect(); } catch (e) {}
      rfb = null; if (!keepCount) guiRetries = 0;
      if (lastGuiHost) return connectGui(lastGuiHost, lastStatusCb);
      return null;
    }
    try { self.__guiReconnect = forceReconnectGui; self.__guiState = guiState; } catch (e) {}
    // Watchdogs (12s tick):
    // 1. Silent socket death: the websocket is CLOSING/CLOSED while noVNC still says
    //    "connected" — frames stop or input goes nowhere. Force a fresh session.
    // 2. STUCK CONNECTING (the build-67 black-GUI bug): the intent pre-connect can fire
    //    before Xvnc is up — the /vnc websocket ACCEPTS but the guest-side dial to :5900
    //    hangs, so noVNC sits in "connecting" forever with no disconnect event, and since
    //    connectGui is idempotent every later tap returns the same stuck object → the pane
    //    stays black for good. Tear down any RFB that isn't connected within 20s and retry
    //    fresh — by then Xvnc is usually up.
    let rfbBornAt = 0;
    setInterval(function () {
      try {
        if (!rfb) return;
        const st = rfb._rfbConnectionState;
        const ws = rfb._sock && rfb._sock._websocket;
        if (st === "connected") {
          if (ws && ws.readyState >= 2) {
            console.log("[gui] watchdog: socket dead under a connected RFB — reconnecting");
            forceReconnectGui();
          }
        } else if (rfbBornAt && Date.now() - rfbBornAt > 20000) {
          console.log("[gui] watchdog: stuck in '" + st + "' for >20s — reconnecting fresh");
          forceReconnectGui(true);
        }
      } catch (e) {}
    }, 12000);
    // Pinch-zoom-proof coordinates (build 74): if the user pinch-zooms the page, canvas
    // getBoundingClientRect and pointer coords skew — recompute the noVNC scale whenever the
    // visual viewport changes so taps keep landing exactly under the iPad pointer.
    try {
      if (self.visualViewport) self.visualViewport.addEventListener("resize", function () {
        try { if (rfb && rfb._rfbConnectionState === "connected") { rfb.scaleViewport = false; rfb.scaleViewport = true; } } catch (e) {}
      });
    } catch (e) {}
    // Until the display is up, keep the "Connecting…" line alive with what the guest is doing —
    // RAM-snapshot progress (Android resumes a 1.3 GB saved state) or guest-disk data read so far,
    // plus elapsed time — so a slow first boot on an iPad doesn't look like a dead black screen.
    const guiT0 = Date.now();
    let guiMsg = null, guiMsgCb = null, guiMsgTimer = 0;
    function guiNote() {
      let t = "";
      try {
        const p = self.BootboxLazyPack && self.BootboxLazyPack.progress();
        if (p && p.snapshot && p.snapshot.read < p.snapshot.size) t = " Loading the saved state: " + Math.floor(100 * p.snapshot.read / p.snapshot.size) + "%.";
        else if (p && p.fetched) t = " Guest data loaded so far: " + Math.round(p.fetched / 1048576) + " MB.";
      } catch (e) {}
      // the crash fallback runs this boot on a slower engine level: say so where it is seen
      if (opts.safeNote) t += " Slower engine after an earlier crash (" + opts.safeNote + ") — UEFI Setup › Advanced resets it.";
      return t + " (" + Math.round((Date.now() - guiT0) / 1000) + " s)";
    }
    function guiStatus(cb, msg, live) {   // live: refresh msg + progress every second until replaced
      guiMsgCb = cb; guiMsg = live ? msg : null;
      bootP.handed = true;   // the start-up card is drawn from here on (bootInfo), not by its own timer
      if (!live && guiMsgTimer) { clearInterval(guiMsgTimer); guiMsgTimer = 0; }
      cb(msg === null ? null : live ? msg + guiNote() : msg, live ? bootInfo() : null);
      if (live && !guiMsgTimer) {
        let n = 0;
        guiMsgTimer = setInterval(function () {
          if (guiMsg === null || !guiMsgCb) return;
          const line = guiMsg + guiNote();
          guiMsgCb(line, bootInfo());
          // Leave a trail in the app log (every 2 s for the first minute, then every 10 s): if iPadOS
          // ends the page during boot, the log shows how far it got and how big the engine was.
          n++;
          if (n <= 60 ? n % 2 === 0 : n % 10 === 0) {
            let wasm = "?";
            try { wasm = Math.round(self.Module.wasmMemory.buffer.byteLength / 1048576) + " MB"; } catch (e) {}
            console.log("[gui] " + line + " engine memory " + wasm);
          }
        }, 1000);
      }
    }
    // --- Touch input for TOUCHSCREEN guests (Android). noVNC's gesture layer turns touches into
    // mouse gestures: nothing moves until a finger travels 50 px, a hold becomes a right-click and
    // a two-finger drag becomes wheel clicks - and Android's touchscreen ignores right-clicks and
    // wheel. So here every touch on the screen goes straight to the guest as one finger (down /
    // move / up where it really is): taps, long presses, drags, flings and edge swipes then behave
    // as on a phone. Extra fingers are ignored (the guest touchscreen is single-touch).
    function fbPoint(r, cx, cy) {
      const cv = r._canvas, b = cv.getBoundingClientRect();
      const w = r._fbWidth || cv.width, h = r._fbHeight || cv.height;
      return {
        x: Math.max(0, Math.min(w - 1, Math.round((cx - b.left) * w / (b.width || 1)))),
        y: Math.max(0, Math.min(h - 1, Math.round((cy - b.top) * h / (b.height || 1)))),
      };
    }
    // The Android guest's uinput touchscreen (ubuntu-build/android-vnc) declares ABS_MT_SLOT with the
    // range 0..0, so Android reads it as a protocol-A device and forgets the finger's position after
    // every frame - while the guest kernel, which still does slot bookkeeping, drops any coordinate
    // equal to the previous one. A vertical drag therefore reached Android at x=0 and a second tap
    // on the same spot landed at (0,0). Until the guest image is rebuilt with a real slot range,
    // never send a pressed coordinate equal to the last pressed one: nudge it by 1 px (invisible),
    // so every frame carries both X and Y. Wraps the shared pointerEvent once; only sockets marked
    // __bbTouch (Android viewers) are touched, and it covers noVNC's own mouse path too.
    function installPointerDither(R) {
      if (!R || !R.messages || R.messages.__bbDither) return;
      const orig = R.messages.pointerEvent;
      R.messages.pointerEvent = function (sock, x, y, mask) {
        const st = sock && sock.__bbTouch;
        if (st && (mask & 1)) {
          const w = (st.r && st.r._fbWidth) || 65536, h = (st.r && st.r._fbHeight) || 65536;
          if (x === st.x) x = x + 1 < w ? x + 1 : x - 1;
          if (y === st.y) y = y + 1 < h ? y + 1 : y - 1;
          st.x = x; st.y = y;
        }
        return orig.call(this, sock, x, y, mask);
      };
      R.messages.__bbDither = true;
    }
    // Linux desktop: the panel's Apps button runs tint2 -> sh -> xdotool -> openbox, ~1.2 s on the
    // emulated CPU; openbox opens the same menu in ~0.25 s straight from its W-space keybinding (rc.xml).
    // So a left press on the button becomes that key (its release is swallowed), and a second press
    // while the menu is (probably) still open closes it with Escape. Any other press or key clears that.
    function installAppsKey(R) {
      if (!R || !R.messages || R.messages.__bbApps) return;
      const ptr = R.messages.pointerEvent, key = R.messages.keyEvent, qkey = R.messages.QEMUExtendedKeyEvent;
      const onButton = (st, x, y) => st.r._fbWidth === 1024 && st.r._fbHeight === 768 && x < 104 && y >= 724;
      const keys = (st, seq) => {
        st.sending = true;
        try { for (const [ks, down] of seq) st.r.sendKey(ks, null, down); } catch (e) {}
        st.sending = false;
      };
      R.messages.pointerEvent = function (sock, x, y, mask) {
        const st = sock && sock.__bbApps;
        if (!st) return ptr.call(this, sock, x, y, mask);
        const pressed = (mask & 1) && !(st.mask & 1);
        st.mask = mask;
        if (pressed && onButton(st, x, y)) {
          st.swallow = true;
          ptr.call(this, sock, x, y, mask & ~1);   // pointer onto the button: openbox opens the menu there
          if (st.open) { st.open = false; keys(st, [[0xff1b, true], [0xff1b, false]]); }
          else { st.open = true; keys(st, [[0xffeb, true], [0x20, true], [0x20, false], [0xffeb, false]]); }
          return;
        }
        if (st.swallow) {
          if (mask & 1) return ptr.call(this, sock, x, y, mask & ~1);
          st.swallow = false;
        } else if (pressed || (mask & 6)) st.open = false;   // any other click picks an item / closes the menu
        return ptr.call(this, sock, x, y, mask);
      };
      const clear = (sock, down) => { const st = sock && sock.__bbApps; if (st && down && !st.sending) st.open = false; };
      if (key) R.messages.keyEvent = function (sock, keysym, down) { clear(sock, down); return key.apply(this, arguments); };
      if (qkey) R.messages.QEMUExtendedKeyEvent = function (sock, keysym, down) { clear(sock, down); return qkey.apply(this, arguments); };
      R.messages.__bbApps = true;
    }
    function sendPointer(r, p, mask) {
      try { if (r && r._rfbConnectionState === "connected") r.constructor.messages.pointerEvent(r._sock, p.x, p.y, mask); } catch (e) {}
    }
    function makeFinger(r) {   // one guest finger; moves are coalesced to ~40 Hz (each one costs guest CPU)
      let pos = null, sent = null, timer = 0;
      const flush = () => {
        timer = 0;
        if (pos && (!sent || sent.x !== pos.x || sent.y !== pos.y)) { sendPointer(r, pos, 1); sent = pos; }
      };
      return {
        get down() { return !!pos; },
        get pos() { return pos; },
        press(p) { pos = sent = p; sendPointer(r, p, 1); },
        move(p) { if (!pos) return; pos = p; if (!timer) timer = setTimeout(flush, 25); },
        release(p) {
          if (!pos) return;
          if (p) pos = p;
          clearTimeout(timer); flush();
          sendPointer(r, pos, 0); pos = sent = null;
        },
      };
    }
    function installDirectTouch(r) {
      const cv = r._canvas;
      if (!cv || cv.__bbTouch) return;
      cv.__bbTouch = true;
      const finger = makeFinger(r);
      r.__bbFinger = finger;
      let id = null;
      const own = (e) => { e.preventDefault(); e.stopPropagation(); };
      const opt = { capture: true, passive: false };
      const find = (e) => {
        for (let i = 0; i < e.changedTouches.length; i++) if (e.changedTouches[i].identifier === id) return e.changedTouches[i];
        return null;
      };
      const host = r._screen || r._target;   // per-viewer element (a reconnect makes a new one)
      // Capture phase on the canvas's container runs before noVNC's own listeners on the canvas;
      // stopping the event there keeps noVNC's gesture handler (and its fake cursor) out of it.
      host.addEventListener("touchstart", function (e) {
        if (e.target !== cv) return;
        own(e);
        try { r.focus({ preventScroll: true }); } catch (x) {}   // hardware keyboard -> guest
        if (id !== null || finger.down) return;
        const t = e.changedTouches[0];
        id = t.identifier;
        finger.press(fbPoint(r, t.clientX, t.clientY));
      }, opt);
      host.addEventListener("touchmove", function (e) {
        if (e.target !== cv) return;
        own(e);
        const t = find(e);
        if (t) finger.move(fbPoint(r, t.clientX, t.clientY));
      }, opt);
      const end = function (e) {
        if (e.target !== cv) return;
        own(e);
        const t = find(e);
        if (!t) return;
        id = null;
        finger.release(fbPoint(r, t.clientX, t.clientY));
      };
      host.addEventListener("touchend", end, opt);
      host.addEventListener("touchcancel", end, opt);
      // Magic Keyboard trackpad / mouse: handled here too (pointer events), not by noVNC, so both
      // input paths drive the same guest finger: click = tap, click-drag = swipe, secondary click
      // = Back (Escape -> KEY_ESC, as scrcpy does). Hovering sends nothing - a touchscreen has no
      // hover, and every empty pointer event costs the guest CPU. noVNC's own mouse handlers are
      // kept out of it so nothing is sent twice.
      let mouseId = null;
      host.addEventListener("pointerdown", function (e) {
        if (e.pointerType !== "mouse" || e.target !== cv) return;
        own(e);
        try { r.focus({ preventScroll: true }); } catch (x) {}
        if (e.button === 2) {
          try { r.sendKey(0xff1b, "Escape", true); r.sendKey(0xff1b, "Escape", false); } catch (x) {}
          return;
        }
        if (e.button !== 0 || mouseId !== null || finger.down) return;
        mouseId = e.pointerId;
        try { cv.setPointerCapture(e.pointerId); } catch (x) {}
        finger.press(fbPoint(r, e.clientX, e.clientY));
      }, true);
      host.addEventListener("pointermove", function (e) {
        if (e.pointerType !== "mouse") return;
        if (e.pointerId === mouseId) { own(e); finger.move(fbPoint(r, e.clientX, e.clientY)); }
      }, true);
      const mouseEnd = function (e) {
        if (e.pointerType !== "mouse" || e.pointerId !== mouseId) return;
        own(e);
        mouseId = null;
        finger.release(e.type === "pointercancel" ? null : fbPoint(r, e.clientX, e.clientY));
      };
      host.addEventListener("pointerup", mouseEnd, true);
      host.addEventListener("pointercancel", mouseEnd, true);
      for (const type of ["mousedown", "mouseup", "mousemove", "click", "dblclick", "contextmenu"]) {
        host.addEventListener(type, function (e) {
          if (e.target !== cv) return;
          e.stopPropagation();
          if (type === "contextmenu") e.preventDefault();
        }, true);
      }
      // Desktop mouse wheel (Mac browsers) -> the same finger-drag scroll the iPad trackpad gets.
      let wheelEnd = 0;
      host.addEventListener("wheel", function (e) {
        if (e.target !== cv) return;
        own(e);
        const k = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1;
        if (!pan) self.__bbPan(0, e.clientX, e.clientY, 0, 0, "dom");
        self.__bbPan(1, e.clientX, e.clientY, -e.deltaX * k, -e.deltaY * k, "dom");
        clearTimeout(wheelEnd);
        wheelEnd = setTimeout(function () { self.__bbPan(2, 0, 0, 0, 0, "dom"); }, 150);
      }, opt);
    }
    // Trackpad / mouse-wheel scrolling over the GUI. HostView's indirect-scroll recognizer calls
    // __bbPan(phase 0 begin / 1 change / 2 end, pointer x/y, dx/dy in CSS px, natural direction);
    // it returns true when the scroll belongs to the GUI (else it goes to the terminal scrollback).
    // Android: a finger drag that starts under the pointer and follows the fingers (so a quick
    // swipe flings, exactly like touch). Linux desktop: wheel clicks, one per ~40 px.
    let pan = null;
    // Two ways a trackpad/mouse scroll can reach us, and which one fires depends on the iPadOS/WebKit
    // version: (1) DOM wheel events (noVNC handles them itself for X desktops; installDirectTouch turns
    // them into a finger drag for Android) and (2) HostView's native indirect-scroll recognizer calling
    // __bbPan. Whichever path is live wins: native calls are ignored while DOM wheel events are flowing,
    // so a scroll is never applied twice.
    let lastDomWheel = 0, lastHover = null, wheelLogT = 0;
    addEventListener("wheel", function (e) {
      lastDomWheel = Date.now();
      if (lastDomWheel - wheelLogT > 5000) { wheelLogT = lastDomWheel; console.log("[scroll] DOM wheel dy=" + e.deltaY + " mode=" + e.deltaMode); }
    }, { capture: true, passive: true });
    addEventListener("pointermove", function (e) {   // the trackpad pointer's position (it hovers)
      if (e.pointerType === "mouse") lastHover = { x: e.clientX, y: e.clientY };
    }, { capture: true, passive: true });
    const WHEEL_STEP = 24;   // CSS px of scroll per X wheel click
    self.__bbPan = function (phase, x, y, dx, dy, src) {
      try {
        const r = rfb;
        const native = src !== "dom";
        if (native && Date.now() - lastDomWheel < 500) {   // the DOM path is handling it
          if (pan && pan.native) { if (pan.touch && pan.r.__bbFinger) pan.r.__bbFinger.release(null); pan = null; }
          return true;
        }
        if (phase === 0) {
          if (pan && pan.touch && pan.r.__bbFinger) pan.r.__bbFinger.release(null);   // never leave a finger down
          pan = null;
          if (!r || r._rfbConnectionState !== "connected" || !r._canvas) return false;
          const b = r._canvas.getBoundingClientRect();
          const inside = (X, Y) => X >= b.left && X < b.right && Y >= b.top && Y < b.bottom;
          // The recognizer's location can miss (e.g. reported before the pointer moved); fall back to
          // where the pointer last hovered. A hidden GUI pane has an empty rect, so it never matches.
          if (!inside(x, y) && lastHover && inside(lastHover.x, lastHover.y)) { x = lastHover.x; y = lastHover.y; }
          if (!inside(x, y)) { if (native) console.log("[scroll] not over the screen (" + Math.round(x) + "," + Math.round(y) + ")"); return false; }
          pan = { r, x, y, acc: 0, clicks: 0, native, touch: !!(opts.touchGuest && r.__bbFinger) };
          if (pan.touch) {
            if (r.__bbFinger && r.__bbFinger.down) { pan = null; return true; }   // a real finger is down
            r.__bbFinger.press(fbPoint(r, x, y));
          }
          return true;
        }
        if (!pan) return false;
        if (pan.r !== r) { pan = null; return false; }
        const wheel = (dir) => {   // dir > 0: fingers moved down = scroll up (X button 4)
          const p = fbPoint(r, pan.x, pan.y), held = r._mouseButtonMask || 0, bit = dir > 0 ? 8 : 16;
          sendPointer(r, p, held | bit); sendPointer(r, p, held); pan.clicks++;
        };
        if (phase === 1) {
          if (pan.touch) {
            pan.x += dx; pan.y += dy;
            r.__bbFinger.move(fbPoint(r, pan.x, pan.y));
          } else {
            pan.acc += dy;
            while (Math.abs(pan.acc) >= WHEEL_STEP) { wheel(pan.acc); pan.acc -= pan.acc > 0 ? WHEEL_STEP : -WHEEL_STEP; }
          }
          return true;
        }
        if (pan.touch) r.__bbFinger.release(null);
        else if (!pan.clicks && Math.abs(pan.acc) >= 2) wheel(pan.acc);   // a single mouse-wheel notch still scrolls
        pan = null;
        return true;
      } catch (e) { pan = null; return false; }
    };
    let lastPointerType = "touch";
    function cursorSwitch(e) {
      if (e && e.pointerType) lastPointerType = e.pointerType;
      try {
        const c = rfb && rfb._cursor && rfb._cursor._canvas;
        if (c) c.style.display = (opts.touchGuest || lastPointerType === "mouse") ? "none" : "";
      } catch (x) {}
    }
    async function connectGui(guiHost, statusCb) {
      statusCb = statusCb || function () {};
      lastGuiHost = guiHost; lastStatusCb = statusCb;
      if (rfb) return rfb;
      if (!opts.vnc) { guiStatus(statusCb, "No VNC endpoint configured for this guest."); return null; }
      guiStatus(statusCb, "Connecting to " + (opts.vncLabel || "the Linux desktop") + "…", true);
      let RFB = __RFB || (await __rfbWarm);   // use the pre-warmed viewer (loaded while memory was free)
      if (!RFB) {
        // Pre-warm didn't land — try a fresh import; if that fails too, retry on a timer (don't stick).
        try { RFB = __RFB = (await import(new URL("vendor/novnc/core/rfb.js?r=" + guiRetries, location.href).href)).default; }
        catch (e) {
          if (guiRetries++ < 45) { guiStatus(statusCb, "Loading the desktop viewer…", true); setTimeout(() => connectGui(guiHost, statusCb), 4000); }
          else { guiStatus(statusCb, "noVNC failed to load: " + ((e && e.message) || e)); }
          return null;
        }
      }
      try {
        rfb = new RFB(guiHost, opts.vnc, { shared: true });
        // ReDroid's LibVNCServer handles Tight/ZRLE correctly and benefits
        // enormously from compressed frames. The Linux Xvnc guest still uses
        // Bootbox's conservative Hextile-only compatibility list.
        rfb._bootboxCompressed = !!opts.compressedVnc;
        rfb._bootboxCursor = !opts.touchGuest && (self.__bbVncCursor !== false);   // X guests: viewer-drawn cursor
        try {   // frame-update heartbeat for the display HUD (panel.js)
          const d = rfb._display, flip = d.flip;
          d.flip = function () { self.__guiFrameT = Date.now(); return flip.apply(this, arguments); };
        } catch (e) {}
        // One pointer on screen: noVNC draws the guest's cursor as its own element on iPad (it has
        // no CSS cursors there), which trailed the Magic Keyboard pointer as a second, lagging arrow.
        // Hide it while a trackpad/mouse is in use, show it again on touch; Android has none.
        if (!guiHost.__bbCursorSwitch) {
          guiHost.__bbCursorSwitch = true;
          guiHost.addEventListener("pointerdown", cursorSwitch, true);
          guiHost.addEventListener("pointermove", cursorSwitch, true);
        }
        cursorSwitch();
        if (opts.touchGuest) {
          installPointerDither(RFB);
          try { rfb._sock.__bbTouch = { r: rfb, x: -1, y: -1 }; } catch (e) {}
          installDirectTouch(rfb);
        }
        if (opts.appsKey) {
          installAppsKey(RFB);
          try { rfb._sock.__bbApps = { r: rfb, mask: 0, open: false, swallow: false, sending: false }; } catch (e) {}
        }
        rfbBornAt = Date.now();   // stuck-connecting watchdog baseline
        try { self.__rfb = rfb; } catch (e) {}
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        // Cheaper guest-side encode = faster first frame + snappier updates: Xvnc compresses
        // frames on the EMULATED CPU, so high zlib effort is pure lag. Level 1 measured-cheap.
        try { rfb.compressionLevel = 1; } catch (e) {}
        rfb.addEventListener("connect", function () {
          guiRetries = 0; bootP.connected = true; guiStatus(statusCb, null);
          console.log("[gui] display connected " + Math.round((Date.now() - guiT0) / 1000) + " s after start");
        });
        rfb.addEventListener("disconnect", function () {
          rfb = null;
          // Auto-retry until the guest's X server (Xvnc) is up. FAST cadence for the first ~10s
          // (Xvnc usually appears within moments of a tap once the guest is warm — 4s ticks made
          // every connect feel slow), then back off to 4s for the long cold-boot tail.
          // Android (touchGuest): the display IS the whole UI, so never give up - after the first
          // ~4 min keep trying every 15 s (a busy or briefly unreachable guest comes back on its own;
          // before 1.1 the pane froze on the last frame until the user tapped the display bar).
          if (guiRetries++ < 60 || opts.touchGuest) {
            var wait = guiRetries <= 8 ? 1200 : guiRetries <= 60 ? 4000 : 15000;
            guiStatus(statusCb, "Connecting to " + (opts.vncLabel || "the Linux desktop") + "…", true);
            setTimeout(function () { if (!rfb) connectGui(guiHost, statusCb); }, wait);
          }
          else {
            // ~4 min of refused connections: the guest's display server isn't running. Stop retrying
            // (an endless reconnect loop only burns the iPad) and say so.
            console.log("[gui] gave up: the guest's display server never accepted a connection");
            guiStatus(statusCb, "The desktop's display server didn't start (the Linux guest itself is running - see the log). Tap the display bar to try again.");
          }
        });
      } catch (e) { rfb = null; guiStatus(statusCb, "VNC error: " + ((e && e.message) || e)); return null; }
      return rfb;
    }
    opts.onReady && opts.onReady({ xterm, term: xterm, fs: shareFs, connectGui });
  }

  self.QEMU_WASM = { run };
})();
