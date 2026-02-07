# Prompt Experiment Dev Guide

## 목적
개발 단계에서 프롬프트 프로파일(`v1`, `v2`, 신규 profile)을 빠르게 전환하고, 동일 입력 대비 동작 차이를 재현 가능하게 비교한다.

## 프로파일 우선순위
1. Run metadata: `_prompt_experiment`
2. Environment: `PLUTODUCK_AGENT__PROMPT_EXPERIMENT`
3. Default: `v2`

## 방법 1: Run metadata로 즉시 전환
대화 append 요청의 metadata에 `_prompt_experiment`를 넣는다.

예시:
```json
{
  "metadata": {
    "_prompt_experiment": "v1"
  }
}
```

같은 conversation에서도 run마다 값을 바꾸면 즉시 다른 profile이 적용된다.

## 방법 2: Environment로 세션 고정
metadata를 넣지 않을 때 공통 기본 profile을 고정하려면 환경 변수를 사용한다.

```bash
export PLUTODUCK_AGENT__PROMPT_EXPERIMENT=v1
```

## 이벤트 확인
스트리밍 chunk/usage 이벤트 metadata에 `experiment_profile`이 기록된다.

## 리플레이 비교 체크리스트
아래 항목을 동일 입력 기준으로 `v1`/`v2` 각각 비교한다.

- 응답 길이(문자 수, 문단 수)
- token usage(`prompt_tokens`, `completion_tokens`, `total_tokens`)
- tool 호출 패턴(도구 종류, 호출 순서, 호출 횟수)
- 실패율(오류 이벤트 여부, 재시도 발생 여부)
- 사용자 체감 품질(정확성, 누락/환각 여부, 실행 가능성)

## 프로파일 파일 위치
- `backend/pluto_duck_backend/agent/core/deep/prompts/profiles/v1.yaml`
- `backend/pluto_duck_backend/agent/core/deep/prompts/profiles/v2.yaml`
- `backend/pluto_duck_backend/agent/core/deep/prompts/profiles/v1/runtime.md`
- `backend/pluto_duck_backend/agent/core/deep/prompts/profiles/v2/runtime.md`
