# Frontend Phase 2 — Chat Persistence & Settings Design

## 1. Goals
- Persist agent conversations, messages, and emitted events in the existing DuckDB warehouse so that chat history survives restarts.
- Store onboarding/configuration choices (data sources, dbt project path overrides, LLM provider toggles) to reuse across sessions.
- Expose FastAPI endpoints that the new chat UI can call for listing conversations, creating runs, appending messages, and fetching settings.
- Keep the orchestration flow (LangGraph + SSE) intact while adding asynchronous persistence hooks.

## 2. DuckDB Schema
All tables live in the default warehouse (`settings.duckdb.path`). Table creation runs during backend startup if missing.

### 2.1 Conversations
```sql
CREATE TABLE IF NOT EXISTS agent_conversations (
    id UUID PRIMARY KEY,
    title VARCHAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR DEFAULT 'active', -- active | completed | failed
    last_message_preview VARCHAR,
    run_id UUID, -- mirrors orchestrator conversation_id
    metadata JSON
);
```
- `id` is the public identifier exposed to the UI (matches `conversation_id` from `AgentRun`).
- `title` defaults to first user message snippet; can be edited later.
- `metadata` stores arbitrary JSON (e.g., tags, model used).

### 2.2 Messages
```sql
CREATE TABLE IF NOT EXISTS agent_messages (
    id UUID PRIMARY KEY,
    conversation_id UUID REFERENCES agent_conversations(id),
    role VARCHAR NOT NULL, -- user | assistant | system | tool
    content JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    seq INTEGER,
    UNIQUE(conversation_id, seq)
);
```
- `content` is JSON to support multi-part payloads (text, tables, structured tool outputs).
- `seq` enforces chronological ordering; populated from an incrementing counter per conversation.

### 2.3 Events Log
```sql
CREATE TABLE IF NOT EXISTS agent_events (
    id UUID PRIMARY KEY,
    conversation_id UUID REFERENCES agent_conversations(id),
    type VARCHAR NOT NULL,
    subtype VARCHAR,
    payload JSON,
    metadata JSON,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    source VARCHAR DEFAULT 'backend'
);
```
- Persists every SSE event for replay or audit.
- `source` allows future enrichment (frontend annotations, evaluator signals).

### 2.4 Settings
```sql
CREATE TABLE IF NOT EXISTS user_settings (
    key VARCHAR PRIMARY KEY,
    value JSON,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
- Keys include `data_sources`, `dbt_project`, `llm_provider`, `ui_preferences`.
- UI writes updates; backend reads defaults when orchestrating runs.

### 2.5 Seed Data & Indexes
```sql
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON agent_messages(conversation_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_conversation ON agent_events(conversation_id, timestamp);
```
- On first run, insert placeholder rows into `user_settings` with `value = NULL` to signal onboarding pending.

## 3. Backend Responsibilities

1. **Initialization**
   - Extend `PlutoDuckSettings.prepare_environment` or FastAPI startup event to execute DDL statements using DuckDB Python API (`duckdb.connect(str(path))`).
   - Ensure this runs idempotently.

2. **Agent Run Hook**
   - When `AgentRunManager.start_run` is called:
     - Insert row into `agent_conversations` with generated `conversation_id`, `question` snippet.
     - Insert initial user message into `agent_messages`.
   - During `_events_from_update`, append events to `agent_events`; when tool emits final message, insert assistant message(s).
   - Update `agent_conversations.updated_at`, `status`, and `last_message_preview` accordingly.

3. **Settings Service**
   - Create `app/services/settings` with helper to read/write JSON blobs in `user_settings` table.
   - Provide default struct when rows missing.

4. **API Layer**
   - Add new FastAPI router `app/api/v1/chat` exposing:
     - `GET /api/v1/chat/sessions` → list conversations with pagination/filter; return metadata + last message preview.
     - `POST /api/v1/chat/sessions` → create new session (optional seed question). Internally calls `AgentRunManager.start_run` if `question` provided; returns run metadata.
     - `GET /api/v1/chat/sessions/{id}` → fetch conversation details (messages, status, timestamps).
     - `GET /api/v1/chat/sessions/{id}/events` → historical events (non-streaming) for replay.
     - `POST /api/v1/chat/sessions/{id}/messages` → append manual message (e.g., follow-up question) and trigger new run iteration.
     - `GET /api/v1/chat/settings` + `PUT /api/v1/chat/settings` → read/write onboarding config.
   - Re-export existing SSE stream at `/api/v1/agent/{run_id}/events` for live updates; chat router references same run ids.

5. **Service Layer**
   - Implement repository module with DuckDB SQL wrappers (e.g., using `duckdb.connect().execute(...)`).
   - Consider using context manager per request to avoid long-lived cursors.
   - Provide small DAO functions: `create_conversation`, `list_conversations`, `append_message`, `log_event`, `get_settings`, `update_settings`.

## 4. Frontend Contract Summary

### 4.1 Conversation Metadata (`GET /api/v1/chat/sessions`)
```json
[
  {
    "id": "UUID",
    "title": "Weekly revenue insights",
    "status": "completed",
    "created_at": "2025-10-20T12:34:56Z",
    "updated_at": "2025-10-20T12:38:10Z",
    "last_message_preview": "Here is the SQL I generated..."
  }
]
```

### 4.2 Conversation Detail (`GET /api/v1/chat/sessions/{id}`)
```json
{
  "id": "UUID",
  "status": "active",
  "messages": [
    {"id": "UUID", "role": "user", "content": {"text": "Show me yesterday's revenue"}, "created_at": "..."},
    {"id": "UUID", "role": "assistant", "content": {"text": "I'll analyze that for you."}, "created_at": "..."}
  ],
  "events": [
    {"id": "UUID", "type": "tool", "subtype": "chunk", "payload": {"tool": "sql", "sql": "SELECT ..."}, "timestamp": "..."}
  ]
}
```
- `events` optional; UI can fetch separate endpoint if list becomes large.

### 4.3 Create Session (`POST /api/v1/chat/sessions`)
Request:
```json
{
  "question": "Show top 5 products by revenue",
  "settings_override": {"model": "gpt-4.1"}
}
```
Response:
```json
{
  "id": "UUID",
  "run_id": "UUID",
  "events_url": "/api/v1/agent/UUID/events"
}
```
- UI then connects to SSE using `events_url`.

### 4.4 Settings (`GET/PUT /api/v1/chat/settings`)
```json
{
  "data_sources": [
    {"type": "csv", "path": "/path/to/file.csv"}
  ],
  "dbt_project": {
    "project_path": "/Users/user/pluto-duck/dbt",
    "profiles_path": "/Users/user/.dbt/profiles.yml"
  },
  "ui_preferences": {"theme": "dark"}
}
```

## 5. Implementation Notes
- Use parameterized queries to avoid SQL injection, even though sources are local.
- Wrap DuckDB writes in transactions; replay logic should be idempotent (ignore duplicate `id`).
- Consider background task or `asyncio.create_task` to persist events so SSE delivery stays responsive.
- Migration helpers can live in `app/services/persistence/migrations.py` or similar.
- When reloading historical conversations, UI should rely on REST data; SSE only for live updates.

## 6. Open Questions
- Should we prune or archive events beyond N runs to keep DuckDB compact? (future optimization).
- How do we handle long-running conversations that spawn multiple agent runs? Option: store `parent_conversation_id` and `run_iteration` columns.
- Do we allow editing titles or deleting conversations via API? Recommend exposing simple `PATCH /sessions/{id}` for title updates later.

Document last updated: October 20, 2025.
