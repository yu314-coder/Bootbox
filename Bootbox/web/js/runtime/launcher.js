/* ============================================================================
 * Universal Launcher (offline) — runs imported EXE/APK entirely on-device.
 *
 *   APK -> Android runtime harness   (Activity lifecycle + widget toolkit)
 *   EXE -> Win32 subset console      (PE-derived stub + Win32-ish API)
 *
 * Note: iPadOS forbids JIT / native code, so this is a compatibility harness,
 * not a Dalvik/ART VM or x86 emulator. Simple Java/Kotlin APKs run as real
 * Activities; complex binaries open a manifest/PE-derived session. No network
 * is used — MiniOS runs fully offline (only the Browser app goes online).
 * ========================================================================== */
(function () {
  function localCapable(report) {
    if (!report) return false;
    if (report.kind === "apk") return true;   // always render an Activity
    if (report.kind === "exe") return true;   // always open a Win32 session
    return false;
  }

  function runLocal(report) {
    if (report.kind === "apk") Android.run(Android.fromManifest(report));
    else if (report.kind === "exe") Win32.run(Win32.fromPE(report));
    else Kernel.notify("Launcher", "No runtime for " + report.name);
  }

  const Launcher = {
    localCapable,
    open(report) {
      Kernel.notify("Running", report.name + " (on-device)");
      runLocal(report);
    },
    async openByName(name) {
      try { const r = await Kernel.sys.inspectBinary(name); this.open(r); }
      catch (e) { Kernel.notify("Launcher", e.message); }
    },
  };

  window.Launcher = Launcher;
})();
