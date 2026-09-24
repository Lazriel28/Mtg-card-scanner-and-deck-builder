import SwiftUI

// MARK: - Collection view

struct CollectionView: View {
    @StateObject private var store = CollectionStore()
    @State private var message: ToastMessage?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    if store.loading && store.collection == nil {
                        ProgressView("Loading collection…")
                            .frame(maxWidth: .infinity, minHeight: 160)
                    } else if let coll = store.collection {
                        statStrip(coll.stats)
                        categoryChips(coll)
                        addByNameForm
                        cardGrid(coll)
                    } else if let err = store.error {
                        errorBlock(err)
                    }
                }
                .padding()
            }
            .navigationTitle("Collection")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh") { store.refresh() }
                }
            }
            .task { await store.load() }
            .refreshable { await store.load() }
        }
        .alert("Not in collection", isPresented: .constant(message?.isError == true && message?.text.contains("not in collection") == true)) {
            Button("OK", action: { message = nil })
        } message: {
            Text(message?.text ?? "")
        }
    }

    // MARK: stat strip

    private func statStrip(_ stats: CollectionStats) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {
            StatCell(num: "\(stats.totalCards)", lbl: "cards owned")
            StatCell(num: "\(stats.uniqueCards)", lbl: "unique cards")
            StatCell(num: "$\(String(format: "%.2f", stats.totalValue))", lbl: "approx value")
        }
    }

    // MARK: category chips

    private func categoryChips(_ coll: Collection) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(store.sortedCategories(coll.byCategory), id: \.self) { cat in
                    Button {
                        store.filterCategory = cat
                    } label: {
                        Text("\(cat) (\(countFor(cat, in: coll.byCategory)))")
                            .font(.subheadline)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(store.filterCategory == cat ? Color.accentColor.opacity(0.15) : Color(.secondarySystemGroupedBackground))
                            .foregroundColor(store.filterCategory == cat ? .accentColor : .primary)
                            .cornerRadius(18)
                    }
                }
            }
        }
    }

    private func countFor(_ cat: String, in byCategory: [String: [CollectionEntry]]) -> Int {
        byCategory[cat]?.count ?? 0
    }

    // MARK: add by name

    private var addByNameForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Add card by name")
                .font(.subheadline)
                .foregroundColor(.secondary)
            HStack {
                TextField("Card name", text: $store.newName)
                    .textFieldStyle(.roundedBorder)
                Button("Add") {
                    addCard()
                }
                .buttonStyle(.borderedProminent)
                .disabled(store.newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            HStack(spacing: 8) {
                Text("or scan a photo from the camera")
                    .font(.caption)
                    .foregroundColor(.secondary)
                Spacer()
                Button {
                    // In a full app this would navigate to ScanView.
                } label: {
                    Label("Scan", systemImage: "camera.fill")
                }
                .buttonStyle(.bordered)
            }
        }
    }

    private func addCard() {
        let name = store.newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        Task {
            do {
                _ = try await CodexAPI().addCard(name: name, qty: 1, condition: "NM")
                await MainActor.run {
                    store.newName = ""
                    await store.load()
                    message = ToastMessage(text: "Added \(name)", isError: false)
                }
            } catch let err as CodexAPIError {
                await MainActor.run {
                    message = ToastMessage(text: err.localizedDescription, isError: true)
                }
            } catch {
                await MainActor.run {
                    message = ToastMessage(text: error.localizedDescription, isError: true)
                }
            }
        }
    }

    // MARK: card grid

    private func cardGrid(_ coll: Collection) -> some View {
        let shown = store.filterCategory.flatMap { coll.byCategory[$0] ?? [] } ?? coll.entries
        if shown.isEmpty {
            ContentUnavailableView("Nothing here yet", systemImage: "tray", description: Text("Scan cards or add them by name."))
                .frame(maxWidth: .infinity, minHeight: 160)
                .padding()
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140))], spacing: 12) {
                ForEach(shown) { entry in
                    CollectionCardTile(entry: entry)
                }
            }
        }
    }

    private func errorBlock(_ err: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 44))
                .foregroundColor(.secondary)
            Text(err)
                .font(.subheadline)
                .foregroundColor(.secondary)
            Button("Retry") { store.refresh() }
                .buttonStyle(.borderedProminent)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}

