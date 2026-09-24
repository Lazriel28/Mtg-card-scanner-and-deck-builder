import UIKit

@main
struct MTGCodexApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var delegate

    var body: some Scene {
        WindowGroup {
            RootView()
        }
    }
}

class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Keep the app responsive while the camera session is active and while
        // we're talking to the LAN server.
        UIApplication.shared.isIdleTimerDisabled = false
        return true
    }
}
