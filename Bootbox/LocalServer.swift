import Foundation
import Network

/// Minimal loopback HTTP/1.1 static server (Network.framework) that serves the
/// bundled web runtime with cross-origin-isolation headers (COOP/COEP) + range
/// support. WKWebView grants `crossOriginIsolated` (hence SharedArrayBuffer, which
/// the 64-bit QEMU-Wasm guest needs) for http://127.0.0.1 origins but NOT for
/// custom URL schemes — so we load the app from this server.
final class LocalServer {
    static let shared = LocalServer()
    private var listener: NWListener?
    private(set) var port: UInt16 = 0
    private let queue = DispatchQueue(label: "minios.localserver", attributes: .concurrent)

    private static let webRoot: URL? = {
        if let u = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            return u.deletingLastPathComponent()
        }
        return Bundle.main.url(forResource: "index", withExtension: "html")?.deletingLastPathComponent()
    }()

    /// Starts the server (idempotent) and returns the base URL once bound.
    func start(_ completion: @escaping (URL?) -> Void) {
        if port != 0 { completion(URL(string: "http://127.0.0.1:\(port)/")); return }
        do {
            let params = NWParameters.tcp
            params.requiredInterfaceType = .loopback
            let l = try NWListener(using: params)
            l.newConnectionHandler = { [weak self] conn in self?.handle(conn) }
            l.stateUpdateHandler = { [weak self] state in
                if case .ready = state, let p = l.port?.rawValue {
                    self?.port = p
                    completion(URL(string: "http://127.0.0.1:\(p)/"))
                }
                if case .failed = state { completion(nil) }
            }
            listener = l
            l.start(queue: queue)
        } catch { completion(nil) }
    }

    private func handle(_ conn: NWConnection) {
        conn.start(queue: queue)
        receiveRequest(conn, buffer: Data())
    }

    private func receiveRequest(_ conn: NWConnection, buffer: Data) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, done, err in
            guard let self = self else { return }
            var buf = buffer
            if let d = data { buf.append(d) }
            if let range = buf.range(of: Data("\r\n\r\n".utf8)) {
                let headerData = buf.subdata(in: buf.startIndex..<range.lowerBound)
                let head = String(decoding: headerData, as: UTF8.self)
                // POST/PUT /save/<name> persists a guest save-state into the snapshots
                // store (the in-guest "Save progress" feature). Everything else is GET.
                if head.hasPrefix("POST ") || head.hasPrefix("PUT ") {
                    self.handleUpload(conn, head: head, initialBody: buf.subdata(in: range.upperBound..<buf.endIndex))
                } else {
                    self.respond(conn, requestHead: head)
                }
                return
            }
            if done || err != nil { conn.cancel(); return }
            if buf.count < 64 * 1024 { self.receiveRequest(conn, buffer: buf) } else { conn.cancel() }
        }
    }

    private func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "wasm": return "application/wasm"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "svg": return "image/svg+xml"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }

    private func resolve(_ path: String) -> URL? {
        var rel = path
        if let q = rel.firstIndex(of: "?") { rel = String(rel[rel.startIndex..<q]) }
        rel = rel.removingPercentEncoding ?? rel
        while rel.hasPrefix("/") { rel.removeFirst() }
        if rel.isEmpty { rel = "index.html" }
        guard !rel.contains("..") else { return nil }
        // VM resources (imported ISOs / disks / snapshots) — resolve across all stores.
        if rel.hasPrefix("ISOs/") || rel.hasPrefix("vmres/") {
            if let f = VMStorage.resolve((rel as NSString).lastPathComponent) { return f }
        }
        // 64-bit Linux rootfs is download-on-demand: NOT in the bundle. emulator.js's ensureRootfs()
        // downloads it (BinaryBridge → Downloader) into the imports store on first boot; serve it from
        // there (the gzip-on-the-fly path requests the .data.gz). Returns nil until it's downloaded.
        // Cache filename is size-tagged so a rebuilt image re-downloads instead of size-mismatching
        // load.js (keep in sync with emulator.js ROOTFS_REMOTE.name).
        if rel == "vendor/qemu-aload/qemu-system-x86_64.data.gz" {
            let cached = VMStorage.importsDir().appendingPathComponent("qemu64-v5-rootfs-945742898.data.gz")
            return FileManager.default.fileExists(atPath: cached.path) ? cached : nil
        }
        // ARM64 (aarch64) guest: BOTH the engine wasm and the rootfs are download-on-demand (neither
        // bundled). The gzip-on-the-fly path requests the .wasm.gz / .data.gz; serve the cached files.
        if rel == "vendor/qemu-aarch64/qemu-system-aarch64.wasm.gz" {
            let cached = VMStorage.importsDir().appendingPathComponent("qemu-aarch64-engine-16240484.wasm.gz")
            return FileManager.default.fileExists(atPath: cached.path) ? cached : nil
        }
        if rel == "vendor/qemu-aarch64/qemu-system-aarch64.data.gz" {
            let cached = VMStorage.importsDir().appendingPathComponent("qemu-aarch64-rootfs-265519785.data.gz")
            return FileManager.default.fileExists(atPath: cached.path) ? cached : nil
        }
        // Desktop guest (x86_64, no Wine/browser): rootfs download-on-demand; engine wasm shared from
        // qemu-aload (the page requests ../qemu-aload/...wasm, which normalizes to the bundled one).
        if rel == "vendor/qemu-desktop/qemu-system-x86_64.data.gz" {
            let cached = VMStorage.importsDir().appendingPathComponent("qemu-desktop7-rootfs-711887616.data.gz")
            return FileManager.default.fileExists(atPath: cached.path) ? cached : nil
        }
        // Full Android 12 AOSP x86_64 guest. Its QEMU engine is shared with qemu-aload, while this
        // size-tagged guest pack (system/vendor/product + prepared ext4 userdata) is downloaded once.
        // Keep the filename in sync with emulator.js ROOTFS_REMOTE and qemu-android/load.js.
        if rel == "vendor/qemu-android/qemu-system-x86_64.data.gz" {
            let cached = VMStorage.importsDir().appendingPathComponent("qemu-android64-rootfs-622982112.data.gz")
            return FileManager.default.fileExists(atPath: cached.path) ? cached : nil
        }
        guard let root = LocalServer.webRoot else { return nil }
        let f = root.appendingPathComponent(rel)
        if f.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path),
           FileManager.default.fileExists(atPath: f.path) { return f }
        return nil
    }

    private func respond(_ conn: NWConnection, requestHead: String) {
        let lines = requestHead.split(separator: "\r\n", omittingEmptySubsequences: false).map(String.init)
        guard let reqLine = lines.first else { conn.cancel(); return }
        let parts = reqLine.split(separator: " ")
        guard parts.count >= 2 else { conn.cancel(); return }
        let path = String(parts[1])
        var rangeHeader: String?
        for l in lines.dropFirst() where l.lowercased().hasPrefix("range:") {
            rangeHeader = String(l.dropFirst(6)).trimmingCharacters(in: .whitespaces)
        }

        // Gzip-on-the-fly: if X is missing but a sibling X.gz exists AND the client accepts gzip,
        // serve the .gz with Content-Encoding: gzip — WebKit inflates it transparently on fetch
        // (verified byte-exact via curl). Lets us ship the 587MB rootfs .data as a 209MB .gz
        // (app ~390MB) with NO on-launch inflate and NO doubled disk; load.js does a whole-file
        // fetch() and validates by the inflated arrayBuffer byteLength, so this is invisible to it.
        var gzipEncoded = false
        var resolvedFile = resolve(path)
        if resolvedFile == nil {
            let acceptsGzip = lines.dropFirst().contains { let lc = $0.lowercased(); return lc.hasPrefix("accept-encoding:") && lc.contains("gzip") }
            var bp = path
            if let q = bp.firstIndex(of: "?") { bp = String(bp[bp.startIndex..<q]) }
            if acceptsGzip, let gz = resolve(bp + ".gz") { resolvedFile = gz; gzipEncoded = true; rangeHeader = nil }
        }
        guard let file = resolvedFile,
              let handle = try? FileHandle(forReadingFrom: file) else {
            let body = Data("Not found".utf8)
            send(conn, head: "HTTP/1.1 404 Not Found\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n", body: body, close: true)
            return
        }

        let ext = gzipEncoded ? file.deletingPathExtension().pathExtension : file.pathExtension
        let ct = mime(ext)
        let total = ((try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? UInt64) ?? 0) ?? 0

        var start: UInt64 = 0, end: UInt64 = total == 0 ? 0 : total - 1, partial = false
        if let r = rangeHeader, r.hasPrefix("bytes=") {
            let spec = r.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
            if let s = spec.first, let sv = UInt64(s) { start = sv; partial = true }
            if spec.count > 1, let e = spec.last, let ev = UInt64(e) { end = ev }
        }
        if total > 0 { end = min(end, total - 1) }
        let length = end >= start ? (end - start + 1) : 0

        var head = partial ? "HTTP/1.1 206 Partial Content\r\n" : "HTTP/1.1 200 OK\r\n"
        head += "Content-Type: \(ct)\r\n"
        head += "Content-Length: \(length)\r\n"
        if !gzipEncoded { head += "Accept-Ranges: bytes\r\n" }
        head += "Cross-Origin-Resource-Policy: cross-origin\r\n"
        // COOP/COEP on EVERY response, not just HTML. The 64-bit QEMU-Wasm guest spawns a pthread
        // WORKER loaded from out.js, and WebKit only grants that worker `crossOriginIsolated` (hence
        // SharedArrayBuffer, which it needs to attach the shared WASM memory) when the worker's OWN
        // script response carries COEP. With COEP only on the HTML, the worker silently fails to
        // isolate, hangs at init, and the main thread waits on it forever — the guest freezes right
        // before "runtime initialized" on WKWebView. Reproduced AND fixed on the Mac against a clone
        // of this exact server (Safari boots only once every response carries COEP). COOP is harmless
        // on non-document responses (the spec ignores it there), so blanket-sending all three is safe.
        head += "Cross-Origin-Opener-Policy: same-origin\r\n"
        head += "Cross-Origin-Embedder-Policy: require-corp\r\n"
        if gzipEncoded { head += "Content-Encoding: gzip\r\n" }
        if partial { head += "Content-Range: bytes \(start)-\(end)/\(total)\r\n" }
        head += "Cache-Control: no-store\r\nConnection: close\r\n\r\n"

        // Send headers, then stream the body window in chunks.
        conn.send(content: Data(head.utf8), completion: .contentProcessed { [weak self] _ in
            self?.streamBody(conn, handle: handle, offset: start, remaining: length)
        })
    }

    private func streamBody(_ conn: NWConnection, handle: FileHandle, offset: UInt64, remaining: UInt64) {
        if remaining == 0 { try? handle.close(); conn.send(content: nil, isComplete: true, completion: .contentProcessed { _ in conn.cancel() }); return }
        try? handle.seek(toOffset: offset)
        let chunk = 256 * 1024
        func sendNext(_ off: UInt64, _ left: UInt64) {
            let n = Int(min(UInt64(chunk), left))
            let data = (try? handle.read(upToCount: n)) ?? Data()
            if data.isEmpty { try? handle.close(); conn.cancel(); return }
            let isLast = (left - UInt64(data.count)) == 0
            // Mark the FINAL chunk isComplete:true so NWConnection flushes it and sends a real FIN.
            // The old path closed with conn.cancel() and NO isComplete; cancel() does not wait for
            // pending data, so on a slow link the last 256KB window of a large file (the 559MB
            // rootfs.bin) could be discarded -> the guest hits "Could not open /pack/rootfs.bin" on
            // first boot. With isComplete the bytes + FIN are committed to the transport before the
            // connection is released, draining gracefully. (The .wasm path already buffers around
            // this in run.js; the .data path went through here unprotected.)
            conn.send(content: data, isComplete: isLast, completion: .contentProcessed { err in
                if err != nil { try? handle.close(); conn.cancel(); return }
                if isLast { try? handle.close(); conn.cancel(); return }
                sendNext(off + UInt64(data.count), left - UInt64(data.count))
            })
        }
        sendNext(offset, remaining)
    }

    /// Streams a POST/PUT body to the imports store: `POST /save/<name>` writes the
    /// request body to MiniOSImports/<name> — beside the disk image, so saved states are
    /// visible + deletable in the Files app. Used by the in-guest "Save progress" button,
    /// which captures + gzips the v86 state and POSTs it; the saved `<image>.state.gz` is
    /// then auto-restored on the next boot of that image (and shows up under ⚡ Resume).
    private func handleUpload(_ conn: NWConnection, head: String, initialBody: Data) {
        let lines = head.split(separator: "\r\n", omittingEmptySubsequences: false).map(String.init)
        guard let reqLine = lines.first else { conn.cancel(); return }
        let parts = reqLine.split(separator: " ")
        guard parts.count >= 2 else { conn.cancel(); return }
        var path = String(parts[1])
        if let q = path.firstIndex(of: "?") { path = String(path[path.startIndex..<q]) }
        path = path.removingPercentEncoding ?? path
        guard path.hasPrefix("/save/") else {
            let b = Data("forbidden".utf8)
            send(conn, head: "HTTP/1.1 403 Forbidden\r\nContent-Length: \(b.count)\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", body: b, close: true)
            return
        }
        let name = (path as NSString).lastPathComponent
        guard !name.isEmpty, !name.contains("..") else { conn.cancel(); return }
        var contentLength = 0
        for l in lines.dropFirst() where l.lowercased().hasPrefix("content-length:") {
            contentLength = Int(l.dropFirst(15).trimmingCharacters(in: .whitespaces)) ?? 0
        }
        let dir = VMStorage.importsDir()
        let dest = dir.appendingPathComponent(name)
        let tmp = dir.appendingPathComponent(name + ".part")
        try? FileManager.default.removeItem(at: tmp)
        FileManager.default.createFile(atPath: tmp.path, contents: nil)
        guard let fh = try? FileHandle(forWritingTo: tmp) else { conn.cancel(); return }
        var written = 0
        let finish: () -> Void = {
            try? fh.close()
            try? FileManager.default.removeItem(at: dest)
            try? FileManager.default.moveItem(at: tmp, to: dest)
            DomainRegistrar.signalChange()   // refresh the Files-app listing with the new saved state
            let b = Data("ok".utf8)
            self.send(conn, head: "HTTP/1.1 200 OK\r\nContent-Length: \(b.count)\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n", body: b, close: true)
        }
        if !initialBody.isEmpty { try? fh.write(contentsOf: initialBody); written += initialBody.count }
        if written >= contentLength { finish(); return }
        func recvMore() {
            conn.receive(minimumIncompleteLength: 1, maximumLength: 256 * 1024) { data, _, done, err in
                if let d = data, !d.isEmpty { try? fh.write(contentsOf: d); written += d.count }
                if written >= contentLength { finish(); return }
                if done || err != nil { try? fh.close(); conn.cancel(); return }
                recvMore()
            }
        }
        recvMore()
    }

    private func send(_ conn: NWConnection, head: String, body: Data, close: Bool) {
        var d = Data(head.utf8); d.append(body)
        conn.send(content: d, completion: .contentProcessed { _ in if close { conn.cancel() } })
    }
}
