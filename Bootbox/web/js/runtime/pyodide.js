/* ============================================================================
 * Python runtime — REAL CPython 3 via Pyodide (WebAssembly). Gives the Terminal
 * a working `python`, `pip` (micropip), and stdout/stderr capture. Loaded lazily
 * from the CDN on first use (needs network, like the Browser). Packages install
 * for real into the in-memory environment.
 * ========================================================================== */
(function () {
  const VER = "0.26.2";
  const BASE = "https://cdn.jsdelivr.net/pyodide/v" + VER + "/full/";
  let py = null, loading = null, micropip = null;

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = () => rej(new Error("failed to load " + src));
      document.head.appendChild(s);
    });
  }

  async function ensure(log) {
    if (py) return py;
    if (loading) return loading;
    loading = (async () => {
      log && log("Downloading Python runtime (first use, ~10 MB)…");
      if (!window.loadPyodide) await loadScript(BASE + "pyodide.js");
      log && log("Initializing CPython…");
      py = await loadPyodide({ indexURL: BASE });
      return py;
    })();
    return loading;
  }

  const Py = {
    loaded: () => !!py,
    async run(code, onOut, onErr) {
      const p = await ensure(onOut);
      p.setStdout({ batched: (s) => onOut(s) });
      p.setStderr({ batched: (s) => (onErr || onOut)(s) });
      try { const r = await p.runPythonAsync(code); if (r !== undefined && r !== null) onOut(String(r)); }
      catch (e) { (onErr || onOut)(String(e.message || e)); }
    },
    async pip(pkg, onOut) {
      const p = await ensure(onOut);
      if (!micropip) { await p.loadPackage("micropip"); micropip = p.pyimport("micropip"); }
      onOut("Collecting " + pkg + "…");
      try { await micropip.install(pkg); onOut("Successfully installed " + pkg); }
      catch (e) {
        // fall back to Pyodide's prebuilt package set (numpy, pandas, etc.)
        try { await p.loadPackage(pkg); onOut("Successfully installed " + pkg + " (pyodide build)"); }
        catch (e2) { onOut("ERROR: could not install " + pkg + " — " + (e.message || e)); }
      }
    },
  };
  window.Py = Py;
})();
