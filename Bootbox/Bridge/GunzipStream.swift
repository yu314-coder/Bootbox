import Foundation
import Compression

// Streaming gunzip for the large hosted disk images (e.g. the GUI Arch build is
// shipped as `archgui.img.gz` to keep the download small, then expanded to a raw
// `.img` that the loopback LocalServer streams to v86 via Range requests).
//
// Multi-GB images can't be held in RAM, so this reads the `.gz` and writes the
// raw image in fixed-size chunks. Apple's Compression framework decodes *raw*
// DEFLATE (RFC 1951) with `COMPRESSION_ZLIB` + `COMPRESSION_STREAM_DECODE`; a
// gzip member is a small header followed by exactly that raw DEFLATE stream
// (then an 8-byte CRC32/ISIZE trailer we don't need), so we parse and skip the
// gzip header, then feed the remaining raw DEFLATE straight to the decoder.
enum GunzipStream {

    enum GunzipError: Error { case notGzip, badHeader, decodeFailed, ioError }

    // Decompress `src` (.gz) into `dst` (raw). `progress` is called with
    // (compressedBytesConsumed, compressedTotal). Runs synchronously -- call it
    // off the main queue.
    static func inflate(src: URL, dst: URL,
                        progress: ((Int64, Int64) -> Void)? = nil) throws {
        let fm = FileManager.default
        let totalIn = ((try? fm.attributesOfItem(atPath: src.path))?[.size] as? Int64) ?? 0

        guard let input = InputStream(url: src) else { throw GunzipError.ioError }
        input.open(); defer { input.close() }

        fm.createFile(atPath: dst.path, contents: nil)
        guard let out = FileHandle(forWritingAtPath: dst.path) else { throw GunzipError.ioError }
        defer { try? out.close() }

        let cap = 1 << 20                                // 1 MiB buffers

        // srcBuf may need to grow to hold a pathologically large gzip header
        // (e.g. a 64 KiB FEXTRA + long FNAME/FCOMMENT). It starts at `cap` and is
        // only enlarged during header parsing; once decode begins it is reused as
        // a fixed `cap`-sized refill buffer.
        var srcCap = cap
        var srcBuf = UnsafeMutablePointer<UInt8>.allocate(capacity: srcCap)
        let dstBuf = UnsafeMutablePointer<UInt8>.allocate(capacity: cap)
        // NOTE: this deallocate defer is registered BEFORE the compression_stream
        // destroy defer below, so (LIFO) destroy runs first and the buffers the
        // stream points at are still alive when it runs. Do not reorder.
        defer { srcBuf.deallocate(); dstBuf.deallocate() }

        // Total compressed bytes pulled off `input` so far (for progress).
        var consumed: Int64 = 0
        // Number of valid bytes currently buffered at the FRONT of srcBuf.
        var have = 0
        // True once input.read() has returned <= 0 (genuine EOF / error). A SHORT
        // read is NOT EOF and must never set this.
        var srcEOF = false

        // Accumulate bytes into srcBuf (appended after the `have` already buffered)
        // until at least `minBytes` are present or true EOF is hit. Grows srcBuf if
        // needed. EOF is detected ONLY when input.read() returns <= 0.
        func fill(toAtLeast minBytes: Int) {
            while have < minBytes && !srcEOF {
                if have >= srcCap {
                    let newCap = max(srcCap * 2, minBytes, have + cap)
                    let grown = UnsafeMutablePointer<UInt8>.allocate(capacity: newCap)
                    grown.update(from: srcBuf, count: have)
                    srcBuf.deallocate()
                    srcBuf = grown
                    srcCap = newCap
                }
                let r = input.read(srcBuf + have, maxLength: srcCap - have)
                if r > 0 {
                    have += r; consumed += Int64(r)
                } else {
                    srcEOF = true                       // EOF / error: read() returned <= 0
                }
            }
        }

        // --- 1. read + validate the gzip header; leave raw DEFLATE bytes buffered ---

        // Ensure at least `n` bytes are buffered for header parsing; throws if the
        // stream ends before the header is complete.
        func need(_ n: Int) throws {
            if have < n { fill(toAtLeast: n) }
            if have < n { throw GunzipError.badHeader }
        }

        // Fixed 10-byte header + magic/method check.
        fill(toAtLeast: 10)
        guard have >= 10, srcBuf[0] == 0x1f, srcBuf[1] == 0x8b, srcBuf[2] == 0x08 else {
            throw GunzipError.notGzip
        }
        let flg = srcBuf[3]
        var pos = 10                                    // fixed 10-byte header

        if flg & 0x04 != 0 {                            // FEXTRA: 2-byte LE len + data
            try need(pos + 2)
            let xlen = Int(srcBuf[pos]) | (Int(srcBuf[pos + 1]) << 8)
            pos += 2
            try need(pos + xlen)
            pos += xlen
        }
        if flg & 0x08 != 0 {                            // FNAME: NUL-terminated
            while true {
                if pos >= have { try need(pos + 1) }    // pull more if terminator not yet buffered
                if srcBuf[pos] == 0 { pos += 1; break }
                pos += 1
            }
        }
        if flg & 0x10 != 0 {                            // FCOMMENT: NUL-terminated
            while true {
                if pos >= have { try need(pos + 1) }
                if srcBuf[pos] == 0 { pos += 1; break }
                pos += 1
            }
        }
        if flg & 0x02 != 0 {                            // FHCRC: 2 bytes
            try need(pos + 2)
            pos += 2
        }

        // Shift the post-header DEFLATE bytes to the front of srcBuf.
        let avail = have - pos                          // guaranteed >= 0 (have >= pos)
        if avail > 0 { memmove(srcBuf, srcBuf + pos, avail) }
        have = avail

        // --- 2. streaming raw-DEFLATE decode ---

        // Construct with placeholder/zero I/O fields; whether init overwrites the
        // public src/dst fields is unspecified, so we set them AFTER a successful
        // init and before the first process() call.
        var stream = compression_stream(dst_ptr: dstBuf, dst_size: 0,
                                        src_ptr: UnsafePointer(srcBuf), src_size: 0,
                                        state: nil)
        guard compression_stream_init(&stream, COMPRESSION_STREAM_DECODE, COMPRESSION_ZLIB)
                == COMPRESSION_STATUS_OK else { throw GunzipError.decodeFailed }
        defer { compression_stream_destroy(&stream) }

        // Present the header-stripped first chunk to the decoder (post-init).
        stream.src_ptr = UnsafePointer(srcBuf)
        stream.src_size = have

        let FINALIZE = Int32(COMPRESSION_STREAM_FINALIZE.rawValue)
        var flags: Int32 = 0                            // stays 0 until a real EOF read

        while true {
            // Refill the source ONLY when fully drained. Between refills src_ptr /
            // src_size are framework-owned (it advances/decrements them as it
            // consumes); we only ever overwrite srcBuf when src_size == 0, so no
            // unconsumed input can be clobbered. EOF is detected solely by read<=0.
            if stream.src_size == 0 && !srcEOF {
                let r = input.read(srcBuf, maxLength: cap) // srcCap >= cap
                if r > 0 {
                    have = r; consumed += Int64(r)
                    stream.src_ptr = UnsafePointer(srcBuf)
                    stream.src_size = r
                } else {
                    srcEOF = true                       // genuine EOF (read <= 0)
                    flags = FINALIZE
                }
            }

            stream.dst_ptr = dstBuf
            stream.dst_size = cap
            let status = compression_stream_process(&stream, flags)

            let produced = cap - stream.dst_size
            if produced > 0 {
                // Copy out exactly `produced` bytes; the throwing API surfaces a
                // disk-full mid-stream as GunzipError.ioError instead of silently
                // truncating the 4 GB image. (A copy of <=1 MiB is negligible vs
                // the decode, and avoids the bytesNoCopy reuse aliasing footgun.)
                do {
                    try out.write(contentsOf: Data(bytes: dstBuf, count: produced))
                } catch {
                    throw GunzipError.ioError
                }
            }
            progress?(min(consumed, totalIn), totalIn)

            switch status {
            case COMPRESSION_STATUS_END: return         // DEFLATE end-marker; gzip trailer left unconsumed and ignored
            case COMPRESSION_STATUS_OK: continue
            default: throw GunzipError.decodeFailed
            }
        }
    }
}
