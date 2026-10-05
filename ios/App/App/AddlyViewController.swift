import UIKit
import Capacitor

/// The app's main screen. Same as Capacitor's, plus Addly's own native helper (for the Share menu).
class AddlyViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SharedStorePlugin())
    }
}
