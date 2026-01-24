# Modal Negative Margin Animation Fix Implementation Plan

## Overview
Fix the animation jump issue in AssetPicker and DisplayConfigModal by replacing the negative margin pattern (`-mx-6 px-6 -mt-2`) with the `p-0 gap-0` pattern, where DialogContent has no padding and each section manages its own padding internally.

## Current State Analysis

### Problem
Two modals exhibit a "jump" during their open animation:
- `AssetPicker.tsx` - Asset selection modal in the editor
- `DisplayConfigModal.tsx` - Display configuration modal for asset embeds

### Root Cause
Both modals use negative margins (`-mx-6`, `-mt-2`) on custom header/footer divs to create full-width sections that extend beyond DialogContent's default padding. This conflicts with Dialog's centering (`translate-y-[-50%]`) and slide-in animation (`slide-in-from-top-1/2`), causing a layout shift during animation.

### Working Pattern
Other modals like `FilePreviewModal.tsx` use the `p-0 gap-0` pattern which works correctly:
- DialogContent has `className="p-0 gap-0"` to remove default padding
- Each section (header, content, footer) manages its own padding internally (e.g., `px-6 py-4`)

## Desired End State
- Both modals open with smooth slide-in animation without any visual jump
- Visual appearance remains identical to current design
- No regression in functionality

## What We're NOT Doing
- Modifying the Dialog component itself
- Changing the visual design of the modals
- Adding new features to the modals

## Implementation Approach
Replace the negative margin hack with the cleaner `p-0 gap-0` pattern for both modals. This involves:
1. Adding `p-0 gap-0` to DialogContent
2. Removing negative margins from header/footer
3. Adding explicit padding to each section

---

## - [x] Phase 1: Fix AssetPicker Modal

### Overview
Refactor AssetPicker.tsx to use the `p-0 gap-0` pattern.

### Changes Required:

#### 1. AssetPicker.tsx
**File**: `frontend/pluto_duck_frontend/components/editor/components/AssetPicker.tsx`

**Change 1 - DialogContent (line 58):**
- Current: `<DialogContent className="max-w-lg">`
- New: `<DialogContent className="max-w-lg p-0 gap-0">`

**Change 2 - Header div (line 60):**
- Current: `<div className="flex items-center gap-3 border-b border-border pb-4 -mx-6 px-6 -mt-2">`
- New: `<div className="flex items-center gap-3 border-b border-border px-6 py-4">`

**Change 3 - Search section (around line 71):**
- Wrap in a div with horizontal padding: `<div className="px-6">`

**Change 4 - List section (line 83):**
- Current: `<div className="max-h-[300px] overflow-y-auto space-y-1 -mx-2">`
- New: `<div className="max-h-[300px] overflow-y-auto space-y-1 px-4">` (adjust padding as needed)

**Change 5 - Footer div (line 166):**
- Current: `<div className="flex items-center justify-between border-t border-border pt-4 -mx-6 px-6">`
- New: `<div className="flex items-center justify-between border-t border-border px-6 py-4">`

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors: `npm run typecheck`
- [x] Linting passes: `npm run lint`

#### Manual Verification:
- [ ] Open AssetPicker modal - animation is smooth without jump
- [ ] Header border extends full width
- [ ] Footer border extends full width
- [ ] Search input and list have proper horizontal spacing
- [ ] Overall visual appearance matches previous design

---

## - [x] Phase 2: Fix DisplayConfigModal

### Overview
Refactor DisplayConfigModal.tsx to use the `p-0 gap-0` pattern.

### Changes Required:

#### 1. DisplayConfigModal.tsx
**File**: `frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx`

**Change 1 - DialogContent (line 154):**
- Current: `<DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">`
- New: `<DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto p-0 gap-0">`

**Change 2 - Header div (line 156):**
- Current: `<div className="flex items-center justify-between border-b border-border pb-4 -mx-6 px-6 -mt-2">`
- New: `<div className="flex items-center justify-between border-b border-border px-6 py-4">`

**Change 3 - Loading section (line 174):**
- Add horizontal padding to maintain layout

**Change 4 - Content section (line 182):**
- Current: `<div className="space-y-6 py-4">`
- New: `<div className="space-y-6 px-6 py-4">`

**Change 5 - Footer div (line 448):**
- Current: `<div className="flex items-center justify-end gap-2 border-t border-border pt-4 -mx-6 px-6">`
- New: `<div className="flex items-center justify-end gap-2 border-t border-border px-6 py-4">`

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors: `npm run typecheck`
- [x] Linting passes: `npm run lint`

#### Manual Verification:
- [ ] Open DisplayConfigModal - animation is smooth without jump
- [ ] Header border extends full width
- [ ] Footer border extends full width
- [ ] All form elements (display type, chart options, etc.) have proper spacing
- [ ] Loading state displays correctly
- [ ] Overall visual appearance matches previous design

---

## - [ ] Phase 3: Verify Fixes

### Overview
Comprehensive testing of both modals to ensure the fix works and no regressions exist.

### Manual Testing Steps:

1. **AssetPicker Modal:**
   - Navigate to editor board
   - Trigger asset picker (insert asset embed)
   - Verify smooth open animation
   - Test search functionality
   - Test asset selection and double-click
   - Test cancel and insert buttons

2. **DisplayConfigModal:**
   - Navigate to editor board with an asset embed
   - Open display config modal
   - Verify smooth open animation
   - Test switching between Table and Chart display types
   - Test chart mode selection (Single, Group By, Multi Metric)
   - Test all form controls
   - Test cancel and save buttons

3. **Compare with other modals:**
   - Open FilePreviewModal for reference
   - Confirm animation behavior is now consistent

---

## Testing Strategy

### Manual Testing Steps:
1. Open AssetPicker modal multiple times rapidly - no animation jump
2. Open DisplayConfigModal multiple times rapidly - no animation jump
3. Test both modals on different viewport sizes
4. Verify all interactive elements still work correctly

---

## References
- `frontend/pluto_duck_frontend/components/editor/components/AssetPicker.tsx` - Affected modal
- `frontend/pluto_duck_frontend/components/editor/components/DisplayConfigModal.tsx` - Affected modal
- `frontend/pluto_duck_frontend/components/ui/dialog.tsx` - Dialog component with animation classes
- `frontend/pluto_duck_frontend/components/assets/FilePreviewModal.tsx` - Reference implementation using p-0 gap-0 pattern
- `docs/research/026_modal_jump_animation_issue.md` - Research document identifying the issue
