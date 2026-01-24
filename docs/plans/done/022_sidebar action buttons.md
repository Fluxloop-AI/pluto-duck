# Sidebar Action Buttons & Dataset Delete Wiring Implementation Plan

## Overview
Add tab-specific action buttons below the sidebar tab slide UI and wire up the delete functionality for DatasetList.

## Current State Analysis

**Tab Slide UI** ([page.tsx:581-616](frontend/pluto_duck_frontend/app/page.tsx#L581-L616)):
- Boards/Datasets tab switcher with sliding indicator
- No action buttons below tabs - content area starts immediately after

**DatasetList** ([DatasetList.tsx](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx)):
- Already updated with BoardList-style 2-line layout
- Has `onDelete` prop but not wired up in page.tsx
- Delete confirmation UI implemented

**Delete APIs Available**:
- `deleteFileAsset(projectId, fileId)` in [fileAssetApi.ts:133-142](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L133-L142)
- `dropCache(projectId, localTable)` in [sourceApi.ts:245-252](frontend/pluto_duck_frontend/lib/sourceApi.ts#L245-L252)

**AddDatasetModal** - Already exists and used via `showAddDatasetModal` state in page.tsx

## Desired End State

1. **Action Buttons**: Below tab slide UI, conditionally rendered based on active tab:
   - Boards tab: "+ New Board" button calling `handleCreateBoard`
   - Datasets tab: "+ Add Dataset" button opening AddDatasetModal

2. **Delete Wiring**: DatasetList delete functionality connected to actual APIs

**Verification**:
- Action buttons: Correct button shows for each tab
- Delete: Clicking delete actually removes dataset via API

## What We're NOT Doing

- Modifying the header SquarePen button (future separate handling)
- Adding rename functionality (no backend API)
- Changing DatasetList styling (already done)

## Implementation Approach

1. Add conditional action buttons between tab slide UI and content area in page.tsx
2. Wire up page.tsx to pass delete handlers to DatasetList

---

## - [x] Phase 1: Add Action Buttons Below Tab Slide UI

### Overview
Add "+ New Board" and "+ Add Dataset" buttons below the tab slide UI, conditionally displayed based on active tab.

### Changes Required:

#### 1. Add action buttons
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- After line 616 (closing `</div>` of Tab Slide UI), add conditional buttons
- Boards tab: Button with Plus icon + "New Board" text, onClick calls `handleCreateBoard`
- Datasets tab: Button with Plus icon + "Add Dataset" text, onClick sets `setShowAddDatasetModal(true)`
- Styling: `flex w-full items-center gap-2 mx-3 mb-2 px-2.5 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors`

#### 2. Verify Plus icon import
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**: Ensure `Plus` is imported from `lucide-react` (add to existing import if missing)

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `pnpm run typecheck`
- [x] Build succeeds: `pnpm run build`

#### Manual Verification:
- [ ] Boards tab shows "+ New Board" button below tabs
- [ ] Clicking "+ New Board" creates a new board
- [ ] Datasets tab shows "+ Add Dataset" button below tabs
- [ ] Clicking "+ Add Dataset" opens AddDatasetModal

---

## - [x] Phase 2: Wire Up page.tsx Delete Handlers

### Overview
Pass delete callback from page.tsx to DatasetList, handling both FileAsset and CachedTable deletion.

### Changes Required:

#### 1. Create dataset delete handler
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- Add `handleDeleteDataset` function that:
  - Checks if dataset is FileAsset (has `name` property) or CachedTable (has `local_table` property)
  - For FileAsset: calls `deleteFileAsset(currentProject.id, dataset.id)`
  - For CachedTable: calls `dropCache(currentProject.id, dataset.local_table)`
  - Refreshes sidebar datasets after deletion

#### 2. Pass onDelete to DatasetList
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- Add `onDelete={handleDeleteDataset}` prop to DatasetList component

#### 3. Verify API imports
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- Ensure `deleteFileAsset` is imported from `lib/fileAssetApi`
- Ensure `dropCache` is imported from `lib/sourceApi`

### Success Criteria:

#### Automated Verification:
- [x] Type checking passes: `pnpm run typecheck`
- [x] Build succeeds: `pnpm run build`

#### Manual Verification:
- [ ] Deleting FileAsset removes it from list
- [ ] Deleting CachedTable removes it from list
- [ ] No errors in console after deletion

---

## Testing Strategy

### Manual Testing Steps:
1. Open sidebar with Boards tab active
2. Verify "+ New Board" button appears below tabs
3. Click button and verify new board is created
4. Switch to Datasets tab
5. Verify "+ Add Dataset" button appears below tabs
6. Click button and verify AddDatasetModal opens
7. Hover over dataset and verify trash icon appears
8. Click trash and verify confirmation UI
9. Click Delete and verify dataset is removed from list

### Edge Cases:
- Empty datasets list: Should show "No datasets yet" message
- Mixed FileAsset and CachedTable: Both should delete correctly

## References

### Files Read:
- [page.tsx:560-660](frontend/pluto_duck_frontend/app/page.tsx#L560-L660) - Sidebar structure and DatasetList usage
- [DatasetList.tsx](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx) - Component with delete UI
- [fileAssetApi.ts:133-142](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L133-L142) - deleteFileAsset API
- [sourceApi.ts:245-252](frontend/pluto_duck_frontend/lib/sourceApi.ts#L245-L252) - dropCache API

### Research Documents:
- [036_new_board_button_placement.md](docs/research/036_new_board_button_placement.md) - Action buttons research
- [037_sidebar_dataset_list_style_unification.md](docs/research/037_sidebar_dataset_list_style_unification.md) - Style unification research
