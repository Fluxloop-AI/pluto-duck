# Pluto-Duck OSS Backend Specification

## Scope

Define the architecture and feature set for the open-source, local-first backend that powers the Pluto-Duck personal analytics studio.

- Target audience: individual developers, analysts, and small teams running everything on a personal machine.
- Primary goals: secure local execution, fast data exploration, ergonomic AI-assisted SQL generation, pluggable ingestion.
- Out of scope: hosted collaboration features, managed scheduling, enterprise auth (deferred to commercial roadmap).

## Architectural Overview

```
┌────────────────────────────────────────────────────────────────────┐
│                             CLI & API                               │
│  (pluto-duck CLI, REST/WebSocket server)                            │
├───────────────────────────────┬─────────────────────────────────────┤
│         Orchestration         │             User Surface            │
│ - Async task runner (in-app)  │ - REST endpoints (/query, /ingest)  │
│ - Agent workflow controller   │ - WebSocket event stream            │
├───────────────────────────────┼─────────────────────────────────────┤
│            Services            │                                    │
│ - Ingestion service            │ -> DuckDB local storage             │
│ - Transformation runner (dbt)  │ -> Artifact registry (metadata)    │
│ - Execution engine (SQL run)   │                                    │
├───────────────────────────────┴─────────────────────────────────────┤
│                       Infrastructure Layer                          │
│ - DuckDB file store (~/pluto_duck/data/*.duckdb)                    │
│ - Local scheduler (manual trigger + optional cron hook)             │
│ - Config manager (~/.config/pluto-duck/config.yaml)                 │
└────────────────────────────────────────────────────────────────────┘
```

## Core Modules & Responsibilities

### 1. Configuration (`app/core/config`)

- Centralize runtime settings (paths, model providers, connector credentials) via Pydantic.
- Load order: CLI flags → env vars → config file.
- Provide helpers for resolving data directory, dbt project, DuckDB file.

### 2. Data Ingestion (`app/services/ingestion`)

- Base connector protocol (`BaseConnector`): defines `fetch_metadata()`, `pull_table()`, `pull_query()` and lifecycle hooks (`open()`, `close()`).
- Bundled connectors implement the interface and self-register with a factory/registry.
  - Out of the box: Local file (CSV/Parquet/JSON), PostgreSQL, SQLite, HTTP CSV.
- External contributors can add new connectors by shipping a package that calls `register_connector("bigquery", BigQueryConnector)`.
- Stream data into DuckDB using COPY or Pandas-to-DuckDB pipeline.
- Maintain ingestion catalog (source → target table mapping, sync history).

### 3. Transformation (`app/services/transformation`)

- Thin wrapper over dbt CLI.
- Manage dedicated dbt project inside repo (`dbt_projects/core`).
- Provide programmatic API to run models/tags and capture logs.
- Expose output manifest and run results for agent context.

### 4. Query Execution & Storage (`app/services/execution`)

- Own a DuckDB connection pool, enforce query timeout and resource limits.
- Persist generated SQL, result previews, and metadata (column profiles) for reuse.

### 5. AI Agent (`agent/core`)

- LangGraph-based orchestrator with modular nodes that conform to abstract `AgentNode` protocols (`prepare()`, `run_step()`, `serialize_state()`).
  - **Planner:** interpret natural-language question.
  - **Schema explorer:** surface relevant tables/views from DuckDB & dbt catalog.
  - **SQL generator:** call configured LLM provider, with guardrails.
  - **Verifier:** optional unit test execution against sample rows.
- Nodes self-register with a node registry; pipeline definitions can select/override nodes by name.
- Default provider: OpenAI GPT-5 via API; pluggable interface allows swapping to other hosted or local models in future releases.
- Support offline mode (no external LLM) through pluggable providers (deferred but designed-in).

### 6. API Layer (`app/api`)

- Framework: FastAPI.
- Authentication: optional API token (env/config); default open for localhost.
- Endpoints (initial set):
  - `POST /api/v1/query`: submit NL query → returns `run_id`.
  - `GET /api/v1/query/{run_id}`: poll job status & results.
  - `GET /api/v1/query/{run_id}/events`: Server-Sent Events for step updates.
  - `POST /api/v1/ingest`: trigger ingestion job (source config payload).
  - `POST /api/v1/dbt/run`: execute dbt models (tags, selection).
- Error handling with structured responses and trace IDs.

### 7. CLI (`packages/cli` or `app/cli`)

- Entry point: `pluto-duck` (typer/click).
- Commands:
  - `init`: scaffold config, data directory, sample dbt project.
  - `ingest <source>`: run ingestion recipes defined in YAML.
  - `run`: start API server.
  - `query "<question>"`: run quick NL query from terminal.
  - `dbt run/test`: proxy to transformation service.
  - `doctor`: environment diagnostics (DuckDB version, dbt availability, disk space).

## Data & Metadata Layout

- Base directory (default `~/.pluto-duck/`):
  - `data/warehouse.duckdb`: primary DuckDB database.
  - `artifacts/dbt/`: manifests, run logs, compiled models.
  - `artifacts/queries/`: JSONL of executed queries, SQL, metrics.
  - `configs/`: source connection YAML, credentials (with file-based secret store).
- Support project-local override via `.plutoduck` file.

## Observability & Telemetry

- Structured logging (JSON) with log levels configurable via CLI.
- Query/job tracing stored locally; opt-in for anonymous usage metrics.
- Provide `pluto-duck logs` command to tail server output.

## Security & Privacy

- Local-only by default (bind to `127.0.0.1`).
- Support API token for remote access (optional, for power users).
- Credentials stored encrypted using OS keyring when available; fallback to file with restricted permissions.
- No outbound network calls unless connectors/LLM explicitly configured.

## Packaging & Distribution

- Python package (`pluto_duck_backend`) with console entry points.
- Docker image for quick start (`docker run -p 8000:8000 pluto-duck:oss`).
- Publish connectors as optional extras (`pluto-duck[postgres]`).

## Testing Strategy

- Unit tests for connectors, config parsing, agent planner.
- Integration tests using ephemeral DuckDB file and sample datasets.
- Contract tests for API endpoints using FastAPI TestClient.
- CLI smoke tests via pytest subprocess.

## Open Questions / Future Enhancements

- Additional LLM provider bundles (local GGUF, Azure OpenAI, etc.).
- Schema versioning and migration handling for DuckDB artifacts.
- Strategies for large dataset ingestion progress feedback.