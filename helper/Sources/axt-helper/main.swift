// 移植自 reference/macos-vision-ocr/Sources/ocr.swift@91a236a（MIT，Copyright (c) 2024 bytefer），2026-09-07 移植、有修改：
// 去掉命令行参数、批处理与调试画框，改成 Chrome Native Messaging 的 stdio 帧循环（4 字节本机字节序长度前缀 + JSON）；
// 图片从 base64 解码而不是读文件（走 ImageIO，不依赖 AppKit）；四角输出改成 [[x, y] × 4]；加 ping 与错误信封。
// 上游的 MIT 许可与免责声明全文在 helper/LICENSE-macos-vision-ocr.txt，随源码与二进制一起分发（MIT 的条件）。
// 协议见 docs/DESIGN.md §15.3。
import Foundation
import ImageIO
import Vision

let VERSION = "0.1.0"
let PROTOCOL = 1

enum HelperError: Error {
  case badBase64
  case undecodableImage
  case badRequest(String)
  case unsupportedProtocol(Any?)

  var code: String {
    switch self {
    case .badBase64: return "bad-base64"
    case .undecodableImage: return "undecodable-image"
    case .badRequest: return "bad-request"
    case .unsupportedProtocol: return "unsupported-protocol"
    }
  }

  var message: String {
    switch self {
    case .badBase64: return "image 不是合法的 base64"
    case .undecodableImage: return "ImageIO 解不开这张图"
    case .badRequest(let why): return why
    case .unsupportedProtocol(let v): return "协议版本 \(v.map { "\($0)" } ?? "缺失")，本 helper 只支持 \(PROTOCOL)"
    }
  }
}

// MARK: - 帧读写（Chrome Native Messaging：长度是本机字节序的 UInt32）

func readFrame() -> Data? {
  let header = FileHandle.standardInput.readData(ofLength: 4)
  if header.count < 4 { return nil } // EOF：Chrome 断开端口
  var length: UInt32 = 0
  _ = withUnsafeMutableBytes(of: &length) { header.copyBytes(to: $0) }
  if length == 0 { return Data() }
  var body = Data()
  while body.count < Int(length) {
    let chunk = FileHandle.standardInput.readData(ofLength: Int(length) - body.count)
    if chunk.isEmpty { return nil }
    body.append(chunk)
  }
  return body
}

func writeFrame(_ object: [String: Any]) {
  guard let json = try? JSONSerialization.data(withJSONObject: object) else { return }
  var length = UInt32(json.count)
  let header = Data(bytes: &length, count: 4)
  FileHandle.standardOutput.write(header)
  FileHandle.standardOutput.write(json)
}

// MARK: - OCR（Vision 调用照原版：accurate、语言纠错、最新 revision）

func clamp(_ value: CGFloat) -> Double {
  return Double(max(0, min(1, value)))
}

func recognize(base64: String, languages: [String]) throws -> [String: Any] {
  guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else { throw HelperError.badBase64 }
  guard let source = CGImageSourceCreateWithData(data as CFData, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw HelperError.undecodableImage }
  // JPEG / TIFF 的旋转存在 EXIF 里：像素是存储方向，浏览器显示的是转正后的。方向传给 Vision，
  // 它返回的坐标就是转正后那张图的归一化坐标；宽高也按显示方向报（5–8 是转了 90°，对调）。
  // 不传的话识别的是躺着的图，叠加层整个错位（Codex 在 #87 指出）
  let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any]
  let orientationRaw = properties?[kCGImagePropertyOrientation] as? UInt32 ?? 1
  let orientation = CGImagePropertyOrientation(rawValue: orientationRaw) ?? .up
  let swapped = orientationRaw >= 5
  let width = swapped ? image.height : image.width
  let height = swapped ? image.width : image.height

  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = true
  request.recognitionLanguages = languages
  if let latest = VNRecognizeTextRequest.supportedRevisions.max() { request.revision = latest }
  // 曲线图的刻度与图例很小；原版 0.01 会漏掉不到图高 1% 的字
  request.minimumTextHeight = 0.008

  let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
  try handler.perform([request])

  var lines: [[String: Any]] = []
  for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    // Vision 的坐标原点在左下；扩展侧按左上原点画，这里翻 y。顺序：左上、右上、右下、左下
    let quad: [[Double]] = [observation.topLeft, observation.topRight, observation.bottomRight, observation.bottomLeft]
      .map { [clamp($0.x), clamp(1 - $0.y)] }
    lines.append(["text": candidate.string, "quad": quad, "conf": Double(observation.confidence)])
  }
  return ["width": width, "height": height, "lines": lines]
}

// MARK: - 主循环

if CommandLine.arguments.contains("--version") {
  print(VERSION)
  exit(0)
}

while let frame = readFrame() {
  let parsed = (try? JSONSerialization.jsonObject(with: frame)) as? [String: Any]
  let id = parsed?["id"] as? String ?? ""
  var reply: [String: Any] = ["v": PROTOCOL, "id": id]
  do {
    guard let request = parsed, let cmd = request["cmd"] as? String else { throw HelperError.badRequest("请求不是带 cmd 的 JSON 对象") }
    // 扩展与 helper 分开安装，版本可能对不上：协议号不一致就拒，让扩展侧按握手失败处理（Codex 在 #87 指出）
    guard let version = request["v"] as? Int, version == PROTOCOL else { throw HelperError.unsupportedProtocol(request["v"]) }
    switch cmd {
    case "ping":
      reply["ok"] = true
      reply["version"] = VERSION
    case "ocr":
      guard let image = request["image"] as? String else { throw HelperError.badRequest("ocr 请求缺 image") }
      let languages = request["langs"] as? [String] ?? ["en-US"]
      for (key, value) in try recognize(base64: image, languages: languages) { reply[key] = value }
    default:
      throw HelperError.badRequest("未知命令 \(cmd)")
    }
  } catch let error as HelperError {
    reply["error"] = ["code": error.code, "message": error.message]
  } catch {
    reply["error"] = ["code": "vision", "message": error.localizedDescription]
  }
  writeFrame(reply)
}
