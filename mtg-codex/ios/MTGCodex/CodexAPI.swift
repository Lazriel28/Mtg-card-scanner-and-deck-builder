import Foundation

// MARK: - Shared API client talking to the existing mtg-codex /api

/// Errors the API client surfaces to the UI.
enum CodexAPIError: LocalizedError {
    case http(Int)
    case decode(String)
    case network(String)
    case server(String)
    case noCatalog

    var errorDescription: String? {
        switch self {
        case .http(let code): return "server returned HTTP \(code)"
        case .decode(let m): return "couldn't read server response: \(m)"
        case .network(let m): return "network error: \(m)"
        case .server(let m): return m
        case .noCatalog: return "card catalog not synced yet — run sync on the server first"
        }
    }
}

// MARK: - Models matching the server JSON

struct CodexStatus: Codable {
    let catalog: CatalogStatus
    let collection: CollectionCounts
    let decks: Int
    let sync: SSEState
    let ocr: OCRStatus
}

struct CatalogStatus: Codable {
    let synced: Bool
    let cards: Int
}

struct CollectionCounts: Codable {
    let cards: Int
    let unique: Int
}

struct SSEState: Codable {
    let running: Bool
    let phase: String
    let frac: Double
    let msg: String
    let error: String?
    let done: Bool
}

struct OCRStatus: Codable {
    let available: Bool
    let modelLoaded: Bool
}

struct Collection: Codable {
    let entries: [CollectionEntry]
    let stats: CollectionStats
    let byCategory: [String: [CollectionEntry]]
}

struct CollectionEntry: Codable, Identifiable {
    let name: String
    let qty: Int
    let condition: String
    let photo: String?
    let setCode: String?
    let collector: String?
    let categories: [String]
    let value: Double
    let added: Date?
    let updated: Date?
    let note: String

    var id: String { name.lowercased() }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        qty = try container.decode(Int.self, forKey: .qty)
        condition = try container.decodeIfPresent(String.self, forKey: .condition) ?? "NM"
        photo = try container.decodeIfPresent(String.self, forKey: .photo)
        setCode = try container.decodeIfPresent(String.self, forKey: .setCode)
        collector = try container.decodeIfPresent(String.self, forKey: .collector)
        categories = try container.decodeIfPresent([String].self, forKey: .categories) ?? []
        value = try container.decodeIfPresent(Double.self, forKey: .value) ?? 0
        note = try container.decodeIfPresent(String.self, forKey: .note) ?? ""

        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

        if let addedRaw = try? container.decodeIfPresent(String.self, forKey: .added),
           let addedDate = formatter.date(from: addedRaw) {
            added = addedDate
        } else {
            added = nil
        }
        if let updatedRaw = try? container.decodeIfPresent(String.self, forKey: .updated),
           let updatedDate = formatter.date(from: updatedRaw) {
            updated = updatedDate
        } else {
            updated = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(name, forKey: .name)
        try c.encode(qty, forKey: .qty)
        try c.encode(condition, forKey: .condition)
        try c.encodeIfPresent(photo, forKey: .photo)
        try c.encodeIfPresent(setCode, forKey: .setCode)
        try c.encodeIfPresent(collector, forKey: .collector)
        try c.encode(categories, forKey: .categories)
        try c.encode(value, forKey: .value)
        try c.encodeIfPresent(added, forKey: .added)
        try c.encodeIfPresent(updated, forKey: .updated)
        try c.encode(note, forKey: .note)
    }

    private enum CodingKeys: String, CodingKey {
        case name, qty, condition, photo, setCode, collector, categories, value, added, updated, note
    }
}

struct CollectionStats: Codable {
    let totalCards: Int
    let uniqueCards: Int
    let totalValue: Double
    let categories: [String: Int]
    let colors: [String: Int]
}

struct ScanResult: Codable {
    let ocrText: String
    let candidates: [Candidate]
    let photo: String?
}

