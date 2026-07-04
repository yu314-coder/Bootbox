/* ============================================================================
 * Kernel — process/task manager, syscalls, event bus, NVRAM settings.
 * Guest apps never touch the DOM bridge or VFS directly except through here +
 * the window manager. This is the MiniOS "API" layer in your architecture.
 * ========================================================================== */
(function () {
  const listeners = {};
  let nextPid = 1;
  const processes = new Map(); // pid -> { pid, appId, title, win }

  const NVRAM_KEY = "nvram.v1";
  let nvram = {
    theme: "dark",
    accent: "#0078d4",
    wallpaper: "aurora",
    bootDelay: 1,
    sound: true,
    deviceName: "MINIOS-PC",
    devices: { gpu: true, audio: true, network: true, camera: false, ml: false },
  };

  const Kernel = {
    nvram,

    async boot() {
      // NVRAM lives in the host disk so BIOS changes persist across reboots.
      try {
        const raw = await Bridge.call("files", "read", { key: NVRAM_KEY });
        if (raw) Object.assign(nvram, JSON.parse(raw));
      } catch (e) {}
      this.applyTheme();
      await VFS.load();

      // Bridge host events onto the kernel event bus, then start USB monitoring.
      Bridge.onEvent("usb:connect", (p) => Kernel.emit("usb:connect", p));
      Bridge.onEvent("usb:disconnect", (p) => Kernel.emit("usb:disconnect", p));
      Bridge.onEvent("file:imported", (p) => Kernel.emit("file:imported", p));
      Bridge.onEvent("download:done", (p) => Kernel.emit("download:done", p));
      Bridge.onEvent("download:failed", (p) => Kernel.emit("download:failed", p));
      try { await this.sys.usbStart(); } catch (e) {}
    },
    async saveNVRAM() {
      try { await Bridge.call("files", "write", { key: NVRAM_KEY, value: JSON.stringify(nvram) }); }
      catch (e) {}
    },
    applyTheme() {
      document.body.classList.toggle("light", nvram.theme === "light");
      document.documentElement.style.setProperty("--accent", nvram.accent);
      this.applyWallpaper();
    },
    wallpapers: {
      aurora: "linear-gradient(135deg,#1b3a5b 0%,#0a2540 50%,#06121f 100%)",
      sunset: "linear-gradient(135deg,#ff7e5f 0%,#feb47b 50%,#7b4397 100%)",
      forest: "linear-gradient(135deg,#134e5e 0%,#2c7744 60%,#71b280 100%)",
      grape:  "linear-gradient(135deg,#41295a 0%,#2f0743 100%)",
      ocean:  "linear-gradient(135deg,#2193b0 0%,#6dd5ed 100%)",
      slate:  "linear-gradient(135deg,#232526 0%,#414345 100%)",
      bloom:  "radial-gradient(circle at 30% 20%,#ff6a88 0%,#ff99ac 35%,#6a82fb 100%)",
    },
    applyWallpaper() {
      const wp = document.getElementById("wallpaper");
      if (!wp) return;
      const v = nvram.wallpaper || "aurora";
      wp.style.background = this.wallpapers[v] || v; // preset name, gradient, or color
      wp.style.backgroundSize = "cover";
    },

    // ---- event bus ----
    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit(evt, data) { (listeners[evt] || []).forEach(fn => { try { fn(data); } catch (e) { console.error(e); } }); },

    // ---- process table ----
    spawn(appId, title, win) {
      const pid = nextPid++;
      const proc = { pid, appId, title, win, started: Date.now() };
      processes.set(pid, proc);
      this.emit("proc:start", proc);
      return proc;
    },
    kill(pid) {
      const p = processes.get(pid);
      if (!p) return;
      processes.delete(pid);
      this.emit("proc:end", p);
    },
    list() { return [...processes.values()]; },

    // ---- syscalls (thin wrappers over bridge / vfs) ----
    sys: {
      clipboardCopy: (t) => Bridge.call("clipboard", "copy", { text: t }),
      clipboardPaste: () => Bridge.call("clipboard", "paste"),
      deviceInfo: () => Bridge.call("system", "info"),
      haptic: () => Bridge.call("system", "haptic"),
      log: (m) => Bridge.call("system", "log", { message: m }),
      screenshot: () => Bridge.call("system", "screenshot"),
      setBrightness: (v) => Bridge.call("system", "setBrightness", { value: v }),
      // binary inspection (EXE / APK)
      listBinaries: () => Bridge.call("binary", "list"),
      inspectBinary: (name) => Bridge.call("binary", "inspect", { name }),
      getDex: (name) => Bridge.call("binary", "dex", { name }),
      deleteBinary: (name) => Bridge.call("binary", "delete", { name }),
      // external hardware
      usbStart: () => Bridge.call("usb", "start"),
      usbList: () => Bridge.call("usb", "list"),
      // media (Phase 6)
      capturePhoto: () => Bridge.call("media", "capturePhoto"),
      recordAudio: (seconds) => Bridge.call("media", "recordAudio", { seconds }),
      stopRecording: () => Bridge.call("media", "stopRecording"),
      playAudio: () => Bridge.call("media", "playTone"),
      mediaPermissions: () => Bridge.call("media", "permissions"),
      // ML (Phase 6)
      classifyImage: (dataURL) => Bridge.call("ml", "classify", { dataURL }),
      ocrImage: (dataURL) => Bridge.call("ml", "ocr", { dataURL }),
    },

    notify(title, body) { Kernel.emit("notify", { title, body }); },
  };

  window.Kernel = Kernel;
})();
