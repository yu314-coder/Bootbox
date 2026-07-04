import FileProvider

/// Enumerates the shared imports dir for the OLD `NSFileProviderExtension` model. No sync anchors /
/// change-tracking engine (that's the replicated model, which is exactly what produced the perpetual
/// "Syncing Paused" indicator). iOS re-enumerates on `signalEnumerator`; that's all this needs.
final class FileProviderEnumerator: NSObject, NSFileProviderEnumerator {
    private let container: NSFileProviderItemIdentifier
    private let dir: URL

    init(container: NSFileProviderItemIdentifier, dir: URL) {
        self.container = container
        self.dir = dir
        super.init()
    }

    func invalidate() {}

    /// Files the user should see: skip dotfiles, in-progress downloads (.part), and the emulator's
    /// download-on-demand engine caches (.data.gz / .wasm.gz) that also live in importsDir.
    static func visibleNames(in dir: URL) -> [String] {
        (((try? FileManager.default.contentsOfDirectory(atPath: dir.path)) ?? []).filter {
            !$0.hasPrefix(".") && !$0.hasSuffix(".part") && !$0.hasSuffix(".data.gz") && !$0.hasSuffix(".wasm.gz")
        }).sorted()
    }

    func enumerateItems(for observer: NSFileProviderEnumerationObserver, startingAt page: NSFileProviderPage) {
        // Only the root container has children (flat drop folder). Working set / others → empty.
        guard container == .rootContainer else {
            FPDiag.log("enumItems \(container.rawValue) count=0 (non-root)")
            observer.didEnumerate([]); observer.finishEnumerating(upTo: nil); return
        }
        let items = Self.visibleNames(in: dir).map { FileProviderItem(identifier: NSFileProviderItemIdentifier($0), dir: dir) }
        FPDiag.log("enumItems root count=\(items.count)")
        observer.didEnumerate(items)
        observer.finishEnumerating(upTo: nil)
    }
}
