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
                "cores": ProcessInfo.processInfo.processorCount
            ])
        case "haptic":
            let gen = UIImpactFeedbackGenerator(style: .light)
            gen.impactOccurred()
            respond(true, true)
        case "log":
            print("[MiniOS] \(payload["message"] as? String ?? "")")
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
