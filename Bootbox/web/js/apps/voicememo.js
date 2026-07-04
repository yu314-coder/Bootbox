/* Voice Memo — records via the host microphone bridge and plays back. */
(function () {
  function launch() {
    WM.open({
      appId: "voice", title: "Voice Memo", icon: "🎙️", width: 360, height: 300,
      render(body) {
        body.innerHTML = `<div class="app" style="text-align:center">
          <h2>🎙️ Voice Memo</h2>
          <div id="dot" style="font-size:64px">⚪</div>
          <div class="toolbar" style="justify-content:center;border:none">
            <button class="btn" id="rec">● Record 4s</button>
            <button class="btn" id="play">▶ Play</button>
          </div>
          <div id="status" style="opacity:.6;font-size:12px">Idle</div>
        </div>`;
        const st = body.querySelector("#status"), dot = body.querySelector("#dot");
        body.querySelector("#rec").onclick = async () => {
          try {
            st.textContent = "Recording…"; dot.textContent = "🔴";
            const r = await Kernel.sys.recordAudio(4);
            setTimeout(() => { dot.textContent = "⚪"; st.textContent = "Recorded " + r.seconds + "s"; }, (r.seconds || 4) * 1000);
          } catch (e) { st.textContent = "Mic: " + e.message; dot.textContent = "⚪"; }
        };
        body.querySelector("#play").onclick = async () => {
          try { await Kernel.sys.playAudio(); st.textContent = "Playing…"; }
          catch (e) { st.textContent = e.message; }
        };
      },
    });
  }
  Apps.register({ id: "voice", name: "Voice Memo", icon: "🎙️", desktop: true, launch });
})();
