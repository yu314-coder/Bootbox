import SwiftUI
import Iosnet

@main
struct MiniOSApp: App {
    init() {
        SelfCheck.run()
        VMStorage.cleanupStale()             // drop stale *.part temp files from the Files view
        BootLog.migrate()                    // logs moved from Documents to the shared folder (Files › Bootbox › Logs)
        DomainRegistrar.register()
        BackgroundKeepAlive.shared.start()   // a short grace for the guest when backgrounded
        MiniOSApp.startNetStack()            // embedded netstack -> real internet for the 64-bit guest
    }

    /// Embedded gVisor netstack (c2w-net, bound to an xcframework). It serves a loopback
    /// WebSocket (127.0.0.1:8889) that the 64-bit QEMU guest's `-netdev socket` dials, and
    /// performs REAL native TCP to the internet — standalone, no external proxy, no CORS, no
    /// service worker. IosnetStart blocks serving, so it runs on a background queue.
    private static func startNetStack() {
        DispatchQueue.global(qos: .userInitiated).async {
            var err: NSError?
            IosnetStart("127.0.0.1:8889", &err)
            if let err = err { NSLog("[netstack] exited: \(err.localizedDescription)") }
        }
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                Color.black.ignoresSafeArea()
                HostView()   // (iPhone: inside the safe area - the toolbar sat under the Dynamic Island)
            }
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
                .onOpenURL { url in
                    // EXE / APK / .mapp opened from Files, AirDrop, a USB drive, etc.
                    ImportManager.handle(url: url)
                }
        }
    }
}
