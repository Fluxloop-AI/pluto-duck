---
date: 2026-01-13T12:45:00+09:00
researcher: Claude
topic: "코드베이스 실행 방법 및 .env 구성"
tags: [research, codebase, tauri, env, setup]
status: complete
---

# Research: 코드베이스 실행 방법 및 .env 구성

## Research Question
1. 현재 코드베이스 실행 방법 (tauri)
2. .env 파일 구성

## Summary

Pluto Duck은 **Python 백엔드(FastAPI)** + **Next.js 프론트엔드** + **Tauri 데스크톱 앱**으로 구성된 로컬 분석 스튜디오입니다. 개발 모드 실행에는 두 가지 방법이 있으며, `.env` 설정은 프론트엔드에서 백엔드 URL을 지정하는 데 사용됩니다.

---

## Detailed Findings

### 1. 프로젝트 구조

```
pluto-duck-v2/
├── backend/                  # Python 백엔드
│   ├── pluto_duck_backend/   # FastAPI 서비스
│   ├── duckpipe/             # SQL 파이프라인 엔진
│   ├── deepagents/           # AI 에이전트 런타임
│   └── run_backend.py        # 백엔드 실행 스크립트
├── frontend/
│   └── pluto_duck_frontend/  # Next.js 웹 인터페이스
├── tauri-shell/              # macOS 데스크톱 앱
│   └── src-tauri/
│       └── tauri.conf.json   # Tauri 설정
├── scripts/
│   ├── dev.sh                # 웹 개발 모드 실행
│   └── dev-tauri.sh          # Tauri 데스크톱 개발 모드
└── pyproject.toml            # Python 의존성
```

### 2. 실행 방법

#### 방법 A: 웹 개발 모드 (권장 - 빠른 개발)

```bash
# 1. Python 가상환경 설정
python -m venv .venv
source .venv/bin/activate
pip install -e .[dev]

# 2. 프론트엔드 의존성 설치
cd frontend/pluto_duck_frontend
pnpm install

# 3. 개발 서버 실행
./scripts/dev.sh
```

**실행 결과:**
- 백엔드: `http://127.0.0.1:8123` (uvicorn hot-reload)
- 프론트엔드: `http://127.0.0.1:3100` (Next.js dev)
- 브라우저 자동 오픈

#### 방법 B: Tauri 데스크톱 앱 모드

```bash
# 1. Rust 설치 필요 (https://rustup.rs)
# 2. 위의 Python & Node 설정 완료 후

./scripts/dev-tauri.sh
```

**Tauri 개발 모드 동작:**
1. 포트 8123, 3100 기존 프로세스 종료
2. `cargo tauri dev` 실행
3. Tauri가 자동으로:
   - 프론트엔드 빌드 (`pnpm dev --hostname 127.0.0.1 --port 3100`)
   - 백엔드 빌드 스크립트 실행
   - 네이티브 앱 창 표시

**Tauri 설정 (tauri.conf.json:6-10):**
```json
"build": {
  "devUrl": "http://127.0.0.1:3100",
  "frontendDist": "../../frontend/pluto_duck_frontend/out",
  "beforeDevCommand": "pnpm --dir ../frontend/pluto_duck_frontend dev --hostname 127.0.0.1 --port 3100",
  "beforeBuildCommand": "../scripts/build-backend.sh && pnpm --dir ../frontend/pluto_duck_frontend build"
}
```

---

### 3. .env 파일 구성

#### 위치
`frontend/pluto_duck_frontend/.env.local.example`

#### 내용
```bash
# Pluto-Duck Backend URL
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
```

#### 설정 방법

```bash
# .env.local 파일 생성
cd frontend/pluto_duck_frontend
cp .env.local.example .env.local

# 개발 모드에 맞게 URL 수정
# dev.sh 사용 시:
NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8123

# 기본값 (localhost:8000)은 다른 환경용
```

**주의:** 개발 스크립트(`dev.sh`)에서 백엔드는 **포트 8123**을 사용하므로, `.env.local`에서 URL을 `http://127.0.0.1:8123`으로 설정해야 합니다.

---

### 4. 필수 의존성

| 항목 | 버전 | 용도 |
|------|------|------|
| Python | 3.10+ | 백엔드 |
| Node.js | 18+ | 프론트엔드 |
| pnpm | 8.7.0+ | 패키지 매니저 |
| Rust | 1.77.2+ | Tauri 빌드 |

#### Python 의존성 설치
```bash
pip install -e .[dev]           # 개발 의존성 포함
pip install -e .[postgres]      # PostgreSQL 지원 추가
pip install -e .[local-llm]     # 로컬 LLM 지원 추가
```

---

## Code References

- [tauri.conf.json](tauri-shell/src-tauri/tauri.conf.json) - Tauri 앱 설정
- [dev.sh](scripts/dev.sh) - 웹 개발 모드 스크립트
- [dev-tauri.sh](scripts/dev-tauri.sh) - Tauri 개발 모드 스크립트
- [.env.local.example](frontend/pluto_duck_frontend/.env.local.example) - 환경변수 예제
- [pyproject.toml](pyproject.toml) - Python 프로젝트 설정
- [package.json (frontend)](frontend/pluto_duck_frontend/package.json) - 프론트엔드 스크립트

---

## Architecture Insights

1. **3-Zone 데이터 모델**: Raw Zone → Work Zone → Asset Zone
2. **Tauri 통합**: 프론트엔드는 Next.js static export 후 Tauri가 번들링
3. **백엔드 번들링**: PyInstaller로 단일 실행 파일 생성 (빌드 시)
4. **Hot-reload 지원**: 개발 모드에서 백엔드/프론트엔드 모두 hot-reload

---

## Quick Start Summary

```bash
# 1. Clone & Setup
git clone <repo>
cd pluto-duck-v2

# 2. Python 환경
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]

# 3. Frontend 의존성
cd frontend/pluto_duck_frontend
pnpm install
cp .env.local.example .env.local
# .env.local 수정: NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:8123

# 4. 실행
cd ../..
./scripts/dev.sh        # 웹 모드
# 또는
./scripts/dev-tauri.sh  # 데스크톱 앱 모드
```

---

## Open Questions

1. 백엔드에서 LLM API 키 (OpenAI 등)가 필요한 경우 어디에 설정하는지?
2. DuckDB 데이터 저장 경로 설정 방법?
