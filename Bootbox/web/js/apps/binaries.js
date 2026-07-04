/* ============================================================================
 * Compatibility Center — lists imported EXE / APK binaries and shows the real
 * native inspection report (PE parser for EXE, ZIP+AXML for APK).
 * Files arrive via "Open in MiniOS" from Files / AirDrop / USB drive.
 * ========================================================================== */
(function () {
  function kind(name) {
    const n = name.toLowerCase();
    return n.endsWith(".apk") ? "apk" : n.endsWith(".exe") ? "exe" : "other";
  }
  function icon(name) { return { apk: "🤖", exe: "🪟", other: "📦" }[kind(name)]; }

  function launch(args) {
    WM.open({
      appId: "binaries", title: "Compatibility Center", icon: "🧩", width: 640, height: 480,
      async render(body, win) {
        async function draw() {
          let names = [];
          try { names = await Kernel.sys.listBinaries(); } catch (e) {}
          body.innerHTML = `<div class="app">
            <h2>🧩 Compatibility Center</h2>
            <p style="opacity:.7;font-size:13px">Import an <b>.exe</b> or <b>.apk</b> from Files / AirDrop / a
            USB drive (share → “Open in MiniOS”), then inspect it here.</p>
            <button class="btn" id="ski-demo" style="margin:2px 0 8px">🎿 Try the SkiFree demo (real .exe via Wine)</button>
            <div id="blist"></div>
            ${names.length ? "" : '<div style="opacity:.6;margin-top:10px">No binaries imported yet.</div>'}
          </div>`;
          const list = body.querySelector("#blist");
          const demo = body.querySelector("#ski-demo");
          if (demo) demo.onclick = async () => {
            try {
              const r = await fetch("ski32.exe"); if (!r.ok) throw new Error("demo not bundled");
              const buf = new Uint8Array(await r.arrayBuffer());
              if (window.WineRuntime) WineRuntime.run({ exeBytes: buf, exeName: "ski32.exe" });
              else Kernel.notify("Wine", "Wine runtime not available.");
            } catch (e) { Kernel.notify("SkiFree demo", e.message || String(e)); }
          };
          names.forEach(name => {
            const row = document.createElement("div");
            row.className = "list-row";
            row.innerHTML = `<span style="font-size:22px">${icon(name)}</span>
              <span style="flex:1">${name}<br><small style="opacity:.6">${kind(name).toUpperCase()}</small></span>
              <button class="btn insp">Inspect</button><button class="btn del">🗑</button>`;
            row.querySelector(".insp").onclick = () => inspect(name);
            row.querySelector(".del").onclick = async () => { await Kernel.sys.deleteBinary(name); draw(); };
            list.appendChild(row);
          });
        }

        async function inspect(name) {
          let r; try { r = await Kernel.sys.inspectBinary(name); } catch (e) { Kernel.notify("Error", e.message); return; }
          const supported = !!r.supported;
          const rows = (obj) => Object.entries(obj).map(([k, v]) =>
            `<div class="list-row"><span style="flex:1">${k}</span><b style="text-align:right">${Array.isArray(v) ? (v.join(", ") || "—") : (v === "" ? "—" : v)}</b></div>`).join("");
          let fields;
          if (r.kind === "apk") fields = { Package: r.package, Label: r.label, Version: r.versionName,
            "min/target SDK": (r.minSdk || "?") + " / " + (r.targetSdk || "?"),
            "Has DEX": r.hasDex ? "Yes" : "No", "Native libs": r.nativeLibs, "Play Services": r.usesPlayServices ? "Yes" : "No",
            "Zip entries": r.entryCount };
          else if (r.kind === "exe") fields = { Format: r.format, Machine: r.machine, Subsystem: r.subsystem,
            Sections: r.sections, Size: r.size + " B" };
          else fields = { Name: r.name, Note: r.error || "unknown format" };

          WM.open({
            appId: "report", title: name + " — Report", icon: icon(name), width: 460, height: 460,
            render(b) {
              b.innerHTML = `<div class="app">
                <h2>${icon(name)} ${name}</h2>
                ${rows(fields)}
                ${r.permissions ? `<h3>Permissions</h3><div style="opacity:.8;font-size:12px">${r.permissions.map(p=>"• "+p).join("<br>") || "none"}</div>` : ""}
                <h3>Verdict</h3>
                <div style="padding:10px;border-radius:8px;background:${supported ? "rgba(0,180,120,.18)" : "rgba(230,140,40,.18)"}">
                  ${supported ? "✅ " : "⚠️ "}${r.verdict || ""}
                </div>
                <div class="toolbar" style="border:none">
                  <button class="btn" id="run">▶ Run harness</button>
                  ${r.kind === "apk" ? '<button class="btn" id="dex">🤖 Execute DEX (real)</button>' : ""}
                  ${r.kind === "exe" ? '<button class="btn" id="wine">🍷 Run with Wine (real .exe)</button>' : ""}
                </div>
                <div id="dexout" class="term" style="display:none;height:180px;margin-top:8px"></div></div>`;
              b.querySelector("#run").onclick = () => Launcher.open(r);
              const wineBtn = b.querySelector("#wine");
              if (wineBtn) wineBtn.onclick = async () => {
                let exeBytes = null;
                try {
                  const res = await Kernel.sys.readBinary(r.name);
                  if (res && res.base64) {
                    const bin = atob(res.base64); exeBytes = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) exeBytes[i] = bin.charCodeAt(i);
                  }
                } catch (e) {}
                WineRuntime.run({ exeBytes, exeName: r.name });
              };
              const dexBtn = b.querySelector("#dex");
              if (dexBtn) dexBtn.onclick = async () => {
                const out = b.querySelector("#dexout"); out.style.display = "block"; out.textContent = "Extracting classes.dex…\n";
                try {
                  const res = await Kernel.sys.getDex(r.name);
                  if (!res || !res.base64) { out.textContent += "No classes.dex (or running in browser dev — import a real APK on device)."; return; }
                  const bin = atob(res.base64); const bytes = new Uint8Array(bin.length);
                  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                  out.textContent = "";
                  window.Dex.run(bytes, (s) => { out.textContent += s; out.scrollTop = 1e9; });
                } catch (e) { out.textContent += "DEX error: " + e.message; }
              };
            },
          });
        }

        // Live refresh when a new file is imported.
        Kernel.on("file:imported", (p) => {
          if (["apk", "exe"].includes(kind(p.name))) draw();
        });
        draw();
      },
    });
  }

  Apps.register({ id: "binaries", name: "Compatibility", icon: "🧩", desktop: true, launch });
})();
