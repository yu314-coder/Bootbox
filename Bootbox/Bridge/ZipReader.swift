import Foundation
import Compression

/// Minimal, dependency-free ZIP reader. Parses the End-Of-Central-Directory and
/// Central Directory records, then extracts individual entries (STORE + DEFLATE).
/// Enough to read APK contents (it's just a ZIP) without any third-party libs.
struct ZipReader {
    struct Entry { let name: String; let compMethod: UInt16; let compSize: Int; let uncompSize: Int; let localHeaderOffset: Int }

    let data: Data
    private(set) var entries: [Entry] = []

    init?(data: Data) {
        self.data = data
        guard let eocd = Self.findEOCD(data) else { return nil }
        let cdCount = Int(Self.u16(data, eocd + 10))
        var p = Int(Self.u32(data, eocd + 16)) // central directory offset
        for _ in 0..<cdCount {
            guard p + 46 <= data.count, Self.u32(data, p) == 0x02014b50 else { break }
            let method = Self.u16(data, p + 10)
            let compSize = Int(Self.u32(data, p + 20))
            let uncompSize = Int(Self.u32(data, p + 24))
            let nameLen = Int(Self.u16(data, p + 28))
            let extraLen = Int(Self.u16(data, p + 30))
            let commentLen = Int(Self.u16(data, p + 32))
            let lho = Int(Self.u32(data, p + 42))
            let nameData = data.subdata(in: (p + 46)..<(p + 46 + nameLen))
            let name = String(data: nameData, encoding: .utf8) ?? ""
            entries.append(Entry(name: name, compMethod: method, compSize: compSize, uncompSize: uncompSize, localHeaderOffset: lho))
            p += 46 + nameLen + extraLen + commentLen
        }
    }

    func names() -> [String] { entries.map { $0.name } }
    func contains(_ name: String) -> Bool { entries.contains { $0.name == name } }

    /// Extract one entry's bytes (handles STORE and raw DEFLATE).
    func extract(_ name: String) -> Data? {
        guard let e = entries.first(where: { $0.name == name }) else { return nil }
        let lho = e.localHeaderOffset
        guard lho + 30 <= data.count, Self.u32(data, lho) == 0x04034b50 else { return nil }
        let nameLen = Int(Self.u16(data, lho + 26))
        let extraLen = Int(Self.u16(data, lho + 28))
        let dataStart = lho + 30 + nameLen + extraLen
        guard dataStart + e.compSize <= data.count else { return nil }
        let comp = data.subdata(in: dataStart..<(dataStart + e.compSize))
        if e.compMethod == 0 { return comp }                 // STORED
        return Self.inflate(comp, expected: e.uncompSize)     // DEFLATE
    }

    // MARK: - helpers
    private static func inflate(_ input: Data, expected: Int) -> Data? {
        let cap = max(expected, input.count * 4) + 4096
        var out = Data(count: cap)
        let written = out.withUnsafeMutableBytes { dst -> Int in
            input.withUnsafeBytes { src in
                compression_decode_buffer(dst.bindMemory(to: UInt8.self).baseAddress!, cap,
                                          src.bindMemory(to: UInt8.self).baseAddress!, input.count,
                                          nil, COMPRESSION_ZLIB) // raw DEFLATE
            }
        }
        guard written > 0 else { return nil }
        out.removeSubrange(written..<out.count)
        return out
    }
    private static func u16(_ d: Data, _ o: Int) -> UInt16 {
        guard o + 2 <= d.count else { return 0 }
        return UInt16(d[o]) | (UInt16(d[o + 1]) << 8)
    }
    private static func u32(_ d: Data, _ o: Int) -> UInt32 {
        guard o + 4 <= d.count else { return 0 }
        return UInt32(d[o]) | (UInt32(d[o + 1]) << 8) | (UInt32(d[o + 2]) << 16) | (UInt32(d[o + 3]) << 24)
    }
    private static func findEOCD(_ d: Data) -> Int? {
        // EOCD signature 0x06054b50, search backwards from end.
        let sig: [UInt8] = [0x50, 0x4b, 0x05, 0x06]
        if d.count < 22 { return nil }
        var i = d.count - 22
        let lower = max(0, d.count - 22 - 65536)
        while i >= lower {
            if d[i] == sig[0] && d[i+1] == sig[1] && d[i+2] == sig[2] && d[i+3] == sig[3] { return i }
            i -= 1
        }
        return nil
    }
}
