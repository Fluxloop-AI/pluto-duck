# Pluto-Duck OSS Architecture Overview

This document summarizes the system architecture. For detailed specifications, see `docs/plans/` and `docs/Pluto_Duck_new_flow.md`.

## Core Concepts

Pluto Duck is a **Local Agentic Data Workbench** that provides:

1. **Live Data Federation**: Connect external databases (PostgreSQL, SQLite, MySQL) via DuckDB ATTACH
2. **SQL Pipeline Management**: Save, execute, and track SQL analyses with automatic lineage
3. **AI Agent**: Natural language interface for data exploration and analysis
4. **Board System**: Collaborative workspace for organizing analyses and results

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (Next.js)                          │
│  ├── Chat Interface      - AI conversation with agent              │
│  ├── Board Editor        - Lexical-based collaborative workspace   │
│  └── Asset Library       - Saved analyses and lineage graph        │
├─────────────────────────────────────────────────────────────────────┤
│                         API Layer (FastAPI)                         │
│  ├── /api/v1/source      - Data federation (ATTACH + Cache)        │
│  ├── /api/v1/asset       - Analysis CRUD and execution             │
│  ├── /api/v1/query       - Ad-hoc SQL execution                    │
│  ├── /api/v1/agent       - AI agent interactions                   │
│  └── /api/v1/boards      - Board management                        │
├─────────────────────────────────────────────────────────────────────┤
│                         Service Layer                               │
│  ├── SourceService       - External DB connections and caching     │
│  ├── AssetService        - Analysis management (wraps duckpipe)    │
│  ├── WorkZoneService     - Conversation-scoped workspaces          │
│  └── BoardsService       - Board CRUD and content                  │
├─────────────────────────────────────────────────────────────────────┤
│                         duckpipe Library                            │
│  ├── Pipeline            - DAG execution orchestrator              │
│  ├── Analysis            - SQL + metadata definition               │
│  └── Parsing             - SQL analysis and parameter binding      │
├─────────────────────────────────────────────────────────────────────┤
│                         Storage (DuckDB)                            │
│  ├── Main Warehouse      - User data and cached tables             │
│  ├── _sources schema     - Attached source metadata                │
│  ├── _duckpipe schema    - Analysis runtime state                  │
│  └── analysis schema     - Materialized analysis results           │
└─────────────────────────────────────────────────────────────────────┘
```

## Data Zones

### 1. Source Zone (External Data)
- **Live Sources**: External databases connected via `ATTACH` (zero-copy federation)
- **Cached Tables**: Local copies of external data for performance

### 2. Analysis Zone (Managed Pipeline)
- **Analyses**: Saved SQL with metadata, dependencies, and lineage
- **Materialization**: Views or tables created from analysis execution

### 3. Work Zone (Ephemeral)
- **Conversation-scoped**: Temporary tables for agent interactions
- **Automatic cleanup**: Removed when conversation ends

## Key Components

### SourceService
Manages connections to external databases using DuckDB's ATTACH mechanism.

```python
# Attach an external database
source_service.attach_source(
    name="sales",
    source_type="postgres",
    config={"host": "localhost", "database": "sales_db", ...},
    project_id="proj_123",
    description="Sales database"
)

# Cache a table locally for performance
source_service.cache_table("sales", "orders", filter_sql="WHERE date >= '2024-01-01'")
```

### duckpipe Library
Lightweight SQL pipeline library for managing analyses with lineage tracking.

```python
from duckpipe import Pipeline, Analysis

# Define an analysis
analysis = Analysis(
    id="daily_revenue",
    name="Daily Revenue",
    sql="SELECT date, SUM(amount) FROM {{ ref('source:orders') }} GROUP BY date",
    materialized="table"
)

# Compile and execute
pipeline = Pipeline(project_dir="./analyses")
plan = pipeline.compile("daily_revenue", conn)
result = pipeline.execute(plan, conn)
```

### AssetService
Application layer wrapping duckpipe for Pluto Duck.

- CRUD for analyses within projects
- Execution with connection management
- Lineage and freshness tracking
- Run history

## Agent Architecture

The AI agent uses a deep agent pattern with:

1. **Tools**: Query execution, source management, analysis creation
2. **Skills**: Reusable workflows loaded from SKILL.md files
3. **HITL**: Human-in-the-loop approval for sensitive operations

### Agent Tools

| Tool | Description |
|------|-------------|
| `run_sql` | Execute ad-hoc SQL query |
| `list_tables`, `describe_table` | Schema exploration |
| `attach_source`, `cache_table` | Data source management |
| `save_analysis`, `run_analysis` | Analysis management |
| `get_lineage`, `get_freshness` | Pipeline monitoring |

## Data Layout

Default root: `~/Library/Application Support/PlutoDuck` (macOS) or `~/.pluto-duck`

```
{data_dir}/
├── data/
│   └── warehouse.duckdb      # Main DuckDB warehouse
├── deepagents/
│   ├── user/
│   │   └── skills/           # User-level skills
│   └── projects/
│       └── {project_id}/
│           ├── skills/       # Project-specific skills
│           └── analyses/     # duckpipe analysis definitions (YAML + SQL)
├── configs/                  # Application configuration
├── logs/                     # Log files
└── runtime/                  # Temporary runtime files
```

## API Reference

### Source Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/source` | Attach a new source |
| GET | `/api/v1/source` | List sources (with project filter) |
| GET | `/api/v1/source/{name}` | Get source details with cached tables |
| DELETE | `/api/v1/source/{name}` | Detach a source |
| POST | `/api/v1/source/cache` | Cache a table locally |

### Asset Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/asset/analysis` | Create a new analysis |
| GET | `/api/v1/asset/analyses` | List analyses |
| POST | `/api/v1/asset/analysis/{id}/compile` | Compile execution plan |
| POST | `/api/v1/asset/analysis/{id}/execute` | Execute analysis |
| GET | `/api/v1/asset/lineage-graph` | Get full lineage graph |

## Testing Strategy

- **Unit tests**: duckpipe parsing, analysis definitions, service logic
- **Integration tests**: Full pipeline execution with DuckDB fixtures
- **API tests**: FastAPI endpoint testing with pytest
- **Frontend**: Component testing with React Testing Library

## Performance Considerations

1. **Zero-Copy Federation**: Use ATTACH for live queries on small/medium datasets
2. **Smart Caching**: Cache large or frequently-accessed tables
3. **Connection Pooling**: Single-writer constraint management
4. **Incremental Materialization**: Use `append` mode for large tables
