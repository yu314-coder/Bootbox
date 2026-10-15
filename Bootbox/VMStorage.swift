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
        for n in (try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []
            where n.hasSuffix(".part") || supersededPacks.contains(n) {
            try? FileManager.default.removeItem(at: dir.appendingPathComponent(n))
        }
    }

    /// Downloaded guest packs that a newer, differently-named pack replaced. Nothing references
    /// them any more, so they are only dead weight in the imports folder (~1 GB each).
    private static let supersededPacks: Set<String> = [
        "qemu-android64-warm-2163449947.data.gz",   // Android v3, single-core (build 82-83) → v4 quad-core
        "qemu-android64-warm-2163449947.data",
        "qemu-desktop7-rootfs-711887616.data.gz",   // desktop v7 (twm) → v8 openbox (build 93)
        "qemu-desktop7-rootfs-711887616.data",      //   expanded form (lazy packs, build 87+)
        "qemu-desktop8-rootfs-693375940.data.gz",   // desktop v8 → v9 (build 95)
        "qemu-desktop8-rootfs-693375940.data",
        "qemu-desktop9-rootfs-1300120755.data.gz",  // desktop v9 (its X server never started) → 9b (build 96)
        "qemu-desktop9-rootfs-1300120755.data",
        "qemu-desktop9b-rootfs-1301136108.data.gz", // desktop 9b → v10 (bash terminal, WebKit browser, no Claude Code)
        "qemu-desktop9b-rootfs-1301136108.data",
        "qemu-android64-warm4-2038076444.data.gz",  // Android v4 → v5 (build 93)
        "qemu-android64-warm4-2038076444.data",
        "qemu-android64-warm5-2161126625.data.gz",  // Android v5 → v6 (build 95)
        "qemu-android64-warm5-2161126625.data",
    ]
}
