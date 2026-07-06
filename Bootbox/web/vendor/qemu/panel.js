/* QEMU_PANEL — the 64-bit Linux screen. make(screen_container, { mode }) picks the layout:
 *
 *  - mode:"console"  → [ live xterm terminal (LEFT) | GUI-only pane (RIGHT) ]. The terminal IS the
 *      console; any X program you launch from it shows in the GUI. (Console + Files tabs hidden.)
 *  - mode:"desktop"  → full-screen graphical desktop, no console pane (terminal hidden).
 *  - mode:"full"     → legacy 3-tab [ 🐧 Console | 🖥️ GUI | 📁 Files ] (kept for reference; the
 *      Console command-runner and the iOS-Files-style FS browser still live below but aren't shown
 *      in the two shipping modes).
 *
 * The GUI is a noVNC canvas showing the guest's Xvnc desktop, bridged through the in-app netstack's
 * /vnc endpoint. Console/Files commands run in the REAL guest via the xterm/pty (xterm.paste) wrapped
 * in begin/end markers, then scraped back out of the scrollback. Keyboard focus follows taps
 * (isGuiActive() = keys-go-to-GUI); desktop mode is pinned to the GUI.
 *
 * make(sc, opts) -> { termHost, setXterm(xterm), runCmd(str), panel, guiHost, onGuiOpen, showGui(),
 *   isGuiActive(), setGuiStatus(text) }
 */
