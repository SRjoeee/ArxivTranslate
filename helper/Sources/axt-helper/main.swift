// Ported from reference/macos-vision-ocr/Sources/ocr.swift@91a236a (MIT, Copyright (c) 2024 bytefer), ported 2026-09-07, modified:
// command-line arguments, batching and debug drawing removed, replaced by Chrome Native Messaging's stdio frame loop (a 4-byte native-endian length prefix + JSON);
// the image is decoded from base64 rather than read from a file (through ImageIO, no AppKit dependency); the corners are output as [[x, y] × 4]; ping and error envelopes added.
// The upstream MIT licence and disclaimer are in full in helper/LICENSE-macos-vision-ocr.txt, distributed with the sources and the binary (MIT's condition).
// The protocol is in docs/DESIGN.md §15.3.
import Foundation
import ImageIO
import Vision

let VERSION = "0.1.0"
let PROTOCOL = 1
/// Chrome caps one helper → extension message at 1 MB; over it the whole connection is cut and everything queued is lost.
/// 250 KB is used: the extension's cache caps one entry at 256 KiB (maxEntryBytes in cache/store.ts), and a larger result would be recognised again every time (Codex on #87)
let MAX_REPLY_BYTES = 250_000
/// The version of Vision's text recognition model: a change alters the results, so it enters the version the helper reports and the extension's OCR cache key
let VISION_REVISION = VNRecognizeTextRequest.supportedRevisions.max() ?? 0
/// The version reported to the extension = program version + Vision revision; a system upgrade that swaps the model expires the old cache of itself
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
    case .undecodableImage: return "ImageIO cannot decode this image"
    case .badRequest(let why): return why
    case .unsupportedProtocol(let v): return "protocol version \(v.map { "\($0)" } ?? "missing"); this helper supports \(PROTOCOL) only"
    }
  }
}

// MARK: - Frame I/O (Chrome Native Messaging: the length is a native-endian UInt32)

/// Read exactly n bytes; a pipe may hand over only part at a time (a legitimate short read); nil at EOF
func readExactly(_ n: Int) -> Data? {
  var buffer = Data()
  while buffer.count < n {
    let chunk = FileHandle.standardInput.readData(ofLength: n - buffer.count)
    if chunk.isEmpty { return nil } // // EOF: Chrome closed the port
    buffer.append(chunk)
  }
  return buffer
}

func readFrame() -> Data? {
  // The length prefix has to be read in full too: treating a 1–3 byte short read as EOF would void every queued recognition (Codex on #87)
  guard let header = readExactly(4) else { return nil }
  var length: UInt32 = 0
  _ = withUnsafeMutableBytes(of: &length) { header.copyBytes(to: $0) }
  if length == 0 { return Data() }
  return readExactly(Int(length))
}

/// Serialise; over the cap, drop lines by ascending confidence until it fits (an ordinary image is a few KB; only an extremely text-dense one hits this)
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

// MARK: - OCR (the Vision call as upstream: accurate, language correction, the latest revision)

func clamp(_ value: CGFloat) -> Double {
  return Double(max(0, min(1, value)))
}

func recognize(base64: String, languages: [String]) throws -> [String: Any] {
  guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters) else { throw HelperError.badBase64 }
  guard let source = CGImageSourceCreateWithData(data as CFData, nil),
        let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { throw HelperError.undecodableImage }
  // Animations (GIF / APNG / animated WebP) decode frame 0 only while the browser plays the later frames: the frame count goes to the extension, and multi-frame images get no overlay (Codex on #89)
  let frames = CGImageSourceGetCount(source)
  // JPEG / TIFF rotation lives in EXIF: the pixels are in storage orientation, the browser displays the upright image. The orientation is passed to Vision,
  // so the coordinates it returns are normalised to the upright image; the width and height are reported in display orientation too (5–8 are rotated 90°, swapped).
  // Without it the recognition runs on the image lying on its side, and the whole overlay is misplaced (Codex on #87)
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
  // The ticks and legends of a chart are tiny; upstream's 0.01 misses text under 1% of the image height
  request.minimumTextHeight = 0.008

  let handler = VNImageRequestHandler(cgImage: image, orientation: orientation, options: [:])
  try handler.perform([request])

  var lines: [[String: Any]] = []
  for observation in request.results ?? [] {
    guard let candidate = observation.topCandidates(1).first else { continue }
    // Vision's origin is bottom-left; the extension draws from a top-left origin, so y is flipped here. Order: top-left, top-right, bottom-right, bottom-left
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
    guard let request = parsed, let cmd = request["cmd"] as? String else { throw HelperError.badRequest("the request is not a JSON object with a cmd") }
    // The extension and the helper are installed separately and their versions may disagree: a protocol mismatch is refused, and the extension side treats it as a failed handshake (Codex on #87)
    guard let version = request["v"] as? Int, version == PROTOCOL else { throw HelperError.unsupportedProtocol(request["v"]) }
    switch cmd {
    case "ping":
      reply["ok"] = true
      reply["version"] = REPORTED_VERSION
    case "ocr":
      guard let image = request["image"] as? String else { throw HelperError.badRequest("the ocr request lacks image") }
      let languages = request["langs"] as? [String] ?? ["en-US"]
      for (key, value) in try recognize(base64: image, languages: languages) { reply[key] = value }
    default:
      throw HelperError.badRequest("unknown command \(cmd)")
    }
  } catch let error as HelperError {
    reply["error"] = ["code": error.code, "message": error.message]
  } catch {
    reply["error"] = ["code": "vision", "message": error.localizedDescription]
  }
  writeFrame(reply)
}
