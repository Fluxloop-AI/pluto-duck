# PlutoDuck 트랜잭션 관리 전략

> **Status**: Approved  
> **Created**: 2026-01-11  
> **Updated**: 2026-01-11  
> **Author**: AI Assistant  
> **Decision**: 이벤트 기반 자동 스냅샷 + 히스토리 UI

---

## 1. 배경 및 문제 정의

### 1.1 PlutoDuck의 특성

PlutoDuck은 **로컬 데스크톱 DB IDE**로서 다음과 같은 특징을 가집니다:

| 특성 | 값 | 의미 |
|------|-----|------|
| 사용자 수 | 1명 (로컬) | 동시성 요구사항 낮음 |
| DB 타입 | DuckDB (단일 파일) | 파일 기반 백업 가능 |
| 배포 방식 | Tauri 데스크톱 앱 | 서버 없이 동작 |
| 주요 사용 시나리오 | 탐색적 데이터 분석 | 실수 복구 필요 |

### 1.2 현재 문제점

1. **동시 접속 충돌**: 여러 API 요청이 동시에 DuckDB에 접근할 때 `Unique file handle conflict` 에러 발생
2. **롤백 불가**: 실수로 테이블을 삭제하거나 잘못된 쿼리를 실행했을 때 복구 방법 없음

### 1.3 요구사항

- **R1**: 동시 API 요청 시 DB 충돌 방지
- **R2**: 실수로 인한 데이터 손실 복구 가능
- **R3**: 과거 특정 시점으로 되돌리기 (Time Travel)

---

## 2. 채택된 전략: 이벤트 기반 자동 스냅샷

### 2.1 핵심 개념

**"주요 이벤트 발생 시 자동으로 스냅샷을 생성하고, 히스토리 UI에서 복원 가능"**

```
┌─────────────────────────────────────────────────────────────┐
│                    Project Folder                           │
├─────────────────────────────────────────────────────────────┤
│  warehouse.duckdb              ← 메인 DB (현재 상태)         │
│                                                             │
│  .snapshots/                                                │
│    ├── 2026-01-11T14-32-00_drop-table.duckdb               │
│    ├── 2026-01-11T10-30-00_analysis-created.duckdb         │
│    └── 2026-01-10T09-00-00_daily-backup.duckdb             │
│                                                             │
│  events.json                   ← 프로젝트 이벤트 로그        │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 이벤트 정의 (Tier 시스템)

#### Tier 1: 항상 스냅샷 (파괴적 변경)
| 이벤트 | 설명 | 스냅샷 시점 |
|--------|------|------------|
| `table.drop` | DROP TABLE 실행 | 실행 전 |
| `table.truncate` | TRUNCATE TABLE 실행 | 실행 전 |
| `analysis.delete` | 분석 삭제 | 삭제 전 |
| `source.disconnect` | 데이터 소스 연결 해제 | 해제 전 |

#### Tier 2: 선택적 스냅샷 (설정에서 on/off)
| 이벤트 | 설명 | 기본값 |
|--------|------|--------|
| `analysis.create` | 분석 생성 | ON |
| `analysis.update` | 분석 수정 | OFF |
| `table.create` | 테이블 생성 | OFF |
| `data.import` | 대량 데이터 임포트 | ON |

#### Tier 3: 자동 주기 스냅샷
| 이벤트 | 설명 |
|--------|------|
| `daily.backup` | 매일 첫 실행 시 자동 |
| `manual.backup` | 사용자 수동 요청 |

### 2.3 이벤트 로그 구조 (events.json)

```json
{
  "project_id": "proj_abc123",
  "events": [
    {
      "id": "evt_001",
      "type": "table.drop",
      "timestamp": "2026-01-11T14:32:00Z",
      "description": "DROP TABLE users",
      "snapshot_id": "snap_xyz789",
      "metadata": {
        "table_name": "users",
        "row_count": 15000
      }
    },
    {
      "id": "evt_002", 
      "type": "analysis.create",
      "timestamp": "2026-01-11T10:30:00Z",
      "description": "분석 'daily_report' 생성",
      "snapshot_id": "snap_abc456",
      "metadata": {
        "analysis_id": "daily_report",
        "analysis_name": "일일 리포트"
      }
    }
  ]
}
```

### 2.4 스냅샷 보관 정책

```python
SNAPSHOT_RETENTION = {
    "max_count": 30,       # 최대 30개 스냅샷
    "max_age_days": 14,    # 14일 이상 된 것은 자동 삭제
    "min_keep": 5,         # 최소 5개는 항상 유지
}
```

---

## 3. UI 설계

### 3.1 History 버튼 위치

```
┌─────────────────────────────────────────┐
│  PlutoDuck                              │
├─────────────────────────────────────────┤
│                                         │
│  [Chat]                                 │
│  [Assets]                               │
│  [Boards]                               │
│                                         │
│  ─────────────────                      │
│                                         │
│  [🕐 History]  ← Settings 위에 배치     │
│  [⚙️ Settings]                          │
│                                         │
└─────────────────────────────────────────┘
```

### 3.2 History 패널 UI

```
┌─────────────────────────────────────────────────────────────┐
│  History                                    [+ 수동 백업]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ● 현재 상태                                                │
│  │                                                          │
│  ├─ 🗑️ 14:32 - DROP TABLE users 실행 전        [복원]       │
│  │      테이블 삭제됨 (15,000 rows)                         │
│  │                                                          │
│  ├─ 📊 10:30 - 분석 'daily_report' 생성 전      [복원]       │
│  │      새 분석이 생성됨                                    │
│  │                                                          │
│  ├─ 💾 09:00 - 일일 자동 백업                   [복원]       │
│  │      Daily automatic backup                              │
│  │                                                          │
│  └─ 📥 어제 - 데이터 소스 연결                  [복원]       │
│         BigQuery 'analytics' 연결됨                         │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│  💡 14일 이내 최대 30개 스냅샷이 보관됩니다.                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 복원 확인 다이얼로그

