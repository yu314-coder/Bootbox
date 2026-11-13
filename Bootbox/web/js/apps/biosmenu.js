/* ============================================================================
 * Bootbox firmware — two screens, like a real PC:
 *
 *   • Boot Menu  (renderMenu)  — the "select operating system" page you normally
 *     see: a boot manager that lists the systems (Linux Desktop / Terminal,
 *     Android) and your imported images. Pick one and
 *     boot. ↑↓/Enter or tap. GRUB / UEFI-boot-manager style.
 *
 *   • UEFI Setup (renderSetup) — the firmware setup you DON'T normally see: tabbed
 *     (Main / Advanced / Boot / Storage / Tools / Save & Exit), every setting
 *     functional. Storage lists and deletes what Bootbox keeps on the device;
 *     Tools has the Files-app diagnostics.
 * ========================================================================== */
(function () {
  // The boot menu: two Linux front-ends of the 64-bit x86_64 engine and Android. (The ARM64 guest is no
  // longer listed.) No one-tap Windows: Windows 98 SE / 2000 are Microsoft software (App Review 5.2.1),
  // removed again in build 13 at the user's direction (Nov 9 2026). Your own images still boot (imports).
  const SYSTEMS = [
    { id: "x64pwd", name: "Linux (Desktop)", sub: "64-bit Linux desktop · windows, taskbar, terminal, file manager, web browser", icon: "🖥️", svg: "desktop", tag: "DESKTOP", dlMB: 412,
      guest: "x64pwd", ram: 1536,
      note: "A full-screen 64-bit (x86_64) Linux desktop: windows (Openbox) + taskbar/clock (tint2), a terminal, a file manager, a web browser (WebKit) and Python 3.12 with pip. Tap Apps (bottom-left) or right-click the desktop for programs; the Benchmarks icon runs CPU-Z, 7-Zip and more. Downloaded once (~410 MB), then the guest disk is read straight from this device's storage as needed." },
    { id: "x64pw", name: "Linux (Terminal)", sub: "64-bit Linux console · Python 3.12 + pip · Wine for .exe · internet", icon: "🐍", svg: "terminal", tag: "TERMINAL", dlMB: 310,
      guest: "x64pw", ram: 1536,
      note: "64-bit (x86_64) Alpine Linux in a terminal — cores 1–8 in UEFI Setup. Python 3.12 + pip, Wine (32 & 64-bit .exe) and real internet. Terminal on the LEFT; the panel on the RIGHT has quick buttons and shows graphical output when you start an X app or a Wine .exe. Downloaded once (~310 MB), then the guest disk is read straight from this device's storage as needed." },
    { id: "android64", name: "Android", sub: "Android 12 · GPU-accelerated · Pixel-style launcher · quad-core · touch + keyboard", icon: "🤖", svg: "android", tag: "ANDROID", dlMB: 1043,
      guest: "android64", ram: 1280,
      note: "Android 12 AOSP (System UI + Launcher3) on 4 emulated cores. It resumes from a snapshot taken at the home screen, so it opens in seconds instead of a multi-minute cold boot. Touch the screen directly; ⌨ Type for text. Downloaded once (~901 MB). No Google Play, no GPU acceleration." },
  ];

  // Every x86 feature the 64-bit Linux guests get with "All instructions" (QEMU 8.2's TCG emulates all of them,
  // each a real `-cpu qemu64,+flag`; the emulator adds XSAVE/XSAVEOPT for AVX). "Standard" = none of them.
  // Custom = any combination; `needs` are switched on with a feature (and it goes off when they do).
  const CPU_FEATURES = [
    { f: "ssse3", label: "SSSE3", needs: [], use: "byte shuffles; most media and compression code" },
    { f: "sse4.1", label: "SSE4.1", needs: ["ssse3"], use: "blends, rounding, dot products" },
    { f: "sse4.2", label: "SSE4.2", needs: ["sse4.1"], use: "string compare, CRC32; part of x86-64-v2" },
    { f: "popcnt", label: "POPCNT", needs: [], use: "bit counting; part of x86-64-v2" },
    { f: "aes", label: "AES-NI", needs: [], use: "AES encryption (OpenSSL, ssh, TLS)" },
    { f: "pclmulqdq", label: "PCLMULQDQ", needs: [], use: "carry-less multiply: AES-GCM, CRC" },
    { f: "sha-ni", label: "SHA-NI", needs: ["ssse3"], use: "SHA-1 / SHA-256 hashing" },
    { f: "movbe", label: "MOVBE", needs: [], use: "byte-swapping loads/stores" },
    { f: "abm", label: "LZCNT", needs: [], use: "leading-zero count (ABM)" },
    { f: "bmi1", label: "BMI1", needs: [], use: "bit-manipulation; part of x86-64-v3" },
    { f: "bmi2", label: "BMI2", needs: [], use: "bit-manipulation; part of x86-64-v3" },
    { f: "adx", label: "ADX", needs: [], use: "multi-precision add (big-number math)" },
    { f: "rdseed", label: "RDSEED", needs: [], use: "hardware random seeds" },
    { f: "avx", label: "AVX", needs: ["sse4.2", "popcnt"], use: "256-bit floating point" },
    { f: "avx2", label: "AVX2", needs: ["avx"], use: "256-bit integer; part of x86-64-v3 (newer NumPy, AVX-only tools)" },
    { f: "fma", label: "FMA", needs: ["avx"], use: "fused multiply-add; part of x86-64-v3" },
    { f: "f16c", label: "F16C", needs: ["avx"], use: "half-precision float conversion" },
  ];
  const ALL_CPU_FEATURES = CPU_FEATURES.map(x => x.f);
  // Extra kernel parameters (UEFI Setup › Advanced › Linux Kernel). The guest boots
  // "... init=/sbin/tini -- /sbin/init": a bare word the kernel doesn't know is handed to init, and tini
  // would try to RUN it - so bare words must be known kernel flags. init/root/console/-- would take the
  // boot away from Bootbox's own setup. Returns { keep, dropped } (word lists).
  const KERNEL_FLAGS = ["nokaslr", "nosmp", "nosmt", "noapic", "nolapic", "nox2apic", "nopti", "nospectre_v1", "nospectre_v2",
    "nospec_store_bypass_disable", "noibrs", "noibpb", "debug", "ignore_loglevel", "initcall_debug", "quiet", "nohlt",
    "nomodeset", "norandmaps", "nopat", "noautogroup", "nosoftlockup", "nowatchdog", "noefi", "earlyprintk"];
  const KERNEL_BLOCKED = ["init", "rdinit", "root", "rootfstype", "console", "qemu_mode"];
  function kernelWords(str) {
    const keep = [], dropped = [];
    String(str || "").replace(/[^a-zA-Z0-9_.,=\- ]/g, "").split(/\s+/).filter(Boolean).forEach(w => {
      const m = /^([a-zA-Z0-9_.\-]+)(=[a-zA-Z0-9_.,\-]*)?$/.exec(w), key = m ? m[1].toLowerCase() : "";
      const ok = m && !key.startsWith("-") && !KERNEL_BLOCKED.includes(key) && (m[2] ? m[2].length > 1 : KERNEL_FLAGS.includes(key));
      (ok ? keep : dropped).push(w);
    });
    return { keep, dropped };
  }
  // The emulator's crash fallback ("safety ladder", emulator.js SAFE_LEVELS): what each level turns off.
  const SAFE_NAMES = ["full speed", "classic interpreter", "no block chaining", "no SIMD inlining",
    "no SIMD / register locals / bulk copies", "minimal engine, fixed memory", "interpreter only (very slow)"];

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

  /* ------------------------------------------------------------------ *
   *  What is stored on the device (System "storage", native)           *
   * ------------------------------------------------------------------ */
  // Files a system downloads: its guest pack(s) (stored .data.gz, expanded to .data) or the
  // one-tap disk image (downloaded .img.gz, decompressed to .img - none listed since build 13).
  function packFiles(sys) {
    if (sys.downloadName) return [sys.downloadName, sys.imgName].filter(Boolean);
    const files = (window.BootboxPacks || {})[sys.guest] || [];
    return files.flatMap(f => [f.name, f.name.replace(/\.gz$/, "")]);
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
    // fixedRam (Android's snapshot, imported Win9x disks, paired save-states) uses the entry's exact RAM instead of
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
      .fw-dirty{color:var(--warn);font:600 12.5px var(--mono);white-space:nowrap}
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

      .bm2-ic{width:42px;height:42px;border-radius:11px;display:grid;place-items:center;flex:0 0 auto;
        background:linear-gradient(145deg,#16243c,#0e1829);border:1px solid var(--line2);color:#9fcbff}
      .bm2-ic .ico{width:23px;height:23px}
      .bm2-bar{height:7px;border-radius:99px;background:rgba(255,255,255,.07);overflow:hidden;margin-top:9px}
      .bm2-bar i{display:block;height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#1d74e0,#5ab0ff);transition:width .25s}
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
      .u2-text,.u2-select{flex:0 1 auto;width:min(340px,58%);height:36px;border-radius:9px;border:1px solid var(--line2);background:#0a1220;
        color:var(--text);font:600 13px var(--mono);padding:0 11px;-webkit-user-select:text;user-select:text;outline:none}
      .u2-text:focus,.u2-select:focus{border-color:var(--accent)}
      .u2-select{appearance:none;-webkit-appearance:none;padding-right:30px;cursor:pointer;
        background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'><path d='M2 4l4 4 4-4' stroke='%238b9cb9' stroke-width='1.5' fill='none'/></svg>");
        background-repeat:no-repeat;background-position:right 10px center}
      .u2-select option{background:#0b1321;color:var(--text)}
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
      @media (max-width:980px){ .fw-foot .fw-keys{display:none} }
      @media (max-width:860px){
        .u2-body{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) auto}
        .u2-help{border-left:none;border-top:1px solid var(--line);max-height:132px;padding:12px 16px;font-size:13px;line-height:1.5}
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
   *  Boot Menu — "select operating system"                              *
   * ------------------------------------------------------------------ */
  function renderMenu(container, hooks) {
    hooks = hooks || {};
    const cfg = readCfg();
    // UEFI Setup › Boot › Default System (else the one used last)
    const pref = cfg.defaultBoot && cfg.defaultBoot !== "last" ? cfg.defaultBoot : cfg.lastBoot;
    let entries = [];
    let sel = 0, timer = null, count = 0;

    const WIN9X = /win\s*9[58x]|win98|w98|winme/i;   // (emulator.js boots these with v86's JIT off)
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
          // An imported Windows 9x disk boots at 256 MB whatever the RAM setting (Win9x fails with lots of RAM).
          ram: snap ? 1024 : (disk && WIN9X.test(n) ? 256 : undefined), fixedRam: snap || (disk && WIN9X.test(n)) || undefined,
          note: snap ? "Imported disk + a paired save-state (" + n + ".state.gz): resumes the pre-booted desktop in ~1s — drivers, apps and network already up — at 1 GB RAM. Manage these in the Files app (Bootbox)."
                     : "Your imported image. Manage these in the Files app (Bootbox)." };
      });
    }
    // Setup is reached from the footer button (and the S key), not a list row.
    // A one-tap download lands in the same folder as imports; list it only once, as its own entry.
    function build(names) {
      const own = new Set(SYSTEMS.map(s => s.imgName).filter(Boolean));
      return SYSTEMS.concat(importRows((names || []).filter(n => !own.has(n))));
    }

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
        .bm-btn:disabled{opacity:.6;cursor:default}
        .bm-row .tag.ok{background:#123d2c;color:#7ee2ad}
        .bm-row .tag.dl{background:#2a2f45;color:#c9d4ec}
        .bm-cfg{width:min(720px,94%);display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;color:#9cc4ee;font-size:12.5px}
        .bm-cfg button{background:none;border:1px solid #1d4060;color:#9fd0ff;border-radius:7px;padding:5px 11px;font:inherit;font-weight:700;cursor:pointer}
        .bm-cfg button:hover{background:#10243d}
      </style>
      <div class="bm">
        <div class="bm-top">
          <span class="bm-brand"><span class="bm-glyph"><i></i><i></i><i></i><i></i></span>Bootbox UEFI</span>
          <span style="opacity:.7">Boot Manager</span>
          <span class="bm-right">x86-64 · emulated in WebAssembly</span>
        </div>
        <div class="bm-mid">
          <div class="bm-box">
            <div class="bm-boxhead">▸ Select operating system</div>
            <div class="bm-list" id="bm-list"></div>
          </div>
          <div class="bm-cfg" id="bm-cfg"></div>
          <div class="bm-note" id="bm-note"></div>
          <div class="bm-keys">Tap a system to select it · tap it again (or Boot) to start &nbsp;·&nbsp; keyboard: ↑ ↓ ⏎, S = setup</div>
        </div>
        <div class="bm-foot">
          <span class="bm-count" id="bm-count"></span>
          <span class="bm-grow"></span>
          <button class="bm-btn" id="bm-setup">⚙ UEFI Setup</button>
          <button class="bm-btn primary" id="bm-boot">Boot ▶</button>
        </div>
      </div>`;

    const listEl = container.querySelector("#bm-list");
    const noteEl = container.querySelector("#bm-note");
    const cfgEl = container.querySelector("#bm-cfg");
    const bootBtn = container.querySelector("#bm-boot");
    const countEl = container.querySelector("#bm-count");
    const alive = () => !!container.querySelector("#bm-list");
    let storeNow = null, busy = false;

    // On the device: is this system already downloaded? (null = unknown: not on the device, imports)
    function status(e) {
      if (!storeNow || !e || String(e.id).startsWith("import:")) return null;
      const st = systemStatus(e, storeNow);
      return st.known ? st : null;
    }
    // The settings the selected system will boot with, with a way into Setup to change them.
    function cfgLine(e) {
      if (!e) return "";
      const c = readCfg(), ec = emuCfg();
      const gb = (mb) => mb >= 1024 ? (mb / 1024).toFixed(mb % 1024 ? 2 : 0).replace(/\.?0+$/, "") + " GB" : mb + " MB";
      if (e.id === "x64pwd" || e.id === "x64pw") {
        const isa = c.isaMode === "std" ? "standard instructions" : c.isaMode === "custom" ? "custom instructions" : "all instructions";
        const cores = Math.max(1, Math.min(8, +ec.cores64 || 2));
        return cores + (cores === 1 ? " core" : " cores") + " · " + gb(Math.max(c.ram || 0, e.ram || 0)) + " · " + isa;
      }
      if (e.id === "android64") return "4 cores · " + gb(e.ram) + " · resumes at the home screen";
      return "1 core · " + gb(e.fixedRam ? (e.ram || 256) : Math.max(c.ram || 0, e.ram || 256)) + " · 32-bit PC";
    }

    function paint() {
      listEl.innerHTML = "";
      entries.forEach((e, i) => {
        const row = document.createElement("div");
        const st = status(e);
        const tag = !st ? `<span class="tag">${e.tag || "32-BIT"}</span>`
          : st.ready ? `<span class="tag ok">READY</span>`
          : `<span class="tag dl">${st.partial ? "RESUME ↓" : "↓ " + (e.dlMB ? e.dlMB + " MB" : "DOWNLOAD")}</span>`;
        row.className = "bm-row" + (i === sel ? " sel" : "") + (e.kind === "setup" ? " setup" : "");
        row.innerHTML = `<span class="ic">${e.icon || "💿"}</span>
          <span class="nm">${e.name}<span class="sub">${e.sub || ""}</span></span>${tag}`;
        // tap = select; tapping the selected system again boots it (one tap on the pre-selected one)
        row.onclick = () => { cancelAuto(); if (i === sel) go(); else { sel = i; paint(); } };
        listEl.appendChild(row);
      });
      const e = entries[sel] || {};
      if (!busy) noteEl.textContent = e.note || "";
      cfgEl.innerHTML = e.name ? `<span>⚙ ${esc(cfgLine(e))}</span><button id="bm-cfgbtn">Change</button>` : "";
      const cb = cfgEl.querySelector("#bm-cfgbtn");
      if (cb) cb.onclick = () => { cancelAuto(); hooks.onSetup && hooks.onSetup({ tab: 1 }); };
      if (!busy) {
        const st = status(e);
        bootBtn.disabled = false;
        bootBtn.textContent = st && !st.ready ? "Download & Boot ▶" : "Boot " + (e.name || "") + " ▶";
      }
    }

    function go() {
      const e = entries[sel];
      if (!e || busy) return;
      if (e.kind === "setup") return hooks.onSetup && hooks.onSetup();
      bootEntry(e);
    }

    const fmtMB = b => (b / 1048576).toFixed(0);
    function showProgress(received, total, verb) {
      const pct = total > 0 ? Math.min(100, Math.floor(received / total * 100)) : 0;
      bootBtn.textContent = (verb || "Downloading") + " " + pct + "%…";
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
      busy = true; bootBtn.disabled = true;
      try { await bootEntry2(e); }
      finally { busy = false; if (alive()) { const msg = noteEl.innerHTML; paint(); noteEl.innerHTML = msg; } }   // keep an error on screen
    }
    async function bootEntry2(e) {
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

    // Auto-boot (UEFI Setup › Boot › Auto-boot): boots the last system after a countdown, but only one
    // that is already on the device, so an unattended iPad never starts a big download. Any key/tap stops it.
    function startAuto(store) {
      const secs = +cfg.autoBoot || 0, e = entries[sel];
      if (!secs || !e || !pref || e.id !== pref) return;
      if (!e.id.startsWith("import:")) { const s = systemStatus(e, store); if (!s.known || !s.ready) return; }
      count = secs;
      const tick = () => {
        if (!alive()) return cancelAuto();
        countEl.textContent = "Auto-boot " + e.name + " in " + count + "s — press any key to stop";
        if (count <= 0) { cancelAuto(); bootEntry(e); return; }
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

    bootBtn.onclick = () => { cancelAuto(); go(); };
    container.querySelector("#bm-setup").onclick = () => { cancelAuto(); hooks.onSetup && hooks.onSetup(); };

    // Initial paint (no imports yet), then enrich with imported ISOs.
    entries = build([]);
    const li = pref ? entries.findIndex(e => e.id === pref) : -1;
    sel = li >= 0 ? li : 0;
    paint();
    container.querySelector(".bm").addEventListener("pointerdown", () => cancelAuto(), true);
    Promise.all([listImported(), loadStore()]).then(([names, store]) => {
      if (!alive()) return;
      storeNow = store;
      entries = build(names);
      const i = pref ? entries.findIndex(e => e.id === pref) : -1;
      if (i >= 0) sel = i;
      paint(); startAuto(store);
    });
  }

  /* ------------------------------------------------------------------ *
   *  UEFI Setup — the firmware setup you don't normally see             *
   * ------------------------------------------------------------------ */
  function renderSetup(container, hooks) {
    hooks = hooks || {};
    ensureStyle();
    const DEF = { ram: 256, cores: 2, bootOrder: "cd-hd", netInternet: true, resumeState: true, bgRun: "About 30 s",
      cpuFeatures: ALL_CPU_FEATURES.slice(), isaChoice: "all", verboseBoot: false, autoBoot: 0, defaultBoot: "last", interp: "fast", jitPreset: "balanced", mitigationsOff: false, kernelExtra: "" };
    let s = Object.assign({}, DEF, readCfg());
    // default: every feature (one session runs programs built for any of them); the old SSE3/AVX2
    // choice of earlier builds is not carried over
    if (!Array.isArray(s.cpuFeatures)) s.cpuFeatures = ALL_CPU_FEATURES.slice();
    s.isaChoice = ["all", "std", "custom"].includes(s.isaMode) ? s.isaMode
      : !s.cpuFeatures.length ? "std" : ALL_CPU_FEATURES.every(f => s.cpuFeatures.includes(f)) ? "all" : "custom";
    const ecNow = emuCfg();
    const safeLevel = () => resetSafe ? 0 : Math.min(SAFE_NAMES.length - 1, Math.max(0, +((emuCfg().q64safe6 || {}).level) || 0));
    s.interp = ecNow.interp2 === "classic" ? "classic" : "fast";
    let resetSafe = false;
    // Reflect the emulator's actual internet + resume state (it stores these in its own config).
    try { const ec = emuCfg(); s.netInternet = (ec.netRelay !== "off"); s.resumeState = (ec.resumeState !== false); if (+ec.cores64) s.cores = +ec.cores64; s.gpuOn = ec.gpu !== "off"; } catch (e) {}
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

    const TABS = ["Main", "Advanced", "Boot", "Storage", "Tools", "Save & Exit"];
    let tab = Math.max(0, Math.min(TABS.length - 1, +hooks.tab || 0)), foc = 0;
    const bootLabel = { "cd-hd": "CD → Disk", "hd-cd": "Disk → CD", "cd": "CD only" };

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

    // Fields shown on both Main (Quick Setup) and Advanced: one setting, two places.
    function coresField() {
      return { t: "stepper", label: "CPU Cores", key: "cores", min: 1, max: 8, step: 1,
            sub: dev && dev.perfCores ? "this iPad has " + dev.perfCores + " fast cores — " + Math.min(8, dev.perfCores) + " recommended" : "Linux (Desktop & Terminal)",
            help: "Each emulated core runs on its own iPad core. " + (dev && dev.perfCores ? "This iPad has " + dev.perfCores + " performance cores and " + dev.effCores + " efficiency cores: up to " + dev.perfCores + " vCPUs all run on fast cores; more land on efficiency cores, which are several times slower, so single-thread speed drops and multi-thread gains little. " : "Cores beyond the iPad's performance cores land on its slower efficiency cores. ") + "More cores also run hotter and use more battery; 1 = battery saver. Linux (Desktop & Terminal) only, on the next boot. Android always uses 4 (its snapshot) and your own 32-bit images (v86) use 1." };
    }
    function isaField() {
      return { t: "select", label: "Instruction Set", sub: "Linux (Desktop & Terminal)", key: "isaChoice", opts: ["all", "std", "custom"], render: v => ({ all: "All", std: "Standard", custom: "Custom" })[v],
            help: "All (default): every instruction this emulator supports, at once — SSE4.1/4.2, POPCNT, AVX, AVX2, FMA, F16C, BMI1/2, LZCNT, MOVBE, AES-NI, PCLMULQDQ, SHA-NI, ADX, RDSEED — so one session runs programs built for any of them. Standard: only base x86-64 (SSE3). Custom: pick each one below. Speed: All runs as fast as Standard (CPU-Z, single and multi-core). AVX is emulated as two 128-bit halves, so a program's AVX code runs about as fast as its SSE code here, not faster. Custom is for testing how a program behaves without some of them. Applies on the next boot; Android keeps its own CPU (snapshot)." };
    }
    function ramField() {
      return { t: "stepper", label: "Guest RAM", sub: "minimum for every system", key: "ram", min: 256, max: 3584, step: 256, render: v => v <= 256 ? "Auto" : v + " MB",
            help: "Memory for the next boot. Auto = each system's own size (Linux 1.5 GB; Android uses a fixed size, and an imported Windows 9x disk always gets 256 MB). Raise it for big pip installs or many open apps — it doesn't make the CPU faster. If a guest fails to start, lower it." };
    }
    // "Recommended": the iPad's performance cores (4 if unknown), every instruction, Fast interpreter,
    // compile threshold 10000, Auto RAM - what measured fastest (single- and multi-core) on M-series iPads.
    function recommended() {
      return { cores: Math.max(2, Math.min(8, (dev && dev.perfCores) || 4)), ram: 256, isaChoice: "all", interp: "fast", jitPreset: "balanced" };
    }
    function isRecommended() {
      const r = recommended();
      return s.cores === r.cores && s.ram <= r.ram && s.isaChoice === "all" && s.interp === r.interp && s.jitPreset === r.jitPreset && !safeLevel();
    }

    function fields() {
      if (tab === 0) {
        const t = now(), rec = recommended(), inUse = isRecommended();
        return [
          { t: "sep", label: "Quick Setup" },
          { t: "action", label: inUse ? "Recommended Settings ✓" : "Use Recommended Settings", act: "recommend", icon: "gear",
            sub: (inUse ? "in use: " : "") + rec.cores + " cores · all instructions · fast engine" + (safeLevel() ? " · engine reset" : ""),
            help: "One tap to the settings measured fastest here: " + rec.cores + " CPU cores (" + (dev && dev.perfCores ? "this iPad's " + dev.perfCores + " performance cores" : "a safe number for any iPad") + "), every x86 instruction set, the Fast interpreter, compile threshold 10000 and automatic RAM" + (safeLevel() ? ", and the engine back at full speed after an earlier crash" : "") + ". Your network, power and boot choices are kept. Save & Exit to apply." },
          coresField(),
          isaField(),
          ...(s.isaChoice === "custom" ? [{ t: "action", label: "Choose Instructions…", act: "tab:1",
            sub: s.cpuFeatures.length + " of " + CPU_FEATURES.length + " on — in Advanced", help: "The list of instruction sets is on the Advanced tab." }] : []),
          ramField(),
          { t: "sep", label: "Firmware" },
          { t: "info", label: "Bootbox", value: store && store.version ? store.version + " (build " + store.build + ")" : "—" },
          { t: "info", label: "Emulators", value: "QEMU 8.2 (x86-64) · v86 (32-bit PCs)" },
          { t: "info", label: "Translation", value: "x86 → WebAssembly → ARM64" },
          { t: "sep", label: "Virtual Processor" },
          { t: "info", label: "CPU", value: s.isaChoice === "all" ? "x86-64 · all instructions (AVX2, FMA, AES, SHA…)" : s.isaChoice === "std" ? "x86-64 · standard (SSE3)"
            : "x86-64 · " + (s.cpuFeatures.length ? CPU_FEATURES.filter(x => s.cpuFeatures.includes(x.f)).map(x => x.label).join(" · ") : "SSE3") },
          { t: "info", label: "Engine", value: SAFE_NAMES[safeLevel()] + (safeLevel() ? " (after a crash)" : "") },
          { t: "sep", label: "This Device" },
          { t: "info", label: "Model", value: dev ? (dev.model + " · " + (dev.model === "iPad" ? "iPadOS " : "iOS ") + dev.osVersion) : (navigator.platform || "—") },
          { t: "info", label: "CPU cores", value: dev ? (dev.perfCores ? dev.cores + " (" + dev.perfCores + " performance + " + dev.effCores + " efficiency)" : String(dev.cores)) : String(navigator.hardwareConcurrency || "—") },
          { t: "info", label: "Memory", value: dev && dev.ram ? fmtBytes(dev.ram) + (dev.memLimitMB ? " · page limit " + fmtBytes(dev.memLimitMB * 1048576) : "") : "—" },
          { t: "sep", label: "Clock" },
          { t: "info", label: "System Date", value: t.date },
          { t: "info", label: "System Time", value: t.time },
        ];
      }
      if (tab === 1) {
        const lvl = safeLevel();
        return [
          { t: "sep", label: "Processor" },
          coresField(),
          isaField(),
          ...(s.isaChoice === "custom" ? [
            { t: "sep", label: "Instructions (Custom)" },
            ...CPU_FEATURES.map(x => ({ t: "feat", label: x.label, f: x.f, sub: x.use,
              help: x.label + ": " + x.use + ". The 64-bit Linux guests get it as QEMU -cpu +" + x.f + "." +
                (x.needs.length ? " Needs " + x.needs.map(n => CPU_FEATURES.find(y => y.f === n).label).join(" and ") + ", which switch on with it." : "") +
                " Programs only use what the CPU reports, so leaving one off is safe; a program built to require it will refuse to start. Applies on the next boot." })),
          ] : []),
          { t: "sep", label: "Memory" },
          ramField(),
          { t: "sep", label: "Emulation Engine" },
          { t: "select", label: "Interpreter", sub: "for code not compiled yet", key: "interp", opts: ["fast", "classic"], render: v => v === "fast" ? "Fast" : "Classic",
            help: "How the 64-bit systems run code before it is compiled. Fast (default): a compact interpreter WebKit fully optimizes — steady speed. Classic: the older one (in WebKit some runs slow to a crawl). Same setting as the emulator toolbar. Applies on the next boot." },
          { t: "select", label: "Compile Threshold", sub: "runs before a block is compiled", key: "jitPreset", opts: ["eager", "balanced", "lazy"], render: v => ({ eager: "3000", balanced: "10000", lazy: "30000" })[v],
            help: "How often a block of guest code runs (interpreted) before it is translated to WebAssembly. 10000 (default) measured fastest on WebKit; 3000 compiles more (more WebKit compile work, more memory); 30000 interprets longer. Applies on the next boot." },
          { t: "toggle", label: "GPU Acceleration", sub: "Linux (Desktop): OpenGL on the iPad's GPU", key: "gpuOn",
            help: "On (default): OpenGL programs in Linux (Desktop) — glmark2, the GPU benchmark, 3D apps — draw on the iPad's GPU through the Bootbox GPU bridge (WebGL), and the emulated CPU only prepares the commands. Off: everything is drawn by Mesa's software renderer (llvmpipe) on the emulated CPU, as before. If WebGL is not available, Linux uses the software renderer by itself. One OpenGL program uses the GPU at a time; a second one opened at the same time draws in software. Applies on the next boot." },
          { t: "info", label: "Engine Level", value: SAFE_NAMES[lvl] + (lvl ? " — set after a crash" : "") },
          ...(lvl ? [{ t: "action", label: "Reset Engine to Full Speed", act: "resetsafe",
            help: "When a 64-bit system crashes the page early in its boot, Bootbox turns off engine features one step at a time on the next boots and keeps the first level that runs — it never steps back up by itself. If a crash came from something else (too many cores or too much RAM for this device), the guest stays slow for nothing. Reset to try full speed again." }] : []),
          { t: "sep", label: "Linux Kernel" },
          { t: "note", text: "Linux (Desktop) and Linux (Terminal) boot a real Linux 6.1 kernel. These options change its command line for the next boot — like editing a GRUB entry. Android and the Windows images don't use them. If a boot goes wrong, switch them back here (or clear the extra parameters) and boot again." },
          { t: "toggle", label: "CPU Vulnerability Mitigations", sub: "Spectre / Meltdown workarounds inside the guest", key: "__mit", value: !s.mitigationsOff,
            help: "On: the guest kernel's default workarounds for Spectre-type CPU bugs — retpolines (every indirect call in the kernel goes through a return-trick sequence) and return-buffer filling on each task switch. Off adds mitigations=off. They target speculation inside a real x86 CPU; Bootbox's emulated CPU doesn't speculate, so here they protect nothing. Measured here, turning them off saves very little: about 2-3% of the work in system calls and none in starting programs (the emulated CPU is an AMD model, which needs only the light retpoline workaround). Applies on the next boot." },
          { t: "toggle", label: "Show All Kernel Messages", sub: "verbose boot (loglevel=7)", key: "verboseBoot",
            help: "Prints every kernel message while Linux boots (adds loglevel=7; normally only warnings show). You see them in Linux (Terminal)'s console — useful when a boot stops somewhere and you want to see where. Printing costs a little boot time. Applies on the next boot." },
          { t: "text", label: "Extra Kernel Parameters", key: "kernelExtra", placeholder: "e.g. maxcpus=2",
            sub: (() => { const k = kernelWords(s.kernelExtra); return k.dropped.length ? "ignored: " + k.dropped.join(" ") : k.keep.length ? "adds: " + k.keep.join(" ") : "none"; })(),
            help: "Words added to the Linux command line on the next boot. Useful here: maxcpus=2 — Linux uses only 2 of the VM's cores; mem=1G — Linux uses less of the VM's RAM; nokaslr — fixed kernel addresses (for debugging); ignore_loglevel — print every kernel message. Take name=value options or known flags like nokaslr. A bare word the kernel doesn't know would be handed to the guest's init and stop the boot, so such words — and init=, root=, console= (Bootbox's own) — are ignored and listed under the name. Leave empty normally." },
          { t: "sep", label: "Network" },
          { t: "toggle", label: "Guest Internet", key: "netInternet", help: "Connects the guests' network card to the internet through Bootbox's built-in relay. Turn off for a fully offline VM." },
          { t: "sep", label: "Power" },
          { t: "select", label: "Run in Background", key: "bgRun", opts: ["About 30 s", "Off"], render: v => v === "Off" ? "Off" : "30 s",
            help: "When you switch to another app, iOS pauses Bootbox. '30 s' lets the guest keep running for the short time iOS allows (to finish a save or a download step); 'Off' pauses at once. Either way the guest stays in memory and continues when you come back." },
        ];
      }
      if (tab === 2) return [
        { t: "sep", label: "Startup" },
        { t: "select", native: true, label: "Default System", sub: "selected when Bootbox opens", key: "defaultBoot", opts: ["last", ...SYSTEMS.map(x => x.id)],
          render: v => v === "last" ? "The one used last" : (SYSTEMS.find(x => x.id === v) || {}).name,
          help: "Which system the boot menu selects (and auto-boots, if Auto-boot is on) when Bootbox opens." },
        { t: "select", label: "Auto-boot", sub: "boot the default system after a countdown", key: "autoBoot", opts: [0, 5, 10], render: v => +v ? v + " s" : "Off",
          help: "Boot the default system after a short countdown when Bootbox opens (tap or press a key to stop it). Only a system that is already downloaded is auto-booted." },
        { t: "select", label: "Boot Order", sub: "your own images (v86)", key: "bootOrder", opts: ["cd-hd", "hd-cd", "cd"], render: v => bootLabel[v],
          help: "The order in which the 32-bit PC tries its boot devices for your imported images." },
        { t: "toggle", label: "Resume Saved State", key: "resumeState", help: "On: a VM with a saved state (💾 Save) resumes where you left off. Off: always start fresh, ignoring saved states." },
      ];
      if (tab === 3) return storageFields();
      if (tab === 4) return [
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
        ...SYSTEMS.map(x => ({ t: "action", label: x.name, sub: "save and boot now", act: "boot:" + x.id, icon: x.svg, help: x.note })),
      ];
    }

    container.innerHTML = `<div class="fw">
      ${topBar("UEFI Setup", "u-ver")}
      <nav class="u2-tabs" id="u-tabs"></nav>
      <div class="u2-body"><div class="u2-panel" id="u-panel"></div><aside class="u2-help" id="u-help"></aside></div>
      <footer class="fw-foot">
        <span class="fw-keys">←→ tab · ↑↓ item · ⏎ change · F9 defaults · F10 save · Esc back</span>
        <span class="fw-grow"></span>
        <span class="fw-dirty" id="u-dirty"></span>
        <button class="fw-btn" id="u-discard">Discard</button>
        <button class="fw-btn" id="u-save">Save &amp; Exit</button>
        <button class="fw-btn primary" id="u-boot" style="display:none"></button>
      </footer>
    </div>`;
    startClock(container);
    const tabsEl = container.querySelector("#u-tabs");
    const panelEl = container.querySelector("#u-panel");
    const helpEl = container.querySelector("#u-help");
    const alive = () => !!container.querySelector("#u-panel");
    container.querySelector("#u-save").onclick = () => doAction("save");
    container.querySelector("#u-discard").onclick = () => doAction("discard");
    // Save & Boot: straight into the system the boot menu would pick (Default System, else the last one)
    const dirtyEl = container.querySelector("#u-dirty"), bootBtnS = container.querySelector("#u-boot");
    const prefId = (() => { const c = readCfg(); return c.defaultBoot && c.defaultBoot !== "last" ? c.defaultBoot : c.lastBoot; })();
    const prefSys = SYSTEMS.find(x => x.id === prefId) || SYSTEMS[0];
    bootBtnS.style.display = "";
    const shortName = { x64pwd: "Desktop", x64pw: "Terminal", android64: "Android" }[prefSys.id] || prefSys.name;
    bootBtnS.textContent = "Save & Boot " + shortName + " ▶";
    bootBtnS.title = "Save the settings and start " + prefSys.name;
    bootBtnS.onclick = () => doAction("boot:" + prefSys.id);
    // unsaved-changes marker: the settings as they were when Setup opened (or after the async reads)
    const snap = () => JSON.stringify([s.ram, s.cores, s.bootOrder, s.netInternet, s.resumeState, s.bgRun, s.cpuFeatures, s.isaChoice,
      s.verboseBoot, s.autoBoot, s.defaultBoot, s.interp, s.jitPreset, s.mitigationsOff, String(s.kernelExtra || "").trim(), resetSafe]);
    let base = null;
    const dirty = () => base !== null && snap() !== base;

    const focusable = (fs) => fs.map((f, i) => (["sep", "info", "note", "meter"].includes(f.t) ? -1 : i)).filter(i => i >= 0);

    function setHelp(f) {
      if (f && f.help) {
        helpEl.innerHTML = "<b>" + esc(f.label) + "</b>" + esc(f.help);
      } else {
        helpEl.innerHTML = "<b>Bootbox Setup</b>Tap a setting to change it. Changes apply when you <b style='display:inline;font-size:inherit'>Save &amp; Exit</b>.";
      }
    }

    // a few rows show/edit something that isn't a plain setting
    const getV = (f) => f.key === "__mit" ? !s.mitigationsOff : s[f.key];
    function setV(f, v) {
      if (f.key === "__mit") s.mitigationsOff = !v;
      else s[f.key] = v;
      if (f.key === "isaChoice") s.cpuFeatures = v === "all" ? ALL_CPU_FEATURES.slice() : v === "std" ? [] : s.cpuFeatures.slice();
    }
    // CPU features: on = also what it needs; off = also what needs it
    function setFeature(flag, on) {
      const set = new Set(s.cpuFeatures);
      const add = (x) => { if (set.has(x)) return; set.add(x); (CPU_FEATURES.find(y => y.f === x) || { needs: [] }).needs.forEach(add); };
      const del = (x) => { if (!set.has(x)) return; set.delete(x); CPU_FEATURES.filter(y => y.needs.includes(x)).forEach(y => del(y.f)); };
      on ? add(flag) : del(flag);
      s.cpuFeatures = ALL_CPU_FEATURES.filter(x => set.has(x));
    }
    function control(f) {
      const v = getV(f);
      if (f.t === "feat") return `<span class="u2-sw${s.cpuFeatures.includes(f.f) ? " on" : ""}"></span>`;
      if (f.t === "toggle") return `<span class="u2-sw${v ? " on" : ""}"></span>`;
      if (f.t === "text") return `<input class="u2-text" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="200" placeholder="${esc(f.placeholder || "")}" value="${esc(v || "")}">`;
      if (f.t === "select" && f.native) return `<select class="u2-select">${f.opts.map(o => `<option value="${esc(o)}"${String(o) === String(v) ? " selected" : ""}>${esc(f.render ? f.render(o) : o)}</option>`).join("")}</select>`;
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
          <span class="u2-lab"><b>${esc(f.label)}</b>${f.sub ? `<small>${esc(f.sub)}</small>` : ""}</span>
          ${control(f)}</div>`;
      });
      close();
      panelEl.innerHTML = html;
      panelEl.querySelectorAll(".u2-row").forEach(row => {
        const i = +row.dataset.i, f = fs[i];
        row.onmouseenter = () => setHelp(f);
        const inp = row.querySelector(".u2-text");
        if (inp) {
          inp.oninput = () => { s[f.key] = inp.value.replace(/[^a-zA-Z0-9_.,=\- ]/g, ""); };
          inp.onchange = () => { inp.oninput(); paint(); };   // repaint: the row's "adds / ignored" line
        }
        const sel = row.querySelector(".u2-select");
        if (sel) sel.onchange = () => { setV(f, f.opts.find(x => String(x) === sel.value)); setHelp(f); paint(); };
        row.onclick = (ev) => {
          foc = Math.max(0, fo.indexOf(i));
          const o = ev.target.closest("[data-o]"), d = ev.target.closest("[data-d]"), del = ev.target.closest(".u2-del");
          if (ev.target.closest("input, select")) { setHelp(f); return; }
          if (o && f.t === "select") { const opt = f.opts.find(x => String(x) === o.dataset.o); setV(f, opt); setHelp(f); paint(); return; }
          if (d && f.t === "stepper") { s[f.key] = clamp(s[f.key] + (+d.dataset.d) * f.step, f.min, f.max); setHelp(f); paint(); return; }
          if (del && f.t === "file") { if (!del.disabled) askDelete(f); setHelp(f); return; }
          if (f.t === "file") { setHelp(f); paint(); return; }
          activate(f);
        };
      });
      setHelp(fs[focIdx]);
      const d = dirty();
      dirtyEl.textContent = d ? "● Unsaved changes" : "";
      container.querySelector("#u-save").classList.toggle("primary", d);
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
      if (f.t === "toggle") { setV(f, !getV(f)); paint(); }
      else if (f.t === "feat") { setFeature(f.f, !s.cpuFeatures.includes(f.f)); paint(); }
      else if (f.t === "select") { const i = f.opts.findIndex(o => String(o) === String(getV(f))); setV(f, f.opts[(i + 1) % f.opts.length]); paint(); }
      else if (f.t === "text") { const inp = panelEl.querySelector(".u2-row.foc .u2-text"); if (inp) inp.focus(); }
      else if (f.t === "stepper") { s[f.key] = s[f.key] >= f.max ? f.min : clamp(s[f.key] + f.step, f.min, f.max); paint(); }
      else if (f.t === "file") { if (!f.lock && !busyDel) askDelete(f); }
      else if (f.t === "action") doAction(f.act);
    }

    function persist() {
      writeCfg({ ram: s.ram, bootOrder: s.bootOrder, netInternet: s.netInternet, resumeState: s.resumeState,
        bgRun: s.bgRun, autoBoot: +s.autoBoot || 0, defaultBoot: s.defaultBoot || "last",
        cpuFeatures: s.cpuFeatures.slice(), isaMode: s.isaChoice, isa: s.cpuFeatures.includes("avx2") ? "AVX2 (x86-64-v3)" : "SSE3 (standard)",
        jitPreset: s.jitPreset, mitigationsOff: !!s.mitigationsOff, verboseBoot: !!s.verboseBoot, kernelExtra: String(s.kernelExtra || "").trim() });
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
        if (s.gpuOn === false) ec.gpu = "off"; else delete ec.gpu;   // read by emulator.js (desktop: -device bbgpu)
        // the interpreter is the toolbar's setting too; a new pick restarts the crash fallback, as there
        if ((ec.interp2 === "classic" ? "classic" : "fast") !== s.interp) { ec.interp2 = s.interp; ec.q64safe6 = { level: 0 }; }
        if (resetSafe) ec.q64safe6 = { level: 0 };
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
      else if (act && act.indexOf("tab:") === 0) { tab = +act.slice(4) || 0; foc = 0; disarm(); paint(); panelEl.scrollTop = 0; }
      else if (act === "recommend") {
        Object.assign(s, recommended(), { cpuFeatures: ALL_CPU_FEATURES.slice() });
        if (safeLevel()) resetSafe = true;
        paint();
        setHelp({ label: "Recommended settings set", help: "Save & Exit (or Save & Boot) to use them." });
      }
      else if (act === "resetsafe") {
        resetSafe = true;
        try { const ec = emuCfg(); ec.q64safe6 = { level: 0 }; VFS.write("/Apps/.emulator.json", JSON.stringify(ec)); } catch (e) {}
        foc = 0; paint();
        setHelp({ label: "Engine reset", help: "The next 64-bit boot runs at full speed again. If that boot crashes the page, Bootbox steps down once more by itself." });
      }
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
      if (e.target && e.target.closest && e.target.closest("input, select, textarea")) return;   // typing in a field
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

    base = snap();
    paint();
    if (onDevice()) {
      Bridge.call("system", "getBackgroundGrace").then(g => {
        const sec = (typeof g === "number") ? g : (g && g.result);
        if (sec != null) { const clean = !dirty(); s.bgRun = sec === 0 ? "Off" : "About 30 s"; if (clean) base = snap(); if (alive()) paint(); }
      }).catch(() => {});
      Bridge.call("system", "info", {}).then(r => { dev = (r && r.model) ? r : (r && r.result) || null; if (alive()) paint(); }).catch(() => {});
      refreshStore();
    }
  }

  window.BiosMenu = { renderMenu, renderSetup };
})();
