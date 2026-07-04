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

/// MiniOS Files integration using the OLD, non-replicated `NSFileProviderExtension` — the SAME model
/// iSH uses. The replicated model (NSFileProviderReplicatedExtension) ran iOS's cloud-sync engine,
/// which drew a permanent "Syncing Paused" badge on this purely-local folder and flooded the extension
/// with enumerator calls. This model has no sync engine: iOS shows the files, and fetches a file's
/// content on demand via startProvidingItem. Source of truth is the app-group imports dir; content is
/// materialized into the File Provider's documentStorageURL via a HARD LINK (instant, no 2 GB copy).
final class FileProviderExtension: NSFileProviderExtension {

    private let importsDir: URL = {
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.euleryu.bootbox")
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("MiniOSImports", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()
    private let fm = FileManager.default

    /// Where iOS keeps this domain's placeholders + materialized files.
    private var storageURL: URL {
        var s = NSFileProviderManager.default.documentStorageURL
        if let d = domain { s = s.appendingPathComponent(d.pathRelativeToDocumentStorage, isDirectory: true) }
        return s
    }

    // MARK: - identifier ↔ url

    override func item(for identifier: NSFileProviderItemIdentifier) throws -> NSFileProviderItem {
        if identifier == .rootContainer { return FileProviderItem(identifier: .rootContainer, dir: importsDir) }
        let src = importsDir.appendingPathComponent(identifier.rawValue)
        guard fm.fileExists(atPath: src.path) else {
            FPDiag.log("item(\(identifier.rawValue)) → NO SUCH ITEM")
            throw NSFileProviderError(.noSuchItem)
        }
        return FileProviderItem(identifier: identifier, dir: importsDir)
    }

    override func urlForItem(withPersistentIdentifier identifier: NSFileProviderItemIdentifier) -> URL? {
        if identifier == .rootContainer { return storageURL }
        guard fm.fileExists(atPath: importsDir.appendingPathComponent(identifier.rawValue).path) else { return nil }
        // documentStorageURL/<domain>/<identifier>/<filename> — identifier is the second-to-last path
        // component so persistentIdentifierForItem can recover it.
        return storageURL.appendingPathComponent(identifier.rawValue, isDirectory: true)
                         .appendingPathComponent(identifier.rawValue, isDirectory: false)
    }

    override func persistentIdentifierForItem(at url: URL) -> NSFileProviderItemIdentifier? {
        if url.deletingLastPathComponent() == NSFileProviderManager.default.documentStorageURL {
            return .rootContainer                       // url == storageURL itself
        }
        let comps = url.pathComponents
        guard comps.count >= 2 else { return nil }
        return NSFileProviderItemIdentifier(comps[comps.count - 2])
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
        guard let id = persistentIdentifierForItem(at: url) else {
            completionHandler(NSFileProviderError(.noSuchItem)); return
        }
        let src = importsDir.appendingPathComponent(id.rawValue)
        guard fm.fileExists(atPath: src.path) else { completionHandler(NSFileProviderError(.noSuchItem)); return }
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

    /// The user edited the materialized copy — write it back to the source of truth.
    override func itemChanged(at url: URL) {
        guard let id = persistentIdentifierForItem(at: url), id != .rootContainer else { return }
        let dst = importsDir.appendingPathComponent(id.rawValue)
        try? fm.removeItem(at: dst)
        try? fm.copyItem(at: url, to: dst)
        FPDiag.log("itemChanged \(id.rawValue)")
    }

    override func stopProvidingItem(at url: URL) {
        try? fm.removeItem(at: url)                      // free the materialized copy; re-fetched on demand
    }

    // MARK: - enumeration

    override func enumerator(for containerItemIdentifier: NSFileProviderItemIdentifier) throws -> NSFileProviderEnumerator {
        FPDiag.log("enumerator(\(containerItemIdentifier.rawValue))")
        return FileProviderEnumerator(container: containerItemIdentifier, dir: importsDir)
    }

    // MARK: - writes (drops from other apps / deletes / renames)

    override func importDocument(at fileURL: URL, toParentItemIdentifier parentItemIdentifier: NSFileProviderItemIdentifier,
                                 completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) {
        let needStop = fileURL.startAccessingSecurityScopedResource()
        defer { if needStop { fileURL.stopAccessingSecurityScopedResource() } }
        let dst = importsDir.appendingPathComponent(fileURL.lastPathComponent)
        do {
            if fm.fileExists(atPath: dst.path) { try fm.removeItem(at: dst) }
            try fm.copyItem(at: fileURL, to: dst)
            FPDiag.log("import OK \(dst.lastPathComponent)")
            completionHandler(FileProviderItem(identifier: NSFileProviderItemIdentifier(dst.lastPathComponent), dir: importsDir), nil)
        } catch {
            FPDiag.log("import ERROR: \(error.localizedDescription)")
            completionHandler(nil, error)
        }
    }

    override func deleteItem(withIdentifier itemIdentifier: NSFileProviderItemIdentifier,
                             completionHandler: @escaping (Error?) -> Void) {
        let u = importsDir.appendingPathComponent(itemIdentifier.rawValue)
        do { if fm.fileExists(atPath: u.path) { try fm.removeItem(at: u) }; FPDiag.log("delete OK \(itemIdentifier.rawValue)"); completionHandler(nil) }
        catch { completionHandler(error) }
    }

    override func renameItem(withIdentifier itemIdentifier: NSFileProviderItemIdentifier, toName itemName: String,
                             completionHandler: @escaping (NSFileProviderItem?, Error?) -> Void) {
        let src = importsDir.appendingPathComponent(itemIdentifier.rawValue)
        let dst = importsDir.appendingPathComponent(itemName)
        do {
            if fm.fileExists(atPath: dst.path) { try fm.removeItem(at: dst) }
            try fm.moveItem(at: src, to: dst)
            FPDiag.log("rename OK \(itemIdentifier.rawValue)→\(itemName)")
            completionHandler(FileProviderItem(identifier: NSFileProviderItemIdentifier(itemName), dir: importsDir), nil)
        } catch { completionHandler(nil, error) }
    }
}