struct Candidate: Codable, Identifiable {
    let name: String
    let score: Double
    var id: String { name }

    var confidencePercent: String {
        String(format: "%.0f%%", score * 100)
    }
}

struct CardRecord: Codable {
    let id: String
    let name: String
    let manaCost: String
    let cmc: Double
    let colors: [String]
    let type: String
    let text: String
    let keywords: [String]
    let pt: String?
    let image: String?
    let set: String?
    let collector: String?
    let legal: [String: String]
    let priceUsd: Double?
    let released: String?
}

// MARK: - decks + suggest

struct DeckRecord: Codable, Identifiable {
    let id: Int
    let name: String
    let format: String
    let formatLabel: String
    let commander: [String]?
    let cards: [DeckCard]
    let sideboard: [DeckCard]
    let size: Int
    let stats: DeckStats
    let notes: String
    let updated: Int?
}

struct DeckCard: Codable, Identifiable {
    let name: String
    let qty: Int
    var id: String { name.lowercased() }
}

struct DeckStats: Codable {
    let curve: [String: Int]
    let lands: Int
    let avgCmc: Double
    let colors: [String: Int]
}

struct SuggestRequest: Codable {
    let format: String?
    let colors: [String]?
}

struct SuggestResponse: Codable {
    let format: String
    let colors: [String]
    let deck: [DeckCard]
    let stats: SuggestStats
    let notes: [String]
}

struct SuggestStats: Codable {
    let size: Int
    let targetSize: Int
    let lands: Int
    let avgCmc: Double
    let colors: [String: Int]
}

struct SuggestRecordRequest: Codable {
    let deck: [DeckCard]
    let colors: [String]
}

struct SuggestRecordResponse: Codable {
    let ok: Bool
}

// MARK: - API client

