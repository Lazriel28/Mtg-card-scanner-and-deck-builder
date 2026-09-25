import SwiftUI

// MARK: - Decks view

struct DecksView: View {
    @StateObject private var api = CodexAPI()
    @State private var decks: [DeckRecord] = []
    @State private var loading = false
    @State private var deletingId: Int?
    @State private var message: ToastMessage?

    var body: some View {
        NavigationStack {
            Group {
                if decks.isEmpty && !loading {
                    emptyState
                } else {
                    decksList
                }
            }
            .navigationTitle("Decks")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Refresh") {
                        loadDecks()
                    }
                    .disabled(loading)
                }
            }
            .refreshable { loadDecks() }
            .overlay {
                if loading {
                    ProgressView("Loading decks…")
                }
            }
        }
        .alert("Deleted", isPresented: .constant(message?.isError == false && message?.text.contains("Deleted") == true)) {
            Button("OK", action: { message = nil })
        } message: {
            Text(message?.text ?? "")
        }
    }

    private var emptyState: some View {
        ContentUnavailableView(
            "No decks yet",
            systemImage: "rectangle.stack",
            description: Text("Save a suggested deck or build one on the server to see it here.")
        )
    }

    private var decksList: some View {
        List {
            ForEach(decks) { deck in
                deckSection(deck)
            }
            .onDelete { offsets in
                for index in offsets {
                    deleteDeck(decks[index].id)
                }
            }
        }
        .listStyle(.insetGrouped)
    }

    private func deckSection(_ deck: DeckRecord) -> some View {
        Section {
            headerRow(deck)

            if deck.commander != nil && !deck.commander!.isEmpty {
                Section("Commander") {
                    ForEach(deck.commander!, id: \.self) { name in
                        Text(name)
                    }
                }
            }

            Section("Main deck") {
                ForEach(deck.cards) { card in
                    deckCardRow(card)
                }
            }
            .if(deck.cards.isEmpty) { view in
                Section("Main deck") {
                    Text("no cards")
                        .foregroundStyle(.secondary)
                }
            }

            if !deck.sideboard.isEmpty {
                Section("Sideboard") {
                    ForEach(deck.sideboard) { card in
                        deckCardRow(card)
                    }
                }
            }

            if deck.stats.avgCmc > 0 {
                Section("Stats") {
                    statRow("Size", "\(deck.size)")
                    statRow("Lands", "\(deck.stats.lands)")
                    statRow("Avg CMC", String(format: "%.1f", deck.stats.avgCmc))
                    statRow("Colors", colorSummary(deck.stats.colors))
                    curveRow(deck.stats.curve)
                }
            }

            if !deck.notes.isEmpty {
                Section("Notes") {
                    Text(deck.notes)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                Button(role: .destructive) {
                    deleteDeck(deck.id)
                } label: {
                    Label("Delete deck", systemImage: "trash")
                }
                .disabled(deletingId != nil)
            }
        } header: {
            Text(deck.formatLabel)
        }
    }

    @ViewBuilder
    private func deckCardRow(_ card: DeckCard) -> some View {
        HStack {
            Text(card.name)
            Spacer()
            Text("\(card.qty)x")
                .foregroundStyle(.secondary)
                .monospacedDigit()
        }
    }

    private func headerRow(_ deck: DeckRecord) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(deck.name)
                .font(.headline)
            if let updated = deck.updated, let date = Date(timeIntervalSince1970: TimeInterval(updated) / 1000) {
                Text("Updated \(date, style: .relative) ago")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func statRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .monospacedDigit()
        }
    }

    private func curveRow(_ curve: [String: Int]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Curve")
                .foregroundStyle(.secondary)
                .font(.caption)
            let sorted = curve.map { (cost: $0.key, count: $0.value) }
                .sorted { le($0.cost) < le($1.cost) }
            HStack(spacing: 4) {
                ForEach(sorted, id: \.cost) { entry in
                    VStack(spacing: 0) {
                        Text(entry.count > 0 ? "\(entry.count)" : "")
                            .font(.caption2)
                            .monospacedDigit()
                        Text(costLabel(entry.cost))
                            .font(.system(size: 8))
                            .foregroundStyle(.secondary)
                    }
                    .frame(width: 22, alignment: .center)
                }
            }
        }
    }

    private func costLabel(_ cost: String) -> String {
        if cost == "5+" { return "5+" }
        if let n = Int(cost) { return "\(n)" }
        return cost
    }

    private func le(_ cost: String) -> Int {
        if cost == "5+" { return 6 }
        return Int(cost) ?? 99
    }

    // MARK: - actions

    private func loadDecks() {
        loading = true
        Task {
            do {
                decks = try await api.decks()
            } catch let err as CodexAPIError {
                message = ToastMessage(text: err.errorDescription ?? "couldn't load decks", isError: true)
            } catch {
                message = ToastMessage(text: "couldn't load decks: \(error.localizedDescription)", isError: true)
            }
            loading = false
        }
    }

    private func deleteDeck(_ id: Int) {
        deletingId = id
        Task {
            do {
                try await api.deleteDeck(id: id)
                decks.removeAll { $0.id == id }
                message = ToastMessage(text: "Deleted deck.", isError: false)
            } catch let err as CodexAPIError {
                message = ToastMessage(text: err.errorDescription ?? "delete failed", isError: true)
            } catch {
                message = ToastMessage(text: "delete failed: \(error.localizedDescription)", isError: true)
            }
            deletingId = nil
        }
    }
}

// MARK: - tiny helpers

extension View {
    @ViewBuilder
    func `if`<Transform: View>(_ condition: Bool, transform: (Self) -> Transform) -> some View {
        if condition {
            transform(self)
        } else {
            self
        }
    }
}

private func colorSummary(_ colors: [String: Int]) -> String {
    let parts = colors.filter { $0.value > 0 }.sorted(by: { $0.key < $1.key }).map(\.key)
    if parts.isEmpty { return "—" }
    return parts.joined()
}
