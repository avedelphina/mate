// mate-assist: one question to the on-device model, one answer. And the text of a PDF.
//
// Electron cannot call Apple's Foundation Models framework. This helper can.
// It keeps no state and knows nothing about Mate: the app decides what to ask.
//
//   stdin   {"instructions": "...", "prompt": "..."}
//   stdout  {"text": "..."}  or  {"error": "..."}
//
// With --check it only reports whether the model can be used:
//   stdout  {"available": true}  or  {"available": false, "reason": "..."}

import Foundation
import FoundationModels
import PDFKit
import Vision

func answer(_ value: [String: Any]) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(0)
}

// With --pdf it takes the bytes of a PDF on stdin and gives its text, with PDFKit. A page with no
// text is a picture of one, as a scanner makes it: its text is read off the picture by Vision, on
// this Mac. It needs no model of Mate's, and is never given a path: it reads only what it is handed.
//   stdout  {"text": "...", "recognised": pages read off a picture}  or  {"error": "..."}
func recognise(_ page: PDFPage) -> String {
  let bounds = page.bounds(for: .mediaBox)
  // Three times the size of the page. At twice, the marks over Czech letters were lost: ě, ř, í.
  // It still takes a fraction of a second a page.
  let picture = page.thumbnail(of: CGSize(width: bounds.width * 3, height: bounds.height * 3), for: .mediaBox)
  guard let image = picture.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return "" }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  // There is no Slovak model. The Czech one reads Slovak but for a letter or two, such as Ľ.
  request.recognitionLanguages = ["cs-CZ", "en-US"]
  request.usesLanguageCorrection = true
  try? VNImageRequestHandler(cgImage: image).perform([request])
  return (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}

if CommandLine.arguments.contains("--pdf") {
  let bytes = FileHandle.standardInput.readDataToEndOfFile()
  guard let document = PDFDocument(data: bytes) else { answer(["error": "This is not a PDF that can be read."]) }
  if document.isLocked { answer(["error": "This PDF is locked."]) }
  var pages: [String] = []
  var recognised = 0
  for index in 0..<document.pageCount {
    guard let page = document.page(at: index) else { continue }
    let own = page.string ?? ""
    if !own.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
      pages.append(own)
    } else {
      pages.append(recognise(page))
      recognised += 1
    }
  }
  answer(["text": pages.joined(separator: "\n\n"), "recognised": recognised])
}

let checking = CommandLine.arguments.contains("--check")

switch SystemLanguageModel.default.availability {
case .available:
  break
case .unavailable(let reason):
  let why: String
  switch reason {
  case .deviceNotEligible: why = "This computer cannot run the on-device model."
  case .appleIntelligenceNotEnabled: why = "Apple Intelligence is turned off in System Settings."
  case .modelNotReady: why = "The on-device model is still downloading."
  @unknown default: why = "The on-device model is not available."
  }
  answer(checking ? ["available": false, "reason": why] : ["error": why])
}

if checking { answer(["available": true]) }

let input = FileHandle.standardInput.readDataToEndOfFile()
guard
  let request = try? JSONSerialization.jsonObject(with: input) as? [String: Any],
  let prompt = request["prompt"] as? String
else {
  answer(["error": "The request was not understood."])
}

do {
  let session = LanguageModelSession(instructions: request["instructions"] as? String ?? "")
  let response = try await session.respond(to: prompt)
  answer(["text": response.content])
} catch {
  answer(["error": error.localizedDescription])
}
