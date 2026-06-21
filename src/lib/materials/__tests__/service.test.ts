import test from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject } from "@/lib/materials/service";

test("material JSON parse errors include response context", () => {
  const raw = [
    "{",
    '  "chunkedScript": [',
    '    {"sentence": "A valid sentence", "chunks": ["A valid sentence"]}',
    '    {"sentence": "Missing comma before this row", "chunks": ["bad"]}',
    "  ]",
    "}",
  ].join("\n");

  assert.throws(
    () => extractJsonObject(raw, "initial generation"),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Material JSON initial generation failed/);
      assert.match(error.message, /line \d+, column \d+/);
      assert.match(error.message, /raw offset: \d+/);
      assert.match(error.message, /Missing comma before this row/);
      assert.match(error.message, /\^/);
      return true;
    }
  );
});
