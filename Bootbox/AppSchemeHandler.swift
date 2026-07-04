import WebKit
import Foundation

/// Serves the entire bundled web runtime over a custom `miniapp://` scheme so the
/// host page is CROSS-ORIGIN ISOLATED (COOP + COEP headers) — which enables
/// SharedArrayBuffer, required by the 64-bit QEMU-Wasm guest's pthreads. It also
/// supports HTTP range requests so large assets (wasm/data/iso, tens–hundreds of
/// MB) stream in chunks instead of loading whole into memory, and tags every
/// response with CORP so COEP allows it.
///
/// URL shape:  miniapp://app/<path-relative-to-bundled-web-dir>
/// Also resolves <Documents>/ISOs/<name> for downloaded images.
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "miniapp"
    static let indexURL = "\(scheme)://app/index.html"

    private static let webRoot: URL? = {
        if let u = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "web") {
            return u.deletingLastPathComponent()
        }
        return Bundle.main.url(forResource: "index", withExtension: "html")?.deletingLastPathComponent()
    }()

    private static func mime(_ ext: String) -> String {
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
        case "woff": return "font/woff"
        case "ttf": return "font/ttf"
        default: return "application/octet-stream"
        }
    }

    private static func resolve(_ url: URL) -> URL? {
        // Strip leading slash; reject path traversal.
        var rel = url.path
        while rel.hasPrefix("/") { rel.removeFirst() }
        if rel.isEmpty { rel = "index.html" }
        guard !rel.contains("..") else { return nil }

        // Downloaded ISOs live in the app container.
        if rel.hasPrefix("ISOs/") {
            let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            let f = docs.appendingPathComponent(rel)
            if FileManager.default.fileExists(atPath: f.path) { return f }
        }
        guard let root = webRoot else { return nil }
        let f = root.appendingPathComponent(rel)
        // Confine to the web root.
        if f.standardizedFileURL.path.hasPrefix(root.standardizedFileURL.path),
           FileManager.default.fileExists(atPath: f.path) {
            return f
        }
        return nil
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let file = AppSchemeHandler.resolve(url),
              let handle = try? FileHandle(forReadingFrom: file) else {
            task.didFailWithError(NSError(domain: "miniapp", code: 404)); return
        }
        defer { try? handle.close() }

        let ext = file.pathExtension
        let mime = AppSchemeHandler.mime(ext)
        let total = ((try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? UInt64) ?? 0) ?? 0
        let isHTML = (mime.hasPrefix("text/html"))

        var start: UInt64 = 0
        var end: UInt64 = total == 0 ? 0 : total - 1
        var partial = false
        if let range = task.request.value(forHTTPHeaderField: "Range"), range.hasPrefix("bytes=") {
            let parts = range.dropFirst(6).split(separator: "-", omittingEmptySubsequences: false)
            if let s = parts.first, let sv = UInt64(s) { start = sv; partial = true }
            if parts.count > 1, let e = parts.last, let ev = UInt64(e) { end = ev }
        }
        if total > 0 { end = min(end, total - 1) }
        let length = end >= start ? (end - start + 1) : 0

        var headers: [String: String] = [
            "Content-Type": mime,
            "Content-Length": "\(length)",
            "Accept-Ranges": "bytes",
            // Cross-origin isolation: COOP+COEP on EVERY response (not just the document) so the
            // QEMU-Wasm pthread worker (out.js) is itself cross-origin-isolated and gets
            // SharedArrayBuffer — otherwise it hangs at init. See LocalServer.swift for the full
            // diagnosis (reproduced + fixed on the Mac). COOP is harmlessly ignored on sub-resources.
            "Cross-Origin-Resource-Policy": "cross-origin",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-store"
        ]
        _ = isHTML
        var status = 200
        if partial { status = 206; headers["Content-Range"] = "bytes \(start)-\(end)/\(total)" }
        let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(resp)

        if length > 0 {
            do {
                try handle.seek(toOffset: start)
                var remaining = length
                let chunk: UInt64 = 1 << 20
                while remaining > 0 {
                    let n = Int(min(chunk, remaining))
                    let data = handle.readData(ofLength: n)
                    if data.isEmpty { break }
                    task.didReceive(data)
                    remaining -= UInt64(data.count)
                }
            } catch { task.didFailWithError(error); return }
        }
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
