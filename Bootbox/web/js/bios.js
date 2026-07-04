/* ============================================================================
 * BIOS / Firmware Setup — controls the minimal things the machine can do
 * before MiniOS boots: theme, accent, boot delay, device name, sound, and
 * which paravirtual devices are enabled. Settings persist in NVRAM (host disk).
 *
 * Reachable by tapping the power button briefly during POST, or from
 * Start menu -> Restart -> "Enter Setup", or the on-screen [F2] button.
 * ========================================================================== */
(function () {
  const el = () => document.getElementById("bios");
  let sel = 0;
  let rows = [];

  function buildRows() {
    const n = Kernel.nvram;
    rows = [
      { label: "System Theme", get: () => n.theme, cycle: () => n.theme = n.theme === "dark" ? "light" : "dark",
        help: "Switch MiniOS between dark and light appearance." },
      { label: "Accent Color", get: () => n.accent, cycle: () => {
          const palette = ["#0078d4", "#00b894", "#e84393", "#fdcb6e", "#6c5ce7", "#d63031"];
          n.accent = palette[(palette.indexOf(n.accent) + 1) % palette.length];
        }, help: "Primary highlight color used across the desktop." },
      { label: "Boot Delay (s)", get: () => String(n.bootDelay), cycle: () => n.bootDelay = (n.bootDelay + 1) % 6,
        help: "How long POST waits before starting MiniOS." },
      { label: "Startup Sound", get: () => n.sound ? "Enabled" : "Disabled", cycle: () => n.sound = !n.sound,
        help: "Play a chime when MiniOS finishes booting." },
      { label: "Device Name", get: () => n.deviceName, cycle: () => {
          const names = ["MINIOS-PC", "TABLET-01", "EULER-PAD", "WORKSTATION"];
          n.deviceName = names[(names.indexOf(n.deviceName) + 1) % names.length];
        }, help: "Hostname shown in Settings and Terminal." },
      // paravirtual devices
      ...["gpu", "audio", "network", "camera", "ml"].map(dev => ({
        label: "Device: " + dev.toUpperCase(),
        get: () => n.devices[dev] ? "On" : "Off",
        cycle: () => n.devices[dev] = !n.devices[dev],
        help: "Enable the virtual " + dev + " device and its host bridge.",
      })),
    ];
  }

  function render() {
    const n = Kernel.nvram;
    buildRows();
    const half = Math.ceil(rows.length / 2);
    const renderPane = (slice, base) => slice.map((r, i) => {
      const idx = base + i;
      return `<div class="bios-row ${idx === sel ? "sel" : ""}" data-i="${idx}">
        <span>${r.label}</span><span class="bios-val">${r.get()}</span></div>`;
    }).join("");

    el().innerHTML = `
      <div class="bios-title">MiniOS Firmware Setup &mdash; v0.1</div>
      <div class="bios-cols">
        <div class="bios-pane">
          <h3>Main</h3>
          ${renderPane(rows.slice(0, half), 0)}
        </div>
        <div class="bios-pane">
          <h3>Virtual Devices</h3>
          ${renderPane(rows.slice(half), half)}
        </div>
      </div>
      <div class="bios-help">${rows[sel] ? rows[sel].help : ""}</div>
      <div>
        <span class="bios-btn" data-act="toggle">Change (Enter / tap value)</span>
        <span class="bios-btn" data-act="defaults">Load Defaults</span>
        <span class="bios-btn" data-act="save">Save &amp; Exit (boot)</span>
      </div>
      <div class="bios-footer">
        <span>↑/↓ Select</span><span>Enter Change</span>
        <span>CPU: Virtual 1-core</span>
        <span>RAM: 256 MB (virtual)</span>
        <span>Disk: Host-backed</span>
      </div>`;

    el().querySelectorAll(".bios-row").forEach(row => {
      row.onclick = () => { sel = +row.dataset.i; rows[sel].cycle(); render(); };
    });
    el().querySelectorAll(".bios-btn").forEach(b => {
      b.onclick = () => {
        const act = b.dataset.act;
        if (act === "toggle") { rows[sel].cycle(); render(); }
        else if (act === "defaults") { loadDefaults(); render(); }
        else if (act === "save") BIOS.exit();
      };
    });
  }

  function loadDefaults() {
    Object.assign(Kernel.nvram, {
      theme: "dark", accent: "#0078d4", bootDelay: 1, sound: true, deviceName: "MINIOS-PC",
      devices: { gpu: true, audio: true, network: true, camera: false, ml: false },
    });
  }

  function onKey(e) {
    if (el().classList.contains("hidden")) return;
    if (e.key === "ArrowDown") { sel = (sel + 1) % rows.length; render(); }
    else if (e.key === "ArrowUp") { sel = (sel - 1 + rows.length) % rows.length; render(); }
    else if (e.key === "Enter") { rows[sel].cycle(); render(); }
    else if (e.key === "F10") BIOS.exit();
  }

  const BIOS = {
    enter() {
      sel = 0;
      document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
      el().classList.remove("hidden");
      render();
      window.addEventListener("keydown", onKey);
    },
    exit() {
      window.removeEventListener("keydown", onKey);
      Kernel.applyTheme();
      Kernel.saveNVRAM();
      el().classList.add("hidden");
      Boot.start(); // continue boot into MiniOS
    },
  };

  window.BIOS = BIOS;
})();
