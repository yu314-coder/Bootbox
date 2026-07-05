/* ============================================================================
 * Bootbox firmware — two screens, like a real PC:
 *
 *   • Boot Menu  (renderMenu)  — the "select operating system" page you normally
 *     see: a boot manager that lists the installed systems (full Arch Linux,
 *     full Ubuntu, your imported ISOs, plus an instant live fallback). Pick one
 *     and boot. ↑↓/Enter or tap. GRUB / UEFI-boot-manager style.
 *
 *   • UEFI Setup (renderSetup) — the firmware setup you DON'T normally see: press
 *     a key / choose "Setup" to enter. Classic Aptio-blue, tabbed
 *     (Main / Advanced / Boot / Security / Save & Exit) with real firmware
 *     options. Most are functional (RAM, boot order, …); some are authentic
 *     theater (VT-x, Secure Boot) so it feels like entering a real BIOS.
 *
 * Everything is 32-bit i686. Heavy full distros download on first boot and are
 * honestly flagged as real-device / slow.
 * ========================================================================== */
(function () {
  // The bootable "systems" — REAL official distro ISOs (not lightweight spins),
  // all 32-bit. Each downloads its official ISO on first boot, then boots it.
  const SYSTEMS = [
    { id: "x64pw", name: "64-bit Linux + Python & Wine", sub: "REAL 64-bit Alpine · Python 3.12 + pip + Wine · terminal + graphical output · internet", icon: "🐍", tag: "64-BIT",
      guest: "x64pw", ram: 1536,
      note: "Real 64-bit x86_64 Alpine Linux via QEMU-Wasm — DUAL-CORE (nproc 2, cores 1–8 selectable) and now RUNS COOL: a tickless kernel + power-optimized engine keep it near-idle when you’re not working it (no more constant heat). 1.5 GB RAM. Python 3.12 + pip + Wine 9.0 (32 & 64-bit .exe) + REAL internet. Pre-installed tools: ncdu, htop, tree, nano, less, tmux, mc (all instant — no waiting on apk). `pip install numpy` auto-picks the compatible build; scipy/pandas/pillow wheels work. Terminal on the LEFT (scroll with a finger; arrow keys drive ncdu/mc/vi); GUI on the RIGHT stays OFF until you launch an X app and tap it. The 📁 Files tab manages guest files — tap ⬇ to save a file to the iPad, ⬆ to copy one in. Downloaded once (~260 MB)." },
    { id: "x64pwd", name: "64-bit Linux — Desktop", sub: "Lightweight x86_64 desktop · twm + taskbar · web browser · terminal · mc", icon: "🖥️", tag: "DESKTOP",
      guest: "x64pwd", ram: 1536,
      note: "A full-screen lightweight graphical desktop: window manager (twm) + a taskbar/clock (tint2) + a terminal + the mc (Midnight Commander) file manager. Python 3.12 with pip preloaded. WEB BROWSER: right-click the desktop → 'Web browser (links)' — a text-mode browser that fetches and renders real web pages (no images/JS). (Graphical browsers were tested and they freeze the emulated X server, so links is the one that works.) NO Wine (use the Python & Wine guest for that). Much lighter than the Wine guest: downloaded once on first use (~129 MB), then ~2 min first cold-boot." },
    { id: "arm64", name: "64-bit Linux — ARM64 (aarch64)", sub: "REAL 64-bit ARM Linux · DUAL-CORE · Alpine + Python · internet", icon: "💪", tag: "ARM64",
      guest: "arm64", ram: 1536,
      note: "A genuine 64-bit ARM (aarch64) Alpine Linux — a different CPU than the x86_64 guests (uname -m = aarch64, kernel 6.1), via a separate QEMU-Wasm engine. THE ONLY DUAL-CORE GUEST: 2 real emulated CPUs running in parallel (nproc = 2) — a busy program no longer freezes the other core, and two jobs really run at once. Python 3.12 + pip + real internet. NO Wine (Wine runs x86 Windows binaries — meaningless on ARM). Still software-emulated (Apple blocks the hypervisor on iOS), so per-core speed is like the x86_64 guest. Downloaded once on first use (~77 MB)." },
    { id: "win98", name: "Windows 98 SE", sub: "One-tap download + boot · ~89 MB", icon: "🪟", tag: "WIN",
      img: "vmres://iso/win98.img", kind: "hda", ram: 256, fixedRam: true,
      downloadName: "win98.img.gz", imgName: "win98.img", gz: true,
      downloadUrl: "https://github.com/yu314-coder/Bootbox/releases/download/windows-v1/win98.img.gz",
      note: "Windows 98 SE · one-tap download (~89 MB) + boot. Verified booting to the desktop in v86. Boots as a hard disk at 256 MB RAM (Win9x can't use much more). 640×480 standard VGA." },
    { id: "win2000", name: "Windows 2000 Pro", sub: "One-tap download + boot · has internet · ~340 MB", icon: "🪟", tag: "WIN",
      img: "vmres://iso/win2000.img", kind: "hda", ram: 512, fixedRam: true,
      downloadName: "win2000.img.gz", imgName: "win2000.img", gz: true,
      downloadUrl: "https://github.com/yu314-coder/Bootbox/releases/download/windows-v1/win2000.img.gz",
      note: "Windows 2000 SP4 · one-tap download (~340 MB) + boot. The only Windows here with WORKING INTERNET (NT NDIS NIC via the relay, where Win9x's driver hangs). Heavier/slower than Win98. 512 MB RAM · 640×480 VGA · auto-logon." },
  ];
  const SETUP_ROW = { id: "__setup__", kind: "setup", name: "UEFI Firmware Setup", sub: "Advanced configuration (normally hidden)",
    icon: "⚙️", tag: "SETUP", note: "Enter the firmware setup — boot order, memory, CPU, security." };

  const CFG = "/Apps/.bios.json";
  const readCfg = () => { try { return JSON.parse(VFS.read(CFG) || "{}"); } catch (e) { return {}; } };
  const writeCfg = (o) => { try { VFS.write(CFG, JSON.stringify(Object.assign(readCfg(), o))); } catch (e) {} };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // Bases of imported NAME.state.gz save-states — an import paired with one can
  // instant-resume the saved desktop instead of cold-booting.
  let snapshotBases = new Set();
  async function listImported() {
    try {
      const r = await Bridge.call("binary", "list", {});
      const arr = Array.isArray(r) ? r : (r && r.result) || [];
      snapshotBases = new Set(arr.filter(n => /\.state\.gz$/i.test(n)).map(n => n.replace(/\.state\.gz$/i, "")));
      return arr.filter(n => /\.(iso|img|bin)$/i.test(n));
    } catch (e) { snapshotBases = new Set(); return []; }
  }

  // Translate a chosen system + firmware config into emulator launch args.
  function systemToArgs(sys, cfg) {
    cfg = cfg || readCfg();
    // fixedRam (e.g. Win95, which can't boot with >512 MB) uses the entry's exact RAM
    // instead of inheriting a high global setting; others get a floor.
    const ram = sys.fixedRam ? (sys.ram || 256) : Math.max(cfg.ram || 0, sys.ram || 256);
    const args = { autoboot: true, ram: ram, bootOrder: cfg.bootOrder || "cd-hd" };
    if (cfg.cores) args.cores = cfg.cores;   // UEFI-setup "CPU Cores" (64-bit guests; 1 = battery saver)
    if (sys.guest) args.guest = sys.guest;
    else { args.guest = "custom"; args.customUrl = sys.img; args.customKind = sys.kind || "cdrom"; }
    return args;
  }

  /* ------------------------------------------------------------------ *
   *  Boot Menu — "select operating system"                              *
   * ------------------------------------------------------------------ */
  function renderMenu(container, hooks) {
    hooks = hooks || {};
    const cfg = readCfg();
    let entries = [];
    let sel = 0, timer = null, count = 0;

    function importRows(names) {
      return (names || []).map(n => {
        const disk = /\.(img|raw|qcow2|hdd|vdi)$/i.test(n);   // a disk image boots as a hard disk, not a CD
        const snap = snapshotBases.has(n);   // a paired NAME.state.gz save-state was imported alongside it
        return { id: "import:" + n, name: n,
          sub: snap ? "Imported disk · ⚡ instant resume from a saved snapshot"
                    : (disk ? "Imported disk image · boots as a hard disk" : "Imported image · boots from CD/ISO"),
          icon: disk ? "🖴" : "💿", tag: snap ? "RESUME" : "IMPORT",
          img: "vmres://iso/" + n, kind: disk ? "hda" : "cdrom",
          // Snapshots are captured at 1 GB; a paired-snapshot import must boot at that
          // exact RAM (v86 save-state restore requires the memory size to match).
          ram: snap ? 1024 : undefined, fixedRam: snap || undefined,
          note: snap ? "Imported disk + a paired save-state (" + n + ".state.gz): resumes the pre-booted desktop in ~1s — drivers, apps and network already up — at 1 GB RAM. Manage these in the Files app (Bootbox)."
                     : "Your imported image. Manage these in the Files app (Bootbox)." };
      });
    }
    function build(names) { return SYSTEMS.concat(importRows(names)).concat([SETUP_ROW]); }

    container.innerHTML = `
      <style>
        .bm{height:100%;display:flex;flex-direction:column;color:#cfe3ff;
          font-family:"Cascadia Mono",Consolas,monospace;
          background:radial-gradient(130% 90% at 50% -10%,#0d1b33,#05080f)}
        .bm-top{display:flex;align-items:center;gap:10px;padding:12px 22px;border-bottom:1px solid #15314f;color:#9cc4ee;font-size:13px}
        .bm-brand{display:inline-flex;align-items:center;gap:8px;font-weight:800;color:#eaf4ff;letter-spacing:.5px}
        .bm-glyph{display:grid;grid-template-columns:1fr 1fr;gap:2px;width:18px;height:18px}
        .bm-glyph i{background:#3ba0ff;border-radius:2px;box-shadow:0 0 6px #2f6bdb}
        .bm-right{margin-left:auto;opacity:.55}
        .bm-mid{flex:1;min-height:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:18px}
        .bm-box{width:min(720px,94%);background:rgba(8,18,32,.82);border:1px solid #1d3a59;border-radius:12px;
          display:flex;flex-direction:column;min-height:0;overflow:hidden;box-shadow:0 14px 50px #000a}
        .bm-boxhead{padding:11px 18px;background:linear-gradient(#102742,#0c1e35);color:#7fb6ff;font-weight:700;
          letter-spacing:1px;border-bottom:1px solid #1d3a59;font-size:13px}
        .bm-list{padding:8px;overflow-y:auto;min-height:0}
        .bm-row{display:flex;align-items:center;gap:14px;padding:12px 14px;border-radius:9px;cursor:pointer;
          border:1px solid transparent;transition:background .1s}
        .bm-row:hover{background:#0f1d31}
        .bm-row.sel{background:#10294a;border-color:#3ba0ff;box-shadow:0 0 0 1px #3ba0ff inset}
        .bm-row .ic{font-size:23px;width:28px;text-align:center}
        .bm-row .nm{display:flex;flex-direction:column;font-weight:700;color:#eaf4ff;font-size:15px}
        .bm-row .nm .sub{font-weight:400;opacity:.62;font-size:12px;margin-top:2px}
        .bm-row .tag{margin-left:auto;font-size:10px;font-weight:800;letter-spacing:.5px;padding:4px 9px;
          border-radius:5px;background:#13325a;color:#9fd0ff}
        .bm-row.setup{margin-top:4px;border-top:1px dashed #1d3a59;border-radius:0 0 9px 9px}
        .bm-row.setup .tag{background:#3a2c5a;color:#d8c2ff}
        .bm-note{width:min(720px,94%);color:#88a8cc;font-size:12px;min-height:32px;max-height:64px;overflow-y:auto;line-height:1.4;text-align:center}
        .bm-keys{color:#5f80a8;font-size:12px;letter-spacing:.3px}
        .bm-foot{display:flex;align-items:center;gap:12px;padding:12px 22px;border-top:1px solid #15314f;background:#070f1c}
        .bm-count{color:#ffce6b;font-size:13px}
        .bm-grow{flex:1}
        .bm-btn{background:#10243d;border:1px solid #1d4060;color:#cfe3ff;border-radius:8px;padding:9px 16px;
          cursor:pointer;font-family:inherit;font-weight:600;font-size:13px}
        .bm-btn:hover{background:#163150}
        .bm-btn.primary{background:#0067c0;border-color:#1f86e0;color:#fff;font-weight:800}
        .bm-btn.primary:hover{background:#0a76d8}
      </style>
      <div class="bm">
        <div class="bm-top">
          <span class="bm-brand"><span class="bm-glyph"><i></i><i></i><i></i><i></i></span>Bootbox UEFI</span>
          <span style="opacity:.7">Boot Manager</span>
          <span class="bm-right">x86 · i686 · 32-bit firmware</span>
        </div>
        <div class="bm-mid">
          <div class="bm-box">
            <div class="bm-boxhead">▸ Select operating system</div>
            <div class="bm-list" id="bm-list"></div>
          </div>
          <div class="bm-note" id="bm-note"></div>
          <div class="bm-keys">↑ ↓ highlight &nbsp;·&nbsp; ⏎ boot &nbsp;·&nbsp; S setup</div>
        </div>
        <div class="bm-foot">
          <span class="bm-count" id="bm-count"></span>
          <span class="bm-grow"></span>
          <button class="bm-btn" id="bm-diag" title="File-sync diagnostics">🔧 File Sync</button>
          <button class="bm-btn" id="bm-setup">⚙ UEFI Setup</button>
          <button class="bm-btn primary" id="bm-boot">Boot ▶</button>
        </div>
      </div>`;

    // --- File-sync diagnostics overlay (helps debug the Files-app "Syncing Paused") ---
    async function showDiag() {
      let text = "Loading…";
      try { const r = await Bridge.call("system", "fpdiag"); text = (r && (r.data || r)) || "(no data)"; }
      catch (e) { text = "diagnostics unavailable: " + ((e && e.message) || e); }
      const ov = document.createElement("div");
      ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(2,6,14,.92);display:flex;flex-direction:column;padding:18px;font-family:Consolas,monospace";
      ov.innerHTML =
        '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px">' +
          '<b style="color:#8fc2ff;font-size:15px;flex:1">🔧 File-Sync Diagnostics</b>' +
          '<button id="dg-reset" class="bm-btn">Reset sync location</button>' +
          '<button id="dg-close" class="bm-btn primary">Close</button></div>' +
        '<pre id="dg-pre" style="flex:1;overflow:auto;white-space:pre-wrap;color:#bfe0ff;background:#060d18;border:1px solid #1d3a59;border-radius:8px;padding:12px;font-size:12px;margin:0"></pre>';
      document.body.appendChild(ov);
      ov.querySelector("#dg-pre").textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
      ov.querySelector("#dg-close").onclick = () => ov.remove();
      ov.querySelector("#dg-reset").onclick = async () => {
        try { await Bridge.call("system", "fpreset"); ov.querySelector("#dg-pre").textContent = "Reset requested — reopen the Files app in ~10s, then reopen this to re-check."; }
        catch (e) { ov.querySelector("#dg-pre").textContent = "reset failed: " + ((e && e.message) || e); }
      };
    }

    const listEl = container.querySelector("#bm-list");
    const noteEl = container.querySelector("#bm-note");
    const countEl = container.querySelector("#bm-count");
    const alive = () => !!container.querySelector("#bm-list");

    function paint() {
      listEl.innerHTML = "";
      entries.forEach((e, i) => {
        const row = document.createElement("div");
        row.className = "bm-row" + (i === sel ? " sel" : "") + (e.kind === "setup" ? " setup" : "");
        row.innerHTML = `<span class="ic">${e.icon || "💿"}</span>
          <span class="nm">${e.name}<span class="sub">${e.sub || ""}</span></span>
          <span class="tag">${e.tag || "32-BIT"}</span>`;
        row.onclick = () => { cancelAuto(); sel = i; paint(); };
        row.ondblclick = () => { cancelAuto(); sel = i; go(); };
        listEl.appendChild(row);
      });
      noteEl.textContent = (entries[sel] || {}).note || "";
    }

    function go() {
      const e = entries[sel];
      if (!e) return;
      if (e.kind === "setup") return hooks.onSetup && hooks.onSetup();
      bootEntry(e);
    }

    const fmtMB = b => (b / 1048576).toFixed(0);
    function showProgress(received, total, verb) {
      const pct = total > 0 ? Math.min(100, Math.floor(received / total * 100)) : 0;
      noteEl.innerHTML =
        `${verb || "Downloading"}… <b style="color:#9fd0ff">${pct}%</b> &nbsp; ${fmtMB(received)} / ${total > 0 ? fmtMB(total) : "?"} MB` +
        `<div style="height:6px;background:#0c1a2e;border:1px solid #1d3a59;border-radius:4px;margin-top:6px;overflow:hidden">` +
        `<div style="height:100%;width:${pct}%;background:linear-gradient(90deg,#0067c0,#3ba0ff);transition:width .2s"></div></div>`;
    }

    // Kick off a host download and resolve when it finishes, streaming progress
    // to onProgress. Avoids the 4s Bridge.call timeout: the host replies
    // immediately with {started}/{cached}, and completion arrives as an event.
    function downloadWithProgress(url, name, onProgress) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (thunk) => {
          if (settled) return; settled = true;
          if (Bridge.offEvent) Bridge.offEvent("downloadProgress", handler);
          thunk();
        };
        function handler(p) {
          if (!p || p.name !== name) return;
          if (p.done) finish(p.ok === false ? () => reject(new Error(p.error || "download failed")) : resolve);
          else if (typeof p.received === "number") onProgress(p.received, p.total || 0);
        }
        Bridge.onEvent("downloadProgress", handler);
        Bridge.call("binary", "download", { url, name })
          .then(r => { if (r && r.cached) finish(resolve); })
          .catch(err => finish(() => reject(err)));
      });
    }

    // Expand a downloaded `.img.gz` into a raw `.img` on the host, streaming
    // progress. Same event-driven shape as downloadWithProgress — the native
    // gunzip is multi-GB and runs past the Bridge.call reply timeout.
    function gunzipWithProgress(src, dst, onProgress) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (thunk) => {
          if (settled) return; settled = true;
          if (Bridge.offEvent) Bridge.offEvent("gunzipProgress", handler);
          thunk();
        };
        function handler(p) {
          if (!p || p.name !== dst) return;
          if (p.done) finish(p.ok === false ? () => reject(new Error(p.error || "decompress failed")) : resolve);
          else if (typeof p.received === "number") onProgress(p.received, p.total || 0);
        }
        Bridge.onEvent("gunzipProgress", handler);
        Bridge.call("binary", "gunzip", { src, dst })
          .then(r => { if (r && r.cached) finish(resolve); })
          .catch(err => finish(() => reject(err)));
      });
    }

    async function bootEntry(e) {
      cancelAuto();
      writeCfg({ lastBoot: e.id });
      // Windows (and other bring-your-own-image) entries: can't be bundled/hosted, so
      // require the user to import their own disk image first.
      if (e.requiresImport) {
        const have = await listImported();
        if (!have.includes(e.importName)) {
          noteEl.innerHTML = "<b style='color:#ffd479'>Import your own disk image first.</b><br>" +
            (e.note || "") + "<br>Expected file name: <b>" + e.importName + "</b>  (add it via the Files app → Bootbox, or drag it onto the app).";
          return;
        }
      }
      if (e.downloadUrl && e.downloadName) {
        const have = await listImported();
        const finalName = e.gz ? e.imgName : e.downloadName;   // what the VM actually boots
        // 1) fetch the archive (unless we already have it or the expanded image)
        if (!have.includes(finalName) && !have.includes(e.downloadName)) {
          const what = e.gz ? "image" : "ISO";
          noteEl.textContent = "Fetching the " + e.name + " " + what + " — first boot only…";
          try { await downloadWithProgress(e.downloadUrl, e.downloadName, showProgress); }
          catch (err) { noteEl.textContent = "Download failed: " + ((err && err.message) || err) + " — check your network, or import the image yourself."; return; }
        }
        // 2) decompress the archive into the raw image (gz entries only)
        if (e.gz && !have.includes(finalName)) {
          noteEl.textContent = "Decompressing " + e.name + " — first boot only. Keep Bootbox open; don't switch apps until it's Ready…";
          try { await gunzipWithProgress(e.downloadName, finalName, (r, t) => showProgress(r, t, "Decompressing")); }
          catch (err) { noteEl.textContent = "Decompress failed: " + ((err && err.message) || err); return; }
        }
        noteEl.textContent = "Ready — starting " + e.name + " …";
      }
      hooks.onBoot && hooks.onBoot(systemToArgs(e, readCfg()));
    }

    // GRUB-style auto-boot countdown — armed ONLY when the instant live system is
    // the default selection, so an unattended device never kicks off a huge
    // distro download. Any key/tap cancels it.
    function startAuto() {
      const e = entries[sel];
      if (!e || !e.instant) return;
      count = 12;
      const tick = () => {
        if (!alive()) return cancelAuto();
        countEl.textContent = "Auto-boot " + e.name + " in " + count + "s — press any key to stop";
        if (count <= 0) { bootEntry(e); return; }
        count--;
      };
      tick(); timer = setInterval(tick, 1000);
    }
    function cancelAuto() { if (timer) { clearInterval(timer); timer = null; } if (countEl) countEl.textContent = ""; }

    function onKey(e) {
      if (!alive()) { window.removeEventListener("keydown", onKey); return; }
      const k = e.key;
      if (k === "ArrowDown") { cancelAuto(); sel = Math.min(entries.length - 1, sel + 1); paint(); e.preventDefault(); }
      else if (k === "ArrowUp") { cancelAuto(); sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
      else if (k === "Enter") { go(); e.preventDefault(); }
      else if (k && k.toLowerCase() === "s") { cancelAuto(); hooks.onSetup && hooks.onSetup(); }
      else { cancelAuto(); }
    }
    window.addEventListener("keydown", onKey);

    container.querySelector("#bm-boot").onclick = () => { cancelAuto(); go(); };
    container.querySelector("#bm-setup").onclick = () => { cancelAuto(); hooks.onSetup && hooks.onSetup(); };
    container.querySelector("#bm-diag").onclick = () => { cancelAuto(); showDiag(); };

    // Initial paint (no imports yet), then enrich with imported ISOs.
    entries = build([]);
    const li = cfg.lastBoot ? entries.findIndex(e => e.id === cfg.lastBoot) : -1;
    sel = li >= 0 ? li : Math.max(0, entries.findIndex(e => e.instant)); // default → instant live
    paint(); startAuto();
    listImported().then(names => {
      if (!alive()) return;
      entries = build(names);
      const i = cfg.lastBoot ? entries.findIndex(e => e.id === cfg.lastBoot) : -1;
      if (i >= 0) sel = i;
      paint();
    });
  }

  /* ------------------------------------------------------------------ *
   *  UEFI Setup — the firmware setup you don't normally see             *
   * ------------------------------------------------------------------ */
  function renderSetup(container, hooks) {
    hooks = hooks || {};
    const DEF = { ram: 256, cores: 2, bootOrder: "cd-hd", vtx: true, htt: false, secureBoot: false,
      bootMode: "UEFI", fastBoot: true, sataMode: "AHCI", usbLegacy: true, numlock: true, memRemap: false,
      netInternet: true, resumeState: true, nx: true, tpm: false, txt: false, bgRun: "Keep running" };
    let s = Object.assign({}, DEF, readCfg());
    // Reflect the emulator's actual internet + resume state (it stores these in its own config).
    try { const ec = JSON.parse(VFS.read("/Apps/.emulator.json") || "{}"); s.netInternet = (ec.netRelay !== "off"); s.resumeState = (ec.resumeState !== false); } catch (e) {}
    // Reflect the real background-grace setting (lives in native UserDefaults, not the JS config).
    const BG_SEC = { "Keep running": 86400, "10 min": 600, "1 min": 60, "Off": 0 };
    try { if (window.Bridge) Bridge.call("system", "getBackgroundGrace").then(function (g) {
      var sec = (typeof g === "number") ? g : (g && g.result); var lbl = "Keep running";
      Object.keys(BG_SEC).forEach(function (k) { if (BG_SEC[k] === sec) lbl = k; });
      if (sec != null) { s.bgRun = lbl; if (typeof paint === "function") paint(); }
    }).catch(function () {}); } catch (e) {}
    let tab = 0, foc = 0;
    const TABS = ["Main", "Advanced", "Boot", "Security", "Save & Exit"];
    const now = new Date(), pad = n => String(n).padStart(2, "0");
    const dateStr = pad(now.getMonth() + 1) + "/" + pad(now.getDate()) + "/" + now.getFullYear();
    const timeStr = pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());
    const bootLabel = { "cd-hd": "CD/DVD → Hard Disk", "hd-cd": "Hard Disk → CD/DVD", "cd": "CD/DVD only" };

    function fields() {
      if (tab === 0) return [
        { t: "info", label: "BIOS Vendor", value: "Bootbox" },
        { t: "info", label: "Core Version", value: "UEFI 2.70 (Bootbox 0.2)" },
        { t: "info", label: "Build Date", value: "06/2026" },
        { t: "sep", label: "Processor Information" },
        { t: "info", label: "CPU Type", value: "Virtual x86 Family 6 (i686)" },
        { t: "info", label: "Translation", value: "WASM → native ARM (JIT)" },
        { t: "info", label: "Active Cores", value: String(s.cores || 2) + " (64-bit Linux)" },
        { t: "info", label: "Instruction Set", value: "x87 FPU · MMX · SSE · SSE2" },
        { t: "sep", label: "Memory Information" },
        { t: "info", label: "Total Memory", value: s.ram + " MB" },
        { t: "info", label: "Memory Type", value: "Emulated DRAM" },
        { t: "sep", label: "System" },
        { t: "info", label: "System Date", value: dateStr },
        { t: "info", label: "System Time", value: timeStr },
      ];
      if (tab === 1) return [
        { t: "sep", label: "CPU Configuration" },
        { t: "stepper", label: "CPU Cores (64-bit Linux)", key: "cores", min: 1, max: 8, step: 1, unit: "",
          help: "Functional for the 64-bit x86 Linux guests. 2 (default) = real dual-core — two jobs run in parallel and a busy program doesn't freeze the shell. Up to 4 verified (idle power stays flat), but beyond 2 the speedup depends on the workload (disk-heavy jobs serialize). 1 = simplest. The 32-bit systems are always single-core." },
        { t: "toggle", label: "Hyper-Threading", key: "htt", help: "Theater on a single-core virtual CPU — has no effect." },
        { t: "toggle", label: "Intel® VT-x", key: "vtx", help: "Expose the hardware-virtualization flag to the guest. Cosmetic here." },
        { t: "info", label: "SSE2 Extensions", value: "Supported" },
        { t: "toggle", label: "Execute Disable Bit", key: "nx", help: "Theater: the NX/DEP flag exposed to the guest. v86 does not enforce it." },
        { t: "sep", label: "Memory Configuration" },
        { t: "stepper", label: "Installed RAM", key: "ram", min: 64, max: 3584, step: 128, unit: " MB",
          help: "RAM assigned to the VM (remembered across boots). Up to ~3.5 GB (the 32-bit ceiling). The desktops also use a swap file, so they won't run out of memory at lower settings — but more RAM is faster. Very high values can exceed what the device can allocate; if the VM fails to start, lower it." },
        { t: "toggle", label: "Memory Remap Above 4G", key: "memRemap", help: "No effect in 32-bit mode." },
        { t: "sep", label: "Storage Configuration" },
        { t: "select", label: "SATA Mode", key: "sataMode", opts: ["AHCI", "IDE"], help: "Disk-controller mode presented to the guest." },
        { t: "toggle", label: "USB Legacy Support", key: "usbLegacy", help: "Enable USB keyboard/mouse during early boot." },
        { t: "sep", label: "Network Configuration" },
        { t: "toggle", label: "Guest Internet", key: "netInternet", help: "Functional. Bridges the guest's NIC to the WebSocket relay so it reaches the real internet (the guest still needs its own DHCP client). Turn off for a fully offline VM." },
        { t: "sep", label: "Power & Background" },
        { t: "select", label: "Run in Background", key: "bgRun", opts: ["Keep running", "10 min", "1 min", "Off"],
          help: "Functional. Keeps the guest COMPUTING after you switch to another app, so long jobs (builds, downloads, pip, compute) finish in the background instead of freezing. 'Keep running' = never suspend — best for background work; idle is cheap now (tickless kernel), but sustained load will drain the battery. '10 min' / '1 min' = hold that long, then let iOS suspend to save power. 'Off' = suspend immediately on switch-away." },
      ];
      if (tab === 2) return [
        { t: "select", label: "Boot Mode", key: "bootMode", opts: ["UEFI", "Legacy"], help: "Firmware boot mode. Legacy = CSM/BIOS compatibility." },
        { t: "toggle", label: "Fast Boot", key: "fastBoot", help: "Skip some device tests for a quicker boot." },
        { t: "sep", label: "Boot Option Priorities" },
        { t: "select", label: "Boot Order", key: "bootOrder", opts: ["cd-hd", "hd-cd", "cd"], render: v => bootLabel[v],
          help: "Order in which the firmware tries boot devices. Functional." },
        { t: "toggle", label: "NumLock", key: "numlock", help: "Initial NumLock state on boot." },
        { t: "sep", label: "Saved State" },
        { t: "toggle", label: "Resume Saved State", key: "resumeState", help: "Functional. On: a guest with a saved snapshot (⚡ RESUME in the boot menu) restores instantly to where you left off. Off: always cold-boot fresh, ignoring any saved state." },
      ];
      if (tab === 3) return [
        { t: "toggle", label: "Secure Boot", key: "secureBoot", help: "Theater: Bootbox does not enforce a signed bootloader chain." },
        { t: "info", label: "Secure Boot Mode", value: "Setup" },
        { t: "info", label: "TPM Device", value: "Not Present (emulated)" },
        { t: "action", label: "Administrator Password", value: "Not Set", act: "pw", help: "Firmware passwords are not implemented in Bootbox." },
        { t: "toggle", label: "TPM Security Device", key: "tpm", help: "Theater: no TPM is emulated (Total Memory Encryption / attestation unavailable)." },
        { t: "toggle", label: "Intel® TXT", key: "txt", help: "Theater: Trusted Execution Technology — not implemented." },
      ];
      // Save & Exit  (+ UEFI-style "Boot Override" straight into a system)
      const ov = SYSTEMS.filter(x => !x.instant).map(x =>
        ({ t: "action", label: "Boot Override: " + x.name, act: "boot:" + x.id, help: x.note || "Boot this system now." }));
      return [
        { t: "action", label: "Save Changes and Reset", act: "save", help: "Persist firmware settings and return to the boot menu." },
        { t: "action", label: "Discard Changes and Exit", act: "discard", help: "Return to the boot menu without saving." },
        { t: "action", label: "Load Optimized Defaults", act: "defaults", help: "Reset every firmware setting to its default." },
        { t: "sep", label: "Boot Override" },
        ...ov,
      ];
    }

    container.innerHTML = `
      <style>
        .uefi{height:100%;display:flex;flex-direction:column;background:#0a1f6b;color:#cfe0ff;
          font-family:"Cascadia Mono",Consolas,monospace;font-size:14px}
        .u-title{text-align:center;padding:7px;background:#08185a;color:#fff;font-weight:700;letter-spacing:1.5px;
          border-bottom:1px solid #2a4fc0}
        .u-tabs{display:flex;background:#0c2580;border-bottom:2px solid #2a4fc0;flex-wrap:wrap}
        .u-tab{padding:8px 18px;cursor:pointer;color:#a8c0ff;border-right:1px solid #1b3a9e;font-weight:600}
        .u-tab.on{background:#cfe0ff;color:#0a1f6b;font-weight:800}
        .u-body{flex:1;display:flex;overflow:hidden;min-height:0}
        .u-panel{flex:1;overflow:auto;padding:12px 16px}
        .u-help{width:34%;min-width:210px;border-left:2px solid #2a4fc0;padding:14px 16px;background:#0c2178;
          color:#bcd0ff;font-size:13px;line-height:1.55}
        .u-help b{color:#ffd24a;display:block;margin-bottom:6px;letter-spacing:.5px}
        .u-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:4px}
        .u-row .lab{flex:1;color:#dce8ff}
        .u-row .val{color:#ffd24a;min-width:150px;text-align:right;cursor:pointer}
        .u-row.info .val{cursor:default;color:#9fb8ff}
        .u-row.foc{background:#1b3a9e}
        .u-row.actionrow{cursor:pointer;color:#fff;font-weight:600}
        .u-row.actionrow.foc{background:#2a4fc0}
        .u-row.actionrow .val{color:#bcd0ff;font-weight:400}
        .u-sep{margin:12px 0 4px;color:#9fb8ff;border-bottom:1px solid #2a4fc0;padding:0 0 3px;font-weight:700;letter-spacing:.5px}
        .u-step{display:inline-flex;align-items:center;gap:6px}
        .u-stepb{background:#1b3a9e;border:1px solid #2a4fc0;color:#fff;width:24px;height:24px;border-radius:4px;cursor:pointer;font-weight:700}
        .u-stepb:hover{background:#2a4fc0}
        .u-legend{padding:7px 14px;background:#08185a;border-top:1px solid #2a4fc0;color:#a8c0ff;font-size:12px;text-align:center}
      </style>
      <div class="uefi">
        <div class="u-title">Bootbox Setup Utility — UEFI Firmware</div>
        <div class="u-tabs" id="u-tabs"></div>
        <div class="u-body">
          <div class="u-panel" id="u-panel"></div>
          <div class="u-help" id="u-help"></div>
        </div>
        <div class="u-legend">←/→ Select Tab &nbsp; ↑/↓ Select Item &nbsp; Enter Change &nbsp; F9 Defaults &nbsp; F10 Save &amp; Exit &nbsp; Esc Exit</div>
      </div>`;

    const tabsEl = container.querySelector("#u-tabs");
    const panelEl = container.querySelector("#u-panel");
    const helpEl = container.querySelector("#u-help");
    const alive = () => !!container.querySelector("#u-panel");

    function valText(f) {
      if (f.t === "toggle") return "‹ " + (s[f.key] ? "Enabled" : "Disabled") + " ›";
      if (f.t === "select") { const v = String(s[f.key]); return "‹ " + (f.render ? f.render(v) : v) + " ›"; }
      if (f.t === "stepper") return s[f.key] + (f.unit || "");
      return f.value || "";
    }
    function setHelp(f) {
      helpEl.innerHTML = f && f.help
        ? "<b>" + f.label + "</b>" + f.help
        : "<b>Item Help</b>Use ↑/↓ to pick a setting and Enter to change it. ←/→ switch tabs. Highlighted values in yellow are editable.";
    }

    function paint() {
      tabsEl.innerHTML = "";
      TABS.forEach((t, i) => {
        const b = document.createElement("div");
        b.className = "u-tab" + (i === tab ? " on" : "");
        b.textContent = t;
        b.onclick = () => { tab = i; foc = 0; paint(); };
        tabsEl.appendChild(b);
      });

      const fs = fields();
      const focusable = fs.map((f, i) => (f.t !== "sep" && f.t !== "info" ? i : -1)).filter(i => i >= 0);
      if (foc >= focusable.length) foc = Math.max(0, focusable.length - 1);
      const focIdx = focusable[foc];

      panelEl.innerHTML = "";
      fs.forEach((f, i) => {
        if (f.t === "sep") {
          const d = document.createElement("div"); d.className = "u-sep"; d.textContent = "► " + f.label;
          panelEl.appendChild(d); return;
        }
        const row = document.createElement("div");
        const isAction = f.t === "action";
        row.className = "u-row " + (isAction ? "actionrow" : f.t) + (i === focIdx ? " foc" : "");
        if (f.t === "stepper") {
          row.innerHTML = `<span class="lab">${f.label}</span>
            <span class="u-step"><button class="u-stepb" data-d="-1">−</button>
            <span class="val" style="min-width:90px">${valText(f)}</span>
            <button class="u-stepb" data-d="1">+</button></span>`;
          row.querySelectorAll(".u-stepb").forEach(b => b.onclick = (ev) => {
            ev.stopPropagation(); s[f.key] = clamp(s[f.key] + (+b.dataset.d) * f.step, f.min, f.max); setHelp(f); paint();
          });
        } else {
          row.innerHTML = `<span class="lab">${f.label}</span><span class="val">${valText(f)}</span>`;
        }
        row.onmouseenter = () => setHelp(f);
        row.onclick = () => { foc = Math.max(0, focusable.indexOf(i)); activate(f); };
        panelEl.appendChild(row);
      });
      setHelp(fs[focIdx]);
    }

    function activate(f) {
      if (!f) return;
      setHelp(f);
      if (f.t === "toggle") { s[f.key] = !s[f.key]; paint(); }
      else if (f.t === "select") { const i = f.opts.indexOf(String(s[f.key])); s[f.key] = f.opts[(i + 1) % f.opts.length]; paint(); }
      else if (f.t === "stepper") { s[f.key] = clamp(s[f.key] + f.step, f.min, f.max); paint(); }
      else if (f.t === "action") doAction(f.act);
    }

    function persist() {
      writeCfg({ ram: s.ram, bootOrder: s.bootOrder, vtx: s.vtx, htt: s.htt, secureBoot: s.secureBoot,
        bootMode: s.bootMode, fastBoot: s.fastBoot, sataMode: s.sataMode, usbLegacy: s.usbLegacy,
        numlock: s.numlock, memRemap: s.memRemap, netInternet: s.netInternet,
        resumeState: s.resumeState, nx: s.nx, tpm: s.tpm, txt: s.txt, bgRun: s.bgRun });
      // Apply the background-execution choice to the native keep-alive (UserDefaults + re-arm).
      try { if (window.Bridge && BG_SEC[s.bgRun] != null) Bridge.call("system", "setBackgroundGrace", { seconds: BG_SEC[s.bgRun] }); } catch (e) {}
      // Mirror the internet + resume toggles into the emulator's own config (it reads
      // netRelay + resumeState there), preserving a custom wss:// relay URL if one was set.
      try {
        const ec = JSON.parse(VFS.read("/Apps/.emulator.json") || "{}");
        if (s.netInternet) { if (ec.netRelay === "off") delete ec.netRelay; }
        else ec.netRelay = "off";
        ec.resumeState = s.resumeState;
        VFS.write("/Apps/.emulator.json", JSON.stringify(ec));
      } catch (e) {}
    }
    function doAction(act) {
      if (act === "save") { persist(); hooks.onBack && hooks.onBack(); }
      else if (act === "discard") { hooks.onBack && hooks.onBack(); }
      else if (act === "defaults") { s = Object.assign({}, DEF); foc = 0; paint(); }
      else if (act === "pw") { setHelp({ label: "Administrator Password", help: "Not implemented in Bootbox — there is no firmware to protect." }); }
      else if (act && act.indexOf("boot:") === 0) {
        const sys = SYSTEMS.find(x => x.id === act.slice(5));
        if (sys) { persist(); hooks.onBoot && hooks.onBoot(systemToArgs(sys, s)); }
      }
    }

    function onKey(e) {
      if (!alive()) { window.removeEventListener("keydown", onKey); return; }
      const fs = fields();
      const focusable = fs.map((f, i) => (f.t !== "sep" && f.t !== "info" ? i : -1)).filter(i => i >= 0);
      const k = e.key;
      if (k === "ArrowRight") { tab = (tab + 1) % TABS.length; foc = 0; paint(); e.preventDefault(); }
      else if (k === "ArrowLeft") { tab = (tab + TABS.length - 1) % TABS.length; foc = 0; paint(); e.preventDefault(); }
      else if (k === "ArrowDown") { foc = Math.min(focusable.length - 1, foc + 1); paint(); e.preventDefault(); }
      else if (k === "ArrowUp") { foc = Math.max(0, foc - 1); paint(); e.preventDefault(); }
      else if (k === "Enter") { activate(fs[focusable[foc]]); e.preventDefault(); }
      else if (k === "Escape") { hooks.onBack && hooks.onBack(); }
      else if (k === "F10") { doAction("save"); e.preventDefault(); }
      else if (k === "F9") { doAction("defaults"); e.preventDefault(); }
    }
    window.addEventListener("keydown", onKey);

    paint();
  }

  window.BiosMenu = { renderMenu, renderSetup };
})();
