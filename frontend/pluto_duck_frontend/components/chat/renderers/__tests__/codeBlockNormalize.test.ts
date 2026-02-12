import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWhiteTokenColors } from "../../../ai-elements/codeBlockColorNormalization.ts";

test("normalizes only style color declarations", () => {
  const html = '<span style="background-color:#fff;color:#fff">x</span>';
  const normalized = normalizeWhiteTokenColors(html);

  assert.equal(
    normalized,
    '<span style="background-color:#fff;color:#6B7280">x</span>'
  );
});

test("does not mutate code text content", () => {
  const html = "<span>background-color:#fff;color:white</span>";
  const normalized = normalizeWhiteTokenColors(html);

  assert.equal(normalized, html);
});
