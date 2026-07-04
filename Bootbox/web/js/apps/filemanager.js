/* File Explorer — browses the MiniOS VFS, opens text files, basic create/delete. */
(function () {
  function launch(args) {
    let cwd = args.path || "/Desktop";
    WM.open({
      appId: "files", title: "File Explorer", icon: "📁", width: 640, height: 420,
      render(body, win) {
        let view = "details";          // "list" | "details" | "icons"
        let sel = new Set();           // selected names in cwd
        const here = (n) => (cwd === "/" ? "" : cwd) + "/" + n;

        function bulk(op) {
          const names = [...sel]; if (!names.length) return;
          if (op === "delete") names.forEach(n => VFS.remove(here(n)));
          else window.__fmClipMulti = { dir: cwd, names, op };
          if (op === "cut" || op === "copy") window.__fmClip = { multi: window.__fmClipMulti };
          sel.clear(); Kernel.emit("fs:change");
        }

        function draw() {
          const items = VFS.list(cwd);
          const crumbs = cwd.split("/").filter(Boolean);
          // keep only still-existing selections
          sel = new Set([...sel].filter(n => items.some(i => i.name === n)));
          const hasClip = window.__fmClip || window.__fmClipMulti;
          body.innerHTML = `
            <div class="toolbar">
              <button class="btn" data-act="up">⬆ Up</button>
              <button class="btn" data-act="newfolder">＋ Folder</button>
              <button class="btn" data-act="newfile">＋ Text</button>
              <button class="btn" data-act="paste" ${hasClip ? "" : "disabled"}>📋 Paste</button>
              <span style="flex:1"></span>
              <button class="btn vt" data-v="list" title="List">≣</button>
              <button class="btn vt" data-v="details" title="Details">▤</button>
              <button class="btn vt" data-v="icons" title="Large icons">▦</button>
            </div>
            <div class="toolbar" style="border:none;gap:4px;flex-wrap:wrap">
              <span class="crumb" data-p="/" style="cursor:pointer;opacity:.8">💻 ${Kernel.nvram.deviceName}</span>
              ${crumbs.map((c, i) => `<span style="opacity:.4">›</span>
                <span class="crumb" data-p="/${crumbs.slice(0, i + 1).join("/")}" style="cursor:pointer;opacity:.8">${c}</span>`).join("")}
              <span style="flex:1"></span>
              <span id="selinfo" style="opacity:.6;font-size:12px"></span>
            </div>
            <div class="files-list" style="${view === "icons" ? "display:flex;flex-wrap:wrap;align-content:flex-start;gap:10px;padding:10px" : ""}"></div>`;
          const list = body.querySelector(".files-list");
          body.querySelectorAll(".vt").forEach(b => { if (b.dataset.v === view) b.style.background = "var(--accent)", b.style.color = "#fff"; b.onclick = () => { view = b.dataset.v; draw(); }; });

          if (view === "details") {
            const h = document.createElement("div"); h.className = "list-row"; h.style.cssText = "opacity:.6;font-weight:600;font-size:12px";
            h.innerHTML = `<span style="width:24px"></span><span style="flex:1">Name</span><span style="width:90px">Type</span><span style="width:80px;text-align:right">Size</span>`;
            list.appendChild(h);
          }
          if (!items.length) list.insertAdjacentHTML("beforeend", `<div class="app" style="opacity:.6">This folder is empty.</div>`);

          items.forEach(it => {
            const isSel = sel.has(it.name);
            const row = document.createElement("div");
            row.draggable = true;
            const glyph = it.type === "dir" ? "📁" : "📄";
            if (view === "icons") {
              row.style.cssText = "width:96px;height:92px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 4px;border-radius:8px;cursor:pointer;text-align:center;" + (isSel ? "background:rgba(0,120,212,.35)" : "");
              row.innerHTML = `<div style="font-size:38px">${glyph}</div><div style="font-size:11px;word-break:break-word">${it.name}</div>`;
            } else {
              row.className = "list-row"; if (isSel) row.style.background = "rgba(0,120,212,.30)";
              if (view === "details")
                row.innerHTML = `<span style="width:24px;font-size:18px">${glyph}</span><span style="flex:1">${it.name}</span>
                  <span style="width:90px;opacity:.7;font-size:12px">${it.type === "dir" ? "Folder" : ((it.name.split(".").pop() || "file").toUpperCase() + " file")}</span>
                  <span style="width:80px;text-align:right;opacity:.7;font-size:12px">${it.type === "dir" ? "" : it.size + " B"}</span>`;
              else
                row.innerHTML = `<span style="font-size:20px">${glyph}</span><span style="flex:1">${it.name}</span>`;
            }
            const open = () => { const p = here(it.name); if (it.type === "dir") { cwd = p; sel.clear(); draw(); } else openText(p); };
            // selection vs open (single-click selects; double-click / Enter opens; folder single-click navigates only via dbl)
            row.onclick = (e) => {
              if (e.metaKey || e.ctrlKey) { isSel ? sel.delete(it.name) : sel.add(it.name); draw(); return; }
              if (e.shiftKey && sel.size) {
                const names = items.map(i => i.name); const a = names.indexOf([...sel][sel.size - 1]); const b = names.indexOf(it.name);
                names.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(n => sel.add(n)); draw(); return;
              }
              sel = new Set([it.name]); draw();
            };
            row.ondblclick = open;
            // ---- drag (whole selection if part of it) ----
            row.addEventListener("dragstart", (e) => {
              if (!sel.has(it.name)) sel = new Set([it.name]);
              window.__fmDrag = { dir: cwd, names: [...sel] };
              e.dataTransfer.effectAllowed = "move"; row.style.opacity = ".5";
            });
            row.addEventListener("dragend", () => { row.style.opacity = ""; window.__fmDrag = null; });
            const openCtx = (x, y) => { if (!sel.has(it.name)) sel = new Set([it.name]); fmMenu(x, y, [
              { label: "Open", run: open },
              { label: "Cut" + (sel.size > 1 ? " (" + sel.size + ")" : ""), run: () => bulk("cut") },
              { label: "Copy" + (sel.size > 1 ? " (" + sel.size + ")" : ""), run: () => bulk("copy") },
              { label: "Rename", run: () => { const nn = prompt("Rename to:", it.name); if (nn && nn !== it.name) { moveNode(here(it.name), here(nn)); Kernel.emit("fs:change"); } } },
              { sep: true },
              { label: "Delete" + (sel.size > 1 ? " (" + sel.size + ")" : ""), run: () => bulk("delete") },
            ]); };
            row.addEventListener("contextmenu", (e) => { e.preventDefault(); openCtx(e.clientX, e.clientY); });
            let lp; row.addEventListener("touchstart", (e) => { lp = setTimeout(() => openCtx(e.touches[0].clientX, e.touches[0].clientY), 500); });
            row.addEventListener("touchend", () => clearTimeout(lp));
            if (it.type === "dir") {
              row.addEventListener("dragover", (e) => { e.preventDefault(); row.style.outline = "2px solid var(--accent)"; });
              row.addEventListener("dragleave", () => row.style.outline = "");
              row.addEventListener("drop", (e) => { e.preventDefault(); e.stopPropagation(); row.style.outline = ""; moveDropped(here(it.name)); });
            }
            list.appendChild(row);
          });
          const info = body.querySelector("#selinfo");
          if (info) info.textContent = sel.size ? sel.size + " selected" : items.length + " item(s)";

          list.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; });
          list.addEventListener("drop", (e) => { e.preventDefault(); moveDropped(cwd); });

          body.querySelector('[data-act="up"]').onclick = () => { const p = cwd.split("/").filter(Boolean); p.pop(); cwd = "/" + p.join("/"); sel.clear(); draw(); };
          body.querySelector('[data-act="newfolder"]').onclick = () => { const name = prompt("Folder name:"); if (name) { VFS.mkdir(here(name)); Kernel.emit("fs:change"); } };
          body.querySelector('[data-act="newfile"]').onclick = () => { const name = prompt("File name:", "untitled.txt"); if (name) { VFS.write(here(name), ""); Kernel.emit("fs:change"); } };
          body.querySelector('[data-act="paste"]').onclick = () => {
            const m = window.__fmClipMulti; if (!m) return;
            m.names.forEach(name => {
              const src = (m.dir === "/" ? "" : m.dir) + "/" + name;
              let dest = here(name); while (VFS.exists(dest)) dest = here("Copy of " + dest.split("/").pop());
              copyRec(src, dest); if (m.op === "cut") VFS.remove(src);
            });
            if (m.op === "cut") { window.__fmClipMulti = null; window.__fmClip = null; }
            Kernel.emit("fs:change");
          };
          body.querySelectorAll(".crumb").forEach(b => b.onclick = () => { cwd = b.dataset.p; sel.clear(); draw(); });
        }
        // Ctrl+A select all
        body.addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key === "a") { e.preventDefault(); sel = new Set(VFS.list(cwd).map(i => i.name)); draw(); } });

        function openText(path) {
          const content = VFS.read(path) || "";
          WM.open({
            appId: "notepad", title: path.split("/").pop() + " — Notepad", icon: "📝",
            width: 520, height: 380,
            render(b2) {
              b2.innerHTML = `<div class="toolbar"><button class="btn save">💾 Save</button>
                <button class="btn copy">Copy all</button></div>
                <textarea class="field" style="height:calc(100% - 50px);border:none;border-radius:0;resize:none;font-family:monospace">${content.replace(/</g,"&lt;")}</textarea>`;
              const ta = b2.querySelector("textarea");
              b2.querySelector(".save").onclick = () => { VFS.write(path, ta.value); Kernel.notify("Saved", path); };
              b2.querySelector(".copy").onclick = () => Kernel.sys.clipboardCopy(ta.value);
            },
          });
        }
        // recursive copy (file or directory subtree)
        function copyRec(src, dest) {
          if (VFS.isDir(src)) {
            VFS.mkdir(dest);
            VFS.list(src).forEach(it => copyRec((src === "/" ? "" : src) + "/" + it.name, dest + "/" + it.name));
          } else {
            VFS.write(dest, VFS.read(src) || "");
          }
        }
        function moveNode(src, dest) {
          if (dest === src || dest.startsWith(src + "/")) return;
          copyRec(src, dest); VFS.remove(src);
        }
        function fmMenu(x, y, items) {
          document.getElementById("fm-ctx")?.remove();
          const m = document.createElement("div");
          m.id = "fm-ctx";
          m.style.cssText = "position:fixed;z-index:100002;min-width:160px;background:rgba(40,40,48,.98);border-radius:8px;" +
            "padding:6px;box-shadow:0 10px 40px rgba(0,0,0,.5);font-size:13px;color:#fff;left:" +
            Math.min(x, innerWidth - 180) + "px;top:" + Math.min(y, innerHeight - 240) + "px";
          m.innerHTML = items.map((it, i) => it.sep ? '<div style="height:1px;background:rgba(255,255,255,.15);margin:4px 0"></div>'
            : `<div class="fmi" data-i="${i}" style="padding:8px 12px;border-radius:5px;cursor:pointer">${it.label}</div>`).join("");
          document.body.appendChild(m);
          m.querySelectorAll(".fmi").forEach(d => {
            d.onmouseenter = () => d.style.background = "var(--accent)";
            d.onmouseleave = () => d.style.background = "";
            d.onclick = () => { m.remove(); items[+d.dataset.i].run(); };
          });
          const off = (ev) => { if (!ev.target.closest("#fm-ctx")) { m.remove(); document.removeEventListener("pointerdown", off); } };
          setTimeout(() => document.addEventListener("pointerdown", off), 0);
        }
        function moveDropped(destDir) {
          const d = window.__fmDrag; window.__fmDrag = null;
          if (!d || !d.names) return;
          let moved = 0;
          d.names.forEach(name => {
            const src = (d.dir === "/" ? "" : d.dir) + "/" + name;
            const dest = (destDir === "/" ? "" : destDir) + "/" + name;
            if (dest === src || dest.startsWith(src + "/")) return; // no-op / into itself
            if (VFS.exists(dest)) return;
            copyRec(src, dest); VFS.remove(src); moved++;
          });
          if (moved) { Kernel.notify("Moved", moved + " item(s) → " + (destDir || "/")); Kernel.emit("fs:change"); }
        }

        // keep every open File Explorer in sync after moves/deletes
        Kernel.on("fs:change", () => { if (body.isConnected) draw(); });

        draw();
      },
    });
  }

  Apps.register({ id: "files", name: "File Explorer", icon: "📁", desktop: true, launch });
})();
