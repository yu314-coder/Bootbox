import Foundation
import ExternalAccessory

/// Detects external hardware reachable on iPadOS:
///  - MFi accessories via ExternalAccessory (USB/Lightning/USB-C connect/disconnect events)
///  - External storage volumes (USB drives / SD) that iPadOS has mounted
///
/// Note: iPadOS has no public hot-plug event for generic USB mass storage, so
/// volumes are also polled. MFi accessories DO emit connect/disconnect notes.
final class USBBridge: NSObject {
    private var monitoring = false
    private var pollTimer: Timer?
    private var lastVolumes: Set<String> = []

    func handle(_ action: String, _ payload: [String: Any], _ respond: (Bool, Any?) -> Void) {
        switch action {
        case "start":
            startMonitoring(); respond(true, true)
        case "list":
            respond(true, ["accessories": accessories(), "volumes": externalVolumes()])
        default:
            respond(false, "unknown usb action: \(action)")
        }
    }

    private func startMonitoring() {
        guard !monitoring else { return }
        monitoring = true
        let mgr = EAAccessoryManager.shared()
        mgr.registerForLocalNotifications()
        NotificationCenter.default.addObserver(self, selector: #selector(connected(_:)),
            name: .EAAccessoryDidConnect, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(disconnected(_:)),
            name: .EAAccessoryDidDisconnect, object: nil)

        // Poll external volumes every 3s (no public hot-plug event for these).
        lastVolumes = Set(externalVolumes().map { $0["name"] as? String ?? "" })
        pollTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { [weak self] _ in
            self?.pollVolumes()
        }
    }

    @objc private func connected(_ note: Notification) {
        if let a = note.userInfo?[EAAccessoryKey] as? EAAccessory {
            HostEvents.emit("usb:connect", ["name": a.name, "manufacturer": a.manufacturer, "kind": "accessory"])
        }
    }
    @objc private func disconnected(_ note: Notification) {
        if let a = note.userInfo?[EAAccessoryKey] as? EAAccessory {
            HostEvents.emit("usb:disconnect", ["name": a.name, "kind": "accessory"])
        }
    }

    private func pollVolumes() {
        let current = externalVolumes()
        let names = Set(current.map { $0["name"] as? String ?? "" })
        for added in names.subtracting(lastVolumes) {
            HostEvents.emit("usb:connect", ["name": added, "kind": "volume"])
        }
        for removed in lastVolumes.subtracting(names) {
            HostEvents.emit("usb:disconnect", ["name": removed, "kind": "volume"])
        }
        lastVolumes = names
    }

    private func accessories() -> [[String: Any]] {
        EAAccessoryManager.shared().connectedAccessories.map {
            ["name": $0.name, "manufacturer": $0.manufacturer, "model": $0.modelNumber, "serial": $0.serialNumber]
        }
    }

    /// Mounted external volumes other than the system root (USB drives, SD cards).
    private func externalVolumes() -> [[String: Any]] {
        let keys: [URLResourceKey] = [.volumeNameKey, .volumeIsRemovableKey, .volumeTotalCapacityKey, .volumeAvailableCapacityKey]
        let urls = FileManager.default.mountedVolumeURLs(includingResourceValuesForKeys: keys,
                                                         options: [.skipHiddenVolumes]) ?? []
        return urls.compactMap { url in
            guard let vals = try? url.resourceValues(forKeys: Set(keys)) else { return nil }
            // Skip the app/system sandbox root; report removable / non-internal volumes.
            if vals.volumeIsRemovable == true {
                return [
                    "name": vals.volumeName ?? url.lastPathComponent,
                    "path": url.path,
                    "total": vals.volumeTotalCapacity ?? 0,
                    "free": vals.volumeAvailableCapacity ?? 0,
                ]
            }
            return nil
        }
    }
}
