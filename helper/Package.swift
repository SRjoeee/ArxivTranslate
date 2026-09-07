// swift-tools-version: 5.9
// axt-helper：arXiv HTML Translator 的本机 OCR 助手（DESIGN §15）。
// 无第三方依赖；Vision 与 ImageIO 是系统框架，import 即链接。
import PackageDescription

let package = Package(
  name: "axt-helper",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(name: "axt-helper", path: "Sources/axt-helper"),
  ]
)
