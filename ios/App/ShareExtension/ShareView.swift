import SwiftUI
import UIKit
import ImageIO
import UniformTypeIdentifiers

// The "Addly" option in the iPhone Share menu: a small sheet with what you're sharing
// already filled in. Pick who it's for, add a note, Send. It sends through Addly's
// server with the private send-key the app gave it (never your password).

private let groupId = "group.com.brandonchirco.nudge"
private let brand = Color(red: 0x1F / 255, green: 0x5C / 255, blue: 0x3F / 255)
private let cream = Color(red: 0xFB / 255, green: 0xF6 / 255, blue: 0xEC / 255)

struct SharedItem {
    var url: URL?
    var title: String?
    var text: String?
    var imageJPEG: Data?
    var thumbnail: UIImage?
}

@MainActor
final class ShareModel: ObservableObject {
    @Published var item = SharedItem()
    @Published var loading = true
    @Published var selected: [String] = []
    @Published var saveToSelf = false
    @Published var note = ""
    @Published var search = ""
    @Published var sending = false
    @Published var sent = false
    @Published var error: String?

    private let defaults = UserDefaults(suiteName: groupId)
    var key: String? { defaults?.string(forKey: "shareKey") }
    var me: String? { defaults?.string(forKey: "displayName") }
    /// People you nudge, most recent first (kept up to date by the app)
    var contacts: [String] {
        guard let json = defaults?.string(forKey: "contacts"),
              let data = json.data(using: .utf8),
              let list = try? JSONDecoder().decode([String].self, from: data) else { return [] }
        return list
    }
    var signedIn: Bool { key != nil && defaults?.string(forKey: "supabaseUrl") != nil }

    var canSend: Bool {
        !sending && !sent && (!selected.isEmpty || saveToSelf)
            && (item.url != nil || item.imageJPEG != nil || !(item.text ?? "").isEmpty || !note.isEmpty)
    }

    func toggle(_ name: String) {
        if let i = selected.firstIndex(of: name) { selected.remove(at: i) } else { selected.append(name) }
    }

    // MARK: Reading what was shared

    func load(from context: NSExtensionContext?) async {
        defer { loading = false }
        let items = (context?.inputItems as? [NSExtensionItem]) ?? []
        for extensionItem in items {
            if item.title == nil, let words = extensionItem.attributedContentText?.string, !words.isEmpty {
                item.title = words
            }
            for provider in extensionItem.attachments ?? [] {
                if item.url == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
                   let url = await loadURL(provider), url.scheme?.hasPrefix("http") == true {
                    item.url = url
                } else if item.imageJPEG == nil, provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
                    await loadImage(provider)
                } else if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
                          let text = await loadText(provider) {
                    // Text with a link in it (common from apps like TikTok): use the link
                    if item.url == nil, let found = firstLink(in: text) {
                        item.url = found
                        let rest = text.replacingOccurrences(of: found.absoluteString, with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                        if !rest.isEmpty { item.text = rest }
                    } else if item.text == nil {
                        item.text = text
                    }
                }
            }
        }
        // Safari sometimes repeats the link as the "title"; that's not a title
        if let t = item.title, let u = item.url, t == u.absoluteString { item.title = nil }
    }

    private func loadURL(_ provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { cont in
            provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { value, _ in
                cont.resume(returning: value as? URL)
            }
        }
    }

    private func loadText(_ provider: NSItemProvider) async -> String? {
        await withCheckedContinuation { cont in
            provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { value, _ in
                cont.resume(returning: (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines))
            }
        }
    }

    private func loadImage(_ provider: NSItemProvider) async {
        let raw: Data? = await withCheckedContinuation { cont in
            provider.loadItem(forTypeIdentifier: UTType.image.identifier, options: nil) { value, _ in
                if let url = value as? URL { cont.resume(returning: try? Data(contentsOf: url)) }
                else if let data = value as? Data { cont.resume(returning: data) }
                else if let image = value as? UIImage { cont.resume(returning: image.jpegData(compressionQuality: 0.9)) }
                else { cont.resume(returning: nil) }
            }
        }
        guard let raw, let small = downscale(raw, maxPixels: 2000) else { return }
        item.thumbnail = small
        item.imageJPEG = small.jpegData(compressionQuality: 0.82)
    }

    /// Shrinks a photo without loading the whole thing into memory (Share menus get very little)
    private func downscale(_ data: Data, maxPixels: Int) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
        ]
        guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: cg)
    }

    private func firstLink(in text: String) -> URL? {
        let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)
        let match = detector?.firstMatch(in: text, options: [], range: NSRange(text.startIndex..., in: text))
        return match?.url
    }

    // MARK: Sending

    func send() async {
        guard let key, let base = defaults?.string(forKey: "supabaseUrl"),
              let anon = defaults?.string(forKey: "anonKey"),
              let endpoint = URL(string: base + "/functions/v1/smooth-function") else {
            error = "Open Addly and sign in, then try again."
            return
        }
        sending = true
        error = nil
        defer { sending = false }

        let words = [item.text, note.isEmpty ? nil : note].compactMap { $0 }.joined(separator: "\n")
        var body: [String: Any] = [
            "key": key,
            "recipients": selected,
            "saveToSelf": saveToSelf,
            "text": words,
        ]
        if let url = item.url { body["url"] = url.absoluteString }
        if let title = item.title { body["title"] = title }
        if let jpeg = item.imageJPEG {
            body["imageBase64"] = jpeg.base64EncodedString()
            body["imageType"] = "image/jpeg"
        }

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(anon)", forHTTPHeaderField: "Authorization")
        request.setValue(anon, forHTTPHeaderField: "apikey")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            if status == 200 {
                sent = true
            } else {
                let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
                error = message ?? "Couldn't send. Try again."
            }
        } catch {
            self.error = "No connection. Try again."
        }
    }
}

