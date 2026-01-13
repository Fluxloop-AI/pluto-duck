# 011. Reasoning UI 미표시 문제 분석

## 1. 문제 현상

Chat UI에서 GPT-5 모델 사용 시 **Reasoning(추론 과정) UI가 표시되지 않음**.

- `ReasoningRenderer` 컴포넌트가 존재하지만 렌더링되지 않음
- 스트리밍 중에도 reasoning 내용이 보이지 않음

---

## 2. 현재 아키텍처

### 2.1 데이터 흐름

```
[프론트엔드]                     [백엔드]                        [OpenAI]
     │                              │                              │
     │  createConversation()        │                              │
     │  appendMessage()             │                              │
     ├─────────────────────────────>│                              │
     │                              │   responses.create()         │
     │                              ├─────────────────────────────>│
     │                              │                              │
     │                              │<─────────────────────────────┤
     │                              │   Response (with reasoning)  │
     │                              │                              │
     │  SSE: EventSource            │                              │
     │<─────────────────────────────┤                              │
     │  AgentEvent stream           │                              │
```

### 2.2 관련 파일

| 위치 | 파일 | 역할 |
|------|------|------|
| Frontend | `hooks/useAgentStream.ts` | SSE로 이벤트 수신 |
| Frontend | `hooks/useMultiTabChat.ts` | 이벤트를 ChatTurn으로 변환 |
| Frontend | `lib/chatRenderUtils.ts` | Turn을 RenderItem으로 변환 |
| Frontend | `components/chat/renderers/ReasoningRenderer.tsx` | Reasoning UI 렌더링 |
| Backend | `agent/core/llm/providers.py` | GPT-5 API 호출 |
| Backend | `agent/core/deep/event_mapper.py` | LangChain 콜백 → AgentEvent 변환 |
| Backend | `agent/core/orchestrator.py` | Agent 실행 및 이벤트 emit |
| Backend | `app/api/v1/agent/router.py` | SSE 엔드포인트 |

---

## 3. 원인 분석

### 3.1 프론트엔드 - Reasoning 표시 조건

**파일:** `lib/chatRenderUtils.ts:69-82`

```typescript
// Reasoning (존재하거나 스트리밍 중이면)
if (turn.reasoningText || isActive) {
  const item: ReasoningItem = {
    id: `reasoning-${baseRunId || turn.key}`,
    type: 'reasoning',
    // ...
    content: turn.reasoningText || '',
  };
  items.push(item);
}
```

**파일:** `hooks/useMultiTabChat.ts:434-442`

```typescript
// Extract reasoning text
turn.reasoningText = turn.events
  .filter(event => event.type === 'reasoning')
  .map(event => {
    const content = event.content as any;
    return content && typeof content === 'object' && content.reason
      ? String(content.reason)
      : '';
  })
  .filter(Boolean)
  .join('\n\n');
```

**문제점:** 프론트엔드는 `content.reason` 필드를 찾지만, 백엔드는 이 필드를 보내지 않음.

### 3.2 백엔드 - 현재 Reasoning 이벤트 구조

**파일:** `agent/core/deep/event_mapper.py`

```python
async def on_llm_start(self, *args: Any, **kwargs: Any) -> None:
    await self._emit(
        AgentEvent(
            type=EventType.REASONING,
            subtype=EventSubType.START,
            content={"phase": "llm_start"},  # ❌ 실제 reasoning 내용 없음
            metadata={"run_id": self._run_id},
        )
    )

async def on_llm_end(self, response: Any, **kwargs: Any) -> None:
    text = None
    try:
        gens = getattr(response, "generations", None) or []
        if gens and gens[0]:
            msg = getattr(gens[0][0], "message", None)
            text = getattr(msg, "content", None)  # ❌ 이건 최종 응답, reasoning이 아님
    except Exception:
        text = None
    await self._emit(
        AgentEvent(
            type=EventType.REASONING,
            subtype=EventSubType.CHUNK,
            content={"phase": "llm_end", "text": text},  # ❌ "reason" 필드 아님
        )
    )
```

**문제점:**
1. `on_llm_start`는 `{"phase": "llm_start"}`만 전송 - 실제 reasoning 내용 없음
2. `on_llm_end`는 최종 응답 텍스트를 `text` 필드로 전송 - reasoning이 아님
3. 프론트엔드가 기대하는 `reason` 필드가 없음

### 3.3 백엔드 - GPT-5 응답 처리

**파일:** `agent/core/llm/providers.py:53-79`

