import SwiftUI

// MARK: - Suggest view

struct SuggestView: View {
    @StateObject private var api = CodexAPI()
    @State private var message: ToastMessage?
    @State private var decks: [DeckRecord] = []
    @State private var loading = false
    @State private var suggested: SuggestResponse?
    @State private var savedId: Int?

    @State private var format: SuggestFormat = .sixty
    @State private var colors: Set<ColorIdentity> = []

    var body: some View {
        NavigationStack {
            Form {
                Section("Constraints") {
                    Picker("Format", selection: $format) {
                        Text("Commander").tag(SuggestFormat.commander)
                        Text("60-card").tag(SuggestFormat.sixty)
                    }
                    .pickerStyle(.segmented)

                    colorSection
                }

                Section {
                    Button("Suggest a deck") {
                        suggest()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(colors.isEmpty || loading)
                } footer: {
                    if colors.isEmpty {
                        Text("Pick at least one color.")
                    }
                }

                if let tip = suggested {
                    deckSection(tip)
                }

                if savedId != nil {
                    Section {
                        Button("Saved", action: {})
                            .foregroundStyle(.green)
                    }
                }

                if !decks.isEmpty {
                    Section("Recent saved decks") {
                        ForEach(decks) { deck in
                            deckRow(deck)
                        }
                    }
                }
            }
            .navigationTitle("Suggest")
            .onAppear { loadDecks() }
            .refreshable { loadDecks() }
        }
        .alert("Saved", isPresented: .constant(message?.isError == false && message?.text.contains("Saved") == true)) {
            Button("OK", action: { message = nil })
        } message: {
            Text(message?.text ?? "")
        }
    }

    // MARK: - color picker

    private var colorSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Color identity")
                .foregroundStyle(.secondary)
                .font(.caption)
            FlowLayout(spacing: 8) {
                ForEach(ColorIdentity.allCases) { c in
                    colorChip(c)
                }
            }
        }
    }

    @ViewBuilder
    private func colorChip(_ c: ColorIdentity) -> some View {
        let chosen = colors.contains(c)
        Button {
            chooseColor(c)
        } label: {
            HStack(spacing: 4) {
                Circle()
                    .fill(c.color)
                    .frame(width: 14, height: 14)
                Text(c.label)
                    .font(.subheadline)
                if chosen {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.tint)
                        .imageScale(.small)
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(circularUtils.backgroundColor(for: chosen))
            .clipShape(Capsule())
        }
        .buttonStyle(.plain)
    }

    // MARK: - suggestion result

    private func deckSection(_ tip: SuggestResponse) -> some View {
        Group {
            Section("Suggested deck") {
                deckListSection(tip)

                Section("Stats") {
                    statsRow(tip)
                }

                if !tip.notes.isEmpty {
                    Section("Notes") {
                        ForEach(tip.notes, id: \.self) { n in
                            Text(n)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            Section {
                Button("Save this deck") {
                    saveSuggestion(tip)
                }
                .buttonStyle(.borderedProminent)
                .disabled(savedId != nil)
            }
        }
    }

    private func deckListSection(_ tip: SuggestResponse) -> some View {
        Group {
            ForEach(tip.deck) { card in
                HStack {
                    Text(card.name)
                    Spacer()
                    Text("\(card.qty)")
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    private func statsRow(_ tip: SuggestResponse) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            statLine("Deck size", "\(tip.stats.size) / \(tip.stats.targetSize)")
            statLine("Lands", "\(tip.stats.lands)")
            statLine("Avg CMC", String(format: "%.1f", tip.stats.avgCmc))
            statLine("Colors", colorSummary(tip.stats.colors))
        }
        .font(.subheadline)
    }

    private func statLine(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
        }
    }

    private func deckRow(_ deck: DeckRecord) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(deck.name)
                    .font(.headline)
                Spacer()
                Text(deck.formatLabel)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("\(deck.cards.reduce(0) { $0 + $1.qty }) cards")
                Spacer()
                if deck.stats.avgCmc > 0 {
                    Text(String(format: "avg CMC %.1f", deck.stats.avgCmc))
                }
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            if !deck.notes.isEmpty {
                Text(deck.notes)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }

    // MARK: - actions

    private func chooseColor(_ c: ColorIdentity) {
        if colors.contains(c) {
            colors.remove(c)
        } else {
            colors.insert(c)
        }
    }

    private func suggest() {
        Task {
            await doSuggest()
        }
    }

    @MainActor
    private func doSuggest() async {
        loading = true
        defer { loading = false }
        do {
            let tip = try await api.suggest(format: format.rawValue, colors: colors.map(\.short))
            suggested = tip
        } catch let err as CodexAPIError {
            message = ToastMessage(text: err.errorDescription ?? "suggest failed", isError: true)
        } catch {
            message = ToastMessage(text: "suggest failed: \(error.localizedDescription)", isError: true)
        }
    }

    private func saveSuggestion(_ tip: SuggestResponse) {
        Task {
            await doSave(tip)
        }
    }

    @MainActor
    private func doSave(_ tip: SuggestResponse) async {
        do {
            try await api.recordSuggestion(deck: tip.deck, colors: tip.colors)
            savedId = Int.random(in: 1...1_000_000) // optimistic micro-id for UI only
            message = ToastMessage(text: "Saved deck from suggestion.", isError: false)
            loadDecks()
        } catch let err as CodexAPIError {
            message = ToastMessage(text: err.errorDescription ?? "save failed", isError: true)
        } catch {
            message = ToastMessage(text: "save failed: \(error.localizedDescription)", isError: true)
        }
    }

    private func loadDecks() {
        Task {
            do {
                decks = try await api.decks()
            } catch {
                // non-fatal: leave the list empty if the server is unreachable
            }
        }
    }
}

// MARK: - helpers

enum SuggestFormat: String, CaseIterable {
    case commander
    case sixty

    var label: String {
        switch self {
        case .commander: return "Commander"
        case .sixty: return "60-card"
        }
    }
}

enum ColorIdentity: String, CaseIterable, Identifiable {
    case w, u, b, r, g, c

    var id: String { rawValue }

    var label: String {
        switch self {
        case .w: return "W"
        case .u: return "U"
        case .b: return "B"
        case .r: return "R"
        case .g: return "G"
        case .c: return "C"
        }
    }

    var short: String {
        rawValue
    }

    var color: Color {
        switch self {
        case .w: return .white
        case .u: return .blue
        case .b: return .black
        case .r: return .red
        case .g: return .green
        case .c: return .gray
        }
    }
}

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = flowResult(in: proposal.replacingUnspecifiedDimensions().width, subviews: subviews)
        return CGSize(width: proposal.width ?? 0, height: result.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = flowResult(in: bounds.width, subviews: subviews)
        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.positions[index].x, y: bounds.minY + result.positions[index].y), proposal: .unspecified)
        }
    }

    private func flowResult(in width: CGFloat, subviews: Subviews) -> (height: CGFloat, positions: [CGPoint]) {
        var height: CGFloat = 0
        var positions: [CGPoint] = []
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowMax: CGFloat = 0
        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > width && x > 0 {
                x = 0
                y += rowMax + spacing
                rowMax = 0
            }
            positions.append(CGPoint(x: x, y: y))
            x += size.width + spacing
            rowMax = max(rowMax, size.height)
            height = max(height, y + size.height)
        }
        return (height, positions)
    }
}

// avoids depending on the app's shared utils; kept self-contained here
private struct circularUtils {
    static func backgroundColor(for chosen: Bool) -> Color {
        chosen ? Color(.systemGray5) : Color.clear
    }
}