```
┌───────────────────────────────────────────────────┐
│  ⚠️ 이 시점으로 복원하시겠습니까?                  │
├───────────────────────────────────────────────────┤
│                                                   │
│  복원 시점: 2026-01-11 14:32                      │
│  이벤트: DROP TABLE users 실행 전                 │
│                                                   │
│  ⚠️ 현재 데이터베이스가 이 시점의 상태로           │
│     완전히 교체됩니다.                            │
│                                                   │
│  ☑️ 복원 전 현재 상태도 백업하기 (권장)            │
│                                                   │
│              [취소]  [복원 실행]                   │
└───────────────────────────────────────────────────┘
```

---

## 4. 구현 계획

### 선행 조건: 동시성 문제 (✅ 완료)

DuckDB 동시 접근 충돌은 `threading.Lock()`으로 해결됨.

```python
# backend/app/api/v1/asset/router.py
_duckdb_connection_lock = threading.Lock()

def _get_connection():
    with _duckdb_connection_lock:
        return duckdb.connect(...)
```

---

### Phase 1: 이벤트 시스템 + 자동 스냅샷 (1주)

**목표**: 주요 변경 시 자동 백업으로 데이터 손실 방지

**Backend 작업**:
1. `EventLogger` 클래스 - 이벤트 기록
2. `SnapshotManager` 클래스 - 스냅샷 생성/관리
3. 주요 API에 이벤트 트리거 추가 (데코레이터 패턴)

**API 설계**:
```
GET  /projects/{id}/events              # 이벤트 히스토리
GET  /projects/{id}/snapshots           # 스냅샷 목록
POST /projects/{id}/snapshots           # 수동 스냅샷 생성
POST /projects/{id}/snapshots/{id}/restore  # 복원
```

---

### Phase 2: History UI (1주)

**목표**: 사이드바에 History 패널 추가

**Frontend 작업**:
1. History 버튼 (Settings 위에 배치)
2. History 패널 컴포넌트
3. 복원 확인 다이얼로그
4. 수동 백업 버튼

---

## 5. 기술 상세

### 5.1 EventLogger 클래스

```python
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Dict, Any
import json
from enum import Enum

class EventType(Enum):
    # Tier 1: 항상 스냅샷
    TABLE_DROP = "table.drop"
    TABLE_TRUNCATE = "table.truncate"
    ANALYSIS_DELETE = "analysis.delete"
    SOURCE_DISCONNECT = "source.disconnect"
    
    # Tier 2: 선택적 스냅샷
    ANALYSIS_CREATE = "analysis.create"
    ANALYSIS_UPDATE = "analysis.update"
    TABLE_CREATE = "table.create"
    DATA_IMPORT = "data.import"
    
    # Tier 3: 자동 주기
    DAILY_BACKUP = "daily.backup"
    MANUAL_BACKUP = "manual.backup"

@dataclass
class Event:
    id: str
    type: EventType
    timestamp: datetime
    description: str
    snapshot_id: Optional[str]
    metadata: Dict[str, Any]

class EventLogger:
    def __init__(self, project_path: Path):
        self.events_file = project_path / "events.json"
        self._ensure_file()
    
    def _ensure_file(self):
        if not self.events_file.exists():
            self.events_file.write_text(json.dumps({"events": []}))
    
    def log(self, event: Event) -> None:
        """이벤트를 로그에 기록합니다."""
        data = self._read()
        data["events"].insert(0, asdict(event))  # 최신순
        self._write(data)
    
    def list(self, limit: int = 50) -> List[Event]:
        """최근 이벤트 목록을 반환합니다."""
        data = self._read()
        return [Event(**e) for e in data["events"][:limit]]
```

### 5.2 SnapshotManager 클래스

