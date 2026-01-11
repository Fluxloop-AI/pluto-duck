# Frontend Phase 2 Plan

## 1. Context & Goals
- Deliver Phase 2 objectives from `implementation-plan.md`: ship an end-to-end frontend MVP that consumes the Phase 1 backend/agent features.
- **Updated Strategy**: Use AI SDK Elements (official Vercel component library) instead of manually copying `next-openai-example` components for better maintainability and future-proofing.
- Keep the stack local-first and developer-friendly (Next.js, pnpm, Tailwind) with clear environment setup steps.

## 2. Current Status (as of October 20, 2025)
- ✅ `backend/` completed Phase 1 milestones (services, API, agent SSE, DuckDB persistence).
- ✅ `frontend/pluto_duck_frontend/` scaffolded with Next.js 14, Tailwind, TypeScript.
- ✅ Chat API integration complete (`lib/chatApi.ts` consuming `/api/v1/chat/*` endpoints).
- ✅ Basic SSE streaming hook (`hooks/useAgentStream.ts`) implemented.
- 🔄 **In Progress**: Refactoring UI components to use AI SDK Elements for standardization.

## 3. Target Deliverables
1. Production-ready project scaffold under `frontend/pluto_duck_frontend` with pnpm scripts, lint/test configuration, and shared UI primitives.
2. Unified chat workspace inspired by typical messaging apps:
   - Left rail lists persisted conversations (agent runs) stored in DuckDB.
   - Right pane shows the active conversation with message bubbles, tool snapshots, and run controls.
   - Users can start a new run directly from the workspace without copying IDs between screens.
3. Onboarding flow for configuring data sources and dbt project path before first query, with settings persisted and surfaced in the UI.
4. Developer documentation: environment variables, dev server instructions, integration with backend.
5. Automated UI/E2E tests covering ingest → dbt run → agent query flow.

## 4. Milestones & Timeline (Weeks 7-10)
### Milestone F — Scaffold & Integration Hooks (Week 7) ✅ COMPLETED
- ✅ Bootstrap Next.js app with project tooling: ESLint, Tailwind, TypeScript strict mode.
- ✅ Define shared environment configuration pointing to local backend.
- ✅ Implement landing page with backend health check and navigation.

### Milestone G — Backend Integration & Persistence (Weeks 7-8) ✅ COMPLETED
- ✅ Implement DuckDB persistence layer in backend (`app/services/chat/repository.py`).
- ✅ Create FastAPI endpoints (`/api/v1/chat/*`) for sessions, messages, events, settings.
- ✅ Build client API helpers (`lib/chatApi.ts`) and SSE streaming hook (`hooks/useAgentStream.ts`).
- ✅ Wire agent orchestrator to persist conversations and events automatically.

### Milestone H — AI SDK Elements Integration (Week 9) ✅ COMPLETED
- ✅ Install AI SDK Elements component library (`npx ai-elements@latest`).
- ✅ Refactor workspace UI to use standardized components:
  - `Conversation` + `ConversationContent` + `ConversationScrollButton` for chat container
  - `Message` + `MessageContent` for individual messages with role-based styling
  - `Response` for streaming markdown content (via Streamdown)
  - `Reasoning` + `ReasoningTrigger` + `ReasoningContent` for collapsible LLM thinking traces
  - `PromptInput` + sub-components for text input and submit controls
  - `Actions` + `Action` for message actions (retry, copy)
  - `Loader` for streaming indicators
  - Custom `ConversationList` for sidebar (DuckDB-backed session history)
- ✅ Replace manual UI components with AI SDK Elements equivalents.
- ✅ SSE events now render with proper AI SDK components and styling.
- ✅ TypeScript compilation and backend tests passing.

### Milestone H2 — Settings & Onboarding (Week 9)
- Design settings panel for data source + dbt path configuration using backend `/api/v1/chat/settings`.
- Add simple onboarding modal on first launch to guide users through setup.
- Introduce lightweight global state (React Context or Zustand) for settings persistence.

### Milestone I — E2E Validation & Docs (Week 10)
- Write E2E tests (Playwright/Cypress) for ingest → dbt run → agent query scenario.
- Document frontend setup, component structure, and testing strategy in `docs/`.
- Deliver developer scripts: `pnpm dev:all`, `pnpm test:e2e`, `pnpm lint`.
- Perform polish pass: error boundaries, fallback views, production build check.

## 5. Technical Considerations
- **AI SDK Elements**: Use official Vercel component library (https://ai-sdk.dev/elements/overview) built on shadcn/ui for chat UI. Benefits:
  - Standardized OpenAI-style components (`Conversation`, `Message`, `Response`, `Reasoning`)
  - Built-in streaming support and accessibility
  - Easy updates via `npx ai-elements@latest upgrade`
  - Customizable with Tailwind
- **Event Schema**: sync with `agent/core/events.py` to keep payload types consistent; map SSE events to AI SDK component props.
- **Networking**: CORS configured for local dev; SSE handled client-side via `EventSource`.
- **Styling**: Tailwind + AI SDK Elements (shadcn/ui primitives); maintain consistent design tokens.
- **State Management**: React Context for settings; local state for chat UI; avoid unnecessary global stores.
- **Accessibility**: AI SDK Elements provides ARIA attributes; ensure keyboard navigation works across workspace.
- **Internationalization**: keep copy centralized for future localization (KR/EN).

## 6. Testing Strategy
- Unit tests for hooks and utility parsers (Jest/Vitest).
- Component tests for chat UI states (Testing Library).
- E2E tests to validate full stack integration with mocked/real backend services.
- Visual regression snapshots (Chromatic/Loki) optional if time permits.

## 7. Dependencies & Risks
- Backend SSE interface must remain stable; coordinate changes via shared JSON schema docs.
- **AI SDK Elements** brings Radix UI, lucide-react, streamdown dependencies—these are well-maintained and align with modern React patterns.
- Local dev requires concurrent backend services; provide `pnpm dev:all` script to simplify bootstrapping.
- Ensure TypeScript types stay in sync with Python models (consider generated OpenAPI typings in Phase 3).
- AI SDK Elements may require mapping/adapting backend event shapes to match component expectations.

## 8. Open Questions
- Should the frontend expose advanced agent controls (tool toggles, mock mode) in MVP?
- What authentication story is required before public release (local token, basic auth, none)?
- Do we ship a desktop wrapper (Tauri/Electron) or stay browser-only for Phase 2?
- How much branding customization is needed before community preview?

Document last updated: October 20, 2025.

