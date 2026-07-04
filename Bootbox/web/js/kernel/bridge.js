/* ============================================================================
 * Bridge — the ONLY channel from MiniOS guest land to the iPad host app.
 *
 *   MiniOS app -> Bridge.call(bridge, action, payload) -> Promise
 *        -> window.webkit.messageHandlers.host.postMessage(...)   [on device]
 *        -> Swift BridgeRouter -> iPadOS API
 *        -> window.__hostReply(id, ok, result)  resolves the Promise
 *
 * When running in a plain browser (no host), a mock backend emulates the
 * bridges using localStorage so the whole desktop is still usable for dev.
 * ========================================================================== */
(function () {
  const pending = new Map();
  let seq = 0;

  const onDevice = !!(window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.host);

  // Host -> guest reply hook (called from Swift).
  window.__hostReply = function (id, ok, result) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    ok ? p.resolve(result) : p.reject(new Error(String(result)));
  };

  // Host -> guest one-way events (USB plug, file imported, …).
  const evtListeners = {};
  window.__hostEvent = function (name, payload) {
    (evtListeners[name] || []).forEach(fn => { try { fn(payload); } catch (e) { console.error(e); } });
    (evtListeners["*"] || []).forEach(fn => { try { fn(name, payload); } catch (e) {} });
  };

  // ---- Browser mock (dev fallback) -------------------------------------
  const mock = {
    files: {
      read:  (p) => localStorage.getItem("disk:" + p.key),
      write: (p) => (localStorage.setItem("disk:" + p.key, p.value), true),
      delete:(p) => (localStorage.removeItem("disk:" + p.key), true),
      list:  ()  => Object.keys(localStorage).filter(k => k.startsWith("disk:")).map(k => k.slice(5)),
    },
    clipboard: {
      copy:  async (p) => { try { await navigator.clipboard.writeText(p.text); } catch (e) {} return true; },
      paste: async ()  => { try { return await navigator.clipboard.readText(); } catch (e) { return ""; } },
    },
    system: {
      info:   () => ({ model: "Browser", name: "Dev Machine", osVersion: navigator.platform,
                       ram: (navigator.deviceMemory || 4) * 1073741824, cores: navigator.hardwareConcurrency || 4 }),
      haptic: () => true,
      log:    (p) => (console.log("[MiniOS]", p.message), true),
      setBrightness: () => true,
      // dev fallback "screenshot": render the wallpaper + a label to a canvas
      screenshot: () => {
        const c = document.createElement("canvas"); c.width = 800; c.height = 600;
        const x = c.getContext("2d");
        const g = x.createLinearGradient(0, 0, 800, 600);
        g.addColorStop(0, "#1b3a5b"); g.addColorStop(1, "#06121f");
        x.fillStyle = g; x.fillRect(0, 0, 800, 600);
        x.fillStyle = "#fff"; x.font = "20px sans-serif"; x.fillText("MiniOS snapshot (dev mock)", 30, 50);
        return { dataURL: c.toDataURL("image/png"), width: 800, height: 600 };
      },
    },
    binary: {
      list: () => JSON.parse(localStorage.getItem("imports") || "[]"),
      inspect: (p) => {
        const n = (p.name || "").toLowerCase();
        if (n.endsWith(".apk")) return { kind: "apk", name: p.name, package: "com.example.demo",
          label: "Demo", versionName: "1.0", minSdk: "21", targetSdk: "33",
          permissions: ["android.permission.INTERNET"], activities: [".MainActivity"],
          entryCount: 42, hasDex: true, nativeLibs: [], usesPlayServices: false, supported: true,
          verdict: "(mock) Likely runnable by the future MiniOS APK runtime." };
        if (n.endsWith(".exe")) return { kind: "exe", name: p.name, format: "PE32+",
          machine: "x86-64 (AMD64)", subsystem: "Windows Console", sections: [".text", ".data", ".rdata"],
          size: 123456, supported: false, verdict: "(mock) Windows PE — local x86 execution out of scope." };
        return { kind: "unknown", name: p.name };
      },
      delete: (p) => { const l = JSON.parse(localStorage.getItem("imports") || "[]").filter(x => x !== p.name);
                       localStorage.setItem("imports", JSON.stringify(l)); return true; },
      dex: () => null, // dev: no real apk bytes in the browser
      // Dev: simulate a host ISO download with streamed progress events so the
      // Bootbox boot-menu progress bar can be exercised in a plain browser.
      download: (p) => {
        const total = 120 * 1048576; let received = 0;
        const step = () => {
          received = Math.min(total, received + total / 18);
          window.__hostEvent && window.__hostEvent("downloadProgress", { name: p.name, received, total, done: false });
          if (received < total) { setTimeout(step, 110); return; }
          const l = JSON.parse(localStorage.getItem("imports") || "[]");
          if (!l.includes(p.name)) { l.push(p.name); localStorage.setItem("imports", JSON.stringify(l)); }
          window.__hostEvent && window.__hostEvent("downloadProgress", { name: p.name, received: total, total, done: true, ok: true });
        };
        setTimeout(step, 150);
        return { started: true, name: p.name };
      },
    },
    usb: {
      start: () => true,
      list: () => ({ accessories: [], volumes: [] }),
    },
    media: {
      // 1x1 gray pixel so the dev UI has something to show without a camera.
      capturePhoto: () => ({ path: "capture.jpg", width: 1, height: 1,
        dataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" }),
      recordAudio: (p) => ({ path: "recording.m4a", seconds: p.seconds || 4 }),
      stopRecording: () => true,
      playTone: () => true,
      permissions: () => ({ camera: false, microphone: false, cameraAvailable: false }),
    },
    browser: {
      open: () => true, navigate: () => true, setFrame: () => true,
      back: () => true, forward: () => true, reload: () => true,
      show: () => true, hide: () => true, close: () => true, hideAll: () => true,
    },
    ml: {
      classify: () => ({ classifications: [
        { label: "(mock) tabby cat", confidence: 0.82 },
        { label: "(mock) tiger", confidence: 0.11 } ] }),
      ocr: () => ({ text: "(mock OCR) Hello from MiniOS", lines: 1 }),
    },
  };

  const Bridge = {
    onDevice,
    onEvent(name, fn) { (evtListeners[name] = evtListeners[name] || []).push(fn); },
    offEvent(name, fn) { evtListeners[name] = (evtListeners[name] || []).filter(f => f !== fn); },
    call(bridge, action, payload = {}) {
      if (!onDevice) {
        const fn = mock[bridge] && mock[bridge][action];
        if (!fn) return Promise.reject(new Error("no mock for " + bridge + "." + action));
        return Promise.resolve().then(() => fn(payload));
      }
      const id = "m" + (++seq);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.webkit.messageHandlers.host.postMessage({ id, bridge, action, payload });
        setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); reject(new Error("host timeout")); }
        }, 4000);
      });
    },
  };

  window.Bridge = Bridge;
})();
