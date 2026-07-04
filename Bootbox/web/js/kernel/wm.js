/* ============================================================================
 * Window Manager — creates/draws/moves/resizes windows, drives the taskbar.
 * Touch + pointer friendly (works with finger, mouse, and Apple Pencil).
 * ========================================================================== */
(function () {
  let z = 100;
  const wins = new Map(); // id -> {el, proc, min, max, prevRect, desktop}
  let idSeq = 1;
  let desktops = 1, current = 0;

  function px(n) { return n + "px"; }

  const WM = {
    open(opts) {
      // opts: { appId, title, icon, width, height, render(bodyEl, win) }
      const id = "w" + (idSeq++);
      const fb = document.getElementById("windows");

      const el = document.createElement("div");
      el.className = "window";
      const W = opts.width || 520, H = opts.height || 360;
      const offset = (wins.size % 6) * 28;
      el.style.left = px(80 + offset);
      el.style.top  = px(60 + offset);
      el.style.width = px(W);
      el.style.height = px(H);
      el.style.zIndex = ++z;

      el.innerHTML = `
        <div class="titlebar">
          <span class="ico">${opts.icon || "🗔"}</span>
          <span class="title">${opts.title || "App"}</span>
          <div class="winbtns">
            <button class="winbtn min" title="Minimize">&#8211;</button>
            <button class="winbtn max" title="Maximize">&#9633;</button>
            <button class="winbtn close" title="Close">&#10005;</button>
          </div>
        </div>
        <div class="window-body"></div>
        <div class="resize-handle"></div>`;
      fb.appendChild(el);

      const body = el.querySelector(".window-body");
      const proc = Kernel.spawn(opts.appId, opts.title, id);
      const win = { id, el, proc, body, opts, min: false, max: false, prevRect: null, desktop: current };
      wins.set(id, win);

      // focus on touch
      el.addEventListener("pointerdown", () => WM.focus(id), true);

      // drag
      const tb = el.querySelector(".titlebar");
      makeDraggable(tb, el, win);
      // resize
      makeResizable(el.querySelector(".resize-handle"), el, win);

      el.querySelector(".min").onclick = (e) => { e.stopPropagation(); WM.minimize(id); };
      const maxBtn = el.querySelector(".max");
      maxBtn.onclick = (e) => { e.stopPropagation(); WM.hideSnapLayouts(); WM.toggleMax(id); };
      let hoverT;
      maxBtn.addEventListener("mouseenter", () => { hoverT = setTimeout(() => WM.showSnapLayouts(id, maxBtn), 450); });
      maxBtn.addEventListener("mouseleave", () => clearTimeout(hoverT));
      el.querySelector(".close").onclick = (e) => { e.stopPropagation(); WM.close(id); };
      tb.addEventListener("dblclick", () => WM.toggleMax(id));

      try { opts.render(body, win); } catch (e) { body.innerHTML = "<div class=app>App error: " + e.message + "</div>"; }

      WM.focus(id);
      Kernel.emit("wm:change");
      return win;
    },

    focus(id) {
      const w = wins.get(id); if (!w) return;
      if (w.desktop !== current) this.switchDesktop(w.desktop);
      if (w.min) { w.min = false; w.el.classList.remove("minimizing"); w.el.style.display = "flex"; w.el.style.animation = "winOpen .15s cubic-bezier(.2,.7,.3,1)"; }
      w.el.style.zIndex = ++z;
      wins.forEach(x => x.el.classList.toggle("focused", x.id === id));
      Kernel.emit("wm:focus", id);
      Kernel.emit("wm:change");
    },
    minimize(id) {
      const w = wins.get(id); if (!w) return;
      w.min = true;
      w.el.classList.add("minimizing");
      setTimeout(() => { if (w.min) { w.el.style.display = "none"; w.el.classList.remove("minimizing"); } }, 180);
      Kernel.emit("wm:change");
    },
    minimizeOthers(id) {
      wins.forEach(w => { if (w.id !== id && w.desktop === current && !w.min) this.minimize(w.id); });
      Kernel.notify("Aero Shake", "Minimized other windows");
    },
    minimizeAll() { wins.forEach(w => { if (w.desktop === current && !w.min) this.minimize(w.id); }); },
    peek(on) {
      wins.forEach(w => {
        if (w.desktop !== current || w.min) return;
        w.el.style.transition = "opacity .15s";
        w.el.style.opacity = on ? "0.12" : "1";
        w.el.style.pointerEvents = on ? "none" : "auto";
      });
    },
    toggleMax(id) {
      const w = wins.get(id); if (!w) return;
      if (!w.max) {
        w.prevRect = { left: w.el.style.left, top: w.el.style.top, width: w.el.style.width, height: w.el.style.height };
        const fb = document.getElementById("windows").getBoundingClientRect();
        Object.assign(w.el.style, { left: "0px", top: "0px", width: px(fb.width), height: px(fb.height) });
        w.el.classList.add("maximized"); w.max = true;
      } else {
        Object.assign(w.el.style, w.prevRect);
        w.el.classList.remove("maximized"); w.max = false;
      }
    },
    close(id) {
      const w = wins.get(id); if (!w) return;
      Kernel.kill(w.proc.pid);
      wins.delete(id);
      w.el.classList.add("closing");
      setTimeout(() => w.el.remove(), 140);
      Kernel.emit("wm:change");
    },
    list() { return [...wins.values()]; },
    get(id) { return wins.get(id); },
    focused() {
      let top = null, z = -1;
      wins.forEach(w => { if (w.el.style.display !== "none" && +w.el.style.zIndex > z) { z = +w.el.style.zIndex; top = w; } });
      return top;
    },
    snap(id, where) {
      const w = wins.get(id); if (!w) return;
      const fb = document.getElementById("windows").getBoundingClientRect();
      w.el.classList.remove("maximized"); w.max = false;
      const set = (l, t, ww, hh) => Object.assign(w.el.style, { left: px(l), top: px(t), width: px(ww), height: px(hh) });
      const W = fb.width, H = fb.height;
      if (where === "left") set(0, 0, W / 2, H);
      else if (where === "right") set(W / 2, 0, W / 2, H);
      else if (where === "top") this.toggleMax(id);
      else if (where === "tl") set(0, 0, W / 2, H / 2);
      else if (where === "tr") set(W / 2, 0, W / 2, H / 2);
      else if (where === "bl") set(0, H / 2, W / 2, H / 2);
      else if (where === "br") set(W / 2, H / 2, W / 2, H / 2);
      else if (where === "l3") set(0, 0, W / 3, H);
      else if (where === "m3") set(W / 3, 0, W / 3, H);
      else if (where === "r3") set(2 * W / 3, 0, W / 3, H);
      else if (where === "l23") set(0, 0, 2 * W / 3, H);
      else if (where === "r23") set(W / 3, 0, 2 * W / 3, H);
      else if (where === "full") set(0, 0, W, H);
      Kernel.emit("wm:change");
    },

    // Snap Layouts flyout (Win11-style) anchored under the maximize button.
    showSnapLayouts(id, anchor) {
      this.hideSnapLayouts();
      const w = wins.get(id); if (!w) return;
      const pop = document.createElement("div");
      pop.id = "snap-layouts";
      const r = anchor.getBoundingClientRect();
      pop.style.cssText = "position:fixed;z-index:99999;background:rgba(40,40,48,.98);border-radius:10px;padding:10px;" +
        "box-shadow:0 12px 40px rgba(0,0,0,.5);display:flex;gap:10px;top:" + (r.bottom + 4) + "px;left:" + Math.max(8, r.right - 220) + "px";
      // each template is a mini grid of clickable zones
      const tmpl = (cells) => {
        const box = document.createElement("div");
        box.style.cssText = "display:grid;gap:3px;width:96px;height:64px;" +
          "grid-template-columns:" + cells.cols + ";grid-template-rows:" + cells.rows;
        cells.zones.forEach(z => {
          const c = document.createElement("div");
          c.style.cssText = "background:rgba(255,255,255,.18);border-radius:3px;cursor:pointer;" +
            "grid-column:" + z.gc + ";grid-row:" + z.gr;
          c.onmouseenter = () => c.style.background = "var(--accent)";
          c.onmouseleave = () => c.style.background = "rgba(255,255,255,.18)";
          c.onclick = () => { WM.snap(id, z.k); WM.hideSnapLayouts(); };
          box.appendChild(c);
        });
        return box;
      };
      pop.appendChild(tmpl({ cols: "1fr 1fr", rows: "1fr", zones: [
        { gc: "1", gr: "1", k: "left" }, { gc: "2", gr: "1", k: "right" }] }));
      pop.appendChild(tmpl({ cols: "1fr 1fr 1fr", rows: "1fr", zones: [
        { gc: "1", gr: "1", k: "l3" }, { gc: "2", gr: "1", k: "m3" }, { gc: "3", gr: "1", k: "r3" }] }));
      pop.appendChild(tmpl({ cols: "1fr 1fr", rows: "1fr 1fr", zones: [
        { gc: "1", gr: "1", k: "tl" }, { gc: "2", gr: "1", k: "tr" },
        { gc: "1", gr: "2", k: "bl" }, { gc: "2", gr: "2", k: "br" }] }));
      document.body.appendChild(pop);
      pop.onmouseleave = () => WM.hideSnapLayouts();
    },
    hideSnapLayouts() { const p = document.getElementById("snap-layouts"); if (p) p.remove(); },

    // ---- virtual desktops ----
    desktopCount() { return desktops; },
    currentDesktop() { return current; },
    addDesktop() { desktops++; Kernel.emit("desktops:change"); return desktops - 1; },
    removeDesktop(n) {
      if (desktops <= 1) return;
      // move windows from n to desktop 0 (or n-1), then renumber
      wins.forEach(w => { if (w.desktop === n) w.desktop = Math.max(0, n - 1); else if (w.desktop > n) w.desktop--; });
      desktops--;
      if (current >= desktops) current = desktops - 1;
      this.switchDesktop(current);
      Kernel.emit("desktops:change");
    },
    switchDesktop(n) {
      if (n < 0 || n >= desktops) return;
      current = n;
      wins.forEach(w => { w.el.style.display = (w.desktop === n && !w.min) ? "flex" : "none"; });
      Kernel.emit("wm:change"); Kernel.emit("desktops:change");
    },
    moveToDesktop(id, n) {
      const w = wins.get(id); if (!w || n < 0 || n >= desktops) return;
      w.desktop = n;
      if (n !== current) w.el.style.display = "none";
      Kernel.emit("wm:change"); Kernel.emit("desktops:change");
    },
    winDesktop(id) { const w = wins.get(id); return w ? w.desktop : 0; },
  };

  // Win/Alt+Ctrl+Left/Right switch desktops; Win/Alt+Ctrl+D adds one.
  window.addEventListener("keydown", (e) => {
    if (!((e.metaKey || e.altKey) && e.ctrlKey)) return;
    if (e.key === "ArrowRight") { e.preventDefault(); WM.switchDesktop((current + 1) % desktops); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); WM.switchDesktop((current - 1 + desktops) % desktops); }
    else if (e.key === "d" || e.key === "D") { e.preventDefault(); WM.switchDesktop(WM.addDesktop()); }
  });

  // Win+Arrow snapping (also Alt+Arrow for keyboards without a Win key).
  window.addEventListener("keydown", (e) => {
    if (!(e.metaKey || e.altKey)) return;
    const f = WM.focused(); if (!f) return;
    const map = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "min" };
    const where = map[e.key]; if (!where) return;
    e.preventDefault();
    if (where === "min") WM.minimize(f.id); else WM.snap(f.id, where);
  });

  function makeDraggable(handle, el, win) {
    let sx, sy, ox, oy, active = false;
    let shakeDir = 0, shakeCount = 0, lastX = 0, shaken = false, shakeT = 0;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".winbtn")) return;
      if (win.max) return;
      active = true; handle.setPointerCapture(e.pointerId);
      sx = e.clientX; sy = e.clientY;
      ox = parseInt(el.style.left); oy = parseInt(el.style.top);
      shakeDir = 0; shakeCount = 0; lastX = e.clientX; shaken = false; shakeT = Date.now();
    });
    handle.addEventListener("pointermove", (e) => {
      if (!active) return;
      el.style.left = px(ox + (e.clientX - sx));
      el.style.top  = px(Math.max(0, oy + (e.clientY - sy)));
      // Aero Shake: count rapid horizontal direction reversals
      const dx = e.clientX - lastX;
      if (Math.abs(dx) > 8) {
        const dir = dx > 0 ? 1 : -1;
        if (dir !== shakeDir) { shakeDir = dir; shakeCount++; }
        lastX = e.clientX;
        if (!shaken && shakeCount >= 6 && Date.now() - shakeT < 1500) { shaken = true; WM.minimizeOthers(win.id); }
      }
    });
    handle.addEventListener("pointerup", (e) => {
      if (active) {
        const fb = document.getElementById("windows").getBoundingClientRect();
        const x = e.clientX - fb.left, y = e.clientY - fb.top, edge = 24;
        if (y <= edge && x <= fb.width * 0.15) WM.snap(win.id, "tl");
        else if (y <= edge && x >= fb.width * 0.85) WM.snap(win.id, "tr");
        else if (y <= edge) WM.snap(win.id, "top");
        else if (x <= edge && y >= fb.height * 0.85) WM.snap(win.id, "bl");
        else if (x >= fb.width - edge && y >= fb.height * 0.85) WM.snap(win.id, "br");
        else if (x <= edge) WM.snap(win.id, "left");
        else if (x >= fb.width - edge) WM.snap(win.id, "right");
      }
      active = false; try { handle.releasePointerCapture(e.pointerId); } catch (x) {}
    });
  }

  function makeResizable(handle, el, win) {
    let sx, sy, ow, oh, active = false;
    handle.addEventListener("pointerdown", (e) => {
      active = true; e.stopPropagation(); handle.setPointerCapture(e.pointerId);
      sx = e.clientX; sy = e.clientY; ow = el.offsetWidth; oh = el.offsetHeight;
    });
    handle.addEventListener("pointermove", (e) => {
      if (!active) return;
      el.style.width  = px(Math.max(280, ow + (e.clientX - sx)));
      el.style.height = px(Math.max(160, oh + (e.clientY - sy)));
    });
    handle.addEventListener("pointerup", (e) => { active = false; try { handle.releasePointerCapture(e.pointerId); } catch (x) {} });
  }

  window.WM = WM;
})();
