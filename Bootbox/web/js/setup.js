/* ============================================================================
 * First-run setup wizard (OOBE). Shown once (until nvram.setupDone) to pick
 * device name, theme/accent, wallpaper, and an optional PIN.
 * ========================================================================== */
(function () {
  function run(onDone) {
    const n = Kernel.nvram;
    const el = document.createElement("div");
    el.id = "setup";
    el.style.cssText = "position:fixed;inset:0;z-index:100050;color:#fff;font-family:'Segoe UI',system-ui,sans-serif;" +
      "background:linear-gradient(135deg,#0a2540,#06121f);display:flex;align-items:center;justify-content:center";
    document.getElementById("machine").appendChild(el);

    let step = 0;
    const steps = ["welcome", "name", "look", "wall", "pin", "done"];

    function card(inner) {
      el.innerHTML = `<div style="width:480px;max-width:90%;background:rgba(255,255,255,.06);border-radius:16px;
        padding:34px;box-shadow:0 20px 60px rgba(0,0,0,.5)">${inner}
        <div style="display:flex;justify-content:space-between;margin-top:28px">
          <button id="bk" class="su-btn" style="background:transparent">${step ? "Back" : ""}</button>
          <button id="nx" class="su-btn">${step === steps.length - 1 ? "Finish" : "Next"}</button>
        </div></div>
        <style>.su-btn{padding:10px 22px;border:none;border-radius:8px;background:var(--accent);color:#fff;font-size:14px;cursor:pointer}
        .su-field{width:100%;height:42px;border-radius:8px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.1);
          color:#fff;padding:0 14px;font-size:15px;outline:none}</style>`;
      el.querySelector("#bk").onclick = () => { if (step) { step--; render(); } };
      el.querySelector("#nx").onclick = next;
    }

    function render() {
      const s = steps[step];
      if (s === "welcome") card(`<div style="font-size:42px;text-align:center">🪟</div>
        <h2 style="text-align:center;margin:10px 0">Welcome to MiniOS</h2>
        <p style="opacity:.8;text-align:center">Let's set up your device. This only takes a moment.</p>`);
      else if (s === "name") card(`<h2>Name your device</h2>
        <p style="opacity:.7;font-size:13px">Shown in Settings, Terminal and the lock screen.</p>
        <input id="dn" class="su-field" value="${n.deviceName}" maxlength="20">`);
      else if (s === "look") card(`<h2>Choose your look</h2>
        <div style="margin:14px 0">Theme:
          <button class="su-btn" id="th" style="margin-left:8px;background:rgba(255,255,255,.15)">${n.theme}</button></div>
        <div>Accent:
          ${["#0078d4","#00b894","#e84393","#fdcb6e","#6c5ce7","#d63031"].map(c =>
            `<span class="ac" data-c="${c}" style="display:inline-block;width:30px;height:30px;border-radius:50%;margin:6px;cursor:pointer;background:${c};border:3px solid ${n.accent===c?'#fff':'transparent'}"></span>`).join("")}</div>`);
      else if (s === "wall") card(`<h2>Pick a wallpaper</h2>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:12px">
          ${Object.entries(Kernel.wallpapers).map(([k,css]) =>
            `<div class="wl" data-k="${k}" style="height:54px;border-radius:8px;cursor:pointer;background:${css};background-size:cover;border:2px solid ${n.wallpaper===k?'#fff':'transparent'}"></div>`).join("")}</div>`);
      else if (s === "pin") card(`<h2>Set a PIN (optional)</h2>
        <p style="opacity:.7;font-size:13px">Leave blank to sign in without a PIN.</p>
        <input id="pin" class="su-field" type="password" inputmode="numeric" placeholder="Choose a PIN" value="${n.pin||''}">`);
      else if (s === "done") card(`<div style="font-size:42px;text-align:center">✅</div>
        <h2 style="text-align:center">You're all set, ${n.deviceName}!</h2>
        <p style="opacity:.8;text-align:center">MiniOS is ready to use.</p>`);

      // wire step-specific controls
      const th = el.querySelector("#th");
      if (th) th.onclick = () => { n.theme = n.theme === "dark" ? "light" : "dark"; Kernel.applyTheme(); th.textContent = n.theme; };
      el.querySelectorAll(".ac").forEach(a => a.onclick = () => { n.accent = a.dataset.c; Kernel.applyTheme(); render(); });
      el.querySelectorAll(".wl").forEach(w => w.onclick = () => { n.wallpaper = w.dataset.k; Kernel.applyWallpaper(); render(); });
    }

    function next() {
      const s = steps[step];
      if (s === "name") { const v = el.querySelector("#dn").value.trim(); if (v) n.deviceName = v; }
      if (s === "pin") { n.pin = el.querySelector("#pin").value.trim(); }
      if (step === steps.length - 1) {
        n.setupDone = true; Kernel.saveNVRAM(); el.remove(); onDone && onDone(); return;
      }
      step++; render();
    }

    render();
  }

  window.Setup = { run };
})();
