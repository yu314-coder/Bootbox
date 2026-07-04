import AVFoundation
import UIKit

/// Keeps the app — and with it the WKWebView running the VM — alive when the user switches away, so
/// the guest isn't frozen/killed the instant you check another app. iOS suspends normal apps on
/// background; holding an active audio session under the `audio` background mode (Info.plist) prevents
/// that. We play a continuous *silent* loop (mixWithOthers, so the user's own audio is untouched).
///
/// POWER: the emulator (QEMU-Wasm/TCG) burns ~1 CPU core continuously even at an idle guest prompt.
/// Keeping the app awake in the background therefore drains the battery and heats the device for as
/// long as it stays backgrounded. So the keep-alive is now TIME-LIMITED: it holds the VM for a short
/// grace window after backgrounding (covering quick app-switches), then releases the audio session so
/// iOS suspends the app and the CPU burn stops. The VM is preserved in memory and resumes on return.
/// Grace window = `UserDefaults[BootboxBackgroundGraceSeconds]` (default 60s; 0 = suspend immediately,
/// a large value = stay alive as long as iOS allows, the old always-on behaviour).
final class BackgroundKeepAlive {
    static let shared = BackgroundKeepAlive()

    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private var started = false
    private var releaseTimer: Timer?
    private var active = false        // is the audio session currently held?

    private var graceSeconds: TimeInterval {
        let d = UserDefaults.standard
        // Not-set → default 60. Explicit 0 → immediate suspend.
        return d.object(forKey: "BootboxBackgroundGraceSeconds") as? TimeInterval ?? 60
    }

    private init() {}

    func start() {
        guard !started else { return }
        started = true
        engageSession()
        let nc = NotificationCenter.default
        nc.addObserver(self, selector: #selector(handleInterruption(_:)),
                       name: AVAudioSession.interruptionNotification, object: nil)
        nc.addObserver(self, selector: #selector(didBecomeActive),
                       name: UIApplication.didBecomeActiveNotification, object: nil)
        nc.addObserver(self, selector: #selector(didEnterBackground),
                       name: UIApplication.didEnterBackgroundNotification, object: nil)
        nc.addObserver(self, selector: #selector(willEnterForeground),
                       name: UIApplication.willEnterForegroundNotification, object: nil)
    }

    // MARK: - session lifecycle

    private func engageSession() {
        do {
            let s = AVAudioSession.sharedInstance()
            // .playback + .mixWithOthers: background audio without ducking/stopping the user's audio.
            try s.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try s.setActive(true)
            startSilentLoop()
            active = true
        } catch { NSLog("[KeepAlive] session error: \(error.localizedDescription)") }
    }

    /// Drop the audio session so iOS is free to suspend us → the emulator stops burning CPU.
    private func releaseSession() {
        guard active else { return }
        active = false
        player.stop()
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func startSilentLoop() {
        guard let format = AVAudioFormat(standardFormatWithSampleRate: 44_100, channels: 1),
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 44_100) else { return }
        buffer.frameLength = buffer.frameCapacity   // zero-filled samples == silence
        if engine.attachedNodes.contains(player) == false { engine.attach(player) }
        engine.connect(player, to: engine.mainMixerNode, format: format)
        do {
            try engine.start()
            player.scheduleBuffer(buffer, at: nil, options: .loops, completionHandler: nil)
            player.play()
        } catch { NSLog("[KeepAlive] engine error: \(error.localizedDescription)") }
    }

    // MARK: - app lifecycle

    @objc private func didEnterBackground() {
        releaseTimer?.invalidate()
        let grace = graceSeconds
        if grace <= 0 { releaseSession(); return }   // max power-save: let iOS suspend right away
        // Fire while still awake (the audio session holds us), then drop it so iOS suspends us.
        let t = Timer(timeInterval: grace, repeats: false) { [weak self] _ in self?.releaseSession() }
        RunLoop.main.add(t, forMode: .common)
        releaseTimer = t
    }

    @objc private func willEnterForeground() {
        releaseTimer?.invalidate(); releaseTimer = nil
        if !active { engageSession() }               // re-arm so the next backgrounding is covered
    }

    @objc private func didBecomeActive() {
        releaseTimer?.invalidate(); releaseTimer = nil
        reassert()
    }

    @objc private func handleInterruption(_ note: Notification) {
        guard let info = note.userInfo,
              let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
        if type == .ended { reassert() }
    }

    private func reassert() {
        guard active else { return }                 // don't re-engage if we deliberately released
        do { try AVAudioSession.sharedInstance().setActive(true) } catch {}
        if !engine.isRunning { try? engine.start() }
        if !player.isPlaying { player.play() }
    }
}
