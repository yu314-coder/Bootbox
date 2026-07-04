/* About — system identity + architecture overview. */
(function () {
  function launch() {
    WM.open({
      appId: "about", title: "About MiniOS", icon: "ℹ️", width: 480, height: 380,
      render(body) {
        body.innerHTML = `<div class="app">
          <h2>ℹ️ MiniOS</h2>
          <p style="opacity:.8">A lightweight Windows-inspired MiniOS for iPad, running inside a
          secure host app, using a controlled iPadOS bridge for hardware access.</p>
          <div class="list-row"><span style="flex:1">Version</span><b>0.1.0</b></div>
          <div class="list-row"><span style="flex:1">Kernel</span><b>JS micro-runtime</b></div>
          <div class="list-row"><span style="flex:1">Renderer</span><b>${Bridge.onDevice ? "WKWebView → Metal" : "Browser"}</b></div>
          <div class="list-row"><span style="flex:1">App format</span><b>.mapp (native first)</b></div>
          <h3>Architecture</h3>
          <pre style="font-size:11px;line-height:1.5;opacity:.8">MiniOS apps
  → MiniOS API (Kernel/syscalls)
  → virtual device bridge
  → host iPad app (Swift)
  → iPadOS API
  → real hardware</pre>
          <p style="opacity:.6;font-size:12px">Native MiniOS apps first · APK import/inspection later · no full PC emulation.</p>
        </div>`;
      },
    });
  }
  Apps.register({ id: "about", name: "About", icon: "ℹ️", desktop: false, launch });
})();
