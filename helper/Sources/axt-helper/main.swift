// Ported from reference/macos-vision-ocr/Sources/ocr.swift@91a236a (MIT, Copyright (c) 2024 bytefer), 2026-09-07; modified:
// Replaced CLI arguments, batch processing and debug boxes with a Chrome Native Messaging stdio loop (4-byte native-endian length prefix + JSON).
// Decode base64 images via ImageIO instead of reading files, without AppKit; corners use [[x, y] × 4]; added ping and error envelopes.
// Full upstream MIT license/disclaimer in helper/LICENSE-macos-vision-ocr.txt, distributed with source and binary as required by MIT.
// Protocol: docs/DESIGN.md §15.3.
import Foundation
import ImageIO
import Vision

let VERSION = "0.1.0"
let PROTOCOL = 1
/// Chrome limits helper → extension messages to 1 MB; exceeding it disconnects the port and invalidates all queued work.
/// Use 250 KB: the extension cache caps entries at 256 KiB (cache/store.ts maxEntryBytes); larger results would require OCR every time (Codex #87).
let MAX_REPLY_BYTES = 250_000
/// Vision text-recognition model revision affects results, so include it in the helper version and OCR cache keys.
let VISION_REVISION = VNRecognizeTextRequest.supportedRevisions.max() ?? 0
/// Reported version = program version + Vision revision; model changes after OS upgrades invalidate old cache entries.
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
    case .badBase64: return "image is not valid base64"
    case .undecodableImage: return "ImageIO could not decode this image"
    case .badRequest(let why): return why
    case .unsupportedProtocol(let v): return "Protocol version \(v.map { "\($0)" } ?? "missing"); this helper supports only \(PROTOCOL)"
    }
  }
}

// MARK: - Framing (Chrome Native Messaging: native-endian UInt32 length)

/// Read exactly n bytes, handling valid short pipe reads; return nil on EOF.
func readExactly(_ n: Int) -> Data? {
  var buffer = Data()
  while buffer.count < n {
    let chunk = FileHandle.standardInput.readData(ofLength: n - buffer.count)
    if chunk.isEmpty { return nil } // EOF: Chrome disconnected the port.
    buffer.append(chunk)
  }
  return buffer
}

func readFrame() -> Data? {
  // Read the complete length prefix too: treating a 1–3-byte short read as EOF would invalidate all queued OCR (Codex #87).
  guard let header = readExactly(4) else { return nil }
  var length: UInt32 = 0
  _ = withUnsafeMutableBytes(of: &length) { header.copyBytes(to: $0) }
  if length == 0 { return Data() }
  return readExactly(Int(length))
}

/// Serialize; if oversized, discard lowest-confidence lines until it fits (normally a few KB; only exceptionally text-dense images reach this limit).
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

// MARK: - OCR (upstream Vision settings: accurate, language correction, latest revision)

func clamp(_ value: CGFloat) -> Double {
  return Double(max(0, min(1, value)))
}

func recognize(base64: String, languages: [String]) throws -> [String: Any] {
  guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else { throw HelperError.badBase64 }
  guard let source = CGImageSourceCreateWithData(data as CFData, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw HelperError.undecodableImage }
  // Animated GIF/APNG/WebP decodes only frame 0 while the browser advances; report frame count so the extension skips overlays (Codex #89).
  let frames = CGImageSourceGetCount(source)
  // JPEG/TIFF rotation is stored in EXIF: pixels use storage orientation, browsers show the upright image. Pass orientation to Vision
  // for normalized upright coordinates; report dimensions in display orientation too (5–8 rotate 90°, swapping width/height).
  // Without orientation, recognition reads a sideways image and overlays misalign (Codex #87).
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
  // Plot ticks/legends are small; upstream 0.01 misses text below 1% of image height.
  request.minimumTextHeight = 0.008

  let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
  try handler.perform([request])

  var lines: [[String: Any]] = []
  for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    // Vision uses a bottom-left origin; flip y for the extension's top-left origin. Order: top-left, top-right, bottom-right, bottom-left.
    let quad: [[Double]] = [observation.topLeft, observation.topRight, observation.bottomRight, observation.bottomLeft]
      .map { [clamp($0.x), clamp(1 - $0.y)] }
    lines.append(["text": candidate.string, "quad": quad, "conf": Double(observation.confidence)])
  }
  return ["width": width, "height": height, "frames": frames, "lines": lines]
}

// MARK: - Main loop

if CommandLine.arguments.contains("--version") {
  print(REPORTED_VERSION)
  exit(0)
}

while let frame = readFrame() {
  let parsed = (try? JSONSerialization.jsonObject(with: frame)) as? [String: Any]
  let id = parsed?["id"] as? String ?? ""
  var reply: [String: Any] = ["v": PROTOCOL, "id": id]
  do {
    guard let request = parsed, let cmd = request["cmd"] as? String else { throw HelperError.badRequest("Request must be a JSON object with cmd") }
    // Extension/helper installations are independent; reject mismatched protocol versions so the extension treats them as handshake failures (Codex #87).
    guard let version = request["v"] as? Int, version == PROTOCOL else { throw HelperError.unsupportedProtocol(request["v"]) }
    switch cmd {
    case "ping":
      reply["ok"] = true
      reply["version"] = REPORTED_VERSION
    case "ocr":
      guard let image = request["image"] as? String else { throw HelperError.badRequest("ocr request is missing image") }
      let languages = request["langs"] as? [String] ?? ["en-US"]
      for (key, value) in try recognize(base64: image, languages: languages) { reply[key] = value }
    default:
      throw HelperError.badRequest("Unknown command \(cmd)")
    }
  } catch let error as HelperError {
    reply["error"] = ["code": error.code, "message": error.message]
  } catch {
    reply["error"] = ["code": "vision", "message": error.localizedDescription]
  }
  writeFrame(reply)
}
