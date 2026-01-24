---
date: 2026-01-16T18:30:00+09:00
researcher: Claude
topic: "AssetPicker/DisplayConfigModal Jump Animation - Root Cause Analysis"
tags: [research, modal, animation, dialog, height, api]
status: complete
---

# Research: Modal Jump Animation - 진짜 원인 분석

## Research Question
AssetPicker와 DisplayConfigModal에서만 발생하는 모달 점프 현상의 **진짜 원인** 파악. 이전에 음수 마진(`-mt-2`) 수정을 시도했으나 효과가 없었음.

## Summary

**진짜 원인: 모달 열림 시 API 호출로 인한 동적 높이 변화**

두 모달은 열릴 때 API를 호출하고, 로딩 → 콘텐츠 전환 시 높이가 급격히 변화합니다. Dialog가 `translate-y-[-50%]`로 중앙 정렬되어 있어서 높이 변화가 위치 이동(점프)으로 나타납니다.

**왜 음수 마진 수정이 효과가 없었는가:**
음수 마진은 부차적인 문제일 뿐, **핵심 원인은 동적 높이 변화**입니다. CreateAssetModal도 `-mt-6 -mx-6`을 사용하지만 API 호출이 없어서 점프가 발생하지 않습니다.

## Detailed Findings

### 모달 비교 분석

| 모달 | 음수 마진 | API 호출 | 고정 높이 | 점프 발생 |
|------|----------|---------|----------|----------|
| CreateAssetModal | `-mt-6` | ❌ 없음 | ❌ | ❌ 정상 |
| CreateBoardModal | 없음 | ❌ 없음 | ❌ | ❌ 정상 |
| CreateProjectModal | 없음 | ❌ 없음 | ❌ | ❌ 정상 |
| FilePreviewModal | 없음 | ✅ 있음 | ✅ `h-[85vh]` | ❌ 정상 |
| **AssetPicker** | `-mt-2` | ✅ 있음 | ❌ | ⚠️ **점프** |
| **DisplayConfigModal** | `-mt-2` | ✅ 있음 | ❌ | ⚠️ **점프** |

### 핵심 패턴 발견

**정상 작동 패턴 A: API 호출 없음**
```tsx
// CreateAssetModal - 열릴 때 API 없음, 폼이 즉시 표시
<DialogContent className="max-w-2xl">
  <div className="-mx-6 -mt-6 px-6 py-4">헤더</div>
  <div>폼 콘텐츠 (항상 동일한 높이)</div>
</DialogContent>
```

**정상 작동 패턴 B: 고정 높이**
```tsx
// FilePreviewModal - API 호출 있지만 고정 높이
<DialogContent className="max-w-6xl h-[85vh] flex flex-col p-0 gap-0">
  {/* 높이가 고정되어 있어서 콘텐츠가 바뀌어도 모달 위치 불변 */}
</DialogContent>
```

**문제 패턴: API 호출 + 고정 높이 없음**
```tsx
// AssetPicker, DisplayConfigModal
<DialogContent className="max-w-lg">
  {isLoading ? (
    <div className="py-8">Loading...</div>  // 작은 높이
  ) : (
    <div className="max-h-[300px]">콘텐츠</div>  // 큰 높이
  )}
</DialogContent>
```

### 점프 현상 발생 메커니즘

1. **모달 열림**: Dialog 애니메이션 시작 (`slide-in-from-top-1/2`, 200ms)
2. **로딩 상태**: 작은 높이 (예: 로딩 텍스트만 표시)
3. **중앙 정렬**: `translate-y-[-50%]`로 작은 높이 기준 중앙에 위치
4. **API 응답 도착**: 콘텐츠 렌더링, 높이 급격히 증가
5. **재정렬**: 높이가 커지면서 `translate-y-[-50%]` 재계산
6. **점프**: 모달이 위로 이동 (높이 증가분의 50%만큼)

```
애니메이션 시작 (0ms)        애니메이션 중 (100ms)         점프 발생
┌───────┐                   ┌───────┐                    ┌─────────────┐
│Loading│                   │Loading│                    │   Content   │
└───────┘                   └───────┘                    │   Content   │
   ↑                           ↑                         │   Content   │
중앙 정렬                    중앙 정렬                    └─────────────┘
                                                               ↑
                                                         중앙 재정렬 (점프!)
```

### 높이 변화 분석

**AssetPicker:**
- 로딩 상태: `py-8` = 약 64px (텍스트 높이 포함 ~100px)
- 콘텐츠 상태: `max-h-[300px]` = 최대 300px (헤더/푸터 포함 ~450px)
- **높이 차이: ~350px → 점프 거리: ~175px**

