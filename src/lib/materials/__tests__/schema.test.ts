import test from "node:test";
import assert from "node:assert/strict";
import { parseAndValidateTrainingMaterialPayload } from "@/lib/materials/schema";

const validPayload = {
  chunkedScript: [
    {
      sentence: "Markets opened higher as tech shares rallied.",
      chunks: ["Markets opened higher", "as tech shares rallied"],
      pauseHints: ["short pause after clause"],
      stressWords: ["opened", "higher", "rallied"],
    },
  ],
  simplifiedVersion: {
    cefrLevel: "B1-B2",
    text: "Stock prices went up at the start of trading, mainly because technology companies performed well.",
  },
  dictationExercises: [{ prompt: "Write the key reason markets rose.", answer: "Technology shares rallied." }],
  clozeExercises: [{ prompt: "Markets opened ____ as tech shares rallied.", answer: "higher" }],
  retellOutline: [{ point: "Opening movement favored technology stocks.", connectors: ["first", "then"] }],
  keywordPrompts: [{ keyword: "rallied", prompt: "Stress RAL in rallied and keep the ending light." }],
};

test("accepts a valid payload", () => {
  const parsed = parseAndValidateTrainingMaterialPayload(validPayload);
  assert.equal(parsed.simplifiedVersion.cefrLevel, "B1-B2");
  assert.equal(parsed.chunkedScript.length, 1);
});

test("rejects payload with missing fields", () => {
  assert.throws(() => {
    parseAndValidateTrainingMaterialPayload({ ...validPayload, dictationExercises: [] });
  }, /dictationExercises/);
});

test("rejects payload with wrong field type", () => {
  assert.throws(() => {
    parseAndValidateTrainingMaterialPayload({
      ...validPayload,
      keywordPrompts: [{ keyword: "economy", prompt: 123 }],
    });
  }, /keywordPrompts/);
});
