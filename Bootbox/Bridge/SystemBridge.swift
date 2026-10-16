import UIKit
import WebKit
import FileProvider

/// Misc host services: device info, haptics, share sheet, and importing real
/// iPad files into the MiniOS virtual disk via the document picker.
final class SystemBridge: NSObject {
    func handle(_ action: String, _ payload: [String: Any],
                presenter: WKWebView?,
                respond: @escaping (Bool, Any?) -> Void) {
        switch action {
        case "info":
            let d = UIDevice.current
            respond(true, [
                "model": d.model,
                "name": d.name,
                "osVersion": d.systemVersion,
                "ram": ProcessInfo.processInfo.physicalMemory,
                "cores": ProcessInfo.processInfo.processorCount,
                "memLimitMB": MemoryProbe.limitMB ?? 0,
                "memProbeRunning": MemoryProbe.shared.isRunning
            ])
        case "takeLastCrash":
            // When the previous page's process died (0 = it didn't); cleared once read.
            let d = UserDefaults.standard
            let at = d.double(forKey: "BootboxLastPageCrash"), code = d.integer(forKey: "BootboxLastPageCrashCode")
            d.removeObject(forKey: "BootboxLastPageCrash")
            respond(true, ["at": at, "code": code])
        case "power":
            // Low Power Mode and heat both cap the CPU clock - the emulator's speed follows directly
            // (the toolbar's speed badge says so instead of the user guessing). thermal: 0 nominal,
            // 1 fair, 2 serious, 3 critical.
            let p = ProcessInfo.processInfo
            respond(true, ["lowPower": p.isLowPowerModeEnabled, "thermal": p.thermalState.rawValue])
        case "memLimit":
            // Waits (up to ~20 s) for the one-time probe if it is still running.
            MemoryProbe.shared.whenDone { respond(true, ["limitMB": $0 ?? 0, "how": MemoryProbe.lastHow]) }
        case "haptic":
            let gen = UIImpactFeedbackGenerator(style: .light)
            gen.impactOccurred()
            respond(true, true)
        case "log":
            print("[MiniOS] \(payload["message"] as? String ?? "")")
            respond(true, true)
        case "appendLog":
            BootLog.append(payload["text"] as? String ?? "")
            respond(true, true)
        case "setBrightness":
            let v = (payload["value"] as? NSNumber)?.doubleValue ?? 1
            DispatchQueue.main.async { UIScreen.main.brightness = CGFloat(max(0.05, min(1, v))) }
            respond(true, true)
        case "screenshot":
            screenshot(presenter, respond)
        case "fpdiag":
            fpdiag(respond)
        case "fpreset":
            DomainRegistrar.forceReset(); respond(true, "File-sync location reset requested.")
        case "getBackgroundGrace":
            // Seconds the app keeps the guest running after you switch away. >=86400 = keep running.
            let sec = UserDefaults.standard.object(forKey: "BootboxBackgroundGraceSeconds") as? Double ?? 86_400
            respond(true, sec)
        case "setBackgroundGrace":
            let sec = (payload["seconds"] as? NSNumber)?.doubleValue ?? 86_400
            UserDefaults.standard.set(sec, forKey: "BootboxBackgroundGraceSeconds")
            BackgroundKeepAlive.shared.reschedule()   // apply immediately if already backgrounded
            respond(true, sec)
        default:
            respond(false, "unknown system action: \(action)")
        }
    }

