---
date: 2026-01-22T15:30:00+09:00
researcher: Claude
topic: "Dataset 추가 모달 구현 - 기존 코드베이스 분석"
tags: [research, modal, dataset, file-upload, drag-drop, postgres, google-sheets]
status: complete
---

# Research: Dataset 추가 모달 구현을 위한 코드베이스 분석

## Research Question
Dataset의 + 버튼 클릭 시 나타날 새 모달 구현을 위해 기존 Connect Data 관련 코드와 API를 분석하여 재활용 방안 검토

## Summary

| 기능 | 현재 구현 | 재활용 가능 여부 | 비고 |
|------|----------|------------------|------|
| **드래그&드롭** | `prompt-input.tsx`에 구현됨 | 패턴 참고 가능 | DataTransfer API 사용 |
| **From device** | `handleImportClick('file')` | 직접 재활용 가능 | Tauri dialog / web prompt |
| **Google Sheets** | 미구현 | 새로 구현 필요 | Placeholder만 추가 |
| **Database** | `ImportPostgresModal` | 직접 재활용 가능 | 2단계 wizard |

## Detailed Findings

### 1. 현재 Connect Data 구조

**파일:** [DataSourcesModal.tsx](frontend/pluto_duck_frontend/components/data-sources/DataSourcesModal.tsx)

```
┌─────────────────────────────────────┐
│        Connect Data Modal            │
├─────────────────────────────────────┤
│  ┌─────────┐  ┌─────────┐           │
│  │  File   │  │ Folder  │           │
│  └─────────┘  └─────────┘           │
│  ┌─────────┐  ┌─────────┐           │
│  │PostgreSQL│ │ SQLite  │           │
│  └─────────┘  └─────────┘           │
├─────────────────────────────────────┤
│  Asset Library 링크                  │
└─────────────────────────────────────┘
```

