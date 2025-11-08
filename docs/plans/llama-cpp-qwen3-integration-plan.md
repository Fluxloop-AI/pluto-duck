## Qwen3 8B (llama.cpp) Integration Plan

### 1) Goal & Scope

- Integrate a local LLM pathway using llama.cpp with the Qwen3 8B GGUF (q4_k_m) model.
- Keep current OpenAI/GPT flow intact; add a selectable local model option across Settings and Chat.
- Lazy-load the local model when selected; unload when switching away to save memory/VRAM.

In scope:
- Backend provider + endpoints to download, register, load, unload local models
- Frontend UX for selecting local model and triggering load/unload
- Basic configuration (GPU offload, context size) with sensible defaults

Out of scope (Phase 1):
- Token-level streaming from llama.cpp (can be added later)
- Multi-local-model concurrent loading
- Quantization benchmarking and dynamic performance tuning

---

### 2) UX Summary

- Settings → Local Models:
  - Download Qwen3 8B GGUF (q4_k_m) from Hugging Face.
  - Show installed local models (name, path, size).
  - Default Model dropdown includes “Qwen3 8B (local, q4_k_m)”.

- Chat composer → Model select:
  - Adds “Qwen3 8B (local, q4_k_m)”.
  - On selection: backend loads local model (if not already loaded). On switching to a remote model: backend unloads local model.
  - Chat requests include `model` (already supported). Local model uses `model = "local:qwen3-8b-q4_k_m"`.

---

### 3) Backend Changes

#### 3.1 Provider Abstraction

- New provider: `LlamaCppLLMProvider` that implements `BaseLLMProvider`.
  - File: `backend/pluto_duck_backend/agent/core/llm/llama_cpp_provider.py`
  - Uses `llama-cpp-python` to run GGUF in-process, with an internal singleton-like `_LocalModelManager`:
    - `load(model_id, model_path, n_ctx, n_gpu_layers, n_threads)`
    - `unload()` (free model; call `gc.collect()`)
    - `get()` returns current `Llama` instance or `None`
  - `ainvoke(prompt, metadata)` ensures model is loaded (lazy), then calls `create_completion(...)` and returns `.choices[0].text`.

- Update provider selection in `backend/pluto_duck_backend/agent/core/llm/providers.py`:
  - If `resolved_model.startswith("local:")`, return `LlamaCppLLMProvider(local_id)` regardless of `agent.provider`.
  - Keep current OpenAI flow as-is for non-local models.
  - Optionally allow `agent.provider == "llama_cpp"` with a guard that `model` must be `local:*`.

Notes:
- This design minimizes churn elsewhere: `reasoning` node already calls `get_llm_provider(...).ainvoke(prompt)`.

#### 3.2 Model Management API

- New router: `backend/pluto_duck_backend/app/api/v1/models/router.py`
  - `GET /api/v1/models/local` → list installed local models (from `user_settings.local_models`)
  - `POST /api/v1/models/local/download` → body: `{ repo_id, filename, model_id? }`
    - Uses `huggingface_hub.hf_hub_download` to fetch GGUF.
    - Persists metadata in `user_settings.local_models` as: `{ id, name, path, size_bytes, quantization }`.
  - `POST /api/v1/models/local/load` → body: `{ model_id }`
    - Loads model via `_LocalModelManager.load(...)`.
  - `POST /api/v1/models/local/unload`
    - Unloads current local model.

- Wire router in `backend/pluto_duck_backend/app/api/router.py`:
  - `api_router.include_router(models.router, prefix="/api/v1", tags=["models"])`

#### 3.3 Settings & Defaults

- Extend defaults in `backend/pluto_duck_backend/app/services/chat/repository.py`:
  - Add `"local_models": []` in `DEFAULT_SETTINGS`.

- Optional: extend `AgentSettings` in `backend/pluto_duck_backend/app/core/config.py` with knobs used by local provider:
  - `n_gpu_layers: int = -1` (offload as much as available via Metal-capable wheel)
  - `n_threads: int = 0` (auto; pass-through to llama.cpp)
  - `max_context_tokens: int = 8192` (default ctx)

- Settings validation (current): `PUT /api/v1/settings` restricts `llm_model` to a fixed set.
  - Minimal path: do not use Settings to persist the local default initially. Users can pick local model per-chat (already passed in request payload).
  - Preferred path: expand validation list to allow `local:*` patterns, e.g., `local:qwen3-8b-q4_k_m`.

#### 3.4 Dependencies

- Add optional extras in `pyproject.toml`:
  - `llama-cpp-python>=0.3.2`
  - `huggingface_hub>=0.24`

- macOS Metal wheel install guidance:
  - `CMAKE_ARGS="-DLLAMA_METAL=on" pip install 'llama-cpp-python>=0.3.2'`

---

### 4) Frontend Changes

#### 4.1 Model Choices

