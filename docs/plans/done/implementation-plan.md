# Pluto-Duck OSS Implementation Plan

Based on `.cursor/plans/pluto-duck-re-architecture-plan-9662a618.plan.md` and
`.cursor/plans/backend-spec.plan.md`.

## Phase 1 — Core Backend & CLI (Weeks 1-6)
*Status: Completed October 19, 2025 — Milestones A through E delivered with passing test suite (`pytest backend/tests/agent backend/tests/api/test_agent_api.py`).*

### Milestone A: Foundations (Week 1)
- Finalize project scaffolding: ensure `pyproject.toml`, package layout, and virtualenv workflow.
- Establish coding standards (Ruff, mypy config) and CI placeholders.
- Seed `config` module with Pydantic settings (paths, connectors, model provider).
- Document contribution guide and update README with quickstart verification steps.

### Milestone B: Ingestion Service (Weeks 2-3)
- Define `BaseConnector` interface and registry (`app/services/ingestion`).
- Implement connectors: CSV/Parquet file, PostgreSQL, SQLite.
- Implement DuckDB load helpers (COPY or pandas pipeline).
- Persist ingestion catalog metadata; design local storage schema.
- Write unit tests for connectors and integration test using temp DuckDB file.

### Milestone C: Transformation via dbt (Week 3)
- Add wrapper around dbt CLI (`app/services/transformation`).
- Create starter dbt project under `dbt_projects/core` with sample models.
- Provide CLI command `pluto-duck dbt run/test` delegating to service.
- Capture run artifacts and expose to agent via catalog helpers.

### Milestone D: Query Execution & API Surface (Weeks 4-5)
- Implement `QueryExecutionService` with DuckDB pooling, timeout enforcement, metadata capture, and `QueryCatalog` for history.
- Define Subject×Action catalog (logical tool names with descriptions) mapped to service methods.
- Design FastAPI application (`app/api`) as thin adapters that call the services; expose endpoints:
  - `POST /api/v1/query`
  - `GET /api/v1/query/{run_id}`
  - `GET /api/v1/query/{run_id}/events`
  - `POST /api/v1/ingest`
  - `POST /api/v1/dbt/run`
- Provide async background job runner (in-process queue) shared by API, CLI, and agent.
- Extend CLI with `run`, `ingest`, `query` commands that call the services directly (HTTP optional).
- Write contract tests (FastAPI TestClient) and service-level tests to ensure API/agent reuse.

### Milestone E: AI Agent Skeleton (Week 6)
- Scaffold agent workflow in `agent/core` using LangGraph or equivalent orchestration.
- Implement planner, schema explorer, SQL generator stubs with dependency injection.
- Integrate execution service for verification step; emit structured events for SSE endpoint.
- Provide fallback/local mode (mock LLM) for offline development.

## Phase 2 — Frontend MVP & UX (Weeks 7-10)
- Initialize `frontend/pluto_duck_frontend` (e.g., Vite + React) with chat UI consuming API.
- Implement real-time updates via SSE for query progress.
- Add onboarding screens for configuring data sources and dbt project path.
- Package desktop-friendly instructions; update documentation with screenshots.
- Conduct end-to-end test covering ingestion → dbt → query through UI.

## Phase 3 — Polishing & Distribution (Weeks 11-12)
- Harden logging and tracing (structured JSON, local log tail command).
- Implement `pluto-duck doctor` diagnostics and improve CLI UX.
- Add Dockerfile(s) for backend and combined stack.
- Prepare PyPI publishing workflow and GitHub Actions CI.
- Finalize LICENSE, CONTRIBUTING, and community templates.

## Ongoing Tasks
- Security review: ensure API token support, local-only defaults, secure credential storage.
- Telemetry opt-in/out, usage metrics documentation.
- Solicit community feedback, triage issues, iterate on connector ecosystem.


