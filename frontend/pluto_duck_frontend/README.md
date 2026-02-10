# Pluto-Duck Frontend

Next.js-based frontend for the Pluto-Duck analytics agent, featuring DuckDB-backed chat persistence and real-time LangGraph event streaming.

## Features

- 🗨️ **Chat Interface**: OpenAI-style conversation UI using AI SDK Elements
- 💾 **Persistent History**: Conversations stored in DuckDB, accessible across sessions
- 🔄 **Real-time Streaming**: Live SSE events from LangGraph orchestrator
- 🧠 **Reasoning Traces**: Collapsible reasoning views with markdown support
- 🛠️ **Tool Outputs**: Structured display of planner/schema/SQL/verifier results

## Prerequisites

- Node.js >=18.18.0
- pnpm >=8.7.0
- Pluto-Duck backend running on `http://localhost:8000` (default)

## Getting Started

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev

# Open browser at http://localhost:3000
```

## Environment Configuration

Create `.env.local` with:

```bash
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8123
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
# Optional: override default deep-link callback for Tauri
# NEXT_PUBLIC_TAURI_AUTH_CALLBACK_URL=plutoduck://auth/callback
```

## Project Structure

```
app/
  page.tsx              # Landing page with links to workspace
  workspace/            # Main chat interface
    page.tsx            # Conversation list + transcript + composer
    layout.tsx          # Workspace shell
  globals.css           # Tailwind entrypoint
components/
  ai-elements/          # AI SDK Elements (Response, Reasoning)
  chat/                 # Custom chat components
    ConversationList.tsx
    Transcript.tsx
    Composer.tsx
  ui/                   # Radix UI primitives (Collapsible)
hooks/
  useAgentStream.ts     # SSE event subscription hook
lib/
  api.ts                # General backend helpers
  chatApi.ts            # Chat-specific API client
  utils.ts              # Tailwind merge utilities
types/
  agent.ts              # TypeScript definitions for agent events
```

## Development Workflow

1. **Start backend**: `pluto-duck run` (from repo root with venv activated)
2. **Start frontend**: `pnpm dev` (from `frontend/pluto_duck_frontend/`)
3. **Access UI**: Navigate to `http://localhost:3000/workspace`
4. **Create conversation**: Type a question and submit to trigger an agent run
5. **Review history**: Previous conversations load from DuckDB on sidebar

## Available Scripts

- `pnpm dev` — Start Next.js dev server on port 3000
- `pnpm build` — Build production bundle
- `pnpm start` — Serve production build
- `pnpm lint` — Run ESLint
- `pnpm typecheck` — Validate TypeScript types

## API Integration

The frontend consumes these backend endpoints:

- `GET /api/v1/chat/sessions` — List conversations
- `POST /api/v1/chat/sessions` — Create new conversation
- `GET /api/v1/chat/sessions/{id}` — Fetch conversation detail
- `GET /api/v1/agent/{run_id}/events` — Stream agent events (SSE)
- `GET /api/v1/chat/settings` — Fetch user settings
- `PUT /api/v1/chat/settings` — Update user settings

### API Client

See `api-client.md` for `apiClient` usage, `project_id` rules, and `ApiError` handling.

## Troubleshooting

**Backend unreachable**: Ensure the backend is running and `NEXT_PUBLIC_BACKEND_URL` is correct.

**SSE not streaming**: Check browser DevTools Network tab for CORS errors; verify `run_id` exists.

**Conversations not persisting**: Confirm DuckDB warehouse is writable and backend has initialized chat tables.

## Contributing

See `docs/CONTRIBUTING.md` in the repo root for guidelines.
