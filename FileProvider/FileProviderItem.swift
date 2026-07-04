import FileProvider
import UniformTypeIdentifiers

/// One item in the MiniOS file domain, for the OLD (non-replicated) `NSFileProviderExtension` model —
/// the same model iSH uses, which has NO cloud-sync engine and therefore NO "Syncing Paused" indicator.
///
/// Flat model: the root container's children are the files in the shared imports dir. An item's
/// identifier is its filename ("win98.img"); the root is `.rootContainer`. (Sub-folders are not
/// represented in this first cut — the imports dir is a flat drop folder for disk images / exes.)
final class FileProviderItem: NSObject, NSFileProviderItem {
    let id: NSFileProviderItemIdentifier
    private let dir: URL          // the shared imports dir
    private let isRoot: Bool

    init(identifier: NSFileProviderItemIdentifier, dir: URL) {
        self.id = identifier
        self.dir = dir
        self.isRoot = (identifier == .rootContainer)
        super.init()
    }

    /// The real file backing this item (in the app-group imports dir).
    var sourceURL: URL { isRoot ? dir : dir.appendingPathComponent(id.rawValue) }

    private var rv: URLResourceValues? {
        try? sourceURL.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey])
    }

    var itemIdentifier: NSFileProviderItemIdentifier { id }
    var parentItemIdentifier: NSFileProviderItemIdentifier { .rootContainer }

    var filename: String { isRoot ? "MiniOS" : id.rawValue }

    var typeIdentifier: String {
        if isRoot || (rv?.isDirectory ?? false) { return UTType.folder.identifier }
        return (UTType(filenameExtension: (id.rawValue as NSString).pathExtension) ?? .data).identifier
    }

    var capabilities: NSFileProviderItemCapabilities {
        (isRoot || (rv?.isDirectory ?? false))
            ? [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems, .allowsDeleting, .allowsRenaming]
            : [.allowsReading, .allowsWriting, .allowsDeleting, .allowsRenaming, .allowsReparenting]
    }

    var documentSize: NSNumber? {
        (isRoot || (rv?.isDirectory ?? false)) ? nil : NSNumber(value: rv?.fileSize ?? 0)
    }
    var contentModificationDate: Date? { rv?.contentModificationDate }

    /// Change token = size + mtime, so iOS re-fetches when a file is replaced.
    var versionIdentifier: Data? {
        Data("\(rv?.fileSize ?? 0)-\(Int(rv?.contentModificationDate?.timeIntervalSince1970 ?? 0))".utf8)
    }

    // Local-only provider: content is always available on the device (fetched from importsDir on
    // demand). Reporting it as downloaded/uploaded keeps iOS from showing progress/error chrome.
    var isDownloaded: Bool { true }
    var isMostRecentVersionDownloaded: Bool { true }
    var isUploaded: Bool { true }
}
