import assert from "node:assert/strict";
import test from "node:test";

import { mapToolStateToPhase } from "../../../ai-elements/tool-state-phase-map.ts";
import type { ToolUIState } from "../../../ai-elements/tool-types.ts";

test("maps all tool states to step dot phases", () => {
  const cases: Array<[ToolUIState, ReturnType<typeof mapToolStateToPhase>]> = [
    ["input-streaming", "running"],
    ["input-available", "running"],
    ["approval-requested", "running"],
    ["approval-responded", "complete"],
    ["output-available", "complete"],
    ["output-error", "error"],
    ["output-denied", "error"],
  ];

  for (const [state, expected] of cases) {
    assert.equal(mapToolStateToPhase(state), expected);
  }
});
