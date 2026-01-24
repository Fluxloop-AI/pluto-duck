# Sidebar Tab Slide UI Restoration

## Overview
Restore the sidebar to the previous tab slide UI design while preserving all new Dataset functionality and keeping Assets in the footer menu.

## Current State Analysis
- Sidebar uses flat menu structure with `SidebarMenuItem` (Dataset) and `SidebarSection` (Board)
- No tab-based navigation or sliding animation
- Board creation button is inside the Board section header (Plus icon)
- `DatasetList` component was deleted in commit `723be3c6`
- Dataset functionality (DatasetView, AddDatasetModal, APIs) is fully implemented

## Desired End State
```
Sidebar (w-64)
├── Header
│   ├── ProjectSelector
│   └── SquarePen Button (board creation)
├── Tab Slide UI
│   ├── Board Tab (Layers icon) - active: primary bg with slide animation
│   └── Dataset Tab (Database icon)
├── Content Area
│   ├── (boards tab) BoardList
│   └── (datasets tab) DatasetList (max 3 items + "Browse all datasets...")
└── Footer
    ├── Assets Button
    └── Settings Button
```

**Verification:**
- Tab slide animation works smoothly between Board/Dataset
- SquarePen button creates new board
- BoardList displays when Board tab active
- DatasetList displays when Dataset tab active
- "Browse all datasets..." navigates to full DatasetView
- Assets and Settings remain functional in footer

## What We're NOT Doing
- Changing the DatasetView component (full-screen view stays as-is)
- Modifying AddDatasetModal functionality
- Changing Assets or Settings behavior
- Altering the MainView type or main content area logic
- Removing SidebarMenuItem/SidebarSection components (may be used elsewhere)

## Implementation Approach
Restore the old tab slide UI pattern from merge-base commit `82453b39`, adapting it to use Dataset instead of Assets. Re-create the deleted DatasetList component for sidebar display.

---

## - [x] Phase 1: Restore DatasetList Component

### Overview
Re-create the DatasetList component that was deleted, which shows a compact list of datasets in the sidebar with a "Browse all datasets..." link.

### Changes Required:

#### 1. Create DatasetList Component
**File**: `frontend/pluto_duck_frontend/components/sidebar/DatasetList.tsx`
**Changes**: Create new file with the following structure:
- Props: `datasets`, `maxItems` (default 3), `activeId`, `onSelect`, `onBrowseAll`
- Display up to `maxItems` datasets with Table2 icon
- Show "No datasets yet" for empty state
- Include "Browse all datasets..." button with FolderSearch icon
- Match existing sidebar item styling (text-[0.8rem], pl-1.5, py-2.5)

#### 2. Export from sidebar index
**File**: `frontend/pluto_duck_frontend/components/sidebar/index.ts`
**Changes**: Add export for DatasetList component

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors: `npm run typecheck`
- [ ] Linting passes: `npm run lint`

#### Manual Verification:
- [ ] Component file exists and exports correctly

---

## - [x] Phase 2: Add Header Board Creation Button

### Overview
Add a SquarePen icon button next to the ProjectSelector for creating new boards.

### Changes Required:

#### 1. Modify Sidebar Header
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- Wrap ProjectSelector in a flex container with `justify-between`
- Add Button with SquarePen icon (h-4 w-4)
- Button styling: `variant="ghost"`, `size="icon"`, `h-8 w-8 rounded-lg hover:bg-black/10`
- Connect to existing `handleCreateBoard` function

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors
- [ ] Linting passes

#### Manual Verification:
- [ ] SquarePen button visible next to project selector
- [ ] Clicking button creates a new board

---

## - [x] Phase 3: Implement Tab Slide UI

### Overview
Create the animated tab switcher with sliding indicator between Board and Dataset tabs.

### Changes Required:

#### 1. Add Tab State
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- Add state: `sidebarTab: 'boards' | 'datasets'` (default: 'boards')
- This is separate from `mainView` - controls only sidebar content display

