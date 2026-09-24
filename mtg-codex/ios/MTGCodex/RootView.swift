import SwiftUI

// MARK: - Root view

struct RootView: View {
    @State private var selectedTab = 0

    var body: some View {
        TabView(selection: $selectedTab) {
            ScanView()
                .tabItem {
                    Label("Scan", systemImage: "camera.fill")
                }
                .tag(0)
            CollectionView()
                .tabItem {
                    Label("Collection", systemImage: "tray.full")
                }
                .tag(1)
            SettingsView()
                .tabItem {
                    Label("Settings", systemImage: "gearshape.fill")
                }
                .tag(2)
        }
    }
}

// MARK: - settings / server config

struct SettingsView: View {
    @StateObject private var store = ConfigStore.shared
    @State private var urlText: String = ""
    @State private var message: ToastMessage?

    var body: some View {
        NavigationStack {
            Form {
                Section("LAN server") {
                    TextField("http://<ip>:3123", text: $urlText)
                        .textContentType(.URL)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                    Button("Save server address") {
                        saveURL()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(urlText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    Text("The iPhone and the computer running the server must be on the same Wi-Fi. The server logs its LAN address when it starts.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Section("About") {
                    HStack {
                        Text("Endpoint")
                        Spacer()
                        Text(store.serverBaseURL.isEmpty ? "(not set)" : store.serverBaseURL)
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("Catalog synced")
                        Spacer()
                        Text(store.catalogSynced ? "yes" : "no")
                            .foregroundColor(store.catalogSynced ? .green : .secondary)
                    }
                }
            }
            .navigationTitle("Settings")
            .onAppear { urlText = store.serverBaseURL }
        }
        .alert("Saved", isPresented: .constant(message?.isError == false && message?.text.contains("Saved") == true)) {
            Button("OK", action: { message = nil })
        } message: {
            Text(message?.text ?? "")
        }
    }

    private func saveURL() {
        let v = urlText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let _ = URL(string: v) else {
            message = ToastMessage(text: "That doesn't look like a URL.", isError: true)
            return
        }
        store.serverBaseURL = v
        message = ToastMessage(text: "Saved: \(v)", isError: false)
        urlText = v
    }
}
