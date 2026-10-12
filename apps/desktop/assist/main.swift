// mate-assist: one question to the on-device model, one answer.
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

func answer(_ value: [String: Any]) -> Never {
  let data = (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data("\n".utf8))
  exit(0)
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
