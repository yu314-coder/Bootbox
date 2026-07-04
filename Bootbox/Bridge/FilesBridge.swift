import Foundation

/// Persistent storage for the MiniOS virtual disk, mapped into the app's
/// Documents directory. The guest never sees real iPadOS paths — it asks the
/// host to read/write opaque keys under a sandboxed "disk" folder.
final class FilesBridge {
    private let root: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let disk = docs.appendingPathComponent("MiniOSDisk", isDirectory: true)
        try? FileManager.default.createDirectory(at: disk, withIntermediateDirectories: true)
        return disk
    }()

    func handle(_ action: String, _ payload: [String: Any], _ respond: (Bool, Any?) -> Void) {
        switch action {
        case "read":
            guard let key = payload["key"] as? String else { return respond(false, "missing key") }
            let url = file(key)
            if let data = try? Data(contentsOf: url), let s = String(data: data, encoding: .utf8) {
                respond(true, s)
            } else {
                respond(true, NSNull())
            }
        case "write":
            guard let key = payload["key"] as? String,
                  let value = payload["value"] as? String else { return respond(false, "missing key/value") }
            do {
                try value.data(using: .utf8)?.write(to: file(key), options: .atomic)
                respond(true, true)
            } catch { respond(false, error.localizedDescription) }
        case "delete":
            guard let key = payload["key"] as? String else { return respond(false, "missing key") }
            try? FileManager.default.removeItem(at: file(key))
            respond(true, true)
        case "list":
            let names = (try? FileManager.default.contentsOfDirectory(atPath: root.path)) ?? []
            respond(true, names.map { $0.removingPercentEncoding ?? $0 })
        default:
            respond(false, "unknown files action: \(action)")
        }
    }

    private func file(_ key: String) -> URL {
        let safe = key.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? key
        return root.appendingPathComponent(safe)
    }
}
