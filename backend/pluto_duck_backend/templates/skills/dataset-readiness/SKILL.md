---
name: dataset-readiness
description: "TRIGGER: When <dataset_readiness> shows not_ready > 0 and user requests analysis. Guides through preprocessing workflow."
---

# Dataset Readiness

Use this skill to check preprocessing readiness and guide the user to resolve issues before analysis.

## When to Use

- The user requests analysis, metrics, diagnosis, or modeling.
- The system prompt includes `<dataset_readiness>` with `not_ready > 0`.

## Workflow

### Step 1: Check readiness details

1) Call `get_readiness_summary`.
2) If `not_ready_count` is 0, proceed to analysis.
3) If `not_ready_count` > 0, continue to Step 2.

### Step 2: Ask once (positive suggestion)

Ask exactly once in the conversation:

“Pre-processing improves analysis quality. Should I run pre-processing now?”

If the user already chose “analyze now” earlier in the same conversation, do not ask again.

### Step 3: If user chooses “analyze now”

- Append an event: `append_preprocessing_event(event_type="user_skipped", message="User chose to analyze without preprocessing.")`
- Proceed with analysis without further reminders in this conversation.

### Step 4: If user chooses “run pre-processing”

1) For each not-ready dataset, call `list_diagnosis_issues(file_asset_id=...)`.
2) Summarize issues and ask for decisions (e.g., fix date formats, ignore missing descriptions).
3) For each decision, call `set_issue_status(...)`.
4) After issues are resolved, call:
   - `set_readiness_status(status="ready", file_asset_id=..., event_type="preprocessing_completed", event_message="Pre-processing completed.")`

## Notes

- Do not store readiness in memory files.
- Readiness status is the source of truth; `analysis_ready` is derived.
- Keep follow-up questions concise and bounded.
