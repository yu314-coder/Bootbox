import Vision
import UIKit

/// Phase 6 ML bridge — runs on the Neural Engine via Vision/Core ML when
/// available. Uses Vision's built-in requests (no bundled model required):
///  - classifyImage: VNClassifyImageRequest
///  - recognizeText: VNRecognizeTextRequest (OCR)
/// Guest MiniOS apps request inference; the host returns labels/text.
final class MLBridge {
    func handle(_ action: String, _ payload: [String: Any], _ respond: @escaping (Bool, Any?) -> Void) {
        switch action {
        case "classify": run(payload, ocr: false, respond)
        case "ocr":      run(payload, ocr: true, respond)
        default:         respond(false, "unknown ml action: \(action)")
        }
    }

    private func cgImage(from payload: [String: Any]) -> CGImage? {
        if let durl = payload["dataURL"] as? String, let comma = durl.firstIndex(of: ","),
           let data = Data(base64Encoded: String(durl[durl.index(after: comma)...])),
           let img = UIImage(data: data) { return img.cgImage }
        if let name = payload["name"] as? String,
           let data = BinaryBridge.readImport(name), let img = UIImage(data: data) { return img.cgImage }
        return nil
    }

    private func run(_ payload: [String: Any], ocr: Bool, _ respond: @escaping (Bool, Any?) -> Void) {
        guard let cg = cgImage(from: payload) else { return respond(false, "no image provided") }
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                if ocr {
                    let req = VNRecognizeTextRequest()
                    req.recognitionLevel = .accurate
                    try handler.perform([req])
                    let lines = (req.results ?? []).compactMap { $0.topCandidates(1).first?.string }
                    respond(true, ["text": lines.joined(separator: "\n"), "lines": lines.count])
                } else {
                    let req = VNClassifyImageRequest()
                    try handler.perform([req])
                    let top = (req.results ?? [])
                        .filter { $0.confidence > 0.05 }
                        .sorted { $0.confidence > $1.confidence }
                        .prefix(5)
                        .map { ["label": $0.identifier, "confidence": Double($0.confidence)] }
                    respond(true, ["classifications": Array(top)])
                }
            } catch { respond(false, error.localizedDescription) }
        }
    }
}
