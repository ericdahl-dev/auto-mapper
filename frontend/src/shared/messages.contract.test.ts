import { describe, expect, it } from "vitest";
import examples from "./fixtures/engine-messages.json";
import { parseServerMessage } from "./messages";

// One real example of every message the engine sends, recorded by tests/test_message_contract.py.
// If the engine renames or retypes a field, that pytest fails; if this parser stops accepting what the
// engine sends, this test fails.
describe("engine message contract", () => {
  for (const [type, message] of Object.entries(examples)) {
    it(`parses the engine's ${type} message`, () => {
      const parsed = parseServerMessage(JSON.stringify(message));
      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe(type);
    });
  }

  it("rejects a show whose surfaces are malformed", () => {
    const bad = { ...examples.show, surfaces: [{ id: "one", polygon: "nope" }] };
    expect(parseServerMessage(JSON.stringify(bad))).toBeNull();
  });

  it("rejects a status without the fields the editor reads", () => {
    const { camera: _camera, ...bad } = examples.status;
    expect(parseServerMessage(JSON.stringify(bad))).toBeNull();
  });
});
