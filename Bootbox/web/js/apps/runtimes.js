/* Runtimes — launches the built-in Android-runtime and Win32-subset samples. */
(function () {
  function launch() {
    WM.open({
      appId: "runtimes", title: "Runtimes", icon: "🧰", width: 460, height: 420,
      render(body) {
        body.innerHTML = `<div class="app">
          <h2>🧰 Runtimes</h2>
          <h3>🤖 Android runtime (Phases 8–9)</h3>
          <p style="opacity:.7;font-size:12px">Activity lifecycle · widget toolkit · Intents · Binder services.</p>
          <div class="list-row" data-a="counter"><span style="flex:1">Counter sample</span><button class="btn">Run</button></div>
          <div class="list-row" data-a="notes"><span style="flex:1">A-Note sample</span><button class="btn">Run</button></div>
          <h3>🪟 Win32 subset (Phase 10)</h3>
          <p style="opacity:.7;font-size:12px">Console host · Win32-ish API · fake registry.</p>
          <div class="list-row" data-w="hello"><span style="flex:1">hello.exe</span><button class="btn">Run</button></div>
          <div class="list-row" data-w="reg"><span style="flex:1">reg.exe (registry editor)</span><button class="btn">Run</button></div>
          <div class="list-row" data-w="msgbox"><span style="flex:1">dialog.exe (MessageBox)</span><button class="btn">Run</button></div>
        </div>`;
        body.querySelectorAll("[data-a]").forEach(r => r.querySelector("button").onclick = () => Android.run(Android.SAMPLES[r.dataset.a]));
        body.querySelectorAll("[data-w]").forEach(r => r.querySelector("button").onclick = () => Win32.run(Win32.SAMPLES[r.dataset.w]));
      },
    });
  }
  Apps.register({ id: "runtimes", name: "Runtimes", icon: "🧰", desktop: true, launch });
})();
