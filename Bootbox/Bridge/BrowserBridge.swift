import WebKit
import UIKit

/// Native browser bridge. The MiniOS Browser app runs as a guest UI, but its
/// page content is a REAL WKWebView overlaid on top of the main runtime webview,
/// positioned to match the guest browser window. This sidesteps iframe embedding
/// restrictions (X-Frame-Options / CSP) so sites like Google/YouTube work.
///
/// Guest -> host: browser/open|navigate|setFrame|back|forward|reload|show|hide|close
/// Host  -> guest: window.__hostEvent('browser:state', {id,url,title,canBack,canFwd,loading})
final class BrowserBridge: NSObject, WKNavigationDelegate {
    private weak var parent: WKWebView?
    private var tabs: [String: WKWebView] = [:]
    private var ids: [ObjectIdentifier: String] = [:]

    func handle(_ action: String, _ payload: [String: Any], parent: WKWebView?,
                _ respond: @escaping (Bool, Any?) -> Void) {
        self.parent = parent
        let id = payload["id"] as? String ?? ""
        switch action {
        case "open":
            let wv = makeTab(id: id)
            applyFrame(wv, payload["rect"])
            if let u = url(payload["url"]) { wv.load(URLRequest(url: u)) }
            respond(true, true)
        case "navigate":
            if let wv = tabs[id], let u = url(payload["url"]) { wv.load(URLRequest(url: u)) }
            respond(true, true)
        case "setFrame":
            if let wv = tabs[id] { applyFrame(wv, payload["rect"]) }
            respond(true, true)
        case "back":    tabs[id]?.goBack();    respond(true, true)
        case "forward": tabs[id]?.goForward(); respond(true, true)
        case "reload":  tabs[id]?.reload();    respond(true, true)
        case "show":    tabs[id]?.isHidden = false; respond(true, true)
        case "hide":    tabs[id]?.isHidden = true;  respond(true, true)
        case "close":
            if let wv = tabs[id] { ids[ObjectIdentifier(wv)] = nil; wv.removeFromSuperview(); tabs[id] = nil }
            respond(true, true)
        case "hideAll":
            tabs.values.forEach { $0.isHidden = true }; respond(true, true)
        default: respond(false, "unknown browser action: \(action)")
        }
    }

    private func makeTab(id: String) -> WKWebView {
        if let existing = tabs[id] { return existing }
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.navigationDelegate = self
        wv.allowsBackForwardNavigationGestures = true
        wv.layer.cornerRadius = 0
        DispatchQueue.main.async { self.parent?.addSubview(wv) }
        tabs[id] = wv
        ids[ObjectIdentifier(wv)] = id
        return wv
    }

    private func applyFrame(_ wv: WKWebView, _ rect: Any?) {
        guard let r = rect as? [String: Any] else { return }
        let x = cg(r["x"]), y = cg(r["y"]), w = cg(r["w"]), h = cg(r["h"])
        DispatchQueue.main.async {
            wv.frame = CGRect(x: x, y: y, width: w, height: h)
            if let p = self.parent { p.bringSubviewToFront(wv) }
        }
    }
    private func cg(_ v: Any?) -> CGFloat { CGFloat((v as? NSNumber)?.doubleValue ?? 0) }
    private func url(_ v: Any?) -> URL? {
        guard let s = v as? String else { return nil }
        return URL(string: s)
    }

    // MARK: - report state back to the guest
    private func emit(_ wv: WKWebView, loading: Bool) {
        guard let id = ids[ObjectIdentifier(wv)] else { return }
        HostEvents.emit("browser:state", [
            "id": id,
            "url": wv.url?.absoluteString ?? "",
            "title": wv.title ?? "",
            "canBack": wv.canGoBack,
            "canFwd": wv.canGoForward,
            "loading": loading,
        ])
    }
    func webView(_ wv: WKWebView, didStartProvisionalNavigation n: WKNavigation!) { emit(wv, loading: true) }
    func webView(_ wv: WKWebView, didFinish n: WKNavigation!) { emit(wv, loading: false) }
    func webView(_ wv: WKWebView, didFail n: WKNavigation!, withError e: Error) { emit(wv, loading: false) }
    func webView(_ wv: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { emit(wv, loading: false) }

    // MARK: - downloads -> MiniOS /Downloads
    static func downloadsDir() -> URL {
        let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: "group.com.euleryu.bootbox")
            ?? FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("MiniOSDownloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }

    func webView(_ wv: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if response.canShowMIMEType { decisionHandler(.allow) }
        else { decisionHandler(.download) }   // not displayable -> download it
    }

    func webView(_ wv: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }
}

extension BrowserBridge: WKDownloadDelegate {
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        var dest = BrowserBridge.downloadsDir().appendingPathComponent(suggestedFilename)
        var i = 1
        while FileManager.default.fileExists(atPath: dest.path) {
            let ext = (suggestedFilename as NSString).pathExtension
            let stem = (suggestedFilename as NSString).deletingPathExtension
            dest = BrowserBridge.downloadsDir().appendingPathComponent("\(stem) (\(i))" + (ext.isEmpty ? "" : "." + ext))
            i += 1
        }
        completionHandler(dest)
    }
    func downloadDidFinish(_ download: WKDownload) {
        if let url = download.progress.fileURL ?? nil {
            let size = (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
            HostEvents.emit("download:done", ["name": url.lastPathComponent, "size": size, "path": url.path])
        } else {
            HostEvents.emit("download:done", ["name": "download", "size": 0])
        }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        HostEvents.emit("download:failed", ["error": error.localizedDescription])
    }
}
