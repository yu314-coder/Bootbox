import FileProvider
import UniformTypeIdentifiers

/// What the Bootbox location in the Files app shows, and where each item really lives.
///
///   Bootbox                 your files: the shared imports folder (ISOs, disk images, .exe, .apk, files
///   │                       moved out of the VMs with Save / Share) and any folders you create in it
///   ├── System Images       what Bootbox downloaded itself: the Linux / Android guest images and the
///   │                       one-tap Windows images (they live in the imports folder too; delete one
///   │                       to free space - it is downloaded again on the next boot of that system)
///   ├── Saved States        saved VM progress (MiniOSSnapshots)
///   └── Logs                the app log and the Files-extension log
///
/// Identifiers: a path RELATIVE to the imports folder for your files ("win.iso", "Games/doom.iso"),
/// and "@system", "@states", "@logs" (+ "/<name>") for the three folders above. A plain file name is
/// the same identifier older builds used, so nothing iOS has cached goes stale.
enum FPLayout {
    static let base: URL = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.euleryu.bootbox")
        ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    static let imports = base.appendingPathComponent("MiniOSImports", isDirectory: true)
    static let states = base.appendingPathComponent("MiniOSSnapshots", isDirectory: true)
    static let logs = base.appendingPathComponent("Logs", isDirectory: true)
    static let extensionLog = base.appendingPathComponent("fp-diag.log")

    static let virtualFolders: [(id: String, name: String)] = [
        ("@system", "System Images"), ("@states", "Saved States"), ("@logs", "Logs"),
    ]
    static func isVirtualFolder(_ raw: String) -> Bool { virtualFolders.contains { $0.id == raw } }

    /// Downloaded by Bootbox (guest images, engines, the one-tap Windows images): shown under
    /// System Images instead of among your own files.
    static func isSystemFile(_ n: String) -> Bool {
        n.hasSuffix(".data") || n.hasSuffix(".data.gz") || n.hasSuffix(".wasm.gz") ||
            ["win98.img", "win98.img.gz", "win2000.img", "win2000.img.gz"].contains(n)
    }
    /// Never shown: hidden files, unfinished downloads, names that would clash with the virtual folders.
    static func isHidden(_ n: String) -> Bool { n.hasPrefix(".") || n.hasSuffix(".part") || n.hasPrefix("@") }

    /// The real file or folder behind an identifier (nil = invalid).
    static func url(for id: NSFileProviderItemIdentifier) -> URL? {
        let raw = id.rawValue
        if id == .rootContainer { return imports }
        switch raw {
        case "@system": return imports
        case "@states": return states
        case "@logs": return logs
        default: break
        }
        if let (area, name) = split(raw) {
            guard !name.contains("/"), !name.hasPrefix("."), name != ".." else { return nil }
            switch area {
            case "@system": return imports.appendingPathComponent(name)
            case "@states": return states.appendingPathComponent(name)
            case "@logs": return name == extensionLog.lastPathComponent ? extensionLog : logs.appendingPathComponent(name)
            default: return nil
            }
        }
        let parts = raw.split(separator: "/")
        guard !parts.isEmpty, !parts.contains(where: { $0 == ".." || $0 == "." }) else { return nil }
        return imports.appendingPathComponent(raw)
    }

    /// ("@system", "x.data") for an item inside a virtual folder.
    static func split(_ raw: String) -> (String, String)? {
        guard raw.hasPrefix("@"), let slash = raw.firstIndex(of: "/") else { return nil }
        return (String(raw[..<slash]), String(raw[raw.index(after: slash)...]))
    }

    static func parent(of id: NSFileProviderItemIdentifier) -> NSFileProviderItemIdentifier {
        guard id != .rootContainer, let slash = id.rawValue.lastIndex(of: "/") else { return .rootContainer }
        return NSFileProviderItemIdentifier(String(id.rawValue[..<slash]))
    }

    /// The identifier of `name` inside container `parent`.
    static func child(_ name: String, of parent: NSFileProviderItemIdentifier) -> NSFileProviderItemIdentifier {
        parent == .rootContainer ? NSFileProviderItemIdentifier(name) : NSFileProviderItemIdentifier(parent.rawValue + "/" + name)
    }

    /// Your own files and folders (root and its sub-folders) - everything that isn't Bootbox's.
    static func isUserItem(_ id: NSFileProviderItemIdentifier) -> Bool {
        id != .rootContainer && !id.rawValue.hasPrefix("@")
    }

    /// A container new files may be added to: the root or one of your folders.
    static func acceptsChildren(_ id: NSFileProviderItemIdentifier) -> Bool {
        if id == .rootContainer { return true }
        guard isUserItem(id), let u = url(for: id) else { return false }
        var dir: ObjCBool = false
        return FileManager.default.fileExists(atPath: u.path, isDirectory: &dir) && dir.boolValue
    }

