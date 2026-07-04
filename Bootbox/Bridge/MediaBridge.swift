import UIKit
import AVFoundation

/// Phase 6 hardware bridge: camera capture, microphone recording, and audio
/// playback — the host mediates real iPadOS APIs on behalf of MiniOS apps.
/// The guest never touches the camera/mic directly; it asks the host, which
/// checks permission and returns results.
final class MediaBridge: NSObject {
    private var photoCompletion: ((Bool, Any?) -> Void)?
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?

    func handle(_ action: String, _ payload: [String: Any],
                presenter: UIView?, respond: @escaping (Bool, Any?) -> Void) {
        switch action {
        case "capturePhoto":  capturePhoto(respond)
        case "recordAudio":   recordAudio(seconds: payload["seconds"] as? Double ?? 4, respond)
        case "stopRecording": stopRecording(respond)
        case "playTone":      playTone(respond)
        case "permissions":   reportPermissions(respond)
        default:              respond(false, "unknown media action: \(action)")
        }
    }

    // MARK: - Camera
    private func topVC() -> UIViewController? {
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        var vc = scene?.keyWindow?.rootViewController
        while let p = vc?.presentedViewController { vc = p }
        return vc
    }

    private func capturePhoto(_ respond: @escaping (Bool, Any?) -> Void) {
        guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
            return respond(false, "camera not available")
        }
        AVCaptureDevice.requestAccess(for: .video) { granted in
            DispatchQueue.main.async {
                guard granted else { return respond(false, "camera permission denied") }
                let picker = UIImagePickerController()
                picker.sourceType = .camera
                picker.delegate = self
                self.photoCompletion = respond
                self.topVC()?.present(picker, animated: true)
            }
        }
    }

    // MARK: - Microphone
    private func requestMic(_ done: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) { AVAudioApplication.requestRecordPermission(completionHandler: done) }
        else { AVAudioSession.sharedInstance().requestRecordPermission(done) }
    }

    private func recordAudio(seconds: Double, _ respond: @escaping (Bool, Any?) -> Void) {
        requestMic { granted in
            DispatchQueue.main.async {
                guard granted else { return respond(false, "microphone permission denied") }
                do {
                    let session = AVAudioSession.sharedInstance()
                    try session.setCategory(.playAndRecord, mode: .default)
                    try session.setActive(true)
                    let url = BinaryBridge.importsDir().appendingPathComponent("recording.m4a")
                    let settings: [String: Any] = [
                        AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                        AVSampleRateKey: 44100, AVNumberOfChannelsKey: 1,
                        AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
                    ]
                    self.recorder = try AVAudioRecorder(url: url, settings: settings)
                    self.recorder?.record(forDuration: seconds)
                    respond(true, ["path": "recording.m4a", "seconds": seconds])
                } catch { respond(false, error.localizedDescription) }
            }
        }
    }
    private func stopRecording(_ respond: (Bool, Any?) -> Void) {
        recorder?.stop(); recorder = nil; respond(true, true)
    }

    // MARK: - Audio out
    private func playTone(_ respond: (Bool, Any?) -> Void) {
        // Plays the most recent recording if present (demonstrates audio out bridge).
        let url = BinaryBridge.importsDir().appendingPathComponent("recording.m4a")
        if FileManager.default.fileExists(atPath: url.path) {
            player = try? AVAudioPlayer(contentsOf: url); player?.play()
            respond(true, true)
        } else { respond(false, "nothing recorded yet") }
    }

    private func reportPermissions(_ respond: (Bool, Any?) -> Void) {
        let cam = AVCaptureDevice.authorizationStatus(for: .video) == .authorized
        let mic: Bool
        if #available(iOS 17.0, *) { mic = AVAudioApplication.shared.recordPermission == .granted }
        else { mic = AVAudioSession.sharedInstance().recordPermission == .granted }
        respond(true, ["camera": cam, "microphone": mic,
                       "cameraAvailable": UIImagePickerController.isSourceTypeAvailable(.camera)])
    }
}

extension MediaBridge: UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    func imagePickerController(_ picker: UIImagePickerController,
                              didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
        picker.dismiss(animated: true)
        let cb = photoCompletion; photoCompletion = nil
        guard let image = info[.originalImage] as? UIImage,
              let data = image.jpegData(compressionQuality: 0.7) else {
            return cb?(false, "no image") ?? ()
        }
        // Save to imports and return a data URL the guest can render.
        let url = BinaryBridge.importsDir().appendingPathComponent("capture.jpg")
        try? data.write(to: url)
        cb?(true, ["path": "capture.jpg", "dataURL": "data:image/jpeg;base64," + data.base64EncodedString(),
                   "width": image.size.width, "height": image.size.height])
    }
    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
        picker.dismiss(animated: true)
        let cb = photoCompletion; photoCompletion = nil
        cb?(false, "cancelled")
    }
}
