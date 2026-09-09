// swift-tools-version: 5.9
// axt-helper: local OCR helper for arXiv HTML Translator (DESIGN §15).
// No third-party dependencies; Vision and ImageIO are system frameworks linked on import.
import PackageDescription

let package = Package(
  name: "axt-helper",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(name: "axt-helper", path: "Sources/axt-helper"),
  ]
)
