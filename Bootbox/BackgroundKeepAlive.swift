import UIKit

/// Lets a running guest finish what it is doing for a short while after the user switches away, then
/// lets iOS suspend the app (the guest pauses in memory and resumes on return).
///
/// App Store (guideline 2.5.4): background modes may only serve their real purpose, so the old silent
/// audio loop (`audio` background mode, which kept the guest computing indefinitely) is gone. What is left
/// is a standard background task: iOS grants roughly 30 s, ended early when the app returns.
/// Grace = `UserDefaults[BootboxBackgroundGraceSeconds]` (UEFI Setup -> Advanced -> Run in Background):
/// 0 = pause right away, anything else = the short background task.
final class BackgroundKeepAlive {
    static let shared = BackgroundKeepAlive()

    private var started = false
    private var task: UIBackgroundTaskIdentifier = .invalid

    private var graceSeconds: TimeInterval {
        UserDefaults.standard.object(forKey: "BootboxBackgroundGraceSeconds") as? TimeInterval ?? 30
    }

    private init() {}

    func start() {
        guard !started else { return }
        started = true
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(didEnterBackground),
                       name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(willEnterForeground),
                       name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    /// The background-grace setting changed (from UEFI Setup). If we're currently backgrounded, re-apply it.
    func reschedule() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.started else { return }
            if UIApplication.shared.applicationState == .background { self.didEnterBackground() }
        }
    }

    @objc private func didEnterBackground() {
        if graceSeconds <= 0 { endTask(); return }        // pause right away
        guard task == .invalid else { return }
        task = UIApplication.shared.beginBackgroundTask(withName: "Bootbox guest") { [weak self] in
            self?.endTask()                               // iOS's time is up: let it suspend us
        }
    }

    @objc private func willEnterForeground() {
        endTask()
    }

    private func endTask() {
        guard task != .invalid else { return }
        UIApplication.shared.endBackgroundTask(task)
        task = .invalid
    }
}