```python
async def ainvoke(self, prompt: str, *, metadata: Optional[Dict[str, Any]] = None) -> str:
    config = get_settings().agent
    request_kwargs: Dict[str, Any] = {
        "model": self._model,
        "input": prompt,
    }

    if _is_gpt5_model(self._model):
        request_kwargs["reasoning"] = {"effort": config.reasoning_effort}  # ✅ reasoning 요청
        request_kwargs["text"] = {"verbosity": config.text_verbosity}

    response = await self._client.responses.create(**request_kwargs)

    if hasattr(response, "output_text"):
        return response.output_text  # ❌ output_text만 반환, reasoning 무시!

    # Fallback도 reasoning을 처리하지 않음
    if response.output:
        parts = []
        for item in response.output:
            if getattr(item, "content", None):
                for content in item.content:
                    if getattr(content, "text", None):
                        parts.append(content.text)
        if parts:
            return "\n".join(parts)
    return ""
```

**문제점:**
1. `reasoning` 옵션으로 GPT-5에 요청은 보내지만
2. 응답에서 `output_text`(최종 텍스트)만 반환
3. `response.output`의 reasoning 항목을 완전히 무시

---

## 4. GPT-5 Responses API 구조

### 4.1 요청 시 reasoning 설정

```python
request_kwargs = {
    "model": "gpt-5",
    "input": prompt,
    "reasoning": {
        "effort": "medium",      # none, minimal, low, medium, high, xhigh
        "summary": "concise"     # auto, concise, detailed
    }
}
```

### 4.2 응답 구조

```python
response = {
    "id": "resp_xxx",
    "object": "response",
    "status": "completed",
    "output": [
        # Reasoning 블록 (type: "reasoning")
        {
            "type": "reasoning",
            "id": "reasoning_xxx",
            "status": "completed",
            "content": [
                {
                    "type": "text",
                    "text": "Let me think about this step by step..."
                }
            ],
            "summary": [
                {
                    "type": "text",
                    "text": "Analyzed the problem and determined..."
                }
            ]
        },
        # 최종 응답 블록 (type: "message")
        {
            "type": "message",
            "role": "assistant",
            "content": [
                {
                    "type": "text",
                    "text": "Here is my answer..."
                }
            ]
        }
    ],
    "output_text": "Here is my answer...",  # 최종 텍스트만 포함
    "usage": {
        "input_tokens": 100,
        "output_tokens": 500,
        "reasoning_tokens": 200  # reasoning에 사용된 토큰
    }
}
```

### 4.3 output 배열의 가능한 타입들

| type | 설명 |
|------|------|
| `message` | 모델의 최종 응답 메시지 |
| `reasoning` | 추론 과정 (chain of thought) |
| `function_call` | 함수 호출 |
| `file_search` | 파일 검색 도구 호출 |
| `web_search` | 웹 검색 도구 호출 |
| `code_interpreter` | 코드 인터프리터 호출 |

### 4.4 Reasoning 객체 상세 구조

```typescript
interface ReasoningOutput {
  type: "reasoning";
  id: string;
  status: "in_progress" | "completed" | "incomplete";

  // 실제 reasoning 텍스트
  content: Array<{
    type: "text";
    text: string;
  }>;

  // reasoning 요약 (summary 옵션 설정 시)
  summary: Array<{
    type: "text";
    text: string;
  }>;

  // 암호화된 컨텐츠 (include 파라미터로 요청 시)
  encrypted_content?: string;
}
```

---

## 5. 해결 방안

### 5.1 백엔드 수정 - providers.py

GPT-5 응답에서 reasoning 블록을 추출하여 별도로 반환:

```python
# providers.py

from dataclasses import dataclass
from typing import Optional, List

@dataclass
class GPT5Response:
    """GPT-5 응답 구조"""
    text: str
    reasoning_content: Optional[str] = None
    reasoning_summary: Optional[str] = None


class OpenAILLMProvider(BaseLLMProvider):

    async def ainvoke_with_reasoning(
        self,
        prompt: str,
        *,
        metadata: Optional[Dict[str, Any]] = None
    ) -> GPT5Response:
        """GPT-5 호출 시 reasoning 포함하여 반환"""
        config = get_settings().agent
        request_kwargs: Dict[str, Any] = {
            "model": self._model,
            "input": prompt,
        }

        if _is_gpt5_model(self._model):
            request_kwargs["reasoning"] = {
                "effort": config.reasoning_effort,
                "summary": "concise"  # reasoning 요약 활성화
            }
            request_kwargs["text"] = {"verbosity": config.text_verbosity}

        response = await self._client.responses.create(**request_kwargs)

        # reasoning 추출
        reasoning_content = None
        reasoning_summary = None
        final_text = ""

        if response.output:
            for item in response.output:
                item_type = getattr(item, "type", None)

                if item_type == "reasoning":
                    # reasoning content 추출
                    if hasattr(item, "content") and item.content:
                        reasoning_parts = []
                        for content in item.content:
                            if getattr(content, "text", None):
                                reasoning_parts.append(content.text)
                        if reasoning_parts:
                            reasoning_content = "\n".join(reasoning_parts)

                    # reasoning summary 추출
                    if hasattr(item, "summary") and item.summary:
                        summary_parts = []
                        for summary in item.summary:
                            if getattr(summary, "text", None):
                                summary_parts.append(summary.text)
                        if summary_parts:
                            reasoning_summary = "\n".join(summary_parts)

                elif item_type == "message":
                    # 최종 응답 텍스트 추출
                    if hasattr(item, "content") and item.content:
                        for content in item.content:
                            if getattr(content, "text", None):
                                final_text += content.text

        # fallback to output_text
        if not final_text and hasattr(response, "output_text"):
            final_text = response.output_text or ""

        return GPT5Response(
            text=final_text,
            reasoning_content=reasoning_content,
            reasoning_summary=reasoning_summary,
        )
```

