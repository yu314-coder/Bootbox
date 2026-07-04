import Foundation

/// Compact parser for Android binary XML (AXML), used to read AndroidManifest.xml
/// out of an APK. Extracts package, version, SDK levels, permissions and the
/// app label. Not a full XML decoder — just the fields a compatibility report needs.
struct AXMLParser {
    struct Result {
        var package = ""
        var versionName = ""
        var versionCode = ""
        var minSdk = ""
        var targetSdk = ""
        var label = ""
        var permissions: [String] = []
        var activities: [String] = []
    }

    let data: Data
    private var strings: [String] = []

    init(data: Data) { self.data = data }

    private func u16(_ o: Int) -> Int { o + 2 <= data.count ? Int(data[o]) | (Int(data[o+1]) << 8) : 0 }
    private func u32(_ o: Int) -> Int {
        o + 4 <= data.count ? Int(data[o]) | (Int(data[o+1]) << 8) | (Int(data[o+2]) << 16) | (Int(data[o+3]) << 24) : 0
    }

    mutating func parse() -> Result {
        var r = Result()
        guard data.count > 8, u16(0) == 0x0003 else { return r } // RES_XML_TYPE

        var pos = 8
        while pos + 8 <= data.count {
            let type = u16(pos)
            let size = u32(pos + 4)
            if size <= 0 { break }
            switch type {
            case 0x0001: parseStringPool(pos)            // RES_STRING_POOL_TYPE
            case 0x0102: parseStartTag(pos, into: &r)    // RES_XML_START_ELEMENT_TYPE
            default: break
            }
            pos += size
        }
        return r
    }

    private mutating func parseStringPool(_ start: Int) {
        let stringCount = u32(start + 8)
        let flags = u32(start + 16)
        let isUTF8 = (flags & 0x100) != 0
        let stringsStart = start + u32(start + 20)
        var offs: [Int] = []
        for i in 0..<stringCount { offs.append(u32(start + 28 + i * 4)) }
        strings = offs.map { off -> String in
            let p = stringsStart + off
            if isUTF8 {
                var q = p
                // skip (possibly 2-byte) char-count, then read u8/u16 byte-len
                func skipLen(_ at: inout Int) -> Int {
                    var len = Int(data[at]); at += 1
                    if len & 0x80 != 0 { len = ((len & 0x7f) << 8) | Int(data[at]); at += 1 }
                    return len
                }
                _ = skipLen(&q)              // char count
                let byteLen = skipLen(&q)    // byte count
                guard q + byteLen <= data.count else { return "" }
                return String(data: data.subdata(in: q..<(q + byteLen)), encoding: .utf8) ?? ""
            } else {
                var len = Int(data[p]) | (Int(data[p+1]) << 8); var q = p + 2
                if len & 0x8000 != 0 { len = ((len & 0x7fff) << 16) | (Int(data[q]) | (Int(data[q+1]) << 8)); q += 2 }
                let byteLen = len * 2
                guard q + byteLen <= data.count else { return "" }
                return String(data: data.subdata(in: q..<(q + byteLen)), encoding: .utf16LittleEndian) ?? ""
            }
        }
    }

    private func str(_ idx: Int) -> String { (idx >= 0 && idx < strings.count) ? strings[idx] : "" }

    private func parseStartTag(_ start: Int, into r: inout Result) {
        // header(8) + lineNo(4) + comment(4) + ns(4) + name(4) + attrStart(2) + attrSize(2) + attrCount(2)...
        let nameIdx = u32(start + 20)
        let tag = str(nameIdx)
        let attrCount = u16(start + 28)
        let attrStart = start + 8 + u16(start + 24) // attributeStart is offset from after header? use fixed
        // Attributes begin at start + 36 in practice (ext header is 20 bytes after the 8-byte chunk header).
        let base = start + 36
        var attrs: [String: (String, Int)] = [:] // name -> (stringValue, intValue)
        for i in 0..<attrCount {
            let a = base + i * 20
            guard a + 20 <= data.count else { break }
            let nameI = u32(a + 4)
            let rawValue = u32(a + 8)
            let typedVal = u32(a + 16)
            let name = str(nameI)
            let sval = rawValue != -1 && rawValue != 0xFFFFFFFF ? str(rawValue) : ""
            attrs[name] = (sval.isEmpty ? "" : sval, typedVal)
        }
        _ = attrStart // (kept for clarity; base offset used directly)

        func s(_ k: String) -> String { attrs[k]?.0 ?? "" }
        func iv(_ k: String) -> String { attrs[k].map { $0.0.isEmpty ? String($0.1) : $0.0 } ?? "" }

        switch tag {
        case "manifest":
            if r.package.isEmpty { r.package = s("package") }
            r.versionName = s("versionName")
            r.versionCode = iv("versionCode")
        case "uses-sdk":
            r.minSdk = iv("minSdkVersion")
            r.targetSdk = iv("targetSdkVersion")
        case "uses-permission":
            let p = s("name"); if !p.isEmpty { r.permissions.append(p) }
        case "application":
            let l = s("label"); if !l.isEmpty { r.label = l }
        case "activity":
            let a = s("name"); if !a.isEmpty { r.activities.append(a) }
        default: break
        }
    }
}
