# Agent Architecture Plan

## 1. Context & Goals
- Deliver Phase 1 Milestone E from `implementation-plan.md`: scaffold a LangGraph-based agent skeleton that runs locally, integrates with existing services, and streams structured events to clients.
- Preserve learnings from the legacy multi-agent system while avoiding cloud-specific dependencies (Supabase, Fluxloop instrumentation, etc.).
- Support offline development by default and allow pluggable LLM providers via existing `PlutoDuckSettings`.

## 2. Core Requirements
- **Reasoning-supervised flow**: start with a single agent skeleton where one reasoning loop decides which node or tool runs next (planner/schema/sql/verifier) until completion.
- **Streaming compatibility**: emit stable SSE-ready events despite LangGraph v1 streaming quirks; avoid duplicate/subgraph noise.
- **Service reuse**: call ingestion/query/dbt services directly (no HTTP) and align outcomes with the Subject×Action catalog.
- **Provider strategy**: default to hosted GPT-class providers for out-of-the-box usability, with optional mock/local backends for offline or privacy-focused scenarios.
- **Extensibility**: clear interfaces for adding new nodes/tools, future memory/persistence features, and, in later milestones, multi-persona delegation.

## 3. Target Package Layout (`backend/pluto_duck_backend/agent/core`)
- `state.py`: shared `AgentState`, `AgentMessage`, `AgentEvent` dataclasses; serialization helpers.
- `llm/providers.py`: `BaseLLMProvider`, `MockLLMProvider`, adapter to real providers.
- `events.py`: enums + payload schemas mapped 1:1 with SSE stream types (reasoning/tool/final, etc.).
- `nodes/`
  - `planner.py`: triage + plan draft generation and clarification requests.
  - `schema.py`: DuckDB metadata inspection via execution service or catalog queries.
  - `sql.py`: SQL synthesis, uses LLM provider; outputs candidate SQL + rationale.
  - `verifier.py`: executes SQL via `QueryExecutionManager`, captures results/errors.
- `prompts/`: plain-text prompt templates per persona/node (planner/explorer/master) to avoid hard-coding large strings in Python modules.
- `graph.py`: assembles LangGraph `StateGraph`, exposes `run()` + `astream_events()` façades; owns routing logic.
- `orchestrator.py`: light wrapper translating graph events into SSE stream consumed by API/CLI.
- `tests/`: unit/integration tests with deterministic providers.

## 4. Execution Flow (Milestone E scope)
1. **Reasoning Node**
   - Central LLM step that inspects the current state, thinks through options, and emits an intent: which node to run next, whether to invoke a tool, or whether to conclude.
   - Outputs also include free-form reasoning traces for streaming.
2. **Planner Node**
   - When invoked, synthesises or updates a structured plan, requesting clarifications if data is missing.
3. **Schema Node**
   - Gathers DuckDB/dbt metadata relevant to the current plan.
4. **SQL Generator Node**
   - Produces candidate SQL + rationale; hands off to verifier or loops back for refinement based on reasoning feedback.
5. **Verifier Node**
   - Executes SQL via `QueryExecutionManager`, captures results/errors, and signals the reasoning node to either iterate or finalize.
6. **Finalization Node** (implicit)
   - Triggered when the reasoning node decides the conversation is complete; formats the final response payload.

Conditional edges are driven by the reasoning node’s LLM output and mirror legacy `route_after_reasoning` behaviour: iterative refinement, clarification loops, and graceful completion/error handling. Multi-persona delegation is deferred to a later milestone.

## 5. Streaming Strategy (LangGraph v1)
- Prefer `graph.astream_events(..., stream_mode=["updates","messages"], subgraphs=False)`.
- Nodes emit explicit `AgentEvent` dicts, keeping LangGraph payload minimal:
  - `reasoning.start/chunk/end`
  - `tool.start/end`
  - `plan.request_clarification`
  - `run.complete/error`
- Wrap `astream_events` in `orchestrator.stream_events(question)` to map events to FastAPI SSE responses.
- Retain `_safe_serialize` helper to guard against LangChain message shape changes.

## 6. LangGraph-specific Considerations
- Pin LangGraph >=1.0 as optional dependency; feature-detect to fall back on mock runner if unavailable.
- Avoid `subgraphs=True` until we introduce nested specialists; simulate subgraph markers via manual events if needed.
- Configure runtime middleware (callbacks) for future telemetry but keep disabled in OSS baseline.

## 7. Integration Points
- **Settings**: extend `PlutoDuckSettings.agent` with provider options and mock-mode toggle.
- **Action Catalog**: add entries (`agent.plan`, `agent.run_sql`) that call orchestrator directly or via queue.
- **API Layer**: expose POST `/api/v1/agent/query` returning job id + event stream URL (future milestone).
- **CLI**: add `pluto-duck agent query` command hooking into orchestrator stream.

## 8. Implementation Phases
1. **Skeleton (Milestone E scope)**
   - Add package layout, state models, mock provider, planner/schema/sql/verifier stubs.
   - Implement LangGraph graph with deterministic loop; wire to execution service using mock SQL.
   - Provide unit tests covering event ordering and successful execution path.
2. **Enhanced Providers**
   - Integrate real LLM provider via settings, add prompt templates in `agent/prompts/`.
   - Extend planner node to support clarification events and action catalog lookups.
3. **Specialist Expansion**
   - Introduce optional subgraphs (e.g., analytics engineer) once streaming duplication is addressed.
4. **Persistence & Memory**
   - Add checkpointing/recall for conversation history (align with LangGraph durability features).

## 9. Testing & Validation
- Unit tests per node (planner/schema/sql/verifier) with mock provider responses.
- Graph integration test exercising full cycle and asserting ordered events.
- Regression test for SSE bridge ensuring JSON schema compatibility with frontend.
- Smoke test via CLI command using mock provider to confirm local-first workflow.

## 10. Open Questions
- What minimum LLM output schema should we enforce to keep planner/sql nodes provider-agnostic?
- How much dbt metadata should schema node surface by default (full manifest vs. filtered views)?
- Should action catalog trigger agent runs synchronously or enqueue background jobs for long tasks?
- When we eventually enable LangGraph persistence, do we store checkpoints in DuckDB or filesystem?

Document last updated: {{DATE}}