(function () {
  function injectStyleOnce() {
    if (document.getElementById("q64-style")) return;
    var st = document.createElement("style");
    st.id = "q64-style";
    st.textContent =
      ".q64-wrap{display:flex;flex-direction:row;width:100%;height:100%;white-space:normal;color:#cdd6e6}" +
      ".q64-term{flex:1;min-width:0;height:100%;position:relative;overflow:hidden;background:#0b0f1a}" +
      ".q64-panel{width:320px;flex:0 0 320px;height:100%;display:flex;flex-direction:column;background:#0e131c;border-left:1px solid #20283a;color:#cdd6e6;font-family:'Cascadia Mono',Consolas,monospace}" +
      ".q64-panel.gui-active{width:52%;flex-basis:52%}" +
      /* desktop mode: the GUI is the whole screen (no console pane) */
      ".q64-panel.q64-desk{flex:1 1 100%!important;width:100%!important;border-left:none}" +
      ".q64-panel.q64-desk .q64-tabs,.q64-panel.q64-desk .q64-tg{display:none}" +
      ".q64-panel.collapsed{flex-basis:30px;width:30px}" +
      ".q64-panel.collapsed .q64-body,.q64-panel.collapsed .q64-tabs{display:none}" +
      ".q64-hd{display:flex;align-items:center;gap:6px;height:34px;padding:0 6px;background:#121a28;border-bottom:1px solid #20283a;font-size:12px;font-weight:700;color:#9fb3d1}" +
      ".q64-tabs{display:flex;gap:4px}" +
      ".q64-tab{cursor:pointer;background:#1b2333;border:1px solid #2a3550;color:#9fb3d1;border-radius:6px;height:24px;padding:0 8px;font:700 11px/1 'Cascadia Mono',monospace}" +
      ".q64-tab.on{background:#0067c0;color:#fff;border-color:#0067c0}" +
      ".q64-tg{margin-left:auto;cursor:pointer;background:#1b2333;border:1px solid #2a3550;color:#cdd6e6;border-radius:5px;width:24px;height:22px;font-weight:700;line-height:1}" +
      ".q64-body{flex:1;display:flex;flex-direction:column;min-height:0}" +
      ".q64-console{flex:1;display:flex;flex-direction:column;min-height:0}" +
      ".q64-out{flex:1;margin:0;padding:9px;overflow:auto;white-space:pre-wrap;word-break:break-word;font-size:13px;line-height:1.45;color:#b7f5cf;background:#0b0f17}" +
      ".q64-out .cmd{color:#ffd479;font-weight:700}" +
      ".q64-grid{display:grid;grid-template-columns:1fr 1fr;gap:5px;padding:7px;border-bottom:1px solid #20283a}" +
      ".q64-qb{height:32px;border-radius:6px;border:1px solid #2a3550;background:#172033;color:#cdd6e6;font:600 11px/1 'Cascadia Mono',monospace;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 6px;transition:background .12s,opacity .15s}" +
      ".q64-qb:active{background:#2c3d61;transform:scale(.97)}" +
      /* busy-state (build 72): while a command runs, the pressed button pulses and the rest lock —
         before, taps during a run were SILENTLY swallowed and buttons looked broken. */
      ".q64-qb.running{background:#1d3a2b;border-color:#2f7d4f;color:#9fe8b8}" +
      ".q64-qb.running::after{content:'…';animation:q64pulse 1s infinite}" +
      "@keyframes q64pulse{0%,100%{opacity:.3}50%{opacity:1}}" +
      ".q64-grid.locked .q64-qb:not(.running){opacity:.4;pointer-events:none}" +
      ".q64-hdr{grid-column:1/-1;font:700 9px/1 'Cascadia Mono',monospace;letter-spacing:1.5px;color:#5f7397;text-transform:uppercase;padding:5px 2px 1px}" +
      ".q64-inp{display:flex;gap:6px;padding:8px;border-bottom:1px solid #20283a;background:#121a28}" +
      ".q64-inp input{flex:1;min-width:0;height:40px;border-radius:7px;border:1px solid #2a3550;background:#0b0f17;color:#e6edf7;font:600 14px/1 'Cascadia Mono',monospace;padding:0 10px}" +
      ".q64-inp button{flex:0 0 auto;height:40px;padding:0 16px;border-radius:7px;border:0;background:#0067c0;color:#fff;font-weight:700;font-size:14px;cursor:pointer}" +
      ".q64-gui{flex:1;min-height:0;background:#000;position:relative;overflow:hidden;display:none}" +
      ".q64-gui canvas{display:block;margin:auto}" +
      ".q64-guimsg{position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;text-align:center;padding:14px;color:#9fb3d1;font:600 12px/1.5 'Cascadia Mono',monospace;pointer-events:none}" +
      /* Files tab — light, iOS-Files style */
      ".q64-files{flex:1;min-height:0;display:none;flex-direction:column;background:#f2f3f7;color:#1c1c1e;font-family:-apple-system,'Segoe UI',Roboto,sans-serif}" +
      ".q64-fbar{display:flex;align-items:center;gap:8px;padding:8px 10px;background:#fff;border-bottom:1px solid #d8dade}" +
      ".q64-fbtn{flex:0 0 auto;cursor:pointer;background:#eef0f4;border:1px solid #d8dade;border-radius:7px;height:30px;min-width:30px;padding:0 10px;color:#0067ed;font:600 14px/1 -apple-system,sans-serif}" +
      ".q64-fbtn:active{background:#e1e4ea}" +
      ".q64-armed{background:#ffe0e0;border-color:#ff9d9d;color:#d70015}" +
      ".q64-fbtn[disabled]{opacity:.4}" +
      ".q64-fpath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:600 13px/1 ui-monospace,monospace;color:#3a3a3c;direction:rtl;text-align:left}" +
      ".q64-flist{flex:1;min-height:0;overflow:auto;-webkit-overflow-scrolling:touch}" +
      ".q64-frow{display:flex;align-items:center;gap:11px;padding:11px 14px;border-bottom:1px solid #e6e7eb;cursor:pointer;background:#fff}" +
      ".q64-frow:active{background:#e8eaf0}" +
      ".q64-fic{flex:0 0 auto;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:21px}" +
      ".q64-fnm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font:500 15px/1.2 -apple-system,sans-serif;color:#1c1c1e}" +
      ".q64-fsz{flex:0 0 auto;color:#8e8e93;font:400 12px/1 -apple-system,sans-serif}" +
      ".q64-fch{flex:0 0 auto;color:#c4c4c6;font-size:18px;font-weight:600}" +
      ".q64-fmsg{padding:20px 16px;text-align:center;color:#8e8e93;font:500 13px/1.5 -apple-system,sans-serif}" +
      ".q64-fview{position:absolute;inset:0;display:none;flex-direction:column;background:#fff}" +
      ".q64-fview pre{flex:1;margin:0;padding:12px;overflow:auto;white-space:pre-wrap;word-break:break-word;font:13px/1.5 ui-monospace,monospace;color:#1c1c1e}";
    document.head.appendChild(st);
  }

  // Commands chosen to work on the Alpine/BusyBox guest (and any minimal Linux).
  // Entries: [label, command, "gui"?] — or ["@ section"] group headers (build 72).
  var QUICK = [
    ["@ wine & gui"],
    // Wine (build 62-71): wine-staging 11.5, esync+quiet defaults, warm prefix, cx16 engine.
    // "🍷" runs the streaming diagnostic matrix (cx16 → cmd → winemine), pushed via /share.
    ["🍷 Wine test", "__wt4__"],
    // Bounded tail (build 72): 45s of live log then the pty frees itself — the old `tail -f`
    // held the console hostage until ^C and made every other button look dead.
    ["📜 Wine log", "timeout 45 tail -n 40 -f /root/winetest-cmd.log /root/winetest-esync.log 2>/dev/null; echo '[log view ended — tap 📜 again for more]'"],
    ["🖥️ GUI test", "(DISPLAY=:0 xterm -geometry 72x22 -bg white -fg black -fn fixed -e sh -c 'echo BOOTBOX GUI WORKS; echo; echo If you can read this white window, the graphical desktop is working.; exec sh' >/dev/null 2>&1 &); echo 'Launched a test window on the X desktop — switching to the 🖥️ GUI tab. A white terminal window should appear within a few seconds.'", "gui"],
    // Input-freeze discriminator: yellow window responds but wine does not → wine holds an X grab;
    // NEITHER responds → the VNC input path is stuck (use 🔄 on the GUI pane).
    ["🩺 input probe", "(DISPLAY=:0 xterm -geometry 40x12+30+30 -bg yellow -fg black -fn fixed -e sh -c 'echo TAP HERE; echo; echo If this window responds but wine does not: wine holds a grab.; echo If neither responds: tap the blue reload button on the GUI tab.; exec sh' >/dev/null 2>&1 &); echo 'Yellow probe window launched — switching to the 🖥️ GUI tab.'", "gui"],
    ["⚛️ cx16 probe", "winetest cx16"],
    ["@ system"],
    ["uname", "uname -a"],
    ["os-release", "cat /etc/os-release"],
    ["ls /", "ls -la /"],
    ["ip addr", "ip -o addr show eth0 2>/dev/null | grep -o 'inet [0-9.]*' || ifconfig eth0"],
    ["🌐 internet", "wget -T 12 -qO- http://example.com 2>&1 | head -c 400; echo"],
    ["uv pip", "uv pip install --help 2>&1 | head -3"],
    ["memory", "free -m"],
    ["procs", "ps"]
  ];

  function make(sc, opts) {
    opts = opts || {};
    // Boot mode decides the right-pane layout:
    //   "console" = [ live terminal (LEFT) | GUI-only pane (RIGHT) ] — the terminal IS the console,
    //               and the GUI shows whatever X program you launch from it. Console + Files tabs hidden.
    //   "desktop" = full-screen graphical desktop, no console pane at all.
    //   "full"    = legacy 3-tab [ Console | GUI | Files ].
    var mode = opts.mode || "full";
    // Which surface the on-screen keyboard feeds. Desktop has no terminal so it's pinned to the GUI;
    // console starts on the terminal and follows taps (tap the GUI canvas to type into an X app, tap
    // the terminal to type commands).
    var kbdTarget = (mode === "desktop") ? "gui" : "term";
    injectStyleOnce();
    Array.prototype.forEach.call(sc.children, function (c) { if (c.id !== "kbd-capture") c.style.display = "none"; });
    sc.style.display = "block";
    sc.style.alignItems = "stretch";
    sc.style.justifyContent = "flex-start";

    var wrap = document.createElement("div"); wrap.className = "q64-wrap";
    var termHost = document.createElement("div"); termHost.className = "q64-term";
    var panel = document.createElement("div"); panel.className = "q64-panel";
    panel.innerHTML =
      '<div class="q64-hd">' +
      '<div class="q64-tabs">' +
      '<button class="q64-tab on" data-tab="console">🐧 Console</button>' +
      '<button class="q64-tab" data-tab="gui">🖥️ GUI</button>' +
      '<button class="q64-tab" data-tab="files">📁 Files</button>' +
      '</div>' +
      '<button class="q64-tg" title="Hide / show panel">›</button>' +
      '</div>' +
      '<div class="q64-body">' +
      '<div class="q64-console">' +
      '<div class="q64-inp"><input autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false" placeholder="type a command + Run (e.g. uv pip install flask)"><button>Run</button></div>' +
      '<div class="q64-grid"></div>' +
      '<pre class="q64-out">Booting… type a command above or tap a button — output appears here.</pre>' +
      '</div>' +
      '<div class="q64-gui"><div class="q64-guimsg">Tap 🖥️ GUI after the guest boots. The Linux desktop comes up ~20–40s after the # prompt.</div></div>' +
      '<div class="q64-files">' +
      '<div class="q64-fbar"><button class="q64-fbtn q64-fup" title="Up">‹</button><div class="q64-fpath">/</div><button class="q64-fbtn q64-fsend" title="Copy a file from the iPad (Files app → Bootbox) into this folder">⬆ From iPad</button><button class="q64-fbtn q64-fref" title="Refresh">⟳</button></div>' +
      '<div class="q64-flist"><div class="q64-fmsg">Open after the guest boots.</div></div>' +
      '<div class="q64-fview"><div class="q64-fbar"><button class="q64-fbtn q64-fclose">‹ Files</button><div class="q64-fpath q64-fvname"></div></div><pre></pre></div>' +
      '</div>' +
      "</div>";
    wrap.appendChild(termHost); wrap.appendChild(panel); sc.appendChild(wrap);

    var out = panel.querySelector(".q64-out");
    var grid = panel.querySelector(".q64-grid");
    var inp = panel.querySelector(".q64-inp input");
    var runBtn = panel.querySelector(".q64-inp button");
    var tg = panel.querySelector(".q64-tg");
    var consoleEl = panel.querySelector(".q64-console");
    var guiEl = panel.querySelector(".q64-gui");
    var guimsg = panel.querySelector(".q64-guimsg");
    var filesEl = panel.querySelector(".q64-files");
    var flist = panel.querySelector(".q64-flist");
    var fpath = panel.querySelector(".q64-fpath");
    var fupBtn = panel.querySelector(".q64-fup");
    var frefBtn = panel.querySelector(".q64-fref");
    var fview = panel.querySelector(".q64-fview");
    var fviewPre = fview.querySelector("pre");
    var fvname = panel.querySelector(".q64-fvname");
    var fcloseBtn = panel.querySelector(".q64-fclose");
    var tabBtns = panel.querySelectorAll(".q64-tab");

    // 🔄 desktop-reconnect button (build 66): fixes the "display alive but input dead" state —
    // the minesweeper clock keeps ticking (frames flow) while taps go nowhere. A fresh RFB
    // session re-establishes the input direction. Lives ON the GUI pane so it's reachable
    // exactly when the desktop itself stops responding.
    var reBtn = document.createElement("button");
    reBtn.textContent = "🔄";
    reBtn.title = "Reconnect the desktop viewer (fixes frozen input)";
    reBtn.style.cssText = "position:absolute;top:6px;right:6px;z-index:40;opacity:.8;padding:4px 9px;" +
      "border-radius:6px;border:1px solid #2f6bdb;background:#16263f;color:#dfe8f5;font-size:14px;";
    reBtn.onclick = function (ev) {
      ev.stopPropagation();
      if (window.__guiReconnect) { setGuiStatus("Reconnecting the desktop…"); window.__guiReconnect(); }
      else setGuiStatus("Viewer not started yet — boot the guest first.");
    };
    try { guiEl.style.position = "relative"; guiEl.appendChild(reBtn); } catch (e) {}

    // 🖥️ display HUD (build 68): answers "is the display ON?" at a glance — a CONNECTED viewer
    // showing an EMPTY desktop is pitch black and looks identical to a dead one, which made a
    // slow-loading wine app indistinguishable from a broken GUI. Shows: OFF / CONNECTING / ON,
    // the screen size, and a "screen changed Ns ago" heartbeat (5-pixel signature sampled every
    // 2s — if wine draws anything, the age resets, so "ON + changing" = wine IS rendering).
    var hud = document.createElement("div");
    hud.style.cssText = "position:absolute;top:6px;left:6px;right:46px;z-index:35;padding:3px 8px;border-radius:6px;" +
      "background:rgba(12,20,36,.82);color:#9fb3d1;font:600 10px/1.45 'Cascadia Mono',monospace;cursor:pointer;";
    hud.textContent = "🖥️ display: OFF";
    hud.title = "Tap to connect the desktop viewer";
    hud.onclick = function () {
      // Smart tap (build 72): OFF → connect; stuck CONNECTING → force a FRESH session (the old
      // handler called the idempotent connectGui, which returned the stuck object = dead button).
      var st = window.__guiState ? window.__guiState() : "no-rfb";
      if (st !== "no-rfb" && st.indexOf("connected") !== 0 && window.__guiReconnect) {
        setGuiStatus("Reconnecting the desktop…"); window.__guiReconnect(); return;
      }
      try { if (typeof api.onGuiOpen === "function") api.onGuiOpen(guiEl); } catch (e) {}
    };
    try { guiEl.appendChild(hud); } catch (e) {}
    var hudSig = null, hudChangeT = 0;
    setInterval(function () {
      if (guiEl.style.display === "none") return;   // pane hidden — skip the work
      var st = (window.__guiState ? window.__guiState() : "no-rfb");
      if (st === "no-rfb") {
        hud.style.color = "#e0a06a";
        hud.textContent = "🖥️ display: OFF — run a GUI app (or tap here) to connect";
        return;
      }
      if (st.indexOf("connected") !== 0) {
        hud.style.color = "#e6d06a";
        hud.textContent = "🖥️ display: CONNECTING… (" + st + ")";
        return;
      }
      var cv = guiEl.querySelector("canvas"), dim = cv && cv.width ? (cv.width + "×" + cv.height) : "no frame yet";
      var sig = null;
      try {
        if (cv && cv.width) {
          var cx = cv.getContext("2d"), s = 0;
          for (var i = 1; i <= 5; i++) {
            var d = cx.getImageData((cv.width * i / 6) | 0, (cv.height * i / 6) | 0, 1, 1).data;
            s = (s * 31 + d[0] * 3 + d[1] * 5 + d[2] * 7) >>> 0;
          }
          sig = s;
        }
      } catch (e) {}
      var now = Date.now();
      if (sig !== null && sig !== hudSig) { hudSig = sig; hudChangeT = now; }
      var age = hudChangeT ? Math.round((now - hudChangeT) / 1000) : -1;
      hud.style.color = "#8fd18f";
      hud.textContent = "🖥️ display: ON · " + dim + (age >= 0 ? " · screen changed " + age + "s ago" : "") +
        " — black = empty desktop; wine windows can take minutes on first run (📜 Wine log)";
    }, 2000);

    function showTab(which) {
      consoleEl.style.display = which === "console" ? "flex" : "none";
      guiEl.style.display = which === "gui" ? "block" : "none";
      filesEl.style.display = which === "files" ? "flex" : "none";
      panel.classList.toggle("gui-active", which === "gui" || which === "files");   // widen the pane for gui + files
      Array.prototype.forEach.call(tabBtns, function (t) { t.classList.toggle("on", t.getAttribute("data-tab") === which); });
      if (which === "gui" && typeof api.onGuiOpen === "function") { try { api.onGuiOpen(guiEl); } catch (e) { setGuiStatus("GUI error: " + (e && e.message)); } }
      // Rescale poke (build 68): the intent pre-connect (build 67) can attach noVNC while this
      // pane is display:none (0×0) — the canvas then scales to 0 and the pane stays BLACK even
      // though the session is live. On show, force a fresh scale computation with real dimensions.
      if (which === "gui") setTimeout(function () {
        try {
          var r = window.__rfb;
          if (r) { r.scaleViewport = false; r.scaleViewport = true; }
          window.dispatchEvent(new Event("resize"));
        } catch (e) {}
      }, 80);
      if (which === "files") loadFiles(curDir || "/");
    }
    Array.prototype.forEach.call(tabBtns, function (t) { t.onclick = function () { showTab(t.getAttribute("data-tab")); }; });
    tg.onclick = function () {
      panel.classList.toggle("collapsed");
      tg.textContent = panel.classList.contains("collapsed") ? "‹" : "›";
    };
    function setGuiStatus(text) { if (guimsg) { if (text == null) { guimsg.style.display = "none"; } else { guimsg.style.display = "flex"; guimsg.textContent = text; } } }

    var xt = null, markN = 0, busy = false;
    // Unique per-panel marker prefix so begin/end markers never collide with anything already in the
    // scrollback (other tooling, prior output, or the user echoing "zzB").
    var SESS = "QF" + Math.floor((Math.random() || 0.5) * 1e9).toString(36) + "_";
    function readBuf(maxLines) {
      if (!xt) return "";
      try {
        var b = xt.buffer.active, s = "", i, ln;
        // Scan only the recent tail by default — the begin/end markers are always in the newest output,
        // and scanning all ~10000 scrollback lines (translateToString each) on every poll was the main
        // per-poll cost. Callers that produce huge output (base64 download) pass 0 for a full scan.
        var start = (maxLines && b.length > maxLines) ? b.length - maxLines : 0;
        for (i = start; i < b.length; i++) {
          ln = b.getLine(i); if (!ln) continue;
          // A row with isWrapped=true is the continuation of the previous row (the terminal soft-wrapped a
          // line longer than the width). Join it WITHOUT a newline so one logical output line stays one line.
          if (ln.isWrapped && s.length && s.charAt(s.length - 1) === "\n") s = s.slice(0, -1) + ln.translateToString(true) + "\n";
          else s += ln.translateToString(true) + "\n";
        }
        return s;
      } catch (e) { return ""; }
    }
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function show(cmd, body) { out.innerHTML = '<span class="cmd">$ ' + esc(cmd) + "</span>\n" + esc(body); out.scrollTop = 0; }

    // Run a command in the guest pty and resolve its output (between markers). Serialized via `busy`
    // so the Console, Files browser and key input never interleave on the shared pty.
    function scrape(cmd, timeoutMs, bigOutput) {
      return new Promise(function (resolve) {
        if (!xt) return resolve(null);
        if (busy) return resolve("__BUSY__");
        busy = true;
        var n = ++markN, B = SESS + "B" + n, E = SESS + "E" + n;
        // Lead with a bare CR so any half-typed console line is submitted (harmlessly erroring) and we
        // start from a fresh prompt — the auto-retry in loadFiles then covers that first wasted attempt.
        // (Avoid Ctrl-U here: some paste paths pass it through literally and corrupt the command.)
        var line = "\rprintf '" + B + "\\n'; " + cmd + " 2>&1; printf '" + E + "\\n'\r";
        try { (xt.paste || xt.input).call(xt, line); } catch (e) { busy = false; return resolve(null); }
        var t0 = Date.now(), to = timeoutMs || 30000, win = bigOutput ? 0 : 1500;
        (function poll() {
          var buf = readBuf(win);
          var bi = buf.lastIndexOf(B + "\n"), ei = buf.lastIndexOf(E + "\n");
          // If the begin marker scrolled past the tail window (unexpectedly large output), retry full-scan once.
          if (win && (bi < 0 || ei <= bi)) { var full = readBuf(0); bi = full.lastIndexOf(B + "\n"); ei = full.lastIndexOf(E + "\n"); if (bi >= 0 && ei > bi) buf = full; }
          if (bi >= 0 && ei > bi) {
            var res = buf.slice(bi + (B + "\n").length, ei)
              .split("\n").filter(function (l) { return l.indexOf(SESS) < 0; })
              .join("\n").replace(/\s+$/, "");
            busy = false; return resolve(res);
          }
          if (Date.now() - t0 > to) { busy = false; return resolve("(timed out — the guest may be slow; try again)"); }
          setTimeout(poll, 90);
        })();
      });
    }

    // 🍷 Wine test v4 (build 69): the STREAMING test script ships as a web asset and is pushed
    // into the guest through the 9p /share bridge at press time — guest-side script updates
    // without a rootfs rebuild. Falls back to the baked `winetest` if the bridge isn't up.
    var wt4Text = null;
    async function runWinetest4(arg) {
      try { if (typeof api.onGuiOpen === "function") api.onGuiOpen(guiEl); } catch (e) {}   // pre-connect the viewer now
      try {
        if (!wt4Text) wt4Text = await (await fetch("vendor/qemu/winetest4.sh")).text();
        if (shareFs && shareFs.write && wt4Text && wt4Text.indexOf("stream_wait") >= 0) {
          shareFs.write("winetest4.sh", new TextEncoder().encode(wt4Text));
          runCmd("sh /share/winetest4.sh" + (arg ? " " + arg : ""));
          return;
        }
      } catch (e) {}
      runCmd("winetest" + (arg ? " " + arg : ""));
    }

    // Busy-state UI (build 72): lock the quick grid + Run button while a command is in flight.
    function setBusyUI(on) {
      try { grid.classList.toggle("locked", !!on); } catch (e) {}
      try { runBtn.disabled = !!on; runBtn.textContent = on ? "…" : "Run"; } catch (e) {}
    }

    async function runCmd(cmd) {
      cmd = (cmd || "").trim();
      if (!cmd) return;
      if (!xt) { show(cmd, "Terminal not ready yet — wait for the # prompt."); return; }
      if (busy) { show(cmd, "Still running the previous command — its output streams in the terminal. Try again when the buttons unlock."); return; }
      // GUI-intent pre-connect (build 67): if the command will draw on the X desktop, start the
      // noVNC connection NOW (in the background) instead of waiting for the first GUI-tab tap —
      // by the time the window exists, the viewer is already live. Keeps the lazy-display power
      // win for plain console work (no match = no connect).
      if (/(^|[\s\/;(])(wine|winetest|xterm|xeyes|xclock|winemine|winecfg|start-desktop)\b|DISPLAY=/.test(cmd)) {
        try { if (typeof api.onGuiOpen === "function") api.onGuiOpen(guiEl); } catch (e) {}
      }
      show(cmd, "…running…");
      setBusyUI(true);
      var res;
      try { res = await scrape(cmd, 90000); } finally { setBusyUI(false); }
      if (res === "__BUSY__") { show(cmd, "Busy with another command — try again in a moment."); return; }
      show(cmd, res == null ? "Terminal not ready." : (res || "(no output)"));
    }

    /* ---- Files browser: iOS-Files-style view of the live guest filesystem ---- */
    var curDir = "/";
    function joinPath(dir, name) { return (dir === "/" ? "" : dir.replace(/\/$/, "")) + "/" + name; }
    function parentOf(dir) { if (dir === "/" || dir === "") return "/"; var p = dir.replace(/\/$/, "").replace(/\/[^/]*$/, ""); return p === "" ? "/" : p; }
    function fmsg(t) { flist.innerHTML = '<div class="q64-fmsg">' + esc(t) + "</div>"; }

    async function loadFiles(dir, _retry) {
      if (!xt) { fmsg("Open after the guest boots (wait for the # prompt)."); return; }
      dir = dir || "/";
      curDir = dir;
      fpath.textContent = dir;
      fupBtn.disabled = (dir === "/");
      if (!_retry) fmsg("Loading " + dir + " …");
      // The FIRST listing right after boot is slow (~20s) because the emulated CPU is still finishing the
      // guest's boot; once it settles a listing is <1s. Explain that if it's taking a while, so it doesn't
      // look stuck (this is the "it works the second time" the user hit — the 2nd try is post-settle).
      var slow = setTimeout(function () { if (curDir === dir) fmsg("Loading " + dir + " … (the first listing is slow while the guest finishes booting — a moment)"); }, 3500);
      // -A: dotfiles too (hidden files show, no . / ..). -p: trailing / on dirs. -1: one name per line.
      // (NOT ls -l: it stats every entry — slow on the emulated CPU during first-boot — and its wide rows
      // soft-wrap at the terminal width, corrupting the scrape. Names-only is fast and wrap-proof.)
      var qd = "'" + dir.replace(/'/g, "'\\''") + "'";
      var res = await scrape("ls -Ap1 " + qd + " 2>&1", 40000);
      clearTimeout(slow);
      // AUTO-RETRY once — this is exactly the "it works the second time" the user hit: the first scrape can
      // land while the pty is momentarily busy or mid-line, so retry once automatically before giving up.
      if (!_retry && (res === "__BUSY__" || res == null || (typeof res === "string" && res.indexOf("timed out") >= 0))) {
        await new Promise(function (r) { setTimeout(r, 400); });
        if (curDir !== dir) return;
        return loadFiles(dir, true);
      }
      if (res === "__BUSY__") { fmsg("Busy — tap ⟳ to retry."); return; }
      if (res == null) { fmsg("Terminal not ready."); return; }
      if (curDir !== dir) return;   // user navigated again while we waited
      var lines = res.split("\n").map(function (s) { return s.replace(/\r/g, ""); }).filter(function (s) { return s.length; });
      if (lines.length === 1 && /No such file|not found|Permission denied|cannot/i.test(lines[0])) { fmsg(lines[0]); return; }
      var dirs = [], files = [];
      lines.forEach(function (l) {
        if (/^total\s/.test(l) || /^ls:/.test(l)) return;
        var isDir = l.charAt(l.length - 1) === "/";       // -p marks dirs with a trailing slash
        var name = isDir ? l.slice(0, -1) : l;
        if (name === "" || name === "." || name === "..") return;
        (isDir ? dirs : files).push({ name: name, size: "" });
      });
      var byName = function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); };
      dirs.sort(byName); files.sort(byName);
      var html = "";
      dirs.forEach(function (d) { html += row("📁", d.name, "", true); });
      files.forEach(function (f) {
        var ic = "📄"; if (/\.(png|jpg|jpeg|gif|bmp|svg|ico)$/i.test(f.name)) ic = "🖼️";
        else if (/\.(gz|zip|tar|xz|bz2|7z)$/i.test(f.name)) ic = "🗜️";
        else if (f.name.indexOf(".") < 0) ic = "⚙️";
        html += row(ic, f.name, f.size, false);
      });
      if (!html) html = '<div class="q64-fmsg">Empty folder.</div>';
      flist.innerHTML = html;
      Array.prototype.forEach.call(flist.querySelectorAll(".q64-frow"), function (r) {
        r.onclick = function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest(".q64-fbtn") : null;
          var nm = r.getAttribute("data-nm"), isd = r.getAttribute("data-d") === "1";
          if (t && t.classList.contains("q64-fdl")) { downloadFile(joinPath(dir, nm), nm); return; }
          if (t && t.classList.contains("q64-frm")) { deleteEntry(t, joinPath(dir, nm), nm, isd); return; }
          if (isd) loadFiles(joinPath(dir, nm)); else openFile(joinPath(dir, nm), nm);
        };
      });
      flist.scrollTop = 0;
    }
    function row(icon, name, size, isDir) {
      var q = esc(name).replace(/"/g, "&quot;");
      return '<div class="q64-frow" data-nm="' + q + '" data-d="' + (isDir ? "1" : "0") + '">' +
        '<span class="q64-fic">' + icon + "</span>" +
        '<span class="q64-fnm">' + esc(name) + "</span>" +
        (size ? '<span class="q64-fsz">' + esc(size) + "</span>" : "") +
        (isDir ? "" : '<button class="q64-fbtn q64-fdl" title="Save to the iPad (Files app → Bootbox)">⬇</button>') +
        '<button class="q64-fbtn q64-frm" title="Delete">🗑</button>' +
        (isDir ? '<span class="q64-fch">›</span>' : "") +
        "</div>";
    }
    // Delete with a confirm-tap (WKWebView blocks window.confirm): first tap arms (🗑→✓?), second deletes.
    async function deleteEntry(btn, path, name, isDir) {
      if (btn.getAttribute("data-arm") !== "1") {
        btn.setAttribute("data-arm", "1"); btn.textContent = "✓?"; btn.classList.add("q64-armed");
        setTimeout(function () { if (btn) { btn.removeAttribute("data-arm"); btn.textContent = "🗑"; btn.classList.remove("q64-armed"); } }, 2500);
        return;
      }
      fmsg("Deleting " + name + " …");
      var qp = "'" + path.replace(/'/g, "'\\''") + "'";
      var res = await scrape("rm -rf " + qp + " && echo OK", 30000);
      fmsg(/OK/.test(res || "") ? ("Deleted " + name) : ("Delete failed: " + (res || "?")));
      loadFiles(curDir);
    }
    // ⬇ guest → iPad: read the file as base64 over the pty, decode, POST to the host
    // (LocalServer `POST /save/<name>` writes it into the Files-app Bootbox folder).
    async function downloadFile(path, name) {
      fmsg("Reading " + name + " …");
      var qp = "'" + path.replace(/'/g, "'\\''") + "'";
      var sz = parseInt(await scrape("stat -c %s " + qp + " 2>/dev/null || echo -1", 20000), 10);
      if (isNaN(sz) || sz < 0) { fmsg("Can't read " + name); return; }
      if (sz > 32 * 1024 * 1024) { fmsg("Too big for the panel (" + (sz/1048576|0) + " MB > 32 MB) — use /share or split it."); return; }
      var b64 = await scrape("base64 " + qp + " | tr -d '\\n'", 240000, true);
      if (!b64 || b64 === "__BUSY__") { fmsg("Read failed — try again."); return; }
      var bin;
      try { var s = atob(b64.replace(/[^A-Za-z0-9+/=]/g, "")); bin = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) bin[i] = s.charCodeAt(i); }
      catch (e) { fmsg("Decode failed (not a clean read)."); return; }
      try {
        var resp = await fetch("/save/" + encodeURIComponent(name), { method: "POST", body: bin });
        fmsg(resp.ok ? ("Saved ⬇ " + name + " → Files app → Bootbox (" + (bin.length/1024|0) + " KB)") : ("Host save failed: HTTP " + resp.status));
      } catch (e) { fmsg("Host save unavailable here (" + ((e && e.message) || e) + ")"); }
    }
    // ⬆ iPad → guest: pick an imported file (Files app → Bootbox), stream it into the shared
    // /share folder (host-side 9p write — instant), then cp it into the current directory.
    // vmres:// → http path: the 64-bit guest runs on the http origin (crossOriginIsolated), where the
    // custom vmres:// scheme isn't served — it must be rewritten to /vmres/… (this rewrite was MISSING,
    // so the old raw fetch("vmres://…") failed and the upload silently did nothing).
    function pRes(u) { return (u.indexOf("vmres://") === 0 && location.protocol === "http:") ? location.origin + "/vmres/" + u.slice(8) : u; }
    async function uploadFromIpad() {
      if (!shareFs || !shareFs.write) { fmsg("Upload needs a running 64-bit guest (wait for the # prompt)."); return; }
      fmsg("Reading the iPad Bootbox folder …");
      var names = [];
      try {
        var r = await (window.Bridge ? Bridge.call("binary", "list") : null);
        names = Array.isArray(r) ? r : (r && r.result) || [];
      } catch (e) {}
      names = names.filter(function (n) { return n && n.charAt(0) !== "." && !/\.part$/i.test(n); });
      if (!names.length) { fmsg("No files in the iPad Bootbox folder. Add some in the Files app (On My iPad → Bootbox), then tap ⬆ From iPad again."); return; }
      // In-panel picker — window.prompt() is blocked/unreliable in WKWebView, so the old chooser never
      // appeared → "upload cannot work". Render the iPad files as tappable rows instead.
      var html = '<div class="q64-fmsg">Tap a file to copy into ' + esc(curDir) + ' (⟳ to cancel):</div>';
      names.forEach(function (n) {
        html += '<div class="q64-frow q64-pick" data-nm="' + esc(n).replace(/"/g, "&quot;") + '"><span class="q64-fic">⬆</span><span class="q64-fnm">' + esc(n) + "</span></div>";
      });
      flist.innerHTML = html;
      Array.prototype.forEach.call(flist.querySelectorAll(".q64-pick"), function (r) {
        r.onclick = function () { doUpload(r.getAttribute("data-nm")); };
      });
    }
    async function doUpload(pick) {
      fmsg("Copying " + pick + " from the iPad …");
      try {
        var resp = await fetch(pRes("vmres://iso/" + pick));
        if (!resp.ok) throw new Error("HTTP " + resp.status + " reading it from the iPad");
        var bytes = new Uint8Array(await resp.arrayBuffer());
        if (!shareFs.write(pick, bytes)) throw new Error("share write failed");
        var qsrc = "'/share/" + pick.replace(/'/g, "'\\''") + "'";
        var dst = (curDir === "/" ? "/" : curDir + "/");
        var res = await scrape("cp " + qsrc + " '" + dst.replace(/'/g, "'\\''") + "' && echo OK", 60000);
        if (!/OK/.test(res || "")) throw new Error(res || "copy into the folder failed");
        fmsg("⬆ " + pick + " → " + curDir);
        loadFiles(curDir);
      } catch (e) { fmsg("Upload failed: " + ((e && e.message) || e)); }
    }
    async function openFile(path, name) {
      fvname.textContent = name;
      fviewPre.textContent = "Loading…";
      fview.style.display = "flex";
      var qp = "'" + path.replace(/'/g, "'\\''") + "'";
      // size guard + binary-ish guard: show the first 200 KB, as text
      var res = await scrape("if [ $(stat -c %s " + qp + " 2>/dev/null || echo 0) -gt 400000 ]; then head -c 200000 " + qp + "; echo; echo '… (truncated)'; else cat " + qp + "; fi 2>&1", 40000);
      if (res === "__BUSY__") { fviewPre.textContent = "Busy — close and reopen."; return; }
      fviewPre.textContent = (res == null ? "Terminal not ready." : res) || "(empty file)";
      fviewPre.scrollTop = 0;
    }
    var fsendBtn = panel.querySelector(".q64-fsend");
    if (fsendBtn) fsendBtn.onclick = function () { uploadFromIpad(); };
    var shareFs = null;
    fupBtn.onclick = function () { if (curDir !== "/") loadFiles(parentOf(curDir)); };
    frefBtn.onclick = function () { loadFiles(curDir); };
    fcloseBtn.onclick = function () { fview.style.display = "none"; };

    QUICK.forEach(function (pair) {
      if (pair[0].charAt(0) === "@") {   // "@ section" → full-width group header (build 72)
        var h = document.createElement("div");
        h.className = "q64-hdr"; h.textContent = pair[0].slice(1).trim();
        grid.appendChild(h);
        return;
      }
      var b = document.createElement("button");
      b.className = "q64-qb"; b.textContent = pair[0]; b.title = pair[1];
      // pair[2] === "gui": after running, auto-open the 🖥️ GUI tab so you immediately watch for the window.
      // The pressed button pulses (.running) and the others lock until the command completes —
      // before, taps during a run were silently swallowed and the buttons looked broken.
      b.onclick = async function () {
        if (pair[2] === "gui") setTimeout(function () { try { showTab("gui"); } catch (e) {} }, 1200);
        b.classList.add("running");
        try {
          if (pair[1] === "__wt4__") await runWinetest4();
          else await runCmd(pair[1]);
        } catch (e) {}
        b.classList.remove("running");
      };
      grid.appendChild(b);
    });
    runBtn.onclick = function () { runCmd(inp.value); inp.value = ""; };
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { runCmd(inp.value); inp.value = ""; } });

    var api = {
      termHost: termHost,
      panel: panel,
      runCmd: runCmd,
      guiHost: guiEl,
      onGuiOpen: null,
      setFs: function (f) { shareFs = f; },
      showGui: function () { showTab("gui"); },
      // True only when keys should go to the GUI: the GUI is the focused surface (desktop = always;
      // console = after you tap the GUI canvas) AND it's visible. Drives emulator.js key routing.
      isGuiActive: function () { return kbdTarget === "gui" && guiEl.style.display !== "none"; },
      setGuiStatus: setGuiStatus,
      setXterm: function (x) {
        xt = x;
        if (x) {
          out.textContent = "Connected. Type a command + Run, or tap a button. Tap 🖥️ GUI for the desktop, 📁 Files to browse the Linux files.";
          if (filesEl.style.display !== "none") loadFiles(curDir);
          try { inp.focus(); } catch (e) {}
        }
      }
    };

    // ---- apply the boot mode ----
    if (mode === "console" || mode === "desktop") {
      // Keep the 🐧 Console tab visible in console mode so you can always return to the command box +
      // quick buttons (incl. the Wine/GUI tests) after visiting the GUI or Files tab — before, it was
      // hidden and tapping GUI/Files stranded you with no way back. Only DESKTOP (no console pane) hides
      // both the Console and Files tabs.
      var cTab = panel.querySelector('.q64-tab[data-tab="console"]');
      var fTab = panel.querySelector('.q64-tab[data-tab="files"]');
      if (cTab && mode === "desktop") cTab.style.display = "none";
      if (fTab && mode === "desktop") fTab.style.display = "none";   // desktop = GUI-only surface
      panel.classList.add("gui-active");          // keep the pane wide
    }
    if (mode === "desktop") {
      termHost.style.display = "none";            // no console pane — the desktop fills the screen
      panel.classList.add("q64-desk");
    }
    // Focus-follows-tap: the on-screen keyboard goes where you last touched. Capture phase so the
    // noVNC canvas (added to guiEl after connect) and the xterm both count.
    termHost.addEventListener("pointerdown", function () { kbdTarget = "term"; }, true);
    guiEl.addEventListener("pointerdown", function () {
      kbdTarget = "gui";
      // Tap logger: every GUI tap records the RFB/socket state in the app console, so an
      // input-dead report comes with the connection state attached (build 66).
      try { console.log("[gui] tap rfb=" + (window.__guiState ? window.__guiState() : "?")); } catch (e) {}
    }, true);

    return api;
  }

  window.QEMU_PANEL = { make: make };
})();
