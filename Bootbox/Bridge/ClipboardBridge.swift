import UIKit

/// Bridges the MiniOS clipboard to the real iPadOS system pasteboard,
/// so copy/paste works between MiniOS and other iPad apps.
final class ClipboardBridge {
    func handle(_ action: String, _ payload: [String: Any], _ respond: (Bool, Any?) -> Void) {
        switch action {
        case "copy":
            UIPasteboard.general.string = payload["text"] as? String ?? ""
            respond(true, true)
        case "paste":
            respond(true, UIPasteboard.general.string ?? "")
        default:
            respond(false, "unknown clipboard action: \(action)")
        }
    }
}
