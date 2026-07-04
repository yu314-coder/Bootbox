/* Snipping Tool — capture the MiniOS screen (host snapshot), crop a region,
   save to /Pictures and copy to clipboard. */
(function () {
  function launch() {
    WM.open({
      appId: "snip", title: "Snipping Tool", icon: "✂️", width: 560, height: 460,
      render(body) {
        body.innerHTML = `<div class="app" style="height:100%;display:flex;flex-direction:column">
          <div class="toolbar" style="border:none">
            <button class="btn" id="cap">✂️ New snip</button>
            <button class="btn" id="save" disabled>💾 Save</button>
            <button class="btn" id="copy" disabled>📋 Copy</button>
            <span id="hint" style="opacity:.6;font-size:12px">Capture, then drag to crop.</span>
          </div>
          <div id="stage" style="flex:1;position:relative;overflow:hidden;background:#111;border-radius:8px">
            <div id="ph" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.5">No capture yet</div>
          </div></div>`;
        const stage = body.querySelector("#stage"), hint = body.querySelector("#hint");
        let fullURL = null, crop = null, imgEl = null;

        body.querySelector("#cap").onclick = async () => {
          hint.textContent = "Capturing…";
          try {
            const r = await Kernel.sys.screenshot();
            fullURL = r.dataURL;
            stage.innerHTML = `<img id="snapimg" src="${fullURL}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain">
              <div id="sel" style="position:absolute;border:2px dashed #0a84ff;background:rgba(10,132,255,.15);display:none"></div>`;
            imgEl = stage.querySelector("#snapimg");
            hint.textContent = "Drag to select a region (or Save full).";
            body.querySelector("#save").disabled = false;
            body.querySelector("#copy").disabled = false;
            wireSelect();
          } catch (e) { hint.textContent = "Capture failed: " + e.message; }
        };

        function wireSelect() {
          const sel = stage.querySelector("#sel");
          let sx, sy, active = false;
          stage.onpointerdown = (e) => {
            const r = stage.getBoundingClientRect();
            sx = e.clientX - r.left; sy = e.clientY - r.top; active = true;
            sel.style.display = "block"; sel.style.left = sx + "px"; sel.style.top = sy + "px"; sel.style.width = sel.style.height = "0px";
          };
          stage.onpointermove = (e) => {
            if (!active) return;
            const r = stage.getBoundingClientRect();
            const x = e.clientX - r.left, y = e.clientY - r.top;
            sel.style.left = Math.min(sx, x) + "px"; sel.style.top = Math.min(sy, y) + "px";
            sel.style.width = Math.abs(x - sx) + "px"; sel.style.height = Math.abs(y - sy) + "px";
          };
          stage.onpointerup = () => { active = false; crop = sel.getBoundingClientRect(); if (crop.width < 5) crop = null; };
        }

        async function produce() {
          // crop fullURL to the selected region (mapped to image natural pixels)
          return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              const r = stage.getBoundingClientRect();
              // contain mapping
              const scale = Math.min(r.width / img.width, r.height / img.height);
              const dw = img.width * scale, dh = img.height * scale;
              const ox = (r.width - dw) / 2, oy = (r.height - dh) / 2;
              let canvas = document.createElement("canvas");
              if (crop) {
                const sxp = Math.max(0, (crop.left - r.left - ox) / scale);
                const syp = Math.max(0, (crop.top - r.top - oy) / scale);
                const sw = crop.width / scale, sh = crop.height / scale;
                canvas.width = sw; canvas.height = sh;
                canvas.getContext("2d").drawImage(img, sxp, syp, sw, sh, 0, 0, sw, sh);
              } else { canvas.width = img.width; canvas.height = img.height; canvas.getContext("2d").drawImage(img, 0, 0); }
              resolve(canvas.toDataURL("image/png"));
            };
            img.src = fullURL;
          });
        }
        body.querySelector("#save").onclick = async () => {
          const data = await produce();
          VFS.write("/Pictures/snip-" + Date.now() + ".txt", data, "image/png");
          Kernel.notify("Snipping Tool", "Saved to Pictures");
        };
        body.querySelector("#copy").onclick = async () => {
          const data = await produce(); await Kernel.sys.clipboardCopy(data);
          Kernel.notify("Snipping Tool", "Copied image data to clipboard");
        };
      },
    });
  }
  Apps.register({ id: "snip", name: "Snipping Tool", icon: "✂️", desktop: true, launch });
})();
