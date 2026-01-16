---
date: 2026-01-16T15:30:00+09:00
researcher: Claude
topic: "AssetPicker/DisplayConfigModal Animation Jump Issue"
tags: [research, modal, animation, ui, dialog]
status: complete
---

# Research: AssetPicker/DisplayConfigModal Animation Jump Issue

## Research Question
다른 모달은 정상인데 AssetPicker, DisplayConfigModal 2개에서만 모달이 점프하는 현상이 발생하는 원인 파악

## Summary
**문제 원인: 커스텀 헤더/푸터에 사용된 음수 마진(`-mx-6`, `-mt-2`) 패턴이 Dialog 애니메이션과 충돌**

두 모달 모두 DialogHeader/DialogTitle 등 표준 컴포넌트 대신 커스텀 div에 음수 마진을 적용하여 전체 너비 헤더/푸터를 구현했는데, 이 음수 마진이 Dialog의 slide-in 애니메이션 시작 위치 계산과 충돌하여 점프 현상 발생.

## Detailed Findings

### 문제가 있는 모달 (2개)

#### 1. AssetPicker.tsx:58-68
```tsx
<DialogContent className="max-w-lg">
  {/* 문제: 커스텀 헤더에 음수 마진 */}
  <div className="flex items-center gap-3 border-b border-border pb-4 -mx-6 px-6 -mt-2">
```

#### 2. DisplayConfigModal.tsx:154-171
```tsx
<DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
  {/* 문제: 커스텀 헤더에 음수 마진 */}
  <div className="flex items-center justify-between border-b border-border pb-4 -mx-6 px-6 -mt-2">
```

**공통 문제 패턴:**
- `-mx-6 px-6`: DialogContent의 padding을 상쇄하고 다시 적용
- `-mt-2`: 상단 마진 음수 조정
- DialogHeader/DialogTitle/DialogDescription 미사용
- 푸터도 동일하게 `-mx-6 px-6` 패턴 사용

### 정상 작동하는 모달 (8개)

| 파일 | 사용 패턴 |
|------|----------|
| AddToExistingDatasetModal.tsx | DialogHeader, DialogTitle, DialogDescription, DialogFooter 사용 |
| CachedTablePreviewModal.tsx | DialogTitle, DialogDescription 사용, `p-0 gap-0`으로 패딩 제거 |
| CreateAssetModal.tsx | 헤더에 음수마진 있으나 `-mt-6` (더 큰 값으로 일관성 있음) |
| ExecutionPlanView.tsx | DialogTitle, DialogDescription 사용 |
| FilePreviewModal.tsx | DialogTitle, DialogDescription 사용, `p-0 gap-0` |
| FolderSourceBrowserModal.tsx | DialogHeader, DialogTitle, DialogDescription 사용, `p-0 gap-0` |
| AssetDetailModal.tsx | `p-0 gap-0`으로 패딩 완전 제거 후 내부에서 관리 |

### 정상 모달의 패턴 분석

**패턴 A: 표준 Dialog 컴포넌트 사용**
```tsx
<DialogContent>
  <DialogHeader>
    <DialogTitle>제목</DialogTitle>
    <DialogDescription>설명</DialogDescription>
  </DialogHeader>
  {/* 콘텐츠 */}
  <DialogFooter>
    {/* 버튼 */}
  </DialogFooter>
</DialogContent>
```

**패턴 B: 패딩 완전 제거 후 내부 관리**
```tsx
<DialogContent className="p-0 gap-0">
  <div className="p-6 border-b">헤더</div>
  <div className="p-6">콘텐츠</div>
  <div className="p-6 border-t">푸터</div>
</DialogContent>
```

### Dialog 애니메이션 구조 (dialog.tsx:40-41)

```tsx
// slide-in-from-top-1/2: 위에서 50% 위치부터 슬라이드
"data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-1/2"
```

이 애니메이션은 `translate-x-[-50%] translate-y-[-50%]`와 함께 동작하는데, 음수 마진이 있으면 초기 레이아웃 계산 시 실제 콘텐츠 위치가 달라져 점프 발생.

## Code References
- `components/editor/components/AssetPicker.tsx:60` - 음수 마진 헤더
- `components/editor/components/DisplayConfigModal.tsx:156` - 음수 마진 헤더
- `components/ui/dialog.tsx:40-41` - slide-in 애니메이션 정의
- `components/assets/FilePreviewModal.tsx:47` - 정상 패턴 (p-0 gap-0)
- `components/assets/AddToExistingDatasetModal.tsx` - 정상 패턴 (표준 컴포넌트)

## Architecture Insights

### 왜 음수 마진이 문제인가?

1. **레이아웃 shift**: 음수 마진은 애니메이션 시작 전/후 레이아웃 계산에 영향
2. **transform 충돌**: Dialog는 `translate-y-[-50%]`로 중앙 정렬하는데, `-mt-2`가 이 계산을 방해
3. **reflow 타이밍**: 애니메이션 시작 시점과 음수 마진 적용 시점의 불일치

### 권장 해결 방법

**옵션 1: p-0 gap-0 패턴으로 변경 (권장)**
```tsx
<DialogContent className="max-w-lg p-0 gap-0">
  <div className="p-6 border-b">헤더</div>
  <div className="p-6">콘텐츠</div>
  <div className="p-6 border-t">푸터</div>
</DialogContent>
```

**옵션 2: 표준 Dialog 컴포넌트 사용**
```tsx
<DialogContent>
  <DialogHeader>
    <DialogTitle>제목</DialogTitle>
  </DialogHeader>
  {/* 콘텐츠 */}
</DialogContent>
```

## Open Questions
- CreateAssetModal은 `-mt-6`를 사용하는데 문제가 없는 이유 확인 필요 (값이 더 크거나 다른 구조적 차이 가능)
