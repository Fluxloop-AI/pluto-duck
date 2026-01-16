---
date: 2026-01-16
researcher: Claude
topic: "Connect Data, Asset Add, Setting 모달 구현 분석"
tags: [research, modal, dialog, animation, UX]
status: complete
---

# Modal Implementation Analysis

## Summary

모든 모달은 Radix UI Dialog + tailwindcss-animate 사용. 주요 문제:
- **모달이 아래에서 위로 점프하는 현상** (slide 애니메이션 버그)
- 애니메이션 200ms로 짧음 (끊기는 느낌)
- X 버튼 하드코딩 (nested modal에서 2개 표시)
- 모달 크기 불일치 (425px ~ 1200px)
- 모달 전환 시 애니메이션 연결 안됨

## 핵심 파일

| 파일 | 역할 |
|------|------|
| `components/ui/dialog.tsx:32-54` | DialogContent, 애니메이션, X버튼 |
| `app/page.tsx:39-56` | 9개 모달 상태 관리 |

## 핵심 버그: 모달 위치 점프 현상

### 증상
Settings 모달 등을 클릭하면 **모달이 화면 중간에서 시작했다가 위로 튀어오르는** 현상 발생

### 원인 분석 (dialog.tsx:41)

```
모달 최종 위치:     top-[50%]  (화면 정중앙)
애니메이션 시작:    slide-in-from-top-[48%]  (48% 위치에서 시작)
                   ↑
                   2% 차이로 인해 위로 점프!
```

**현재 애니메이션 클래스:**
```css
fixed left-[50%] top-[50%]           /* 최종 위치: 정중앙 */
translate-x-[-50%] translate-y-[-50%] /* 센터링 */

/* 애니메이션 - 문제의 원인 */
slide-in-from-left-1/2               /* 좌측 50%에서 시작 */
slide-in-from-top-[48%]              /* 상단 48%에서 시작 ← 50%가 아님! */
zoom-in-95                           /* 95% 크기에서 시작 */
fade-in-0                            /* 투명에서 시작 */
duration-200                         /* 200ms 동안 실행 */
```

**동작 순서:**
1. 모달이 `top: 48%` + `scale: 95%` + `opacity: 0`에서 시작
2. 200ms 동안 `top: 50%` + `scale: 100%` + `opacity: 1`로 이동
3. **결과**: 아래에서 위로 2% 튀어오름 + 확대 + 페이드인이 동시에 발생
4. 짧은 duration(200ms)으로 인해 **뚝뚝 끊기는 느낌**

### 왜 48%인가?
shadcn/ui의 기본 dialog 템플릿에서 가져온 값으로, 의도는 "약간 아래에서 위로 올라오는 느낌"이지만 실제로는 부자연스러운 점프로 인식됨.

## 현재 애니메이션 전체 (dialog.tsx:41)

```css
/* Open 애니메이션 */
data-[state=open]:animate-in
data-[state=open]:fade-in-0
data-[state=open]:zoom-in-95
data-[state=open]:slide-in-from-left-1/2
data-[state=open]:slide-in-from-top-[48%]

/* Close 애니메이션 */
data-[state=closed]:animate-out
data-[state=closed]:fade-out-0
data-[state=closed]:zoom-out-95
data-[state=closed]:slide-out-to-left-1/2
data-[state=closed]:slide-out-to-top-[48%]

/* Duration */
duration-200
```

## 모달별 크기

| 모달 | max-width |
|------|-----------|
| CreateProjectModal | 425px |
| SettingsModal | 500px |
| ImportCSVModal | 550px |
| ImportSQLiteModal | 600px |
| DataSourcesModal | max-w-2xl |
| FilePreviewModal | max-w-6xl |

## 모달별 문제 정리

| 모달 | 문제 |
|------|------|
| **공통** | slide 애니메이션으로 위치 점프 (48% → 50%) |
| **공통** | duration 200ms 너무 짧음 |
| **공통** | zoom 95% → 100% 변화가 눈에 띔 |
| **SettingsModal** | nested dialog에서 X버튼 2개 표시 |
| **SettingsModal** | 콘텐츠가 많아 max-h-[65vh] 스크롤 발생 |
| **DataSourcesModal → Import** | 모달 전환 시 끊김 (close → open 별도 애니메이션) |

## X 버튼 문제

dialog.tsx:47-50에 하드코딩:
- 모든 Dialog에 자동 포함
- SettingsModal의 nested dialog에서 X버튼 2개
- 커스텀 헤더와 위치 충돌

## 개선안

### 1. 애니메이션 수정 (dialog.tsx) - 최우선

**Option A: slide 제거 (권장)**
```diff
- "... duration-200 ... zoom-in-95 slide-in-from-left-1/2 slide-in-from-top-[48%] ..."
+ "... duration-300 ... zoom-in-98 ..."
```
- slide 완전 제거 → 점프 현상 해결
- duration 200ms → 300ms → 부드러운 느낌
- zoom 95% → 98% → 미세한 확대만

**Option B: slide 값 수정**
```diff
- slide-in-from-top-[48%]
+ slide-in-from-top-[50%]
```
- 48% → 50%로 수정하면 점프 없이 제자리에서 시작
- 하지만 slide의 의미가 없어짐 → 제거하는 게 나음

### 2. X버튼 옵션화
```tsx
interface DialogContentProps {
  hideCloseButton?: boolean;
}
```

### 3. 크기 표준화
```tsx
const MODAL_SIZES = {
  sm: '425px',
  md: '550px',
  lg: '700px',
  xl: '900px'
};
```

## 우선순위

| 순위 | 개선사항 | 효과 |
|------|----------|------|
| 1 | **slide 애니메이션 제거** | 점프 현상 즉시 해결 |
| 2 | duration 200ms → 300ms | 부드러운 전환 |
| 3 | zoom 95% → 98% | 미세한 확대로 자연스러움 |
| 4 | X버튼 hideCloseButton prop 추가 | nested modal 문제 해결 |
| 5 | 모달 크기 표준화 | 일관된 UX |
