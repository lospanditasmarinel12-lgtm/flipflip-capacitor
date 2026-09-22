import UIKit
import AVFoundation
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?
    private var interruptionToken: NSObjectProtocol?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Configure a mixing audio session so WebView media (scene audio +
        // video) coexists with background music instead of pausing or ducking
        // it. .playback keeps audio available; .mixWithOthers mixes alongside
        // other apps at their normal volume (no ducking). Combined with the
        // UIBackgroundModes audio/bluetooth-central entries, playback and haptic
        // device kept alive in the background, this survives minimize.
        configureAudioSession()
        observeSessionInterruptions()
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Re-activate the audio session — a phone call / Control Center or the
        // system can deactivate it in the background.
        configureAudioSession()
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        configureAudioSession()
    }

    /// .playback + .mixWithOthers keeps scene audio and haptic playback running
    /// alongside other apps; re-asserted (repeatedly) so interruptions and
    /// background transitions can't leave the session idle.
    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, options: [.mixWithOthers])
            try session.setActive(true)
        } catch {
            NSLog("[AudioSession] failed to configure mixing session: %@", error.localizedDescription)
        }
    }

    /// System interruptions (phone call, Siri) deactivate our session; re-arm it
    /// when they end so scene audio + haptics resume automatically.
    private func observeSessionInterruptions() {
        guard interruptionToken == nil else { return }
        interruptionToken = NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let info = note.userInfo,
                  let raw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            NSLog("[AudioSession] interruption %@", type == .began ? "began" : "ended")
            if type == .ended {
                self?.configureAudioSession()
            }
        }
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
