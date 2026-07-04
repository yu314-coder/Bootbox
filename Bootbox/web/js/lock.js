/* ============================================================================
 * Lock / Login screen + power menu (sleep, lock, restart, shut down, sign out).
 * Win10-style: lock screen with clock -> click/Enter -> login -> desktop.
 * ========================================================================== */
(function () {
  let el = null;

  function ensureEl() {
    if (el) return el;
    el = document.createElement("div");
    el.id = "lockscreen";
    el.style.cssText = "position:fixed;inset:0;z-index:100000;display:none;color:#fff;" +
      "font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden";
    document.getElementById("machine").appendChild(el);
    return el;
  }

  function bg() {
    const v = Kernel.nvram.wallpaper || "aurora";
    return (Kernel.wallpapers && Kernel.wallpapers[v]) || v;
  }

  function showLockFace(onUnlock) {
    const e = ensureEl();
    e.style.display = "block";
    e.innerHTML = `
      <div style="position:absolute;inset:0;background:${bg()};background-size:cover"></div>
      <div style="position:absolute;inset:0;background:rgba(0,0,0,.25)"></div>
      <div id="lk-face" style="position:absolute;inset:0;display:flex;flex-direction:column;
        align-items:center;justify-content:flex-end;padding-bottom:120px;cursor:pointer">
        <div id="lk-time" style="font-size:84px;font-weight:300;text-shadow:0 2px 12px rgba(0,0,0,.6)"></div>
        <div id="lk-date" style="font-size:22px;opacity:.9;text-shadow:0 2px 8px rgba(0,0,0,.6)"></div>
        <div style="margin-top:30px;opacity:.7;font-size:13px">Click or press Enter to unlock</div>
      </div>`;
    const upd = () => {
      const d = new Date();
      e.querySelector("#lk-time").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      e.querySelector("#lk-date").textContent = d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
    };
    upd(); const iv = setInterval(upd, 1000);
    const go = () => { clearInterval(iv); showLogin(onUnlock); };
    e.querySelector("#lk-face").onclick = go;
    const onKey = (ev) => { if (ev.key === "Enter") { window.removeEventListener("keydown", onKey); go(); } };
    window.addEventListener("keydown", onKey);
  }

  function showLogin(onUnlock) {
    const e = ensureEl();
    e.style.display = "block";
    const pin = Kernel.nvram.pin || "";
    e.innerHTML = `
      <div style="position:absolute;inset:0;background:${bg()};background-size:cover;filter:brightness(.8)"></div>
      <div style="position:absolute;inset:0;background:rgba(0,0,0,.35)"></div>
      <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
        <div style="width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.15);
          display:flex;align-items:center;justify-content:center;font-size:60px">👤</div>
        <div style="font-size:24px">${Kernel.nvram.deviceName || "User"}</div>
        ${pin ? `<input id="lk-pin" type="password" inputmode="numeric" placeholder="PIN"
          style="width:200px;text-align:center;height:40px;border-radius:20px;border:1px solid rgba(255,255,255,.3);
          background:rgba(255,255,255,.12);color:#fff;font-size:16px;outline:none">` : ""}
        <button id="lk-signin" style="margin-top:6px;padding:10px 28px;border:none;border-radius:8px;
          background:var(--accent);color:#fff;font-size:15px;cursor:pointer">Sign in</button>
        <div id="lk-err" style="color:#ff8a8a;font-size:13px;height:16px"></div>
      </div>`;
    const signIn = () => {
      if (pin) {
        const v = e.querySelector("#lk-pin").value;
        if (v !== pin) { e.querySelector("#lk-err").textContent = "Incorrect PIN"; return; }
      }
      e.style.display = "none";
      if (Kernel.nvram.sound) {} // chime handled at boot
      if (onUnlock) onUnlock();
    };
    e.querySelector("#lk-signin").onclick = signIn;
    const p = e.querySelector("#lk-pin");
    if (p) { p.focus(); p.addEventListener("keydown", (ev) => { if (ev.key === "Enter") signIn(); }); }
  }

  const Lock = {
    // shown at boot: lock face then login, then reveal desktop.
    // autoUnlock (kiosk / auto-login) skips the lock+login when no PIN is set.
    boot(onReady) {
      if (Kernel.nvram.autoUnlock && !Kernel.nvram.pin) { onReady && onReady(); return; }
      showLockFace(onReady);
    },
    lock() { showLockFace(() => {}); },
    signOut() {
      // close all windows then show login
      WM.list().forEach(w => WM.close(w.id));
      showLogin(() => {});
    },
    restart() { location.reload(); },
    shutdown() {
      const e = ensureEl();
      e.style.display = "block";
      e.innerHTML = `<div style="position:absolute;inset:0;background:#000;color:#888;display:flex;
        flex-direction:column;align-items:center;justify-content:center;gap:20px;font-family:sans-serif">
        <div style="font-size:18px">Shutting down…</div></div>`;
      setTimeout(() => {
        e.innerHTML = `<div style="position:absolute;inset:0;background:#000;color:#666;display:flex;
          align-items:center;justify-content:center;font-family:sans-serif;font-size:15px">
          It's now safe to turn off MiniOS. Tap the power button to start again.</div>`;
        window.__miniosOff = true; // power button reloads
      }, 1200);
    },
    // power menu popup near an anchor
    menu(anchor) {
      document.getElementById("power-menu")?.remove();
      const m = document.createElement("div");
      m.id = "power-menu";
      const r = anchor.getBoundingClientRect();
      m.style.cssText = "position:fixed;z-index:100001;background:rgba(40,40,48,.98);border-radius:10px;padding:6px;" +
        "box-shadow:0 12px 40px rgba(0,0,0,.5);font-size:14px;min-width:150px;bottom:" + (window.innerHeight - r.top + 6) + "px;left:" + r.left + "px";
      const items = [
        ["💤 Sleep / Lock", () => Lock.lock()],
        ["🚪 Sign out", () => Lock.signOut()],
        ["🔄 Restart", () => Lock.restart()],
        ["⏻ Shut down", () => Lock.shutdown()],
      ];
      m.innerHTML = items.map((it, i) => `<div class="pm" data-i="${i}" style="padding:9px 12px;border-radius:6px;cursor:pointer;color:#fff">${it[0]}</div>`).join("");
      document.body.appendChild(m);
      m.querySelectorAll(".pm").forEach(d => {
        d.onmouseenter = () => d.style.background = "var(--accent)";
        d.onmouseleave = () => d.style.background = "";
        d.onclick = () => { m.remove(); items[+d.dataset.i][1](); };
      });
      const off = (ev) => { if (!ev.target.closest("#power-menu")) { m.remove(); document.removeEventListener("pointerdown", off); } };
      setTimeout(() => document.addEventListener("pointerdown", off), 0);
    },
  };

  // Win/Alt+L locks
  window.addEventListener("keydown", (e) => { if ((e.metaKey || e.altKey) && (e.key === "l" || e.key === "L")) { e.preventDefault(); Lock.lock(); } });

  window.Lock = Lock;
})();
