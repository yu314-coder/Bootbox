/* ML Vision — Core ML / Vision demo: classify a captured image or OCR text. */
(function () {
  function launch() {
    WM.open({
      appId: "vision", title: "ML Vision", icon: "🧠", width: 440, height: 460,
      render(body) {
        body.innerHTML = `<div class="app">
          <h2>🧠 ML Vision <small style="opacity:.5;font-size:12px">Neural Engine via Vision</small></h2>
          <div class="toolbar" style="border:none">
            <button class="btn" id="cap">📷 Capture image</button>
            <button class="btn" id="cls" disabled>🏷️ Classify</button>
            <button class="btn" id="ocr" disabled>🔤 Read text (OCR)</button>
          </div>
          <div id="img" style="height:200px;border:1px dashed rgba(128,128,128,.5);border-radius:8px;
            display:flex;align-items:center;justify-content:center;opacity:.6">No image</div>
          <div id="out" style="margin-top:10px;font-size:13px"></div>
        </div>`;
        let dataURL = null;
        const out = body.querySelector("#out");
        body.querySelector("#cap").onclick = async () => {
          try {
            const r = await Kernel.sys.capturePhoto(); dataURL = r.dataURL;
            body.querySelector("#img").innerHTML = `<img src="${dataURL}" style="max-height:100%;border-radius:6px">`;
            body.querySelector("#cls").disabled = false;
            body.querySelector("#ocr").disabled = false;
          } catch (e) { out.textContent = e.message; }
        };
        body.querySelector("#cls").onclick = async () => {
          out.textContent = "Running classifier…";
          const r = await Kernel.sys.classifyImage(dataURL);
          out.innerHTML = "<b>Top labels:</b><br>" + (r.classifications || [])
            .map(c => `${c.label} — ${(c.confidence * 100).toFixed(1)}%`).join("<br>");
        };
        body.querySelector("#ocr").onclick = async () => {
          out.textContent = "Reading text…";
          const r = await Kernel.sys.ocrImage(dataURL);
          out.innerHTML = "<b>OCR (" + r.lines + " lines):</b><br><pre>" + (r.text || "(none)") + "</pre>";
        };
      },
    });
  }
  Apps.register({ id: "vision", name: "ML Vision", icon: "🧠", desktop: true, launch });
})();
