// swift-tools-version: 5.9
// axt-helper: the local OCR helper of arXiv HTML Translator (DESIGN §15).
// No third-party dependencies; Vision and ImageIO are system frameworks, linked by import.
import PackageDescription

let package = Package(
  name: "axt-helper",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(name: "axt-helper", path: "Sources/axt-helper"),
  ]
)