    /// File-Provider diagnostics: build number, what's actually in the shared imports dir, which File
    /// Provider domains iOS has registered, and the extension's own activity log (fp-diag.log) — the
    /// only window we have into WHY the Files app shows "Syncing Paused" (iOS never tells the extension).
    private func fpdiag(_ respond: @escaping (Bool, Any?) -> Void) {
        let group = "group.com.euleryu.bootbox"
        let fm = FileManager.default
        var out = "=== Bootbox File-Sync Diagnostics ===\n"
        out += "app build: \(Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?")\n"
        if let base = fm.containerURL(forSecurityApplicationGroupIdentifier: group) {
            let imports = base.appendingPathComponent("MiniOSImports")
            let files = (try? fm.contentsOfDirectory(atPath: imports.path)) ?? []
            out += "importsDir (\(files.count)): \(files.sorted().joined(separator: ", "))\n"
            let log = (try? String(contentsOf: base.appendingPathComponent("fp-diag.log"), encoding: .utf8))
                ?? "(no extension log — iOS has not invoked the File Provider extension at all)"
            out += "\n=== extension activity (most recent last) ===\n" + log
        } else {
            out += "!! APP GROUP CONTAINER NOT ACCESSIBLE — entitlement/provisioning problem\n"
        }
        NSFileProviderManager.getDomainsWithCompletionHandler { domains, _ in
            let names = domains.map { $0.identifier.rawValue }
            let head = "domains registered with iOS: \(names.isEmpty ? "NONE (extension not registered!)" : names.joined(separator: ", "))\n"
            DispatchQueue.main.async { respond(true, head + out) }
        }
    }

    private func screenshot(_ webView: WKWebView?, _ respond: @escaping (Bool, Any?) -> Void) {
        guard let webView else { return respond(false, "no view") }
        let cfg = WKSnapshotConfiguration()
        DispatchQueue.main.async {
            webView.takeSnapshot(with: cfg) { image, error in
                guard let image, let data = image.pngData() else {
                    return respond(false, error?.localizedDescription ?? "snapshot failed")
                }
                respond(true, ["dataURL": "data:image/png;base64," + data.base64EncodedString(),
                               "width": image.size.width, "height": image.size.height])
            }
        }
    }
}

/// Persistent app log: Documents/Logs/bootbox.log, rotated to bootbox.1.log past 1 MB. The page's
/// console arrives here (bridge.js -> system "appendLog") along with native events (the WebContent
/// process being killed, memory warnings, backgrounding), so a guest that dies on a real iPad leaves
/// a readable trail (Files app, or `xcrun devicectl device copy from … --domain-type appDataContainer`).
enum BootLog {
    private static let queue = DispatchQueue(label: "bootbox.bootlog")
    static var url: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Logs", isDirectory: true).appendingPathComponent("bootbox.log")
    }

    static func append(_ text: String) {
        guard !text.isEmpty else { return }
        queue.async {
            let fm = FileManager.default, file = url
            try? fm.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
            if let size = (try? fm.attributesOfItem(atPath: file.path))?[.size] as? Int, size > 1_000_000 {
                let old = file.deletingLastPathComponent().appendingPathComponent("bootbox.1.log")
                try? fm.removeItem(at: old)
                try? fm.moveItem(at: file, to: old)
            }
            guard let data = (text.hasSuffix("\n") ? text : text + "\n").data(using: .utf8) else { return }
            if let h = try? FileHandle(forWritingTo: file) {
                defer { try? h.close() }
                _ = try? h.seekToEnd()
                try? h.write(contentsOf: data)
            } else {
                try? data.write(to: file)
            }
        }
    }

    /// A native event, timestamped.
    static func native(_ message: String) {
        let build = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "?"
        append("[native \(ISO8601DateFormatter().string(from: Date())) build \(build)] \(message)")
    }
}

