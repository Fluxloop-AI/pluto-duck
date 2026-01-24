# Add Dataset Modal Implementation Plan

## Overview
Dataset 섹션의 + 버튼 클릭 시 나타나는 새 모달 구현. 드래그&드롭, From device, Google Sheets, Database 옵션을 제공하고 파일 선택 후 프리뷰 화면으로 전환되는 2단계 wizard 형태.

## Current State Analysis

### 기존 구현
- **Sidebar Dataset + 버튼**: [page.tsx:575](frontend/pluto_duck_frontend/app/page.tsx#L575) - `onAddClick={() => { /* TODO: Open add dataset modal */ }}`
- **Connect Data 모달**: [DataSourcesModal.tsx](frontend/pluto_duck_frontend/components/data-sources/DataSourcesModal.tsx) - 기존 connector grid 방식
- **Import 모달들**: ImportCSVModal, ImportParquetModal, ImportPostgresModal - 개별 import flow

### 재활용 가능 요소
| 요소 | 파일 | 재활용 방식 |
|------|------|------------|
| 드래그&드롭 패턴 | [prompt-input.tsx:574-622](frontend/pluto_duck_frontend/components/ai-elements/prompt-input.tsx#L574-L622) | 이벤트 핸들러 패턴 참고 |
| Tauri 파일 다이얼로그 | [page.tsx:278-331](frontend/pluto_duck_frontend/app/page.tsx#L278-L331) | `openDialog()` 함수 재사용 |
| PostgreSQL 연결 | [ImportPostgresModal.tsx](frontend/pluto_duck_frontend/components/data-sources/ImportPostgresModal.tsx) | 컴포넌트 직접 재사용 |
| CSV/Parquet import API | [fileAssetApi.ts](frontend/pluto_duck_frontend/lib/fileAssetApi.ts) | API 함수 재사용 |

## Desired End State

### 모달 Flow
```
Step 1: Select Source          Step 2: File Preview
┌─────────────────────────┐    ┌─────────────────────────┐
│  ┌───────────────────┐  │    │  6 files uploaded    X  │
│  │                   │  │    ├─────────────────────────┤
│  │   Drop files here │  │    │  ☑ google_ad_2025.csv 🗑│
│  │        ⬆         │  │    │  ☑ naver_ad_251208.csv 🗑│
│  └───────────────────┘  │    │  ☑ linkedin_ad.csv    🗑│
│                         │    │  ...                    │
│  📁 From device         │    ├─────────────────────────┤
│  📊 Google Sheets       │    │ [Clear] [Add more][Scan]│
│  🗄️ Database            │    └─────────────────────────┘
│                         │
│       [Cancel]          │
└─────────────────────────┘
```

### 검증 조건
- [ ] Dataset + 버튼 클릭 시 모달 열림
- [ ] 드래그&드롭으로 파일 추가 가능
- [ ] From device로 파일 선택 가능 (Tauri/Web 모두)
- [ ] Database 클릭 시 PostgreSQL 모달 열림
- [ ] Google Sheets는 "Coming soon" 표시
- [ ] Scan 버튼 클릭 시 파일 import 실행
- [ ] Import 성공 후 Dataset 목록 새로고침

## What We're NOT Doing
- Google Sheets OAuth 연동 (placeholder만 추가)
- 파일 내용 프리뷰 (테이블 형태로 미리보기)
- 다중 파일의 개별 테이블명 설정 UI

## Implementation Approach

프로토타입의 스타일링을 참고하되, 기존 shadcn/ui Dialog 컴포넌트 기반으로 구현. 모달 내부 스타일만 커스터마이즈하여 일관성 유지.

---

## - [x] Phase 1: AddDatasetModal 기본 구조

### Overview
2단계 wizard 구조의 모달 컴포넌트 생성. 초기 화면(소스 선택)과 파일 프리뷰 화면 구현.

### Changes Required:

#### 1. AddDatasetModal 컴포넌트 생성
**File**: `frontend/pluto_duck_frontend/components/data-sources/AddDatasetModal.tsx`

**Changes**:
- Dialog 기반 모달 컴포넌트 생성
- Props: `projectId`, `open`, `onOpenChange`, `onImportSuccess`
- 내부 상태: `step` ('select' | 'preview'), `selectedFiles`
- 프로토타입 스타일 적용:
  - 모달 컨테이너: `rounded-3xl`, 고정 높이, padding `p-8`
  - 드롭존: `border-dashed`, `rounded-2xl`, hover 효과
  - 옵션 버튼: `rounded-xl`, `py-3.5`
  - Scan 버튼: primary 색상 (`bg-primary`)

#### 2. SelectSourceView 서브컴포넌트
**File**: 동일 파일 내 또는 별도 파일

**Changes**:
- 드롭존 영역 (드래그&드롭 지원)
- From device 버튼 (Tauri dialog / web prompt)
- Google Sheets 버튼 (disabled, "Coming soon")
- Database 버튼 (ImportPostgresModal 트리거)
- Cancel 버튼

#### 3. FilePreviewView 서브컴포넌트
**File**: 동일 파일 내 또는 별도 파일

**Changes**:
- 헤더: "N files uploaded" + 닫기 버튼
- 스크롤 가능한 파일 목록
- 각 파일: 아이콘 + 체크마크 + 파일명 + 삭제 버튼
- 푸터: Clear / Add more / Scan 버튼

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음
- [x] ESLint 에러 없음

#### Manual Verification:
- [ ] 모달 열기/닫기 동작
- [ ] 두 화면 간 전환 동작
- [ ] 프로토타입과 시각적으로 유사

---

## - [x] Phase 2: 드래그&드롭 및 파일 선택 구현

### Overview
드래그&드롭 이벤트 핸들링과 From device 파일 선택 기능 구현.

### Changes Required:

#### 1. 드래그&드롭 핸들러
**File**: `AddDatasetModal.tsx`

**Changes**:
- `isDragOver` 상태로 시각적 피드백
- `onDragOver`, `onDragLeave`, `onDrop` 이벤트 핸들러
- CSV/Parquet 파일만 필터링
- Tauri 환경: `tauri://file-drop` 이벤트로 실제 경로 획득
- Web 환경: File 객체에서 name만 표시 (경로 없음 - 추후 업로드 API 필요)

#### 2. From device 파일 선택
**File**: `AddDatasetModal.tsx`

**Changes**:
- Tauri: `openDialog({ multiple: true, filters: [{ extensions: ['csv', 'parquet'] }] })`
- Web: 수동 경로 입력 prompt 또는 `<input type="file">` 사용
- 선택된 파일 경로를 `selectedFiles` 상태에 추가

#### 3. 파일 상태 관리
**File**: `AddDatasetModal.tsx`

**Changes**:
- `selectedFiles: { name: string; path: string | null; file?: File }[]` 타입
- 파일 추가/삭제/초기화 함수
- Add more 클릭 시 추가 파일 선택

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음

#### Manual Verification:
- [ ] 드래그&드롭으로 파일 추가됨
- [ ] 드래그 오버 시 시각적 피드백
- [ ] From device로 파일 선택됨
- [ ] 개별 파일 삭제 동작
- [ ] Clear로 전체 초기화

---

## - [x] Phase 3: Import 기능 및 통합

### Overview
Scan 버튼 클릭 시 파일 import 실행 및 page.tsx 통합.

### Changes Required:

#### 1. Scan (Import) 로직
**File**: `AddDatasetModal.tsx`

**Changes**:
- Scan 버튼 클릭 시 각 파일에 대해 `importFile()` API 호출
- 테이블명 자동 생성: 파일명 기반 identifier 변환
- 중복 테이블명 처리 (suffix 추가)
- 로딩 상태 표시
- 성공/실패 피드백

#### 2. Database 연결 통합
**File**: `AddDatasetModal.tsx`

**Changes**:
- Database 버튼 클릭 시 `ImportPostgresModal` 열기
- 별도 상태로 postgres 모달 관리
- Import 성공 시 콜백 전달

#### 3. page.tsx 통합
**File**: `frontend/pluto_duck_frontend/app/page.tsx`

**Changes**:
- `AddDatasetModal` import 추가
- `showAddDatasetModal` 상태 추가
- `onAddClick` 핸들러에서 모달 열기
- `onImportSuccess` 콜백에서 데이터 새로고침

### Success Criteria:

#### Automated Verification:
- [x] TypeScript 컴파일 에러 없음
- [x] 빌드 성공

#### Manual Verification:
- [ ] Dataset + 버튼으로 모달 열림
- [ ] Scan 클릭 시 파일 import 성공
- [ ] Import 후 Dataset 목록에 새 항목 표시
- [ ] Database로 PostgreSQL 연결 가능
- [ ] 에러 발생 시 적절한 메시지 표시

---

## Testing Strategy

### Unit Tests:
- AddDatasetModal 컴포넌트 렌더링
- 파일 필터링 로직 (CSV/Parquet만)
- 테이블명 자동 생성 로직

### Integration Tests:
- 모달 열기 → 파일 선택 → Import 전체 flow

### Manual Testing Steps:
1. Dataset + 버튼 클릭하여 모달 열기
2. CSV 파일을 드래그&드롭으로 추가
3. 파일 목록 확인 후 Scan 클릭
4. Dataset 목록에 새 항목 추가 확인
5. Database 버튼으로 PostgreSQL 연결 테스트
6. 모달 닫기 및 재열기 시 상태 초기화 확인

## Performance Considerations
- 다중 파일 import 시 순차 처리 (병렬 처리 시 DB 충돌 가능)
- 대용량 파일 목록 시 가상화 스크롤 고려 (초기 구현에서는 생략)

## Migration Notes
- 기존 DataSourcesModal은 그대로 유지 (Asset Library 등에서 사용)
- 새 AddDatasetModal은 Sidebar Dataset + 버튼 전용

## References
- [docs/research/032_dataset_add_modal_implementation.md](docs/research/032_dataset_add_modal_implementation.md) - 기존 코드베이스 분석
- [Pluto-Duck-OSS-UI-Prototype/components/DataUploadModal.tsx](/Users/yoojungkim/Documents/Pluto-Duck-OSS-UI-Prototype/components/DataUploadModal.tsx) - 프로토타입 모달 스타일
- [Pluto-Duck-OSS-UI-Prototype/components/Sidebar.tsx](/Users/yoojungkim/Documents/Pluto-Duck-OSS-UI-Prototype/components/Sidebar.tsx) - 프로토타입 사이드바
- [frontend/pluto_duck_frontend/components/data-sources/ImportCSVModal.tsx](frontend/pluto_duck_frontend/components/data-sources/ImportCSVModal.tsx) - 기존 CSV import 모달
- [frontend/pluto_duck_frontend/components/data-sources/ImportPostgresModal.tsx](frontend/pluto_duck_frontend/components/data-sources/ImportPostgresModal.tsx) - PostgreSQL 연결 모달
- [frontend/pluto_duck_frontend/lib/fileAssetApi.ts](frontend/pluto_duck_frontend/lib/fileAssetApi.ts) - 파일 import API