**ConnectorGrid 옵션들** ([ConnectorGrid.tsx:35-60](frontend/pluto_duck_frontend/components/data-sources/ConnectorGrid.tsx#L35-L60)):

| Type | Name | Icon | Description |
|------|------|------|-------------|
| `file` | Import file | FileTextIcon | CSV/Parquet 파일 import |
| `folder` | Connect folder | FolderIcon | 폴더를 Source로 추가 |
| `postgres` | PostgreSQL | ServerIcon | PostgreSQL 연결 |
| `sqlite` | SQLite | DatabaseIcon | SQLite import |

---

### 2. 드래그&드롭 파일 업로드 구현 방법

**참고 파일:** [prompt-input.tsx:574-622](frontend/pluto_duck_frontend/components/ai-elements/prompt-input.tsx#L574-L622)

**핵심 패턴:**
```tsx
// Form에 drag-drop 이벤트 핸들러 등록
useEffect(() => {
  const form = formRef.current;
  if (!form) return;

  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
    }
  };

  const onDrop = (e: DragEvent) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
    }
    if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  form.addEventListener("dragover", onDragOver);
  form.addEventListener("drop", onDrop);

  return () => {
    form.removeEventListener("dragover", onDragOver);
    form.removeEventListener("drop", onDrop);
  };
}, []);
```

**새 모달에 적용할 드래그&드롭 영역:**
```tsx
// Drop zone 상태 관리
const [isDragOver, setIsDragOver] = useState(false);
const [droppedFiles, setDroppedFiles] = useState<File[]>([]);

// 드래그 오버 시각 피드백
<div
  onDragOver={(e) => {
    e.preventDefault();
    setIsDragOver(true);
  }}
  onDragLeave={() => setIsDragOver(false)}
  onDrop={(e) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    // CSV/Parquet 필터링
    const validFiles = files.filter(f =>
      f.name.endsWith('.csv') || f.name.endsWith('.parquet')
    );
    setDroppedFiles(validFiles);
  }}
  className={`border-2 border-dashed rounded-lg p-8 ${
    isDragOver ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'
  }`}
>
  <Upload className="h-8 w-8" />
  <span>Drop files here</span>
</div>
```

---

### 3. From Device 파일 선택 (기존 API 활용)

**파일:** [page.tsx:278-331](frontend/pluto_duck_frontend/app/page.tsx#L278-L331)

**`handleImportClick('file')` 로직:**
```tsx
case 'file': {
  void (async () => {
    try {
      let filePath: string | null = null;

      // Tauri 런타임: 네이티브 파일 다이얼로그
      if (isTauriRuntime()) {
        const selected = await openDialog({
          multiple: false,
          filters: [{
            name: 'Data Files',
            extensions: ['csv', 'parquet'],
          }],
        });
        if (!selected) return;
        filePath = selected as string;
      } else {
        // 웹 런타임: 수동 경로 입력
        filePath = window.prompt('Paste the absolute file path (.csv or .parquet):') || null;
        if (!filePath) return;
      }

      // 확장자에 따라 적절한 모달 열기
      const ext = filePath.split('.').pop()?.toLowerCase();
      setImportFilePath(filePath);

      if (ext === 'csv') {
        setImportCSVOpen(true);
      } else if (ext === 'parquet') {
        setImportParquetOpen(true);
      }
    } catch (e) {
      console.error('Failed to open file dialog:', e);
    }
  })();
  break;
}
```

**재활용 방법:**
- 새 모달에서 "From device" 버튼 클릭 시 동일한 로직 호출
- 또는 함수로 추출하여 공유

**다중 파일 선택 지원 버전:**
```tsx
const selected = await openDialog({
  multiple: true,  // 다중 파일 선택
  filters: [{
    name: 'Data Files',
    extensions: ['csv', 'parquet'],
  }],
});
```

---

### 4. Google Sheets (미구현 - Placeholder만)

**현재 상태:**
- 코드베이스에 Google Sheets 관련 구현 없음
- 향후 확장 계획에 포함되어 있음 ([data-sources-ui-plan.md](docs/plans/done/data-sources-ui-plan.md))

**새 모달에서의 처리:**
```tsx
// Google Sheets 버튼 (비활성화)
<button
  disabled
  className="flex items-center gap-2 p-4 rounded-lg border border-dashed opacity-50 cursor-not-allowed"
>
  <FileSpreadsheet className="h-4 w-4" />
  <span>Google Sheets</span>
  <span className="text-xs text-muted-foreground">(Coming soon)</span>
</button>
```

---

### 5. Database 연결 (PostgreSQL 재활용)

**파일:** [ImportPostgresModal.tsx](frontend/pluto_duck_frontend/components/data-sources/ImportPostgresModal.tsx)

**2단계 Wizard 구조:**
```
Step 1: Connection          Step 2: Table Selection
┌─────────────────────┐     ┌─────────────────────┐
│ Display Name        │     │ ☑ Select all (3/5)  │
│ [_______________]   │     │ ☑ users             │
│                     │     │ ☑ orders            │
│ Connection String   │     │ ☑ products          │
│ [postgresql://...]  │     │ ☐ logs              │
│                     │     │ ☐ sessions          │
│ Description         │     │                     │
│ [_______________]   │     │ ☑ Overwrite if exist│
│                     │     │                     │
│ [Test Connection]   │     │ [Back] [Import]     │
└─────────────────────┘     └─────────────────────┘
```

**재활용 방법:**
새 모달에서 "Database" 버튼 클릭 시 `ImportPostgresModal` 열기:
```tsx
// 상태 관리
const [importPostgresOpen, setImportPostgresOpen] = useState(false);

// Database 버튼
<button onClick={() => setImportPostgresOpen(true)}>
  <Database className="h-4 w-4" />
  <span>Database</span>
</button>

// 모달 렌더링 (기존 컴포넌트 재사용)
<ImportPostgresModal
  projectId={projectId}
  open={importPostgresOpen}
  onOpenChange={setImportPostgresOpen}
  onImportSuccess={handleImportSuccess}
/>
```

---

### 6. 파일 Import API

**파일:** [fileAssetApi.ts](frontend/pluto_duck_frontend/lib/fileAssetApi.ts)

**핵심 함수:**
```typescript
// 파일 import (CSV/Parquet)
export async function importFile(
  projectId: string,
  request: ImportFileRequest
): Promise<FileAsset> {
  const url = `${getBackendUrl()}/api/v1/asset/files?project_id=${projectId}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return handleResponse(response);
}

// ImportFileRequest 구조
interface ImportFileRequest {
  file_path: string;        // 파일 경로
  file_type: 'csv' | 'parquet';
  table_name: string;       // DuckDB 테이블명
  name: string;             // 표시 이름
  description?: string;
  overwrite?: boolean;      // 기존 테이블 덮어쓰기
  mode?: 'replace' | 'append' | 'merge';
}
```

**드래그&드롭 파일 처리 시 주의:**
- 현재 API는 **파일 경로**를 받음 (서버에서 직접 읽음)
- 웹 브라우저의 File 객체는 경로를 노출하지 않음
- Tauri 런타임에서만 실제 경로 접근 가능

**대안 1 - Tauri 전용:**
```tsx
// Tauri에서 드래그된 파일 경로 가져오기
import { listen } from '@tauri-apps/api/event';

// 드래그된 파일의 실제 경로를 얻을 수 있음
listen('tauri://file-drop', (event) => {
  const paths = event.payload as string[];
  // paths = ['/Users/.../file1.csv', '/Users/.../file2.csv']
});
```

**대안 2 - 웹 호환:**
파일 업로드 엔드포인트 새로 구현 (FormData 사용)

---

### 7. 새 모달 구현 제안 구조

```tsx
// components/data-sources/AddDatasetModal.tsx

interface AddDatasetModalProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSuccess?: () => void;
}

export function AddDatasetModal({ projectId, open, onOpenChange, onImportSuccess }: AddDatasetModalProps) {
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [step, setStep] = useState<'select' | 'preview'>('select');
  const [importPostgresOpen, setImportPostgresOpen] = useState(false);

  // Step 1: 소스 선택 화면
  // Step 2: 파일 프리뷰 및 확인 화면 (다중 파일 드롭 시)

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        {step === 'select' ? (
          <SelectSourceView
            onDrop={setDroppedFiles}
            onFromDevice={handleFromDevice}
            onGoogleSheets={() => {/* TODO */}}
            onDatabase={() => setImportPostgresOpen(true)}
          />
        ) : (
          <FilePreviewView
            files={droppedFiles}
            onClear={() => setDroppedFiles([])}
            onAddMore={handleAddMore}
            onScan={handleScan}
          />
        )}
      </Dialog>

      <ImportPostgresModal
        projectId={projectId}
        open={importPostgresOpen}
        onOpenChange={setImportPostgresOpen}
        onImportSuccess={onImportSuccess}
      />
    </>
  );
}
```

---

## Code References

| 파일 | 설명 |
|------|------|
| [page.tsx:278-331](frontend/pluto_duck_frontend/app/page.tsx#L278-L331) | handleImportClick - connector type별 처리 |
| [page.tsx:572-583](frontend/pluto_duck_frontend/app/page.tsx#L572-L583) | SidebarSection Dataset + 버튼 위치 |
| [DataSourcesModal.tsx](frontend/pluto_duck_frontend/components/data-sources/DataSourcesModal.tsx) | 현재 Connect Data 모달 |
| [ConnectorGrid.tsx](frontend/pluto_duck_frontend/components/data-sources/ConnectorGrid.tsx) | Connector 옵션 그리드 |
| [ImportCSVModal.tsx](frontend/pluto_duck_frontend/components/data-sources/ImportCSVModal.tsx) | CSV import 모달 |
| [ImportParquetModal.tsx](frontend/pluto_duck_frontend/components/data-sources/ImportParquetModal.tsx) | Parquet import 모달 |
| [ImportPostgresModal.tsx](frontend/pluto_duck_frontend/components/data-sources/ImportPostgresModal.tsx) | PostgreSQL 연결 모달 |
| [fileAssetApi.ts](frontend/pluto_duck_frontend/lib/fileAssetApi.ts) | 파일 asset API |
| [prompt-input.tsx:574-622](frontend/pluto_duck_frontend/components/ai-elements/prompt-input.tsx#L574-L622) | 드래그&드롭 구현 예시 |
| [tauriRuntime.ts](frontend/pluto_duck_frontend/lib/tauriRuntime.ts) | Tauri 런타임 감지 |

---

## Architecture Insights

### 재활용 가능한 패턴

1. **Tauri Dialog 패턴**: `openDialog()` 함수 import 및 options 설정
2. **2단계 Wizard 패턴**: Step state로 connection → selection 흐름 관리
3. **드래그&드롭 패턴**: useEffect로 이벤트 리스너 등록/해제
4. **파일 검증 패턴**: 확장자 기반 필터링 및 타입 분기

### 새로 구현 필요한 부분

1. **드래그&드롭 영역 UI**: Drop zone 시각적 피드백
2. **다중 파일 프리뷰**: 파일 목록 표시 및 개별 삭제
3. **Scan 버튼 로직**: 선택된 파일들 일괄 import
4. **Google Sheets**: OAuth + API 연동 (향후 구현)

---

## Open Questions

1. **웹 환경에서 드래그&드롭**: File 객체에서 경로를 얻을 수 없는데, 어떻게 처리할 것인가?
   - Option A: Tauri 전용 기능으로 제한
   - Option B: 새로운 파일 업로드 API 엔드포인트 추가 (FormData)

2. **다중 파일 import 흐름**: 각 파일의 테이블명을 개별 설정할 것인가, 자동 생성할 것인가?

3. **Google Sheets**: OAuth 인증 흐름을 어디서 처리할 것인가? (Backend vs Tauri)