#### 2. Create Tab Slide Component
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**: Add tab UI below the header section with:
- Container: `relative mb-3 flex rounded-lg bg-card p-1`
- Sliding indicator: `absolute` div with `w-[calc(50%-4px)]`, `bg-primary`, `transition-all duration-200 ease-out`
- Position logic: `left-1` when boards, `left-[50%]` when datasets
- Two buttons with `relative z-10`:
  - Board tab: Layers icon + "Boards" label
  - Dataset tab: Database icon + "Datasets" label
- Active state: `text-primary-foreground`
- Inactive state: `text-muted-foreground hover:text-foreground`

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors
- [ ] Linting passes

#### Manual Verification:
- [ ] Tab UI visible below header
- [ ] Clicking tabs shows smooth sliding animation
- [ ] Active tab text is properly styled

---

## - [x] Phase 4: Update Sidebar Content Area

### Overview
Replace current SidebarMenuItem/SidebarSection with tab-dependent content display.

### Changes Required:

#### 1. Fetch Datasets for Sidebar
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- Add state for sidebar datasets list
- Fetch datasets using existing `listFileAssets` and `fetchCachedTables` APIs
- Refresh when `dataSourcesRefresh` changes

#### 2. Conditional Content Rendering
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- Remove SidebarMenuItem for Dataset
- Remove SidebarSection for Board
- Add conditional rendering based on `sidebarTab`:
  - `'boards'`: Render BoardList directly
  - `'datasets'`: Render DatasetList with onBrowseAll triggering `setMainView('datasets')`

#### 3. Wire Up DatasetList Interactions
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- onSelect: Could highlight dataset or navigate to details (TBD - may just be visual feedback)
- onBrowseAll: Call `setMainView('datasets')` and `selectBoard(null)`

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors
- [ ] Linting passes

#### Manual Verification:
- [ ] Board tab shows BoardList with all boards
- [ ] Dataset tab shows DatasetList with up to 3 datasets
- [ ] "Browse all datasets..." navigates to full DatasetView
- [ ] Board selection still works correctly
- [ ] New board creation works from header button

---

## - [x] Phase 5: Final Polish and Cleanup

### Overview
Remove unused code and ensure consistent styling.

### Changes Required:

#### 1. Review Unused Imports
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**: Remove any unused imports (SidebarMenuItem, SidebarSection if not used elsewhere)

#### 2. Verify Styling Consistency
**File**: `frontend/pluto_duck_frontend/app/page.tsx`
**Changes**:
- Ensure tab content area has proper padding matching old design
- Verify spacing between header, tabs, and content

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles without errors
- [ ] Linting passes
- [x] No unused variable warnings

#### Manual Verification:
- [ ] UI matches desired design
- [ ] All existing functionality preserved
- [ ] Smooth animations and transitions

---

## Testing Strategy

### Manual Testing Steps:
1. Open sidebar and verify SquarePen button next to project selector
2. Click SquarePen - should create new board
3. Verify Board/Dataset tab UI with sliding animation
4. Click Board tab - should show board list
5. Click Dataset tab - should show dataset list (or empty state)
6. Click "Browse all datasets..." - should navigate to DatasetView
7. Verify Assets button in footer still works
8. Verify Settings button in footer still works
9. Create a board, verify it appears in list
10. Add a dataset, verify it appears in sidebar list

## Performance Considerations
- DatasetList only fetches when component mounts or refresh triggered
- Limit sidebar display to 3 datasets to keep UI responsive
- Tab animation uses CSS transitions (no JS animation overhead)

## References
- [docs/research/035_sidebar_tab_slide_ui_restoration.md](docs/research/035_sidebar_tab_slide_ui_restoration.md) - Research document with old UI code
- [frontend/pluto_duck_frontend/app/page.tsx](frontend/pluto_duck_frontend/app/page.tsx) - Main page with sidebar
- [frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx](frontend/pluto_duck_frontend/components/datasets/DatasetView.tsx) - Full dataset view
- [frontend/pluto_duck_frontend/components/boards/BoardList.tsx](frontend/pluto_duck_frontend/components/boards/BoardList.tsx) - Board list component
- Git merge-base commit: `82453b39` - Contains original tab slide UI code
- Git commit `723be3c6` - Where DatasetList was deleted
