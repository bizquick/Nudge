import UIKit
import SwiftUI

/// Starting point of the "Addly" Share menu option: shows the SwiftUI send sheet.
@objc(ShareViewController)
class ShareViewController: UIViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        // The sheet is designed light (cream background, dark text). Without this, a phone in
        // dark mode turns the text white on the cream background, which can't be read.
        overrideUserInterfaceStyle = .light
        let model = ShareModel()
        let sheet = ShareView(model: model) { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
        let host = UIHostingController(rootView: sheet.preferredColorScheme(.light))
        host.overrideUserInterfaceStyle = .light
        addChild(host)
        host.view.frame = view.bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(host.view)
        host.didMove(toParent: self)
        Task { await model.load(from: extensionContext) }
    }
}
