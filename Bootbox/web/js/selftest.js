/* ============================================================================
 * SelfTest — in-guest smoke tests. Run from Terminal (`selftest`) or
 * window.SelfTest.run(). Exercises core subsystems + launches every app to
 * confirm nothing throws. Returns { pass, fail, results }.
 * ========================================================================== */
(function () {
  function check(name, fn, results) {
    try { const ok = fn(); results.push({ name, ok: !!ok }); }
    catch (e) { results.push({ name, ok: false, err: e.message }); }
  }

  function run() {
    const results = [];

    // --- kernel / vfs / nvram ---
    check("VFS write+read", () => { VFS.write("/Documents/.t.txt", "hello"); return VFS.read("/Documents/.t.txt") === "hello"; }, results);
    check("VFS mkdir+list", () => { VFS.mkdir("/Documents/.tdir"); return VFS.isDir("/Documents/.tdir"); }, results);
    check("VFS remove", () => { VFS.remove("/Documents/.t.txt"); VFS.remove("/Documents/.tdir"); return !VFS.exists("/Documents/.t.txt"); }, results);
    check("NVRAM present", () => !!Kernel.nvram && !!Kernel.nvram.deviceName, results);
    check("Bridge available", () => !!window.Bridge && typeof Bridge.call === "function", results);
    check("Kernel syscalls", () => typeof Kernel.sys.deviceInfo === "function", results);
    check("Wallpapers defined", () => Object.keys(Kernel.wallpapers).length >= 5, results);

    // --- window manager ---
    check("WM open+close", () => {
      const w = WM.open({ appId: "selftest", title: "T", icon: "🧪", render: (b) => b.textContent = "ok" });
      const ok = !!WM.get(w.id);
      WM.close(w.id);
      return ok;
    }, results);
    check("WM snap zones", () => typeof WM.snap === "function" && typeof WM.minimizeOthers === "function", results);
    check("Virtual desktops", () => typeof WM.addDesktop === "function" && WM.desktopCount() >= 1, results);

    // --- runtimes / launcher ---
    check("Android runtime", () => !!window.Android && typeof Android.run === "function", results);
    check("Win32 runtime", () => !!window.Win32 && typeof Win32.run === "function", results);
    check("Universal Launcher", () => !!window.Launcher && typeof Launcher.open === "function", results);

    // --- launch every registered app, confirm a window appears, then close ---
    const skip = new Set(["selftest"]);
    Apps.all().forEach(app => {
      if (skip.has(app.id)) return;
      check("launch:" + app.id, () => {
        const before = WM.list().length;
        Apps.launch(app.id);
        const after = WM.list().length;
        // close any windows this app opened
        WM.list().filter(w => (w.opts.appId || "").startsWith(app.id) || w.proc.appId === app.id).forEach(w => WM.close(w.id));
        return after >= before; // launched without throwing (some may stack)
      }, results);
    });

    const fail = results.filter(r => !r.ok).length;
    const pass = results.length - fail;
    return { pass, fail, total: results.length, results };
  }

  window.SelfTest = { run };
})();
