# LLM Streaming Notes

## Buffer Policy
- Flush interval: 50ms.
- Token batch size: 20 tokens.
- Buffer cap: 4096 characters.

## Manual Verification Checklist
1. UI에서 긴 질문 제출 -> 0.5s 내 텍스트 출력.
2. run end 후 최종 메시지와 화면 텍스트 동일.
3. 네트워크 중단 시 fallback 동작 확인.
