/* ============================================================================
 * Browser — Chrome-like browser for MiniOS.
 *
 *  On device: each tab is a REAL native WKWebView overlaid (via the browser
 *  bridge) on top of the runtime, positioned to match this window's view area.
 *  This avoids iframe embedding limits, so Google/YouTube/etc. work.
 *
 *  In a plain browser (dev): falls back to a sandboxed <iframe>.
 *
 *  Features: multi-tab, omnibox (URL or search), back/forward/reload/home,
 *  new tab, live title + loading state from the native engine.
 * ========================================================================== */
(function () {
  const HOME = "about:home";
  const SEARCH = "https://duckduckgo.com/?q=";
  const QUICK = [
    { name: "Google", url: "https://www.google.com", glyph: "🔍" },
    { name: "YouTube", url: "https://www.youtube.com", glyph: "▶️" },
    { name: "Wikipedia", url: "https://wikipedia.org", glyph: "📚" },
    { name: "DuckDuckGo", url: "https://duckduckgo.com", glyph: "🦆" },
    { name: "MDN", url: "https://developer.mozilla.org", glyph: "📘" },
  ];
  const native = !!(window.Bridge && Bridge.onDevice);
  let uid = 1;

  function normalize(input) {
    let q = (input || "").trim();
    if (!q || q === HOME) return HOME;
    if (/^https?:\/\//i.test(q)) return q;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(q) && !q.includes(" ")) return "https://" + q;
    return SEARCH + encodeURIComponent(q);
  }

  function launch(args) {
    let tabs = [], active = 0;

    WM.open({
      appId: "browser", title: "Browser", icon: "🌐", width: 880, height: 600,
      render(body, win) {
        body.style.background = "#fff";
        body.innerHTML = `
          <div style="display:flex;flex-direction:column;height:100%;background:#dee1e6">
            <div id="tabbar" style="display:flex;align-items:flex-end;gap:2px;padding:6px 6px 0;overflow-x:auto"></div>
            <div style="display:flex;align-items:center;gap:6px;padding:8px;background:#fff">
              <button class="nbtn" id="back">◀</button><button class="nbtn" id="fwd">▶</button>
              <button class="nbtn" id="reload">⟳</button><button class="nbtn" id="home">⌂</button>
              <input id="omni" style="flex:1;height:34px;border-radius:17px;border:1px solid #ccc;padding:0 16px;font-size:13px;outline:none"
                placeholder="Search or type a URL">
              <span id="spin" style="width:18px;font-size:13px;color:#888"></span>
              <button class="nbtn" id="go">→</button>
            </div>
            <div id="view" style="flex:1;background:#fff;position:relative;overflow:auto"></div>
          </div>
          <style>
            .nbtn{width:34px;height:34px;border:none;background:transparent;border-radius:6px;cursor:pointer;font-size:15px;color:#444}
            .nbtn:hover{background:#eee}
            .btab{display:flex;align-items:center;gap:6px;max-width:200px;min-width:120px;height:34px;padding:0 10px;
              background:#f1f3f4;border-radius:8px 8px 0 0;cursor:pointer;font-size:12px;color:#333;white-space:nowrap}
            .btab.active{background:#fff}
            .btab .x{margin-left:auto;border-radius:50%;width:18px;height:18px;line-height:18px;text-align:center}
            .btab .x:hover{background:#ddd}
            .newtab{width:30px;height:30px;border:none;background:transparent;border-radius:6px;cursor:pointer;font-size:16px}
          </style>`;
        const $ = (s) => body.querySelector(s);
        const view = $("#view"), omni = $("#omni"), spin = $("#spin");
        const cur = () => tabs[active];

        function renderTabs() {
          const tb = $("#tabbar"); tb.innerHTML = "";
          tabs.forEach((t, i) => {
            const el = document.createElement("div");
            el.className = "btab" + (i === active ? " active" : "");
            el.innerHTML = `<span>🌐</span><span style="overflow:hidden;text-overflow:ellipsis">${t.title || "New Tab"}</span><span class="x">✕</span>`;
            el.onclick = (e) => { if (e.target.classList.contains("x")) closeTab(i); else { active = i; paint(); } };
            tb.appendChild(el);
          });
          const add = document.createElement("button");
          add.className = "newtab"; add.textContent = "＋"; add.onclick = () => newTab(HOME);
          tb.appendChild(add);
        }

        function nativeRect() {
          const r = view.getBoundingClientRect();
          return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
        }

        function newTab(url) {
          const id = "tab" + (uid++);
          const t = { id, url: url || HOME, title: "New Tab", loading: false };
          tabs.push(t); active = tabs.length - 1;
          if (native && t.url !== HOME) Bridge.call("browser", "open", { id, url: normalize(t.url), rect: nativeRect() });
          paint();
        }
        function closeTab(i) {
          const t = tabs[i];
          if (native) Bridge.call("browser", "close", { id: t.id });
          tabs.splice(i, 1);
          if (!tabs.length) { stopSync(); WM.close(win.id); return; }
          active = Math.max(0, active - (i <= active ? 1 : 0));
          paint();
        }
        function navigate(input) {
          const t = cur(); const url = normalize(input); t.url = url;
          if (url === HOME) { if (native) Bridge.call("browser", "hide", { id: t.id }); }
          else if (native) {
            Bridge.call("browser", "show", { id: t.id });
            Bridge.call("browser", "open", { id: t.id, url, rect: nativeRect() });
          }
          paint();
        }

        function paint() {
          renderTabs();
          const t = cur(); omni.value = t.url === HOME ? "" : t.url;
          spin.textContent = t.loading ? "⟳" : "";
          if (native) {
            // hide every tab, show the active one over the view area
            tabs.forEach(x => Bridge.call("browser", "hide", { id: x.id }));
            if (t.url === HOME) homePage();
            else { view.innerHTML = ""; Bridge.call("browser", "show", { id: t.id }); Bridge.call("browser", "setFrame", { id: t.id, rect: nativeRect() }); }
          } else {
            if (t.url === HOME) homePage();
            else view.innerHTML = `<iframe src="${t.url}" style="width:100%;height:100%;border:0"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups" referrerpolicy="no-referrer"></iframe>`;
          }
        }
        function homePage() {
          view.innerHTML = `<div style="padding:60px 20px;text-align:center;font-family:sans-serif;color:#333">
            <div style="font-size:46px">🌐 MiniOS Browser</div>
            <div style="opacity:.6;margin:6px 0 28px">${native ? "Native engine — full sites supported" : "Type a URL or search"}</div>
            <div style="display:flex;flex-wrap:wrap;gap:14px;justify-content:center;max-width:560px;margin:0 auto">
              ${QUICK.map(q => `<div class="ql" data-u="${q.url}" style="width:96px;cursor:pointer">
                <div style="font-size:34px">${q.glyph}</div><div style="font-size:12px">${q.name}</div></div>`).join("")}
            </div></div>`;
          view.querySelectorAll(".ql").forEach(q => q.onclick = () => navigate(q.dataset.u));
        }

        // keep native overlay aligned to the window (move/resize/minimize)
        let syncing = true, lastRect = "";
        function syncLoop() {
          if (!syncing) return;
          if (native) {
            const t = cur();
            const w = WM.get(win.id);
            if (w && w.el.style.display === "none") { Bridge.call("browser", "hide", { id: t.id }); }
            else if (t && t.url !== HOME) {
              const r = nativeRect(), key = JSON.stringify(r);
              if (key !== lastRect) { lastRect = key; Bridge.call("browser", "setFrame", { id: t.id, rect: r }); }
            }
          }
          requestAnimationFrame(syncLoop);
        }
        function stopSync() { syncing = false; if (native) Bridge.call("browser", "hideAll", {}); }

        // live state from native engine
        Bridge.onEvent && Bridge.onEvent("browser:state", (s) => {
          const t = tabs.find(x => x.id === s.id); if (!t) return;
          t.title = s.title || t.title; t.url = s.url || t.url; t.loading = s.loading;
          t.canBack = s.canBack; t.canFwd = s.canFwd;
          if (t === cur()) { spin.textContent = s.loading ? "⟳" : ""; if (s.url) omni.value = s.url; renderTabs(); }
        });

        $("#back").onclick = () => native ? Bridge.call("browser", "back", { id: cur().id }) : history.back();
        $("#fwd").onclick = () => native ? Bridge.call("browser", "forward", { id: cur().id }) : history.forward();
        $("#reload").onclick = () => native ? Bridge.call("browser", "reload", { id: cur().id }) : paint();
        $("#home").onclick = () => navigate(HOME);
        $("#go").onclick = () => navigate(omni.value);
        omni.addEventListener("keydown", (e) => { if (e.key === "Enter") navigate(omni.value); });

        // hide native overlay when the browser loses focus (it always draws on top)
        Kernel.on("wm:focus", (id) => { if (native && id !== win.id) tabs.forEach(x => Bridge.call("browser", "hide", { id: x.id })); else if (native && id === win.id) paint(); });

        newTab(args && args.url ? args.url : HOME);
        requestAnimationFrame(syncLoop);
      },
    });
  }

  Apps.register({ id: "browser", name: "Browser", icon: "🌐", desktop: true, launch });
})();
