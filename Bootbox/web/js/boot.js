/* ============================================================================
 * Boot — Bootbox firmware POST splash, then straight to the full-screen BIOS
 * boot screen (Bootbox.showBios) and on into the emulator. No fake desktop /
 * window manager. Tap the power button during POST to jump into BIOS setup.
 * ========================================================================== */
(function () {
  const el = () => document.getElementById("boot");
  let interrupted = false;

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  const Boot = {
    async post() {
      interrupted = false;
      document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
      el().classList.remove("hidden");
      el().innerHTML = `
        <div class="boot-stage">
          <div class="logo"><span></span><span></span><span></span><span></span></div>
          <div class="wordmark">Boot<b>box</b></div>
          <div class="dots"><i></i><i></i><i></i><i></i><i></i><i></i></div>
          <div class="boot-msg">Power-on self test…</div>
        </div>
        <div class="boot-hint">Bootbox firmware · x86 (i686) · press power / F2 to enter Setup</div>`;
      const msg = el().querySelector(".boot-msg");
      const stages = ["Power-on self test…", "Detecting x86 (i686) core", "Probing virtual devices", "Loading boot manager"];
      for (let i = 0; i < stages.length; i++) {
        if (interrupted) return;
        msg.textContent = stages[i];
        await sleep(300 + (Kernel.nvram.bootDelay || 1) * 90);
      }
      if (!interrupted) Boot.start();
    },
    interrupt() {
      // Pressing power/F2 during POST drops into UEFI Setup — the firmware
      // screen you don't normally see (like a real PC).
      if (el().classList.contains("hidden")) return false;
      interrupted = true;
      document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
      try { Bootbox.showSetup(); } catch (e) { console.error("Setup failed:", e); }
      return true;
    },
    start() {
      interrupted = true; // stop any pending POST handoff
      document.querySelectorAll(".screen").forEach(s => s.classList.add("hidden"));
      try { if (Kernel.nvram.sound) chime(); } catch (e) {}
      try {
        // A one-shot reboot (set by the emulator when it reloads the page to apply new CPU-core / RAM
        // settings to a 64-bit guest) takes priority: resume straight into that guest and auto-boot.
        let reboot = null;
        try { reboot = sessionStorage.getItem("bootbox.reboot"); } catch (e) {}
        if (reboot) {
          try { sessionStorage.removeItem("bootbox.reboot"); } catch (e) {}
          let p; try { p = JSON.parse(reboot); } catch (e) { p = { guest: reboot }; }
          Bootbox.runVM({ guest: p.guest, cores: p.cores, ram: p.ram, autoboot: true });
        }
        // Land on the boot manager ("select operating system"). nvram.bootGuest
        // skips the menu and boots a fixed guest straight away.
        else if (Kernel.nvram.bootGuest) {
          Bootbox.runVM({ guest: Kernel.nvram.bootGuest, autoboot: true });
        } else {
          Bootbox.showBootMenu();
        }
      } catch (e) { console.error("Bootbox start failed:", e); }
    },
  };

  function chime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((f, i) => {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.value = f; o.type = "sine";
        o.connect(g); g.connect(ctx.destination);
        const t = ctx.currentTime + i * 0.12;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.15, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
        o.start(t); o.stop(t + 0.32);
      });
    } catch (e) {}
  }

  window.Boot = Boot;
})();
