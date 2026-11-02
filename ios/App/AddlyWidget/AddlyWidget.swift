import WidgetKit
import SwiftUI
import ImageIO

// Addly on the Home Screen and Lock Screen: what's up next in your queue, with its
// picture, and what's after it. Tap one to open it in Addly. The app hands the widget
// your queue through the app group it shares with it, and refreshes it when it changes.

private let groupId = "group.com.brandonchirco.nudge"
private let brand = Color(red: 0x1F / 255, green: 0x5C / 255, blue: 0x3F / 255)
private let cream = Color(red: 0xFB / 255, green: 0xF6 / 255, blue: 0xEC / 255)

struct WidgetNudge: Decodable, Identifiable {
    let id: String
    let title: String
    let from: String
    let kind: String?
    let image: String?
}

struct QueueEntry: TimelineEntry {
    let date: Date
    let signedIn: Bool
    let nudges: [WidgetNudge]
    let waiting: Int
    /// Pictures already downloaded (widgets can't load them while drawing)
    let pictures: [String: UIImage]
}

private func readQueue() -> (signedIn: Bool, nudges: [WidgetNudge], waiting: Int) {
    let defaults = UserDefaults(suiteName: groupId)
    let signedIn = defaults?.string(forKey: "displayName") != nil
    guard let json = defaults?.string(forKey: "widgetQueue"), let data = json.data(using: .utf8) else {
        return (signedIn, [], 0)
    }
    struct Payload: Decodable { let nudges: [WidgetNudge]; let waiting: Int }
    let payload = try? JSONDecoder().decode(Payload.self, from: data)
    return (signedIn, payload?.nudges ?? [], payload?.waiting ?? 0)
}

/// A small copy of a picture, so the widget stays well within its memory limit
private func thumbnail(_ data: Data, maxPixels: Int) -> UIImage? {
    guard let source = CGImageSourceCreateWithData(data as CFData, nil) else { return nil }
    let options: [CFString: Any] = [
        kCGImageSourceCreateThumbnailFromImageAlways: true,
        kCGImageSourceCreateThumbnailWithTransform: true,
        kCGImageSourceThumbnailMaxPixelSize: maxPixels,
    ]
    guard let cg = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
    return UIImage(cgImage: cg)
}

private func loadPictures(for nudges: [WidgetNudge]) async -> [String: UIImage] {
    var pictures: [String: UIImage] = [:]
    await withTaskGroup(of: (String, UIImage?).self) { group in
        for (index, nudge) in nudges.prefix(5).enumerated() {
            guard let link = nudge.image, let url = URL(string: link) else { continue }
            group.addTask {
                var request = URLRequest(url: url)
                request.timeoutInterval = 8
                guard let (data, _) = try? await URLSession.shared.data(for: request) else { return (nudge.id, nil) }
                return (nudge.id, thumbnail(data, maxPixels: index == 0 ? 700 : 200))
            }
        }
        for await (id, image) in group { if let image { pictures[id] = image } }
    }
    return pictures
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> QueueEntry {
        QueueEntry(date: .now, signedIn: true, nudges: [
            WidgetNudge(id: "1", title: "A video Alison sent you", from: "Alison", kind: "Video", image: nil),
            WidgetNudge(id: "2", title: "Dinner idea", from: "Sam", kind: "Food", image: nil),
            WidgetNudge(id: "3", title: "This song", from: "Jo", kind: "Music", image: nil),
        ], waiting: 3, pictures: [:])
    }

    func getSnapshot(in context: Context, completion: @escaping (QueueEntry) -> Void) {
        let queue = readQueue()
        completion(QueueEntry(date: .now, signedIn: queue.signedIn, nudges: queue.nudges, waiting: queue.waiting, pictures: [:]))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<QueueEntry>) -> Void) {
        Task {
            let queue = readQueue()
            let pictures = await loadPictures(for: queue.nudges)
            let entry = QueueEntry(date: .now, signedIn: queue.signedIn, nudges: queue.nudges, waiting: queue.waiting, pictures: pictures)
            // The app refreshes the widget whenever your queue changes; this is just a fallback
            completion(Timeline(entries: [entry], policy: .after(.now.addingTimeInterval(30 * 60))))
        }
    }
}

private func link(_ nudge: WidgetNudge) -> URL {
    URL(string: "addly://nudge/\(nudge.id)") ?? URL(string: "addly://home")!
}

// MARK: - Views

