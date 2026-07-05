import SwiftUI
import WebKit
import UniformTypeIdentifiers

/// Native drag-and-drop: drag an ISO / disk / file from Files (or any app) onto
/// Bootbox to import it. Must be native — WKWebView does NOT surface dragged
/// .iso/.img files to the page's HTML5 drop events.
final class WebDropDelegate: NSObject, UIDropInteractionDelegate {
    static var retained: WebDropDelegate?   // single-window app: keep the delegate alive

    func dropInteraction(_ i: UIDropInteraction, canHandle session: UIDropSession) -> Bool {
        session.hasItemsConforming(toTypeIdentifiers: [UTType.data.identifier])
    }
    func dropInteraction(_ i: UIDropInteraction, sessionDidUpdate session: UIDropSession) -> UIDropProposal {
        UIDropProposal(operation: .copy)   // REQUIRED — drops fail silently without it
    }
    func dropInteraction(_ i: UIDropInteraction, performDrop session: UIDropSession) {
        for item in session.items {
            item.itemProvider.loadFileRepresentation(forTypeIdentifier: UTType.data.identifier) { url, _ in
                guard let url else { return }
                _ = ImportManager.handle(url: url)
            }
        }
    }
}

/// Hosts the WKWebView and captures the HARDWARE keyboard for the in-page v86
/// emulator. The capture must live on a UIViewController via `UIKeyCommand`, NOT
/// on the WKWebView: physical keys are consumed by WebKit's private WKContentView
/// (first responder) before they reach a WKWebView subclass's `pressesBegan`, so
/// that approach receives nothing. `UIKeyCommand`s registered on an ancestor
/// responder, with `wantsPriorityOverSystemBehavior`, fire even while WebKit holds
/// focus — so a Magic Keyboard types into the guest. Each key is forwarded to
/// `window.__emuKey`, which feeds v86's keyboard.
final class KeyCaptureViewController: UIViewController {
    let webView: WKWebView
    init(webView: WKWebView) { self.webView = webView; super.init(nibName: nil, bundle: nil) }
    required init?(coder: NSCoder) { fatalError("not used") }

    override func loadView() { view = webView }
    override var canBecomeFirstResponder: Bool { true }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        becomeFirstResponder()
        NotificationCenter.default.addObserver(self, selector: #selector(reassert),
            name: UIResponder.keyboardDidHideNotification, object: nil)
        NotificationCenter.default.addObserver(self, selector: #selector(reassert),
            name: UIApplication.didBecomeActiveNotification, object: nil)
    }
    @objc private func reassert() { becomeFirstResponder() }   // keep capturing after soft-kbd / backgrounding

    // MARK: - key commands (one action for every key we forward to the guest)
    override var keyCommands: [UIKeyCommand]? { Self.commands }

    private static let commands: [UIKeyCommand] = {
        var cmds: [UIKeyCommand] = []
        let sel = #selector(KeyCaptureViewController.onKey(_:))
        func add(_ input: String, _ flags: UIKeyModifierFlags) {
            let c = UIKeyCommand(input: input, modifierFlags: flags, action: sel)
            if #available(iOS 15.0, *) { c.wantsPriorityOverSystemBehavior = true }
            cmds.append(c)
        }
        let letters = "abcdefghijklmnopqrstuvwxyz"
        let others  = "1234567890-=[]\\;',./`"
        for ch in letters { let s = String(ch); add(s, []); add(s, .shift); add(s, .control); add(s, .alternate) }
        for ch in others  { let s = String(ch); add(s, []); add(s, .shift); add(s, .control) }
        add(" ", []); add(" ", .control)
        add("\r", []); add("\t", []); add("\u{8}", [])                 // Enter, Tab, Backspace
        for k in [UIKeyCommand.inputEscape, UIKeyCommand.inputUpArrow, UIKeyCommand.inputDownArrow,
                  UIKeyCommand.inputLeftArrow, UIKeyCommand.inputRightArrow] { add(k, []) }
        return cmds
    }()

    private static let shiftMap: [Character: Character] = [
        "1":"!","2":"@","3":"#","4":"$","5":"%","6":"^","7":"&","8":"*","9":"(","0":")",
        "-":"_","=":"+","[":"{","]":"}","\\":"|",";":":","'":"\"",",":"<",".":">","/":"?","`":"~",
    ]

    @objc private func onKey(_ cmd: UIKeyCommand) {
        let input = cmd.input ?? ""
        let flags = cmd.modifierFlags
        let ctrl = flags.contains(.control), alt = flags.contains(.alternate), shift = flags.contains(.shift)
        var keyName = "", ch = ""
        switch input {
        case "\r", "\n":                    keyName = "Enter"
        case "\t":                          keyName = "Tab"
        case "\u{8}", "\u{7f}":             keyName = "Backspace"
        case UIKeyCommand.inputEscape:      keyName = "Escape"
        case UIKeyCommand.inputUpArrow:     keyName = "ArrowUp"
        case UIKeyCommand.inputDownArrow:   keyName = "ArrowDown"
        case UIKeyCommand.inputLeftArrow:   keyName = "ArrowLeft"
        case UIKeyCommand.inputRightArrow:  keyName = "ArrowRight"
        default:
            guard let c = input.first, input.count == 1 else { return }
            let out: Character = shift ? (c.isLetter ? Character(c.uppercased()) : (Self.shiftMap[c] ?? c)) : c
            ch = String(out); keyName = ch
        }
        let info: [String: Any] = ["key": keyName, "char": ch, "ctrl": ctrl, "alt": alt, "shift": shift]
        guard let data = try? JSONSerialization.data(withJSONObject: info),
              let json = String(data: data, encoding: .utf8) else { return }
        webView.evaluateJavaScript("window.__emuKey&&window.__emuKey(\(json))", completionHandler: nil)
    }
}

