# Dataset List Style Unification Implementation Plan

## Overview
Unify the DatasetView component styling to match BoardList, adopting a consistent 2-line layout (title + relative time) with hover delete and inline rename functionality.

## Current State Analysis

**BoardList** ([BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx)):
- 2-line layout: name + relative time ("8h ago")
- Container: `space-y-1 pl-0.5`
- Item padding: `px-2.5 py-2.5 rounded-lg`
- Active state: `bg-primary/10 text-primary`
- Hover state: `hover:bg-accent`
- Hover delete button with inline confirmation
- Double-click inline rename
- Auto-refresh relative times every 60 seconds

**DatasetView** ([DatasetView.tsx](frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx)):
- Card layout with border, icon container, type badge, metadata row
- Container: `grid gap-3`
- Item padding: `p-4 gap-4` with border
- No active state
- Hover state: `hover:bg-accent/50`
- No delete or rename functionality
- Absolute date format ("Jan 23, 2025")

**API Availability**:
- `deleteFileAsset` exists in [fileAssetApi.ts:133-142](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L133-L142)
- `dropCache` exists in [sourceApi.ts:245-252](frontend/pluto_duck_frontend/lib/sourceApi.ts#L245-L252)
- No rename/update API for FileAsset (will need to be added in a future phase)

## Desired End State

DatasetView displays datasets in a list matching BoardList:
- 2-line layout: dataset name + relative time
- Same container and item styling as BoardList
- Active state highlighting for selected dataset
- Hover delete button with inline confirmation
- Double-click inline rename (FileAsset only)
- Auto-refreshing relative times

**Verification**:
- Visual comparison: DatasetView list items should be visually identical to BoardList items
- Delete functionality: hover shows trash icon, clicking shows confirmation, confirming deletes
- Rename functionality: double-click on FileAsset name enables inline edit

## What We're NOT Doing

- Modifying the sidebar DatasetList component (it serves a different purpose as a preview)
- Adding rename API to backend (out of scope, can be done separately)
- Inline rename for CachedTable (they have fixed names derived from source)
- Changing the header or empty state styling (only the list items)

## Implementation Approach

1. Extract `formatRelativeTime` to shared utility to avoid duplication
2. Add required state and props to DatasetView for active selection, delete, and rename
3. Replace the card-style list rendering with BoardList-style 2-line layout
4. Implement delete confirmation UI matching BoardList
5. Implement inline rename for FileAsset type only

---

## - [x] Phase 1: Extract Shared Utility

### Overview
Extract the `formatRelativeTime` function to a shared utility file to avoid code duplication between BoardList and DatasetView.

### Changes Required:

#### 1. Create date utility function
**File**: `frontend/pluto_duck_frontend/lib/utils.ts`
**Changes**: Add `formatRelativeTime` function that handles null input (needed for datasets).

#### 2. Update BoardList to use shared utility
**File**: `frontend/pluto_duck_frontend/components/boards/BoardList.tsx`
**Changes**: Import and use `formatRelativeTime` from `lib/utils`, remove local implementation.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `pnpm run typecheck`
- [x] Linting passes: `pnpm run lint`
- [x] Build succeeds: `pnpm run build`

#### Manual Verification:
- [ ] BoardList relative times display correctly (unchanged behavior)

---

## - [x] Phase 2: Extend DatasetView Props and State

### Overview
Add the necessary props and internal state to DatasetView for supporting active selection, delete confirmation, inline rename, and auto-updating relative times.

### Changes Required:

#### 1. Extend DatasetViewProps interface
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx`
**Changes**:
- Add `activeDatasetId?: string` prop
- Add `onSelectDataset?: (dataset: Dataset) => void` prop
- Add `onDeleteDataset?: (dataset: Dataset) => void` prop
- Add `onRenameDataset?: (dataset: Dataset, newName: string) => void` prop

#### 2. Add internal state
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx`
**Changes**:
- Add `tick` state with 60-second interval for relative time refresh
- Add `confirmingDeleteId` state for tracking delete confirmation
- Add `editingDatasetId` and `editingName` state for inline rename
- Add `inputRef` for focusing rename input

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `pnpm run typecheck`

#### Manual Verification:
- [ ] No runtime errors on component mount

---

## - [x] Phase 3: Implement List Style Changes

### Overview
Transform the card-style list rendering to match BoardList's 2-line layout, removing icon container, type badge, and metadata row.

### Changes Required:

#### 1. Update list container
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx`
**Changes**: Replace `<div className="grid gap-3">` with `<div className="space-y-1 pl-0.5">`.

#### 2. Update list item structure
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx`
**Changes**:
- Remove icon container (10x10 div with icon)
- Remove type badge span
- Remove metadata row (rows, size, date)
- Apply 2-line layout: name (p tag) + relative time (p tag)
- Apply active state classes based on `activeDatasetId`
- Apply hover state: `hover:bg-accent`
- Add cursor-pointer and onClick handler
- Import and use `formatRelativeTime` from `lib/utils`

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `pnpm run typecheck`
- [x] Build succeeds: `pnpm run build`

#### Manual Verification:
- [ ] Dataset items display in 2-line layout (name + relative time)
- [ ] Active dataset has highlighted background
- [ ] Hover shows accent background
- [ ] Clicking a dataset triggers `onSelectDataset`

---

## - [x] Phase 4: Implement Delete Functionality

### Overview
Add hover delete button with inline confirmation UI, matching BoardList's delete UX.

### Changes Required:

#### 1. Add delete confirmation UI
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx`
**Changes**:
- When `confirmingDeleteId` matches dataset ID, render confirmation row (same structure as BoardList)
- Add Cancel and Delete buttons with appropriate styling
- Import TrashIcon from lucide-react

#### 2. Add hover delete button
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx`
**Changes**:
- Add conditionally visible delete button (opacity-0, group-hover:opacity-100)
- Only show when `onDeleteDataset` is provided and there's more than 1 dataset
- onClick sets `confirmingDeleteId`

#### 3. Implement delete handler
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx`
**Changes**: On confirm, call `onDeleteDataset` and reset `confirmingDeleteId`.

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `pnpm run typecheck`

#### Manual Verification:
- [ ] Hovering dataset shows trash icon
- [ ] Clicking trash icon shows inline confirmation
- [ ] Cancel returns to normal state
- [ ] Delete triggers callback and returns to normal state

---

## - [x] Phase 5: Implement Inline Rename

### Overview
Add double-click rename functionality for FileAsset datasets (CachedTable cannot be renamed).

### Changes Required:

#### 1. Add type guard and rename handlers
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx`
**Changes**:
- Add `handleStartRename(dataset)` - only enables for FileAsset type
- Add `handleFinishRename()` - calls `onRenameDataset` if name changed
- Add `handleKeyDown(e)` - Enter commits, Escape cancels

#### 2. Update name rendering
**File**: `frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx`
**Changes**:
- When `editingDatasetId` matches, render input instead of p tag
- Add `onDoubleClick` handler to name p tag (only for FileAsset)
- Wire up input with value, onChange, onBlur, onKeyDown

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `pnpm run typecheck`
- [x] Build succeeds: `pnpm run build`

#### Manual Verification:
- [ ] Double-clicking FileAsset name enables inline edit
- [ ] Double-clicking CachedTable name does nothing
- [ ] Enter commits rename
- [ ] Escape cancels rename
- [ ] Clicking elsewhere commits rename

---

## Testing Strategy

### Manual Testing Steps:
1. Navigate to Datasets view
2. Verify list items show 2-line layout (name + relative time like "8h ago")
3. Click a dataset and verify active state highlighting
4. Hover over dataset and verify trash icon appears
5. Click trash icon and verify confirmation UI
6. Click Cancel and verify return to normal
7. Click Delete and verify deletion occurs
8. Double-click on FileAsset name and verify inline edit mode
9. Type new name, press Enter, verify rename callback
10. Wait 60+ seconds and verify relative times update

### Edge Cases:
- Single dataset: delete button should still show
- Empty datasets: empty state UI unchanged
- Long dataset names: should truncate properly
- CachedTable: double-click should NOT enable rename

## Performance Considerations
- The 60-second tick interval is lightweight (only triggers re-render, no API calls)
- No additional API calls added for list rendering

## Migration Notes
- Parent components using DatasetView may optionally pass the new props
- Existing behavior preserved when new props not provided (no breaking changes)

## References

### Files Read:
- [BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx) - Target style reference
- [DatasetView.tsx](frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx) - Component to modify
- [DatasetList.tsx](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx) - Sidebar preview component (not modified)
- [fileAssetApi.ts](frontend/pluto_duck_frontend/lib/fileAssetApi.ts) - Delete API exists, no rename API
- [sourceApi.ts](frontend/pluto_duck_frontend/lib/sourceApi.ts) - dropCache exists for CachedTable
- [utils.ts](frontend/pluto_duck_frontend/lib/utils.ts) - Shared utility file
- [page.tsx](frontend/pluto_duck_frontend/app/page.tsx) - DatasetView usage context

### Research Document:
- [036_dataset_list_style_unification.md](docs/research/036_dataset_list_style_unification.md)
