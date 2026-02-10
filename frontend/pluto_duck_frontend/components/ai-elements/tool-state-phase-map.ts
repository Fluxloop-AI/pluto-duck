import type { StepDotPhase } from "./step-dot";
import type { ToolUIState } from "./tool-types";

const TOOL_STATE_TO_PHASE: Record<ToolUIState, StepDotPhase> = {
  "input-streaming": "running",
  "input-available": "running",
  "approval-requested": "running",
  "approval-responded": "complete",
  "output-available": "complete",
  "output-error": "error",
  "output-denied": "error",
};

export const mapToolStateToPhase = (state: ToolUIState): StepDotPhase =>
  TOOL_STATE_TO_PHASE[state];
