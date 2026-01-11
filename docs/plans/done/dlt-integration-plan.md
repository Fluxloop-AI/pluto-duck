# dlt Integration and LLM-Assisted Cleansing Plan for Pluto-Duck

## Goals
- Cover broad ingestion options with dlt (REST, SQL, files/cloud, Python generators).
- Define LLM’s role inside data cleansing (rules-first with optional LLM for edge cases).
- Enable an agent to generate dlt pipeline code and run it locally against Pluto-Duck’s DuckDB.

References:
- dlt Intro: [https://dlthub.com/docs/intro](https://dlthub.com/docs/intro)
- How dlt works (Extract–Normalize–Load, schema evolution, merge/append): [https://dlthub.com/docs/reference/explainers/how-dlt-works](https://dlthub.com/docs/reference/explainers/how-dlt-works)
- LLM‑native workflow (IDE/agent-assisted pipeline authoring): [https://dlthub.com/docs/dlt-ecosystem/llm-tooling/llm-native-workflow](https://dlthub.com/docs/dlt-ecosystem/llm-tooling/llm-native-workflow)

---

## 1) Ingestion Coverage with dlt

What dlt brings:
- Multiple sources: REST, SQL DBs, filesystem/cloud (S3/GCS/Drive/Local), Python iterables.
- Normalization: schema inference, nested JSON unnesting (e.g., `items__nested`), variant columns for mismatches.
- Schema evolution: automatic migrations.
- Incremental loading & state management: cursor/keys, safe retries.
- Flexible loading into DuckDB with `destination="duckdb"` and `write_disposition` (append/replace/merge with merge keys).

How we use it in Pluto-Duck:
- Use dlt to populate `raw` dataset in DuckDB (local-first). Keep dbt for business modeling/tests.
- For REST/cloud/unstructured sources, prefer dlt over custom connectors; for simple CSV/Parquet/local DB, existing connectors remain valid.

Configuration:
- Direct DuckDB credentials for dlt destination: `duckdb:///ABSOLUTE_PATH_TO_WAREHOUSE.duckdb`
- We set env for dlt process: `DESTINATION__DUCKDB__CREDENTIALS=duckdb:///.../warehouse.duckdb`

---

## 2) LLM’s Role Inside Cleansing

Principles:
- Rules-first: achieve most cleansing via deterministic transforms (maps, regex, coercions, lookups) inside dlt transformers.
- Optional LLM: call an LLM only for ambiguous fields (address standardization, free-text category mapping, PII redaction), gated by heuristics.
- Cost control: cache by input hash, batch calls, timeouts, retries, rate limits. Tag rows with `_llm_cleaned`, `_llm_input_hash`, `llm_version`.

Conceptual example (Python transformer with optional LLM):

```python
import dlt, json, hashlib

@dlt.resource(name="orders_raw")
def orders_source():
    for row in fetch_rows():
        yield row

@dlt.transformer(data_from=orders_source, name="orders_cleaned")
def cleanse(row: dict):
    # Rules-first
    row["email_valid"] = isinstance(row.get("email"), str) and "@" in row["email"]
    row["country_code"] = (row.get("country_code") or "").upper()[:2] or None

    needs_llm = not row["email_valid"] or not row["country_code"] or not row.get("category")
    if not needs_llm:
        return row

    payload = json.dumps({k: row.get(k) for k in ("address", "category", "notes")}, ensure_ascii=False)
    row["_llm_input_hash"] = hashlib.sha256(payload.encode()).hexdigest()

    prompt = f"""Normalize to JSON fields: category_norm, address_norm, notes_clean\nRecord: {payload}"""
    try:
        j = call_llm_and_parse_json(prompt)
        row.update({
            "category_norm": j.get("category_norm"),
            "address_norm": j.get("address_norm"),
            "notes_clean": j.get("notes_clean"),
            "_llm_cleaned": True,
            "llm_version": "v1",
        })
    except Exception as e:
        row["_llm_cleaned"] = False
        row["_llm_error"] = str(e)[:200]
    return row

pipeline = dlt.pipeline(pipeline_name="orders_pipeline", destination="duckdb", dataset_name="raw")
info = pipeline.run(cleanse, table_name="orders")
```

Why this is safe:
- Deterministic majority path, selective LLM for edge cases.
- dlt handles normalization/schema evolution; DuckDB remains local and fast.
- dbt continues to own business modeling and data tests.

---

## 3) Agent That Generates and Executes Cleansing Pipelines

Desired flow:
1) Agent reviews sample data/specs (source type, auth, pagination, incremental key, constraints).
2) Agent generates a dlt module (Python) with two functions: `build_source()` and `run_pipeline(dest_credentials, dataset_name)`.
3) Pluto-Duck executes the generated module locally, loading into DuckDB (`raw` dataset), and returns a summary.

Contract for generated module:

```python
# must define these

def build_source():
    """Return a dlt resource/source or generator yielding dict rows."""


def run_pipeline(dest_credentials: str, dataset_name: str) -> dict:
    """Run the dlt pipeline with destination='duckdb' and return a summary dict."""
```

Example of a generated module (REST):

