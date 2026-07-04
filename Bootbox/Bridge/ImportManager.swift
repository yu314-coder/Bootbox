import Foundation
import FileProvider

/// Handles files opened into Bootbox (from Files, AirDrop, a USB drive, drag-and-
/// drop, or the share sheet). Copies them into the shared imports dir and tells
/// the guest, and signals the FileProvider so they show in the Files app.
enum ImportManager {
    @discardableResult
    static func handle(url: URL) -> Bool {
        let needsStop = url.startAccessingSecurityScopedResource()
        defer { if needsStop { url.stopAccessingSecurityScopedResource() } }

        let dest = VMStorage.importsDir().appendingPathComponent(url.lastPathComponent)
        do {
            if FileManager.default.fileExists(atPath: dest.path) {
                try FileManager.default.removeItem(at: dest)
            }
            try FileManager.default.copyItem(at: url, to: dest)
        } catch {
            // Streaming fallback (security-scoped temp URLs where copyItem fails),
            // chunked so a multi-GB disk image never loads whole into RAM.
            guard let input = InputStream(url: url) else { return false }
            FileManager.default.createFile(atPath: dest.path, contents: nil)
            guard let output = OutputStream(url: dest, append: false) else { return false }
            input.open(); output.open()
            defer { input.close(); output.close() }
            let cap = 1 << 20   // 1 MiB
            var buf = [UInt8](repeating: 0, count: cap)
            while input.hasBytesAvailable {
                let n = input.read(&buf, maxLength: cap)
                if n < 0 { return false }
                if n == 0 { break }
                var written = 0
                while written < n {
                    let w = buf.withUnsafeBufferPointer { output.write($0.baseAddress!.advanced(by: written), maxLength: n - written) }
                    if w <= 0 { return false }
                    written += w
                }
            }
        }
        let name = url.lastPathComponent
        let ext = url.pathExtension.lowercased()
        // Size from filesystem attributes — never load a multi-hundred-MB ISO into RAM.
        let size = ((try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? Int) ?? 0) ?? 0
        HostEvents.emit("file:imported", ["name": name, "ext": ext, "size": size])

        // Let the FileProvider (Files app) reflect the new import.
        let domain = NSFileProviderDomain(identifier: NSFileProviderDomainIdentifier("Bootbox"), displayName: "Bootbox")
        NSFileProviderManager(for: domain)?.signalEnumerator(for: .rootContainer) { _ in }
        return true
    }
}
