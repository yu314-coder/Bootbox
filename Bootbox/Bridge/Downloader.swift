import Foundation

/// Background ISO downloader with progress. The Bootbox BIOS kicks off a large
/// official distro download (Arch ~900 MB, Ubuntu ~1.5 GB); this streams
/// progress to the guest via HostEvents("downloadProgress") and drops the
/// finished file into the shared imports store. Fire-and-forget: the guest is
/// told the download started, then driven by progress events — so it never hits
/// the bridge's short request/reply timeout on a multi-minute transfer.
final class Downloader: NSObject, URLSessionDownloadDelegate {
    private struct Job { let name: String; let dest: URL }
    private var jobs: [Int: Job] = [:]
    private let lock = NSLock()

    private lazy var session: URLSession =
        URLSession(configuration: .default, delegate: self, delegateQueue: nil)

    /// Begin downloading `url` into `dest`, tagging progress events with `name`.
    func start(url: URL, name: String, dest: URL) {
        let task = session.downloadTask(with: url)
        lock.lock(); jobs[task.taskIdentifier] = Job(name: name, dest: dest); lock.unlock()
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
        // The temp file is deleted as soon as this method returns — move it now.
        try? FileManager.default.removeItem(at: job.dest)
        do { try FileManager.default.moveItem(at: location, to: job.dest) }
        catch { try? FileManager.default.copyItem(at: location, to: job.dest) }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let id = task.taskIdentifier
        lock.lock(); let job = jobs[id]; jobs[id] = nil; lock.unlock()
        guard let job else { return }
        let ok = (error == nil) && FileManager.default.fileExists(atPath: job.dest.path)
        if ok { DomainRegistrar.signalChange() }   // make the new file show up in Files
        HostEvents.emit("downloadProgress", [
            "name": job.name,
            "done": true,
            "ok": ok,
            "error": error?.localizedDescription ?? (ok ? "" : "download failed"),
        ])
    }
}
