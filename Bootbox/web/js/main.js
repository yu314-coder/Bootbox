/* ============================================================================
 * main.js — entry point. Power on -> Kernel boot -> POST -> Desktop.
 * ========================================================================== */
(function () {
  let powered = false;

  // iOS/WKWebView has no Pointer Lock API. v86 (and our trackpad-capture path)
  // call requestPointerLock; on iOS the rejection would paint the red error
  // banner on every tap. Make it a harmless no-op when unsupported — touch input
  // never needs pointer lock, so nothing is lost.
  try {
    if (window.Element && !Element.prototype.requestPointerLock) {
      Element.prototype.requestPointerLock = function () { return Promise.resolve(); };
    }
    if (window.Document && !Document.prototype.exitPointerLock) {
      Document.prototype.exitPointerLock = function () {};
    }
  } catch (e) {}

  // Surface any uncaught error/rejection on screen (device has no console).
  function banner(msg) {
    let b = document.getElementById("err-banner");
    if (!b) {
      b = document.createElement("div"); b.id = "err-banner";
      b.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:200000;background:#b00020;color:#fff;" +
        "font:12px/1.4 monospace;padding:8px 12px;white-space:pre-wrap;max-height:40%;overflow:auto";
      b.onclick = () => b.remove();
      document.body.appendChild(b);
    }
    b.textContent = "Bootbox error (tap to dismiss):\n" + msg;
  }
  window.addEventListener("error", (e) => banner((e.message || "error") + "\n" + (e.filename || "") + ":" + (e.lineno || "")));
  window.addEventListener("unhandledrejection", (e) => banner("promise: " + (e.reason && (e.reason.message || e.reason))));

  async function powerOn() {
    if (powered) return;
    powered = true;
    try { await Kernel.boot(); } catch (e) { console.error("Kernel.boot failed:", e); banner("boot: " + (e && e.message)); }
    try { if (window.__restoreInstalled) window.__restoreInstalled(); } catch (e) {}
    Boot.post();                  // always reach the desktop, even if boot had issues
  }

  function powerButton() {
    const btn = document.getElementById("power-btn");
    btn.onclick = () => {
      if (window.__miniosOff) { location.reload(); return; } // turn back on after shut down
      if (!powered) { powerOn(); return; }
      // During POST a tap enters BIOS; otherwise show the power menu.
      if (Boot.interrupt()) return;
      Lock.menu(btn);
    };
  }

  // F2 / DEL enters UEFI Setup any time (handy on a hardware keyboard).
  window.addEventListener("keydown", (e) => {
    if (e.key === "F2" || e.key === "Delete") {
      e.preventDefault();
      try { if (Boot.interrupt && Boot.interrupt()) return; } catch (err) {}
      try { Bootbox.showSetup(); } catch (err) {}
    }
  });

  window.addEventListener("DOMContentLoaded", () => {
    powerButton();
    // Auto power-on shortly after load (feels like turning the device on).
    setTimeout(powerOn, 400);
  });
})();