### 5.2 백엔드 수정 - orchestrator.py 또는 event_mapper.py

Reasoning을 별도 이벤트로 emit:

```python
# orchestrator.py 또는 agent 실행 로직에서

async def _execute_with_reasoning(self, prompt: str, emit: Callable) -> str:
    provider = get_llm_provider(model=self._model)

    if isinstance(provider, OpenAILLMProvider) and _is_gpt5_model(self._model):
        response = await provider.ainvoke_with_reasoning(prompt)

        # Reasoning 이벤트 emit
        if response.reasoning_content:
            await emit(AgentEvent(
                type=EventType.REASONING,
                subtype=EventSubType.CHUNK,
                content={
                    "reason": response.reasoning_content,  # ✅ 프론트엔드가 기대하는 필드
                    "summary": response.reasoning_summary,
                },
                metadata={"run_id": self._run_id},
            ))

        return response.text
    else:
        return await provider.ainvoke(prompt)
```

### 5.3 프론트엔드 수정 - useMultiTabChat.ts (선택적)

백엔드 수정 후에도 호환성을 위해 여러 필드 지원:

```typescript
// useMultiTabChat.ts:434-442

turn.reasoningText = turn.events
  .filter(event => event.type === 'reasoning')
  .map(event => {
    const content = event.content as any;
    if (!content || typeof content !== 'object') return '';

    // 여러 필드 지원 (호환성)
    const reasonText = content.reason || content.text || content.reasoning || '';
    return String(reasonText);
  })
  .filter(Boolean)
  .join('\n\n');
```

---

## 6. 이벤트 구조 통일안

### 6.1 Reasoning 이벤트 표준 구조

```typescript
interface ReasoningEvent {
  type: "reasoning";
  subtype: "start" | "chunk" | "end";
  content: {
    reason: string;      // 실제 reasoning 텍스트 (필수)
    summary?: string;    // reasoning 요약 (선택)
    phase?: string;      // 단계 정보 (선택)
  };
  metadata: {
    run_id: string;
  };
  timestamp: string;
}
```

### 6.2 이벤트 흐름 예시

```
1. reasoning:start  → { phase: "thinking" }
2. reasoning:chunk  → { reason: "Let me analyze...", summary: "Analyzing input" }
3. reasoning:chunk  → { reason: "Step 1: ...", summary: "Step 1 complete" }
4. reasoning:end    → { phase: "complete" }
5. message:chunk   → { text: "Here is my answer..." }
6. message:final   → { text: "Complete response" }
```

---

## 7. 구현 우선순위

| 순서 | 작업 | 파일 | 복잡도 |
|------|------|------|--------|
| 1 | GPT-5 응답에서 reasoning 추출 | `providers.py` | 중 |
| 2 | Reasoning 이벤트 emit | `orchestrator.py` | 중 |
| 3 | 프론트엔드 필드 호환성 | `useMultiTabChat.ts` | 낮 |
| 4 | Reasoning UI 스타일링 | `ReasoningRenderer.tsx` | 낮 |

---

## 8. 테스트 방법

### 8.1 백엔드 테스트

```python
# 직접 API 호출로 reasoning 확인
import asyncio
from pluto_duck_backend.agent.core.llm.providers import OpenAILLMProvider

async def test_reasoning():
    provider = OpenAILLMProvider(api_key="...", model="gpt-5")
    response = await provider.ainvoke_with_reasoning("Explain quantum computing")
    print("Reasoning:", response.reasoning_content)
    print("Summary:", response.reasoning_summary)
    print("Text:", response.text)

asyncio.run(test_reasoning())
```

### 8.2 프론트엔드 테스트

1. 브라우저 개발자 도구 Network 탭에서 SSE 이벤트 확인
2. `type: "reasoning"` 이벤트에 `content.reason` 필드가 있는지 확인
3. Reasoning UI가 렌더링되는지 확인

---

## 9. 참고 자료

- [OpenAI Responses API Documentation](https://platform.openai.com/docs/api-reference/responses)
- [GPT-5 Reasoning Configuration](https://platform.openai.com/docs/guides/reasoning)
- 프로젝트 내 관련 문서:
  - `docs/research/007_chat_ui_vercel_ai_sdk_analysis.md`
  - `docs/research/010_chat_ui_styling_analysis.md`
