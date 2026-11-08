import FileProvider

/// Lists one container of the Bootbox location (see FPLayout) for the OLD `NSFileProviderExtension`
/// model. No sync anchors / change-tracking engine (that's the replicated model, which is exactly what
/// produced the perpetual "Syncing Paused" indicator). iOS re-enumerates on `signalEnumerator`.
final class FileProviderEnumerator: NSObject, NSFileProviderEnumerator {
    private let container: NSFileProviderItemIdentifier

    init(container: NSFileProviderItemIdentifier) {
        self.container = container
        super.init()
    }

    func invalidate() {}

    func enumerateItems(for observer: NSFileProviderEnumerationObserver, startingAt page: NSFileProviderPage) {
        // The working set (device-wide Recents / search) stays empty, as before.
        guard container != .workingSet else {
            observer.didEnumerate([]); observer.finishEnumerating(upTo: nil); return
        }
        let items = FPLayout.children(of: container).map { FileProviderItem(identifier: $0) }
        FPDiag.log("enumItems \(container == .rootContainer ? "root" : container.rawValue) count=\(items.count)")
        observer.didEnumerate(items)
        observer.finishEnumerating(upTo: nil)
    }
}
