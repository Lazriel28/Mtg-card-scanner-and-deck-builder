import Foundation

/// Persisted app config: the LAN server base URL and whether we've seen a
/// synced catalog yet. Saved in UserDefaults so the iPhone keeps the server
/// address between launches.
final class ConfigStore: ObservableObject {
    static let shared = ConfigStore()

    @Published var serverBaseURL: String {
        didSet { defaults.set(serverBaseURL, forKey: Key.baseURL) }
    }

    @Published var catalogSynced: Bool {
        didSet { defaults.set(catalogSynced, forKey: Key.synced) }
    }

    private let defaults: UserDefaults

    private init() {
        defaults = .standard
        self.serverBaseURL = defaults.string(forKey: Key.baseURL) ?? ""
        self.catalogSynced = defaults.bool(forKey: Key.synced)
    }

    private enum Key {
        static let baseURL = "serverBaseURL"
        static let synced = "catalogSynced"
    }
}

extension ConfigStore {
    /// Reset to the defaults a first-launch user would see.
    func reset() {
        serverBaseURL = ""
        catalogSynced = false
    }
}
