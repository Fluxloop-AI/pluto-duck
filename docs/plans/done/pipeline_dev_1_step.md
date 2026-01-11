### 단기 목표: 현재 구조 유지 + 에이전트 안정화 플랜

**1. 입력 파싱 · 컨텍스트 정리**
- 프론트/오케스트레이터에서 `@chat/foo`, `@foo` 토큰을 제거한 순수 질문 텍스트 + `metadata.preferred_tables`(또는 `mentioned_tables`)를 함께 전달.
- `AgentRunManager`는 지금처럼 `preferred_tables`를 `AgentState`에 세팅하되, 필요 시 `state.context.sanitized_user_query`도 추가해서 SQL/프롬프트에서 그대로 활용.

**2. 계획 수립(Planner)**
- 프롬프트를 정리해 “명시된 테이블이 있으면 그대로 사용, 없으면 어떤 정보를 찾아야 할지 단계화”하도록 개편.
- `preferred_tables`가 비어 있을 때는 “필요한 테이블 찾기/확인”이 첫 단계로 들어가도록 유도.
- 파싱 결과를 메시지로 남겨 사용자도 플로우를 이해할 수 있게.

**3. 스키마 탐색(Schema)**
- DuckDB `SHOW TABLES` 기반으로 우선순위 목록(`preferred_tables` → 기타)을 만들어 메시지와 컨텍스트에 저장.
- 명확한 테이블 지정이 없거나 후보가 너무 많으면, 간단한 follow-up 질문(“어느 테이블을 원하세요?”)을 planners → reasoning → finalize 루프로 돌려 사용자에게 재질의할 수 있게 구성.

**4. SQL 생성(Sql)**
- 프롬프트에 `sanitized_user_query`, 계획 단계, `preferred_tables`/`schema_preview`를 넣어 SQL을 생성.
- 여전히 ad-hoc 실행이므로 `query_result_<run_id>` 형태로 저장되고, SQL은 state에 보관.

**5. 검증·실행(Verifier)**
- 기존 `QueryExecutionService`를 그대로 사용해 DuckDB에 `query_history`, `query_result_<run_id>` 테이블을 남김.
- 성공 시 result_table/rows_affected, 실패 시 error 정보가 `state.verification_result`에 들어감.

**6. 정리(Finalize + 프론트)**
- Finalize 노드는 SQL/결과 테이블 이름을 정리해 주고, 프론트는 필요하면 `query_result_<run_id>` 테이블을 바로 조회하거나 미리보기로 노출.

**7. 유지관리(TTL/정리 배치)**
- 별도 배치(예: 하루 1회)로 `query_result_*`·`query_history`에서 만료 기준(예: 생성 후 7일)을 넘은 항목 삭제.
- DuckDB 스크립트 or 백엔드 배치 잡으로 간단히 구현 가능.

---

이 플랜대로면 명시 테이블이 있을 땐 그대로 사용하고, 없을 때는 스키마 노드 + reasoning을 통해 “테이블 선택/재질의” 루프를 돌릴 수 있어요. TTL 배치 추가로 누적 데이터도 관리 가능합니다. 이후 Flow/DBT 기반 장기 구조로 전환할 때는 Verifier를 교체하는 쪽으로 확장하시면 됩니다.