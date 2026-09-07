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
/// Chrome 对 helper → 扩展的单条消息上限是 1 MB，超了整条连接被断、排队的活全作废。
/// 实际取 250 KB：扩展的缓存单条上限是 256 KiB（cache/store.ts 的 maxEntryBytes），比它大的结果每次都要重识别（Codex 在 #87 指出）
let MAX_REPLY_BYTES = 250_000
/// Vision 的文字识别模型版本：换了它识别结果会变，所以进 helper 报的版本、进扩展的 OCR 缓存键
let VISION_REVISION = VNRecognizeTextRequest.supportedRevisions.max() ?? 0
/// 报给扩展的版本 = 程序版本 + Vision revision；系统升级换了模型，旧缓存自然失效
let REPORTED_VERSION = "\(VERSION)+vision\(VISION_REVISION)"

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

/// 读满 n 字节；管道一次可能只给一部分（合法的短读），读到 EOF 返回 nil
func readExactly(_ n: Int) -> Data? {
  var buffer = Data()
  while buffer.count < n {
    let chunk = FileHandle.standardInput.readData(ofLength: n - buffer.count)
    if chunk.isEmpty { return nil } // EOF：Chrome 断开端口
    buffer.append(chunk)
  }
  return buffer
}

func readFrame() -> Data? {
  // 长度前缀也要读满：短读 1–3 字节时当 EOF 退出，会让排队的识别全部作废（Codex 在 #87 指出）
  guard let header = readExactly(4) else { return nil }
  var length: UInt32 = 0
  _ = withUnsafeMutableBytes(of: &length) { header.copyBytes(to: $0) }
  if length == 0 { return Data() }
  return readExactly(Int(length))
}

/// 序列化；超过上限就按置信度从低到高丢行，直到装得下（正常一张图几 KB，只有极端文字密集的图会撞到）
func encode(_ object: [String: Any]) -> Data? {
  guard var json = try? JSONSerialization.data(withJSONObject: object) else { return nil }
  guard json.count > MAX_REPLY_BYTES, var lines = object["lines"] as? [[String: Any]] else { return json }
  var reply = object
  lines.sort { ($0["conf"] as? Double ?? 0) > ($1["conf"] as? Double ?? 0) }
  while json.count > MAX_REPLY_BYTES && !lines.isEmpty {
    lines.removeLast(max(1, lines.count / 10))
    reply["lines"] = lines
    reply["truncated"] = true
    guard let again = try? JSONSerialization.data(withJSONObject: reply) else { return nil }
    json = again
  }
  return json
}

func writeFrame(_ object: [String: Any]) {
  guard let json = encode(object) else { return }
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
  // 动图（GIF / APNG / 动态 WebP）只解第 0 帧，浏览器却在放后面的帧：帧数报给扩展，多帧的不叠译文（Codex 在 #89 指出）
  let frames = CGImageSourceGetCount(source)
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
  if VISION_REVISION > 0 { request.revision = VISION_REVISION }
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
  return ["width": width, "height": height, "frames": frames, "lines": lines]
}

// MARK: - 主循环

if CommandLine.arguments.contains("--version") {
  print(REPORTED_VERSION)
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
      reply["version"] = REPORTED_VERSION
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
