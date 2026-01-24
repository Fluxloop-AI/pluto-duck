---
date: 2026-01-16T14:30:00+09:00
researcher: Claude
topic: "LangChain ChatOpenAI의 Reasoning 지원 여부 심층 분석"
tags: [research, codebase, langchain, openai, reasoning, gpt-5, responses-api]
status: complete
---

# Research: LangChain ChatOpenAI의 Reasoning 지원 여부 심층 분석

## Research Question

docs/research/011에서 LangChain의 ChatOpenAI가 Chat Completions API를 사용하기 때문에 reasoning을 지원하지 않는다고 분석했는데, 실제로 LangChain에서 reasoning을 지원하지 않는 것인지 더 깊이 파헤쳐 분석

## Summary

**핵심 발견:** LangChain ChatOpenAI는 **reasoning을 지원한다**. 단, 올바른 파라미터 설정이 필요하다.

1. `reasoning` 파라미터: `{"effort": "medium", "summary": "auto"}` 형태로 전달 가능
2. `output_version="responses/v1"` 설정 시 Responses API 포맷 사용
3. Chat Completions API 자체는 reasoning content를 반환하지 않음 - **Responses API만 반환**
4. **현재 프로젝트 문제점:** ChatOpenAI 초기화 시 reasoning 관련 파라미터가 전혀 설정되지 않음

---

## Detailed Findings

### 1. OpenAI API 비교: Chat Completions vs Responses

| 구분 | Chat Completions API | Responses API |
|------|---------------------|---------------|
| 엔드포인트 | `/v1/chat/completions` | `/v1/responses` |
| Reasoning 파라미터 | `reasoning_effort` 지원 | `reasoning` 객체 지원 |
| Reasoning 결과 반환 | ❌ **반환하지 않음** | ✅ reasoning 블록으로 반환 |
| 상태 관리 | 수동 대화 기록 관리 | 서버사이드 상태 관리 |
| 성능 | 기준 | 3% 향상 (SWE-bench) |
| 캐시 효율 | 기준 | 40-80% 향상 |

**핵심 인사이트:**
- Chat Completions API도 `reasoning_effort` 파라미터를 지원하지만, **reasoning 과정을 반환하지는 않음**
- 모델이 내부적으로 reasoning을 수행하지만, 최종 응답만 반환
- **Reasoning content를 보려면 Responses API를 사용해야 함**

### 2. LangChain ChatOpenAI의 Reasoning 지원

LangChain `langchain-openai >= 0.3.26`부터 reasoning 지원:

```python
from langchain_openai import ChatOpenAI

# 방법 1: reasoning 파라미터 직접 전달
llm = ChatOpenAI(
    model="gpt-5",
    reasoning={"effort": "medium", "summary": "auto"},
    output_version="responses/v1"  # Responses API 포맷 활성화
)

# 방법 2: model_kwargs로 전달
llm = ChatOpenAI(
    model="gpt-5",
    model_kwargs={
        "reasoning": {"effort": "medium", "summary": "auto"}
    }
)
```

**지원되는 reasoning 설정:**

| 파라미터 | 값 | 설명 |
|----------|-----|------|
| `effort` | `"minimal"`, `"low"`, `"medium"`, `"high"` | Reasoning 깊이 |
| `summary` | `"auto"`, `"detailed"` | 요약 상세 수준 |

**주의:** GPT-5 시리즈는 `"concise"` summary를 지원하지 않음 (only `"auto"`, `"detailed"`)

### 3. 전용 클래스: ChatOpenAIResponses

LangChain은 Responses API 전용 클래스도 제공:

```python
from langchain_openai import ChatOpenAIResponses

llm = ChatOpenAIResponses(
    model="gpt-5",
    reasoning={"effort": "medium"}
)
```

### 4. Reasoning Content 추출 방법

Responses API 응답에서 reasoning을 추출하는 방법:

```python
response = await llm.ainvoke(messages)

# AIMessage의 additional_kwargs에서 추출
if hasattr(response, 'additional_kwargs'):
    reasoning_content = response.additional_kwargs.get('reasoning_content')
```

