# Pluto-Duck macOS Tauri 패키징 계획

## 개요
- 목표: `pluto_duck_backend` FastAPI 서버와 `pluto_duck_frontend` Next.js UI를 macOS Tauri 앱으로 배포
- 결과물: 코드 서명/노터라이즈 가능한 `.app` 혹은 `.dmg`, 첫 실행 시 로컬 데이터 디렉터리 구성
- 전제 조건: Python 3.10 런타임, Node.js 18+, pnpm, Rust toolchain

## Phase 0 — 백엔드 실행 및 데이터 경로 정비
- FastAPI 엔트리 스크립트 `run_backend.py` 작성: uvicorn 기동, 필수 환경변수 정의, 로깅 설정
- macOS 데이터 폴더(`~/Library/Application Support/PlutoDuck`) 생성 유틸 추가, 최초 실행 시 duckdb 파일·dbt 템플릿 복사
- 로컬 개발 환경에서 스크립트 단독 실행으로 duckdb, dbt, psycopg 등 의존성 검증 및 회복 절차 문서화

## Phase 1 — 백엔드 사이드카 빌드
- PyInstaller/Briefcase 중 선택해 FastAPI 서버를 단일 실행 파일로 빌드 (`dist/backend-runner`)
- 빌드 스펙에 템플릿/정적 리소스 포함 (`pyproject.toml`의 package-data 확인)
- 런타임 검증: 빌드 산출물 독립 실행 → 헬스체크 엔드포인트 및 duckdb, dbt 호출 성공 여부 테스트
- 사이드카 배포용 폴더 구조 확정: `backend/{runner,templates,config}`

## Phase 2 — 프론트엔드 빌드 및 설정
- `pnpm install` → `pnpm build` 실행, Next.js 산출물 확보
- 환경변수(`NEXT_PUBLIC_API_BASE_URL`)를 로컬 사이드카 주소로 지정, `.env.production` 관리
- Tauri WebView 보안을 고려해 필요한 헤더/도메인 화이트리스트 재검토 (`tauri.security.csp`, `allowlist.http`)

## Phase 3 — Tauri 프로젝트 구성
- `pnpm create tauri-app` (또는 `cargo tauri init`)으로 셸 초기화, distDir을 프론트 빌드 폴더로 지정
- `tauri.conf.json`에 사이드카 실행 파일 등록: `bundle.sidecar` 경로, 백엔드 명령어/인자 정의
- Tauri `setup` 훅에서 백엔드 기동 및 헬스체크 대기 로직 구현, 종료 시 프로세스 종료 처리
- Tauri 명령(`invoke`)으로 백엔드 상태 조회, 로그 경로 열람, 오류 재시작 지원

## Phase 4 — 통합 테스트 및 품질 보증
- 통합 스크립트 작성: Tauri 앱 실행 → 헬스체크 → 기본 워크플로(ingest → dbt run → query) 자동화
- 오류 로그를 데이터 폴더 하위(`Logs/`)에 저장하고 사용자에게 접근 경로 안내
- Playwright 또는 tauri-driver 기반 UI 테스트 도입, 사이드카 비정상 종료 대응 케이스 포함

## Phase 5 — 배포 자동화 및 서명
- GitHub Actions macOS 러너 워크플로: 프론트 빌드 → 백엔드 사이드카 빌드 → `cargo tauri build`
- 코드 서명 인증서 준비 및 `tauri.conf.json`/CI 시크릿에 통합, notarization 스텝 자동화
- 릴리스 아티팩트로 `.app`, `.dmg`, 체크섬 업로드, 설치 가이드 문서화

## 체크리스트
- [ ] 백엔드 엔트리 스크립트 및 데이터 폴더 초기화 검증
- [ ] PyInstaller/Briefcase 산출물 안정성 확인 및 사이드카 구조 확정
- [ ] Next.js 빌드와 Tauri WebView 연동 완료
- [ ] Tauri에서 사이드카 프로세스 수명 주기 제어 구현
- [ ] 통합 테스트 스위트 및 로그 경로 검증
- [ ] CI 파이프라인 구축, 서명/노터라이즈 자동화, 릴리스 문서화




## 다음 단계 제안

- **개발용 자동 실행 스크립트 작성**  
  - `scripts/dev.sh` 같은 스크립트에서 백엔드(`dist/pluto-duck-backend/pluto-duck-backend`)를 먼저 띄우고 헬스체크 통과 기다린 뒤, Next dev 서버와 `cargo tauri dev`를 실행하도록 구성합니다.  
  - `tauri.conf.json`의 `beforeDevCommand`를 이 스크립트 호출로 교체.

- **백엔드 빌드 파이프라인 추가**  
  - PyInstaller로 백엔드 실행 파일을 만드는 명령을 프로젝트 루트에 문서화/자동화합니다 (예: `pnpm run build:backend` → 내부에서 `pyinstaller pluto-duck-backend.spec`).  
  - 배포 빌드 전(`beforeBuildCommand`)에 이 명령을 실행해 항상 최신 백엔드 바이너리가 준비되도록 합니다.

- **Tauri 번들 설정 보강**  
  - `tauri.conf.json`의 `bundle.resources`에 `../dist/pluto-duck-backend/pluto-duck-backend`를 추가해 패키징된 앱 안으로 복사되게 합니다.  
  - 필요하면 `Persistent` 데이터 폴더 초기화/권한 확인 로직도 정리.

- **자동 헬스체크/타임아웃 튜닝**  
  - `wait_for_backend_ready()`가 더 친절한 로그와 긴 타임아웃(예: 10초)을 갖도록 조정해 첫 시작 시 안정성을 높입니다.

이 네 가지를 마치면 `cargo tauri dev`와 `cargo tauri build` 모두 프런트·백엔드가 자동으로 함께 떠도록 정리됩니다.

### 최신 진행 상황 요약 (2025-10-21)
- `scripts/dev.sh` 추가: 백엔드 → 헬스체크 → Next dev → Tauri dev 순으로 실행, 종료 시 프로세스 정리.
- `scripts/build-backend.sh` 추가: PyInstaller로 백엔드 실행 파일 재생성 (`dist/`, `build/`).
- `tauri.conf.json` 갱신
  - `beforeDevCommand`를 `../scripts/dev.sh`로 교체.
  - `beforeBuildCommand`에 백엔드 빌드, 프런트 빌드/익스포트 순서 추가.
  - `bundle.resources`에 `../dist/pluto-duck-backend/pluto-duck-backend` 포함.
- `pyproject.toml`에 `build:backend` 스크립트 등록 (PyInstaller 실행).
- `src-tauri/src/lib.rs`
  - 백엔드 stdout/stderr 상속으로 dev 모드 로그 노출.