```python
import dlt
from dlt.sources.rest_api import rest_api_source

def build_source():
    return rest_api_source({
        "client": {
            "base_url": "https://api.example.com/",
            "paginator": {"type": "json_link", "next_url_path": "paging.next"},
            "headers": {"Authorization": "Bearer ${API_TOKEN}"},
        },
        "resources": ["orders"],
    })

def run_pipeline(dest_credentials: str, dataset_name: str) -> dict:
    pipeline = dlt.pipeline(pipeline_name="orders_ingest", destination="duckdb", dataset_name=dataset_name)
    source = build_source()
    info = pipeline.run(source)
    return {"load_info": str(info)}
```

Runner in Pluto-Duck (loads module string, injects DuckDB creds):

```python
import os, types
from pluto_duck_backend.app.core.config import get_settings

def duckdb_credentials(path) -> str:
    return f"duckdb:///{path}"


def execute_generated_dlt(code_str: str, dataset_name: str = "raw") -> dict:
    settings = get_settings()
    os.environ["DESTINATION__DUCKDB__CREDENTIALS"] = duckdb_credentials(settings.duckdb.path)

    mod = types.ModuleType("generated_dlt_module")
    exec(compile(code_str, "generated_dlt_module.py", "exec"), mod.__dict__)
    summary = mod.run_pipeline(os.environ["DESTINATION__DUCKDB__CREDENTIALS"], dataset_name)
    return {"warehouse": str(settings.duckdb.path), "dataset": dataset_name, **(summary or {})}
```

---

## Application to Pluto-Duck

### A. New dlt-based connectors (optional but recommended)
- Add `DltRestConnector` and `DltFilesystemConnector` under `app/services/ingestion/connectors/`.
- Each connector’s `materialize` should:
  1) Build dlt source (REST/filesystem) from `source_config`.
  2) Set env `DESTINATION__DUCKDB__CREDENTIALS` using Pluto-Duck DuckDB path.
  3) Run `dlt.pipeline(..., destination='duckdb', dataset_name='raw')` and return rows loaded.
- Keep current CSV/Parquet/Postgres/SQLite connectors; dlt extends coverage (REST/cloud/nested JSON, incremental).

### B. Agent node for code generation + execution
- Add `dlt_ingest` node to the LangGraph agent, invoked when the user intent is ingestion.
  - Node steps: assemble prompt (source type/config/schema preview/incremental key) → call LLM to generate module → run via `execute_generated_dlt` → emit tool events with summary.
- Add actions to `ActionCatalog`:
  - `dlt:generate` (returns code string), `dlt:run` (executes and returns summary), and/or a combined `dlt:ingest`.

### C. Configuration & secrets
- Map Pluto-Duck config to dlt credentials/secrets:
  - DuckDB: `DESTINATION__DUCKDB__CREDENTIALS` (no `.dlt` secrets needed).
  - API tokens: pass via Pluto-Duck secrets store or environment vars that the LLM-generated code references (e.g., `${API_TOKEN}`).
- Consider persisting generated pipeline modules under `~/.pluto-duck/artifacts/dlt/pipelines/<name>/module.py` for reproducibility.

### D. dbt interplay
- Keep dbt as the authoritative layer for business transformations and tests.
- dlt writes to `raw` dataset/tables; dbt models reference them.
- Optionally add dbt tests to validate dlt outputs (row counts, schema contracts).

### E. Testing & quality
- Unit tests: transformer behavior (rules, LLM gating), connector configuration mapping, `execute_generated_dlt` runner.
- Integration tests: run a sample dlt REST/filesystem pipeline into temp DuckDB; assert tables created, nested tables unnested.
- Telemetry/metrics: record `_llm_cleaned` ratios, errors, runtime, cost estimates.

---

## Incremental Rollout Plan
1) Dependencies & scaffolding
   - Add `dlt` to optional extras; lock versions and test on macOS (local).
   - Feature-flag dlt connectors and agent node.
2) MVP (REST ingest)
   - Implement `DltRestConnector` with minimal config (base_url, resources, pagination, token).
   - Provide `dlt:run` action to run fixed spec; surface summary in API/UI.
3) LLM codegen
   - Add `dlt_ingest` node: prompt templates + `execute_generated_dlt`.
   - Persist generated modules; add guardrails (lint, import allowlist, timeouts).
4) Filesystem/cloud support
   - Implement `DltFilesystemConnector` (S3/GCS/local glob patterns).
5) Hardening
   - Add caching for LLM transformers, merge keys for upserts, dbt tests on critical models.

---

## Acceptance Criteria
- A user can request ingestion from a REST API and see tables materialized under `raw.*` in DuckDB.
- Optionally, the agent can generate a runnable dlt module that is executed locally.
- LLM-assisted cleansing is opt-in and used only for ambiguous records; metrics and error flags are recorded.
- dbt transformations run as before; tests pass; performance remains interactive on local hardware.

---

## References
- dlt Intro: [https://dlthub.com/docs/intro](https://dlthub.com/docs/intro)
- How dlt works: [https://dlthub.com/docs/reference/explainers/how-dlt-works](https://dlthub.com/docs/reference/explainers/how-dlt-works)
- LLM‑native workflow: [https://dlthub.com/docs/dlt-ecosystem/llm-tooling/llm-native-workflow](https://dlthub.com/docs/dlt-ecosystem/llm-tooling/llm-native-workflow)