- Update dropdowns to include the local model ID (keep existing IDs intact):
  - `frontend/pluto_duck_frontend/components/chat/ChatPanel.tsx` → `MODELS`
  - `frontend/pluto_duck_frontend/components/chat/SettingsModal.tsx` → `MODELS`
  - Add: `{ id: 'local:qwen3-8b-q4_k_m', name: 'Qwen3 8B (local, q4_k_m)' }`

#### 4.2 Load/Unload on Selection

- Where `selectedModel` is managed (e.g., `frontend/pluto_duck_frontend/app/page.tsx`):
  - Add `useEffect` to call:
    - If `selectedModel.startsWith('local:')` → `POST /api/v1/models/local/load { model_id }`
    - Else → `POST /api/v1/models/local/unload`

#### 4.3 Settings: Local Models Section (Phase 1 Minimal)

- In `SettingsModal`, add a small section with a button to download Qwen3 8B q4_k_m via `POST /api/v1/models/local/download`.
- Optionally show installed list via `GET /api/v1/models/local`.
- If you want to allow setting the local model as default in Settings, relax backend validation (see 3.3).

Note: Chat flow already passes `model` with both create and append; no extra changes needed.

---

### 5) API Contracts (proposed)

1) List local models
```
GET /api/v1/models/local
→ 200 OK
[
  { "id": "qwen3-8b-q4_k_m", "name": "qwen3-8b-q4_k_m", "path": "/.../qwen3-8b-instruct-q4_k_m.gguf", "size_bytes": 5123456789, "quantization": "q4_k_m" }
]
```

2) Download model
```
POST /api/v1/models/local/download
{ "repo_id": "Qwen/Qwen3-8B-GGUF", "filename": "qwen3-8b-instruct-q4_k_m.gguf", "model_id": "qwen3-8b-q4_k_m" }
→ 200 OK { LocalModelInfo }
```

3) Load model
```
POST /api/v1/models/local/load
{ "model_id": "qwen3-8b-q4_k_m" }
→ 200 OK { "status": "loaded", "model_id": "qwen3-8b-q4_k_m" }
```

4) Unload model
```
POST /api/v1/models/local/unload
→ 200 OK { "status": "unloaded" }
```

---

### 6) Error Handling & Concurrency

- Provider guards:
  - If local model not installed: raise `RuntimeError` with clear guidance → surfaced as a chat error.
  - Concurrency: a simple `asyncio.Semaphore(1)` inside provider; `_LocalModelManager` protected by `RLock`.
  - Unload replaces current instance; subsequent calls re-load as needed.

- Limits:
  - Single local model active at once to avoid memory/VRAM pressure.
  - `max_output_tokens` taken from existing `AgentSettings` where set; default to 512 if not configured.

---

### 7) Security & Storage

- Model files stored under `data_dir.artifacts/models/llama_cpp/{model_id}/...gguf`.
- HF downloads use local_dir without symlinks to keep a clear folder layout.
- Persist list of installed models in `user_settings.local_models` for easy enumeration.

---

### 8) Testing Plan

Unit:
- Provider: mock `_LocalModelManager.get()` and assert prompt→completion glue.
- Manager: load/unload idempotency; bad path handling.

Integration:
- Endpoints: download (mock HF), list, load/unload; ensure settings persistence.
- Provider path resolution via `user_settings.local_models`.

E2E (manual):
- Download Qwen3 via Settings.
- Select “Qwen3 8B (local, q4_k_m)” in Chat → verify load call succeeds.
- Ask a question and confirm local response returns.
- Switch to GPT model → verify unload called and subsequent chat uses remote provider.

---

### 9) Rollout & Flags

- Feature flag (optional): `PLUTODUCK_AGENT__ENABLE_LOCAL=true` gates:
  - Showing local model option in UI
  - Enabling models API

- Default rollout: enabled; safe because remote flow remains unchanged and local path activates only when selected.

---

### 10) Follow-ups (Phase 2)

- Streaming token output from llama.cpp to match current SSE stream semantics.
- Add more local models with per-model presets.
- Per-project default model and per-tab model pinning.
- Advanced performance settings UI (ctx size, batch size, GPU offload layers).

---

### 11) Implementation Checklist

Backend
- [ ] Add `llama_cpp_provider.py` and wire into `get_llm_provider`
- [ ] Add `models` router: list/download/load/unload
- [ ] Add `local_models` default in `DEFAULT_SETTINGS`
- [ ] Optional: extend `AgentSettings` with `n_gpu_layers`, `n_threads`, `max_context_tokens`
- [ ] Optional: relax settings validation for `llm_model` to accept `local:*`

Frontend
- [ ] Add local model to `MODELS` in `ChatPanel.tsx`, `SettingsModal.tsx`
- [ ] Add effect to load/unload on selection in `app/page.tsx`
- [ ] Add minimal Local Models section in Settings (Download button + list)

DevOps
- [ ] Add optional extra `local-llm` to `pyproject.toml`
- [ ] Document macOS Metal installation for `llama-cpp-python`


