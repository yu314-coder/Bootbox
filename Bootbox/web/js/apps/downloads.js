/* Downloads — manage files in /Downloads: open, delete, reveal in File Explorer. */
(function () {
  function human(n) { return n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; }

  function launch() {
    WM.open({
      appId: "downloads", title: "Downloads", icon: "⬇️", width: 600, height: 440,
      render(body) {
        function draw() {
          const items = VFS.list("/Downloads");
          body.innerHTML = `<div class="app"><h2>⬇️ Downloads</h2>
            <div class="toolbar" style="border:none">
              <span style="flex:1;opacity:.7">${items.length} item(s)</span>
              <button class="btn" id="reveal">📁 Open folder</button>
              <button class="btn" id="clear">Clear all</button></div>
            <div id="dl"></div></div>`;
          const dl = body.querySelector("#dl");
          if (!items.length) dl.innerHTML = '<p style="opacity:.6">No downloads yet. Use the Browser to download files.</p>';
          items.forEach(it => {
            const path = "/Downloads/" + it.name;
            const content = VFS.read(path) || "";
            const isImg = content.startsWith("data:image");
            const row = document.createElement("div"); row.className = "list-row";
            row.innerHTML = `<span style="font-size:20px">${isImg ? "🖼️" : "📄"}</span>
              <span style="flex:1">${it.name}<br><small style="opacity:.6">${human(it.size)}</small></span>
              <button class="btn open">Open</button><button class="btn del">🗑</button>`;
            row.querySelector(".open").onclick = () => {
              if (isImg) Apps.launch("photos");
              else Apps.launch("notepad", { path });
            };
            row.querySelector(".del").onclick = () => { VFS.remove(path); draw(); };
            dl.appendChild(row);
          });
          body.querySelector("#reveal").onclick = () => Apps.launch("files", { path: "/Downloads" });
          body.querySelector("#clear").onclick = () => { VFS.list("/Downloads").forEach(it => VFS.remove("/Downloads/" + it.name)); draw(); };
        }
        draw();
        Kernel.on("download:done", draw);
      },
    });
  }
  Apps.register({ id: "downloads", name: "Downloads", icon: "⬇️", desktop: true, launch });
})();
