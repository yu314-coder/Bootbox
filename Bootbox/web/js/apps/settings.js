/* Settings — Windows-10-style: left navigation, search, multiple pages. */
(function () {
  const NAV = [
    { k: "home", icon: "🏠", name: "Home" },
    { k: "system", icon: "🖥️", name: "System", kw: "display brightness about device" },
    { k: "person", icon: "🎨", name: "Personalization", kw: "theme accent wallpaper colors background" },
    { k: "devices", icon: "🔌", name: "Devices", kw: "camera audio usb bluetooth" },
    { k: "network", icon: "📶", name: "Network & Internet", kw: "wifi ip" },
    { k: "accounts", icon: "👤", name: "Accounts", kw: "pin name sign-in" },
    { k: "time", icon: "🕐", name: "Time & Language", kw: "clock 24 hour date" },
    { k: "apps", icon: "🧩", name: "Apps", kw: "installed uninstall mapp" },
    { k: "update", icon: "🔄", name: "Update & Security", kw: "updates bios firmware" },
  ];

  function launch(args) {
    let page = (args && args.page) || "home";
    WM.open({
      appId: "settings", title: "Settings", icon: "⚙️", width: 720, height: 520,
      async render(body) {
        const n = Kernel.nvram;
        let info = {}; try { info = await Kernel.sys.deviceInfo(); } catch (e) {}
        const gb = (b) => b ? (b / 1073741824).toFixed(1) + " GB" : "—";
        let filter = "";

        function frame() {
          body.innerHTML = `<div style="display:flex;height:100%">
            <div style="width:210px;border-right:1px solid rgba(128,128,128,.2);display:flex;flex-direction:column;background:rgba(128,128,128,.05)">
              <div style="padding:12px"><input id="set-search" class="field" placeholder="Find a setting"></div>
              <div id="nav" style="flex:1;overflow:auto"></div>
            </div>
            <div id="page" class="app" style="flex:1;overflow:auto"></div></div>`;
          drawNav(); drawPage();
          const s = body.querySelector("#set-search");
          s.oninput = () => { filter = s.value.toLowerCase(); drawNav(); };
          s.onkeydown = (e) => { if (e.key === "Enter") { const hit = NAV.find(x => x.k !== "home" && matches(x)); if (hit) { page = hit.k; drawNav(); drawPage(); } } };
        }
        function matches(x) { return !filter || x.name.toLowerCase().includes(filter) || (x.kw || "").includes(filter); }
        function drawNav() {
          const nav = body.querySelector("#nav");
          nav.innerHTML = NAV.filter(matches).map(x =>
            `<div class="nav-i" data-k="${x.k}" style="display:flex;align-items:center;gap:10px;padding:11px 14px;cursor:pointer;font-size:13px;
              ${x.k === page ? "background:rgba(128,128,128,.18);border-left:3px solid var(--accent)" : "border-left:3px solid transparent"}">
              <span style="font-size:16px">${x.icon}</span>${x.name}</div>`).join("");
          nav.querySelectorAll(".nav-i").forEach(e => e.onclick = () => { page = e.dataset.k; drawNav(); drawPage(); });
        }

        const row = (l, r) => `<div class="list-row"><span style="flex:1">${l}</span>${r}</div>`;
        function drawPage() {
          const el = body.querySelector("#page");
          if (page === "home") {
            el.innerHTML = `<h2>⚙️ Settings</h2><div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
              ${NAV.filter(x => x.k !== "home").map(x => `<div class="home-t" data-k="${x.k}" style="display:flex;gap:12px;align-items:center;padding:16px;border-radius:10px;cursor:pointer;background:rgba(128,128,128,.08)">
                <span style="font-size:26px">${x.icon}</span><div><b>${x.name}</b></div></div>`).join("")}</div>`;
            el.querySelectorAll(".home-t").forEach(t => t.onclick = () => { page = t.dataset.k; drawNav(); drawPage(); });
          }
          else if (page === "system") {
            el.innerHTML = `<h2>🖥️ System</h2>
              ${row("Device name", "<b>" + n.deviceName + "</b>")}
              ${row("Host model", "<b>" + (info.model || "?") + "</b>")}
              ${row("Host OS", "<b>" + (info.osVersion || "?") + "</b>")}
              ${row("Memory", "<b>" + gb(info.ram) + "</b>")}
              ${row("Processors", "<b>" + (info.cores || "?") + " cores</b>")}
              ${row("Running on device", "<b>" + (Bridge.onDevice ? "Yes (iPad host)" : "No (browser dev)") + "</b>")}
              <h3>Display</h3>
              <div class="list-row"><span style="flex:1">Brightness</span>
                <input type="range" id="sys-bri" min="10" max="100" value="${n.brightness == null ? 100 : n.brightness}"></div>`;
            const bri = el.querySelector("#sys-bri");
            bri.oninput = () => { n.brightness = +bri.value; Kernel.saveNVRAM(); Kernel.sys.setBrightness(bri.value / 100); Shell._applyBrightness && Shell._applyBrightness(); };
          }
          else if (page === "person") {
            el.innerHTML = `<h2>🎨 Personalization</h2>
              ${row("Theme", '<button class="btn" id="theme">' + n.theme + '</button>')}
              ${row("Accent", '<input type="color" id="accent" value="' + n.accent + '">')}
              ${row("Startup sound", '<button class="btn" id="sound">' + (n.sound ? "On" : "Off") + '</button>')}
              <h3>Wallpaper</h3><div id="wallgrid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px"></div>
              ${row("Custom color", '<input type="color" id="wallcolor" value="#0a2540">')}`;
            const grid = el.querySelector("#wallgrid");
            Object.entries(Kernel.wallpapers).forEach(([key, css]) => {
              const sw = document.createElement("div"); sw.title = key;
              sw.style.cssText = "height:46px;border-radius:8px;cursor:pointer;background:" + css + ";background-size:cover;border:2px solid " + (n.wallpaper === key ? "var(--accent)" : "transparent");
              sw.onclick = () => { n.wallpaper = key; Kernel.applyWallpaper(); Kernel.saveNVRAM(); drawPage(); };
              grid.appendChild(sw);
            });
            el.querySelector("#theme").onclick = (e) => { n.theme = n.theme === "dark" ? "light" : "dark"; Kernel.applyTheme(); Kernel.saveNVRAM(); e.target.textContent = n.theme; };
            el.querySelector("#accent").oninput = (e) => { n.accent = e.target.value; Kernel.applyTheme(); Kernel.saveNVRAM(); };
            el.querySelector("#sound").onclick = (e) => { n.sound = !n.sound; Kernel.saveNVRAM(); e.target.textContent = n.sound ? "On" : "Off"; };
            el.querySelector("#wallcolor").oninput = (e) => { n.wallpaper = e.target.value; Kernel.applyWallpaper(); Kernel.saveNVRAM(); };
          }
          else if (page === "devices") {
            el.innerHTML = `<h2>🔌 Devices</h2><h3>Virtual devices</h3><div id="devs"></div>`;
            const devs = el.querySelector("#devs");
            Object.keys(n.devices).forEach(d => {
              const r = document.createElement("div"); r.className = "list-row";
              r.innerHTML = `<span style="flex:1">${d.toUpperCase()}</span><button class="btn">${n.devices[d] ? "Enabled" : "Disabled"}</button>`;
              r.querySelector("button").onclick = (e) => { n.devices[d] = !n.devices[d]; Kernel.saveNVRAM(); e.target.textContent = n.devices[d] ? "Enabled" : "Disabled"; };
              devs.appendChild(r);
            });
          }
          else if (page === "network") {
            el.innerHTML = `<h2>📶 Network & Internet</h2>
              ${row("Status", "<b>" + (n.devices.network ? "Connected (virtual)" : "Disconnected") + "</b>")}
              ${row("Adapter", "<b>MiniOS Virtual Adapter</b>")}
              ${row("IPv4", "<b>10.0.2.15</b>")}${row("Gateway", "<b>10.0.2.2</b>")}
              <p style="opacity:.6;font-size:12px">The Browser uses the host network; the rest of MiniOS runs offline.</p>`;
          }
          else if (page === "accounts") {
            el.innerHTML = `<h2>👤 Accounts</h2>
              ${row("Device / user name", '<input class="field" id="acc-name" style="width:200px" value="' + n.deviceName + '">')}
              ${row("Sign-in PIN", '<button class="btn" id="acc-pin">' + (n.pin ? "Change PIN" : "Set PIN") + '</button>')}
              ${n.pin ? row("", '<button class="btn" id="acc-clear">Remove PIN</button>') : ""}`;
            el.querySelector("#acc-name").onchange = (e) => { n.deviceName = e.target.value.trim() || n.deviceName; Kernel.saveNVRAM(); };
            el.querySelector("#acc-pin").onclick = () => { const p = prompt("Enter a new PIN:"); if (p != null) { n.pin = p.trim(); Kernel.saveNVRAM(); Kernel.notify("Accounts", "PIN updated"); drawPage(); } };
            const clr = el.querySelector("#acc-clear"); if (clr) clr.onclick = () => { n.pin = ""; Kernel.saveNVRAM(); drawPage(); };
          }
          else if (page === "time") {
            el.innerHTML = `<h2>🕐 Time & Language</h2>
              ${row("Current time", "<b>" + new Date().toLocaleTimeString() + "</b>")}
              ${row("24-hour clock", '<button class="btn" id="t24">' + (n.clock24 ? "On" : "Off") + '</button>')}
              ${row("Language", "<b>English (United States)</b>")}`;
            el.querySelector("#t24").onclick = (e) => { n.clock24 = !n.clock24; Kernel.saveNVRAM(); e.target.textContent = n.clock24 ? "On" : "Off"; Kernel.emit("wm:change"); };
          }
          else if (page === "apps") {
            const installed = (() => { try { return JSON.parse(VFS.read("/Apps/.installed") || "[]"); } catch (e) { return []; } })();
            el.innerHTML = `<h2>🧩 Apps</h2><h3>Installed apps</h3>
              ${Apps.all().map(a => `<div class="list-row"><span style="font-size:18px">${a.icon}</span><span style="flex:1">${a.name}</span>
                ${installed.includes(a.id) ? '<span style="opacity:.6;font-size:12px">.mapp</span>' : '<span style="opacity:.5;font-size:12px">built-in</span>'}</div>`).join("")}
              <p style="opacity:.6;font-size:12px;margin-top:10px">Install more from the App Center.</p>`;
          }
          else if (page === "update") {
            el.innerHTML = `<h2>🔄 Update & Security</h2>
              <div class="list-row"><span style="flex:1"><b>You're up to date</b><br><small style="opacity:.6">MiniOS ${"1.3.0"}</small></span>
                <button class="btn" id="chk">Check for updates</button></div>
              <h3>Recovery / Firmware</h3>
              <button class="btn" id="bios">🧬 Open BIOS / Firmware Setup</button>
              <button class="btn" id="restart">🔄 Restart</button>
              <button class="btn" id="reset">♻️ Reset MiniOS (run setup again)</button>`;
            el.querySelector("#chk").onclick = () => Kernel.notify("Update", "MiniOS is up to date.");
            el.querySelector("#bios").onclick = () => BIOS.enter();
            el.querySelector("#restart").onclick = () => location.reload();
            el.querySelector("#reset").onclick = () => { if (confirm("Run first-time setup again on next boot?")) { n.setupDone = false; Kernel.saveNVRAM(); Kernel.notify("Settings", "Setup will run on next restart"); } };
          }
        }
        frame();
      },
    });
  }
  Apps.register({ id: "settings", name: "Settings", icon: "⚙️", desktop: true, launch });
})();
