/* ============================================================================
 * Bootbox firmware — two screens, like a real PC:
 *
 *   • Boot Manager (renderMenu) — the "select operating system" page you normally
 *     see: the systems (Linux Desktop / Terminal, Android, the one-tap Windows
 *     images) and your own imported images, each with what it is, whether it is
 *     downloaded and how much space it takes. Pick one and boot. ↑↓/Enter or tap.
 *
 *   • UEFI Setup (renderSetup) — the firmware setup you DON'T normally see: tabbed
 *     (Main / Advanced / Boot / Security / Storage / Tools / Save & Exit). The
 *     functional settings come first; options that are only there for the
 *     real-firmware feel are marked "cosmetic". Storage lists and deletes what
 *     Bootbox keeps on the device; Tools has the Files-app diagnostics.
 * ========================================================================== */
(function () {
  // The boot menu: two Linux front-ends of the 64-bit x86_64 engine, Android and the two v86
  // Windows images. (The ARM64 guest is no longer listed.) The Windows 98 / 2000 one-tap images were out
  // of 1.0 for App Review (guideline 5.2) and are back in 1.1 at the user's direction (Nov 2026).
  const SYSTEMS = [
    { id: "x64pwd", name: "Linux (Desktop)", sub: "Windows, taskbar, file manager, web browser, Python", icon: "desktop", tag: "Desktop",
      guest: "x64pwd", ram: 1536, cpu: "x86-64",
      note: "A full-screen 64-bit Linux desktop: windows (Openbox) and a taskbar with a clock, a terminal, a file manager, a web browser (WebKit) and Python 3.12 with pip. Tap Apps (bottom left) or long-press the desktop for programs; the Benchmarks icon runs CPU-Z, 7-Zip and more. Downloaded once, then the disk is read straight from this device's storage as needed." },
    { id: "x64pw", name: "Linux (Terminal)", sub: "Console · Python 3.12 + pip · Wine for .exe · internet", icon: "terminal", tag: "Terminal",
      guest: "x64pw", ram: 1536, cpu: "x86-64",
      note: "64-bit Alpine Linux in a terminal, with Python 3.12 + pip, Wine (32- and 64-bit Windows .exe) and real internet. The terminal is on the left; the panel on the right has quick buttons and shows graphical output when you start an X app or a Wine program. Downloaded once, then read straight from this device's storage as needed." },
    { id: "android64", name: "Android", sub: "Android 12 (AOSP) · quad-core · touch + keyboard", icon: "android", tag: "Android",
      guest: "android64", ram: 1280, fixedRam: true, fixedCores: 4, cpu: "x86-64",
      note: "Android 12 AOSP (System UI + Launcher3) on 4 emulated cores. It resumes from a snapshot taken at the home screen, so it opens in seconds instead of a multi-minute cold boot. Touch the screen directly; use ⌨ Type for text. No Google Play, no GPU acceleration." },
    { id: "win98", name: "Windows 98 SE", sub: "One-tap download + boot", icon: "window", tag: "Windows",
      img: "vmres://iso/win98.img", kind: "hda", ram: 256, fixedRam: true, fixedCores: 1, cpu: "x86 (32-bit)", dlMB: 89,
      downloadName: "win98.img.gz", imgName: "win98.img", gz: true,
      downloadUrl: "https://github.com/yu314-coder/Bootbox/releases/download/windows-v1/win98.img.gz",
      note: "Windows 98 SE, booted from a hard disk image at 256 MB RAM (Windows 9x can't use much more) with 640×480 standard VGA. Verified booting to the desktop." },
    { id: "win2000", name: "Windows 2000 Pro", sub: "One-tap download + boot · has internet", icon: "window", tag: "Windows",
      img: "vmres://iso/win2000.img", kind: "hda", ram: 512, fixedRam: true, fixedCores: 1, cpu: "x86 (32-bit)", dlMB: 340,
      downloadName: "win2000.img.gz", imgName: "win2000.img", gz: true,
      downloadUrl: "https://github.com/yu314-coder/Bootbox/releases/download/windows-v1/win2000.img.gz",
      note: "Windows 2000 SP4 with auto-logon, 512 MB RAM and 640×480 VGA. The only Windows here with working internet (its network driver works with Bootbox's relay, where Windows 98's hangs). Heavier and slower than Windows 98." },
  ];

  const CFG = "/Apps/.bios.json";
  const readCfg = () => { try { return JSON.parse(VFS.read(CFG) || "{}"); } catch (e) { return {}; } };
  const writeCfg = (o) => { try { VFS.write(CFG, JSON.stringify(Object.assign(readCfg(), o))); } catch (e) {} };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const emuCfg = () => { try { return JSON.parse(VFS.read("/Apps/.emulator.json") || "{}"); } catch (e) { return {}; } };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const onDevice = () => !!(window.Bridge && Bridge.onDevice);
  const pad2 = n => String(n).padStart(2, "0");

  function fmtBytes(n) {
    n = +n || 0;
    if (n < 1024) return n + " B";
    if (n < 1048576) return Math.round(n / 1024) + " KB";
    if (n < 1073741824) { const m = n / 1048576; return (m < 100 ? m.toFixed(1) : Math.round(m)) + " MB"; }
    return (n / 1073741824).toFixed(n < 10737418240 ? 1 : 0) + " GB";
  }
  const fmtMB = mb => mb >= 1000 ? (mb / 1024).toFixed(1) + " GB" : mb + " MB";

  /* ------------------------------------------------------------------ *
   *  What is stored on the device (System "storage", native)           *
   * ------------------------------------------------------------------ */
  // Files a system downloads: its guest pack(s) (stored .data.gz, expanded to .data) or the
  // Windows image (downloaded .img.gz, decompressed to .img).
  function packFiles(sys) {
    if (sys.downloadName) return [sys.downloadName, sys.imgName].filter(Boolean);
    const files = (window.BootboxPacks || {})[sys.guest] || [];
    return files.flatMap(f => [f.name, f.name.replace(/\.gz$/, "")]);
  }
  function downloadMB(sys) {
    if (sys.dlMB) return sys.dlMB;
    return ((window.BootboxPacks || {})[sys.guest] || []).reduce((a, f) => a + (f.mb || 0), 0);
  }
  const isSystemFile = n => /\.(data|data\.gz|wasm\.gz)$/i.test(n) || /^win(98|2000)\.img(\.gz)?$/i.test(n);
  function systemStatus(sys, store) {
    if (!store) return { known: false };
    const names = packFiles(sys), files = store.files.filter(f => f.area === "imports");
    const have = files.filter(f => names.includes(f.name));
    const partial = files.some(f => names.some(n => f.name === n + ".part"));
    const ready = sys.downloadName ? have.some(f => f.name === sys.imgName || f.name === sys.downloadName)
                                   : ((window.BootboxPacks || {})[sys.guest] || []).every(p => have.some(f => f.name === p.name || f.name === p.name.replace(/\.gz$/, "")));
    return { known: true, ready: ready && have.length > 0, partial, bytes: have.reduce((a, f) => a + (f.alloc || f.size || 0), 0) };
  }
  // Friendly label for a stored system file.
  function systemFileLabel(name) {
    for (const s of SYSTEMS) if (packFiles(s).includes(name)) return { label: s.name, current: true };
    const old = [[/^qemu-desktop/, "Linux (Desktop)"], [/^qemu64-/, "Linux (Terminal)"], [/^qemu-android/, "Android"], [/aarch64/, "ARM64 Linux"]];
    for (const [rx, l] of old) if (rx.test(name)) return { label: l + " — older version", current: false };
    return { label: "System file", current: false };
  }
  async function loadStore() {
    if (!onDevice()) return null;
    try {
      const r = await Bridge.call("system", "storage", {});
      const s = (r && r.files) ? r : (r && r.result) || null;
      if (s) s.files = (s.files || []).filter(f => !/^\./.test(f.name));
      return s;
    } catch (e) { return null; }
  }

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
    // fixedRam (the Windows images, Android's snapshot) uses the entry's exact RAM instead of
    // inheriting a high global setting; the others get the setting as a floor.
    const ram = sys.fixedRam ? (sys.ram || 256) : Math.max(cfg.ram || 0, sys.ram || 256);
    const args = { autoboot: true, ram: ram, bootOrder: cfg.bootOrder || "cd-hd" };
    // (CPU cores: the emulator's own remembered choice, /Apps/.emulator.json cores64 — the toolbar's
    // cores menu and UEFI Setup › Advanced › CPU Cores both edit it.)
    if (sys.guest) args.guest = sys.guest;
    else { args.guest = "custom"; args.customUrl = sys.img; args.customKind = sys.kind || "cdrom"; }
    return args;
  }

  /* ------------------------------------------------------------------ *
   *  Look: one shared stylesheet + icons for both screens               *
   * ------------------------------------------------------------------ */
  const ICONS = {
    logo: '<path d="M12 2.8 20.5 7.5v9L12 21.2 3.5 16.5v-9z"/><path d="M3.8 7.6 12 12.2l8.2-4.6M12 12.2v8.8"/>',
    desktop: '<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M8.5 20.5h7M12 16.5v4"/><path d="M5.5 13.5h4" opacity=".55"/>',
    terminal: '<rect x="2.5" y="3.5" width="19" height="17" rx="2.5"/><path d="m6.5 9 3 3-3 3M12 15h5"/>',
    android: '<path d="M5 15.5a7 7 0 0 1 14 0v2.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18z"/><path d="m7.5 6.5 1.6 2.7M16.5 6.5l-1.6 2.7"/><circle cx="9.3" cy="13.6" r=".9" fill="currentColor"/><circle cx="14.7" cy="13.6" r=".9" fill="currentColor"/>',
    window: '<rect x="2.5" y="3.5" width="19" height="17" rx="2"/><path d="M2.5 8h19"/><circle cx="5.3" cy="5.8" r=".6" fill="currentColor"/><circle cx="7.4" cy="5.8" r=".6" fill="currentColor"/><path d="M6 12h5v5H6zM13 12h5v2h-5zM13 15.5h5V17h-5z" opacity=".6"/>',
    disk: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 14h18"/><circle cx="17" cy="16.5" r=".9" fill="currentColor"/>',
    cd: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.3"/><path d="M12 5.8a6.2 6.2 0 0 0-6.2 6.2" opacity=".55"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
    play: '<path d="M7 4.8v14.4L19 12z" fill="currentColor" stroke="none"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
    chev: '<path d="m9 6 6 6-6 6"/>',
  };
  const icon = (k, cls) => `<svg class="${cls || "ico"}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[k] || ICONS.disk}</svg>`;

  function ensureStyle() {
    if (document.getElementById("bb-fw-style")) return;
    const st = document.createElement("style");
    st.id = "bb-fw-style";
    st.textContent = `
      .fw{--bg:#060a12;--panel:#0b1321;--panel2:#101a2c;--line:#1a2840;--line2:#253858;--text:#e8eefa;--muted:#8b9cb9;
        --dim:#5f7193;--accent:#4aa3ff;--accent2:#1d74e0;--ok:#3fd18b;--warn:#ffc35a;--bad:#ff7b72;
        --mono:ui-monospace,"SF Mono",Menlo,"Cascadia Mono",Consolas,monospace;
        height:100%;display:flex;flex-direction:column;color:var(--text);
        font:15px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",system-ui,sans-serif;
        background:radial-gradient(120% 80% at 15% -10%,#11213d 0,#070c16 55%,#05080e 100%);
        -webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
      .fw *{box-sizing:border-box}
      .fw .ico{width:20px;height:20px;flex:0 0 auto}
      .fw-top{display:flex;align-items:center;gap:12px;padding:12px max(20px,env(safe-area-inset-left)) 12px max(20px,env(safe-area-inset-right));
        border-bottom:1px solid var(--line);background:rgba(6,10,18,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
      .fw-brand{display:flex;align-items:center;gap:9px;font-weight:700;letter-spacing:.2px}
      .fw-brand .ico{width:24px;height:24px;color:var(--accent)}
      .fw-sub{color:var(--muted);font-weight:500}
      .fw-topright{margin-left:auto;display:flex;align-items:center;gap:10px;color:var(--muted);font:500 13px var(--mono)}
      .fw-chip{display:inline-flex;align-items:center;height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--line2);
        background:var(--panel);color:var(--muted);font:600 11.5px var(--mono);letter-spacing:.3px;white-space:nowrap}
      .fw-foot{display:flex;align-items:center;gap:12px;padding:12px max(20px,env(safe-area-inset-right)) max(12px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));
        border-top:1px solid var(--line);background:rgba(6,10,18,.7)}
      .fw-keys{color:var(--dim);font:500 12px var(--mono)}
      .fw-grow{flex:1}
      .fw-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:40px;padding:0 16px;border-radius:10px;
        border:1px solid var(--line2);background:var(--panel2);color:var(--text);font-weight:600;font-size:14px;font-family:inherit;cursor:pointer;
        white-space:nowrap;transition:background .12s,border-color .12s,transform .06s}
      .fw-btn:hover{background:#15233a;border-color:#30476d}
      .fw-btn:active{transform:scale(.98)}
      .fw-btn.primary{background:linear-gradient(#2b86f0,#1b6fdb);border-color:#3d93f5;color:#fff;box-shadow:0 6px 18px rgba(29,116,224,.35)}
      .fw-btn.primary:hover{background:linear-gradient(#3590f7,#1f78e8)}
      .fw-btn.danger{background:rgba(255,123,114,.12);border-color:rgba(255,123,114,.45);color:#ffb3ad}
      .fw-btn:disabled{opacity:.45;cursor:default;transform:none}
      .fw-btn.big{min-height:52px;padding:0 26px;font-size:16px;border-radius:12px}
      .fw-btn .ico{width:18px;height:18px}

      /* ---- Boot Manager ---- */
      .bm2-main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(330px,42%) 1fr;gap:18px;padding:18px max(20px,env(safe-area-inset-right)) 18px max(20px,env(safe-area-inset-left))}
      .bm2-col{min-height:0;display:flex;flex-direction:column;background:rgba(11,19,33,.78);border:1px solid var(--line);border-radius:16px;overflow:hidden}
      .bm2-scroll{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:8px;min-height:0;flex:1}
      .bm2-h{display:flex;align-items:baseline;gap:8px;padding:12px 10px 6px;color:var(--dim);font:700 11.5px var(--mono);letter-spacing:1.2px;text-transform:uppercase}
      .bm2-h small{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:500;font-size:12px;font-family:-apple-system,system-ui,sans-serif;color:var(--dim)}
      .bm2-row{width:100%;display:flex;align-items:center;gap:13px;padding:12px;border-radius:12px;border:1px solid transparent;
        background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .1s}
      .bm2-row:hover{background:rgba(255,255,255,.035)}
      .bm2-row.sel{background:linear-gradient(90deg,rgba(74,163,255,.17),rgba(74,163,255,.07));border-color:rgba(74,163,255,.55)}
      .bm2-ic{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;flex:0 0 auto;
        background:linear-gradient(145deg,#16243c,#0e1829);border:1px solid var(--line2);color:#9fcbff}
      .bm2-ic .ico{width:23px;height:23px}
      .bm2-row.sel .bm2-ic{color:#d6ebff;border-color:rgba(74,163,255,.6);background:linear-gradient(145deg,#1d3a63,#122540)}
      .bm2-tx{display:flex;flex-direction:column;min-width:0;flex:1}
      .bm2-tx b{font-weight:650;font-size:15.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .bm2-tx small{color:var(--muted);font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .bm2-st{flex:0 0 auto;font:600 11.5px var(--mono);padding:4px 8px;border-radius:7px;color:var(--muted);background:rgba(255,255,255,.04);border:1px solid var(--line)}
      .bm2-st.ok{color:var(--ok);background:rgba(63,209,139,.08);border-color:rgba(63,209,139,.3)}
      .bm2-st.warn{color:var(--warn);background:rgba(255,195,90,.08);border-color:rgba(255,195,90,.3)}
      .bm2-st.res{color:#c9b6ff;background:rgba(160,130,255,.1);border-color:rgba(160,130,255,.35)}
      .bm2-empty{padding:10px 12px 14px;color:var(--dim);font-size:13px;line-height:1.5}
      .bm2-detail{padding:26px 28px;overflow-y:auto;-webkit-overflow-scrolling:touch}
      .bm2-hero{display:flex;align-items:center;gap:18px}
      .bm2-big{width:76px;height:76px;border-radius:20px;display:grid;place-items:center;flex:0 0 auto;color:#d9ecff;
        background:linear-gradient(145deg,#2463b0,#123766);border:1px solid rgba(120,180,255,.45);box-shadow:0 10px 30px rgba(20,90,190,.35)}
      .bm2-big .ico{width:42px;height:42px}
      .bm2-kicker{color:var(--accent);font:700 11.5px var(--mono);letter-spacing:1.3px;text-transform:uppercase}
      .bm2-hero h1{margin:3px 0 2px;font-size:28px;line-height:1.15;font-weight:750;letter-spacing:-.3px}
      .bm2-lead{color:var(--muted);font-size:14.5px}
      .bm2-specs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:22px 0 18px}
      .bm2-spec{padding:12px 14px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid var(--line)}
      .bm2-spec span{display:block;color:var(--dim);font:700 10.5px var(--mono);letter-spacing:1px;text-transform:uppercase}
      .bm2-spec b{display:block;margin-top:4px;font-size:15px;font-weight:650}
      .bm2-spec b.ok{color:var(--ok)}
      .bm2-note{color:#b7c5dd;font-size:14.5px;line-height:1.6;margin:0 0 20px;-webkit-user-select:text;user-select:text}
      .bm2-prog{margin:0 0 18px;padding:14px 16px;border-radius:12px;background:rgba(74,163,255,.07);border:1px solid rgba(74,163,255,.3);font-size:14px;display:none}
      .bm2-prog.on{display:block}
      .bm2-prog.err{background:rgba(255,123,114,.08);border-color:rgba(255,123,114,.4);color:#ffc7c2}
      .bm2-bar{height:7px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden;margin-top:9px}
      .bm2-bar i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#1d74e0,#5ab0ff);transition:width .25s}
      .bm2-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
      .bm2-auto{color:var(--warn);font:600 13px var(--mono)}
      .bm2-store{display:flex;align-items:center;gap:10px;color:var(--muted);font:500 12.5px var(--mono);min-width:0}
      .bm2-store .bm2-bar{width:110px;margin:0;flex:0 0 auto}
      .bm2-main>*{min-width:0}
      @media (max-width:860px){
        .bm2-main{display:flex;flex-direction:column;overflow-y:auto;-webkit-overflow-scrolling:touch}
        .bm2-col{overflow:visible;min-height:auto;flex:none}.bm2-scroll{overflow:visible;flex:none}
        .bm2-detail{padding:20px}
        .fw-keys{display:none}
      }
      @media (max-width:520px){
        .bm2-main{padding:12px;gap:12px}
        .bm2-hero{gap:14px}.bm2-hero h1{font-size:23px}.bm2-big{width:58px;height:58px;border-radius:16px}.bm2-big .ico{width:32px;height:32px}
        .bm2-specs{grid-template-columns:1fr 1fr}
        .bm2-store .bm2-bar{display:none}
        .fw-sub,#fw-clock{display:none}
        .bm2-actions .fw-btn.big{flex:1}
      }

      /* ---- UEFI Setup ---- */
      .u2-tabs{display:flex;gap:6px;padding:12px max(20px,env(safe-area-inset-right)) 0 max(20px,env(safe-area-inset-left));overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none}
      .u2-tab{flex:0 0 auto;min-height:38px;padding:0 15px;border-radius:10px 10px 0 0;border:1px solid transparent;border-bottom:none;
        background:transparent;color:var(--muted);font-weight:650;font-size:14px;font-family:inherit;cursor:pointer}
      .u2-tab.on{background:var(--panel);border-color:var(--line);color:var(--text);box-shadow:inset 0 2px 0 var(--accent)}
      .u2-body{flex:1;min-height:0;display:grid;grid-template-columns:1fr minmax(240px,32%);gap:0;margin:0 max(20px,env(safe-area-inset-right)) 0 max(20px,env(safe-area-inset-left));
        border:1px solid var(--line);border-radius:0 14px 14px 14px;background:rgba(11,19,33,.82);overflow:hidden}
      .u2-panel{overflow-y:auto;-webkit-overflow-scrolling:touch;padding:14px 16px 24px;min-height:0}
      .u2-help{border-left:1px solid var(--line);padding:20px;background:rgba(6,10,18,.45);color:#b7c5dd;font-size:14px;line-height:1.6;overflow-y:auto}
      .u2-help b{display:block;color:var(--text);font-size:15px;margin-bottom:8px}
      .u2-help .k{display:inline-block;margin-top:12px;padding:3px 8px;border-radius:6px;font:700 10.5px var(--mono);letter-spacing:.8px;text-transform:uppercase}
      .u2-help .k.fx{color:var(--ok);background:rgba(63,209,139,.1)}
      .u2-help .k.cos{color:var(--dim);background:rgba(255,255,255,.05)}
      .u2-sec{margin:16px 2px 7px;color:var(--dim);font:700 11.5px var(--mono);letter-spacing:1.2px;text-transform:uppercase}
      .u2-sec:first-child{margin-top:4px}
      .u2-card{border:1px solid var(--line);border-radius:12px;background:rgba(255,255,255,.02);overflow:hidden}
      .u2-row{display:flex;align-items:center;gap:12px;min-height:50px;padding:8px 14px;border-top:1px solid var(--line);cursor:pointer}
      .u2-row:first-child{border-top:none}
      .u2-row.info{cursor:default}
      .u2-row:hover:not(.info){background:rgba(255,255,255,.03)}
      .u2-row.foc{background:rgba(74,163,255,.1);box-shadow:inset 3px 0 0 var(--accent)}
      .u2-lab{flex:1;min-width:0;display:flex;flex-direction:column}
      .u2-lab b{font-weight:600;font-size:14.5px}
      .u2-lab small{color:var(--dim);font-size:12px;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .u2-cos{margin-left:6px;padding:1px 6px;border-radius:5px;font:600 10px var(--mono);letter-spacing:.5px;color:var(--dim);border:1px solid var(--line2);vertical-align:2px}
      .u2-val{color:#9fcbff;font:600 13.5px var(--mono);text-align:right;max-width:58%;-webkit-user-select:text;user-select:text}
      .u2-row.info .u2-val{color:var(--muted)}
      .u2-sw{position:relative;width:46px;height:28px;border-radius:99px;background:#2a3954;flex:0 0 auto;transition:background .15s}
      .u2-sw::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#dfe7f5;transition:transform .15s;box-shadow:0 1px 3px rgba(0,0,0,.4)}
      .u2-sw.on{background:var(--accent2)}
      .u2-sw.on::after{transform:translateX(18px)}
      .u2-seg{display:inline-flex;padding:3px;border-radius:9px;background:#0a1220;border:1px solid var(--line2);flex:0 0 auto}
      .u2-seg button{min-height:30px;padding:0 11px;border:0;border-radius:7px;background:transparent;color:var(--muted);font:600 12.5px var(--mono);cursor:pointer;white-space:nowrap}
      .u2-seg button.on{background:#1f4f8f;color:#fff}
      .u2-step{display:inline-flex;align-items:center;gap:8px;flex:0 0 auto}
      .u2-step button{width:34px;height:34px;border-radius:9px;border:1px solid var(--line2);background:var(--panel2);color:var(--text);font-weight:700;font-size:18px;line-height:1;font-family:inherit;cursor:pointer}
      .u2-step .u2-val{min-width:76px;text-align:center}
      .u2-row.act .u2-lab b{color:#cfe5ff}
      .u2-row.act .ico{color:var(--dim);width:18px;height:18px}
      .u2-row.danger .u2-lab b{color:#ffb3ad}
      .u2-note{padding:12px 14px;color:var(--muted);font-size:13.5px;line-height:1.55}
      .u2-meter{padding:14px}
      .u2-meter .bm2-bar{height:10px;margin:10px 0 6px}
      .u2-meter .bm2-bar i.b{background:linear-gradient(90deg,#1d74e0,#5ab0ff)}
      .u2-legend{display:flex;justify-content:space-between;color:var(--muted);font:500 12.5px var(--mono)}
      .u2-del{flex:0 0 auto;min-height:34px;padding:0 12px;border-radius:9px;border:1px solid var(--line2);background:transparent;color:var(--muted);font-weight:600;font-size:13px;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
      .u2-del .ico{width:15px;height:15px}
      .u2-del.arm{background:rgba(255,123,114,.15);border-color:rgba(255,123,114,.6);color:#ffb3ad}
      .u2-del:disabled{opacity:.4;cursor:default}
      .u2-body>*{min-width:0}
      @media (max-width:860px){
        .u2-body{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto}
        .u2-help{border-left:none;border-top:1px solid var(--line);max-height:132px;padding:12px 16px;font-size:13px;line-height:1.5}
        .u2-help .k{margin-top:6px}
      }
      @media (max-width:520px){
        .u2-tabs{padding:10px 12px 0}.u2-body{margin:0 12px}
        .u2-row{padding:8px 12px;gap:10px}
        .u2-lab small{white-space:normal}
        .u2-seg button{padding:0 9px}
        .fw-foot .fw-keys{display:none}
      }
    `;
    document.head.appendChild(st);
  }

  function topBar(sub, chipId) {
    return `<header class="fw-top">
      <div class="fw-brand">${icon("logo")}<span>Bootbox</span><span class="fw-sub">${sub}</span></div>
      <div class="fw-topright"><span id="fw-clock"></span><span class="fw-chip" id="${chipId}">UEFI</span></div>
    </header>`;
  }
  function startClock(container) {
    const el = container.querySelector("#fw-clock");
    const tick = () => {
      if (!el.isConnected) return clearInterval(t);
      const d = new Date();
      el.textContent = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + "  " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    };
    const t = setInterval(tick, 5000); tick();
  }

  /* ------------------------------------------------------------------ *
   *  Boot Manager — "select operating system"                          *
   * ------------------------------------------------------------------ */
  function renderMenu(container, hooks) {
    hooks = hooks || {};
    ensureStyle();
    const cfg = readCfg();
    let entries = [], sel = 0, timer = null, count = 0, store = null, busy = false;

    function importRows(names) {
      return (names || []).map(n => {
        const disk = /\.(img|raw|qcow2|hdd|vdi)$/i.test(n);   // a disk image boots as a hard disk, not a CD
        const snap = snapshotBases.has(n);   // a paired NAME.state.gz save-state was imported alongside it
        return { id: "import:" + n, name: n, imported: true,
          sub: snap ? "Disk image · instant resume from its saved state" : (disk ? "Disk image · boots as a hard disk" : "CD / ISO image"),
          icon: disk ? "disk" : "cd", tag: snap ? "Resume" : "Imported", cpu: "x86 (32-bit)",
          img: "vmres://iso/" + n, kind: disk ? "hda" : "cdrom",
          // Snapshots are captured at 1 GB; a paired-snapshot import must boot at that
          // exact RAM (v86 save-state restore requires the memory size to match).
          ram: snap ? 1024 : 512, fixedRam: snap || undefined, snap,
          note: snap ? "Your disk image plus its saved state (" + n + ".state.gz): it resumes the saved desktop in about a second, at 1 GB RAM."
                     : "Your own image, booted in the 32-bit PC emulator (v86). Add, rename or delete images in the Files app › Bootbox." };
      });
    }
    // A one-tap download lands in the same folder as imports; list it only once, as its own entry.
    function build(names) {
      const own = new Set(SYSTEMS.map(s => s.imgName).filter(Boolean));
      return SYSTEMS.concat(importRows((names || []).filter(n => !own.has(n))));
    }

    container.innerHTML = `<div class="fw">
      ${topBar("Boot Manager", "bm-ver")}
      <div class="bm2-main">
        <div class="bm2-col">
          <div class="bm2-scroll" id="bm-list"></div>
        </div>
        <div class="bm2-col bm2-detail" id="bm-detail"></div>
      </div>
      <footer class="fw-foot">
        <div class="bm2-store" id="bm-store"></div>
        <span class="fw-grow"></span>
        <span class="fw-keys">↑↓ select · ⏎ boot · S setup</span>
        <button class="fw-btn" id="bm-setup">${icon("gear")}UEFI Setup</button>
      </footer>
    </div>`;
    startClock(container);

    const listEl = container.querySelector("#bm-list");
    const detailEl = container.querySelector("#bm-detail");
    const storeEl = container.querySelector("#bm-store");
    const alive = () => !!container.querySelector("#bm-list");

    function statusChip(e) {
      if (e.imported) return e.snap ? `<span class="bm2-st res">Resume</span>` : "";
      const s = systemStatus(e, store);
      if (!s.known) return `<span class="bm2-st">${fmtMB(downloadMB(e))}</span>`;
      if (s.ready) return `<span class="bm2-st ok">Ready</span>`;
      if (s.partial) return `<span class="bm2-st warn">Incomplete</span>`;
      return `<span class="bm2-st">↓ ${fmtMB(downloadMB(e))}</span>`;
    }

    function paintList() {
      const sys = entries.filter(e => !e.imported), imp = entries.filter(e => e.imported);
      const row = (e) => {
        const i = entries.indexOf(e);
        return `<button class="bm2-row${i === sel ? " sel" : ""}" data-i="${i}">
          <span class="bm2-ic">${icon(e.icon)}</span>
          <span class="bm2-tx"><b>${esc(e.name)}</b><small>${esc(e.sub)}</small></span>${statusChip(e)}</button>`;
      };
      listEl.innerHTML = `<div class="bm2-h">Systems</div>${sys.map(row).join("")}
        <div class="bm2-h">Your images<small>Files › Bootbox</small></div>
        ${imp.length ? imp.map(row).join("") : `<div class="bm2-empty">Put a .iso or .img file in the Files app under <b>Bootbox</b> (or drag one onto Bootbox) and it shows up here.</div>`}`;
      listEl.querySelectorAll(".bm2-row").forEach(r => {
        r.onclick = () => { cancelAuto(); sel = +r.dataset.i; paint(); };
        r.ondblclick = () => { cancelAuto(); sel = +r.dataset.i; go(); };
      });
    }

    function specs(e) {
      const c = readCfg();
      const cores = e.fixedCores || (e.guest ? (+emuCfg().cores64 || 2) : 1);
      const ram = e.fixedRam ? e.ram : Math.max(c.ram || 0, e.ram || 256);
      const out = [["Processor", (e.cpu || "x86") + " · " + cores + (cores === 1 ? " core" : " cores")],
                   ["Memory", ram >= 1024 ? parseFloat((ram / 1024).toFixed(2)) + " GB" : ram + " MB"]];
      if (e.imported) {
        const f = store && store.files.find(x => x.area === "imports" && x.name === e.name);
        out.push(["Boots as", e.kind === "hda" ? "Hard disk" : "CD-ROM"]);
        if (f) out.push(["Size", fmtBytes(f.size)]);
      } else {
        const s = systemStatus(e, store);
        out.push(["Download", fmtMB(downloadMB(e))]);
        if (s.known) out.push(["On this iPad", s.ready ? fmtBytes(s.bytes) : (s.partial ? "Incomplete" : "Not downloaded"), s.ready ? "ok" : ""]);
        else out.push(["Status", "Downloads on first boot"]);
      }
      return out.map(([k, v, cls]) => `<div class="bm2-spec"><span>${k}</span><b class="${cls || ""}">${esc(v)}</b></div>`).join("");
    }

    function paintDetail() {
      const e = entries[sel];
      if (!e) { detailEl.innerHTML = ""; return; }
      const s = e.imported ? { ready: true } : systemStatus(e, store);
      const verb = s.known && !s.ready ? "Download & boot" : "Boot";
      detailEl.innerHTML = `
        <div class="bm2-hero"><span class="bm2-big">${icon(e.icon)}</span>
          <div><div class="bm2-kicker">${esc(e.tag)}</div><h1>${esc(e.name)}</h1><div class="bm2-lead">${esc(e.sub)}</div></div></div>
        <div class="bm2-specs">${specs(e)}</div>
        <p class="bm2-note">${esc(e.note)}</p>
        <div class="bm2-prog" id="bm-prog"></div>
        <div class="bm2-actions">
          <button class="fw-btn primary big" id="bm-boot"${busy ? " disabled" : ""}>${icon("play")}${verb}</button>
          <span class="bm2-auto" id="bm-count"></span>
        </div>`;
      detailEl.querySelector("#bm-boot").onclick = () => { cancelAuto(); go(); };
    }

    function paintStore() {
      if (!store) { storeEl.innerHTML = ""; return; }
      const used = store.files.reduce((a, f) => a + (f.alloc || f.size || 0), 0);
      const pct = store.free > 0 ? Math.max(2, Math.round(used / (used + store.free) * 100)) : 0;
      storeEl.innerHTML = `<div class="bm2-bar"><i style="width:${pct}%"></i></div><span>Bootbox ${fmtBytes(used)} · ${fmtBytes(store.free)} free</span>`;
      const ver = container.querySelector("#bm-ver");
      if (ver && store.version) ver.textContent = "v" + store.version + " (" + store.build + ")";
    }

    function paint() { paintList(); paintDetail(); }

    function prog(html, cls) {
      const p = detailEl.querySelector("#bm-prog");
      if (!p) return;
      p.className = "bm2-prog on" + (cls ? " " + cls : "");
      p.innerHTML = html;
    }
    function showProgress(received, total, verb) {
      const pct = total > 0 ? Math.min(100, Math.floor(received / total * 100)) : 0;
      prog(`${verb || "Downloading"}… <b>${pct}%</b> &nbsp;<span style="color:var(--muted)">${fmtBytes(received)} of ${total > 0 ? fmtBytes(total) : "?"}</span>
        <div class="bm2-bar"><i style="width:${pct}%"></i></div>`);
    }

    function go() {
      const e = entries[sel];
      if (!e || busy) return;
      bootEntry(e);
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

    const setBusy = (b) => { busy = b; const btn = detailEl.querySelector("#bm-boot"); if (btn) btn.disabled = b; };

    async function bootEntry(e) {
      cancelAuto();
      writeCfg({ lastBoot: e.id });
      if (e.downloadUrl && e.downloadName) {
        setBusy(true);
        const have = await listImported();
        const finalName = e.gz ? e.imgName : e.downloadName;   // what the VM actually boots
        // 1) fetch the archive (unless we already have it or the expanded image)
        if (!have.includes(finalName) && !have.includes(e.downloadName)) {
          prog("Fetching " + esc(e.name) + " — first boot only…");
          try { await downloadWithProgress(e.downloadUrl, e.downloadName, showProgress); }
          catch (err) { setBusy(false); prog("Download failed: " + esc((err && err.message) || err) + " — check your network, or import the image yourself.", "err"); return; }
        }
        // 2) decompress the archive into the raw image (gz entries only)
        if (e.gz && !have.includes(finalName)) {
          prog("Decompressing " + esc(e.name) + " — first boot only. Keep Bootbox open until it's ready…");
          try { await gunzipWithProgress(e.downloadName, finalName, (r, t) => showProgress(r, t, "Decompressing")); }
          catch (err) { setBusy(false); prog("Decompress failed: " + esc((err && err.message) || err), "err"); return; }
        }
        prog("Ready — starting " + esc(e.name) + "…");
        setBusy(false);
      }
      hooks.onBoot && hooks.onBoot(systemToArgs(e, readCfg()));
    }

    // Auto-boot (UEFI Setup › Boot › Auto-boot): boots the last system after a countdown, but only
    // one that is already on the device, so an unattended iPad never starts a big download.
    function startAuto() {
      const secs = +cfg.autoBoot || 0, e = entries[sel];
      if (!secs || !e || !cfg.lastBoot || e.id !== cfg.lastBoot) return;
      if (!e.imported) { const s = systemStatus(e, store); if (!s.known || !s.ready) return; }
      count = secs;
      const tick = () => {
        const c = detailEl.querySelector("#bm-count");
        if (!alive()) return cancelAuto();
        if (c) c.textContent = "Booting in " + count + " s — tap or press any key to stop";
        if (count <= 0) { cancelAuto(); bootEntry(e); return; }
        count--;
      };
      tick(); timer = setInterval(tick, 1000);
    }
    function cancelAuto() {
      if (timer) { clearInterval(timer); timer = null; }
      const c = detailEl && detailEl.querySelector("#bm-count"); if (c) c.textContent = "";
    }

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
    container.querySelector(".fw").addEventListener("pointerdown", () => cancelAuto(), true);
    container.querySelector("#bm-setup").onclick = () => { cancelAuto(); hooks.onSetup && hooks.onSetup(); };

    // Initial paint (no imports yet), then enrich with imported images and storage.
    entries = build([]);
    const li = cfg.lastBoot ? entries.findIndex(e => e.id === cfg.lastBoot) : -1;
    sel = li >= 0 ? li : 0;
    paint();
    Promise.all([listImported(), loadStore()]).then(([names, st]) => {
      if (!alive()) return;
      store = st;
      const cur = entries[sel] && entries[sel].id;
      entries = build(names);
      const i = entries.findIndex(e => e.id === (cur || cfg.lastBoot));
      if (i >= 0) sel = i;
      paint(); paintStore(); startAuto();
    });
  }

  /* ------------------------------------------------------------------ *
   *  UEFI Setup — the firmware setup you don't normally see             *
   * ------------------------------------------------------------------ */
  function renderSetup(container, hooks) {
    hooks = hooks || {};
    ensureStyle();
    const DEF = { ram: 256, cores: 2, bootOrder: "cd-hd", vtx: true, htt: false, secureBoot: false,
      bootMode: "UEFI", fastBoot: true, sataMode: "AHCI", usbLegacy: true, numlock: true, memRemap: false,
      netInternet: true, resumeState: true, nx: true, tpm: false, txt: false, bgRun: "About 30 s", isa: "SSE3 (standard)", autoBoot: 0 };
    let s = Object.assign({}, DEF, readCfg());
    // Reflect the emulator's actual internet + resume state (it stores these in its own config).
    try { const ec = emuCfg(); s.netInternet = (ec.netRelay !== "off"); s.resumeState = (ec.resumeState !== false); if (+ec.cores64) s.cores = +ec.cores64; } catch (e) {}
    // Reflect the real background-grace setting (lives in native UserDefaults, not the JS config).
    const BG_SEC = { "About 30 s": 30, "Off": 0 };
    let store = null, dev = null, storeLoading = onDevice(), armed = null, armTimer = null, busyDel = false;
    async function refreshStore() {
      storeLoading = true; if (alive()) paint();
      store = await loadStore(); storeLoading = false;
      const chip = container.querySelector("#u-ver");
      if (chip && store && store.version) chip.textContent = "Firmware " + store.version + " (" + store.build + ")";
      if (alive()) paint();
    }

    let tab = 0, foc = 0;
    const TABS = ["Main", "Advanced", "Boot", "Security", "Storage", "Tools", "Save & Exit"];
    const bootLabel = { "cd-hd": "CD → Disk", "hd-cd": "Disk → CD", "cd": "CD only" };
    const COS = "Only for the real-firmware feel — it has no effect in Bootbox.";

    function now() { const d = new Date(); return { date: d.toLocaleDateString(), time: pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) }; }

    function storageFields() {
      if (!onDevice()) return [{ t: "sep", label: "Storage" }, { t: "note", text: "Storage details are shown in the Bootbox app on your iPad." }];
      if (!store) return [{ t: "sep", label: "Storage" }, { t: "note", text: storeLoading ? "Reading storage…" : "Couldn't read storage." }];
      const used = store.files.reduce((a, f) => a + (f.alloc || f.size || 0), 0);   // unfinished downloads take space too
      const files = store.files.filter(f => !/\.part$/.test(f.name));
      const sysF = files.filter(f => f.area === "imports" && isSystemFile(f.name));
      const mine = files.filter(f => f.area === "imports" && !isSystemFile(f.name));
      const states = files.filter(f => f.area === "states");
      const live = !!window.__q64Live;
      const fileRow = (f, label, sub, area, lock) => ({ t: "file", label, sub, value: fmtBytes(f.size), area, name: f.name, lock,
        help: (lock ? "In use by the system that ran this session — restart Bootbox to delete it. " : "") +
              (area === "states" ? "A saved state lets this VM resume where you left off. Deleting it means the next boot starts fresh." :
               isSystemFile(f.name) ? "Downloaded by Bootbox. Delete it to free space; it is downloaded again the next time you boot that system." :
               "Your file in the Files app › Bootbox. Deleting it here removes it from the device.") });
      const out = [
        { t: "sep", label: "This iPad" },
        { t: "meter", used, free: store.free, total: store.total },
        { t: "sep", label: "System images (" + sysF.length + ")" },
      ];
      if (!sysF.length) out.push({ t: "note", text: "Nothing downloaded yet — each system downloads its image the first time you boot it." });
      sysF.sort((a, b) => b.size - a.size).forEach(f => {
        const l = systemFileLabel(f.name);
        out.push(fileRow(f, l.label, f.name + (l.current ? "" : " · not used any more"), "imports", live && /\.data(\.gz)?$/.test(f.name)));
      });
      out.push({ t: "sep", label: "Your images & files (" + mine.length + ")" });
      if (!mine.length) out.push({ t: "note", text: "Add files in the Files app › Bootbox, or drag them onto Bootbox." });
      mine.sort((a, b) => b.size - a.size).forEach(f => out.push(fileRow(f, f.name, f.dir ? "Folder" : new Date(f.mtime).toLocaleDateString(), "imports")));
      out.push({ t: "sep", label: "Saved states (" + states.length + ")" });
      if (!states.length) out.push({ t: "note", text: "No saved states. 💾 Save in the emulator stores one." });
      states.forEach(f => out.push(fileRow(f, f.name.replace(/\.state\.gz$/, ""), "Saved " + new Date(f.mtime).toLocaleString(), "states")));
      out.push({ t: "sep", label: "" }, { t: "action", label: "Refresh", act: "refresh", icon: "refresh", help: "Read the storage again." });
      return out;
    }

    function fields() {
      if (tab === 0) {
        const t = now();
        const avx = /^AVX2/.test(s.isa || "");
        return [
          { t: "sep", label: "Firmware" },
          { t: "info", label: "Bootbox", value: store && store.version ? store.version + " (build " + store.build + ")" : "—" },
          { t: "info", label: "Emulators", value: "QEMU 8.2 (x86-64) · v86 (32-bit PCs)" },
          { t: "info", label: "Translation", value: "x86 → WebAssembly → ARM64" },
          { t: "sep", label: "Virtual Processor" },
          { t: "info", label: "CPU", value: avx ? "x86-64-v3 · AVX2 · FMA" : "x86-64 · SSE3 · RDRAND" },
          { t: "info", label: "Cores (Linux)", value: String(s.cores || 2) },
          { t: "info", label: "Guest RAM", value: s.ram > 256 ? s.ram + " MB" : "Auto (per system)" },
          { t: "sep", label: "This Device" },
          { t: "info", label: "Model", value: dev ? (dev.model + " · " + (dev.model === "iPad" ? "iPadOS " : "iOS ") + dev.osVersion) : (navigator.platform || "—") },
          { t: "info", label: "CPU cores", value: dev ? String(dev.cores) : String(navigator.hardwareConcurrency || "—") },
          { t: "info", label: "Memory", value: dev && dev.ram ? fmtBytes(dev.ram) + (dev.memLimitMB ? " · page limit " + fmtBytes(dev.memLimitMB * 1048576) : "") : "—" },
          { t: "sep", label: "Clock" },
          { t: "info", label: "System Date", value: t.date },
          { t: "info", label: "System Time", value: t.time },
        ];
      }
      if (tab === 1) return [
        { t: "sep", label: "CPU" },
        { t: "stepper", label: "CPU Cores", sub: "Linux (Desktop & Terminal)", key: "cores", min: 1, max: 8, step: 1, fx: true,
          help: "Each core is a full emulated CPU running on its own iPad core. 4 cores give the best single-thread speed; 8 cores give the most total throughput on iPads with many cores, but run hotter and use more battery. 1 = battery saver. Applies on the next boot. Android always uses 4 (its snapshot) and the Windows images use 1." },
        { t: "select", label: "Instruction Set", sub: "Linux (Desktop & Terminal)", key: "isa", opts: ["SSE3 (standard)", "AVX2 (x86-64-v3)"], render: v => /^AVX2/.test(v) ? "AVX2" : "SSE3", fx: true,
          help: "'AVX2' adds SSSE3, SSE4.1/4.2, POPCNT, AVX, AVX2, FMA, F16C, BMI1/2, LZCNT and MOVBE, so programs built for x86-64-v3 (newer NumPy, AVX-only tools) run. It is for compatibility, not speed: every AVX instruction is emulated, and programs that switch to AVX code can get much slower (CPU-Z multi-thread drops to about a third). Applies on the next boot." },
        { t: "toggle", label: "Hyper-Threading", key: "htt", cos: true, help: COS },
        { t: "toggle", label: "Intel® VT-x", key: "vtx", cos: true, help: COS },
        { t: "toggle", label: "Execute Disable Bit", key: "nx", cos: true, help: COS },
        { t: "sep", label: "Memory" },
        { t: "stepper", label: "Guest RAM", sub: "minimum for every system", key: "ram", min: 256, max: 3584, step: 256, fx: true, render: v => v <= 256 ? "Auto" : v + " MB",
          help: "Memory for the next boot. Auto = each system's own size (Linux 1.5 GB; Android and the Windows images use fixed sizes). Raise it for big pip installs or many open apps — it doesn't make the CPU faster. If a guest fails to start, lower it." },
        { t: "toggle", label: "Memory Remap Above 4G", key: "memRemap", cos: true, help: COS },
        { t: "sep", label: "Network" },
        { t: "toggle", label: "Guest Internet", key: "netInternet", fx: true, help: "Connects the guests' network card to the internet through Bootbox's built-in relay. Turn off for a fully offline VM." },
        { t: "sep", label: "Power" },
        { t: "select", label: "Run in Background", key: "bgRun", opts: ["About 30 s", "Off"], render: v => v === "Off" ? "Off" : "30 s", fx: true,
          help: "When you switch to another app, iOS pauses Bootbox. '30 s' lets the guest keep running for the short time iOS allows (to finish a save or a download step); 'Off' pauses at once. Either way the guest stays in memory and continues when you come back." },
        { t: "sep", label: "Storage Controller" },
        { t: "select", label: "SATA Mode", key: "sataMode", opts: ["AHCI", "IDE"], cos: true, help: COS },
        { t: "toggle", label: "USB Legacy Support", key: "usbLegacy", cos: true, help: COS },
      ];
      if (tab === 2) return [
        { t: "sep", label: "Startup" },
        { t: "select", label: "Auto-boot", sub: "boot the last system after a countdown", key: "autoBoot", opts: [0, 5, 10], render: v => +v ? v + " s" : "Off", fx: true,
          help: "Boot the system you used last after a short countdown when Bootbox opens (tap or press a key to stop it). Only a system that is already downloaded is auto-booted." },
        { t: "select", label: "Boot Order", sub: "your own images (v86)", key: "bootOrder", opts: ["cd-hd", "hd-cd", "cd"], render: v => bootLabel[v], fx: true,
          help: "The order in which the 32-bit PC tries its boot devices for your imported images." },
        { t: "toggle", label: "Resume Saved State", key: "resumeState", fx: true, help: "On: a VM with a saved state (💾 Save) resumes where you left off. Off: always start fresh, ignoring saved states." },
        { t: "sep", label: "Firmware" },
        { t: "select", label: "Boot Mode", key: "bootMode", opts: ["UEFI", "Legacy"], cos: true, help: COS },
        { t: "toggle", label: "Fast Boot", key: "fastBoot", cos: true, help: COS },
        { t: "toggle", label: "NumLock", key: "numlock", cos: true, help: COS },
      ];
      if (tab === 3) return [
        { t: "sep", label: "Security" },
        { t: "toggle", label: "Secure Boot", key: "secureBoot", cos: true, help: COS },
        { t: "info", label: "Secure Boot Mode", value: "Setup" },
        { t: "toggle", label: "TPM Security Device", key: "tpm", cos: true, help: COS },
        { t: "toggle", label: "Intel® TXT", key: "txt", cos: true, help: COS },
        { t: "info", label: "Administrator Password", value: "Not set" },
        { t: "note", text: "Bootbox runs every system inside the app's sandbox; there is no firmware to lock. These switches only complete the picture of a PC firmware." },
      ];
      if (tab === 4) return storageFields();
      if (tab === 5) return [
        { t: "sep", label: "Files app" },
        { t: "action", label: "File-sync diagnostics", act: "diag", help: "What the Files app integration sees: the files in the Bootbox folder, the registered location and the extension's activity log." },
        { t: "action", label: "Reset the Files location", act: "fpreset", help: "Re-register Bootbox in the Files app (your files are kept). Use it if the Bootbox location stops updating." },
        { t: "sep", label: "Benchmarks" },
        { t: "action", label: "Web benchmark on this iPad", act: "webbench", help: "Runs the JavaScript / DOM / canvas benchmark natively in this device's web view — the same page the Linux desktop's browser runs emulated (1000 = an M4 Mac)." },
      ];
      // Save & Exit  (+ UEFI-style "Boot Override" straight into a system)
      return [
        { t: "sep", label: "Save & Exit" },
        { t: "action", label: "Save Changes and Exit", act: "save", help: "Keep these settings and return to the boot menu." },
        { t: "action", label: "Discard Changes and Exit", act: "discard", help: "Return to the boot menu without saving." },
        { t: "action", label: "Load Optimized Defaults", act: "defaults", help: "Reset every setting to its default (not saved until you save)." },
        { t: "sep", label: "Boot Override" },
        ...SYSTEMS.map(x => ({ t: "action", label: x.name, sub: "save and boot now", act: "boot:" + x.id, icon: x.icon, help: x.note })),
      ];
    }

    container.innerHTML = `<div class="fw">
      ${topBar("UEFI Setup", "u-ver")}
      <nav class="u2-tabs" id="u-tabs"></nav>
      <div class="u2-body"><div class="u2-panel" id="u-panel"></div><aside class="u2-help" id="u-help"></aside></div>
      <footer class="fw-foot">
        <span class="fw-keys">←→ tab · ↑↓ item · ⏎ change · F9 defaults · F10 save · Esc back</span>
        <span class="fw-grow"></span>
        <button class="fw-btn" id="u-discard">Discard</button>
        <button class="fw-btn primary" id="u-save">Save &amp; Exit</button>
      </footer>
    </div>`;
    startClock(container);
    const tabsEl = container.querySelector("#u-tabs");
    const panelEl = container.querySelector("#u-panel");
    const helpEl = container.querySelector("#u-help");
    const alive = () => !!container.querySelector("#u-panel");
    container.querySelector("#u-save").onclick = () => doAction("save");
    container.querySelector("#u-discard").onclick = () => doAction("discard");

    const focusable = (fs) => fs.map((f, i) => (["sep", "info", "note", "meter"].includes(f.t) ? -1 : i)).filter(i => i >= 0);

    function setHelp(f) {
      if (f && f.help) {
        helpEl.innerHTML = "<b>" + esc(f.label) + "</b>" + esc(f.help) +
          (f.cos ? '<br><span class="k cos">Cosmetic</span>' : f.fx ? '<br><span class="k fx">Functional</span>' : "");
      } else {
        helpEl.innerHTML = "<b>Bootbox Setup</b>Tap a setting to change it. Settings marked <i>cosmetic</i> are only there for the real-firmware feel. Changes apply when you <b style='display:inline;font-size:inherit'>Save &amp; Exit</b>.";
      }
    }

    function control(f) {
      const v = s[f.key];
      if (f.t === "toggle") return `<span class="u2-sw${v ? " on" : ""}"></span>`;
      if (f.t === "select") return `<span class="u2-seg">${f.opts.map(o => `<button data-o="${esc(o)}" class="${String(o) === String(v) ? "on" : ""}">${esc(f.render ? f.render(o) : o)}</button>`).join("")}</span>`;
      if (f.t === "stepper") return `<span class="u2-step"><button data-d="-1" aria-label="less">−</button><span class="u2-val">${esc(f.render ? f.render(v) : v)}</span><button data-d="1" aria-label="more">+</button></span>`;
      if (f.t === "info") return `<span class="u2-val">${esc(f.value)}</span>`;
      if (f.t === "file") {
        const isArmed = armed === f.area + "/" + f.name;
        return `<span class="u2-val">${esc(f.value)}</span><button class="u2-del${isArmed ? " arm" : ""}"${f.lock || busyDel ? " disabled" : ""}>${icon("trash")}${isArmed ? "Delete?" : "Delete"}</button>`;
      }
      if (f.t === "action") return icon("chev");
      return "";
    }

    function paint() {
      tabsEl.innerHTML = TABS.map((t, i) => `<button class="u2-tab${i === tab ? " on" : ""}" data-t="${i}">${t}</button>`).join("");
      tabsEl.querySelectorAll(".u2-tab").forEach(b => b.onclick = () => { tab = +b.dataset.t; foc = 0; disarm(); paint(); panelEl.scrollTop = 0; });
      const fs = fields(), fo = focusable(fs);
      if (foc >= fo.length) foc = Math.max(0, fo.length - 1);
      const focIdx = fo[foc];
      let html = "", open = false;
      const close = () => { if (open) { html += "</div>"; open = false; } };
      fs.forEach((f, i) => {
        if (f.t === "sep") { close(); if (f.label) html += `<div class="u2-sec">${esc(f.label)}</div>`; html += '<div class="u2-card">'; open = true; return; }
        if (!open) { html += '<div class="u2-card">'; open = true; }
        if (f.t === "note") { html += `<div class="u2-note">${esc(f.text)}</div>`; return; }
        if (f.t === "meter") {
          const pctB = f.total ? Math.max(1, f.used / f.total * 100) : 0, pctU = f.total ? Math.max(0, (f.total - f.free - f.used) / f.total * 100) : 0;
          html += `<div class="u2-meter"><div class="u2-legend"><span>Bootbox ${fmtBytes(f.used)}</span><span>${fmtBytes(f.free)} free of ${fmtBytes(f.total)}</span></div>
            <div class="bm2-bar" style="display:flex"><i class="b" style="width:${pctB}%"></i><i style="width:${pctU}%;background:#3a4a66;border-radius:0"></i></div></div>`;
          return;
        }
        const cls = f.t === "action" ? "act" + (f.danger ? " danger" : "") : f.t;
        html += `<div class="u2-row ${cls}${i === focIdx ? " foc" : ""}" data-i="${i}">
          ${f.icon ? `<span class="bm2-ic" style="width:34px;height:34px;border-radius:9px">${icon(f.icon)}</span>` : ""}
          <span class="u2-lab"><b>${esc(f.label)}${f.cos ? '<span class="u2-cos">cosmetic</span>' : ""}</b>${f.sub ? `<small>${esc(f.sub)}</small>` : ""}</span>
          ${control(f)}</div>`;
      });
      close();
      panelEl.innerHTML = html;
      panelEl.querySelectorAll(".u2-row").forEach(row => {
        const i = +row.dataset.i, f = fs[i];
        row.onmouseenter = () => setHelp(f);
        row.onclick = (ev) => {
          foc = Math.max(0, fo.indexOf(i));
          const o = ev.target.closest("[data-o]"), d = ev.target.closest("[data-d]"), del = ev.target.closest(".u2-del");
          if (o && f.t === "select") { const opt = f.opts.find(x => String(x) === o.dataset.o); s[f.key] = opt; setHelp(f); paint(); return; }
          if (d && f.t === "stepper") { s[f.key] = clamp(s[f.key] + (+d.dataset.d) * f.step, f.min, f.max); setHelp(f); paint(); return; }
          if (del && f.t === "file") { if (!del.disabled) askDelete(f); setHelp(f); return; }
          if (f.t === "file") { setHelp(f); paint(); return; }
          activate(f);
        };
      });
      setHelp(fs[focIdx]);
      const focRow = panelEl.querySelector(".u2-row.foc");
      if (focRow && focRow.scrollIntoView) focRow.scrollIntoView({ block: "nearest" });
    }

    function disarm() { armed = null; if (armTimer) { clearTimeout(armTimer); armTimer = null; } }
    async function askDelete(f) {
      const key = f.area + "/" + f.name;
      if (armed !== key) {                      // first tap arms; a second tap within 4 s deletes
        disarm(); armed = key; armTimer = setTimeout(() => { armed = null; if (alive()) paint(); }, 4000); paint(); return;
      }
      disarm(); busyDel = true; paint();
      try { await Bridge.call("system", "deleteStored", { area: f.area, name: f.name }); }
      catch (e) { helpEl.innerHTML = "<b>Couldn't delete</b>" + esc((e && e.message) || e); }
      busyDel = false;
      await refreshStore();
    }

    function activate(f) {
      if (!f) return;
      setHelp(f);
      if (f.t === "toggle") { s[f.key] = !s[f.key]; paint(); }
      else if (f.t === "select") { const i = f.opts.findIndex(o => String(o) === String(s[f.key])); s[f.key] = f.opts[(i + 1) % f.opts.length]; paint(); }
      else if (f.t === "stepper") { s[f.key] = s[f.key] >= f.max ? f.min : clamp(s[f.key] + f.step, f.min, f.max); paint(); }
      else if (f.t === "file") { if (!f.lock && !busyDel) askDelete(f); }
      else if (f.t === "action") doAction(f.act);
    }

    function persist() {
      writeCfg({ ram: s.ram, bootOrder: s.bootOrder, vtx: s.vtx, htt: s.htt, secureBoot: s.secureBoot,
        bootMode: s.bootMode, fastBoot: s.fastBoot, sataMode: s.sataMode, usbLegacy: s.usbLegacy,
        numlock: s.numlock, memRemap: s.memRemap, netInternet: s.netInternet,
        resumeState: s.resumeState, nx: s.nx, tpm: s.tpm, txt: s.txt, bgRun: s.bgRun, isa: s.isa, autoBoot: +s.autoBoot || 0 });
      // Apply the background-execution choice to the native keep-alive (UserDefaults + re-arm).
      try { if (onDevice() && BG_SEC[s.bgRun] != null) Bridge.call("system", "setBackgroundGrace", { seconds: BG_SEC[s.bgRun] }); } catch (e) {}
      // Mirror the internet + resume toggles into the emulator's own config (it reads
      // netRelay + resumeState there), preserving a custom wss:// relay URL if one was set.
      try {
        const ec = JSON.parse(VFS.read("/Apps/.emulator.json") || "{}");
        if (s.netInternet) { if (ec.netRelay === "off") delete ec.netRelay; }
        else ec.netRelay = "off";
        ec.resumeState = s.resumeState;
        ec.cores64 = clamp(+s.cores || 2, 1, 8);   // the same setting as the emulator toolbar's cores menu
        VFS.write("/Apps/.emulator.json", JSON.stringify(ec));
      } catch (e) {}
    }

    // --- File-sync diagnostics overlay (the Files-app integration, seen from the app) ---
    async function showDiag() {
      let text = "Loading…";
      try { const r = await Bridge.call("system", "fpdiag"); text = (r && (r.data || r)) || "(no data)"; }
      catch (e) { text = "diagnostics unavailable: " + ((e && e.message) || e); }
      const ov = document.createElement("div");
      ov.className = "fw";
      ov.style.cssText = "position:fixed;inset:0;z-index:99999;height:auto;background:rgba(3,6,12,.94);padding:18px";
      ov.innerHTML = '<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px"><b style="flex:1;font-size:16px">File-sync diagnostics</b>' +
        '<button class="fw-btn" id="dg-close">Close</button></div>' +
        '<pre id="dg-pre" style="flex:1;overflow:auto;white-space:pre-wrap;color:#bfe0ff;background:#060d18;border:1px solid #1d3a59;border-radius:12px;padding:14px;font:12px/1.5 ui-monospace,Menlo,monospace;margin:0;-webkit-user-select:text;user-select:text"></pre>';
      document.body.appendChild(ov);
      ov.querySelector("#dg-pre").textContent = typeof text === "string" ? text : JSON.stringify(text, null, 2);
      ov.querySelector("#dg-close").onclick = () => ov.remove();
    }
    function showWebBench() {
      if (document.getElementById("bb-webbench")) return;
      const ov = document.createElement("div");
      ov.id = "bb-webbench";
      ov.style.cssText = "position:fixed;inset:0;z-index:99999;background:rgba(5,8,14,.86);display:flex;align-items:center;justify-content:center;padding:18px";
      ov.innerHTML = '<div style="position:relative;width:min(820px,100%);height:min(720px,100%);border-radius:14px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.5)">' +
        '<iframe src="webbench.html" style="width:100%;height:100%;border:0;background:#0b0f17"></iframe>' +
        '<button style="position:absolute;top:10px;right:10px;font:600 14px -apple-system,sans-serif;padding:7px 14px;border:0;border-radius:8px;background:#1d2a40;color:#fff">Close</button></div>';
      ov.querySelector("button").onclick = () => ov.remove();
      document.body.appendChild(ov);
    }

    function doAction(act) {
      if (act === "save") { persist(); hooks.onBack && hooks.onBack(); }
      else if (act === "discard") { hooks.onBack && hooks.onBack(); }
      else if (act === "defaults") { s = Object.assign({}, DEF); foc = 0; paint(); setHelp({ label: "Defaults loaded", help: "Every setting is back to its default. Save & Exit to keep them." }); }
      else if (act === "refresh") { refreshStore(); }
      else if (act === "diag") { if (onDevice()) showDiag(); else setHelp({ label: "File-sync diagnostics", help: "Available in the app on your iPad." }); }
      else if (act === "fpreset") {
        if (!onDevice()) return setHelp({ label: "Reset the Files location", help: "Available in the app on your iPad." });
        Bridge.call("system", "fpreset").then(() => setHelp({ label: "Files location reset", help: "Bootbox was re-registered in the Files app. Reopen Files in a few seconds." }))
          .catch(e => setHelp({ label: "Reset failed", help: String((e && e.message) || e) }));
      }
      else if (act === "webbench") showWebBench();
      else if (act && act.indexOf("boot:") === 0) {
        const sys = SYSTEMS.find(x => x.id === act.slice(5));
        if (sys) { persist(); hooks.onBoot && hooks.onBoot(systemToArgs(sys, s)); }
      }
    }

    function onKey(e) {
      if (!alive()) { window.removeEventListener("keydown", onKey); return; }
      const fs = fields(), fo = focusable(fs);
      const k = e.key;
      if (k === "ArrowRight") { tab = (tab + 1) % TABS.length; foc = 0; disarm(); paint(); e.preventDefault(); }
      else if (k === "ArrowLeft") { tab = (tab + TABS.length - 1) % TABS.length; foc = 0; disarm(); paint(); e.preventDefault(); }
      else if (k === "ArrowDown") { foc = Math.min(fo.length - 1, foc + 1); paint(); e.preventDefault(); }
      else if (k === "ArrowUp") { foc = Math.max(0, foc - 1); paint(); e.preventDefault(); }
      else if (k === "Enter") { activate(fs[fo[foc]]); e.preventDefault(); }
      else if (k === "Escape") { hooks.onBack && hooks.onBack(); }
      else if (k === "F10") { doAction("save"); e.preventDefault(); }
      else if (k === "F9") { doAction("defaults"); e.preventDefault(); }
    }
    window.addEventListener("keydown", onKey);

    // the Main tab's clock
    const clockT = setInterval(() => { if (!alive()) return clearInterval(clockT); if (tab === 0) { const v = panelEl.querySelectorAll(".u2-row.info .u2-val"); if (v.length) { const t = now(); v[v.length - 1].textContent = t.time; v[v.length - 2].textContent = t.date; } } }, 1000);

    paint();
    if (onDevice()) {
      Bridge.call("system", "getBackgroundGrace").then(g => {
        const sec = (typeof g === "number") ? g : (g && g.result);
        if (sec != null) { s.bgRun = sec === 0 ? "Off" : "About 30 s"; if (alive()) paint(); }
      }).catch(() => {});
      Bridge.call("system", "info", {}).then(r => { dev = (r && r.model) ? r : (r && r.result) || null; if (alive()) paint(); }).catch(() => {});
      refreshStore();
    }
  }

  window.BiosMenu = { renderMenu, renderSetup };
})();
