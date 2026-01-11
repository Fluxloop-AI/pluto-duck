# Settings UI 구현 계획

## 개요
- **목표**: 사용자가 앱 내에서 OpenAI API 키와 모델을 직접 설정할 수 있도록 개선
- **결과물**: Settings 모달 + PromptInput 모델 선택 드롭다운
- **상태**: ✅ 완료 (2025-10-23)

## 완료된 기능

### 1. Settings API (백엔드)

#### 엔드포인트
- **GET /api/v1/settings** - 현재 설정 조회
- **PUT /api/v1/settings** - 설정 업데이트

#### 데이터 구조
```python
class SettingsResponse(BaseModel):
    llm_provider: str = "openai"
    llm_api_key: Optional[str] = None  # Masked (sk-xxx***xxx)
    llm_model: Optional[str] = None
    data_sources: Optional[Any] = None
    dbt_project: Optional[Any] = None
    ui_preferences: Dict[str, Any] = {"theme": "dark"}
```

#### 기능
- API 키 마스킹 (sk-xxx***xxx)
- 모델 검증 (gpt-5, gpt-5-mini, gpt-4o, gpt-4o-mini)
- DuckDB `user_settings` 테이블에 저장

---

### 2. Settings Modal (프론트엔드)

#### UI 구조
```
┌─────────────────────────────────┐
│  Settings                    [×]│
├─────────────────────────────────┤
│  Provider                       │
│  ┌───────────────────────────┐ │
│  │ OpenAI               ✓    │ │ (비활성)
│  └───────────────────────────┘ │
│                                 │
│  API Key                        │
│  ┌───────────────────────────┐ │
│  │ ••••••••••••••••   [👁]  │ │ Show/Hide 토글
│  └───────────────────────────┘ │
│                                 │
│  Default Model                  │
│  ┌───────────────────────────┐ │
│  │ GPT-5 Mini          ▼     │ │
│  └───────────────────────────┘ │
│                                 │
│           [Cancel]  [Save]      │
└─────────────────────────────────┘
```

#### 기능
- API 키 입력 (Show/Hide 토글)
- 기본 모델 선택 (GPT-5, GPT-5 Mini)
- 검증: API 키는 `sk-`로 시작
- 저장 성공 시 토스트 알림
- 저장 후 PromptInput 모델 드롭다운 자동 갱신

---

### 3. PromptInput 모델 선택

#### 위치
```
┌─────────────────────────────────────────┐
│ 메시지 입력...                           │
├─────────────────────────────────────────┤
│ [GPT-5 Mini ▼]  [전송]                 │
└─────────────────────────────────────────┘
```

#### 기능
- Settings의 기본 모델 자동 로드
- 대화별 모델 선택 가능
- 모델 변경 시 즉시 적용
- 메시지 전송 시 선택된 모델 백엔드로 전달

---

### 4. 사이드바 개선

#### Before
```
┌─────────────────────┐
│ Create New          │
│ Refresh             │
├─────────────────────┤
│ 대화 목록...        │
└─────────────────────┘
```

#### After
```
┌─────────────────────┐
│        [↻] [+]     │ ← 아이콘, 우측 정렬
├─────────────────────┤
│ 💬 대화 목록        │
│                     │
├─────────────────────┤
│ [⚙️] Settings      │ ← 하단 고정
└─────────────────────┘
```

---

## 구현 세부사항

### 백엔드 변경사항

#### 1. LLM Provider 우선순위
```python
def get_llm_provider(model: Optional[str] = None) -> BaseLLMProvider:
    # Priority: parameter > env var > database > default
    api_key = env_var or db_settings.get("llm_api_key")
    model = parameter or env_var or db_settings.get("llm_model") or "gpt-5-mini"
```

#### 2. AgentState에 모델 전달
```python
@dataclass
class AgentState:
    ...
    model: Optional[str] = None  # 추가됨
```

#### 3. 모든 노드에서 모델 사용
```python
# reasoning.py, planner.py, sql.py
provider = get_llm_provider(model=state.model)
```

