/* ============================================================================
 * Bootbox — models a real PC's firmware. Three full-screen states, no fake
 * desktop / window manager:
 *   • Boot Menu  — "select operating system" (the page you normally see).
 *   • UEFI Setup — firmware setup (the page you don't normally see; entered by
 *                  choosing Setup / pressing S).
 *   • Emulator   — the running x86 VM. Its "‹ BIOS" button comes back here.
 * ========================================================================== */
(function () {
  function root() {
    let r = document.getElementById("bb-root");
    if (!r) {
      r = document.createElement("div");
      r.id = "bb-root";
      r.style.cssText = "position:fixed;inset:0;z-index:9000;background:#05080f;overflow:hidden;" +
        "font-family:'Cascadia Mono',Consolas,monospace";
      document.body.appendChild(r);
    }
    r.style.display = "block";
    return r;
  }

  function fail(r, what, e) {
    r.innerHTML = "<pre style='color:#ff8e8e;padding:24px;font:13px/1.5 monospace;white-space:pre-wrap'>" +
      what + " failed:\n" + ((e && (e.stack || e.message)) || e) + "</pre>";
  }

  const Bootbox = {
    // The boot manager: pick which OS to boot, or drop into Setup.
    showBootMenu() {
      const r = root(); r.innerHTML = "";
      try {
        BiosMenu.renderMenu(r, {
          onBoot: (a) => Bootbox.runVM(a),
          onSetup: () => Bootbox.showSetup(),
        });
      } catch (e) { fail(r, "Boot menu", e); }
    },
    // The firmware setup (normally hidden). Save/Exit returns to the boot menu;
    // a Boot Override can launch a system straight from here.
    showSetup() {
      const r = root(); r.innerHTML = "";
      try {
        BiosMenu.renderSetup(r, {
          onBack: () => Bootbox.showBootMenu(),
          onBoot: (a) => Bootbox.runVM(a),
        });
      } catch (e) { fail(r, "UEFI Setup", e); }
    },
    // Full-screen emulator. "‹ BIOS" returns to the boot menu.
    runVM(args) {
      const r = root(); r.innerHTML = "";
      const a = Object.assign({}, args || {}, { onExit: () => Bootbox.showBootMenu() });
      try { Emulator.renderFull(r, a); } catch (e) { fail(r, "Emulator", e); }
    },
    hide() { const r = document.getElementById("bb-root"); if (r) r.style.display = "none"; },

    // Back-compat alias (older callers).
    showBios() { Bootbox.showBootMenu(); },
  };

  window.Bootbox = Bootbox;
})();
