import Foundation

/// Background ISO downloader with progress. The Bootbox BIOS kicks off a large
/// official distro download (Arch ~900 MB, Ubuntu ~1.5 GB); this streams
/// progress to the guest via HostEvents("downloadProgress") and drops the
/// finished file into the shared imports store. Fire-and-forget: the guest is
/// told the download started, then driven by progress events — so it never hits
/// the bridge's short request/reply timeout on a multi-minute transfer.
///
/// Build 64 hardening (the on-device "TypeError: Load failed" rootfs bug): a
/// non-200 response (GitHub rate-limit/404 body) used to be saved AS the file
/// and then treated as cached forever by the existence-only check upstream. Now
/// (a) non-200 downloads are rejected and never land at `dest`, and (b) when the
/// caller supplies the exact expected byte size, a completed file that doesn't
/// match is deleted and reported as a failure — so a poisoned cache self-heals
/// on the next boot instead of bricking the guest.
final class Downloader: NSObject, URLSessionDownloadDelegate {
    private struct Job { let name: String; let dest: URL; let expectedSize: Int64 }
    private var jobs: [Int: Job] = [:]
    private let lock = NSLock()

    private lazy var session: URLSession =
        URLSession(configuration: .default, delegate: self, delegateQueue: nil)

    /// Begin downloading `url` into `dest`, tagging progress events with `name`.
    /// `expectedSize` > 0 enforces the exact final byte count (0 = don't check).
    func start(url: URL, name: String, dest: URL, expectedSize: Int64 = 0) {
        let task = session.downloadTask(with: url)
        lock.lock(); jobs[task.taskIdentifier] = Job(name: name, dest: dest, expectedSize: expectedSize); lock.unlock()
        task.resume()
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64,
                    totalBytesExpectedToWrite: Int64) {
        lock.lock(); let job = jobs[downloadTask.taskIdentifier]; lock.unlock()
        guard let job else { return }
        HostEvents.emit("downloadProgress", [
            "name": job.name,
            "received": totalBytesWritten,
            "total": totalBytesExpectedToWrite,   // -1 if the server omits Content-Length
            "done": false,
        ])
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didFinishDownloadingTo location: URL) {
        lock.lock(); let job = jobs[downloadTask.taskIdentifier]; lock.unlock()
        guard let job else { return }
        // Reject non-200 responses: a GitHub 403/404/429 "succeeds" as a download
        // whose body is a small error page — moving that to `dest` poisons the
        // cache (existence == cached upstream). Leave `dest` absent instead.
        if let http = downloadTask.response as? HTTPURLResponse, http.statusCode != 200 {
            return  // didCompleteWithError reports the failure (dest never appears)
        }
        // The temp file is deleted as soon as this method returns — move it now.
        try? FileManager.default.removeItem(at: job.dest)
        do { try FileManager.default.moveItem(at: location, to: job.dest) }
        catch { try? FileManager.default.copyItem(at: location, to: job.dest) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let id = task.taskIdentifier
        lock.lock(); let job = jobs[id]; jobs[id] = nil; lock.unlock()
        guard let job else { return }
        var ok = (error == nil) && FileManager.default.fileExists(atPath: job.dest.path)
        var why = error?.localizedDescription ?? ""
        if ok, let http = task.response as? HTTPURLResponse, http.statusCode != 200 {
            ok = false; why = "server returned HTTP \(http.statusCode)"
        }
        if ok, job.expectedSize > 0 {
            let got = (try? FileManager.default.attributesOfItem(atPath: job.dest.path))?[.size] as? Int64
            if got != job.expectedSize {
                // Truncated or wrong body — delete so the next boot re-downloads.
                try? FileManager.default.removeItem(at: job.dest)
                ok = false
                why = "size mismatch (got \(got ?? -1), want \(job.expectedSize))"
            }
        }
        if !ok { try? FileManager.default.removeItem(at: job.dest) }
        if ok { DomainRegistrar.signalChange() }   // make the new file show up in Files
        HostEvents.emit("downloadProgress", [
            "name": job.name,
            "done": true,
            "ok": ok,
            "error": ok ? "" : (why.isEmpty ? "download failed" : why),
        ])
    }
}