```python
import shutil
from uuid import uuid4

@dataclass
class Snapshot:
    id: str
    event_id: str
    created_at: datetime
    event_type: str
    description: str
    size_bytes: int
    path: Path

class SnapshotManager:
    def __init__(self, project_path: Path):
        self.project_path = project_path
        self.db_path = project_path / "warehouse.duckdb"
        self.snapshots_dir = project_path / ".snapshots"
        self.snapshots_dir.mkdir(exist_ok=True)
        self.retention = {
            "max_count": 30,
            "max_age_days": 14,
            "min_keep": 5,
        }
    
    def create(self, event: Event) -> Snapshot:
        """현재 DB의 스냅샷을 생성합니다."""
        snapshot_id = f"snap_{uuid4().hex[:8]}"
        timestamp = datetime.now().strftime("%Y-%m-%dT%H-%M-%S")
        filename = f"{timestamp}_{event.type.value.replace('.', '-')}.duckdb"
        snapshot_path = self.snapshots_dir / filename
        
        # DB 파일 복사
        shutil.copy2(self.db_path, snapshot_path)
        
        return Snapshot(
            id=snapshot_id,
            event_id=event.id,
            created_at=datetime.now(),
            event_type=event.type.value,
            description=event.description,
            size_bytes=snapshot_path.stat().st_size,
            path=snapshot_path,
        )
    
    def restore(self, snapshot_id: str, backup_current: bool = True) -> None:
        """특정 스냅샷으로 복원합니다."""
        snapshot = self._find(snapshot_id)
        
        if backup_current:
            # 현재 상태도 백업 (복원 전)
            self.create(Event(
                id=f"evt_{uuid4().hex[:8]}",
                type=EventType.MANUAL_BACKUP,
                timestamp=datetime.now(),
                description="복원 전 자동 백업",
                snapshot_id=None,
                metadata={"reason": "pre_restore"},
            ))
        
        # 복원 실행
        shutil.copy2(snapshot.path, self.db_path)
    
    def cleanup(self) -> int:
        """보관 정책에 따라 오래된 스냅샷을 정리합니다."""
        snapshots = self.list()
        removed = 0
        
        # min_keep 이하로는 삭제 안 함
        if len(snapshots) <= self.retention["min_keep"]:
            return 0
        
        for snap in snapshots[self.retention["min_keep"]:]:
            age_days = (datetime.now() - snap.created_at).days
            if len(snapshots) - removed > self.retention["max_count"] or \
               age_days > self.retention["max_age_days"]:
                snap.path.unlink()
                removed += 1
        
        return removed
```

### 5.3 데코레이터를 통한 자동 스냅샷

```python
from functools import wraps

def auto_snapshot(event_type: EventType, description_fn=None):
    """API 실행 전에 자동으로 스냅샷을 생성하는 데코레이터."""
    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            project_id = kwargs.get('project_id') or args[0]
            
            # 스냅샷 생성
            event = Event(
                id=f"evt_{uuid4().hex[:8]}",
                type=event_type,
                timestamp=datetime.now(),
                description=description_fn(*args, **kwargs) if description_fn else event_type.value,
                snapshot_id=None,
                metadata={},
            )
            
            snapshot_mgr = SnapshotManager(get_project_path(project_id))
            snapshot = snapshot_mgr.create(event)
            event.snapshot_id = snapshot.id
            
            event_logger = EventLogger(get_project_path(project_id))
            event_logger.log(event)
            
            # 원래 함수 실행
            return await func(*args, **kwargs)
        return wrapper
    return decorator

# 사용 예시
@auto_snapshot(
    EventType.TABLE_DROP,
    description_fn=lambda table_name, **_: f"DROP TABLE {table_name}"
)
async def drop_table(project_id: str, table_name: str):
    ...
```

---

## 6. 리스크 및 완화 방안

| 리스크 | 영향 | 완화 방안 |
|--------|------|----------|
| 대용량 DB 복사 시간 | 수 GB DB의 경우 스냅샷 생성에 수 초 소요 | 비동기 처리 + Progress UI + "스냅샷 생성 중..." 토스트 |
| 디스크 공간 부족 | 스냅샷이 누적되면 용량 초과 | 보관 정책 (30개/14일) + History UI에 총 용량 표시 |
| 스냅샷 손상 | 복사 중 시스템 크래시 | 복사 완료 후에만 events.json에 기록 |
| 복원 실수 | 잘못된 시점으로 복원 | 복원 전 현재 상태 자동 백업 (opt-out 가능) |

---

## 7. 성공 지표

| 지표 | 현재 | 목표 |
|------|------|------|
| DB 접근 충돌 에러 | 빈번 | 0건 |
| 데이터 손실 복구 | 불가능 | 14일 내 어느 이벤트 시점이든 복원 가능 |
| 복원 소요 시간 | N/A | 2GB DB 기준 5초 이내 |

---

## 8. 참고 자료

- [DuckDB Documentation - Concurrency](https://duckdb.org/docs/connect/concurrency)
- [SQLite Backup API](https://www.sqlite.org/backup.html)

---

## 변경 이력

| 날짜 | 변경 내용 | 작성자 |
|------|----------|--------|
| 2026-01-11 | 초안 작성 | AI Assistant |
| 2026-01-11 | Draft 모드 제거, 이벤트 기반 자동 스냅샷으로 단순화 | AI Assistant |