#### 4. Chat API에 모델 파라미터
```python
class CreateConversationRequest(BaseModel):
    question: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    model: Optional[str] = None  # 추가됨
    
class AppendMessageRequest(BaseModel):
    role: str
    content: Dict[str, Any]
    model: Optional[str] = None  # 추가됨
```

---

### 프론트엔드 컴포넌트

#### 파일 구조
```
frontend/pluto_duck_frontend/
├── components/chat/
│   ├── SettingsModal.tsx ✅
│   └── index.ts
├── lib/
│   ├── settingsApi.ts ✅
│   └── chatApi.ts (모델 파라미터 추가) ✅
└── app/
    └── page.tsx ✅
```

#### State 관리
```tsx
const [settingsOpen, setSettingsOpen] = useState(false);
const [selectedModel, setSelectedModel] = useState('gpt-5-mini');

// Settings에서 기본 모델 로드
useEffect(() => {
  if (backendReady) {
    fetchSettings().then(settings => {
      if (settings.llm_model) {
        setSelectedModel(settings.llm_model);
      }
    });
  }
}, [backendReady]);

// Settings 저장 시 드롭다운 갱신
<SettingsModal 
  open={settingsOpen}
  onOpenChange={setSettingsOpen}
  onSettingsSaved={(model) => setSelectedModel(model)}
/>
```

---

## 보안 고려사항

### API 키 저장
- **개발 환경**: DuckDB에 평문 저장 (로컬 파일)
- **향후 프로덕션**: 
  - macOS Keychain 통합
  - 또는 간단한 암호화 (앱별 시크릿 키)

### 전송
- 로컬 통신이므로 HTTPS 불필요
- 민감 정보 로그에 노출 방지
- API 키 마스킹 처리

---

## 테스트 시나리오

### 1. API 키 설정
- [ ] Settings 열기
- [ ] API 키 입력 (sk-...)
- [ ] Show/Hide 토글 작동
- [ ] Save 클릭
- [ ] 성공 메시지 확인
- [ ] 페이지 새로고침 → 마스킹된 키 표시

### 2. 모델 선택
- [ ] PromptInput에서 GPT-5 선택
- [ ] 메시지 전송
- [ ] 백엔드 로그에서 `model: "gpt-5"` 확인
- [ ] OpenAI API 호출 로그 확인

### 3. 기본 모델 변경
- [ ] Settings에서 Default Model을 GPT-5로 변경
- [ ] Save 클릭
- [ ] PromptInput 드롭다운이 즉시 GPT-5로 변경되는지 확인
- [ ] 새 대화 시작 → GPT-5가 선택되어 있는지 확인

### 4. Settings 저장 후 영속성
- [ ] Settings 저장
- [ ] 백엔드 재시작
- [ ] Settings 다시 열기 → 저장된 값 로드 확인

---

## 알려진 제약사항

### 현재
- Provider는 OpenAI만 지원
- API 키는 평문 저장 (로컬 DB)
- 모델은 GPT-5, GPT-5 Mini만 (확장 가능)

### 향후 개선
- Anthropic, Google AI 등 추가 Provider
- macOS Keychain 통합
- 더 많은 모델 옵션

---

## 관련 파일

### 백엔드
- `backend/pluto_duck_backend/app/api/v1/settings/router.py`
- `backend/pluto_duck_backend/app/services/chat/repository.py`
- `backend/pluto_duck_backend/agent/core/llm/providers.py`
- `backend/pluto_duck_backend/agent/core/state.py`
- `backend/pluto_duck_backend/agent/core/orchestrator.py`
- `backend/pluto_duck_backend/agent/core/nodes/*.py`

### 프론트엔드
- `frontend/pluto_duck_frontend/components/chat/SettingsModal.tsx`
- `frontend/pluto_duck_frontend/lib/settingsApi.ts`
- `frontend/pluto_duck_frontend/lib/chatApi.ts`
- `frontend/pluto_duck_frontend/app/page.tsx`

---

**Status:** ✅ Completed  
**Completion Date:** 2025-10-23  
**Next Steps:** Data Sources UI 구현 (data-sources-ui-plan.md 참고)

