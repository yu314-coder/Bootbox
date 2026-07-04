import WebKit
import Foundation

/// Serves large VM resources (ISO/disk images) to the in-page v86 emulator over a
/// custom `vmres://` scheme WITH HTTP range support, so multi-hundred-MB ISOs are
/// streamed in chunks instead of being loaded whole into the WKWebView's memory.
///
/// URL shape:  vmres://iso/<filename>
/// Lookup order:  <Documents>/ISOs/<filename>   then   bundled  web/iso/<filename>
final class ISOSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "vmres"

    private static func resolve(_ url: URL) -> URL? {
        // host == "iso", path == /<filename>
        let name = url.lastPathComponent
        guard !name.isEmpty else { return nil }
        return VMStorage.resolve(name)   // imports (App Group) → Documents/ISOs → snapshots → bundle
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let file = ISOSchemeHandler.resolve(url),
              let handle = try? FileHandle(forReadingFrom: file) else {
            task.didFailWithError(NSError(domain: "vmres", code: 404))
            return
        }
        defer { try? handle.close() }

        let total = (try? FileManager.default.attributesOfItem(atPath: file.path)[.size] as? UInt64) ?? 0 ?? 0
        let mime = "application/octet-stream"

        // Parse optional Range header: "bytes=start-end"
        var start: UInt64 = 0
        var end: UInt64 = total == 0 ? 0 : total - 1
        var partial = false
        if let range = task.request.value(forHTTPHeaderField: "Range"),
           range.hasPrefix("bytes=") {
            let spec = range.dropFirst(6)
            let parts = spec.split(separator: "-", omittingEmptySubsequences: false)
            if let s = parts.first, let sv = UInt64(s) { start = sv; partial = true }
            if parts.count > 1, let e = parts.last, let ev = UInt64(e) { end = ev }
        }
        if total > 0 { end = min(end, total - 1) }
        let length = end >= start ? (end - start + 1) : 0

        var headers: [String: String] = [
            "Accept-Ranges": "bytes",
            "Content-Type": mime,
            "Content-Length": "\(length)",
            "Access-Control-Allow-Origin": "*",
            // Cross-origin JS (v86) must be allowed to READ these, or it can't see
            // the range response and aborts with "Range header not supported".
            "Access-Control-Expose-Headers": "Content-Range, Content-Length, Accept-Ranges, Content-Type",
            "Cross-Origin-Resource-Policy": "cross-origin",
            "Cache-Control": "no-store"
        ]
        var status = 200
        if partial {
            status = 206
            headers["Content-Range"] = "bytes \(start)-\(end)/\(total)"
        }
        let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers)!
        task.didReceive(resp)

        // Stream the requested window in bounded chunks.
        if length > 0 {
            do {
                try handle.seek(toOffset: start)
                var remaining = length
                let chunkSize: UInt64 = 1 << 20   // 1 MiB
                while remaining > 0 {
                    let n = Int(min(chunkSize, remaining))
                    let data = handle.readData(ofLength: n)
                    if data.isEmpty { break }
                    task.didReceive(data)
                    remaining -= UInt64(data.count)
                }
            } catch {
                task.didFailWithError(error); return
            }
        }
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