/// SwiftUI wrapper that hosts the Bootbox runtime full-screen + native bridges.
struct HostView: View {
    var body: some View {
        WebHostView()
            .background(Color.black)
            .ignoresSafeArea()
    }
}

struct WebHostView: UIViewControllerRepresentable {
    func makeCoordinator() -> BridgeRouter { BridgeRouter() }

    func makeUIViewController(context: Context) -> KeyCaptureViewController {
        let controller = WKUserContentController()
        controller.add(context.coordinator, name: "host")

        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: AppSchemeHandler.scheme)
        config.setURLSchemeHandler(ISOSchemeHandler(), forURLScheme: ISOSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.applicationNameForUserAgent = "Bootbox-Host"
        config.suppressesIncrementalRendering = false
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        config.setValue(true, forKey: "allowUniversalAccessFromFileURLs")

        let webView = WKWebView(frame: .zero, configuration: config)
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.backgroundColor = .black
        webView.isOpaque = false
        webView.allowsBackForwardNavigationGestures = false
        context.coordinator.webView = webView

        // Trackpad / mouse two-finger scroll → guest terminal. scrollView.isScrollEnabled is off (so touch
        // reaches the emulator), which otherwise drops the Magic Keyboard's indirect scroll. maximumNumberOfTouches
        // = 0 makes this fire ONLY for indirect scroll (trackpad/mouse), never touchscreen — so touch input is
        // untouched. The handler bridges the delta to window.__trackpadScroll (run.js → xterm scrollback).
        let scrollPan = UIPanGestureRecognizer(target: context.coordinator, action: #selector(BridgeRouter.handleTrackpadScroll(_:)))
        scrollPan.maximumNumberOfTouches = 0
        scrollPan.cancelsTouchesInView = false
        scrollPan.delegate = context.coordinator
        if #available(iOS 13.4, *) { scrollPan.allowedScrollTypesMask = .all }
        webView.addGestureRecognizer(scrollPan)

        let dropper = WebDropDelegate(); WebDropDelegate.retained = dropper
        webView.addInteraction(UIDropInteraction(delegate: dropper))

        LocalServer.shared.start { base in
            DispatchQueue.main.async {
                if let base = base, let url = URL(string: "index.html", relativeTo: base) {
                    webView.load(URLRequest(url: url))
                } else if let url = URL(string: AppSchemeHandler.indexURL) {
                    webView.load(URLRequest(url: url))
                } else {
                    webView.loadHTMLString("<h1 style='color:white;font-family:sans-serif'>Bootbox runtime not found.</h1>", baseURL: nil)
                }
            }
        }
        return KeyCaptureViewController(webView: webView)
    }

    func updateUIViewController(_ uiViewController: KeyCaptureViewController, context: Context) {}
}
