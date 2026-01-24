---
date: 2026-01-13T22:15:00+09:00
researcher: Claude
topic: "Board Editor Block Drag Functionality Not Working"
tags: [research, codebase, board, editor, lexical, drag-drop, bug, tauri]
status: complete
---

# Research: Board Editor Block Drag Functionality Not Working

## Research Question
보드 영역에서 블록을 드래그하여 순서를 변경하는 기능이 Tauri 앱에서 동작하지 않는 원인 파악

## Summary

**원인 확인됨**: Tauri의 `dragDropEnabled` 설정이 기본값 `true`로 되어 있어서 HTML5 드래그 이벤트가 차단됩니다. 웹 브라우저에서는 정상 동작하지만 Tauri 앱에서만 문제가 발생합니다.

**해결**: `tauri.conf.json`에 `"dragDropEnabled": false` 설정 추가

## Detailed Findings

### 1. 증상

| 환경 | 블록 드래그 상태 |
|------|-----------------|
| 웹 브라우저 (localhost:3100) | **정상 동작** |
| Tauri 앱 (macOS) | **동작 안 함** |

### 2. 원인 분석

#### Tauri의 dragDropEnabled 설정
- Tauri는 기본적으로 OS 레벨의 파일 드래그-드롭을 처리함
- `dragDropEnabled: true` (기본값)일 때:
  - Tauri의 내부 드래그-드롭 시스템이 활성화됨
  - **HTML5 드래그 이벤트가 차단됨**
- Lexical의 `DraggableBlockPlugin`은 HTML5 드래그 API를 사용하므로 Tauri에서 작동하지 않음

#### 참고 자료
- [Fixing drag events with Tauri](https://ellie.wtf/notes/drag-event-issues-in-Tauri)
- [Tauri Issue #6695](https://github.com/tauri-apps/tauri/issues/6695)
- [Tauri dragDropEnabled 문서](https://v2.tauri.app/reference/javascript/api/namespacewebview/)

### 3. 해결 방법

`tauri-shell/src-tauri/tauri.conf.json`에 window 설정 추가:

```json
"app": {
  "windows": [
    {
      "label": "main",
      "title": "Pluto Duck",
      "width": 1200,
      "height": 800,
      "minWidth": 800,
      "minHeight": 600,
      "dragDropEnabled": false
    }
  ],
  ...
}
```

### 4. 이전 분석 (잘못된 추정)

처음에는 `a12ad42` 커밋에서 DraggableBlockPlugin을 CSS 클래스 방식에서 인라인 스타일로 변경한 것이 원인이라고 추정했으나, 이는 잘못된 분석이었습니다. 실제로는:
- 웹에서 확인했을 때 현재 코드도 정상 동작함
- 문제는 Tauri 환경에서만 발생
- 코드 문제가 아닌 Tauri 설정 문제

## Code References

- [tauri.conf.json](tauri-shell/src-tauri/tauri.conf.json) - Tauri 설정 파일
- [DraggableBlockPlugin.tsx](frontend/pluto_duck_frontend/components/editor/plugins/DraggableBlockPlugin.tsx) - 드래그 플러그인
- [BoardEditor.tsx:232](frontend/pluto_duck_frontend/components/editor/BoardEditor.tsx#L232) - 플러그인 사용 위치

## 테스트 방법

1. `tauri.conf.json`에 `dragDropEnabled: false` 설정 추가
2. Tauri 앱 재빌드: `cd tauri-shell && cargo tauri dev`
3. 보드에서 블록 드래그 테스트

## 주의사항

`dragDropEnabled: false`로 설정하면 OS 레벨의 파일 드래그-드롭 기능이 비활성화됩니다. 만약 앱에서 외부 파일을 드래그하여 가져오는 기능이 필요하다면, 별도의 구현이 필요할 수 있습니다.