**DisplayConfigModal:**
- 로딩 상태: `py-8` = 약 64px (아이콘 높이 포함 ~100px)
- 콘텐츠 상태: 전체 폼 (차트 옵션 등) ~600px+
- **높이 차이: ~500px → 점프 거리: ~250px**

## Code References

### 문제가 있는 모달

- [AssetPicker.tsx:23-33](frontend/pluto_duck_frontend/components/editor/components/AssetPicker.tsx#L23-L33) - 열릴 때 `listAnalyses` API 호출
- [AssetPicker.tsx:84-87](frontend/pluto_duck_frontend/components/editor/components/AssetPicker.tsx#L84-L87) - 로딩 상태 (작은 높이)
- [DisplayConfigModal.tsx:71-93](frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx#L71-L93) - 열릴 때 API 호출
- [DisplayConfigModal.tsx:174-178](frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx#L174-L178) - 로딩 상태

### 정상 작동하는 모달

- [FilePreviewModal.tsx:63](frontend/pluto_duck_frontend/components/assets/FilePreviewModal.tsx#L63) - `h-[85vh]` 고정 높이
- [CreateAssetModal.tsx:94-96](frontend/pluto_duck_frontend/components/assets/CreateAssetModal.tsx#L94-L96) - API 호출 없음

### Dialog 애니메이션

- [dialog.tsx:40-41](frontend/pluto_duck_frontend/components/ui/dialog.tsx#L40-L41) - `translate-y-[-50%]` 중앙 정렬

## Architecture Insights

### 왜 이전 수정이 효과가 없었는가

1. **음수 마진 제거 시도**: `-mt-2`를 제거해도 동적 높이 변화는 그대로
2. **p-0 gap-0 패턴**: 레이아웃은 깔끔해지지만 동적 높이 문제 해결 안됨
3. **Dialog 애니메이션 수정 시도**: 다른 모달에 영향을 미침

### 권장 해결 방법

**확률 높은 순서:**

**방법 1: 최소/고정 높이 설정 (가장 확실)**
```tsx
// AssetPicker
<DialogContent className="max-w-lg min-h-[450px]">

// DisplayConfigModal
<DialogContent className="max-w-lg h-[600px]">
```

**방법 2: 로딩 상태 높이를 콘텐츠 높이와 동일하게**
```tsx
{isLoading ? (
  <div className="min-h-[300px] flex items-center justify-center">
    Loading...
  </div>
) : (
  <div className="max-h-[300px]">콘텐츠</div>
)}
```

**방법 3: 애니메이션 완료 후 API 호출**
```tsx
useEffect(() => {
  if (open) {
    // 애니메이션 완료 후 API 호출 (200ms + 여유)
    const timer = setTimeout(() => {
      loadData();
    }, 250);
    return () => clearTimeout(timer);
  }
}, [open]);
```

**방법 4: CSS transition으로 부드러운 높이 변화**
```tsx
<DialogContent className="transition-all duration-200">
```
(단, 이 방법은 Dialog의 기존 애니메이션과 충돌할 수 있음)

## Open Questions

1. 방법 1 (고정 높이)이 가장 안전하지만, 콘텐츠가 적을 때 빈 공간이 생길 수 있음
2. 방법 3 (지연 로딩)은 사용자 경험에 영향 (모달이 빈 상태로 열림)
3. 최적의 해결책은 `min-h`로 최소 높이만 설정하여 콘텐츠가 적어도 최소한의 높이는 유지하도록 하는 것

## Recommended Fix

```tsx
// AssetPicker.tsx
<DialogContent className="max-w-lg min-h-[400px] flex flex-col">
  <div className="flex items-center gap-3 border-b pb-4">헤더</div>
  <div className="flex-1 overflow-y-auto">콘텐츠</div>
  <div className="border-t pt-4">푸터</div>
</DialogContent>

// DisplayConfigModal.tsx
<DialogContent className="max-w-lg min-h-[500px] flex flex-col">
  <div className="border-b pb-4">헤더</div>
  <div className="flex-1 overflow-y-auto py-4">콘텐츠</div>
  <div className="border-t pt-4">푸터</div>
</DialogContent>
```

`flex flex-col`과 `flex-1`을 사용하면 콘텐츠 영역이 유동적으로 공간을 채우고, `min-h`로 최소 높이를 보장하여 점프를 방지합니다.
