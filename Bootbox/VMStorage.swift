import Foundation

/// Single source of truth for where VM resources (ISOs, disks, snapshots) live,
/// shared by the app, the URL-scheme handlers, the loopback server, and the
/// FileProvider extension. Fixes the prior split where imports landed in the
/// App Group container but the emulator only looked in <Documents>/ISOs.
enum VMStorage {
    static let appGroupID = "group.com.euleryu.bootbox"

    /// App Group container (shared with the FileProvider extension). Falls back
    /// to Documents if the group is unavailable.
    static func container() -> URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupID)
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    }

    /// Where imported ISOs/files live (visible to Files via the FileProvider ext).
    static func importsDir() -> URL {
        let d = container().appendingPathComponent("MiniOSImports", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    /// Legacy/in-app ISO drop location.
    static func docsISOsDir() -> URL {
        let d = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ISOs", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    /// Persisted VM state snapshots (per-guest .state.gz written at runtime).
    static func snapshotsDir() -> URL {
        let d = container().appendingPathComponent("MiniOSSnapshots", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    /// Resolve a VM resource by filename across every location, in priority order:
    /// imported (App Group) → Documents/ISOs → snapshots → bundled web/iso.
    static func resolve(_ name: String, bundleSubdir: String? = "web/iso") -> URL? {
        let fm = FileManager.default
        for c in [importsDir().appendingPathComponent(name),
                  docsISOsDir().appendingPathComponent(name),
                  snapshotsDir().appendingPathComponent(name)] where fm.fileExists(atPath: c.path) {
            return c
        }
        if let sub = bundleSubdir,
           let b = Bundle.main.url(forResource: name, withExtension: nil, subdirectory: sub) { return b }
        return nil
    }

    /// All importable/bootable resources (for the distro picker / boot menu).
    static func listImports() -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: importsDir().path)) ?? [])
            .filter { !$0.hasPrefix(".") }.sorted()
    }

    /// Delete stale `*.part` temp files (interrupted decompresses) so the Files app isn't
    /// cluttered with half-written images. Safe to call at launch — no decompress is in
    /// flight then (the gunzip is only kicked off later from the boot menu).
    static func cleanupStale() {
        let dir = importsDir()
        for n in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? [] where n.hasSuffix(".part") {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(n))
        }
    }
}
