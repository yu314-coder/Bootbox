/* ============================================================================
 * Windows-10-style built-in apps: Task Manager, Notepad, Calculator, Paint,
 * Photos, Clock, Recycle Bin. All offline, all over the MiniOS VFS/kernel.
 * ========================================================================== */
(function () {
  // ---------- Task Manager (Windows-10 style) ----------
  function taskManager() {
    WM.open({ appId: "taskmgr", title: "Task Manager", icon: "📊", width: 720, height: 520,
      render(body, win) {
        let tab = "proc", perfSel = "cpu";
        const H = 60;
        const hist = { cpu: new Array(H).fill(0), mem: new Array(H).fill(0), disk: new Array(H).fill(0), net: new Array(H).fill(0) };
        const usage = {}; // pid -> {cpu,mem,disk,net}
        const cores = 4, totalRam = 4096;

        function heat(v, max) { // green -> yellow -> orange -> red
          const t = Math.min(1, v / max);
          const r = Math.round(255 * Math.min(1, t * 2)), g = Math.round(200 * Math.min(1, 2 - t * 2));
          return `background:rgba(${r},${g},40,${0.12 + t * 0.5})`;
        }

        function tick() {
          Kernel.list().forEach(p => {
            if (!usage[p.pid]) usage[p.pid] = { cpu: Math.random() * 6, mem: 30 + Math.random() * 180, disk: Math.random() * 2, net: Math.random() * 1 };
            const u = usage[p.pid];
            u.cpu = Math.max(0, Math.min(70, u.cpu + (Math.random() - 0.5) * 5));
            u.mem = Math.max(8, u.mem + (Math.random() - 0.5) * 8);
            u.disk = Math.max(0, Math.min(20, u.disk + (Math.random() - 0.5) * 3));
            u.net = Math.max(0, Math.min(10, u.net + (Math.random() - 0.5) * 2));
          });
          const sum = (k) => Object.values(usage).reduce((a, u) => a + u[k], 0);
          hist.cpu.push(Math.min(100, sum("cpu"))); hist.cpu.shift();
          hist.mem.push(sum("mem")); hist.mem.shift();
          hist.disk.push(Math.min(100, sum("disk") * 5)); hist.disk.shift();
          hist.net.push(sum("net")); hist.net.shift();
          if (tab === "proc") drawProc(); else if (tab === "perf") drawPerf();
        }

        function shell() {
          body.innerHTML = `<div style="display:flex;flex-direction:column;height:100%">
            <div class="toolbar" style="gap:2px;overflow-x:auto">
              ${[["proc", "Processes"], ["perf", "Performance"], ["hist", "App history"], ["start", "Startup"], ["users", "Users"], ["det", "Details"], ["svc", "Services"]]
                .map(([k, n]) => `<button class="btn tb" data-t="${k}" style="${k === tab ? "background:var(--accent);color:#fff;border-color:var(--accent)" : ""}">${n}</button>`).join("")}
            </div>
            <div id="tmbody" style="flex:1;overflow:auto"></div></div>`;
          body.querySelectorAll(".tb").forEach(b => b.onclick = () => { tab = b.dataset.t; shell(); route(); });
        }
        function route() {
          if (tab === "proc" || tab === "perf") tick();
          else if (tab === "hist") drawHist();
          else if (tab === "start") drawStartup();
          else if (tab === "users") drawUsers();
          else if (tab === "det") drawDetails();
          else if (tab === "svc") drawServices();
        }

        function header(cols) {
          return `<div class="list-row" style="position:sticky;top:0;background:rgba(128,128,128,.12);opacity:.85;font-weight:600;font-size:12px">
            <span style="flex:1">Name</span>${cols.map(c => `<span style="width:74px;text-align:right">${c}</span>`).join("")}<span style="width:70px"></span></div>`;
        }
        function procRow(name, u, kill) {
          const cell = (v, unit, max) => `<span style="width:74px;text-align:right;border-radius:4px;${heat(v, max)}">${v.toFixed(unit === "%" ? 0 : 1)}${unit}</span>`;
          const row = document.createElement("div"); row.className = "list-row";
          row.innerHTML = `<span style="flex:1">${name}</span>` +
            cell(u.cpu, "%", 100) + cell(u.mem, " MB", 400) + cell(u.disk, " MB/s", 20) + cell(u.net, " Mbps", 10) +
            `<button class="btn end" style="width:64px">End</button>`;
          row.querySelector(".end").onclick = kill;
          return row;
        }
        function drawProc() {
          const el = body.querySelector("#tmbody"); if (!el) return;
          el.style.padding = "0 8px 8px";
          const procs = Kernel.list();
          el.innerHTML = header(["CPU", "Memory", "Disk", "Network"]);
          // Apps group = windows with UI; background = the rest (synthesize a few)
          const appsHdr = document.createElement("div"); appsHdr.style.cssText = "font-size:12px;font-weight:700;opacity:.7;padding:8px 4px 4px"; appsHdr.textContent = "Apps (" + procs.length + ")";
          el.appendChild(appsHdr);
          procs.forEach(p => el.appendChild(procRow((p.opts && p.opts.icon ? p.opts.icon + " " : "") + p.title, usage[p.pid] || { cpu: 0, mem: 0, disk: 0, net: 0 },
            () => { const w = WM.list().find(x => x.proc.pid === p.pid); if (w) WM.close(w.id); else Kernel.kill(p.pid); tick(); })));
          const bgHdr = document.createElement("div"); bgHdr.style.cssText = "font-size:12px;font-weight:700;opacity:.7;padding:12px 4px 4px"; bgHdr.textContent = "Background processes";
          el.appendChild(bgHdr);
          [["Desktop Window Manager", 18], ["Shell Experience Host", 9], ["Search Indexer", 4], ["System", 6]].forEach(([n, m]) =>
            el.appendChild(procRow("⚙️ " + n, { cpu: m * 0.3, mem: m * 6, disk: 0.4, net: 0.1 }, () => Kernel.notify("Task Manager", "Cannot end system process"))));
          const foot = document.createElement("div"); foot.style.cssText = "padding:10px 4px;opacity:.6;font-size:12px";
          foot.textContent = `CPU ${hist.cpu[H - 1].toFixed(0)}%   ·   Memory ${(hist.mem[H - 1] / totalRam * 100).toFixed(0)}%   ·   Disk ${hist.disk[H - 1].toFixed(0)}%`;
          el.appendChild(foot);
        }
        function spark(arr, max, color, fill) {
          const w = 480, h = 130; let d = "";
          arr.forEach((v, i) => { const x = i / (arr.length - 1) * w, y = h - Math.min(v, max) / max * h; d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1) + " "; });
          return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:100%;height:${h}px;background:rgba(128,128,128,.06);border:1px solid ${color}55;border-radius:6px">
            <path d="${d} L ${w} ${h} L 0 ${h} Z" fill="${fill}"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
        }
        function mini(arr, color) {
          const w = 60, h = 34; let d = "";
          arr.forEach((v, i) => { const x = i / (arr.length - 1) * w, y = h - Math.min(v, 100) / 100 * h; d += (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1) + " "; });
          return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="width:${w}px;height:${h}px"><path d="${d}" fill="none" stroke="${color}" stroke-width="2"/></svg>`;
        }
        function drawPerf() {
          const el = body.querySelector("#tmbody"); if (!el) return;
          el.style.padding = "0";
          const items = [
            { k: "cpu", n: "CPU", color: "#0a84ff", val: hist.cpu[H - 1].toFixed(0) + "%", arr: hist.cpu, max: 100 },
            { k: "mem", n: "Memory", color: "#9b59b6", val: (hist.mem[H - 1] / 1024).toFixed(1) + "/" + (totalRam / 1024) + " GB", arr: hist.mem.map(v => v / totalRam * 100), max: 100 },
            { k: "disk", n: "Disk", color: "#2ecc71", val: hist.disk[H - 1].toFixed(0) + "%", arr: hist.disk, max: 100 },
            { k: "net", n: "Network", color: "#e67e22", val: hist.net[H - 1].toFixed(1) + " Mbps", arr: hist.net.map(v => v * 10), max: 100 },
          ];
          const sel = items.find(i => i.k === perfSel) || items[0];
          el.innerHTML = `<div style="display:flex;height:100%">
            <div style="width:150px;border-right:1px solid rgba(128,128,128,.2);overflow:auto">
              ${items.map(i => `<div class="pf" data-k="${i.k}" style="display:flex;align-items:center;gap:8px;padding:10px;cursor:pointer;${i.k === perfSel ? "background:rgba(128,128,128,.18)" : ""}">
                ${mini(i.arr, i.color)}<div><div style="font-size:13px">${i.n}</div><div style="font-size:11px;opacity:.6">${i.val}</div></div></div>`).join("")}
            </div>
            <div style="flex:1;padding:16px;overflow:auto">
              <h2 style="margin:0 0 4px;color:${sel.color}">${sel.n}</h2>
              <div style="opacity:.7;font-size:13px;margin-bottom:10px">${sel.val}</div>
              ${spark(sel.arr, sel.max, sel.color, sel.color + "22")}
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px;font-size:12px;opacity:.8">
                ${sel.k === "cpu" ? `<div>Cores: ${cores}</div><div>Threads: ${Kernel.list().length + 24}</div><div>Uptime: ${uptime()}</div><div>Speed: virtual</div>`
                  : sel.k === "mem" ? `<div>In use: ${(hist.mem[H - 1] / 1024).toFixed(1)} GB</div><div>Available: ${((totalRam - hist.mem[H - 1]) / 1024).toFixed(1)} GB</div><div>Total: ${totalRam / 1024} GB</div><div>Cached: 0.4 GB</div>`
                  : sel.k === "disk" ? `<div>Active time: ${hist.disk[H - 1].toFixed(0)}%</div><div>Type: Host-backed</div><div>Capacity: ∞ (virtual)</div><div>Read/Write: ok</div>`
                  : `<div>Send: ${(hist.net[H - 1] * 0.4).toFixed(1)} Mbps</div><div>Receive: ${hist.net[H - 1].toFixed(1)} Mbps</div><div>Adapter: MiniOS Virtual</div><div>IPv4: 10.0.2.15</div>`}
              </div></div></div>`;
          el.querySelectorAll(".pf").forEach(p => p.onclick = () => { perfSel = p.dataset.k; drawPerf(); });
        }
        function uptime() { const s = Math.floor((Date.now() - (win.proc.started || Date.now())) / 1000); return Math.floor(s / 60) + "m " + (s % 60) + "s"; }

        function tbl(headers, rows) {
          const el = body.querySelector("#tmbody"); el.style.padding = "8px";
          el.innerHTML = `<div class="list-row" style="opacity:.7;font-weight:600;font-size:12px">${headers.map((h, i) => `<span style="${i === 0 ? "flex:1" : "width:110px"}">${h}</span>`).join("")}</div>` +
            rows.map(r => `<div class="list-row">${r.map((c, i) => `<span style="${i === 0 ? "flex:1" : "width:110px;opacity:.8"}">${c}</span>`).join("")}</div>`).join("");
        }
        function drawHist() { tbl(["Name", "CPU time", "Network"], [["🌐 Browser", "0:12:30", "82.1 MB"], ["📁 File Explorer", "0:01:05", "0 MB"], ["⚙️ Settings", "0:00:20", "0 MB"], ["🛍️ App Center", "0:00:42", "1.2 MB"]]); }
        function drawStartup() { tbl(["Name", "Impact", "Status"], [["Desktop Shell", "High", "Enabled"], ["Clock", "Low", "Disabled"], ["Browser", "Medium", "Disabled"], ["Search Indexer", "Low", "Enabled"]]); }
        function drawUsers() { tbl(["User", "CPU", "Memory"], [["👤 " + (Kernel.nvram.deviceName || "user") + " (You)", hist.cpu[H - 1].toFixed(0) + "%", (hist.mem[H - 1] / 1024).toFixed(1) + " GB"]]); }
        function drawDetails() {
          tbl(["Name", "PID", "Status", "Memory"], Kernel.list().map(p => [p.title, p.pid, "Running", (usage[p.pid]?.mem || 0).toFixed(0) + " MB"]));
        }
        function drawServices() { tbl(["Service", "PID", "Status"], [["MiniOS.Shell", "1", "Running"], ["MiniOS.FileSystem", "2", "Running"], ["MiniOS.Bridge", "3", "Running"], ["MiniOS.Audio", Kernel.nvram.devices.audio ? "5" : "—", Kernel.nvram.devices.audio ? "Running" : "Stopped"], ["MiniOS.Network", Kernel.nvram.devices.network ? "6" : "—", Kernel.nvram.devices.network ? "Running" : "Stopped"]]); }

        shell(); route();
        const iv = setInterval(() => { if (tab === "proc" || tab === "perf") tick(); }, 1200);
        Kernel.on("proc:end", () => { if (tab === "proc") tick(); });
      },
    });
  }

  // ---------- Notepad ----------
  function notepad(args) {
    let path = (args && args.path) || null;
    WM.open({ appId: "notepad", title: "Notepad", icon: "📝", width: 560, height: 440,
      render(body) {
        body.innerHTML = `<div class="toolbar">
          <button class="btn" id="new">New</button><button class="btn" id="open">Open</button>
          <button class="btn" id="save">Save</button><span id="fn" style="opacity:.6;font-size:12px"></span></div>
          <textarea class="field" style="height:calc(100% - 50px);border:none;border-radius:0;resize:none;font-family:Consolas,monospace"></textarea>`;
        const ta = body.querySelector("textarea"), fn = body.querySelector("#fn");
        const load = () => { ta.value = path ? (VFS.read(path) || "") : ""; fn.textContent = path || "(untitled)"; };
        body.querySelector("#new").onclick = () => { path = null; ta.value = ""; fn.textContent = "(untitled)"; };
        body.querySelector("#open").onclick = () => { const p = prompt("Path to open:", "/Documents/notes.txt"); if (p) { path = p; load(); } };
        body.querySelector("#save").onclick = () => { if (!path) path = prompt("Save as:", "/Documents/untitled.txt"); if (path) { VFS.write(path, ta.value); fn.textContent = path; Kernel.notify("Notepad", "Saved " + path); } };
        load();
      },
    });
  }

  // ---------- Calculator ----------
  function calculator() {
    WM.open({ appId: "calc", title: "Calculator", icon: "🧮", width: 280, height: 380,
      render(body) {
        body.innerHTML = `<div class="app"><input class="field" id="d" readonly style="text-align:right;font-size:24px;margin-bottom:8px">
          <div id="pad" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px"></div></div>`;
        const d = body.querySelector("#d"); let expr = "";
        "7 8 9 / 4 5 6 * 1 2 3 - 0 . = + C".split(" ").forEach(k => {
          const b = document.createElement("button"); b.className = "btn"; b.textContent = k; b.style.padding = "14px 0";
          b.onclick = () => { if (k === "C") expr = ""; else if (k === "=") { try { expr = String(Function("return " + expr)()); } catch (e) { expr = "Error"; } } else expr += k; d.value = expr; };
          body.querySelector("#pad").appendChild(b);
        });
      },
    });
  }

  // ---------- Paint ----------
  function paint() {
    WM.open({ appId: "paint", title: "Paint", icon: "🎨", width: 600, height: 460,
      render(body) {
        body.innerHTML = `<div class="toolbar">
          <input type="color" id="col" value="#0078d4"><input type="range" id="sz" min="1" max="40" value="4">
          <button class="btn" id="clr">Clear</button><button class="btn" id="save">Save to Pictures</button></div>
          <canvas style="display:block;background:#fff;cursor:crosshair;touch-action:none;width:100%;height:calc(100% - 50px)"></canvas>`;
        const cv = body.querySelector("canvas"), ctx = cv.getContext("2d");
        const resize = () => { const r = cv.getBoundingClientRect(); cv.width = r.width; cv.height = r.height; };
        setTimeout(resize, 30);
        let drawing = false;
        const pos = (e) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
        cv.addEventListener("pointerdown", (e) => { drawing = true; const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); });
        cv.addEventListener("pointermove", (e) => { if (!drawing) return; const [x, y] = pos(e); ctx.strokeStyle = body.querySelector("#col").value; ctx.lineWidth = body.querySelector("#sz").value; ctx.lineCap = "round"; ctx.lineTo(x, y); ctx.stroke(); });
        window.addEventListener("pointerup", () => drawing = false);
        body.querySelector("#clr").onclick = () => ctx.clearRect(0, 0, cv.width, cv.height);
        body.querySelector("#save").onclick = () => { VFS.write("/Pictures/drawing-" + Date.now() + ".txt", cv.toDataURL(), "image/png"); Kernel.notify("Paint", "Saved to Pictures"); };
      },
    });
  }

  // ---------- Photos (with zoomable viewer) ----------
  function photos() {
    WM.open({ appId: "photos", title: "Photos", icon: "🖼️", width: 640, height: 480,
      render(body) {
        const imgs = [];
        ["/Pictures", "/Downloads", "/Desktop"].forEach(dir => VFS.list(dir).forEach(it => {
          if (it.type === "file") { const c = VFS.read(dir + "/" + it.name); if (c && c.startsWith("data:image")) imgs.push({ name: it.name, data: c }); }
        }));
        function grid() {
          body.innerHTML = `<div class="app"><h2>🖼️ Photos</h2>
            ${imgs.length ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
              ${imgs.map((i, ix) => `<div class="ph" data-ix="${ix}" style="text-align:center;cursor:pointer">
                <img src="${i.data}" style="width:100%;height:120px;object-fit:cover;border-radius:6px">
                <div style="font-size:11px;opacity:.7">${i.name}</div></div>`).join("")}</div>`
            : '<p style="opacity:.6">No images yet. Use Camera, Paint, or the Snipping Tool to create some.</p>'}</div>`;
          body.querySelectorAll(".ph").forEach(p => p.onclick = () => viewer(+p.dataset.ix));
        }
        function viewer(ix) {
          let zoom = 1, ox = 0, oy = 0;
          const draw = () => {
            const i = imgs[ix];
            body.innerHTML = `<div style="height:100%;display:flex;flex-direction:column;background:#111">
              <div class="toolbar" style="border:none">
                <button class="btn" id="back">‹ Gallery</button>
                <span style="flex:1;color:#ccc;font-size:13px;text-align:center">${i.name} (${ix + 1}/${imgs.length})</span>
                <button class="btn" id="zo">−</button><button class="btn" id="zi">+</button>
                <button class="btn" id="prev">‹</button><button class="btn" id="next">›</button></div>
              <div id="vp" style="flex:1;overflow:hidden;display:flex;align-items:center;justify-content:center">
                <img id="vimg" src="${i.data}" style="max-width:100%;max-height:100%;transform:scale(${zoom}) translate(${ox}px,${oy}px);transition:transform .08s">
              </div></div>`;
            body.querySelector("#back").onclick = grid;
            body.querySelector("#zi").onclick = () => { zoom = Math.min(6, zoom + 0.3); draw(); };
            body.querySelector("#zo").onclick = () => { zoom = Math.max(1, zoom - 0.3); if (zoom === 1) { ox = oy = 0; } draw(); };
            body.querySelector("#prev").onclick = () => { ix = (ix - 1 + imgs.length) % imgs.length; zoom = 1; ox = oy = 0; draw(); };
            body.querySelector("#next").onclick = () => { ix = (ix + 1) % imgs.length; zoom = 1; ox = oy = 0; draw(); };
            const vp = body.querySelector("#vp"), img = body.querySelector("#vimg");
            vp.addEventListener("wheel", (e) => { e.preventDefault(); zoom = Math.max(1, Math.min(6, zoom + (e.deltaY < 0 ? 0.2 : -0.2))); if (zoom === 1) ox = oy = 0; img.style.transform = `scale(${zoom}) translate(${ox}px,${oy}px)`; });
            let dragging = false, sx, sy;
            vp.addEventListener("pointerdown", (e) => { if (zoom > 1) { dragging = true; sx = e.clientX; sy = e.clientY; } });
            vp.addEventListener("pointermove", (e) => { if (!dragging) return; ox += (e.clientX - sx) / zoom; oy += (e.clientY - sy) / zoom; sx = e.clientX; sy = e.clientY; img.style.transform = `scale(${zoom}) translate(${ox}px,${oy}px)`; });
            vp.addEventListener("pointerup", () => dragging = false);
          };
          draw();
        }
        grid();
      },
    });
  }

  // ---------- Clock ----------
  function clock() {
    WM.open({ appId: "clockapp", title: "Clock", icon: "🕐", width: 360, height: 360,
      render(body) {
        body.innerHTML = `<div class="app" style="text-align:center"><h2>🕐 Clock</h2>
          <div id="t" style="font-size:44px;font-variant-numeric:tabular-nums"></div>
          <div id="d" style="opacity:.7"></div>
          <h3 style="margin-top:20px">Stopwatch</h3>
          <div id="sw" style="font-size:30px;font-variant-numeric:tabular-nums">00:00.0</div>
          <div class="toolbar" style="justify-content:center;border:none">
            <button class="btn" id="st">Start</button><button class="btn" id="rs">Reset</button></div></div>`;
        const upd = () => { const n = new Date(); body.querySelector("#t").textContent = n.toLocaleTimeString(); body.querySelector("#d").textContent = n.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }); };
        upd(); const iv = setInterval(upd, 1000);
        let sw = 0, running = false, swiv = null;
        const fmt = (ms) => { const t = ms / 1000; return String(Math.floor(t / 60)).padStart(2, "0") + ":" + (t % 60).toFixed(1).padStart(4, "0"); };
        body.querySelector("#st").onclick = (e) => { running = !running; e.target.textContent = running ? "Stop" : "Start"; if (running) swiv = setInterval(() => { sw += 100; body.querySelector("#sw").textContent = fmt(sw); }, 100); else clearInterval(swiv); };
        body.querySelector("#rs").onclick = () => { sw = 0; body.querySelector("#sw").textContent = "00:00.0"; };
      },
    });
  }

  // ---------- Recycle Bin ----------
  function recycleBin() {
    WM.open({ appId: "recycle", title: "Recycle Bin", icon: "🗑️", width: 520, height: 400,
      render(body) {
        function draw() {
          const items = VFS.list("/Trash");
          body.innerHTML = `<div class="app"><h2>🗑️ Recycle Bin</h2>
            <div class="toolbar" style="border:none"><span style="flex:1;opacity:.7">${items.length} item(s)</span>
            <button class="btn" id="empty">Empty Recycle Bin</button></div><div id="tl"></div></div>`;
          const tl = body.querySelector("#tl");
          if (!items.length) tl.innerHTML = '<p style="opacity:.6">Recycle Bin is empty.</p>';
          items.forEach(it => {
            const row = document.createElement("div"); row.className = "list-row";
            row.innerHTML = `<span style="font-size:20px">${it.type === "dir" ? "📁" : "📄"}</span>
              <span style="flex:1">${it.name}</span><button class="btn restore">Restore</button><button class="btn del">Delete</button>`;
            row.querySelector(".restore").onclick = () => { const c = VFS.read("/Trash/" + it.name); if (c != null) VFS.write("/Documents/" + it.name, c); VFS.remove("/Trash/" + it.name); Kernel.notify("Restored", it.name + " → Documents"); draw(); };
            row.querySelector(".del").onclick = () => { VFS.remove("/Trash/" + it.name); draw(); };
            tl.appendChild(row);
          });
          body.querySelector("#empty").onclick = () => { VFS.list("/Trash").forEach(it => VFS.remove("/Trash/" + it.name)); draw(); };
        }
        draw();
      },
    });
  }

  // make sure media folders exist
  ["/Pictures", "/Music", "/Videos"].forEach(d => { if (!VFS.exists(d)) VFS.mkdir(d); });

  Apps.register({ id: "taskmgr", name: "Task Manager", icon: "📊", desktop: false, launch: taskManager });
  Apps.register({ id: "notepad", name: "Notepad", icon: "📝", desktop: true, launch: notepad });
  Apps.register({ id: "calc", name: "Calculator", icon: "🧮", desktop: true, launch: calculator });
  Apps.register({ id: "paint", name: "Paint", icon: "🎨", desktop: true, launch: paint });
  Apps.register({ id: "photos", name: "Photos", icon: "🖼️", desktop: true, launch: photos });
  Apps.register({ id: "clockapp", name: "Clock", icon: "🕐", desktop: true, launch: clock });
  Apps.register({ id: "recycle", name: "Recycle Bin", icon: "🗑️", desktop: true, launch: recycleBin });
})();
