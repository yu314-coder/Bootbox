/* ============================================================================
 * Command Prompt — a cmd.exe-style shell over the MiniOS VFS. Drive C:\ maps to
 * the virtual filesystem root. Works fully offline.
 *   help  dir  cd  cls  type  echo  copy  move  del  md  rd  ren  tree
 *   ver  vol  date  time  whoami  hostname  set  title  start  cls  exit
 *   clip  ipconfig  ping(offline)  ps  sysinfo
 * ========================================================================== */
(function () {
  function launch() {
    let cwd = "/";                         // VFS path
    const env = { PATH: "C:\\;C:\\Apps", USERNAME: "user", OS: "MiniOS" };
    let history = [], hi = -1;

    WM.open({
      appId: "cmd", title: "Command Prompt", icon: "⬛", width: 680, height: 420,
      render(body, win) {
        body.innerHTML = `<div class="term"><div class="out"></div>
          <div class="term-input"><span id="ps"></span><input autocomplete="off" autocapitalize="off" spellcheck="false"/></div></div>`;
        const term = body.querySelector(".term");
        const out = body.querySelector(".out");
        const input = body.querySelector("input");
        const psEl = body.querySelector("#ps");

        const winPath = (p) => "C:" + (p === "/" ? "\\" : p.replace(/\//g, "\\"));
        const setPS = () => psEl.textContent = winPath(cwd) + ">";
        const print = (s = "") => { const d = document.createElement("div"); d.textContent = s; out.appendChild(d); term.scrollTop = 1e9; };
        setPS();

        print("MiniOS [Version 0.3.0]");
        print("(c) MiniOS Corporation. All rights reserved.\n");

        // resolve a (possibly C:\ / backslash / relative) path to a VFS path
        const resolve = (p) => {
          if (!p) return cwd;
          p = p.replace(/^[Cc]:/, "").replace(/\\/g, "/");
          if (p === "/") return "/";
          if (p.startsWith("/")) return p.replace(/\/+$/, "") || "/";
          if (p === "..") { const a = cwd.split("/").filter(Boolean); a.pop(); return "/" + a.join("/"); }
          if (p === ".") return cwd;
          return ((cwd === "/" ? "" : cwd) + "/" + p).replace(/\/+$/, "");
        };

        function dir(path) {
          const items = VFS.list(path);
          print(" Volume in drive C is MINIOS");
          print(" Directory of " + winPath(path) + "\n");
          let files = 0, dirs = 0;
          const now = new Date().toLocaleDateString();
          items.forEach(it => {
            if (it.type === "dir") { dirs++; print(now + "    <DIR>          " + it.name); }
            else { files++; print(now + "    " + String(it.size).padStart(12) + " " + it.name); }
          });
          print("");
          print("    " + String(files).padStart(8) + " File(s)");
          print("    " + String(dirs).padStart(8) + " Dir(s)");
        }

        const cmds = {
          help: () => print(
            "Commands:\n" +
            " DIR [path]      list directory       CD [path]    change directory\n" +
            " CLS             clear screen         TYPE file    show file\n" +
            " ECHO text       print text           COPY a b     copy file\n" +
            " MOVE a b        move/rename          DEL file     delete file\n" +
            " MD dir          make directory       RD dir       remove directory\n" +
            " REN a b         rename               TREE         show tree\n" +
            " VER  VOL        version/volume       DATE  TIME   show date/time\n" +
            " SET [v=val]     environment vars     TITLE t      set window title\n" +
            " WHOAMI HOSTNAME identity             CLIP text    copy to clipboard\n" +
            " START app       launch MiniOS app    PS SYSINFO   processes/host\n" +
            " IPCONFIG PING   network (offline)    EXIT         close window\n" +
            " PYTHON file/-c  run real Python 3    PIP install  install packages\n" +
            " CURL url        HTTP fetch           WGET url     download to file\n" +
            " SELFTEST        run smoke tests"),
          "?": () => cmds.help(),
          dir: (a) => dir(resolve(a[0])),
          ls: (a) => dir(resolve(a[0])),
          cd: (a) => { if (!a[0]) return print(winPath(cwd)); const p = resolve(a[0]); if (VFS.isDir(p)) { cwd = p || "/"; setPS(); } else print("The system cannot find the path specified."); },
          chdir: (a) => cmds.cd(a),
          cls: () => out.innerHTML = "",
          type: (a) => { const c = VFS.read(resolve(a[0])); print(c == null ? "The system cannot find the file specified." : c); },
          echo: (a) => print(a.length ? a.join(" ") : "ECHO is on."),
          copy: (a) => { const s = VFS.read(resolve(a[0])); if (s == null) return print("The system cannot find the file specified."); VFS.write(resolve(a[1]), s); print("        1 file(s) copied."); },
          move: (a) => { const s = VFS.read(resolve(a[0])); if (s == null) return print("cannot find file"); VFS.write(resolve(a[1]), s); VFS.remove(resolve(a[0])); print("        1 file(s) moved."); },
          del: (a) => print(VFS.remove(resolve(a[0])) ? "" : "Could Not Find " + a[0]),
          erase: (a) => cmds.del(a),
          md: (a) => { VFS.mkdir(resolve(a[0])); },
          mkdir: (a) => cmds.md(a),
          rd: (a) => print(VFS.remove(resolve(a[0])) ? "" : "The system cannot find the file specified."),
          rmdir: (a) => cmds.rd(a),
          ren: (a) => cmds.move(a),
          rename: (a) => cmds.move(a),
          tree: () => {
            const walk = (p, ind) => {
              VFS.list(p).forEach(it => {
                print(ind + (it.type === "dir" ? "├─ " : "│  ") + it.name);
                if (it.type === "dir") walk((p === "/" ? "" : p) + "/" + it.name, ind + "   ");
              });
            };
            print(winPath(cwd)); walk(cwd, "");
          },
          ver: () => print("\nMiniOS [Version 0.3.0]\n"),
          vol: () => { print(" Volume in drive C is MINIOS"); print(" Volume Serial Number is 4D49-4E49"); },
          date: () => print("The current date is: " + new Date().toLocaleDateString()),
          time: () => print("The current time is: " + new Date().toLocaleTimeString()),
          whoami: () => print((Kernel.nvram.deviceName || "minios") + "\\" + env.USERNAME),
          hostname: () => print(Kernel.nvram.deviceName),
          set: (a) => {
            if (!a.length) return Object.entries(env).forEach(([k, v]) => print(k + "=" + v));
            const m = a.join(" ").match(/^([^=]+)=(.*)$/);
            if (m) env[m[1]] = m[2]; else print(env[a[0]] != null ? a[0] + "=" + env[a[0]] : "Environment variable " + a[0] + " not defined");
          },
          title: (a) => { const t = a.join(" "); const tb = win.el.querySelector(".title"); if (tb) tb.textContent = t; },
          clip: async (a) => { await Kernel.sys.clipboardCopy(a.join(" ")); print("Copied to clipboard."); },
          start: (a) => { if (a[0]) Apps.launch(a[0]); else Apps.launch("files"); },
          ps: () => Kernel.list().forEach(p => print(p.pid + "\t" + p.appId + "\t" + p.title)),
          sysinfo: async () => { const i = await Kernel.sys.deviceInfo(); print(JSON.stringify(i, null, 2)); },
          ipconfig: () => { print("\nMiniOS Virtual Adapter:\n   IPv4 Address. . . : 10.0.2.15\n   Subnet Mask . . . : 255.255.255.0\n   Default Gateway . : 10.0.2.2\n"); },
          ping: (a) => print("Ping request could not find host " + (a[0] || "") + ". MiniOS terminal is offline (use the Browser for network)."),
          python: async (a) => {
            let code;
            if (a[0] === "-c") code = a.slice(1).join(" ").replace(/^["']|["']$/g, "");
            else if (a[0]) { code = VFS.read(resolve(a[0])); if (code == null) return print("python: can't open file '" + a[0] + "'"); }
            else return print("usage: python <file.py> | python -c \"code\"");
            // Prefer the native CPython runtime (python-ios-lib) on device.
            if (Bridge.onDevice) {
              try {
                const r = await Bridge.call("python", "run", { code });
                if (r && r.output != null) { if (r.output) print(r.output.replace(/\n$/, "")); return; }
              } catch (e) { print("(native Python unavailable, using WASM fallback)"); }
            }
            if (!window.Py) return print("python: runtime unavailable");
            if (!window.Py.loaded()) print("(loading Python — first run downloads the runtime)");
            await window.Py.run(code, (s) => print(s.replace(/\n$/, "")), (s) => print(s.replace(/\n$/, "")));
          },
          python3: (a) => cmds.python(a),
          pip: async (a) => {
            if (a[0] !== "install" || !a[1]) return print("usage: pip install <package>");
            if (Bridge.onDevice) {
              try { for (const pkg of a.slice(1)) { const r = await Bridge.call("python", "pip", { pkg }); if (r && r.output) print(r.output.replace(/\n$/, "")); } return; }
              catch (e) {}
            }
            if (!window.Py) return print("pip: runtime unavailable");
            if (!window.Py.loaded()) print("(loading Python…)");
            for (const pkg of a.slice(1)) await window.Py.pip(pkg, (s) => print(s));
          },
          pip3: (a) => cmds.pip(a),
          curl: async (a) => {
            const url = a.find(x => !x.startsWith("-")); if (!url) return print("usage: curl <url> [-o file]");
            try {
              const res = await fetch(url); const text = await res.text();
              const oi = a.indexOf("-o"); const wi = a.indexOf("-O");
              if (oi >= 0 && a[oi + 1]) { VFS.write(resolve(a[oi + 1]), text); print("saved " + text.length + " bytes to " + a[oi + 1]); }
              else if (wi >= 0) { const fn = url.split("/").pop() || "download"; VFS.write(resolve(fn), text); print("saved to " + fn); }
              else print(text.length > 4000 ? text.slice(0, 4000) + "\n…(truncated)" : text);
            } catch (e) { print("curl: " + e.message + " (note: cross-origin sites may block fetch via CORS)"); }
          },
          wget: async (a) => {
            const url = a[0]; if (!url) return print("usage: wget <url>");
            try { const res = await fetch(url); const text = await res.text(); const fn = url.split("/").pop() || "index.html"; VFS.write(resolve(fn), text); print("'" + fn + "' saved [" + text.length + "]"); }
            catch (e) { print("wget: " + e.message); }
          },
          selftest: () => {
            const r = window.SelfTest.run();
            r.results.forEach(t => print((t.ok ? "  [PASS] " : "  [FAIL] ") + t.name + (t.err ? " — " + t.err : "")));
            print("");
            print((r.fail ? "FAILED" : "OK") + ": " + r.pass + "/" + r.total + " passed, " + r.fail + " failed.");
          },
          color: () => print("(color is fixed in MiniOS console)"),
          pause: () => print("Press any key to continue . . ."),
          exit: () => WM.close(win.id),
        };

        function execute(line) {
          print(psEl.textContent + line);
          const trimmed = line.trim();
          if (!trimmed) return;
          history.unshift(trimmed); hi = -1;
          // support  VAR=val style? cmd uses SET. parse command:
          const parts = trimmed.match(/("[^"]*"|\S+)/g).map(s => s.replace(/^"|"$/g, ""));
          const cmd = parts[0].toLowerCase();
          const args = parts.slice(1);
          if (cmds[cmd]) { try { cmds[cmd](args); } catch (e) { print("Error: " + e.message); } }
          else print("'" + parts[0] + "' is not recognized as an internal or external command.");
        }

        input.addEventListener("keydown", async (e) => {
          if (e.key === "Enter") { const v = input.value; input.value = ""; await execute(v); }
          else if (e.key === "ArrowUp") { if (hi < history.length - 1) { hi++; input.value = history[hi] || ""; } e.preventDefault(); }
          else if (e.key === "ArrowDown") { if (hi > 0) { hi--; input.value = history[hi] || ""; } else { hi = -1; input.value = ""; } e.preventDefault(); }
        });
        setTimeout(() => input.focus(), 50);
        term.onclick = () => input.focus();
      },
    });
  }
  Apps.register({ id: "cmd", name: "Command Prompt", icon: "⬛", desktop: true, launch });
  Apps.register({ id: "terminal", name: "Command Prompt", icon: "⬛", desktop: false, launch });
})();
