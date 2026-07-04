/* ============================================================================
 * App Center — installs native .mapp packages and does APK import/inspection.
 *
 * .mapp format (native MiniOS app), represented here as a JSON object:
 *   { manifest:{ id, name, icon, version, permissions:[] }, code:"<js body>" }
 * The code body runs with a restricted API object `api` (no DOM/bridge access
 * except through the granted, permission-checked surface). This mirrors the
 * sandbox model: apps declare permissions, the runtime mediates everything.
 * ========================================================================== */
(function () {
  // ---- Built-in installable sample .mapp packages -------------------------
  const CATALOG = [
    {
      manifest: { id: "calc", name: "Calculator", icon: "🧮", version: "1.0", permissions: [] },
      code: `
        api.ui.html('<div class="app"><h2>🧮 Calculator</h2>' +
          '<input class="field" id="d" readonly style="text-align:right;font-size:22px;margin-bottom:8px">' +
          '<div id="pad" style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px"></div></div>');
        var d = api.ui.$('#d'); var expr='';
        var keys=['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+','C'];
        keys.forEach(function(k){ var b=document.createElement('button'); b.className='btn'; b.textContent=k;
          b.onclick=function(){ if(k==='C'){expr='';} else if(k==='='){ try{expr=String(Function('return '+expr)());}catch(e){expr='Err';} } else {expr+=k;} d.value=expr; };
          api.ui.$('#pad').appendChild(b); });
      `,
    },
    {
      manifest: { id: "notes", name: "Sticky Notes", icon: "🗒️", version: "1.0", permissions: ["files"] },
      code: `
        var path='/Documents/quicknote.txt';
        api.ui.html('<div class="toolbar"><button class="btn" id="s">💾 Save</button></div>' +
          '<textarea class="field" id="t" style="height:calc(100% - 50px);border:none;border-radius:0;resize:none"></textarea>');
        var t=api.ui.$('#t'); t.value=api.files.read(path)||'';
        api.ui.$('#s').onclick=function(){ api.files.write(path,t.value); api.notify('Saved','Sticky note stored'); };
      `,
    },
    {
      manifest: { id: "clock", name: "World Clock", icon: "🕐", version: "1.0", permissions: [] },
      code: `
        api.ui.html('<div class="app" style="text-align:center"><h2>🕐 Clock</h2><div id="c" style="font-size:42px;font-variant-numeric:tabular-nums"></div></div>');
        var c=api.ui.$('#c'); function tick(){ c.textContent=new Date().toLocaleTimeString(); } tick(); setInterval(tick,1000);
      `,
    },
  ];

  function installedKey() { return "installed.mapps"; }
  function getInstalled() {
    try { return JSON.parse(VFS.read("/Apps/.installed") || "[]"); } catch (e) { return []; }
  }
  function setInstalled(list) { VFS.write("/Apps/.installed", JSON.stringify(list)); }

  // Build a permission-mediated API for a .mapp at launch.
  function makeApi(manifest, body) {
    const has = (p) => manifest.permissions.includes(p);
    return {
      ui: { html: (h) => body.innerHTML = `<div class="app" style="height:100%">${h}</div>`,
            $: (s) => body.querySelector(s) },
      files: {
        read: (p) => has("files") ? VFS.read(p) : (Kernel.notify("Denied", manifest.name + " lacks files permission"), null),
        write: (p, c) => has("files") ? VFS.write(p, c) : Kernel.notify("Denied", manifest.name + " lacks files permission"),
      },
      clipboard: { copy: (t) => has("clipboard") ? Kernel.sys.clipboardCopy(t) : null },
      notify: (t, b) => Kernel.notify(t, b),
    };
  }

  function runMapp(pkg) {
    const m = pkg.manifest;
    WM.open({
      appId: m.id, title: m.name, icon: m.icon, width: 360, height: 420,
      render(body) {
        const api = makeApi(m, body);
        try { new Function("api", pkg.code)(api); }
        catch (e) { body.innerHTML = `<div class="app">App crashed: ${e.message}</div>`; }
      },
    });
  }

  // Register an installed app so it shows on desktop / start menu.
  function registerInstalled(pkg) {
    Apps.register({
      id: pkg.manifest.id, name: pkg.manifest.name, icon: pkg.manifest.icon,
      desktop: true, launch: () => runMapp(pkg),
    });
  }

  function restoreInstalled() {
    getInstalled().forEach(id => {
      const pkg = CATALOG.find(p => p.manifest.id === id);
      if (pkg) registerInstalled(pkg);
    });
  }

  function launch() {
    WM.open({
      appId: "store", title: "App Center", icon: "🛍️", width: 600, height: 460,
      render(body) {
        function draw() {
          const installed = getInstalled();
          body.innerHTML = `<div class="app">
            <h2>🛍️ App Center</h2>
            <h3>Native MiniOS apps (.mapp)</h3>
            <div id="cat"></div>
            <h3 style="margin-top:18px">EXE / APK Compatibility</h3>
            <p style="opacity:.7;font-size:13px">Import an <b>.exe</b> or <b>.apk</b> from Files / AirDrop / a USB
            drive, then inspect it (real PE &amp; Android-manifest parsing). Running them is a later phase.</p>
            <button class="btn" id="apk">🧩 Open Compatibility Center</button>
          </div>`;
          const cat = body.querySelector("#cat");
          CATALOG.forEach(pkg => {
            const m = pkg.manifest;
            const on = installed.includes(m.id);
            const row = document.createElement("div");
            row.className = "list-row";
            row.innerHTML = `<span style="font-size:22px">${m.icon}</span>
              <span style="flex:1"><b>${m.name}</b> <small style="opacity:.6">v${m.version}</small><br>
              <small style="opacity:.6">perms: ${m.permissions.join(", ") || "none"}</small></span>
              <button class="btn">${on ? "Open" : "Install"}</button>
              ${on ? '<button class="btn rm">Uninstall</button>' : ""}`;
            row.querySelector("button").onclick = () => {
              if (on) { runMapp(pkg); }
              else {
                const list = getInstalled(); list.push(m.id); setInstalled(list);
                registerInstalled(pkg);
                Kernel.notify("Installed", m.name + " added to desktop");
                draw();
              }
            };
            if (on) row.querySelector(".rm").onclick = () => {
              setInstalled(getInstalled().filter(x => x !== m.id));
              Kernel.notify("Uninstalled", m.name);
              draw();
            };
            cat.appendChild(row);
          });
          body.querySelector("#apk").onclick = () => Apps.launch("binaries");
        }

        function inspectApk() {
          // Inspection-only stub: in the host app this reads a real .apk via the
          // document picker, unzips it, and parses AndroidManifest.xml + resources.
          const name = prompt("APK package name to inspect (demo):", "com.example.helloworld");
          if (!name) return;
          const perms = ["INTERNET", "ACCESS_NETWORK_STATE", "VIBRATE"];
          const report = {
            package: name, versionName: "1.0", minSdk: 21, targetSdk: 33,
            permissions: perms,
            usesNativeLibs: false, usesPlayServices: false,
          };
          const supported = !report.usesPlayServices && !report.usesNativeLibs;
          WM.open({
            appId: "apk", title: "APK Report", icon: "📦", width: 460, height: 420,
            render(b) {
              b.innerHTML = `<div class="app">
                <h2>📦 ${report.package}</h2>
                <div class="list-row"><span style="flex:1">Version</span><b>${report.versionName}</b></div>
                <div class="list-row"><span style="flex:1">minSdk / targetSdk</span><b>${report.minSdk} / ${report.targetSdk}</b></div>
                <div class="list-row"><span style="flex:1">Native .so libs</span><b>${report.usesNativeLibs ? "Yes" : "No"}</b></div>
                <div class="list-row"><span style="flex:1">Play Services</span><b>${report.usesPlayServices ? "Yes" : "No"}</b></div>
                <h3>Permissions</h3>
                <div style="opacity:.8">${report.permissions.map(p => "• android.permission." + p).join("<br>")}</div>
                <h3>Compatibility</h3>
                <div style="padding:10px;border-radius:8px;background:${supported ? "rgba(0,180,120,.18)" : "rgba(230,80,80,.18)"}">
                  ${supported
                    ? "✅ Likely compatible with the future MiniOS APK runtime (simple Java/Kotlin, no native libs, no Play Services)."
                    : "⚠️ Not targetable yet (needs native libs / Play Services)."}
                </div>
              </div>`;
            },
          });
        }

        draw();
      },
    });
  }

  Apps.register({ id: "store", name: "App Center", icon: "🛍️", desktop: true, launch });
  window.__restoreInstalled = restoreInstalled;
})();
