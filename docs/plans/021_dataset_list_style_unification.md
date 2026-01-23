# DatasetList Style Unification with BoardList

## Overview
Unify the sidebar DatasetList component styling to match BoardList: 2-line layout (name + relative time), hover delete with inline confirmation, and consistent active/hover styles.

## Current State Analysis

**DatasetList** ([DatasetList.tsx](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx)):
- 1-line layout: icon + name only
- Active state: `bg-black/5`
- Hover state: `hover:bg-black/5`
- No time display, no delete functionality
- Has "Browse all datasets..." button (to keep)

**BoardList** ([BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx)):
- 2-line layout: name + relative time
- Active state: `bg-primary/10 text-primary`
- Hover state: `hover:bg-accent`
- 60-second auto-refresh for relative times
- Hover trash icon with inline delete confirmation
- Double-click rename (not implementing for DatasetList)

## Desired End State

DatasetList visually matches BoardList:
- 2-line item layout with name and relative time
- Consistent active/hover styling (`bg-primary/10`, `hover:bg-accent`)
- Hover delete button with inline confirmation
- Auto-refreshing relative times
- "Browse all datasets..." button retained at bottom

## What We're NOT Doing

- **Rename functionality**: No backend API for FileAsset rename, CachedTable names are immutable (derived from source)
- **Changing onSelect behavior**: Currently no-op, future enhancement for data preview
- **Removing maxItems/onBrowseAll**: These are DatasetList-specific features to retain

## Implementation Approach

Mirror BoardList's implementation patterns while adapting for Dataset types (FileAsset vs CachedTable have different time fields).

---

## - [x] Phase 1: Layout & Style Update

### Overview
Update DatasetList to 2-line layout with relative time display and BoardList-consistent styling.

### Changes Required:

#### 1. DatasetList Component
**File**: `frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx`

**Changes**:
1. Add imports: `useState`, `useEffect` from React, `formatRelativeTime` from utils
2. Add `tick` state with 60-second interval for auto-refresh (same pattern as BoardList lines 18, 25-31)
3. Add helper function `getDatasetTime(dataset)` to return:
   - FileAsset: `dataset.updated_at`
   - CachedTable: `dataset.cached_at`
4. Update container: add `space-y-1 pl-0.5` classes
5. Update item styling:
   - Change from `<button>` to `<div>` with onClick (matches BoardList)
   - Apply BoardList classes: `group relative flex items-center gap-2 rounded-lg px-2.5 py-2.5 text-sm cursor-pointer transition-colors`
   - Active state: `bg-primary/10 text-primary`
   - Hover state: `hover:bg-accent`
6. Change to 2-line layout:
   - Wrap content in `<div className="flex-1 min-w-0">`
   - Name: `<p className="truncate {font-medium if active}">{name}</p>`
   - Time: `<p className="truncate text-xs text-muted-foreground">{formatRelativeTime(time)}</p>`
7. Remove Table2 icon from items (keep FolderSearch for "Browse all" button)

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors
- [ ] No console errors in browser

#### Manual Verification:
- [ ] Dataset items show 2-line layout (name + time)
- [ ] Active item has primary color styling
- [ ] Hover shows accent background
- [ ] Time updates automatically every 60 seconds
- [ ] "Browse all datasets..." button still works

---

## - [x] Phase 2: Delete Functionality

### Overview
Add hover delete button with inline confirmation UI matching BoardList.

### Changes Required:

#### 1. DatasetList Component
**File**: `frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx`

**Changes**:
1. Add TrashIcon import from lucide-react
2. Add `onDelete` prop: `onDelete?: (dataset: Dataset) => void`
3. Add `confirmingDeleteId` state for inline confirmation
4. Add delete confirmation UI (when `confirmingDeleteId === id`):
   - Red background container with "Delete this dataset?" text
   - Cancel and Delete buttons (copy pattern from BoardList lines 104-128)
5. Add hover trash button to normal item view:
   - Only show when `onDelete` prop is provided
   - `opacity-0 group-hover:opacity-100` for hover reveal
   - onClick sets `confirmingDeleteId`
   - Same styling as BoardList (lines 175-184)

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors
- [x] Component accepts optional onDelete prop

#### Manual Verification:
- [ ] Trash icon appears on hover
- [ ] Clicking trash shows inline confirmation
- [ ] Cancel returns to normal view
- [ ] Delete button triggers onDelete callback
- [ ] Confirmation UI has red styling

---

## - [x] Phase 3: Parent Integration

### Overview
Connect delete handlers in page.tsx for both FileAsset and CachedTable types.

### Changes Required:

#### 1. Page Component
**File**: `frontend/pluto_duck_frontend/app/page.tsx`

**Changes**:
1. Update DatasetList usage (around line 628-635) to include `onDelete` prop
2. Implement delete handler that:
   - Checks dataset type using `'name' in dataset` (FileAsset has `name`, CachedTable has `local_table`)
   - FileAsset: calls `deleteFileAsset(projectId, dataset.id)`
   - CachedTable: calls `dropCache(projectId, dataset.local_table)`
3. After successful delete, refresh the datasets list (likely via existing refetch mechanism)

**Note**: Imports for `deleteFileAsset` and `dropCache` may already exist or need to be added.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors
- [ ] No runtime errors when deleting

#### Manual Verification:
- [ ] Deleting a FileAsset removes it from the list
- [ ] Deleting a CachedTable removes it from the list
- [ ] List refreshes after deletion
- [ ] Error handling works (toast or similar feedback)

---

## Testing Strategy

### Manual Testing Steps:
1. Open sidebar with Datasets tab active
2. Verify dataset items show 2-line layout with name and relative time
3. Hover over a dataset item - verify trash icon appears
4. Click trash icon - verify inline confirmation appears
5. Click Cancel - verify returns to normal view
6. Click Delete - verify dataset is removed
7. Wait 60+ seconds - verify relative times update
8. Click "Browse all datasets..." - verify navigation works
9. Test with both FileAsset and CachedTable types if available

### Edge Cases:
- Empty dataset list (should show "No datasets yet" message)
- Dataset with null time field (should show "-")
- Single dataset (delete should still work)

## Performance Considerations

- 60-second interval timer is lightweight (same as BoardList)
- No additional API calls for display (time data already in dataset objects)
- Delete operations are single API calls

## References

- [BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx) - Target style reference
- [DatasetList.tsx](frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx) - Component to modify
- [page.tsx:628-635](frontend/pluto_duck_frontend/app/page.tsx#L628-L635) - DatasetList usage
- [fileAssetApi.ts:133-142](frontend/pluto_duck_frontend/lib/fileAssetApi.ts#L133-L142) - deleteFileAsset API
- [sourceApi.ts:245-252](frontend/pluto_duck_frontend/lib/sourceApi.ts#L245-L252) - dropCache API
- [utils.ts:8-28](frontend/pluto_duck_frontend/lib/utils.ts#L8-L28) - formatRelativeTime utility
- [Research document](docs/research/037_sidebar_dataset_list_style_unification.md) - Original research
