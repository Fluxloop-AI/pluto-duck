# Pluto-Duck OSS

Local-first analytics studio powered by DuckDB, dbt, and an AI-assisted query agent.

<p align="center">
  <img src="docs/screen1.png" alt="Chat Interface" width="45%" />
  <img src="docs/screen2.png" alt="Data Sources" width="45%" />
</p>

## 프로덕트 목적

**Pluto Duck**은 개인과 소규모 팀을 위한 **로컬 우선(Local-first) 데이터 분석 환경**입니다. 
클라우드에 데이터를 업로드하지 않고도 강력한 분석 기능을 제공합니다.

### 핵심 가치

- **🔒 프라이버시 우선**: 모든 데이터와 연산이 로컬 머신에서 실행되며, 외부로 전송되지 않습니다
- **💬 자연어 질의**: AI 에이전트와 대화하듯 데이터를 질의하고 인사이트를 얻을 수 있습니다
- **🚀 빠른 데이터 처리**: DuckDB 기반의 고성능 분석 엔진으로 대용량 데이터도 빠르게 처리합니다
- **🔌 유연한 연결**: CSV, Parquet, PostgreSQL, SQLite 등 다양한 데이터 소스를 간편하게 연결합니다
- **🛠️ 전문가 친화적**: dbt 통합으로 데이터 변환 로직을 체계적으로 관리할 수 있습니다

## 프로덕트 방향

Pluto Duck은 단계별로 진화하며, 다음과 같은 방향으로 발전하고 있습니다:

1. **개인 데이터 IDE**: 개발자와 데이터 분석가가 로컬에서 편안하게 작업할 수 있는 도구
2. **접근성 확대**: CLI, 웹 인터페이스, 데스크톱 앱 등 다양한 사용 방식 지원
3. **오픈소스 우선**: 커뮤니티와 함께 성장하며 투명하게 개발
4. **(미래) 하이브리드 옵션**: 필요에 따라 클라우드 기능을 선택적으로 활용할 수 있는 확장성

## Project Layout

- `backend/pluto_duck_backend`: FastAPI service, ingestion/transformation engines, and AI agent.
- `packages/pluto_duck_cli`: Typer-based CLI entrypoint (`pluto-duck`).
- `frontend/pluto_duck_frontend`: Minimal chat/front-end client (placeholder).
- `dbt_projects/core`: Reference dbt project used by the transformation service.
- `legacy/`: Snapshot of prior closed-source implementation for reference only (ignored by git).

## Getting Started

```bash
python -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -e .[dev]

# Run linters/tests
ruff check backend packages
mypy backend packages
pytest backend

# Run API locally
pluto-duck run

# Stream agent events for a natural-language question
pluto-duck agent-stream "List customers"
```

Agent responses are also available via `/api/v1/agent/{run_id}/events` as SSE streams. Each event carries structured JSON describing reasoning updates, tool outputs, and final summaries (see `docs/ARCHITECTURE.md`). For CLI instructions using a real GPT provider, refer to `docs/AGENT_CLI_GUIDE.md`.

## Desktop App (macOS)

### Development

```bash
# Start backend + frontend + Tauri in dev mode
./scripts/dev.sh
```

### Building

```bash
# Build unsigned .app (for local testing)
./scripts/build.sh

# Output:
# - tauri-shell/src-tauri/target/release/bundle/macos/Pluto Duck.app
# - tauri-shell/src-tauri/target/release/bundle/dmg/Pluto Duck_0.1.0_aarch64.dmg
```

### Code Signing & Distribution

**서명 없이 배포** (다른 Mac에서 실행 시):
```bash
# 사용자가 실행:
xattr -cr "/path/to/Pluto Duck.app"
```

**서명하여 배포** (Apple Developer 계정 필요):
```bash
# 1. 인증서 확인
security find-identity -v -p codesigning

# 2. 서명된 앱 빌드
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAM_ID)" \
./scripts/build-signed.sh

# 3. (선택) 노터라이제이션까지 완료
CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAM_ID)" \
NOTARIZE=true \
./scripts/build-signed.sh
```

상세 가이드: `docs/CODESIGNING.md` 또는 `docs/QUICK_START_CODESIGNING.md`

## Roadmap Highlights

- Phase 1: Extract clean OSS backend, focus on ingestion, dbt integration, public API, CLI.
- Phase 2: Ship minimal chat frontend for end-to-end local experience.
- Phase 3: Prepare for optional managed/cloud offering with premium features.
- **Phase 5: macOS desktop app with Tauri** ✅ **완료**

See `docs/plans/` for detailed design notes.

