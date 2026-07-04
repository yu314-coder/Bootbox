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
      ".q64-qb{height:32px;border-radius:6px;border:1px solid #2a3550;background:#172033;color:#cdd6e6;font:600 11px/1 'Cascadia Mono',monospace;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 6px}" +
      ".q64-qb:active{background:#22304d}" +
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
  var QUICK = [
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
      '<div class="q64-fbar"><button class="q64-fbtn q64-fup" title="Up">‹</button><div class="q64-fpath">/</div><button class="q64-fbtn q64-fref" title="Refresh">⟳</button></div>' +
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

    function showTab(which) {
      consoleEl.style.display = which === "console" ? "flex" : "none";
      guiEl.style.display = which === "gui" ? "block" : "none";
      filesEl.style.display = which === "files" ? "flex" : "none";
      panel.classList.toggle("gui-active", which === "gui" || which === "files");   // widen the pane for gui + files
      Array.prototype.forEach.call(tabBtns, function (t) { t.classList.toggle("on", t.getAttribute("data-tab") === which); });
      if (which === "gui" && typeof api.onGuiOpen === "function") { try { api.onGuiOpen(guiEl); } catch (e) { setGuiStatus("GUI error: " + (e && e.message)); } }
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
    function readBuf() {
      if (!xt) return "";
      try {
        var b = xt.buffer.active, s = "", i, ln;
        for (i = 0; i < b.length; i++) { ln = b.getLine(i); if (ln) s += ln.translateToString(true) + "\n"; }
        return s;
      } catch (e) { return ""; }
    }
    function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function show(cmd, body) { out.innerHTML = '<span class="cmd">$ ' + esc(cmd) + "</span>\n" + esc(body); out.scrollTop = 0; }

    // Run a command in the guest pty and resolve its output (between markers). Serialized via `busy`
    // so the Console, Files browser and key input never interleave on the shared pty.
    function scrape(cmd, timeoutMs) {
      return new Promise(function (resolve) {
        if (!xt) return resolve(null);
        if (busy) return resolve("__BUSY__");
        busy = true;
        var n = ++markN, B = SESS + "B" + n, E = SESS + "E" + n;
        var line = "printf '" + B + "\\n'; " + cmd + " 2>&1; printf '" + E + "\\n'\r";
        try { (xt.paste || xt.input).call(xt, line); } catch (e) { busy = false; return resolve(null); }
        var t0 = Date.now(), to = timeoutMs || 30000;
        (function poll() {
          var buf = readBuf();
          var bi = buf.lastIndexOf(B + "\n"), ei = buf.lastIndexOf(E + "\n");
          if (bi >= 0 && ei > bi) {
            var res = buf.slice(bi + (B + "\n").length, ei)
              .split("\n").filter(function (l) { return l.indexOf(SESS) < 0; })
              .join("\n").replace(/\s+$/, "");
            busy = false; return resolve(res);
          }
          if (Date.now() - t0 > to) { busy = false; return resolve("(timed out — the guest may be slow; try again)"); }
          setTimeout(poll, 250);
        })();
      });
    }

    async function runCmd(cmd) {
      cmd = (cmd || "").trim();
      if (!cmd) return;
      if (!xt) { show(cmd, "Terminal not ready yet — wait for the # prompt."); return; }
      show(cmd, "…running…");
      var res = await scrape(cmd, 90000);
      if (res === "__BUSY__") { show(cmd, "Busy with another command — try again in a moment."); return; }
      show(cmd, res == null ? "Terminal not ready." : (res || "(no output)"));
    }

    /* ---- Files browser: iOS-Files-style view of the live guest filesystem ---- */
    var curDir = "/";
    function joinPath(dir, name) { return (dir === "/" ? "" : dir.replace(/\/$/, "")) + "/" + name; }
    function parentOf(dir) { if (dir === "/" || dir === "") return "/"; var p = dir.replace(/\/$/, "").replace(/\/[^/]*$/, ""); return p === "" ? "/" : p; }
    function fmsg(t) { flist.innerHTML = '<div class="q64-fmsg">' + esc(t) + "</div>"; }

    async function loadFiles(dir) {
      if (!xt) { fmsg("Open after the guest boots (wait for the # prompt)."); return; }
      dir = dir || "/";
      curDir = dir;
      fpath.textContent = dir;
      fupBtn.disabled = (dir === "/");
      fmsg("Loading " + dir + " …");
      // -A: dotfiles too (no . / ..). -p: trailing / on dirs. -1: one per line. Quote the path.
      var qd = "'" + dir.replace(/'/g, "'\\''") + "'";
      var res = await scrape("ls -Ap1 " + qd + " 2>&1", 40000);
      if (res === "__BUSY__") { fmsg("Busy — tap ⟳ to retry."); return; }
      if (res == null) { fmsg("Terminal not ready."); return; }
      if (curDir !== dir) return;   // user navigated again while we waited
      var lines = res.split("\n").map(function (s) { return s.replace(/\r/g, ""); }).filter(function (s) { return s.length; });
      if (lines.length === 1 && /No such file|not found|Permission denied|cannot/i.test(lines[0])) { fmsg(lines[0]); return; }
      var dirs = [], files = [];
      lines.forEach(function (l) {
        if (/^(ls:|total )/.test(l)) return;
        if (l.charAt(l.length - 1) === "/") dirs.push(l.slice(0, -1));
        else files.push(l);
      });
      dirs.sort(); files.sort();
      var html = "";
      dirs.forEach(function (d) { html += row("📁", d, "", true); });
      files.forEach(function (f) {
        var ic = "📄"; if (/\.(png|jpg|jpeg|gif|bmp|svg|ico)$/i.test(f)) ic = "🖼️";
        else if (/\.(sh|py|js|c|cpp|go|rs|rb|pl|conf|cfg|ini|json|yaml|yml|txt|md|log)$/i.test(f)) ic = "📄";
        else if (/\.(gz|zip|tar|xz|bz2|7z)$/i.test(f)) ic = "🗜️";
        else if (f.indexOf(".") < 0) ic = "⚙️";
        html += row(ic, f, "", false);
      });
      if (!html) html = '<div class="q64-fmsg">Empty folder.</div>';
      flist.innerHTML = html;
      Array.prototype.forEach.call(flist.querySelectorAll(".q64-frow"), function (r) {
        r.onclick = function () {
          var nm = r.getAttribute("data-nm"), isd = r.getAttribute("data-d") === "1";
          if (isd) loadFiles(joinPath(dir, nm)); else openFile(joinPath(dir, nm), nm);
        };
      });
      flist.scrollTop = 0;
    }
    function row(icon, name, size, isDir) {
      return '<div class="q64-frow" data-nm="' + esc(name).replace(/"/g, "&quot;") + '" data-d="' + (isDir ? "1" : "0") + '">' +
        '<span class="q64-fic">' + icon + "</span>" +
        '<span class="q64-fnm">' + esc(name) + "</span>" +
        (isDir ? '<span class="q64-fch">›</span>' : '<span class="q64-fsz">' + esc(size) + "</span>") +
        "</div>";
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
    fupBtn.onclick = function () { if (curDir !== "/") loadFiles(parentOf(curDir)); };
    frefBtn.onclick = function () { loadFiles(curDir); };
    fcloseBtn.onclick = function () { fview.style.display = "none"; };

    QUICK.forEach(function (pair) {
      var b = document.createElement("button");
      b.className = "q64-qb"; b.textContent = pair[0]; b.title = pair[1];
      b.onclick = function () { runCmd(pair[1]); };
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
      // Right pane is GUI-only: hide the Console + Files tabs (the LEFT terminal is the console).
      var cTab = panel.querySelector('.q64-tab[data-tab="console"]');
      var fTab = panel.querySelector('.q64-tab[data-tab="files"]');
      if (cTab) cTab.style.display = "none";
      if (fTab) fTab.style.display = "none";
      panel.classList.add("gui-active");          // GUI is the only surface — keep the pane wide
    }
    if (mode === "desktop") {
      termHost.style.display = "none";            // no console pane — the desktop fills the screen
      panel.classList.add("q64-desk");
    }
    // Focus-follows-tap: the on-screen keyboard goes where you last touched. Capture phase so the
    // noVNC canvas (added to guiEl after connect) and the xterm both count.
    termHost.addEventListener("pointerdown", function () { kbdTarget = "term"; }, true);
    guiEl.addEventListener("pointerdown", function () { kbdTarget = "gui"; }, true);

    return api;
  }

  window.QEMU_PANEL = { make: make };
})();
