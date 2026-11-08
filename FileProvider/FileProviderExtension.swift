import FileProvider
import UniformTypeIdentifiers

/// On-disk diagnostic log shared with the app (group container → fp-diag.log), read via System.fpdiag.
enum FPDiag {
    static let logURL: URL? = FileManager.default
        .containerURL(forSecurityApplicationGroupIdentifier: "group.com.euleryu.bootbox")?
        .appendingPathComponent("fp-diag.log")
    private static let q = DispatchQueue(label: "com.euleryu.bootbox.fpdiag")
    private static let fmt: DateFormatter = { let f = DateFormatter(); f.dateFormat = "HH:mm:ss"; return f }()
    static func log(_ msg: String) {
        guard let url = logURL else { return }
        q.async {
            var data = ((try? Data(contentsOf: url)) ?? Data()) + Data("\(fmt.string(from: Date())) \(msg)\n".utf8)
            if data.count > 40_000 { data = data.suffix(30_000) }
            try? data.write(to: url)
        }
    }
}

/// Bootbox's Files integration using the OLD, non-replicated `NSFileProviderExtension` - the SAME model
/// iSH uses. The replicated model (NSFileProviderReplicatedExtension) ran iOS's cloud-sync engine,
/// which drew a permanent "Syncing Paused" badge on this purely-local folder and flooded the extension
/// with enumerator calls. This model has no sync engine: iOS shows the files, and fetches a file's
/// content on demand via startProvidingItem. Sources of truth are the app-group folders (FPLayout);
/// content is materialized into the File Provider's documentStorageURL via a HARD LINK (instant, no
/// 2 GB copy).
final class FileProviderExtension: NSFileProviderExtension {
    private let fm = FileManager.default

    /// Where iOS keeps this domain's placeholders + materialized files.
    private var storageURL: URL {
        var s = NSFileProviderManager.default.documentStorageURL
        if let d = domain { s = s.appendingPathComponent(d.pathRelativeToDocumentStorage, isDirectory: true) }
        return s
    }

    private func exists(_ id: NSFileProviderItemIdentifier) -> Bool {
        if id == .rootContainer || FPLayout.isVirtualFolder(id.rawValue) { return true }
        guard let u = FPLayout.url(for: id) else { return false }
        return fm.fileExists(atPath: u.path)
    }

    // MARK: - identifier <-> url

    override func item(for identifier: NSFileProviderItemIdentifier) throws -> NSFileProviderItem {
        guard exists(identifier) else {
            FPDiag.log("item(\(identifier.rawValue)) → NO SUCH ITEM")
            throw NSFileProviderError(.noSuchItem)
        }
        return FileProviderItem(identifier: identifier)
    }

    /// documentStorageURL/<domain>/<identifier, "/" escaped>/<filename> - the identifier is the
    /// second-to-last path component so persistentIdentifierForItem can recover it.
    private static func dirName(_ id: NSFileProviderItemIdentifier) -> String {
        var allowed = CharacterSet.urlPathAllowed; allowed.remove(charactersIn: "/%")
        return id.rawValue.addingPercentEncoding(withAllowedCharacters: allowed) ?? id.rawValue
    }

    override func urlForItem(withPersistentIdentifier identifier: NSFileProviderItemIdentifier) -> URL? {
        if identifier == .rootContainer { return storageURL }
        guard exists(identifier) else { return nil }
        let item = FileProviderItem(identifier: identifier)
        return storageURL.appendingPathComponent(Self.dirName(identifier), isDirectory: true)
                         .appendingPathComponent(item.filename, isDirectory: false)
    }

    override func persistentIdentifierForItem(at url: URL) -> NSFileProviderItemIdentifier? {
        // the domain's own folder (documentStorageURL/<domain>) = the root; compare paths with
        // symlinks resolved and no trailing slash
        func norm(_ u: URL) -> String { u.resolvingSymlinksInPath().standardizedFileURL.path }
        if norm(url) == norm(storageURL) ||
            norm(url.deletingLastPathComponent()) == norm(NSFileProviderManager.default.documentStorageURL) { return .rootContainer }
        let comps = url.pathComponents
        guard comps.count >= 2 else { return nil }
        let enc = comps[comps.count - 2]
        return NSFileProviderItemIdentifier(enc.removingPercentEncoding ?? enc)
    }

