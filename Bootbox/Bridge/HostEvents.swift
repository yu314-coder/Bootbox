import Foundation

/// One-way push channel host -> guest. Native code posts an event; BridgeRouter
/// forwards it to JS as window.__hostEvent(name, payload).
enum HostEvents {
    static let notification = Notification.Name("MiniOSHostEvent")
    static func emit(_ name: String, _ payload: [String: Any] = [:]) {
        NotificationCenter.default.post(name: notification, object: nil,
                                        userInfo: ["name": name, "payload": payload])
    }
}
