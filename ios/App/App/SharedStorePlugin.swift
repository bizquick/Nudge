import Foundation
import Capacitor

/// Lets the app hand the Share menu what it needs: your private send-key, your name,
/// and the people you nudge most. Stored in the app group that both can read.
@objc(SharedStorePlugin)
public class SharedStorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SharedStorePlugin"
    public let jsName = "SharedStore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise)
    ]

    static let groupId = "group.com.brandonchirco.nudge"
    private let defaults = UserDefaults(suiteName: SharedStorePlugin.groupId)

    /// set({ values: { key: "string", ... } })
    @objc func set(_ call: CAPPluginCall) {
        guard let defaults = defaults else { call.reject("App group unavailable"); return }
        let values = call.getObject("values") ?? [:]
        for (key, value) in values {
            if let text = value as? String { defaults.set(text, forKey: key) }
            else { defaults.removeObject(forKey: key) }
        }
        call.resolve()
    }

    /// Signing out: the Share menu forgets everything
    @objc func clear(_ call: CAPPluginCall) {
        defaults?.dictionaryRepresentation().keys.forEach { defaults?.removeObject(forKey: $0) }
        call.resolve()
    }
}