    /// Make sure the parent directory (documentStorageURL/<domain>/<identifier>/) exists.
    private func ensureParentDir(_ url: URL) throws {
        let dir = url.deletingLastPathComponent()
        var isDir: ObjCBool = false
        if fm.fileExists(atPath: dir.path, isDirectory: &isDir), !isDir.boolValue { try? fm.removeItem(at: dir) }
        try fm.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    // MARK: - placeholder + content

    override func providePlaceholder(at url: URL, completionHandler: @escaping (Error?) -> Void) {
        guard let id = persistentIdentifierForItem(at: url), let item = try? item(for: id) else {
            completionHandler(NSFileProviderError(.noSuchItem)); return
        }
        do {
            try ensureParentDir(url)
            try NSFileProviderManager.writePlaceholder(at: NSFileProviderManager.placeholderURL(for: url),
                                                       withMetadata: item)
            completionHandler(nil)
        } catch { completionHandler(error) }
    }

    override func startProvidingItem(at url: URL, completionHandler: @escaping (Error?) -> Void) {
        guard let id = persistentIdentifierForItem(at: url), let src = FPLayout.url(for: id),
              fm.fileExists(atPath: src.path) else {
            completionHandler(NSFileProviderError(.noSuchItem)); return
        }
        // Folders (the root, the Bootbox folders, your folders) are browsed through the enumerator:
        // never delete their storage directory (it holds the materialized files beneath it).
        var isDir: ObjCBool = false
        if id == .rootContainer || FPLayout.isVirtualFolder(id.rawValue) ||
            (fm.fileExists(atPath: src.path, isDirectory: &isDir) && isDir.boolValue) {
            try? fm.createDirectory(at: url, withIntermediateDirectories: true)
            completionHandler(nil); return
        }
        FPDiag.log("startProviding \(id.rawValue) size=\((try? src.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)")
        do {
            try ensureParentDir(url)
            if fm.fileExists(atPath: url.path) { try fm.removeItem(at: url) }
            do { try fm.linkItem(at: src, to: url); FPDiag.log("provide OK (link) \(id.rawValue)") }
            catch { try fm.copyItem(at: src, to: url); FPDiag.log("provide OK (copy) \(id.rawValue)") }
            completionHandler(nil)
        } catch {
            FPDiag.log("provide ERROR \(id.rawValue): \(error.localizedDescription)")
            completionHandler(error)
        }
    }

    /// The user edited the materialized copy - write it back to the source of truth (your files only).
    override func itemChanged(at url: URL) {
        guard let id = persistentIdentifierForItem(at: url), FPLayout.isUserItem(id),
              let dst = FPLayout.url(for: id) else { return }
        let a = (try? url.resourceValues(forKeys: [.fileResourceIdentifierKey]))?.fileResourceIdentifier
        let b = (try? dst.resourceValues(forKeys: [.fileResourceIdentifierKey]))?.fileResourceIdentifier
        if let a, let b, a.isEqual(b) { return }        // still the hard-linked file: the edit is already in place
        try? fm.removeItem(at: dst)
        try? fm.copyItem(at: url, to: dst)
        FPDiag.log("itemChanged \(id.rawValue)")
    }

    override func stopProvidingItem(at url: URL) {
        // free a materialized file (re-fetched on demand); folders keep their storage directory
        var isDir: ObjCBool = false
        if fm.fileExists(atPath: url.path, isDirectory: &isDir), !isDir.boolValue { try? fm.removeItem(at: url) }
    }

    // MARK: - enumeration

    override func enumerator(for containerItemIdentifier: NSFileProviderItemIdentifier) throws -> NSFileProviderEnumerator {
        FPDiag.log("enumerator(\(containerItemIdentifier.rawValue))")
        // Folders exist as real (empty) directories in the provider's storage, like iSH's; without them
        // the Files app badged every folder as "not downloaded" (☁︎).
        if containerItemIdentifier != .workingSet {
            for id in FPLayout.children(of: containerItemIdentifier) {
                let it = FileProviderItem(identifier: id)
                guard it.typeIdentifier == UTType.folder.identifier, let u = urlForItem(withPersistentIdentifier: id) else { continue }
                var isDir: ObjCBool = false
                if fm.fileExists(atPath: u.path, isDirectory: &isDir), isDir.boolValue { continue }
                try? ensureParentDir(u)
                try? fm.createDirectory(at: u, withIntermediateDirectories: true)
            }
        }
        return FileProviderEnumerator(container: containerItemIdentifier)
    }

    // MARK: - writes (drops from other apps, new folders, deletes, renames, moves)

    private static let readOnly = NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError,
                                          userInfo: [NSLocalizedDescriptionKey: "Bootbox manages this folder."])