/// How much memory iOS lets ONE web page (WebContent process) use on this device - the budget a
/// 64-bit guest has to fit in (the page holds the guest's RAM plus the engine; past the limit iOS
/// kills the page). Not published anywhere, so measure it once per iOS version: a 1x1, nearly
/// transparent web view with its own process pool (= its own WebContent process) grows a wasm
/// memory in 64 MB steps, touching every page, and reports each step; when iOS kills that process,
/// the last step reached is the limit. Takes a few seconds at launch; the visible app is untouched.
final class MemoryProbe: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    static let shared = MemoryProbe()
    // v2: slower steps + a 15 s hold at the peak, so a periodic memory check can't be outrun.
    private static let keyMB = "BootboxWebMemLimitMB2", keyOS = "BootboxWebMemLimitOS2"
    static var lastHow = ""
    static var limitMB: Int? {
        let d = UserDefaults.standard
        guard d.string(forKey: keyOS) == UIDevice.current.systemVersion else { return nil }
        let v = d.integer(forKey: keyMB)
        return v > 0 ? v : nil
    }

    private var webView: WKWebView?
    private var lastMB = 0
    private var waiters: [(Int?) -> Void] = []
    private var running = false
    var isRunning: Bool { running }

    func runIfNeeded() {
        guard Self.limitMB == nil, !running else { return }
        running = true
        DispatchQueue.main.async { self.start() }
    }

    func whenDone(_ cb: @escaping (Int?) -> Void) {
        DispatchQueue.main.async {
            if !self.running { cb(Self.limitMB); return }
            var fired = false
            let once: (Int?) -> Void = { v in if !fired { fired = true; cb(v) } }
            self.waiters.append(once)
            DispatchQueue.main.asyncAfter(deadline: .now() + 20) { once(nil) }
        }
    }

    private func start() {
        guard let window = UIApplication.shared.connectedScenes.compactMap({ ($0 as? UIWindowScene)?.keyWindow }).first else {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { self.start() }   // no window yet
            return
        }
        let cfg = WKWebViewConfiguration()
        cfg.websiteDataStore = .nonPersistent()       // (each WKWebView gets its own WebContent process)
        cfg.userContentController.add(self, name: "probe")
        let wv = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: cfg)
        wv.alpha = 0.02                                // "visible", so WebKit doesn't suspend it
        wv.isUserInteractionEnabled = false
        wv.navigationDelegate = self
        window.addSubview(wv)
        webView = wv
        BootLog.native("memory probe: starting")
        let js = """
        (async () => {
          const post = (m) => window.webkit.messageHandlers.probe.postMessage(m);
          const STEP = 128;
          let mem;
          try { mem = new WebAssembly.Memory({ initial: 0, maximum: 65536 }); }
          catch (e) { post({ done: 0, why: "no memory: " + e }); return; }
          let mb = 0;
          const hold = async (why) => { post({ hold: mb }); await new Promise((r) => setTimeout(r, 15000)); post({ done: mb, why }); };
          while (mb < 6000) {
            try { mem.grow(STEP * 16); } catch (e) { await hold("WebKit refused to grow wasm memory past this; held 15 s"); return; }
            const u8 = new Uint8Array(mem.buffer, mb * 1048576, STEP * 1048576);
            for (let i = 0; i < u8.length; i += 4096) u8[i] = 1;
            mb += STEP;
            post({ mb });
            await new Promise((r) => setTimeout(r, 500));
          }
          await hold("reached the probe cap; held 15 s");
        })();
        """
        wv.loadHTMLString("<!doctype html><meta charset=utf-8><body><script>\(js)</script></body>", baseURL: nil)
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard running, let body = message.body as? [String: Any] else { return }
        if let mb = body["mb"] as? Int {
            lastMB = mb
            if mb % 512 == 0 { BootLog.native("memory probe: \(mb) MB so far") }
        } else if let mb = body["hold"] as? Int {
            BootLog.native("memory probe: holding \(mb) MB for 15 s")
        } else if let done = body["done"] as? Int {
            finish(done, how: body["why"] as? String ?? "done")
        }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        finish(lastMB, how: "iOS stopped the page")
    }

    private func finish(_ mb: Int, how: String) {
        guard running else { return }
        running = false
        Self.lastHow = how
        if mb > 0 {
            UserDefaults.standard.set(mb, forKey: Self.keyMB)
            UserDefaults.standard.set(UIDevice.current.systemVersion, forKey: Self.keyOS)
        }
        BootLog.native("memory probe: a web page can use about \(mb) MB (\(how))")
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "probe")
        webView?.removeFromSuperview()
        webView = nil
        let w = waiters; waiters = []
        w.forEach { $0(mb > 0 ? mb : nil) }
    }
}
