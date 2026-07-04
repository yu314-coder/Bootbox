/* Camera — captures a photo via the host camera bridge, saves to /Downloads. */
(function () {
  function launch() {
    WM.open({
      appId: "camera", title: "Camera", icon: "📷", width: 420, height: 460,
      render(body) {
        body.innerHTML = `<div class="app" style="text-align:center">
          <h2>📷 Camera</h2>
          <div id="preview" style="height:260px;border:1px dashed rgba(128,128,128,.5);border-radius:8px;
            display:flex;align-items:center;justify-content:center;opacity:.6">No photo yet</div>
          <div class="toolbar" style="justify-content:center;border:none">
            <button class="btn" id="cap">📸 Capture</button>
            <button class="btn" id="save" disabled>💾 Save to Downloads</button>
            <button class="btn" id="ml" disabled>🧠 Classify</button>
          </div>
          <div id="status" style="opacity:.6;font-size:12px"></div>
        </div>`;
        const pv = body.querySelector("#preview");
        let last = null;
        body.querySelector("#cap").onclick = async () => {
          body.querySelector("#status").textContent = "Requesting camera…";
          try {
            const r = await Kernel.sys.capturePhoto();
            last = r;
            pv.innerHTML = `<img src="${r.dataURL}" style="max-width:100%;max-height:100%;border-radius:6px">`;
            body.querySelector("#save").disabled = false;
            body.querySelector("#ml").disabled = false;
            body.querySelector("#status").textContent = `Captured ${r.width}×${r.height}`;
          } catch (e) { body.querySelector("#status").textContent = "Camera: " + e.message; }
        };
        body.querySelector("#save").onclick = () => {
          if (!last) return;
          VFS.write("/Downloads/photo-" + Date.now() + ".txt", last.dataURL, "image/jpeg");
          Kernel.notify("Saved", "Photo stored in Downloads");
        };
        body.querySelector("#ml").onclick = async () => {
          if (!last) return;
          const r = await Kernel.sys.classifyImage(last.dataURL);
          body.querySelector("#status").innerHTML = (r.classifications || [])
            .map(c => `${c.label} ${(c.confidence * 100).toFixed(0)}%`).join("<br>");
        };
      },
    });
  }
  Apps.register({ id: "camera", name: "Camera", icon: "📷", desktop: true, launch });
})();
