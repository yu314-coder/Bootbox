/* Sticky Notes — Win10-style yellow notes, each its own window, autosaved to VFS. */
(function () {
  const FILE = "/Documents/.stickies.json";
  const COLORS = ["#fff740", "#ff7eb9", "#7afcff", "#bdb2ff", "#caffbf", "#ffd6a5"];
  const open = new Set();

  function store() { try { return JSON.parse(VFS.read(FILE) || "{}"); } catch (e) { return {}; } }
  function save(o) { VFS.write(FILE, JSON.stringify(o)); }
  function uid() { return "n" + Math.floor(performance.now() * 1000) + Object.keys(store()).length; }

  function openNote(id) {
    if (open.has(id)) return;
    const o = store(); if (!o[id]) { o[id] = { text: "", color: COLORS[1] }; save(o); }
    open.add(id);
    WM.open({
      appId: "sticky:" + id, title: "Sticky Note", icon: "🗒️", width: 260, height: 240,
      render(body, win) {
        const note = () => store()[id] || { text: "", color: COLORS[1] };
        const paint = () => {
          const nd = note();
          body.style.background = nd.color; body.style.color = "#222";
          body.innerHTML = `<div style="display:flex;align-items:center;gap:4px;padding:4px 6px;background:rgba(0,0,0,.06)">
              <button class="sn-new" style="border:none;background:transparent;cursor:pointer;font-size:16px">＋</button>
              <span style="flex:1"></span>
              ${COLORS.map(c => `<span class="sn-c" data-c="${c}" style="width:14px;height:14px;border-radius:50%;background:${c};display:inline-block;cursor:pointer;border:1px solid rgba(0,0,0,.2)"></span>`).join("")}
              <button class="sn-del" style="border:none;background:transparent;cursor:pointer;font-size:14px">🗑</button>
            </div>
            <textarea class="sn-t" style="width:100%;height:calc(100% - 34px);border:none;outline:none;resize:none;background:transparent;color:#222;padding:10px;font-size:14px;font-family:'Segoe Print','Segoe UI',sans-serif">${nd.text.replace(/</g, "&lt;")}</textarea>`;
          const ta = body.querySelector(".sn-t");
          ta.oninput = () => { const s = store(); s[id] = s[id] || {}; s[id].text = ta.value; save(s); };
          body.querySelector(".sn-new").onclick = () => openNote(uid());
          body.querySelector(".sn-del").onclick = () => { const s = store(); delete s[id]; save(s); open.delete(id); WM.close(win.id); };
          body.querySelectorAll(".sn-c").forEach(c => c.onclick = () => { const s = store(); s[id].color = c.dataset.c; save(s); paint(); });
        };
        paint();
      },
    });
    // track close
    Kernel.on("proc:end", (p) => { if (p.appId === "sticky:" + id) open.delete(id); });
  }

  function launch() {
    const o = store();
    const ids = Object.keys(o);
    if (!ids.length) openNote(uid());
    else ids.forEach(openNote);
  }
  Apps.register({ id: "sticky", name: "Sticky Notes", icon: "🗒️", desktop: true, launch });
})();
