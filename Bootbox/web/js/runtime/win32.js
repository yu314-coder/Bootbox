/* ============================================================================
 * MiniOS Win32 Runtime (Phase 10) — a tiny Win32-like *subset*, not an x86
 * emulator. It provides a console host, a small Win32-ish API (stdout,
 * MessageBox, GetComputerName), and a fake registry persisted in the VFS.
 * It runs simple "console program" specs. Real PE/x86 execution is out of
 * scope on iPad (no JIT / native code), so this is a compatibility subset only.
 * ========================================================================== */
(function () {
  const REG_PATH = "/Apps/.registry.json";
  function loadReg() { try { return JSON.parse(VFS.read(REG_PATH) || "{}"); } catch (e) { return {}; } }
  function saveReg(r) { VFS.write(REG_PATH, JSON.stringify(r)); }

  const Registry = {
    get(key) { return loadReg()[key]; },
    set(key, val) { const r = loadReg(); r[key] = val; saveReg(r); },
    all() { return loadReg(); },
  };
  // seed a couple HKLM-style values
  (function seed() {
    const r = loadReg();
    if (!r["HKLM\\Software\\MiniOS\\Version"]) {
      r["HKLM\\Software\\MiniOS\\Version"] = "0.3.0";
      r["HKLM\\Software\\Microsoft\\Windows NT\\CurrentVersion\\ProductName"] = "MiniOS Win32 Subsystem";
      saveReg(r);
    }
  })();

  function run(spec) {
    WM.open({
      appId: "win32:" + (spec.name || "prog"), title: (spec.name || "program.exe") + " — Win32 Console",
      icon: "🪟", width: 620, height: 400,
      render(body, win) {
        body.innerHTML = `<div class="term"><div class="out"></div>
          <div class="term-input"><span>&gt;</span><input autocomplete="off" spellcheck="false"/></div></div>`;
        const out = body.querySelector(".out"), input = body.querySelector("input");
        const write = (s = "") => { const d = document.createElement("div"); d.textContent = s; out.appendChild(d);
          body.querySelector(".term").scrollTop = 1e9; };

        const api = {
          stdout: write,
          messageBox: (title, text) => { Kernel.notify("MessageBox: " + title, text); write("[MessageBox] " + title + ": " + text); },
          getComputerName: () => Kernel.nvram.deviceName,
          reg: Registry,
          exit: (code) => { write("\nProcess exited with code " + (code || 0)); input.disabled = true; },
          onInput: null,
        };

        write("MiniOS Win32 Subsystem [Version 0.3.0]");
        write("(c) MiniOS. PE loaded in compatibility mode.\n");
        try { (spec.main || function(){})(api, spec.args || []); }
        catch (e) { write("Unhandled exception: " + e.message); }

        input.addEventListener("keydown", (e) => {
          if (e.key !== "Enter") return;
          const line = input.value; input.value = "";
          write("> " + line);
          if (api.onInput) try { api.onInput(line, api); } catch (err) { write("err: " + err.message); }
        });
        setTimeout(() => input.focus(), 50);
        body.querySelector(".term").onclick = () => input.focus();
      },
    });
  }

  const SAMPLES = {
    hello: { name: "hello.exe", main: (api) => {
      api.stdout("Hello, Windows world (Win32 subset)!");
      api.stdout("Running on: " + api.getComputerName());
      api.exit(0);
    }},
    reg: { name: "reg.exe", main: (api) => {
      api.stdout("Fake registry contents:");
      Object.entries(api.reg.all()).forEach(([k, v]) => api.stdout("  " + k + " = " + v));
      api.stdout("\nType: set <key> <value>  |  get <key>");
      api.onInput = (line, a) => {
        const [cmd, key, ...rest] = line.split(/\s+/);
        if (cmd === "set") { a.reg.set(key, rest.join(" ")); a.stdout("OK"); }
        else if (cmd === "get") { a.stdout(String(a.reg.get(key))); }
        else a.stdout("commands: set/get");
      };
    }},
    msgbox: { name: "dialog.exe", main: (api) => {
      api.messageBox("MiniOS", "This is a Win32-style MessageBox.");
      api.stdout("Returned IDOK.");
      api.exit(0);
    }},
  };

  // Build a console session from a parsed PE report (inspection -> stub run).
  function fromPE(report) {
    return { name: report.name, main: (api) => {
      api.stdout("Loaded PE: " + report.name);
      api.stdout("  format:    " + report.format);
      api.stdout("  machine:   " + report.machine);
      api.stdout("  subsystem: " + report.subsystem);
      api.stdout("  sections:  " + (report.sections || []).join(", "));
      api.stdout("");
      api.stdout("⚠️ Native " + report.machine + " execution is not available on iPad.");
      api.stdout("   This is the Win32 compatibility subset (no full PE execution on iPad).");
      api.exit(0);
    }};
  }

  window.Win32 = { run, Registry, SAMPLES, fromPE };
})();
