import WebKit
import UIKit

/// Routes a single `host` message channel to the individual native bridges,
/// and forwards one-way host events to the guest.
///
/// Protocol (guest -> host):
///   window.webkit.messageHandlers.host.postMessage({ id, bridge, action, payload })
/// Reply (host -> guest):  window.__hostReply(id, ok, result)
/// Event (host -> guest):  window.__hostEvent(name, payload)
final class BridgeRouter: NSObject, WKScriptMessageHandler, UIGestureRecognizerDelegate {
    weak var webView: WKWebView?
    // Let our trackpad-scroll pan run alongside the WebView's own recognizers (don't steal touches).
    func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    private lazy var files = FilesBridge()
    private lazy var clipboard = ClipboardBridge()
    private lazy var system = SystemBridge()
    private lazy var binary = BinaryBridge()
    private lazy var usb = USBBridge()
    private lazy var media = MediaBridge()
    private lazy var ml = MLBridge()
    private lazy var browser = BrowserBridge()
    private lazy var python = PythonBridge()

    override init() {
        super.init()
        NotificationCenter.default.addObserver(self, selector: #selector(onHostEvent(_:)),
                                               name: HostEvents.notification, object: nil)
    }

    // Trackpad / mouse two-finger scroll → forward to the active guest terminal. The WebView's scrollView
    // is disabled (so touch reaches the emulator), which drops the Magic Keyboard trackpad's INDIRECT
    // scroll gesture — it never becomes a DOM 'wheel' event, so the terminal couldn't scroll with a
    // trackpad. This recognizer (added in HostView, maximumNumberOfTouches=0) fires ONLY for indirect
    // scroll (trackpad/mouse), never touchscreen, so it doesn't disturb the emulator's touch input.
    private var scrollLast: CGFloat = 0
    @objc func handleTrackpadScroll(_ g: UIPanGestureRecognizer) {
        switch g.state {
        case .began:
            scrollLast = 0
        case .changed:
            let y = g.translation(in: g.view).y
            let dy = y - scrollLast
            scrollLast = y
            // natural scrolling: two fingers down (dy>0) → reveal older output (scroll toward history)
            webView?.evaluateJavaScript("window.__trackpadScroll&&window.__trackpadScroll(\(-dy))", completionHandler: nil)
        default:
            scrollLast = 0
        }
    }

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? String,
              let bridge = body["bridge"] as? String,
              let action = body["action"] as? String else {
            return
        }
        let payload = body["payload"] as? [String: Any] ?? [:]
        let respond: (Bool, Any?) -> Void = { [weak self] ok, result in
            self?.reply(id: id, ok: ok, result: result)
        }

        switch bridge {
        case "files":     files.handle(action, payload, respond)
        case "clipboard": clipboard.handle(action, payload, respond)
        case "system":    system.handle(action, payload, presenter: webView, respond: respond)
        case "binary":    binary.handle(action, payload, respond)
        case "usb":       usb.handle(action, payload, respond)
        case "media":     media.handle(action, payload, presenter: webView, respond: respond)
        case "ml":        ml.handle(action, payload, respond)
        case "browser":   browser.handle(action, payload, parent: webView, respond)
        default:          respond(false, "unknown bridge: \(bridge)")
        }
    }

    @objc private func onHostEvent(_ note: Notification) {
        guard let name = note.userInfo?["name"] as? String else { return }
        let payload = note.userInfo?["payload"] as? [String: Any] ?? [:]
        let pj = (try? JSONSerialization.data(withJSONObject: payload)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
        let js = "window.__hostEvent && window.__hostEvent(\(jsonString(name)), \(pj))"
        DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript(js, completionHandler: nil) }
    }

    private func reply(id: String, ok: Bool, result: Any?) {
        var json = "null"
        if let result, let data = try? JSONSerialization.data(withJSONObject: ["v": result]),
           let s = String(data: data, encoding: .utf8) {
            json = s
        } else if let s = result as? String {
            json = "{\"v\":\(jsonString(s))}"
        }
        let js = "window.__hostReply && window.__hostReply(\(jsonString(id)), \(ok), (\(json)).v)"
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript(js, completionHandler: nil)
        }
    }

    private func jsonString(_ s: String) -> String {
        if let d = try? JSONSerialization.data(withJSONObject: [s]),
           let str = String(data: d, encoding: .utf8) {
            return String(str.dropFirst().dropLast())
        }
        return "\"\""
    }
}