struct ShareView: View {
    @ObservedObject var model: ShareModel
    var onClose: () -> Void

    var body: some View {
        NavigationView {
            Group {
                if !model.signedIn {
                    VStack(spacing: 12) {
                        Image(systemName: "person.crop.circle.badge.exclamationmark").font(.system(size: 40)).foregroundColor(brand)
                        Text("Open Addly first").font(.headline)
                        Text("Sign in to Addly once on this iPhone, then you can share from anywhere.")
                            .font(.subheadline).foregroundColor(.secondary).multilineTextAlignment(.center)
                    }
                    .padding(32)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if model.sent {
                    VStack(spacing: 10) {
                        Image(systemName: "checkmark.circle.fill").font(.system(size: 54)).foregroundColor(brand)
                        Text("Nudge sent!").font(.headline)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .onAppear { DispatchQueue.main.asyncAfter(deadline: .now() + 0.8, execute: onClose) }
                } else {
                    form
                }
            }
            .background(cream.ignoresSafeArea())
            .navigationTitle("Send with Addly")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onClose).foregroundColor(brand)
                }
                ToolbarItem(placement: .confirmationAction) {
                    if model.sending {
                        ProgressView()
                    } else if model.signedIn && !model.sent {
                        Button("Send") { Task { await model.send() } }
                            .font(.body.weight(.semibold))
                            .foregroundColor(model.canSend ? brand : .secondary)
                            .disabled(!model.canSend)
                    }
                }
            }
        }
        .navigationViewStyle(.stack)
    }

    private var form: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                preview

                TextField("Add a note (optional)", text: $model.note)
                    .padding(12)
                    .background(Color.white)
                    .clipShape(RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.black.opacity(0.08)))

                if let error = model.error {
                    Text(error).font(.footnote).foregroundColor(.red)
                }

                Text("Send to").font(.footnote.weight(.semibold)).foregroundColor(.secondary).padding(.top, 4)

                if model.contacts.count > 8 {
                    TextField("Search", text: $model.search)
                        .padding(10)
                        .background(Color.white)
                        .clipShape(RoundedRectangle(cornerRadius: 10))
                }

                VStack(spacing: 0) {
                    personRow(name: "My Nudges", subtitle: "Save it for yourself", isOn: model.saveToSelf, initials: "★") {
                        model.saveToSelf.toggle()
                    }
                    ForEach(filteredContacts, id: \.self) { name in
                        Divider().padding(.leading, 60)
                        personRow(name: name, subtitle: nil, isOn: model.selected.contains(name), initials: initials(name)) {
                            model.toggle(name)
                        }
                    }
                }
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: 14))

                if model.contacts.isEmpty {
                    Text("Send someone a nudge in the Addly app first, and they'll show up here.")
                        .font(.footnote).foregroundColor(.secondary)
                }
            }
            .padding(16)
        }
    }

    private var filteredContacts: [String] {
        let q = model.search.trimmingCharacters(in: .whitespaces).lowercased()
        return q.isEmpty ? model.contacts : model.contacts.filter { $0.lowercased().contains(q) }
    }

    private var preview: some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 12).fill(brand.opacity(0.12))
                if let thumb = model.item.thumbnail {
                    Image(uiImage: thumb).resizable().scaledToFill()
                } else {
                    Image(systemName: model.item.url != nil ? "link" : "text.bubble").foregroundColor(brand)
                }
            }
            .frame(width: 56, height: 56)
            .clipShape(RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 3) {
                if model.loading {
                    Text("Getting it ready…").foregroundColor(.secondary)
                } else {
                    Text(model.item.title ?? model.item.url?.host ?? (model.item.imageJPEG != nil ? "Photo" : model.item.text ?? "Shared item"))
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                    if let host = model.item.url?.host {
                        Text(host.replacingOccurrences(of: "www.", with: "")).font(.caption).foregroundColor(.secondary).lineLimit(1)
                    } else if let text = model.item.text, model.item.title != nil || model.item.imageJPEG != nil {
                        Text(text).font(.caption).foregroundColor(.secondary).lineLimit(2)
                    }
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func personRow(name: String, subtitle: String?, isOn: Bool, initials: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Text(initials)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                    .frame(width: 36, height: 36)
                    .background(Circle().fill(brand.opacity(0.85)))
                VStack(alignment: .leading, spacing: 1) {
                    Text(name).foregroundColor(.primary)
                    if let subtitle { Text(subtitle).font(.caption).foregroundColor(.secondary) }
                }
                Spacer()
                Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 22))
                    .foregroundColor(isOn ? brand : Color.black.opacity(0.2))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func initials(_ name: String) -> String {
        let parts = name.split(separator: " ").prefix(2).compactMap { $0.first }
        return parts.isEmpty ? "?" : String(parts).uppercased()
    }
}