    /// Children of a container, in display order.
    static func children(of container: NSFileProviderItemIdentifier) -> [NSFileProviderItemIdentifier] {
        let fm = FileManager.default
        func names(_ dir: URL) -> [String] { ((try? fm.contentsOfDirectory(atPath: dir.path)) ?? []).sorted() }
        switch container.rawValue {
        case "@system":
            return names(imports).filter { !isHidden($0) && isSystemFile($0) }.map { NSFileProviderItemIdentifier("@system/" + $0) }
        case "@states":
            return names(states).filter { !isHidden($0) }.map { NSFileProviderItemIdentifier("@states/" + $0) }
        case "@logs":
            var n = names(logs).filter { !isHidden($0) }
            if fm.fileExists(atPath: extensionLog.path) { n.append(extensionLog.lastPathComponent) }
            return n.map { NSFileProviderItemIdentifier("@logs/" + $0) }
        default:
            break
        }
        if container == .rootContainer {
            try? fm.createDirectory(at: imports, withIntermediateDirectories: true)
            let mine = names(imports).filter { !isHidden($0) && !isSystemFile($0) }.map { NSFileProviderItemIdentifier($0) }
            return mine + virtualFolders.map { NSFileProviderItemIdentifier($0.id) }
        }
        guard isUserItem(container), let dir = url(for: container) else { return [] }
        return names(dir).filter { !$0.hasPrefix(".") && !$0.hasSuffix(".part") }.map { child($0, of: container) }
    }
}

/// One item in the Bootbox location, for the OLD (non-replicated) `NSFileProviderExtension` model -
/// the same model iSH uses, which has NO cloud-sync engine and therefore NO "Syncing Paused" indicator.
final class FileProviderItem: NSObject, NSFileProviderItem {
    let id: NSFileProviderItemIdentifier
    let sourceURL: URL?
    private let isVirtual: Bool

    init(identifier: NSFileProviderItemIdentifier) {
        self.id = identifier
        self.sourceURL = FPLayout.url(for: identifier)
        self.isVirtual = identifier == .rootContainer || FPLayout.isVirtualFolder(identifier.rawValue)
        super.init()
    }

    private lazy var rv: URLResourceValues? = sourceURL.flatMap {
        try? $0.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey, .creationDateKey])
    }
    private var isFolder: Bool { isVirtual || (rv?.isDirectory ?? false) }

    var itemIdentifier: NSFileProviderItemIdentifier { id }
    var parentItemIdentifier: NSFileProviderItemIdentifier { FPLayout.parent(of: id) }

    var filename: String {
        if id == .rootContainer { return "Bootbox" }
        if let v = FPLayout.virtualFolders.first(where: { $0.id == id.rawValue }) { return v.name }
        return (id.rawValue as NSString).lastPathComponent
    }

    var typeIdentifier: String {
        if isFolder { return UTType.folder.identifier }
        let name = (id.rawValue as NSString).lastPathComponent
        if name.hasSuffix(".log") { return UTType.plainText.identifier }
        return (UTType(filenameExtension: (name as NSString).pathExtension) ?? .data).identifier
    }

    var capabilities: NSFileProviderItemCapabilities {
        if id == .rootContainer { return [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems] }
        if isVirtual { return [.allowsReading, .allowsContentEnumerating] }
        if !FPLayout.isUserItem(id) { return [.allowsReading, .allowsDeleting] }   // Bootbox's own files: open or delete
        return isFolder
            ? [.allowsReading, .allowsContentEnumerating, .allowsAddingSubItems, .allowsDeleting, .allowsRenaming, .allowsReparenting]
            : [.allowsReading, .allowsWriting, .allowsDeleting, .allowsRenaming, .allowsReparenting]
    }

    var documentSize: NSNumber? { isFolder ? nil : NSNumber(value: rv?.fileSize ?? 0) }
    var childItemCount: NSNumber? { isFolder ? NSNumber(value: FPLayout.children(of: id).count) : nil }
    var contentModificationDate: Date? { rv?.contentModificationDate }
    var creationDate: Date? { rv?.creationDate }

    /// Change token = size + mtime, so iOS re-fetches when a file is replaced.
    var versionIdentifier: Data? {
        Data("\(rv?.fileSize ?? 0)-\(Int(rv?.contentModificationDate?.timeIntervalSince1970 ?? 0))".utf8)
    }

    // Local-only provider: content is always available on the device (fetched on demand). Reporting it
    // as downloaded/uploaded keeps iOS from showing progress/error chrome.
    var isDownloaded: Bool { true }
    var isMostRecentVersionDownloaded: Bool { true }
    var isUploaded: Bool { true }
}
