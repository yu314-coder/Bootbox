/* MiniOS 64-bit runtime — boots x86_64 Linux via QEMU-Wasm (container2wasm) into
 * an xterm terminal. Exposes window.QEMU_WASM.run({ screen_container, base, onReady, onError }).
 *
 * REQUIRES crossOriginIsolated === true (SharedArrayBuffer) for QEMU's pthreads.
 * In a browser that means COOP/COEP response headers; in the iPad app the host
 * page must be served cross-origin-isolated (see HostView scheme handler).        */
(function () {
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

  async function run(opts) {
    const base = opts.base || "vendor/qemu/";
    const host = opts.screen_container;
    const say = (typeof opts.onStatus === "function") ? opts.onStatus : function () {};
    if (!self.crossOriginIsolated) {
      opts.onError && opts.onError(new Error("64-bit mode needs cross-origin isolation (SharedArrayBuffer). " +
        "The host page must send COOP/COEP headers."));
      return;
    }
    // Pre-create Module with locateFile so load.js (.data) and out.js (.wasm)
    // fetch from the vendor/qemu/ subdir rather than the page root.
    const absBase = new URL(base, location.href).href;
    self.Module = self.Module || {};
    self.Module.locateFile = (p) => absBase + p;

    loadCss(base + "xterm.css");
    // xterm + xterm-pty expose globals (Terminal, openpty)
    await loadScript(base + "xterm.js");
    await loadScript(base + "xterm-pty.js");
    // load.js (data preloader) + arg-module.js (qemu args) define/extend global Module
    await loadScript(base + "load.js");
    await loadScript(base + "arg-module.js");
    // RAM control: the toolbar value (opts.ram) overrides the baked "-m" so it's no longer locked.
    if (opts.ram && self.Module && self.Module.arguments) {
      const a = self.Module.arguments, i = a.indexOf("-m");
      if (i >= 0 && a[i + 1] != null) a[i + 1] = opts.ram + "M";
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

    const xterm = new Terminal({ fontSize: 13, theme: { background: "#0b0f1a" } });
    xterm.open(termEl);
    const { master, slave } = openpty();
    xterm.loadAddon(master);

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
    Module.mainScriptUrlOrBlob = new URL(base + "out.js", location.href).href;
    // Diagnostics so a hang/crash is VISIBLE: Emscripten data-load status, QEMU stderr, and abort.
    const toTerm = (t) => { try { xterm.write(String(t).replace(/\n/g, "\r\n") + "\r\n"); } catch (e) {} try { console.log("[qemu]", t); } catch (e2) {} };
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
      const wurl = absBase + (opts.wasm || "qemu-system-x86_64.wasm");   // per-guest engine (aarch64 differs)
      say("64-bit: fetching engine binary…");
      fetch(wurl)
        .then((r) => { if (!r.ok) throw new Error("wasm HTTP " + r.status); say("64-bit: compiling engine (first load is slow)…"); return r.arrayBuffer(); })
        .then((buf) => WebAssembly.instantiate(buf, imports))
        .then((res) => { say("64-bit: engine ready — starting CPU…"); receive(res.instance, res.module); })
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
    const init = (await import(new URL(base + "out.js", location.href).href)).default;
    // Heartbeat — so it VISIBLY does stuff while QEMU sets up and the kernel cold-boots (no output yet).
    let hbN = 0;
    const hb = setInterval(() => { hbN++; say("64-bit: working… " + hbN + "s — booting kernel (watch the terminal below)"); }, 1000);
    try { await init(Module); } finally { clearInterval(hb); }
    toTerm("[boot] QEMU main started.");
    // File-share API over Module.FS "/share" (bind-mounted into the guest as /share). Lets the app
    // move files host<->guest for the 64-bit Save/Share buttons. read() may return null until the
    // guest writes; write() drops a file the guest sees immediately at /share/<name>.
    const shareFs = {
      list: () => { try { return self.Module.FS.readdir("/share").filter((n) => n !== "." && n !== ".."); } catch (e) { return []; } },
      read: (name) => { try { return self.Module.FS.readFile("/share/" + name); } catch (e) { return null; } },
      write: (name, bytes) => { try { self.Module.FS.writeFile("/share/" + name, bytes); return true; } catch (e) { return false; } },
    };
    // noVNC GUI: lazily connect to the guest's desktop when the user first opens the GUI tab. The
    // guest runs Xvfb + x11vnc (listening on its eth0:5900); the in-app netstack's /vnc endpoint
    // vn.Dial's it and bridges RFB over this WebSocket. opts.vnc = "ws://127.0.0.1:8889/vnc".
    // Idempotent (no-op if already connected) and reconnects after a disconnect (the panel re-calls
    // this on each GUI-tab open). The LEFT terminal + internet are untouched.
    let rfb = null, guiRetries = 0;
    async function connectGui(guiHost, statusCb) {
      statusCb = statusCb || function () {};
      if (rfb) return rfb;
      if (!opts.vnc) { statusCb("No VNC endpoint configured for this guest."); return null; }
      statusCb("Connecting to the Linux desktop…");
      let RFB = __RFB || (await __rfbWarm);   // use the pre-warmed viewer (loaded while memory was free)
      if (!RFB) {
        // Pre-warm didn't land — try a fresh import; if that fails too, retry on a timer (don't stick).
        try { RFB = __RFB = (await import(new URL("vendor/novnc/core/rfb.js?r=" + guiRetries, location.href).href)).default; }
        catch (e) {
          if (guiRetries++ < 45) { statusCb("Loading the desktop viewer… (~" + (guiRetries * 4) + "s)"); setTimeout(() => connectGui(guiHost, statusCb), 4000); }
          else { statusCb("noVNC failed to load: " + ((e && e.message) || e)); }
          return null;
        }
      }
      try {
        rfb = new RFB(guiHost, opts.vnc, { shared: true });
        try { self.__rfb = rfb; } catch (e) {}
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.addEventListener("connect", function () { guiRetries = 0; statusCb(null); });
        rfb.addEventListener("disconnect", function () {
          rfb = null;
          // Auto-retry until the guest's X server (Xvnc) is up — the desktop appears ~20-40s after
          // the # prompt, and a "Desktop" boot opens the GUI tab before it's ready. Capped so a
          // guest that never starts a desktop eventually stops trying.
          if (guiRetries++ < 45) { statusCb("Connecting to the Linux desktop… (~" + (guiRetries * 4) + "s)"); setTimeout(function () { connectGui(guiHost, statusCb); }, 4000); }
          else { statusCb("Desktop didn't come up. Tap 🖥️ GUI to retry."); }
        });
      } catch (e) { rfb = null; statusCb("VNC error: " + ((e && e.message) || e)); return null; }
      return rfb;
    }
    opts.onReady && opts.onReady({ xterm, term: xterm, fs: shareFs, connectGui });
  }

  self.QEMU_WASM = { run };
})();
