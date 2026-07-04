import Foundation

/// Inspects imported EXE and APK binaries and returns structured reports to the
/// guest. Files live in the shared imports directory (also visible to the File
/// Provider extension). This is inspection/compat-analysis — not execution.
final class BinaryBridge {

    private lazy var downloader = Downloader()

    func handle(_ action: String, _ payload: [String: Any], _ respond: @escaping (Bool, Any?) -> Void) {
        switch action {
        case "list":
            respond(true, Self.importNames())
        case "download":
            // Fetch a distro/ISO into the imports store (Bootbox BIOS first-boot
            // download). Fire-and-forget: reply immediately, then drive the guest
            // with "downloadProgress" events — these transfers take minutes and
            // must not block on the bridge's short request/reply timeout.
            guard let urlStr = payload["url"] as? String, let url = URL(string: urlStr),
                  let name = payload["name"] as? String else { return respond(false, "bad args") }
            let dest = Self.importsDir().appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: dest.path) { return respond(true, ["cached": true, "name": name]) }
            downloader.start(url: url, name: name, dest: dest)
            respond(true, ["started": true, "name": name])
        case "gunzip":
            // Expand a downloaded `.img.gz` (e.g. the GUI Arch image) into a raw
            // `.img` the LocalServer can Range-stream to v86. Fire-and-forget with
            // "gunzipProgress" events, same pattern as download — it's multi-GB.
            guard let srcName = payload["src"] as? String,
                  let dstName = payload["dst"] as? String else { return respond(false, "bad args") }
            let dir = Self.importsDir()
            let srcURL = dir.appendingPathComponent(srcName)
            let dstURL = dir.appendingPathComponent(dstName)
            guard FileManager.default.fileExists(atPath: srcURL.path) else { return respond(false, "source not found") }
            if FileManager.default.fileExists(atPath: dstURL.path) { return respond(true, ["cached": true, "name": dstName]) }
            respond(true, ["started": true, "name": dstName])
            DispatchQueue.global(qos: .utility).async {
                // Inflate into a `.part` temp and atomically rename to the final name
                // only on success. A multi-GB decompress can be interrupted — iOS
                // suspends/kills the app if it is backgrounded mid-stream — and that
                // leaves NO thrown error, so the previous code left a partial `.img`
                // behind. The boot menu then treats that partial file as "cached" and
                // boots it; v86 reads past the short image and throws the WebKit error
                // "Length out of range of buffer" right after GRUB. Keeping the final
                // `.img` absent until the expand completes makes a partial unbootable
                // (the boot menu re-runs gunzip because only `.img.part` exists).
                let partURL = dstURL.appendingPathExtension("part")
                try? FileManager.default.removeItem(at: partURL)
                var last = Date(timeIntervalSince1970: 0)
                do {
                    try GunzipStream.inflate(src: srcURL, dst: partURL) { done, total in
                        let now = Date()
                        if now.timeIntervalSince(last) > 0.25 {
                            last = now
                            HostEvents.emit("gunzipProgress", ["name": dstName, "received": done, "total": total, "done": false])
                        }
                    }
                    try? FileManager.default.removeItem(at: dstURL)
                    try FileManager.default.moveItem(at: partURL, to: dstURL)  // .img appears only when fully expanded
                    try? FileManager.default.removeItem(at: srcURL)   // drop the .gz, keep the raw image
                    DomainRegistrar.signalChange()                    // refresh the Files app listing
                    HostEvents.emit("gunzipProgress", ["name": dstName, "done": true, "ok": true])
                } catch {
                    try? FileManager.default.removeItem(at: partURL)
                    HostEvents.emit("gunzipProgress", ["name": dstName, "done": true, "ok": false, "error": "\(error)"])
                }
            }
        case "inspect":
            guard let name = payload["name"] as? String,
                  let data = Self.readImport(name) else { return respond(false, "file not found") }
            let lower = name.lowercased()
            if lower.hasSuffix(".apk") { respond(true, inspectAPK(data, name)) }
            else if lower.hasSuffix(".exe") { respond(true, inspectEXE(data, name)) }
            else { respond(true, ["kind": "unknown", "name": name, "size": data.count]) }
        case "dex":
            // Return base64 of classes.dex from an APK, for the guest DEX interpreter.
            guard let name = payload["name"] as? String, let data = Self.readImport(name),
                  let zip = ZipReader(data: data), let dex = zip.extract("classes.dex") else {
                return respond(false, "no classes.dex")
            }
            respond(true, ["base64": dex.base64EncodedString(), "size": dex.count])
        case "delete":
            if let name = payload["name"] as? String { try? FileManager.default.removeItem(at: Self.importsDir().appendingPathComponent(name)) }
            respond(true, true)
        default:
            respond(false, "unknown binary action: \(action)")
        }
    }

    // MARK: - APK
    private func inspectAPK(_ data: Data, _ name: String) -> [String: Any] {
        guard let zip = ZipReader(data: data) else {
            return ["kind": "apk", "name": name, "error": "not a valid zip/apk"]
        }
        var manifest = AXMLParser.Result()
        if let axml = zip.extract("AndroidManifest.xml") {
            var p = AXMLParser(data: axml); manifest = p.parse()
        }
        let names = zip.names()
        let nativeLibs = names.filter { $0.hasPrefix("lib/") && $0.hasSuffix(".so") }
        let abis = Set(nativeLibs.compactMap { n -> String? in
            let parts = n.split(separator: "/"); return parts.count >= 2 ? String(parts[1]) : nil
        })
        let hasPlay = manifest.permissions.contains { $0.contains("com.google.android.c2dm") }
            || names.contains { $0.contains("com/google/android/gms") }
        let hasDex = names.contains { $0.hasSuffix(".dex") }
        let supported = nativeLibs.isEmpty && !hasPlay && hasDex

        return [
            "kind": "apk",
            "name": name,
            "package": manifest.package,
            "label": manifest.label,
            "versionName": manifest.versionName,
            "versionCode": manifest.versionCode,
            "minSdk": manifest.minSdk,
            "targetSdk": manifest.targetSdk,
            "permissions": manifest.permissions,
            "activities": manifest.activities,
            "entryCount": names.count,
            "hasDex": hasDex,
            "nativeLibs": Array(abis),
            "usesPlayServices": hasPlay,
            "supported": supported,
            "verdict": supported
                ? "Likely runnable by the future MiniOS APK runtime (DEX present, no native libs, no Play Services)."
                : (nativeLibs.isEmpty ? "Needs Google Play Services — not targetable yet."
                                      : "Uses native .so libraries (\(abis.sorted().joined(separator: ", "))) — not targetable yet."),
        ]
    }

    // MARK: - EXE (PE)
    private func inspectEXE(_ data: Data, _ name: String) -> [String: Any] {
        func u16(_ o: Int) -> Int { o + 2 <= data.count ? Int(data[o]) | (Int(data[o+1]) << 8) : 0 }
        func u32(_ o: Int) -> Int { o + 4 <= data.count ? Int(data[o]) | (Int(data[o+1]) << 8) | (Int(data[o+2]) << 16) | (Int(data[o+3]) << 24) : 0 }

        guard data.count > 0x40, data[0] == 0x4D, data[1] == 0x5A else { // 'MZ'
            return ["kind": "exe", "name": name, "error": "not a PE/EXE (missing MZ header)"]
        }
        let peOff = u32(0x3C)
        guard peOff + 24 <= data.count, u32(peOff) == 0x00004550 else { // 'PE\0\0'
            return ["kind": "exe", "name": name, "error": "DOS stub only — no PE header"]
        }
        let machine = u16(peOff + 4)
        let numSections = u16(peOff + 6)
        let optMagic = u16(peOff + 24)
        let isPE32Plus = optMagic == 0x20b
        let subsystem = u16(peOff + 24 + (isPE32Plus ? 68 : 68))
        let machineName: String = {
            switch machine {
            case 0x14c: return "x86 (i386)"
            case 0x8664: return "x86-64 (AMD64)"
            case 0xaa64: return "ARM64"
            case 0x1c0, 0x1c4: return "ARM"
            default: return String(format: "0x%04x", machine)
            }
        }()
        let subsystemName: String = {
            switch subsystem {
            case 2: return "Windows GUI"
            case 3: return "Windows Console"
            default: return "subsystem \(subsystem)"
            }
        }()
        // Section names
        let sectTableOff = peOff + 24 + u16(peOff + 20)
        var sections: [String] = []
        for i in 0..<min(numSections, 16) {
            let so = sectTableOff + i * 40
            if so + 8 <= data.count {
                let nm = String(data: data.subdata(in: so..<(so+8)), encoding: .ascii)?
                    .trimmingCharacters(in: CharacterSet(charactersIn: "\0 ")) ?? ""
                if !nm.isEmpty { sections.append(nm) }
            }
        }
        return [
            "kind": "exe",
            "name": name,
            "format": isPE32Plus ? "PE32+" : "PE32",
            "machine": machineName,
            "subsystem": subsystemName,
            "sections": sections,
            "size": data.count,
            "supported": false,
            "verdict": "Windows PE binary. Local x86 execution is out of scope on iPad; a tiny Win32 console subset is a later phase, heavy apps go to the cloud fallback.",
        ]
    }

    // MARK: - shared imports dir
    static func importsDir() -> URL { VMStorage.importsDir() }
    static func importNames() -> [String] {
        ((try? FileManager.default.contentsOfDirectory(atPath: importsDir().path)) ?? []).sorted()
    }
    static func readImport(_ name: String) -> Data? {
        try? Data(contentsOf: importsDir().appendingPathComponent(name))
    }
}