**알려진 이슈 (GitHub #31326):**
- LangChain이 항상 `reasoning_content`를 AIMessage에 포함하지 않음
- OpenAI 라이브러리는 반환하지만 LangChain 래퍼에서 누락될 수 있음

### 5. 현재 프로젝트 코드 분석

**현재 구현 (`agent/core/deep/agent.py:144-148`):**

```python
chat_model = ChatOpenAI(
    model=effective_model,
    api_key=effective_api_key,
    base_url=str(settings.agent.api_base) if settings.agent.api_base else None,
)
```

**문제점:**
1. `reasoning` 파라미터 없음
2. `output_version` 설정 없음
3. 설정 파일의 `reasoning_effort`가 활용되지 않음

**설정은 존재함 (`app/core/config.py`):**

```python
reasoning_effort: Literal["minimal", "low", "medium", "high"] = Field(
    default="medium",
    description="Reasoning depth for GPT-5 family models",
)
```

### 6. providers.py vs agent.py 불일치

| 파일 | API 사용 | Reasoning 지원 | 실제 사용 여부 |
|------|---------|---------------|---------------|
| `providers.py` | Responses API | ✅ 완전 지원 | ❌ 사용 안 함 |
| `agent.py` | Chat Completions | ❌ 미설정 | ✅ 실제 사용 |

`providers.py`는 완벽한 Responses API 구현이 있지만, 실제 에이전트는 이를 사용하지 않음.

---

## Code References

- `backend/pluto_duck_backend/agent/core/deep/agent.py:144-148` - ChatOpenAI 초기화 (reasoning 없음)
- `backend/pluto_duck_backend/agent/core/llm/providers.py:53-79` - Responses API 구현 (미사용)
- `backend/pluto_duck_backend/app/core/config.py` - reasoning_effort 설정 (미활용)
- `backend/pluto_duck_backend/agent/core/deep/event_mapper.py:73-102` - 이벤트 매핑 (reason 필드 미전송)

---

## Architecture Insights

### 현재 아키텍처 문제

```
[설정]                    [providers.py]           [agent.py]
reasoning_effort ─────> OpenAILLMProvider ──✗     ChatOpenAI
(medium)                 (Responses API)           (Chat Completions)
                         ❌ 미사용                  ✅ 실제 사용
```

### 권장 아키텍처

```
[설정]                    [agent.py]
reasoning_effort ─────> ChatOpenAI(
                          reasoning={"effort": "medium"},
                          output_version="responses/v1"
                        )
```

---

## ⚠️ 불확실한 점: 파라미터 추가만으로 해결되는가?

파라미터 추가가 필요조건이지만 충분조건인지는 불확실하다. 다음 사항들을 검증해야 한다.

### 1. ChatOpenAI가 실제로 어떤 API를 호출하는가?

```python
# 이렇게 설정해도...
ChatOpenAI(
    reasoning={"effort": "medium"},
    output_version="responses/v1"
)
```

- `output_version="responses/v1"`은 **응답 포맷**을 변경하는 옵션
- 실제로 `/v1/responses` 엔드포인트를 호출하는지, 아니면 여전히 `/v1/chat/completions`를 사용하는지 불명확
- **검증 방법:** httpx 로그에서 실제 호출되는 엔드포인트 확인 필요

### 2. LangChain의 reasoning_content 반환 이슈 (GitHub #31326)

> "LangChain이 `reasoning_content`를 AIMessage에 항상 포함하지 않음"

- OpenAI 라이브러리는 reasoning을 반환하지만 LangChain 래퍼에서 누락될 수 있음
- 실제 테스트로 `response.additional_kwargs`에 `reasoning_content`가 있는지 확인 필요

### 3. event_mapper.py 수정도 필요

현재 코드는 reasoning을 올바른 필드로 전송하지 않음:

```python
# 현재 (event_mapper.py:98)
content={"phase": "llm_end", "text": text}  # ❌ "reason" 필드 아님

# 프론트엔드가 기대하는 형태
content={"reason": reasoning_text}  # ✅ "reason" 필드 필요
```

### 4. 검증을 위한 테스트 코드

```python
# 테스트 스크립트
import asyncio
from langchain_openai import ChatOpenAI

async def test_reasoning():
    llm = ChatOpenAI(
        model="gpt-5",
        api_key="...",
        reasoning={"effort": "medium", "summary": "auto"},
        output_version="responses/v1"
    )

    response = await llm.ainvoke("Explain quantum computing")

    # 확인 사항:
    # 1. httpx 로그에서 어떤 API가 호출됐는지 확인
    # 2. response.additional_kwargs에 reasoning_content 있는지 확인
    print("additional_kwargs:", response.additional_kwargs)
    print("reasoning_content:", response.additional_kwargs.get("reasoning_content"))

asyncio.run(test_reasoning())
```

### 5. 더 확실한 대안: ChatOpenAIResponses

불확실성을 피하려면 전용 클래스 사용:

```python
from langchain_openai import ChatOpenAIResponses  # Responses API 전용

llm = ChatOpenAIResponses(
    model="gpt-5",
    reasoning={"effort": "medium"}
)
```

이 클래스는 명시적으로 Responses API를 사용하므로 더 확실함.

### 결론

**파라미터 추가 + event_mapper 수정 + 실제 테스트 검증**이 모두 필요하다. 파라미터만 추가하면 바로 작동하는지는 실제로 돌려봐야 알 수 있다.

---

## 해결 방안

### Option A: ChatOpenAI에 Reasoning 파라미터 추가 (권장)

**수정 위치:** `agent/core/deep/agent.py:144-148`

```python
from pluto_duck_backend.app.core.config import get_settings

settings = get_settings()

# GPT-5 모델 체크
def _is_gpt5_model(model: str) -> bool:
    return model.startswith("gpt-5")

reasoning_kwargs = {}
if _is_gpt5_model(effective_model):
    reasoning_kwargs = {
        "reasoning": {
            "effort": settings.agent.reasoning_effort,
            "summary": "auto"  # GPT-5는 "concise" 미지원
        },
        "output_version": "responses/v1"
    }

chat_model = ChatOpenAI(
    model=effective_model,
    api_key=effective_api_key,
    base_url=str(settings.agent.api_base) if settings.agent.api_base else None,
    **reasoning_kwargs
)
```

**장점:**
- 최소 코드 변경
- LangChain 생태계 유지
- 기존 tool calling 호환

**단점:**
- LangChain의 reasoning_content 반환 이슈 가능성

### Option B: ChatOpenAIResponses 사용

```python
if _is_gpt5_model(effective_model):
    from langchain_openai import ChatOpenAIResponses
    chat_model = ChatOpenAIResponses(
        model=effective_model,
        api_key=effective_api_key,
        reasoning={"effort": settings.agent.reasoning_effort}
    )
else:
    chat_model = ChatOpenAI(...)
```

### Option C: 이벤트 매퍼 수정

`event_mapper.py`에서 reasoning content 추출 로직 강화:

```python
async def on_llm_end(self, response: Any, **kwargs: Any) -> None:
    reasoning_text = None
    try:
        # LLMResult에서 reasoning 추출 시도
        gens = getattr(response, "generations", None) or []
        if gens and gens[0]:
            msg = getattr(gens[0][0], "message", None)
            if msg and hasattr(msg, "additional_kwargs"):
                reasoning_text = msg.additional_kwargs.get("reasoning_content")
    except Exception:
        pass

    if reasoning_text:
        await self._emit(
            AgentEvent(
                type=EventType.REASONING,
                subtype=EventSubType.CHUNK,
                content={"reason": reasoning_text},  # 프론트엔드 기대 필드
                metadata={"run_id": self._run_id},
            )
        )
```

---

## 구현 우선순위

| 순서 | 작업 | 복잡도 | 영향도 |
|------|------|--------|--------|
| 1 | ChatOpenAI에 reasoning 파라미터 추가 | 낮 | 높 |
| 2 | event_mapper.py에서 reasoning 추출 | 중 | 높 |
| 3 | 프론트엔드 호환성 확인 | 낮 | 중 |
| 4 | langchain-openai 버전 업데이트 확인 | 낮 | 중 |

---

## Open Questions

1. **langchain-openai 현재 버전 확인 필요**
   - `>=0.3`이 최소인데, `0.3.26` 이상인지 확인 필요
   - 최신 버전으로 업데이트 권장

2. **ChatOpenAI vs ChatOpenAIResponses 선택**
   - tool calling 호환성 테스트 필요
   - ChatOpenAIResponses가 bind_tools() 지원하는지 확인

3. **Azure 호환성**
   - AzureChatOpenAI는 reasoning 파라미터 미지원 이슈 있음 (GitHub #32714)
   - Azure 사용 계획 있으면 별도 대응 필요

4. **LangChain reasoning_content 반환 이슈**
   - GitHub #31326에서 보고된 문제
   - 실제 테스트로 확인 필요

---

## 참고 자료

- [LangChain ChatOpenAI API Reference](https://python.langchain.com/api_reference/openai/chat_models/langchain_openai.chat_models.base.ChatOpenAI.html)
- [OpenAI Responses vs Chat Completions](https://platform.openai.com/docs/guides/responses-vs-chat-completions)
- [LangChain GPT-5 Reasoning Summaries Forum](https://forum.langchain.com/t/how-to-extract-gpt-5-reasoning-summaries-with-langchain-openai/1802)
- [GitHub Issue #31326 - reasoning_content not returned](https://github.com/langchain-ai/langchain/issues/31326)
- [GitHub Issue #32714 - AzureChatOpenAI reasoning issue](https://github.com/langchain-ai/langchain/issues/32714)
- [LangChain Responses API Announcement](https://x.com/LangChainAI/status/1899888134793683243)
- 프로젝트 내 문서: `docs/research/011_reasoning_not_displaying_analysis.md`
