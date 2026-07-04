/* ============================================================================
 * MiniOS Android Runtime (Phases 8–9) — a *compatibility harness*, not a Dalvik
 * VM. It provides an Activity lifecycle, an Android-style widget toolkit, an
 * Intent system, and a Binder-like service registry, and renders declarative
 * "app specs". Real APKs run their bytecode on a real ART VM, which iPadOS
 * cannot host; so imported APKs run a generated demo activity built from their
 * manifest, while built-in specs exercise the full toolkit.
 * ========================================================================== */
(function () {
  // ---- Binder-like service registry ----
  const services = {};
  const Binder = {
    register(name, impl) { services[name] = impl; },
    get(name) { return services[name]; },
    call(name, method, ...args) {
      const s = services[name];
      if (!s || !s[method]) throw new Error("no service " + name + "." + method);
      return s[method](...args);
    },
  };
  // a sample system service
  Binder.register("toast", { show: (msg) => Kernel.notify("Android", msg) });
  Binder.register("clipboard", { setText: (t) => Kernel.sys.clipboardCopy(t) });

  // ---- Widget toolkit: layout tree -> DOM ----
  function buildView(node, ctx) {
    let el;
    switch (node.type) {
      case "LinearLayout":
        el = document.createElement("div");
        el.style.display = "flex";
        el.style.flexDirection = node.orientation === "horizontal" ? "row" : "column";
        el.style.gap = "8px"; el.style.padding = "12px";
        (node.children || []).forEach(c => el.appendChild(buildView(c, ctx)));
        break;
      case "TextView":
        el = document.createElement("div");
        el.textContent = node.text || "";
        el.style.fontSize = (node.textSize || 16) + "px";
        if (node.bold) el.style.fontWeight = "600";
        if (node.id) ctx.views[node.id] = el;
        break;
      case "Button":
        el = document.createElement("button");
        el.className = "btn"; el.textContent = node.text || "Button";
        el.onclick = () => ctx.activity.handlers[node.onClick] && ctx.activity.handlers[node.onClick](ctx);
        if (node.id) ctx.views[node.id] = el;
        break;
      case "EditText":
        el = document.createElement("input");
        el.className = "field"; el.placeholder = node.hint || "";
        if (node.id) ctx.views[node.id] = el;
        break;
      case "ImageView":
        el = document.createElement("div");
        el.textContent = node.glyph || "🖼️"; el.style.fontSize = "48px"; el.style.textAlign = "center";
        if (node.id) ctx.views[node.id] = el;
        break;
      default:
        el = document.createElement("div"); el.textContent = "[" + node.type + "]";
    }
    return el;
  }

  // ---- Activity / runtime ----
  function run(spec) {
    const pkg = spec.package || "com.minios.demo";
    const label = spec.label || "Android App";
    WM.open({
      appId: "android:" + pkg, title: label + " (Android)", icon: spec.icon || "🤖",
      width: 380, height: 620,
      render(body, win) {
        // Android device chrome
        body.style.background = "#0b0b0b";
        body.innerHTML = `
          <div style="height:100%;display:flex;flex-direction:column;background:#fafafa;color:#111">
            <div style="height:24px;background:#1f1f1f;color:#fff;font-size:11px;display:flex;
              align-items:center;justify-content:space-between;padding:0 10px">
              <span>${pkg}</span><span>📶 🔋 ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div>
            <div style="height:48px;background:#3f51b5;color:#fff;display:flex;align-items:center;
              padding:0 14px;font-size:17px;font-weight:600;box-shadow:0 2px 6px rgba(0,0,0,.3)">${label}</div>
            <div class="and-content" style="flex:1;overflow:auto"></div>
            <div style="height:48px;background:#1f1f1f;color:#bbb;display:flex;align-items:center;
              justify-content:space-around;font-size:20px">
              <span class="nav" data-k="back">◁</span><span class="nav" data-k="home">○</span><span class="nav" data-k="recent">▢</span></div>
          </div>`;
        const content = body.querySelector(".and-content");

        const log = (m) => Kernel.sys.log("[Activity " + pkg + "] " + m);
        const ctx = {
          views: {},
          activity: spec,
          toast: (m) => Binder.call("toast", "show", m),
          startActivity: (intent) => Kernel.notify("Intent", "startActivity → " + (intent.action || intent.target || "?")),
          binder: Binder,
          files: { read: (p) => VFS.read(p), write: (p, c) => VFS.write(p, c) },
        };
        spec.handlers = spec.handlers || {};

        // ---- lifecycle ----
        log("onCreate"); (spec.onCreate || function(){})(ctx);
        content.appendChild(buildView(spec.layout || { type: "TextView", text: "Empty Activity" }, ctx));
        log("onStart"); log("onResume");
        (spec.onResume || function(){})(ctx);

        body.querySelectorAll(".nav").forEach(n => n.onclick = () => {
          if (n.dataset.k === "back") { log("onPause/onStop/onDestroy (back)"); WM.close(win.id); }
          else Kernel.notify("Android", n.dataset.k + " (simulated)");
        });
      },
    });
  }

  // ---- built-in sample specs (exercise the toolkit fully) ----
  const SAMPLES = {
    counter: {
      package: "com.minios.counter", label: "Counter", icon: "🔢",
      layout: { type: "LinearLayout", children: [
        { type: "TextView", id: "title", text: "Tap to count", bold: true, textSize: 20 },
        { type: "TextView", id: "count", text: "0", textSize: 48 },
        { type: "Button", text: "Increment", onClick: "inc" },
        { type: "Button", text: "Toast", onClick: "toast" },
      ]},
      onCreate(ctx) { ctx._n = 0; },
      handlers: {
        inc(ctx) { ctx._n++; ctx.views.count.textContent = ctx._n; },
        toast(ctx) { ctx.toast("Count is " + ctx._n); },
      },
    },
    notes: {
      package: "com.minios.anote", label: "A-Note", icon: "📝",
      layout: { type: "LinearLayout", children: [
        { type: "TextView", text: "Quick note (saved to /Documents)", bold: true },
        { type: "EditText", id: "txt", hint: "Type here…" },
        { type: "Button", text: "Save", onClick: "save" },
        { type: "TextView", id: "status", text: "" },
      ]},
      onResume(ctx) { ctx.views.txt.value = ctx.files.read("/Documents/anote.txt") || ""; },
      handlers: {
        save(ctx) { ctx.files.write("/Documents/anote.txt", ctx.views.txt.value); ctx.views.status.textContent = "Saved ✓"; },
      },
    },
  };

  // Generate a demo activity from a parsed APK manifest report.
  function fromManifest(report) {
    return {
      package: report.package || report.name, label: report.label || report.package || "App", icon: "🤖",
      layout: { type: "LinearLayout", children: [
        { type: "TextView", text: (report.label || report.package || "App"), bold: true, textSize: 20 },
        { type: "TextView", text: "v" + (report.versionName || "?") + " · SDK " + (report.minSdk || "?") + "–" + (report.targetSdk || "?") },
        { type: "ImageView", glyph: "🤖" },
        { type: "TextView", text: "Activities: " + ((report.activities || []).join(", ") || "—"), textSize: 12 },
        { type: "TextView", text: "Permissions: " + ((report.permissions || []).length) + " declared", textSize: 12 },
        { type: "Button", text: "Simulate launch", onClick: "go" },
      ]},
      handlers: { go: (ctx) => ctx.toast("Launched " + (report.activities && report.activities[0] || "MainActivity")) },
    };
  }

  window.Android = { run, Binder, SAMPLES, fromManifest };
})();
