import Foundation
import AVFoundation

/// Startup self-check: verifies the app's entitlements/containers are wired so
/// build/runtime issues surface in the console instead of failing silently.
/// Results are also exposed to the guest via a host event.
enum SelfCheck {
    static func run() {
        var ok = true
        var report: [String: Any] = [:]

        // App Group container (needed by File Provider + shared imports/downloads)
        if let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.euleryu.bootbox") {
            report["appGroup"] = true
            report["appGroupPath"] = url.path
        } else {
            report["appGroup"] = false; ok = false
            print("[MiniOS][SelfCheck] ⚠️ App Group 'group.com.euleryu.bootbox' missing — set it on both targets in Signing & Capabilities.")
        }

        // Bundled web runtime
        let web = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web")
            ?? Bundle.main.url(forResource: "index", withExtension: "html")
        report["webRuntime"] = (web != nil)
        if web == nil { ok = false; print("[MiniOS][SelfCheck] ⚠️ web/index.html not in bundle.") }

        // Camera/mic usage strings (so permission prompts don't crash)
        let info = Bundle.main.infoDictionary ?? [:]
        report["cameraUsage"] = info["NSCameraUsageDescription"] != nil
        report["micUsage"] = info["NSMicrophoneUsageDescription"] != nil
        if info["NSCameraUsageDescription"] == nil { print("[MiniOS][SelfCheck] ⚠️ NSCameraUsageDescription missing.") }

        report["cameraStatus"] = String(describing: AVCaptureDevice.authorizationStatus(for: .video).rawValue)
        report["ok"] = ok
        print("[MiniOS][SelfCheck] \(ok ? "✅ all checks passed" : "⚠️ issues found"): \(report)")
        HostEvents.emit("selfcheck", report)
    }
}
