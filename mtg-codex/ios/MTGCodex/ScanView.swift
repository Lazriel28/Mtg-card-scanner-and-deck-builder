import SwiftUI
import AVFoundation
import PhotosUI

// MARK: - Scan view (AVFoundation camera → /api/scan → add to collection)

struct ScanView: View {
    @StateObject private var session = CameraSession()
    @State private var capturedImage: UIImage?
    @State private var result: ScanResult?
    @State private var candidates: [Candidate] = []
    @State private var statusText = "Starting camera…"
    @State private var isProcessing = false
    @State private var message: ToastMessage?

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                cameraBlock
                actionBlock
                candidatesBlock
                manualBlock
            }
            .padding()
            .navigationTitle("Scan")
            .onAppear { session.start() }
            .onDisappear { session.stop() }
            .task {
                await refreshStatus()
            }
        }
        .alert("Couldn't read the card", isPresented: .constant(message?.isError == true)) {
            Button("OK") { message = nil }
        } message: {
            Text(message?.text ?? "")
        }
        .overlay {
            if capturedImage != nil {
                capturedOverlay
            }
        }
    }

    // MARK: camera

    private var cameraBlock: some View {
        VStack(spacing: 10) {
            // The camera preview lives in a UIKit controller bridged here.
            CameraPreview(session: session) { img in
                withAnimation {
                    capturedImage = img
                    statusText = "Captured — reading the card…"
                }
                Task { await runScan(image: img) }
            }
            .frame(height: 340)
            .background(Color.black)
            .cornerRadius(14)
            .overlay(Alignment(.topLeading)) {
                if session.warning != nil {
                    warningBadge
                } else {
                    cardFrameHint
                }
            }
            .overlay(Alignment(.bottom)) {
                if capturedImage != nil {
                    capturedLabel
                }
            }
            .clipped()

            if session.warning != nil {
                Text(session.warning!)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }
        }
    }

    private var warningBadge: some View {
        Text(session.warning!)
            .font(.caption)
            .padding(8)
            .frame(maxWidth: .infinity)
            .background(.ultraThinMaterial)
            .cornerRadius(10)
    }

    private var cardFrameHint: some View {
        HStack {
            Spacer()
            Text("fit the card in frame")
                .font(.caption)
                .foregroundColor(.primary)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(.black.opacity(0.55))
                .cornerRadius(8)
            Spacer()
        }
        .padding(.bottom, 12)
    }

    private var capturedLabel: some View {
        HStack {
            Spacer()
            Text("captured")
                .font(.caption)
                .foregroundColor(.white)
                .padding(.horizontal, 10)
                .padding(.vertical, 4)
                .background(.black.opacity(0.6))
                .cornerRadius(8)
            Spacer()
        }
        .padding(.bottom, 12)
    }

    private var capturedOverlay: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()
            VStack {
                Text("Captured")
                    .font(.title2)
                    .foregroundColor(.white)
                if let img = capturedImage {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFit()
                        .frame(maxHeight: 220)
                        .cornerRadius(12)
                        .padding()
                }
                HStack(spacing: 12) {
                    Button("Retake") {
                        withAnimation { capturedImage = nil; result = nil; candidates = [] }
                    }
                    .buttonStyle(.borderedProminent)
                    Button("Keep & read") {
                        if let img = capturedImage { Task { await runScan(image: img) } }
                    }
                    .buttonStyle(.borderedProminent)
                }
                Spacer()
            }
        }
    }

    // MARK: actions

    private var actionBlock: some View {
        VStack(spacing: 10) {
            if isProcessing {
                ProgressView()
                    .frame(maxWidth: .infinity)
                Text(statusText)
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            } else {
                HStack(spacing: 12) {
                    Button(action: capture) {
                        Label("Capture card", systemImage: "camera.fill")
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(session.warning != nil)
                    Button {
                        session.startPhotoLibraryPicker()
                    } label: {
                        Label("Photo library", systemImage: "photo.on.rectangle")
                    }
                    .buttonStyle(.bordered)

                    PhotosPicker(selection: $session.photoLibraryItem, matching: .images) {
                        Label("Pick photo", systemImage: "photo")
                    }
                    .buttonStyle(.bordered)
                    .onChange(of: session.photoLibraryItem) { _, item in
                        guard let item else { return }
                        Task {
                            if let data = try? await item.loadTransferable(type: Data.self),
                               let img = UIImage(data: data) {
                                await MainActor.run {
                                    capturedImage = img
                                    statusText = "Reading the card…"
                                }
                                await runScan(image: img)
                            }
                        }
                    }
                }
            }
        }
    }

    // MARK: candidates

    private var candidatesBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            if !candidates.isEmpty {
                Text("Tap a card to add it to your collection")
                    .font(.subheadline)
                    .foregroundColor(.secondary)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    if candidates.isEmpty && !isProcessing && capturedImage != nil {
                        Text("No confident match — type the name below, or retake the photo.")
                            .font(.subheadline)
                            .foregroundColor(.secondary)
                            .frame(maxWidth: .infinity)
                    }
                    ForEach(candidates) { cand in
                        CandidateChip(candidate: cand) {
                            addCandidate(cand)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var manualBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("or enter the name manually")
                .font(.subheadline)
                .foregroundColor(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack {
                TextField("Card name", text: .constant(""))
                    .textFieldStyle(.roundedBorder)
                    .disabled(true)
                Button("Look up") {
                    // In a full app this would search /api/cards/search.
                    // For MVP we rely on the scan flow; manual lookup can be added
                    // after the camera path is solid.
                }
                .buttonStyle(.bordered)
                .disabled(true)
            }
        }
    }

    // MARK: logic

    private func refreshStatus() async {
        do {
            let s = try await CodexAPI().status()
            await MainActor.run {
                if !s.catalog.synced {
                    statusText = "Catalog not synced yet — sync the server first."
                } else if session.warning == nil {
                    statusText = "Ready. Point the camera at the card and capture."
                }
                ConfigStore.shared.catalogSynced = s.catalog.synced
            }
        } catch {
            // Best-effort; leave status text alone.
        }
    }

    private func capture() {
        session.capture()
    }

    private func runScan(image: UIImage) async {
        isProcessing = true
        statusText = "Sending photo to server…"
        defer { isProcessing = false }

        guard let jpeg = image.jpegData(compressionQuality: 0.85) else {
            statusText = "Couldn't encode the photo."
            return
        }

        // /api/scan expects a base64 data URL.
        let base64 = jpeg.base64EncodedString()
        let dataURL = "data:image/jpeg;base64,\(base64)"

        do {
            let r = try await CodexAPI().scan(imageDataURL: dataURL)
            await MainActor.run {
                self.result = r
                self.candidates = r.candidates
                if r.candidates.isEmpty {
                    statusText = "No confident match — check lighting and retake, or enter the name below."
                } else {
                    statusText = "Found \(r.candidates.count) candidate(s)."
                }
            }
        } catch let err as CodexAPIError {
            await MainActor.run {
                statusText = err.localizedDescription
                message = ToastMessage(text: err.localizedDescription, isError: true)
            }
        } catch {
            await MainActor.run {
                statusText = "Scan failed: \(error.localizedDescription)"
                message = ToastMessage(text: error.localizedDescription, isError: true)
            }
        }
    }

    private func addCandidate(_ cand: Candidate) {
        Task {
            do {
                _ = try await CodexAPI().addCard(name: cand.name, qty: 1, condition: "NM")
                await MainActor.run {
                    message = ToastMessage(text: "Added \(cand.name) to collection", isError: false)
                    capturedImage = nil
                    result = nil
                    candidates = []
                    statusText = "Ready. Point the camera at the next card."
                    Task { await refreshStatus() }
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
}

// MARK: - toast

struct ToastMessage {
    let text: String
    let isError: Bool
}

// MARK: - candidate chip

struct CandidateChip: View {
    let candidate: Candidate
    let onAdd: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            AsyncImage(url: CodexAPI().thumbURL(for: candidate.name)) { phase in
                switch phase {
                case .empty: ProgressView().frame(width: 54, height: 76)
                case .success(let img): img.resizable().scaledToFit()
                case .failure: fallbackPlaceholder
                @unknown default: fallbackPlaceholder
                }
            }
            .frame(width: 54, height: 76)
            .cornerRadius(8)
            Text(candidate.name)
                .font(.subheadline)
                .fontWeight(.medium)
                .lineLimit(2)
            Text(candidate.confidencePercent)
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .padding(8)
        .frame(width: 120)
        .background(Color(.secondarySystemGroupedBackground))
        .cornerRadius(12)
        .overlay(Alignment(.bottomTrailing)) {
            Button(action: onAdd) {
                Image(systemName: "plus.circle.fill")
                    .font(.title3)
                    .foregroundColor(.accentColor)
            }
        }
    }

    private var fallbackPlaceholder: some View {
        ZStack {
            Color(.systemGray5)
            Image(systemName: "figure.card.customerid")
                .font(.largeTitle)
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - camera preview (UIKit → SwiftUI)

struct CameraPreview: UIViewControllerRepresentable {
    let session: CameraSession
    let onCapture: (UIImage) -> Void

    func makeUIViewController(context: Context) -> CameraViewController {
        let vc = CameraViewController(session: session)
        vc.onCapture = onCapture
        context.coordinator.vc = vc
        return vc
    }

    func updateUIViewController(_ vc: CameraViewController, context: Context) {
        vc.onCapture = onCapture
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    class Coordinator: NSObject {
        var vc: CameraViewController?
    }
}

// MARK: - camera view controller (AVFoundation)

final class CameraViewController: UIViewController {
    let session: CameraSession
    var onCapture: ((UIImage) -> Void)?

    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var captureButton: UIButton?

    init(session: CameraSession) {
        self.session = session
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        previewLayer = AVCaptureVideoPreviewLayer(session: session.captureSession)
        previewLayer?.videoGravity = .resizeAspectFill
        previewLayer?.frame = view.bounds
        if let layer = previewLayer {
            view.layer.addSublayer(layer)
        }
        // a capture button below the preview
        let btn = UIButton(type: .system)
        btn.setImage(UIImage(systemName: "camera.fill"), for: .normal)
        btn.tintColor = .white
        btn.backgroundColor = .accentColor.withAlphaComponent(0.9)
        btn.layer.cornerRadius = 34
        btn.addTarget(self, action: #selector(didTapCapture), for: .touchUpInside)
        btn.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(btn)
        captureButton = btn
        NSLayoutConstraint.activate([
            btn.widthAnchor.constraint(equalToConstant: 68),
            btn.heightAnchor.constraint(equalToConstant: 68),
            btn.centerXAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerXAnchor),
            btn.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -24),
        ])
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    @objc private func didTapCapture() {
        session.capture { [weak self] img in
            self?.onCapture?(img)
        }
    }
}

// MARK: - camera session (AVFoundation)

@MainActor
final class CameraSession: NSObject, ObservableObject {
    let captureSession = AVCaptureSession()
    private var videoDevice: AVCaptureDevice?
    private var videoOutput: AVCaptureVideoDataOutput?
    private var photoOutput: AVCapturePhotoOutput?
    private var photoCaptureDelegate: PhotoCaptureDelegate?
    @Published var warning: String?
    @Published var photoLibraryItem: PhotosPickerItem?

    struct PhotoCaptureDelegate: NSObject, AVCapturePhotoCaptureDelegate {
        let completion: (UIImage?) -> Void
        func photoOutput(_ output: AVCapturePhotoOutput, didFinishProcessingPhoto photo: AVCapturePhoto, error: Error?) {
            if let error { completion(nil); return }
            guard let data = photo.fileDataRepresentation(),
                  let img = UIImage(data: data) else { completion(nil); return }
            completion(img)
        }
    }

    override init() {
        super.init()
    }

    func start() {
        captureSession.beginConfiguration()
        captureSession.sessionPreset = .photo

        // Video
        guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            warning = "No rear camera found on this device."
            captureSession.commitConfiguration()
            return
        }
        videoDevice = device
        guard let videoInput = try? AVCaptureDeviceInput(device: device) else {
            warning = "Couldn't open the rear camera."
            captureSession.commitConfiguration()
            return
        }
        if captureSession.canAddInput(videoInput) {
            captureSession.addInput(videoInput)
        } else {
            warning = "Couldn't add the camera input."
            captureSession.commitConfiguration()
            return
        }

        // Still photo
        let photoOutput = AVCapturePhotoOutput()
        if captureSession.canAddOutput(photoOutput) {
            captureSession.addOutput(photoOutput)
            self.photoOutput = photoOutput
        } else {
            warning = "Couldn't add the photo output."
            captureSession.commitConfiguration()
            return
        }

        // Live preview
        let videoOutput = AVCaptureVideoDataOutput()
        videoOutput.setSampleBufferDelegate(nil, queue: .main)
        if captureSession.canAddOutput(videoOutput) {
            captureSession.addOutput(videoOutput)
            self.videoOutput = videoOutput
        }

        captureSession.commitConfiguration()

        if captureSession.isRunning { return }
        DispatchQueue.global(qos: .userInitiated).async {
            self.captureSession.startRunning()
        }
    }

    func stop() {
        guard captureSession.isRunning else { return }
        captureSession.stopRunning()
    }

    func capture(_ done: @escaping (UIImage) -> Void = { _ in }) {
        guard let output = photoOutput else {
            warning = "Camera not ready."
            done(UIImage())
            return
        }
        let delegate = PhotoCaptureDelegate { img in
            DispatchQueue.main.async { done(img) }
        }
        photoCaptureDelegate = delegate
        let settings = AVCapturePhotoSettings()
        if #available(iOS 13.0, *) {
            settings.photoQualityPrioritization = .quality
        }
        if let conn = output.connection(for: .video) {
            output.capturePhoto(with: settings, delegate: delegate)
        } else {
            output.capturePhoto(with: settings, delegate: delegate)
        }
    }

    func startPhotoLibraryPicker() {
        // Handled by the PhotosPicker binding in the parent view.
    }
}
