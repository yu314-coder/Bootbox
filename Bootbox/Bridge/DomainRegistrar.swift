import Foundation
import FileProvider

/// Registers the MiniOS File Provider domain so it appears in the Files app.
enum DomainRegistrar {
    // OLD (non-replicated) NSFileProviderExtension model → the domain MUST carry a
    // pathRelativeToDocumentStorage so its files live at documentStorageURL/<path> (that's what makes
    // root-detection in the extension work, and it's how iSH does it). Deprecated initializer, but the
    // old model requires it and it still ships.
    static let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier("Bootbox"),
                                             displayName: "Bootbox",
                                             pathRelativeToDocumentStorage: "Bootbox")

    private static let buildKey = "BootboxFileProviderRegisteredBuild"

    /// Add the domain. On an app-VERSION change we first REMOVE then re-add it — because once iOS's
    /// fileproviderd has throttled/paused a domain (the old "Syncing Paused" loop), shipping corrected
    /// extension code does NOT clear that state; the daemon keeps the domain paused until it is
    /// removed and re-added. Removing the domain does NOT touch the underlying files in importsDir —
    /// only the Files-app view — so re-adding simply re-enumerates them cleanly.
    static func register() {
        let current = (Bundle.main.infoDictionary?["CFBundleVersion"] as? String) ?? "?"
        let last = UserDefaults.standard.string(forKey: buildKey)
        if last != current {
            // New install / update → nuke and re-add for a clean daemon state.
            NSFileProviderManager.remove(domain) { _ in
                NSFileProviderManager.add(domain) { error in
                    if let error { print("[Bootbox] file provider re-add failed: \(error)") }
                    else { UserDefaults.standard.set(current, forKey: buildKey) }
                }
            }
        } else {
            NSFileProviderManager.add(domain) { error in
                if let error { print("[Bootbox] file provider domain add failed: \(error)") }
            }
        }
    }

    /// Force a clean re-registration on demand (e.g. a "Reset file sync" action if the domain ever
    /// gets stuck again). Same remove→add reset, independent of the build number.
    static func forceReset() {
        NSFileProviderManager.remove(domain) { _ in
            NSFileProviderManager.add(domain) { _ in
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { signalChange() }
            }
        }
    }

    /// Tell the Files app to re-enumerate after the app adds/changes a file in the shared imports
    /// folder (downloads, gunzip, imports). Without this the Files app keeps showing the enumeration
    /// it cached when the folder was empty.
    static func signalChange() {
        guard let mgr = NSFileProviderManager(for: domain) else { return }
        mgr.signalEnumerator(for: .rootContainer) { _ in }
        mgr.signalEnumerator(for: .workingSet) { _ in }
    }
}
