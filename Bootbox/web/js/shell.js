/* ============================================================================
 * Shell — desktop icons, taskbar, start menu, system tray, clock,
 * notifications, search, and context menu. The Win10-style UX layer.
 * ========================================================================== */
(function () {
  const $ = (s) => document.querySelector(s);

  const Shell = {
    start() {
      // Each step is isolated: one failure must never leave a dead desktop.
      const steps = ["drawDesktopIcons", "wireTaskbar", "wireStartMenu", "wireSearch",
        "wireContextMenu", "wireNotifications", "wireExternalDevices", "wireActionCenter",
        "wireClockCalendar", "wireTaskbarMenu", "wireWidgets", "wireTaskView", "wireAltTab",
        "wireGlobalShortcuts", "wireTrayOverflow", "wireShowDesktop", "startClock"];
      steps.forEach(fn => { try { this[fn](); } catch (e) { console.error("Shell." + fn + " failed:", e); Kernel.sys.log("Shell." + fn + ": " + e.message); } });

      Kernel.on("wm:change", () => this.drawTaskButtons());
      Kernel.on("apps:change", () => this.drawDesktopIcons());
      try { this.drawTaskButtons(); } catch (e) {}
    },

    drawDesktopIcons() {
      const c = $("#desktop-icons");
      c.innerHTML = "";
      Apps.desktop().forEach(app => {
        const el = document.createElement("div");
        el.className = "desk-icon";
        el.innerHTML = `<div class="glyph">${app.icon}</div><div class="label">${app.name}</div>`;
        el.ondblclick = () => Apps.launch(app.id);
        let lastTap = 0;
        el.onclick = () => { const t = Date.now(); if (t - lastTap < 350) Apps.launch(app.id); lastTap = t; };
        c.appendChild(el);
      });
    },

    wireTaskbar() {
      $("#start-button").onclick = (e) => { e.stopPropagation(); this.toggleStart(); };
    },

    drawTaskButtons() {
      const c = $("#task-buttons");
      c.innerHTML = "";
      WM.list().filter(w => WM.winDesktop(w.id) === WM.currentDesktop()).forEach(w => {
        const b = document.createElement("button");
        b.className = "task-btn" + (w.el.style.display !== "none" ? " active" : "");
        b.innerHTML = `<span>${w.opts.icon || "🗔"}</span><span>${w.opts.title}</span>`;
        b.onclick = () => {
          if (w.min) WM.focus(w.id);
          else if (w.el.style.zIndex == Math.max(...WM.list().map(x => +x.el.style.zIndex))) WM.minimize(w.id);
          else WM.focus(w.id);
        };
        // hover preview
        let hov;
        b.addEventListener("mouseenter", () => { hov = setTimeout(() => this._showPreview(b, w), 350); });
        b.addEventListener("mouseleave", () => { clearTimeout(hov); this._hidePreview(); });
        // jump list (right-click)
        b.addEventListener("contextmenu", (e) => {
          e.preventDefault(); this._hidePreview();
          const cm = $("#context-menu");
          cm.innerHTML = `<div style="opacity:.5;font-size:11px;padding:4px 12px">${w.opts.title}</div>
            <div class="ctx-item" data-k="r">${w.min ? "Restore" : "Minimize"}</div>
            <div class="ctx-item" data-k="x">Close window</div>`;
          cm.style.left = Math.min(e.clientX, innerWidth - 200) + "px";
          cm.style.top = (e.clientY - 90) + "px"; cm.classList.remove("hidden");
          cm.querySelector('[data-k="r"]').onclick = () => { cm.classList.add("hidden"); w.min ? WM.focus(w.id) : WM.minimize(w.id); };
          cm.querySelector('[data-k="x"]').onclick = () => { cm.classList.add("hidden"); WM.close(w.id); };
        });
        c.appendChild(b);
      });
    },

    _showPreview(btn, w) {
      this._hidePreview();
      const p = document.createElement("div"); p.id = "task-preview";
      const r = btn.getBoundingClientRect();
      p.style.cssText = "position:fixed;z-index:760;width:200px;background:rgba(32,32,40,.98);border-radius:8px;overflow:hidden;" +
        "box-shadow:0 12px 40px rgba(0,0,0,.5);bottom:" + (innerHeight - r.top + 6) + "px;left:" + Math.max(6, r.left + r.width / 2 - 100) + "px";
      p.innerHTML = `<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;color:#fff;background:rgba(255,255,255,.06)">
          ${w.opts.icon || "🗔"} <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${w.opts.title}</span>
          <span id="tp-x" style="cursor:pointer">✕</span></div>
        <div style="height:110px;display:flex;align-items:center;justify-content:center;font-size:44px;color:#7a8aa0;background:#1b1f29">${w.opts.icon || "🗔"}</div>`;
      document.body.appendChild(p);
      p.onmouseenter = () => { clearTimeout(this._pvT); };
      p.onmouseleave = () => this._hidePreview();
      p.onclick = (e) => { if (e.target.id === "tp-x") { WM.close(w.id); this._hidePreview(); } else { WM.focus(w.id); this._hidePreview(); } };
    },
    _hidePreview() { document.getElementById("task-preview")?.remove(); },

    toggleStart() {
      const m = $("#start-menu");
      m.classList.toggle("hidden");
      if (!m.classList.contains("hidden")) this.drawStart();
    },
    drawStart() {
      const m = $("#start-menu");
      const tiles = Apps.all().map(a =>
        `<div class="start-tile" data-id="${a.id}"><div class="glyph">${a.icon}</div><div>${a.name}</div></div>`).join("");
      m.innerHTML = `
        <input class="field" id="start-search" placeholder="Search apps…" style="margin-bottom:12px">
        <h4>All apps</h4>
        <div class="start-grid">${tiles}</div>
        <div class="start-footer">
          <button id="sf-about">ℹ️ ${Kernel.nvram.deviceName}</button>
          <span>
            <button id="sf-bios">🧬 BIOS</button>
            <button id="sf-power">⏻ Power</button>
          </span>
        </div>`;
      m.querySelectorAll(".start-tile").forEach(t => t.onclick = () => {
        Apps.launch(t.dataset.id); this.toggleStart();
      });
      m.querySelector("#sf-about").onclick = () => { Apps.launch("about"); this.toggleStart(); };
      m.querySelector("#sf-bios").onclick = () => { this.toggleStart(); BIOS.enter(); };
      m.querySelector("#sf-power").onclick = (e) => { e.stopPropagation(); Lock.menu($("#start-button")); this.toggleStart(); };
      const sb = m.querySelector("#start-search");
      sb.oninput = () => {
        const q = sb.value.toLowerCase();
        m.querySelectorAll(".start-tile").forEach(t =>
          t.style.display = t.textContent.toLowerCase().includes(q) ? "" : "none");
      };
      sb.focus();
    },
    wireStartMenu() {
      document.addEventListener("pointerdown", (e) => {
        const m = $("#start-menu");
        if (!m.classList.contains("hidden") && !e.target.closest("#start-menu") && !e.target.closest("#start-button"))
          m.classList.add("hidden");
      });
    },

    wireSearch() {
      const input = $("#search-box input");
      const panel = document.createElement("div");
      panel.id = "search-panel"; panel.className = "hidden";
      panel.style.cssText = "position:absolute;left:6px;bottom:54px;width:380px;max-height:70%;overflow:auto;z-index:650;" +
        "background:rgba(28,28,36,.97);backdrop-filter:blur(22px);border-radius:12px;padding:14px;box-shadow:0 18px 60px rgba(0,0,0,.6)";
      document.getElementById("framebuffer").appendChild(panel);

      const draw = () => {
        const q = input.value.trim().toLowerCase();
        const apps = Apps.all().filter(a => !q || a.name.toLowerCase().includes(q));
        panel.innerHTML = `<div style="opacity:.7;font-size:12px;margin-bottom:8px">${q ? "Results for “" + input.value + "”" : "Apps"}</div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
            ${apps.map(a => `<div class="sp-app" data-id="${a.id}" style="text-align:center;padding:10px 4px;border-radius:8px;cursor:pointer;font-size:11px">
              <div style="font-size:24px">${a.icon}</div>${a.name}</div>`).join("")}</div>
          ${q ? `<div class="sp-web" style="margin-top:12px;padding:10px;border-radius:8px;cursor:pointer;background:rgba(255,255,255,.06)">
            🌐 Search the web for “${input.value}”</div>` : ""}`;
        panel.querySelectorAll(".sp-app").forEach(e => e.onmouseenter = () => e.style.background = "rgba(255,255,255,.12)");
        panel.querySelectorAll(".sp-app").forEach(e => { e.onmouseleave = () => e.style.background = ""; e.onclick = () => { Apps.launch(e.dataset.id); close(); }; });
        const web = panel.querySelector(".sp-web");
        if (web) web.onclick = () => { Apps.launch("browser", { url: "https://duckduckgo.com/?q=" + encodeURIComponent(input.value) }); close(); };
      };
      const open = () => { panel.classList.remove("hidden"); draw(); };
      const close = () => { panel.classList.add("hidden"); input.value = ""; };

      input.addEventListener("focus", open);
      input.addEventListener("input", draw);
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const q = input.value.trim();
          const hit = Apps.all().find(a => a.name.toLowerCase().includes(q.toLowerCase()));
          if (hit) { Apps.launch(hit.id); close(); }
          else if (q) { Apps.launch("browser", { url: "https://duckduckgo.com/?q=" + encodeURIComponent(q) }); close(); }
        } else if (e.key === "Escape") close();
      });
      document.addEventListener("pointerdown", (e) => {
        if (!panel.classList.contains("hidden") && !e.target.closest("#search-panel") && !e.target.closest("#search-box")) panel.classList.add("hidden");
      });
    },

    wireWidgets() {
      // inject a Widgets button into the taskbar (after the Start button)
      const btn = document.createElement("button");
      btn.id = "widgets-button"; btn.title = "Widgets"; btn.textContent = "🌤️";
      btn.style.cssText = "width:42px;height:40px;border:none;background:transparent;cursor:pointer;border-radius:4px;font-size:18px";
      btn.onmouseenter = () => btn.style.background = "rgba(255,255,255,.12)";
      btn.onmouseleave = () => btn.style.background = "";
      $("#start-button").after(btn);

      const panel = document.createElement("div");
      panel.id = "widgets"; panel.className = "hidden";
      panel.style.cssText = "position:absolute;left:6px;top:6px;bottom:54px;width:340px;overflow:auto;z-index:640;" +
        "background:rgba(24,24,32,.96);backdrop-filter:blur(22px);border-radius:12px;padding:16px;box-shadow:0 18px 60px rgba(0,0,0,.6)";
      document.getElementById("framebuffer").appendChild(panel);

      const card = (inner) => `<div style="background:rgba(255,255,255,.06);border-radius:12px;padding:14px;margin-bottom:12px">${inner}</div>`;
      const draw = async () => {
        const d = new Date();
        let info = {}; try { info = await Kernel.sys.deviceInfo(); } catch (e) {}
        const note = VFS.read("/Documents/widget-note.txt") || "";
        panel.innerHTML =
          card(`<div style="font-size:13px;opacity:.7">${Kernel.nvram.deviceName}</div>
            <div style="font-size:40px;font-variant-numeric:tabular-nums">${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            <div style="opacity:.7">${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>`) +
          card(`<div style="font-size:13px;font-weight:600;margin-bottom:6px">🌤️ Weather</div>
            <div style="opacity:.7;font-size:12px">Offline — connect via the Browser for live weather.</div>`) +
          card(`<div style="font-size:13px;font-weight:600;margin-bottom:6px">🖥️ System</div>
            <div style="opacity:.8;font-size:12px">Host: ${info.model || "?"} · ${info.cores || "?"} cores<br>
            Processes: ${Kernel.list().length} · Running ${Bridge.onDevice ? "on iPad" : "in browser"}</div>`) +
          card(`<div style="font-size:13px;font-weight:600;margin-bottom:6px">📝 Quick note</div>
            <textarea id="wn" class="field" style="height:70px;resize:none">${note.replace(/</g, "&lt;")}</textarea>`);
        const wn = panel.querySelector("#wn");
        if (wn) wn.onchange = () => VFS.write("/Documents/widget-note.txt", wn.value);
      };
      const toggle = () => { panel.classList.toggle("hidden"); if (!panel.classList.contains("hidden")) draw(); };
      btn.onclick = (e) => { e.stopPropagation(); toggle(); };
      window.addEventListener("keydown", (e) => { if ((e.metaKey || e.altKey) && (e.key === "w" || e.key === "W")) { e.preventDefault(); toggle(); } });
      document.addEventListener("pointerdown", (e) => {
        if (!panel.classList.contains("hidden") && !e.target.closest("#widgets") && !e.target.closest("#widgets-button")) panel.classList.add("hidden");
      });
    },

    wireContextMenu() {
      const cm = $("#context-menu");
      const wp = $("#wallpaper");
      const showAt = (x, y, items) => {
        cm.innerHTML = items.map(it => it.sep
          ? '<div class="ctx-sep"></div>'
          : `<div class="ctx-item" data-k="${it.k}">${it.label}</div>`).join("");
        cm.style.left = Math.min(x, innerWidth - 200) + "px";
        cm.style.top = Math.min(y, innerHeight - 220) + "px";
        cm.classList.remove("hidden");
        cm.querySelectorAll(".ctx-item").forEach(el => el.onclick = () => {
          cm.classList.add("hidden");
          const act = items.find(i => i.k === el.dataset.k); act && act.run();
        });
      };
      wp.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        showAt(e.clientX, e.clientY, [
          { k: "files", label: "📁 Open File Explorer", run: () => Apps.launch("files") },
          { k: "term", label: "⬛ Open Terminal", run: () => Apps.launch("terminal") },
          { sep: true },
          { k: "theme", label: "🎨 Toggle theme", run: () => { Kernel.nvram.theme = Kernel.nvram.theme === "dark" ? "light" : "dark"; Kernel.applyTheme(); Kernel.saveNVRAM(); } },
          { k: "settings", label: "⚙️ Settings", run: () => Apps.launch("settings") },
        ]);
      });
      // long-press for touch
      let lpTimer;
      wp.addEventListener("touchstart", (e) => {
        lpTimer = setTimeout(() => {
          const t = e.touches[0];
          showAt(t.clientX, t.clientY, [
            { k: "files", label: "📁 File Explorer", run: () => Apps.launch("files") },
            { k: "settings", label: "⚙️ Settings", run: () => Apps.launch("settings") },
          ]);
        }, 500);
      });
      wp.addEventListener("touchend", () => clearTimeout(lpTimer));
      document.addEventListener("pointerdown", (e) => {
        if (!e.target.closest("#context-menu")) cm.classList.add("hidden");
      });
    },

    _renderBadge() {
      let b = document.getElementById("notif-badge");
      if (!b) {
        const host = document.getElementById("bell-button") || $("#clock"); host.style.position = "relative";
        b = document.createElement("span"); b.id = "notif-badge";
        b.style.cssText = "position:absolute;top:-2px;right:-2px;min-width:16px;height:16px;border-radius:8px;" +
          "background:#e81123;color:#fff;font-size:10px;line-height:16px;text-align:center;padding:0 4px;display:none";
        host.appendChild(b);
      }
      const n = this._unread || 0;
      b.style.display = n ? "block" : "none";
      b.textContent = n > 9 ? "9+" : n;
    },
    wireNotifications() {
      this._history = []; this._unread = 0;
      Kernel.on("notify", ({ title, body }) => {
        this._history.unshift({ title, body, time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) });
        if (this._history.length > 30) this._history.pop();
        this._unread = (this._unread || 0) + 1; this._renderBadge();
        const n = $("#notifications");
        const t = document.createElement("div");
        t.className = "toast";
        t.innerHTML = `<div class="t-title">${title}</div><div class="t-body">${body || ""}</div>`;
        n.appendChild(t);
        setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 3500);
        if (this._ac && !this._ac.classList.contains("hidden")) this._drawAC();
      });
    },

    wireActionCenter() {
      const ac = document.createElement("div");
      ac.id = "action-center"; ac.className = "hidden";
      ac.style.cssText = "position:absolute;right:6px;bottom:54px;width:340px;max-height:75%;overflow:auto;z-index:700;" +
        "background:rgba(28,28,36,.97);backdrop-filter:blur(22px);border-radius:12px;padding:16px;box-shadow:0 18px 60px rgba(0,0,0,.6)";
      document.getElementById("framebuffer").appendChild(ac);
      this._ac = ac;
      // 🔔 notifications button in the tray (Win10-style), separate from the clock.
      const bell = document.createElement("button");
      bell.id = "bell-button"; bell.title = "Notifications"; bell.textContent = "🔔";
      bell.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:15px;color:inherit;padding:4px 6px;border-radius:4px";
      bell.onmouseenter = () => bell.style.background = "rgba(255,255,255,.12)";
      bell.onmouseleave = () => bell.style.background = "";
      $("#tray").insertBefore(bell, $("#clock"));
      this._renderBadge();
      bell.onclick = (e) => { e.stopPropagation(); ac.classList.toggle("hidden"); if (!ac.classList.contains("hidden")) { this._unread = 0; this._renderBadge(); this._drawAC(); } };
      document.addEventListener("pointerdown", (e) => {
        if (!ac.classList.contains("hidden") && !e.target.closest("#action-center") && !e.target.closest("#bell-button")) ac.classList.add("hidden");
      });
    },

    wireClockCalendar() {
      const cal = document.createElement("div");
      cal.id = "calendar-flyout"; cal.className = "hidden";
      cal.style.cssText = "position:absolute;right:6px;bottom:54px;width:320px;z-index:705;background:rgba(28,28,36,.97);" +
        "backdrop-filter:blur(22px);border-radius:12px;padding:16px;box-shadow:0 18px 60px rgba(0,0,0,.6)";
      document.getElementById("framebuffer").appendChild(cal);
      let viewMonth = null;
      const events = () => { try { return JSON.parse(VFS.read("/Documents/.calendar.json") || "{}"); } catch (e) { return {}; } };
      const setEvents = (o) => VFS.write("/Documents/.calendar.json", JSON.stringify(o));
      const draw = () => {
        const now = new Date();
        const vm = viewMonth || new Date(now.getFullYear(), now.getMonth(), 1);
        const y = vm.getFullYear(), m = vm.getMonth();
        const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate();
        const ev = events();
        const key = (d) => y + "-" + (m + 1) + "-" + d;
        let cells = "";
        for (let i = 0; i < first; i++) cells += "<div></div>";
        for (let d = 1; d <= days; d++) {
          const isToday = d === now.getDate() && m === now.getMonth() && y === now.getFullYear();
          const has = ev[key(d)];
          cells += `<div class="cal-d" data-d="${d}" style="text-align:center;padding:6px 0;border-radius:6px;cursor:pointer;font-size:12px;position:relative;${isToday ? "background:var(--accent);color:#fff" : ""}">${d}${has ? '<span style="position:absolute;bottom:2px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:#ff6a88"></span>' : ""}</div>`;
        }
        const todayEv = ev[key(now.getDate())] && m === now.getMonth() ? ev[key(now.getDate())] : null;
        cal.innerHTML = `
          <div style="font-size:30px;font-variant-numeric:tabular-nums">${now.toLocaleTimeString()}</div>
          <div style="opacity:.7;margin-bottom:12px">${now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span id="cal-prev" style="cursor:pointer;padding:0 8px">‹</span>
            <b style="font-size:13px">${vm.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</b>
            <span id="cal-next" style="cursor:pointer;padding:0 8px">›</span></div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px;opacity:.5;font-size:11px;text-align:center;margin-bottom:4px">
            ${["S", "M", "T", "W", "T", "F", "S"].map(x => "<div>" + x + "</div>").join("")}</div>
          <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:2px">${cells}</div>
          <div style="margin-top:12px;border-top:1px solid rgba(255,255,255,.12);padding-top:10px">
            <b style="font-size:13px">Agenda — today</b>
            <div style="font-size:12px;opacity:.85;margin-top:6px">${todayEv ? todayEv.map(e => "• " + e).join("<br>") : "No events. Tap a day to add one."}</div>
          </div>`;
        cal.querySelector("#cal-prev").onclick = () => { viewMonth = new Date(y, m - 1, 1); draw(); };
        cal.querySelector("#cal-next").onclick = () => { viewMonth = new Date(y, m + 1, 1); draw(); };
        cal.querySelectorAll(".cal-d").forEach(c => c.onclick = () => {
          const t = prompt("Add event on " + (m + 1) + "/" + c.dataset.d + ":"); if (!t) return;
          const o = events(); (o[key(+c.dataset.d)] = o[key(+c.dataset.d)] || []).push(t); setEvents(o); draw();
        });
      };
      $("#clock").style.cursor = "pointer";
      $("#clock").onclick = (e) => { e.stopPropagation(); cal.classList.toggle("hidden"); if (!cal.classList.contains("hidden")) { viewMonth = null; draw(); } };
      document.addEventListener("pointerdown", (e) => {
        if (!cal.classList.contains("hidden") && !e.target.closest("#calendar-flyout") && !e.target.closest("#clock")) cal.classList.add("hidden");
      });
    },
    _drawAC() {
      const n = Kernel.nvram;
      const tiles = [
        { k: "network", on: n.devices.network, label: "📶 Network" },
        { k: "audio", on: n.devices.audio, label: "🔊 Sound" },
        { k: "theme", on: n.theme === "light", label: "🌗 Light mode" },
        { k: "camera", on: n.devices.camera, label: "📷 Camera" },
      ];
      this._ac.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
          ${tiles.map(t => `<div class="ac-tile" data-k="${t.k}" style="padding:14px 10px;border-radius:8px;cursor:pointer;font-size:12px;
            background:${t.on ? "var(--accent)" : "rgba(255,255,255,.08)"};color:#fff">${t.label}</div>`).join("")}
        </div>
        <div style="margin-bottom:14px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
            <span style="width:22px;text-align:center">🔊</span>
            <input id="ac-vol" type="range" min="0" max="100" value="${n.volume == null ? 70 : n.volume}" style="flex:1">
            <span id="ac-vol-v" style="width:34px;text-align:right;font-size:12px">${n.volume == null ? 70 : n.volume}</span></div>
          <div style="display:flex;align-items:center;gap:10px">
            <span style="width:22px;text-align:center">☀️</span>
            <input id="ac-bri" type="range" min="10" max="100" value="${n.brightness == null ? 100 : n.brightness}" style="flex:1">
            <span id="ac-bri-v" style="width:34px;text-align:right;font-size:12px">${n.brightness == null ? 100 : n.brightness}</span></div>
        </div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b style="font-size:13px">Notifications</b><span id="ac-clear" style="font-size:12px;opacity:.7;cursor:pointer">Clear all</span></div>
        ${this._history.length ? this._history.map(h => `<div style="background:rgba(255,255,255,.06);border-radius:8px;padding:10px;margin-bottom:8px">
          <div style="font-size:13px;font-weight:600">${h.title} <span style="float:right;opacity:.5;font-weight:400">${h.time}</span></div>
          <div style="font-size:12px;opacity:.8">${h.body || ""}</div></div>`).join("")
          : '<div style="opacity:.5;font-size:13px">No new notifications</div>'}`;
      this._ac.querySelectorAll(".ac-tile").forEach(t => t.onclick = () => {
        const k = t.dataset.k;
        if (k === "theme") { Kernel.nvram.theme = Kernel.nvram.theme === "dark" ? "light" : "dark"; Kernel.applyTheme(); }
        else Kernel.nvram.devices[k] = !Kernel.nvram.devices[k];
        Kernel.saveNVRAM(); this._drawAC();
      });
      this._ac.querySelector("#ac-clear").onclick = () => { this._history = []; this._drawAC(); };
      // volume + brightness sliders
      const vol = this._ac.querySelector("#ac-vol"), volV = this._ac.querySelector("#ac-vol-v");
      vol.oninput = () => { n.volume = +vol.value; volV.textContent = vol.value; Kernel.saveNVRAM(); this._applyBrightness(); };
      const bri = this._ac.querySelector("#ac-bri"), briV = this._ac.querySelector("#ac-bri-v");
      bri.oninput = () => { n.brightness = +bri.value; briV.textContent = bri.value; Kernel.saveNVRAM(); Kernel.sys.setBrightness(bri.value / 100); this._applyBrightness(); };
      this._applyBrightness();
    },
    _applyBrightness() {
      // Web dim overlay (also drives native UIScreen.brightness on device).
      let dim = document.getElementById("dim-overlay");
      if (!dim) {
        dim = document.createElement("div"); dim.id = "dim-overlay";
        dim.style.cssText = "position:absolute;inset:0;background:#000;pointer-events:none;z-index:550;opacity:0";
        document.getElementById("framebuffer").appendChild(dim);
      }
      const b = Kernel.nvram.brightness == null ? 100 : Kernel.nvram.brightness;
      dim.style.opacity = String((100 - b) / 100 * 0.7);
    },

    wireTaskView() {
      const btn = document.createElement("button");
      btn.id = "taskview-button"; btn.title = "Task View"; btn.textContent = "🗂️";
      btn.style.cssText = "width:42px;height:40px;border:none;background:transparent;cursor:pointer;border-radius:4px;font-size:17px";
      btn.onmouseenter = () => btn.style.background = "rgba(255,255,255,.12)";
      btn.onmouseleave = () => btn.style.background = "";
      ($("#widgets-button") || $("#start-button")).after(btn);

      const ov = document.createElement("div");
      ov.id = "task-view"; ov.className = "hidden";
      ov.style.cssText = "position:absolute;inset:0 0 48px 0;z-index:680;background:rgba(10,12,20,.86);backdrop-filter:blur(20px);" +
        "padding:30px;overflow:auto;display:flex;flex-direction:column;gap:24px";
      document.getElementById("framebuffer").appendChild(ov);

      const draw = () => {
        const dn = WM.desktopCount(), cur = WM.currentDesktop();
        let html = "";
        for (let d = 0; d < dn; d++) {
          const dwins = WM.list().filter(w => WM.winDesktop(w.id) === d);
          html += `<div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <b style="font-size:14px;color:#fff">Desktop ${d + 1}${d === cur ? " (current)" : ""}</b>
              <button class="tv-go" data-d="${d}" style="background:var(--accent);border:none;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px">Open</button>
              ${dn > 1 ? `<button class="tv-rm" data-d="${d}" style="background:rgba(255,255,255,.15);border:none;color:#fff;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px">✕ Remove</button>` : ""}
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:14px">
              ${dwins.length ? dwins.map(w => `<div class="tv-win" data-id="${w.id}"
                  style="width:180px;height:120px;background:#1f2330;border-radius:10px;cursor:pointer;overflow:hidden;border:1px solid rgba(255,255,255,.1);position:relative">
                  <div style="height:26px;background:rgba(255,255,255,.08);display:flex;align-items:center;gap:6px;padding:0 8px;font-size:11px;color:#fff">
                    ${w.opts.icon || "🗔"} <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${w.opts.title}</span>
                    <span class="tv-close" data-id="${w.id}" style="margin-left:auto;cursor:pointer">✕</span></div>
                  <div style="padding:10px;color:#7a8;font-size:30px;text-align:center;margin-top:14px">${w.opts.icon || "🗔"}</div>
                  <div class="tv-move" style="position:absolute;bottom:4px;right:6px;display:flex;gap:3px">
                    ${Array.from({ length: dn }, (_, t) => t === d ? "" : `<span class="tv-mv" data-id="${w.id}" data-t="${t}"
                      style="background:rgba(255,255,255,.2);border-radius:4px;padding:1px 6px;font-size:10px;color:#fff;cursor:pointer">→${t + 1}</span>`).join("")}
                  </div></div>`).join("")
                : '<div style="color:#778;font-size:13px">No windows</div>'}
            </div></div>`;
        }
        html += `<button id="tv-add" style="align-self:flex-start;background:rgba(255,255,255,.12);border:none;color:#fff;
          border-radius:10px;padding:14px 22px;cursor:pointer;font-size:14px">＋ New desktop</button>`;
        ov.innerHTML = html;
        ov.querySelectorAll(".tv-go").forEach(b => b.onclick = () => { WM.switchDesktop(+b.dataset.d); close(); });
        ov.querySelectorAll(".tv-rm").forEach(b => b.onclick = (e) => { e.stopPropagation(); WM.removeDesktop(+b.dataset.d); draw(); });
        ov.querySelectorAll(".tv-win").forEach(w => w.onclick = () => { WM.focus(w.dataset.id); close(); });
        ov.querySelectorAll(".tv-close").forEach(c => c.onclick = (e) => { e.stopPropagation(); WM.close(c.dataset.id); draw(); });
        ov.querySelectorAll(".tv-mv").forEach(m => m.onclick = (e) => { e.stopPropagation(); WM.moveToDesktop(m.dataset.id, +m.dataset.t); draw(); });
        ov.querySelector("#tv-add").onclick = () => { WM.addDesktop(); draw(); };
      };
      const open = () => { ov.classList.remove("hidden"); draw(); };
      const close = () => ov.classList.add("hidden");
      const toggle = () => { ov.classList.contains("hidden") ? open() : close(); };
      btn.onclick = (e) => { e.stopPropagation(); toggle(); };
      window.addEventListener("keydown", (e) => { if (e.metaKey && e.key === "Tab") { e.preventDefault(); toggle(); } else if (e.key === "Escape") close(); });
      Kernel.on("desktops:change", () => { if (!ov.classList.contains("hidden")) draw(); });
    },

    wireTaskbarMenu() {
      const tb = $("#taskbar");
      tb.addEventListener("contextmenu", (e) => {
        if (e.target.closest(".task-btn")) return;
        e.preventDefault();
        const cm = $("#context-menu");
        cm.innerHTML = `<div class="ctx-item" data-k="tm">📊 Task Manager</div>
          <div class="ctx-item" data-k="settings">⚙️ Taskbar settings</div>`;
        cm.style.left = Math.min(e.clientX, innerWidth - 200) + "px";
        cm.style.top = (e.clientY - 90) + "px";
        cm.classList.remove("hidden");
        cm.querySelector('[data-k="tm"]').onclick = () => { cm.classList.add("hidden"); Apps.launch("taskmgr"); };
        cm.querySelector('[data-k="settings"]').onclick = () => { cm.classList.add("hidden"); Apps.launch("settings"); };
      });
    },

    wireExternalDevices() {
      this._usb = [];
      Kernel.on("usb:connect", (d) => {
        this._usb.push(d.name);
        Kernel.sys.haptic();
        Kernel.notify("🔌 USB connected", (d.name || "Device") + (d.kind === "volume" ? " (storage)" : ""));
        this._updateUsbTray();
      });
      Kernel.on("usb:disconnect", (d) => {
        this._usb = this._usb.filter(n => n !== d.name);
        Kernel.notify("⏏️ USB removed", d.name || "Device");
        this._updateUsbTray();
      });
      Kernel.on("file:imported", (p) => {
        const ext = (p.ext || "").toLowerCase();
        const apkExe = ext === "apk" || ext === "exe";
        Kernel.notify("📥 File imported", p.name + (apkExe ? " — tap Compatibility to inspect" : ""));
        if (apkExe) Apps.launch("binaries");
        else Kernel.emit("apps:change");
      });
      Kernel.on("download:done", (p) => {
        // Record the download in the MiniOS /Downloads folder (host holds the bytes).
        VFS.write("/Downloads/" + p.name, "[downloaded file] " + (p.size || 0) + " bytes\nhost path: " + (p.path || ""), "application/octet-stream");
        Kernel.notify("⬇️ Download complete", p.name + " saved to Downloads");
      });
      Kernel.on("download:failed", (p) => Kernel.notify("Download failed", p.error || ""));
    },
    _updateUsbTray() {
      const t = document.querySelector("#tray-icons");
      this._usbCount = this._usb.length;
      // re-rendered by startClock tick; store flag
    },

    wireTrayOverflow() {
      const btn = document.createElement("button");
      btn.id = "tray-overflow"; btn.title = "Show hidden icons"; btn.textContent = "˄";
      btn.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:14px;color:inherit;padding:4px 6px;border-radius:4px";
      btn.onmouseenter = () => btn.style.background = "rgba(255,255,255,.12)";
      btn.onmouseleave = () => btn.style.background = "";
      $("#tray").insertBefore(btn, $("#tray-icons"));
      const pop = document.createElement("div");
      pop.id = "tray-pop"; pop.className = "hidden";
      pop.style.cssText = "position:absolute;right:8px;bottom:54px;z-index:710;background:rgba(40,40,48,.98);border-radius:10px;" +
        "padding:12px;box-shadow:0 12px 40px rgba(0,0,0,.5);display:grid;grid-template-columns:repeat(3,1fr);gap:8px;width:210px";
      document.getElementById("framebuffer").appendChild(pop);
      const draw = () => {
        const n = Kernel.nvram, d = n.devices;
        const tile = (k, lbl, on) => `<div class="to-t" data-k="${k}" style="text-align:center;padding:10px 4px;border-radius:8px;cursor:pointer;font-size:11px;${on ? "background:var(--accent);color:#fff" : "background:rgba(255,255,255,.08)"}">${lbl}</div>`;
        pop.innerHTML = tile("camera", "📷 Camera", d.camera) + tile("ml", "🧠 ML", d.ml) +
          tile("network", "📶 Net", d.network) + tile("audio", "🔊 Audio", d.audio) +
          `<div class="to-t" data-k="snip" style="text-align:center;padding:10px 4px;border-radius:8px;cursor:pointer;font-size:11px;background:rgba(255,255,255,.08)">✂️ Snip</div>` +
          `<div class="to-t" data-k="tm" style="text-align:center;padding:10px 4px;border-radius:8px;cursor:pointer;font-size:11px;background:rgba(255,255,255,.08)">📊 Tasks</div>`;
        pop.querySelectorAll(".to-t").forEach(t => t.onclick = () => {
          const k = t.dataset.k;
          if (k === "snip") Apps.launch("snip"); else if (k === "tm") Apps.launch("taskmgr");
          else { Kernel.nvram.devices[k] = !Kernel.nvram.devices[k]; Kernel.saveNVRAM(); draw(); }
        });
      };
      btn.onclick = (e) => { e.stopPropagation(); pop.classList.toggle("hidden"); if (!pop.classList.contains("hidden")) draw(); };
      document.addEventListener("pointerdown", (e) => { if (!pop.classList.contains("hidden") && !e.target.closest("#tray-pop") && !e.target.closest("#tray-overflow")) pop.classList.add("hidden"); });
    },

    wireShowDesktop() {
      const sd = document.createElement("button");
      sd.id = "show-desktop"; sd.title = "Show desktop";
      sd.style.cssText = "width:10px;height:48px;border:none;border-left:1px solid rgba(255,255,255,.18);background:transparent;cursor:pointer;margin-left:4px";
      $("#taskbar").appendChild(sd);
      sd.onmouseenter = () => WM.peek(true);
      sd.onmouseleave = () => WM.peek(false);
      sd.onclick = () => { WM.peek(false); WM.minimizeAll(); };
    },

    wireAltTab() {
      const ov = document.createElement("div");
      ov.id = "alt-tab"; ov.className = "hidden";
      ov.style.cssText = "position:absolute;inset:0;z-index:850;background:rgba(10,12,20,.6);backdrop-filter:blur(8px);" +
        "display:flex;align-items:center;justify-content:center";
      document.getElementById("framebuffer").appendChild(ov);
      let idx = 0, list = [], open = false;

      const render = () => {
        ov.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:14px;max-width:80%;justify-content:center;
          background:rgba(30,30,40,.9);padding:22px;border-radius:14px">
          ${list.map((w, i) => `<div data-i="${i}" style="width:170px;cursor:pointer;border-radius:10px;overflow:hidden;
            border:2px solid ${i === idx ? "var(--accent)" : "transparent"};background:#1f2330">
            <div style="height:26px;display:flex;align-items:center;gap:6px;padding:0 8px;font-size:11px;color:#fff;background:rgba(255,255,255,.08)">
              ${w.opts.icon || "🗔"} <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${w.opts.title}</span></div>
            <div style="height:88px;display:flex;align-items:center;justify-content:center;font-size:40px;color:#7a8aa0">${w.opts.icon || "🗔"}</div>
          </div>`).join("")}</div>`;
        ov.querySelectorAll("[data-i]").forEach(t => t.onclick = () => { idx = +t.dataset.i; commit(); });
      };
      const show = () => {
        list = WM.list().filter(w => WM.winDesktop(w.id) === WM.currentDesktop());
        if (list.length < 2) return false;
        idx = 1; open = true; ov.classList.remove("hidden"); render(); return true;
      };
      const commit = () => { open = false; ov.classList.add("hidden"); if (list[idx]) WM.focus(list[idx].id); };

      window.addEventListener("keydown", (e) => {
        if (e.key === "Tab" && e.altKey && !e.metaKey) {
          e.preventDefault();
          if (!open) { if (!show()) return; }
          else { idx = (idx + (e.shiftKey ? -1 : 1) + list.length) % list.length; render(); }
        } else if (open && e.key === "Escape") { open = false; ov.classList.add("hidden"); }
      });
      window.addEventListener("keyup", (e) => { if (open && e.key === "Alt") commit(); });
    },

    wireGlobalShortcuts() {
      // Win/Meta key alone opens Start (like Windows).
      let metaCombo = false;
      window.addEventListener("keydown", (e) => {
        if (e.key === "Meta") { metaCombo = false; }
        else if (e.metaKey || e.altKey) { metaCombo = true; }
        // Win/Alt + / opens the shortcuts cheat-sheet
        if ((e.metaKey || e.altKey) && (e.key === "/" || e.key === "?")) { e.preventDefault(); this.showShortcuts(); }
      });
      window.addEventListener("keyup", (e) => {
        if (e.key === "Meta" && !metaCombo) this.toggleStart();
      });
    },

    showShortcuts() {
      let o = document.getElementById("shortcuts");
      if (o) { o.remove(); return; }
      o = document.createElement("div"); o.id = "shortcuts";
      o.style.cssText = "position:absolute;inset:0;z-index:860;background:rgba(10,12,20,.7);backdrop-filter:blur(8px);display:flex;align-items:center;justify-content:center";
      const rows = [
        ["Win", "Open Start"], ["Win + W", "Widgets"], ["Win + Tab / Alt + Tab", "Task View / window switcher"],
        ["Alt + Tab (hold)", "Switch windows"], ["Win + ← / → / ↑", "Snap left / right / maximize"],
        ["Win + ↓", "Minimize"], ["Win + Ctrl + ← / →", "Switch virtual desktop"], ["Win + Ctrl + D", "New desktop"],
        ["Win + L", "Lock"], ["Win + /", "This help"], ["Ctrl + A", "Select all (Explorer)"],
      ];
      o.innerHTML = `<div style="background:rgba(30,30,40,.96);border-radius:14px;padding:26px;width:440px;max-width:90%;color:#fff">
        <h2 style="margin:0 0 14px">⌨️ Keyboard shortcuts</h2>
        ${rows.map(r => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.08)">
          <span style="opacity:.8;font-size:13px">${r[1]}</span>
          <kbd style="background:rgba(255,255,255,.12);border-radius:5px;padding:2px 8px;font-size:12px">${r[0]}</kbd></div>`).join("")}
        <div style="text-align:center;margin-top:16px"><button class="btn" id="sc-close">Close</button></div></div>`;
      document.getElementById("framebuffer").appendChild(o);
      o.querySelector("#sc-close").onclick = () => o.remove();
      o.addEventListener("pointerdown", (e) => { if (e.target === o) o.remove(); });
    },

    startClock() {
      const upd = () => {
        const d = new Date();
        $("#clock-time").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: !Kernel.nvram.clock24 });
        $("#clock-date").innerHTML = "<br>" + d.toLocaleDateString();
        $("#tray-icons").textContent =
          (this._usbCount ? "🔌" + this._usbCount + " " : "") +
          (Kernel.nvram.devices.network ? "📶 " : "") +
          (Kernel.nvram.devices.audio ? "🔊 " : "🔇 ") + "🔋";
      };
      upd(); setInterval(upd, 1000);
    },
  };

  window.Shell = Shell;
})();