final class CodexAPI {
    let baseURL: URL

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    convenience init() {
        let raw = ConfigStore.shared.serverBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: raw) else {
            self.init(baseURL: URL(string: "http://localhost:3123")!)
        }
        self.init(baseURL: url)
    }

    // MARK: status

    func status() async throws -> CodexStatus {
        return try await jsonGet("/api/status", CodexStatus.self)
    }

    // MARK: scan

    /// Send a JPEG as a data URL to the server's /api/scan.
    func scan(imageDataURL: String) async throws -> ScanResult {
        struct Body: Encodable { let imageDataUrl: String }
        return try await jsonPost("/api/scan", body: Body(imageDataUrl: imageDataURL), as: ScanResult.self)
    }

    /// Run OCR on the server when tesseract.js is installed; otherwise the
    /// server expects ocrText and will reject an image-only request.
    func scanWithOCR(imageDataURL: String) async throws -> ScanResult {
        return try await scan(imageDataURL: imageDataURL)
    }

    // MARK: collection

    func collection() async throws -> Collection {
        return try await jsonGet("/api/collection", Collection.self)
    }

    func addCard(name: String, qty: Int, condition: String = "NM") async throws -> CollectionEntry {
        struct Body: Encodable { let name: String; let qty: Int; let condition: String }
        return try await jsonPost("/api/collection/add", body: Body(name: name, qty: qty, condition: condition), as: CollectionEntry.self)
    }

    func setQty(name: String, qty: Int) async throws {
        struct Body: Encodable { let name: String; let qty: Int }
        let _: [String: Any?] = try await jsonPost("/api/collection/set", body: Body(name: name, qty: qty))
    }

    // MARK: cards

    func searchCards(query: String, limit: Int = 12) async throws -> [CardRecord] {
        guard var url = URL(string: "/api/cards/search", relativeTo: baseURL) else {
            throw CodexAPIError.network("bad URL")
        }
        url.appendPathComponent("/api/cards/search")
        var comps = URLComponents(url: url, resolvingAgainstBaseURL: true)
        comps?.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: String(limit)),
        ]
        guard let compURL = comps?.url else { throw CodexAPIError.network("bad URL") }
        return try await jsonGet(compURL.path + "?" + (comps?.query ?? ""), [CardRecord].self, base: nil)
    }

    func cardByName(name: String) async throws -> CardRecord {
        guard var url = URL(string: "/api/cards/get", relativeTo: baseURL) else {
            throw CodexAPIError.network("bad URL")
        }
        url.appendPathComponent("/api/cards/get")
        var comps = URLComponents(url: url, resolvingAgainstBaseURL: true)
        comps?.queryItems = [URLQueryItem(name: "name", value: name)]
        guard let compURL = comps?.url else { throw CodexAPIError.network("bad URL") }
        return try await jsonGet(compURL.path + "?" + (comps?.query ?? ""), CardRecord.self, base: nil)
    }

    // MARK: images (thumbnails / photos)

    func thumbURL(for name: String) -> URL {
        var comps = URLComponents(url: URL(string: "/api/cards/thumb", relativeTo: baseURL), resolvingAgainstBaseURL: true)
        comps?.queryItems = [URLQueryItem(name: "name", value: name)]
        return comps?.url ?? baseURL.appendingPathComponent("/api/cards/thumb?name=\(name.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? name)")
    }

    func photoURL(for filename: String) -> URL {
        return baseURL.appendingPathComponent("/api/photos/\(filename)")
    }

    // MARK: decks

    func decks() async throws -> [DeckRecord] {
        return try await jsonGet("/api/decks", [DeckRecord].self)
    }

    func deleteDeck(id: Int) async throws {
        let _: SuggestRecordResponse = try await jsonPost("/api/decks/\(id)", body: EmptyBody(), as: SuggestRecordResponse.self)
    }

    // MARK: suggest

    func suggest(format: String?, colors: [String]?) async throws -> SuggestResponse {
        return try await jsonPost("/api/suggest", body: SuggestRequest(format: format, colors: colors), as: SuggestResponse.self)
    }

    func recordSuggestion(deck: [DeckCard], colors: [String]) async throws {
        let _: SuggestRecordResponse = try await jsonPost("/api/suggest/record", body: SuggestRecordRequest(deck: deck, colors: colors), as: SuggestRecordResponse.self)
    }
}

// MARK: - low-level helpers

private extension CodexAPI {
    func jsonGet<T: Decodable>(_ path: String, _ type: T.Type, base: URL? = nil) async throws -> T {
        let url = (base ?? baseURL).appendingPathComponent(path)
        let (data, response) = try await URLSession.shared.data(from: url)
        guard let http = response as? HTTPURLResponse else {
            throw CodexAPIError.network("non-HTTP response")
        }
        if http.statusCode == 404 {
            let text = String(data: data, encoding: .utf8) ?? ""
            if text.contains("catalog not synced") || text.contains("not synced") {
                throw CodexAPIError.noCatalog
            }
        }
        guard (200...299).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let msg = json["error"] as? String {
                throw CodexAPIError.server(msg)
            }
            throw CodexAPIError.http(http.statusCode)
        }
        let decoder = JSONDecoder()
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw CodexAPIError.decode(error.localizedDescription)
        }
    }

    func jsonPost<B: Encodable, T: Decodable>(_ path: String, body: B, as type: T.Type) async throws -> T {
        let url = baseURL.appendingPathComponent(path)
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(body)
        let (data, response) = try await URLSession.shared.data(for: req)
        guard let http = response as? HTTPURLResponse else {
            throw CodexAPIError.network("non-HTTP response")
        }
        guard (200...299).contains(http.statusCode) else {
            let bodyStr = String(data: data, encoding: .utf8) ?? ""
            if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let msg = json["error"] as? String {
                throw CodexAPIError.server(msg)
            }
            throw CodexAPIError.http(http.statusCode)
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .deferredToDate
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw CodexAPIError.decode(error.localizedDescription)
        }
    }
}

private struct EmptyBody: Encodable {}