    override func importDocument(at fileURL: URL, toParentItemIdentifier parentItemIdentifier: NSFileProviderItemIdentifier,
                                 completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) {
        guard FPLayout.acceptsChildren(parentItemIdentifier), let dir = FPLayout.url(for: parentItemIdentifier) else {
            completionHandler(nil, Self.readOnly); return
        }
        let needStop = fileURL.startAccessingSecurityScopedResource()
        defer { if needStop { fileURL.stopAccessingSecurityScopedResource() } }
        let name = fileURL.lastPathComponent
        let dst = dir.appendingPathComponent(name)
        do {
            if fm.fileExists(atPath: dst.path) { try fm.removeItem(at: dst) }
            try fm.copyItem(at: fileURL, to: dst)
            let id = FPLayout.child(name, of: parentItemIdentifier)
            FPDiag.log("import OK \(id.rawValue)")
            // a system-named file dropped at the top shows up under System Images
            completionHandler(FileProviderItem(identifier: parentItemIdentifier == .rootContainer && FPLayout.isSystemFile(name)
                                               ? NSFileProviderItemIdentifier("@system/" + name) : id), nil)
        } catch {
            FPDiag.log("import ERROR: \(error.localizedDescription)")
            completionHandler(nil, error)
        }
    }

    override func createDirectory(withName directoryName: String, inParentItemIdentifier parentItemIdentifier: NSFileProviderItemIdentifier,
                                  completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) {
        guard FPLayout.acceptsChildren(parentItemIdentifier), let dir = FPLayout.url(for: parentItemIdentifier),
              !directoryName.contains("/"), !FPLayout.isHidden(directoryName) else {
            completionHandler(nil, Self.readOnly); return
        }
        let dst = dir.appendingPathComponent(directoryName, isDirectory: true)
        if fm.fileExists(atPath: dst.path) { completionHandler(nil, NSFileProviderError(.filenameCollision)); return }
        do {
            try fm.createDirectory(at: dst, withIntermediateDirectories: false)
            FPDiag.log("mkdir OK \(FPLayout.child(directoryName, of: parentItemIdentifier).rawValue)")
            completionHandler(FileProviderItem(identifier: FPLayout.child(directoryName, of: parentItemIdentifier)), nil)
        } catch { completionHandler(nil, error) }
    }

    override func deleteItem(withIdentifier itemIdentifier: NSFileProviderItemIdentifier,
                             completionHandler: @escaping (Error?) -> Void) {
        guard itemIdentifier != .rootContainer, !FPLayout.isVirtualFolder(itemIdentifier.rawValue),
              let u = FPLayout.url(for: itemIdentifier) else { completionHandler(Self.readOnly); return }
        do {
            if fm.fileExists(atPath: u.path) { try fm.removeItem(at: u) }
            FPDiag.log("delete OK \(itemIdentifier.rawValue)")
            completionHandler(nil)
        } catch { completionHandler(error) }
    }

    /// Rename and/or move one of your own files or folders (Bootbox's files keep their names - the app
    /// finds them by name).
    private func move(_ id: NSFileProviderItemIdentifier, to parent: NSFileProviderItemIdentifier, name: String,
                      _ completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) {
        guard FPLayout.isUserItem(id), let src = FPLayout.url(for: id), FPLayout.acceptsChildren(parent),
              let dir = FPLayout.url(for: parent), !name.contains("/"), !FPLayout.isHidden(name) else {
            completionHandler(nil, Self.readOnly); return
        }
        let dst = dir.appendingPathComponent(name)
        if dst.standardizedFileURL.path.hasPrefix(src.standardizedFileURL.path + "/") {
            completionHandler(nil, Self.readOnly); return            // a folder into itself
        }
        do {
            if dst.standardizedFileURL != src.standardizedFileURL {
                if fm.fileExists(atPath: dst.path) { completionHandler(nil, NSFileProviderError(.filenameCollision)); return }
                try fm.moveItem(at: src, to: dst)
            }
            let newID = FPLayout.child(name, of: parent)
            FPDiag.log("move OK \(id.rawValue)→\(newID.rawValue)")
            completionHandler(FileProviderItem(identifier: parent == .rootContainer && FPLayout.isSystemFile(name)
                                               ? NSFileProviderItemIdentifier("@system/" + name) : newID), nil)
        } catch { completionHandler(nil, error) }
    }

    override func renameItem(withIdentifier itemIdentifier: NSFileProviderItemIdentifier, toName itemName: String,
                             completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) {
        move(itemIdentifier, to: FPLayout.parent(of: itemIdentifier), name: itemName, completionHandler)
    }

    override func reparentItem(withIdentifier itemIdentifier: NSFileProviderItemIdentifier,
                               toParentItemWithIdentifier parentItemIdentifier: NSFileProviderItemIdentifier,
                               newName: String?, completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) {
        move(itemIdentifier, to: parentItemIdentifier,
             name: newName ?? (itemIdentifier.rawValue as NSString).lastPathComponent, completionHandler)
    }
}
