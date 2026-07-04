/* ============================================================================
 * MiniOS Windows runtime — REAL .exe execution via BoxedWine (Wine + x86 CPU +
 * a tiny Linux kernel, all compiled to WebAssembly). No Linux ISO needed; this
 * is a self-contained 32-bit Win32 environment that runs real Windows programs.
 *
 * Runs in an isolated iframe pointing at the bundled BoxedWine page (served with
 * COOP/COEP by the host so SharedArrayBuffer / threads work). Supports DirectDraw
 * (2D) apps/games; OpenGL/Direct3D are not available in the wasm build.
 * ========================================================================== */
(function () {
  // --- tiny CRC32 + STORE-method ZIP builder (no deps) so we can hand a single
  //     .exe to BoxedWine inline (its app-payload param = base64 of a zip). ---
  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(name, data) {
    const enc = new TextEncoder().encode(name), crc = crc32(data), n = data.length;
    const le16 = v => [v & 255, (v >> 8) & 255], le32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
    const lh = [].concat([0x50, 0x4b, 3, 4], le16(20), le16(0), le16(0), le16(0), le16(0), le32(crc), le32(n), le32(n), le16(enc.length), le16(0));
    const local = new Uint8Array(lh.length + enc.length + n); local.set(lh, 0); local.set(enc, lh.length); local.set(data, lh.length + enc.length);
    const off = 0;
    const ch = [].concat([0x50, 0x4b, 1, 2], le16(20), le16(20), le16(0), le16(0), le16(0), le16(0), le32(crc), le32(n), le32(n), le16(enc.length), le16(0), le16(0), le16(0), le16(0), le32(0), le32(off));
    const central = new Uint8Array(ch.length + enc.length); central.set(ch, 0); central.set(enc, ch.length);
    const eo = [].concat([0x50, 0x4b, 5, 6], le16(0), le16(0), le16(1), le16(1), le32(central.length), le32(local.length), le16(0));
    const end = new Uint8Array(eo);
    const out = new Uint8Array(local.length + central.length + end.length); out.set(local, 0); out.set(central, local.length); out.set(end, local.length + central.length);
    return out;
  }
  function toB64(u8) { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return btoa(s); }

  function run(opts) {
    opts = opts || {};
    const src = "vendor/boxedwine/boxedwine.html";
    let runningExe = "";
    // Auto-run a specific .exe: zip it and hand it to BoxedWine via localStorage
    // (shared with the same-origin iframe — no URL-length limit).
    if (opts.exeBytes && opts.exeName) {
      try {
        const bytes = opts.exeBytes instanceof Uint8Array ? opts.exeBytes : new Uint8Array(opts.exeBytes);
        const zip = zipStore(opts.exeName, bytes);
        localStorage.setItem("minios_wine_payload", toB64(zip));
        localStorage.setItem("minios_wine_prog", opts.exeName);
        runningExe = opts.exeName;
      } catch (e) { try { localStorage.removeItem("minios_wine_payload"); } catch (e2) {} }
    }
    WM.open({
      appId: "wine", title: "Windows (Wine)" + (runningExe ? " — " + runningExe : " — run .exe"),
      icon: "🍷", width: 880, height: 680,
      render(body, win) {
        body.style.padding = "0";
        body.innerHTML = `<div style="display:flex;flex-direction:column;height:100%;background:#0b0f1a">
          <div style="height:30px;display:flex;align-items:center;gap:8px;padding:0 10px;color:#cbd5e1;
            font:600 12px 'Segoe UI',sans-serif;background:#11161f;border-bottom:1px solid #1e293b">
            🍷 Wine (BoxedWine) — real Win32.
            ${runningExe ? "Running <b>" + runningExe + "</b>." : "Use <b>Add File(s)</b> to load an .exe."}
            <span style="margin-left:auto;opacity:.6" id="wine-st">starting…</span>
          </div>
          <iframe id="wine-frame" allow="cross-origin-isolated; autoplay; fullscreen"
            style="border:0;flex:1;width:100%;background:#fff"></iframe>
        </div>`;
        const frame = body.querySelector("#wine-frame");
        const stEl = body.querySelector("#wine-st");
        frame.addEventListener("load", () => { stEl.textContent = runningExe ? "Running " + runningExe : "Wine running"; });
        frame.src = src; // set after listener so big data URLs still fire load
      },
    });
  }

  window.WineRuntime = { run };
})();