struct UpNextView: View {
    let nudge: WidgetNudge
    let picture: UIImage?
    let compact: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Circle().fill(picture != nil ? Color.white : brand).frame(width: 6, height: 6)
                Text("UP NEXT").font(.system(size: 10, weight: .bold)).tracking(0.8)
            }
            .foregroundStyle(picture != nil ? Color.white : brand)
            Spacer(minLength: 0)
            Text(nudge.title)
                .font(.system(size: compact ? 14 : 15, weight: .semibold))
                .lineLimit(compact ? 3 : 2)
                .foregroundStyle(picture != nil ? Color.white : Color.black)
            Text("from \(nudge.from)")
                .font(.system(size: 11))
                .lineLimit(1)
                .foregroundStyle(picture != nil ? Color.white.opacity(0.85) : Color.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(12)
        .background {
            if let picture {
                ZStack {
                    Image(uiImage: picture).resizable().scaledToFill()
                    LinearGradient(colors: [.black.opacity(0.15), .black.opacity(0.7)], startPoint: .top, endPoint: .bottom)
                }
            } else {
                Color.white
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: compact ? 0 : 14, style: .continuous))
    }
}

struct RowView: View {
    let nudge: WidgetNudge
    let picture: UIImage?

    var body: some View {
        HStack(spacing: 8) {
            Group {
                if let picture {
                    Image(uiImage: picture).resizable().scaledToFill()
                } else {
                    ZStack { brand.opacity(0.12); Image(systemName: "sparkles").font(.system(size: 11)).foregroundStyle(brand) }
                }
            }
            .frame(width: 30, height: 30)
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            VStack(alignment: .leading, spacing: 0) {
                Text(nudge.title).font(.system(size: 13, weight: .medium)).lineLimit(1).foregroundStyle(.black)
                Text(nudge.from).font(.system(size: 11)).lineLimit(1).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
    }
}

struct CaughtUpView: View {
    let signedIn: Bool
    var body: some View {
        VStack(spacing: 6) {
            Text(signedIn ? "🎉" : "👋").font(.system(size: 26))
            Text(signedIn ? "All caught up" : "Open Addly to sign in")
                .font(.system(size: 13, weight: .semibold)).foregroundStyle(brand)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct AddlyWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: QueueEntry

    var body: some View {
        content.containerBackground(for: .widget) { cream }
    }

    @ViewBuilder var content: some View {
        if let first = entry.nudges.first {
            switch family {
            case .accessoryRectangular:
                VStack(alignment: .leading, spacing: 1) {
                    Text("Up next").font(.system(size: 11, weight: .bold))
                    Text(first.title).font(.system(size: 13, weight: .semibold)).lineLimit(2)
                    Text("from \(first.from)").font(.system(size: 11)).lineLimit(1)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .widgetURL(link(first))
            case .accessoryCircular:
                ZStack {
                    AccessoryWidgetBackground()
                    VStack(spacing: 0) {
                        Text("\(entry.waiting)").font(.system(size: 20, weight: .bold))
                        Text("Addly").font(.system(size: 9))
                    }
                }
                .widgetURL(URL(string: "addly://home"))
            case .systemSmall:
                // The picture fills the whole widget
                UpNextView(nudge: first, picture: entry.pictures[first.id], compact: true)
                    .widgetURL(link(first))
            default:
                let more = Array(entry.nudges.dropFirst().prefix(family == .systemLarge ? 5 : 2))
                VStack(alignment: .leading, spacing: 8) {
                    Link(destination: link(first)) {
                        UpNextView(nudge: first, picture: entry.pictures[first.id], compact: false)
                            .frame(height: family == .systemLarge ? 150 : nil)
                    }
                    if family == .systemLarge || !more.isEmpty {
                        VStack(alignment: .leading, spacing: 7) {
                            ForEach(more) { nudge in
                                Link(destination: link(nudge)) { RowView(nudge: nudge, picture: entry.pictures[nudge.id]) }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if family == .systemLarge {
                        Spacer(minLength: 0)
                        Text(entry.waiting > 1 + more.count ? "+\(entry.waiting - 1 - more.count) more in Addly" : "That's everything")
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                    }
                }
                .padding(12)
            }
        } else {
            CaughtUpView(signedIn: entry.signedIn).widgetURL(URL(string: "addly://home"))
        }
    }
}

struct AddlyQueueWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "AddlyQueue", provider: Provider()) { entry in
            AddlyWidgetView(entry: entry)
        }
        .configurationDisplayName("Up next")
        .description("What's next in your Addly queue. Tap one to open it.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .accessoryRectangular, .accessoryCircular])
        .contentMarginsDisabled()
    }
}

@main
struct AddlyWidgets: WidgetBundle {
    var body: some Widget {
        AddlyQueueWidget()
    }
}
