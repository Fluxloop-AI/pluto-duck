# Dataset Tab and MainView Synchronization Fix

## Overview

Fix the bug where clicking the Datasets tab in the sidebar shows the first dataset as selected in the list, but the main view doesn't update until the user clicks the dataset a second time.

## Current State Analysis

The `WorkspacePage` component manages three related state variables:
- `sidebarTab`: Which tab is active in the sidebar ('boards' | 'datasets')
- `selectedDataset`: The currently selected dataset object
- `mainView`: What the center area displays ('boards' | 'datasets' | 'assets')

**The Problem**: The Datasets tab click handler only updates `sidebarTab`, not `mainView`. This creates a mismatch where:
1. User clicks Datasets tab
2. Sidebar switches to show dataset list with first item highlighted
3. Main view still shows Boards (or previous view)
4. User must click a dataset again to see the DatasetDetailView

**Asymmetric Behavior**: The Boards tab correctly updates both states, but Datasets tab was implemented inconsistently.

| Tab Click | Sets `sidebarTab` | Sets `mainView` |
|-----------|-------------------|-----------------|
| Boards    | 'boards'          | 'boards'        |
| Datasets  | 'datasets'        | (none)          |

## Desired End State

When clicking the Datasets tab:
1. `sidebarTab` changes to 'datasets'
2. `mainView` changes to 'datasets'
3. If a dataset is already selected, the DatasetDetailView shows immediately
4. If no dataset is selected, the empty state with "Select a dataset" message appears

Verification: Click Datasets tab once -> main view should show dataset content (either detail view or empty state) immediately without requiring a second click.

## What We're NOT Doing

- Changing the Assets button behavior (it's a toggle, not a tab)
- Refactoring the state management pattern
- Adding new features to dataset selection

## Implementation Approach

Single-line fix: Add `setMainView('datasets')` to the Datasets tab click handler to match the Boards tab pattern.

## - [x] Phase 1: Fix Datasets Tab Handler

### Overview

Update the Datasets tab click handler to sync both sidebar tab and main view states.

### Changes Required:

#### 1. WorkspacePage Tab Handler
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**: Add `setMainView('datasets')` call to the Datasets tab onClick handler at line 623

Current code (line 621-623):
```typescript
onClick={() => setSidebarTab('datasets')}
```

Updated code:
```typescript
onClick={() => {
  setSidebarTab('datasets');
  setMainView('datasets');
}}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run typecheck`
- [x] Linting passes: `npm run lint` (skipped - not configured)
- [x] Build succeeds: `npm run build`

#### Manual Verification:
- [ ] Start on Boards tab with a board open
- [ ] Click Datasets tab once
- [ ] Main view should immediately show DatasetDetailView (if dataset selected) or empty state
- [ ] Click Boards tab, then Datasets tab again - should work consistently
- [ ] Assets button toggle still works correctly
- [ ] Clicking a specific dataset in the list still works

---

## Testing Strategy

### Manual Testing Steps:
1. Open the app with some datasets imported
2. Ensure you're on the Boards tab viewing a board
3. Click the "Datasets" tab in the sidebar
4. **Expected**: Main view immediately shows the dataset detail or empty state
5. Click "Boards" tab to switch back
6. Click "Datasets" tab again
7. **Expected**: Consistent behavior - main view updates immediately

### Edge Cases:
- No datasets in project: Should show "No datasets yet" empty state
- Dataset was previously selected: Should show that dataset's detail view
- Switching rapidly between tabs: No flickering or stuck states

## Performance Considerations

None - this is a simple state update that already happens for other tabs.

## References

- Research document: `docs/research/042_dataset_tab_mainview_sync.md`
- Main page component: `frontend/pluto_duck_frontend/app/page.tsx:621-623` (Datasets tab handler)
- Boards tab handler (reference): `frontend/pluto_duck_frontend/app/page.tsx:606-611`
- Main view rendering logic: `frontend/pluto_duck_frontend/app/page.tsx:739-778`