// MARK: - stat cell

struct StatCell: View {
    let num: String
    let lbl: String

    var body: some View {
        VStack(spacing: 4) {
            Text(num)
                .font(.title2)
                .fontWeight(.bold)
                .foregroundColor(.secondary)
            Text(lbl)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(12)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
    }
}

// MARK: - card tile

struct CollectionCardTile: View {
    let entry: CollectionEntry

    var body: some View {
        VStack(spacing: 0) {
            cardArt
            VStack(alignment: .leading, spacing: 3) {
                Text(entry.name)
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(2)
                HStack(spacing: 4) {
                    ForEach(entry.categories.prefix(2), id: \.self) { c in
                        Text(c)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                    if let v = entry.value, v > 0 {
                        Text("$\(String(format: "%.2f", v))")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(8)
            HStack {
                Text("×\(entry.qty)")
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.white)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(Color.accentColor)
                    .cornerRadius(8)
                Spacer()
                Menu {
                    Button {
                        Task { await changeQty(entry, 1) }
                    } label: {
                        Label("Add 1", systemImage: "plus")
                    }
                    Button {
                        Task { await changeQty(entry, -1) }
                    } label: {
                        Label("Remove 1", systemImage: "minus")
                    }
                    Divider()
                    Button(role: .destructive) {
                        Task { await removeCard(entry) }
                    } label: {
                        Label("Remove all", systemImage: "trash")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.body)
                }
                .buttonStyle(.bordered)
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
        }
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
    }

    private var cardArt: some View {
        Group {
            if let photo = entry.photo, !photo.isEmpty {
                AsyncImage(url: CodexAPI().photoURL(for: photo)) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFill()
                    case .empty: placeholderArt
                    case .failure: placeholderArt
                    @unknown default: placeholderArt
                    }
                }
            } else {
                AsyncImage(url: CodexAPI().thumbURL(for: entry.name)) { phase in
                    switch phase {
                    case .success(let img): img.resizable().scaledToFill()
                    case .empty: placeholderArt
                    case .failure: placeholderArt
                    @unknown default: placeholderArt
                    }
                }
            }
        }
        .frame(height: 160)
        .clipped()
    }

    private var placeholderArt: some View {
        ZStack {
            LinearGradient(colors: [.systemGray5, .systemGray4], startPoint: .top, endPoint: .bottom)
            Image(systemName: "figure.card.customerid")
                .font(.system(size: 36))
                .foregroundColor(.secondary)
        }
    }

    private func changeQty(_ entry: CollectionEntry, _ delta: Int) async {
        let q = entry.qty + delta
        do {
            try await CodexAPI().setQty(name: entry.name, qty: q)
            await MainActor.run { store.refresh() }
        } catch {
            await MainActor.run {
                message = ToastMessage(text: error.localizedDescription, isError: true)
            }
        }
    }

    private func removeCard(_ entry: CollectionEntry) async {
        do {
            try await CodexAPI().setQty(name: entry.name, qty: 0)
            await MainActor.run { store.refresh() }
            message = ToastMessage(text: "Removed \(entry.name)", isError: false)
        } catch {
            await MainActor.run {
                message = ToastMessage(text: error.localizedDescription, isError: true)
            }
        }
    }
}

// MARK: - collection store

@MainActor
final class CollectionStore: ObservableObject {
    @Published var collection: Collection?
    @Published var loading = false
    @Published var error: String?
    @Published var filterCategory: String?
    @Published var newName = ""

    func load() async {
        loading = true
        error = nil
        do {
            collection = try await CodexAPI().collection()
        } catch let err as CodexAPIError {
            error = err.localizedDescription
        } catch {
            error = error.localizedDescription
        }
        loading = false
    }

    func refresh() { Task { await load() } }

    func sortedCategories(_ byCategory: [String: [CollectionEntry]]) -> [String] {
        byCategory.keys.sorted { a, b in
            let an = byCategory[a]?.count ?? 0
            let bn = byCategory[b]?.count ?? 0
            return an > bn
        }
    }
}
