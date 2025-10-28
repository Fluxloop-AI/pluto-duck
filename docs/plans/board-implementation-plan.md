# Board Implementation Plan

## Overview
Implement dashboard/board functionality where users can save and organize analysis results (charts, images, markdown notes, etc.) in a project-scoped workspace. Boards display in the center panel while chat remains in the right sidebar.

**Architecture Approach:**
- **Mixed Canvas Layout**: Single board canvas that supports multiple item types (markdown, chart, table, metric, image)
- **Native Components**: Each item type is a standalone React component with specific functionality
- **Markdown Editor**: Yoopta editor for rich text notes and documentation
- **Data Widgets**: Native chart/table/metric components with query execution and refresh capabilities
- **Flexible Grid**: CSS Grid-based layout allowing items to coexist and be arranged freely

---

## 1. Backend - Data Model & Schema

### 1.1 DuckDB Schema Extensions

Add to `backend/pluto_duck_backend/app/services/chat/repository.py` DDL_STATEMENTS:

```sql
-- Boards table (project scoped)
CREATE TABLE IF NOT EXISTS boards (
    id UUID PRIMARY KEY,
    project_id UUID NOT NULL,
    name VARCHAR NOT NULL,
    description VARCHAR,
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    settings JSON,
    FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_boards_project 
ON boards(project_id, position ASC, updated_at DESC);

-- Board items (widgets/cards on a board)
CREATE TABLE IF NOT EXISTS board_items (
    id UUID PRIMARY KEY,
    board_id UUID NOT NULL,
    item_type VARCHAR NOT NULL,  -- 'markdown', 'chart', 'image', 'table', 'metric'
    title VARCHAR,
    position_x INTEGER DEFAULT 0,
    position_y INTEGER DEFAULT 0,
    width INTEGER DEFAULT 1,
    height INTEGER DEFAULT 1,
    payload JSON NOT NULL,
    render_config JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_items_board 
ON board_items(board_id, position_y, position_x);

-- Query definitions for chart items
CREATE TABLE IF NOT EXISTS board_queries (
    id UUID PRIMARY KEY,
    board_item_id UUID NOT NULL,
    query_text VARCHAR NOT NULL,
    data_source_tables JSON,  -- Array of table names referenced
    refresh_mode VARCHAR DEFAULT 'manual',  -- 'manual', 'interval', 'realtime'
    refresh_interval_seconds INTEGER,
    last_executed_at TIMESTAMP,
    last_result_snapshot JSON,
    last_result_rows INTEGER,
    execution_status VARCHAR DEFAULT 'pending',  -- 'pending', 'success', 'error'
    error_message VARCHAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (board_item_id) REFERENCES board_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_queries_item 
ON board_queries(board_item_id);

-- Asset storage for images (file binaries stored on filesystem/S3, only paths in DB)
CREATE TABLE IF NOT EXISTS board_item_assets (
    id UUID PRIMARY KEY,
    board_item_id UUID NOT NULL,
    asset_type VARCHAR NOT NULL,  -- 'image', 'attachment'
    file_name VARCHAR NOT NULL,
    file_path VARCHAR NOT NULL,  -- Local filesystem path or S3 URL (NOT binary data)
    file_size INTEGER,
    mime_type VARCHAR,
    thumbnail_path VARCHAR,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (board_item_id) REFERENCES board_items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assets_item 
ON board_item_assets(board_item_id);
```

### 1.2 Item Type Definitions

**Board Item Types:**
- `markdown`: Rich text notes and documentation (Yoopta editor for text, headings, lists, code blocks, etc.)
- `chart`: Interactive data visualizations with query execution and refresh (Recharts/ECharts)
- `table`: Tabular data view with query execution and filtering
- `metric`: Single KPI display with comparison and formatting
- `image`: Uploaded images, screenshots, or diagram references

**Note:** File attachments are excluded from MVP. Images within Yoopta markdown are stored as assets with URLs.

**Payload Schema by Type:**

```python
# markdown - Yoopta editor content (JSON structure)
{
    "content": {
        # Yoopta/Slate document JSON structure
        # Includes text, headings, lists, code, images (as URLs), etc.
    },
    "version": "1.0"
}

# chart - Interactive visualization with query
{
    "query_id": "uuid",  # References board_queries table
    "chart_type": "bar|line|pie|scatter|area|composed",
    "chart_library": "recharts",  # Primary: recharts, Secondary: echarts for advanced
    "chart_config": {
        "x_axis": "column_name",
        "y_axis": ["column_name"],
        "series": [...],  # Multiple series support
        "colors": ["#8884d8", "#82ca9d"],
        "legend": true,
        "tooltip": true
    },
    "aggregation": "sum|avg|count|max|min|none"
}

# table - Tabular data display with query
{
    "query_id": "uuid",
    "columns": ["col1", "col2"],  # Column selection/ordering
    "filters": {...},  # Frontend filters
    "sort": {"column": "col1", "direction": "asc|desc"},
    "pagination": {"page_size": 50, "current_page": 1}
}

# metric - KPI card with single value
{
    "query_id": "uuid",
    "metric_name": "Total Revenue",
    "value_column": "revenue",
    "aggregation": "sum|avg|count|max|min",
    "format": "currency|number|percent|decimal",
    "decimal_places": 2,
    "prefix": "$",  # Optional
    "suffix": "",   # Optional
    "comparison": {  # Optional trend comparison
        "type": "previous_period|target|none",
        "value": 1000,
        "show_percentage": true
    }
}

# image - Uploaded image or screenshot
{
    "asset_id": "uuid",  # References board_item_assets
    "alt_text": "description",
    "caption": "optional caption",
    "fit": "cover|contain|fill"  # Display mode
}
```

---

## 2. Backend - Service Layer

### 2.1 Repository Pattern

**File:** `backend/pluto_duck_backend/app/services/boards/repository.py`

```python
@dataclass
class Board:
    id: str
    project_id: str
    name: str
    description: Optional[str]
    position: int
    created_at: datetime
    updated_at: datetime
    settings: Dict[str, Any]

@dataclass
class BoardItem:
    id: str
    board_id: str
    item_type: str
    title: Optional[str]
    position_x: int
    position_y: int
    width: int
    height: int
    payload: Dict[str, Any]
    render_config: Optional[Dict[str, Any]]
    created_at: datetime
    updated_at: datetime

@dataclass
class BoardQuery:
    id: str
    board_item_id: str
    query_text: str
    data_source_tables: List[str]
    refresh_mode: str
    refresh_interval_seconds: Optional[int]
    last_executed_at: Optional[datetime]
    last_result_snapshot: Optional[Dict[str, Any]]
    last_result_rows: Optional[int]
    execution_status: str
    error_message: Optional[str]

class BoardsRepository:
    def __init__(self, warehouse_path: Path):
        self.warehouse_path = warehouse_path
    
    # Board CRUD
    def create_board(self, project_id: str, name: str, description: Optional[str] = None) -> str
    def get_board(self, board_id: str) -> Optional[Board]
    def list_boards(self, project_id: str) -> List[Board]
    def update_board(self, board_id: str, **updates) -> bool
    def delete_board(self, board_id: str) -> bool
    def reorder_boards(self, project_id: str, board_positions: List[tuple[str, int]]) -> bool
    
    # Item CRUD
    def create_item(self, board_id: str, item_type: str, payload: Dict, **kwargs) -> str
    def get_item(self, item_id: str) -> Optional[BoardItem]
    def list_items(self, board_id: str) -> List[BoardItem]
    def update_item(self, item_id: str, **updates) -> bool
    def delete_item(self, item_id: str) -> bool
    def update_item_position(self, item_id: str, x: int, y: int, width: int, height: int) -> bool
    
    # Query CRUD
    def create_query(self, item_id: str, query_text: str, refresh_mode: str = 'manual') -> str
    def get_query(self, query_id: str) -> Optional[BoardQuery]
    def get_query_by_item(self, item_id: str) -> Optional[BoardQuery]
    def update_query(self, query_id: str, **updates) -> bool
    def update_query_result(self, query_id: str, result: Dict, rows: int, status: str) -> bool
    
    # Asset CRUD
    def create_asset(self, item_id: str, asset_type: str, file_name: str, file_path: str, **kwargs) -> str
    def get_asset(self, asset_id: str) -> Optional[Dict]
    def list_assets(self, item_id: str) -> List[Dict]
    def delete_asset(self, asset_id: str) -> bool
```

### 2.2 Service Layer

**File:** `backend/pluto_duck_backend/app/services/boards/service.py`

```python
class BoardsService:
    def __init__(self, repository: BoardsRepository):
        self.repo = repository
    
    async def execute_query(self, query_id: str, project_id: str) -> Dict[str, Any]:
        """
        Execute stored query, enforce project scope, cache results
        """
        query = self.repo.get_query(query_id)
        if not query:
            raise ValueError("Query not found")
        
        # Verify board ownership
        item = self.repo.get_item(query.board_item_id)
        board = self.repo.get_board(item.board_id)
        if board.project_id != project_id:
            raise PermissionError("Query does not belong to this project")
        
        # Execute against DuckDB
        try:
            with duckdb.connect(warehouse_path) as con:
                result = con.execute(query.query_text).fetchall()
                columns = [desc[0] for desc in con.description]
            
            snapshot = {
                "columns": columns,
                "data": [dict(zip(columns, row)) for row in result],
                "row_count": len(result),
                "executed_at": datetime.now(UTC).isoformat()
            }
            
            self.repo.update_query_result(
                query_id, 
                snapshot, 
                len(result), 
                "success"
            )
            
            return snapshot
        except Exception as e:
            self.repo.update_query_result(
                query_id,
                None,
                0,
                "error"
            )
            raise
    
    async def upload_asset(self, item_id: str, file: UploadFile) -> str:
        """
        Handle image upload, store to filesystem/S3 (NOT in DB as binary)
        Returns asset_id and URL for embedding in item payload
        """
        # Validate file type (images only for MVP)
        if not file.content_type.startswith('image/'):
            raise ValueError("Only image uploads are supported")
        
        # Generate unique filename
        file_ext = Path(file.filename).suffix
        unique_name = f"{uuid4()}{file_ext}"
        
        # Storage path (configurable via settings)
        # Example: /app/storage/assets/abc123.png
        storage_path = Path(settings.asset_storage_path) / unique_name
        storage_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Save file to disk (binary data stored here, NOT in DB)
        async with aiofiles.open(storage_path, 'wb') as f:
            content = await file.read()
            await f.write(content)
        
        # Create asset record (only metadata in DB)
        asset_id = self.repo.create_asset(
            item_id=item_id,
            asset_type='image',
            file_name=file.filename,
            file_path=str(storage_path),  # Path only, not binary
            file_size=len(content),
            mime_type=file.content_type
        )
        
        return asset_id
```

---

## 3. Backend - API Routes

### 3.1 Board Endpoints

**File:** `backend/pluto_duck_backend/app/api/v1/boards/router.py`

```python
router = APIRouter(prefix="/boards", tags=["boards"])

# Board CRUD
@router.get("/projects/{project_id}/boards", response_model=List[BoardResponse])
def list_boards(project_id: str, repo: BoardsRepository = Depends(get_boards_repo))

@router.post("/projects/{project_id}/boards", response_model=BoardResponse)
def create_board(project_id: str, payload: CreateBoardRequest, repo: ...)

@router.get("/{board_id}", response_model=BoardDetailResponse)
def get_board(board_id: str, repo: ...)

@router.patch("/{board_id}", response_model=BoardResponse)
def update_board(board_id: str, payload: UpdateBoardRequest, repo: ...)

@router.delete("/{board_id}", status_code=204)
def delete_board(board_id: str, repo: ...)

@router.post("/projects/{project_id}/boards/reorder")
def reorder_boards(project_id: str, payload: ReorderBoardsRequest, repo: ...)

# Item CRUD
@router.get("/{board_id}/items", response_model=List[BoardItemResponse])
def list_items(board_id: str, repo: ...)

@router.post("/{board_id}/items", response_model=BoardItemResponse)
def create_item(board_id: str, payload: CreateItemRequest, repo: ...)

@router.patch("/items/{item_id}", response_model=BoardItemResponse)
def update_item(item_id: str, payload: UpdateItemRequest, repo: ...)

@router.delete("/items/{item_id}", status_code=204)
def delete_item(item_id: str, repo: ...)

@router.post("/items/{item_id}/position")
def update_item_position(item_id: str, payload: UpdatePositionRequest, repo: ...)

# Query execution
@router.post("/items/{item_id}/query/execute", response_model=QueryResultResponse)
async def execute_query(
    item_id: str, 
    project_id: str = Header(...),
    service: BoardsService = Depends(get_boards_service)
)

@router.get("/items/{item_id}/query/result", response_model=QueryResultResponse)
def get_cached_result(item_id: str, repo: ...)

# Asset management
@router.post("/items/{item_id}/assets/upload", response_model=AssetResponse)
async def upload_asset(
    item_id: str,
    file: UploadFile,
    service: BoardsService = Depends(...)
)

@router.get("/assets/{asset_id}/download")
async def download_asset(asset_id: str, repo: ...)

@router.delete("/assets/{asset_id}", status_code=204)
def delete_asset(asset_id: str, repo: ...)
```

### 3.2 Request/Response Models

```python
class CreateBoardRequest(BaseModel):
    name: str
    description: Optional[str] = None
    settings: Optional[Dict[str, Any]] = None

class BoardResponse(BaseModel):
    id: str
    project_id: str
    name: str
    description: Optional[str]
    position: int
    created_at: str
    updated_at: str
    item_count: int = 0

class BoardDetailResponse(BoardResponse):
    items: List[BoardItemResponse]

class CreateItemRequest(BaseModel):
    item_type: str  # 'markdown', 'chart', 'image', etc.
    title: Optional[str]
    payload: Dict[str, Any]
    render_config: Optional[Dict[str, Any]] = None
    position_x: int = 0
    position_y: int = 0
    width: int = 1
    height: int = 1

class BoardItemResponse(BaseModel):
    id: str
    board_id: str
    item_type: str
    title: Optional[str]
    position_x: int
    position_y: int
    width: int
    height: int
    payload: Dict[str, Any]
    render_config: Optional[Dict[str, Any]]
    created_at: str
    updated_at: str
    query: Optional[QueryInfo] = None  # If item_type supports queries

class QueryResultResponse(BaseModel):
    columns: List[str]
    data: List[Dict[str, Any]]
    row_count: int
    executed_at: str
    execution_status: str
    error_message: Optional[str] = None
```

---

## 4. Frontend - Component Structure

### 4.1 Directory Layout

```
frontend/pluto_duck_frontend/
├── components/
│   └── boards/
│       ├── index.ts
│       ├── BoardsView.tsx           # Main container (orchestrates tabs + canvas)
│       ├── BoardTabs.tsx            # Tab navigation for multiple boards
│       ├── BoardCanvas.tsx          # Mixed grid layout - renders all item types
│       ├── BoardToolbar.tsx         # Top actions (add item, settings, export)
│       ├── items/
│       │   ├── ItemCard.tsx         # Common wrapper with drag/resize/menu
│       │   ├── MarkdownItem.tsx     # Yoopta editor for rich text notes
│       │   ├── ChartItem.tsx        # Recharts/ECharts with query + refresh
│       │   ├── TableItem.tsx        # Data table with query + pagination
│       │   ├── MetricItem.tsx       # KPI card with trend indicator
│       │   └── ImageItem.tsx        # Image display from assets
│       └── modals/
│           ├── CreateBoardModal.tsx
│           ├── AddItemModal.tsx      # Select item type to add
│           ├── QueryEditorModal.tsx  # SQL editor for chart/table/metric
│           ├── ChartConfigModal.tsx  # Chart type, axes, styling
│           └── ImageUploadModal.tsx  # Image upload UI
├── hooks/
│   ├── useBoards.ts                 # Board CRUD + tab management
│   ├── useBoardItems.ts             # Item CRUD + position updates
│   └── useBoardQuery.ts             # Query execution, caching, refresh
└── lib/
    ├── boardsApi.ts                  # REST API client
    └── chartHelpers.ts               # Chart config generators
```

### 4.2 Main Components

**BoardsView.tsx**
```tsx
export function BoardsView({ projectId }: { projectId: string }) {
  const { boards, activeBoard, setActiveBoard, createBoard, deleteBoard } = useBoards(projectId);
  const { items, addItem, updateItem, deleteItem } = useBoardItems(activeBoard?.id);
  
  return (
    <div className="flex h-full flex-col">
      <BoardToolbar 
        board={activeBoard}
        onAddItem={handleAddItem}
        onSettings={handleSettings}
      />
      
      <BoardTabs
        boards={boards}
        activeId={activeBoard?.id}
        onSelect={setActiveBoard}
        onNew={createBoard}
        onDelete={deleteBoard}
      />
      
      <BoardCanvas
        items={items}
        onItemUpdate={updateItem}
        onItemDelete={deleteItem}
      />
    </div>
  );
}
```

**BoardCanvas.tsx** - Mixed item type layout
```tsx
// Grid-based layout supporting all item types on same canvas
export function BoardCanvas({ items, onItemUpdate, onItemDelete }) {
  return (
    <div className="flex-1 overflow-auto p-6 bg-muted/5">
      <div className="grid grid-cols-12 gap-4 auto-rows-min">
        {items.map(item => (
          <ItemCard
            key={item.id}
            item={item}
            onUpdate={onItemUpdate}
            onDelete={onItemDelete}
            // Grid span based on item width
            gridColumn={`span ${item.width}`}
          >
            {renderItem(item)}
          </ItemCard>
        ))}
        
        {/* Empty state when no items */}
        {items.length === 0 && (
          <div className="col-span-12 flex items-center justify-center py-12">
            <div className="text-center text-muted-foreground">
              <p>No items yet. Click "Add Item" to get started.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Render appropriate component based on item type
function renderItem(item: BoardItem) {
  switch (item.item_type) {
    case 'markdown':
      return <MarkdownItem item={item} />;  // Yoopta editor
    case 'chart':
      return <ChartItem item={item} />;     // Recharts/ECharts
    case 'table':
      return <TableItem item={item} />;     // Data table
    case 'metric':
      return <MetricItem item={item} />;    // KPI card
    case 'image':
      return <ImageItem item={item} />;     // Image display
    default:
      return <div className="text-destructive">Unknown item type: {item.item_type}</div>;
  }
}
```

**Example Board Layout:**
```tsx
// Sample board with mixed content
Board "Q4 Sales Dashboard"
┌─────────────────────────────────────────────────┐
│ [Markdown - span 12] Executive Summary         │
│ "Sales increased 15% QoQ driven by..."         │
└─────────────────────────────────────────────────┘
┌──────────────────────────┬──────────────────────┐
│ [Chart - span 6]         │ [Metric - span 3]    │
│ Monthly Revenue Trend    │ Total Revenue        │
│ (Recharts Line Chart)    │ $1.2M ↑15%          │
├──────────────────────────┼──────────────────────┤
│ [Table - span 9]         │ [Metric - span 3]    │
│ Top 10 Products          │ Avg Order Value      │
│ (Query results)          │ $450 ↑8%            │
└──────────────────────────┴──────────────────────┘
┌─────────────────────────────────────────────────┐
│ [Image - span 6] Screenshot of funnel analysis  │
└─────────────────────────────────────────────────┘
```

**ChartItem.tsx**
```tsx
export function ChartItem({ item }: { item: BoardItem }) {
  const { data, loading, error, refresh } = useBoardQuery(item.payload.query_id);
  
  // Chart rendering with ECharts or Recharts
  const chartConfig = useMemo(() => {
    return generateChartConfig(data, item.payload.chart_config);
  }, [data, item.payload]);
  
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">{item.title}</h3>
        <button onClick={refresh} disabled={loading}>
          <RefreshIcon className={loading ? 'animate-spin' : ''} />
        </button>
      </div>
      
      {error && <ErrorDisplay error={error} />}
      {loading && <Loader />}
      {data && <ReactECharts option={chartConfig} />}
    </div>
  );
}
```

**MarkdownItem.tsx** - Yoopta editor for rich text
```tsx
'use client';
import dynamic from 'next/dynamic';
import { useState, useCallback } from 'react';
import { useBoardItems } from '@/hooks/useBoardItems';
import Paragraph from '@yoopta/paragraph';
import Heading from '@yoopta/headings';
import Blockquote from '@yoopta/blockquote';
import Code from '@yoopta/code';
import YooptaImage from '@yoopta/image';
import { debounce } from '@/lib/utils';

// Dynamic import to avoid SSR issues
const YooptaEditor = dynamic(() => import('@yoopta/editor'), { ssr: false });

export function MarkdownItem({ item }: { item: BoardItem }) {
  const [value, setValue] = useState(item.payload.content);
  const { updateItem } = useBoardItems();
  
  // Debounced save to DB (500ms)
  const debouncedSave = useCallback(
    debounce((itemId: string, payload: any) => {
      void updateItem(itemId, { payload });
    }, 500),
    []
  );
  
  const handleChange = useCallback((newValue) => {
    setValue(newValue);
    debouncedSave(item.id, { content: newValue });
  }, [item.id, debouncedSave]);
  
  // Image upload handler for Yoopta image plugin
  const handleImageUpload = useCallback(async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    
    // Upload to assets API
    const response = await fetch(`/api/v1/boards/items/${item.id}/assets/upload`, {
      method: 'POST',
      body: formData,
    });
    const { asset_id, url } = await response.json();
    
    // Return URL for Yoopta to embed
    return { src: url, alt: file.name };
  }, [item.id]);
  
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <YooptaEditor
        value={value}
        onChange={handleChange}
        placeholder="Start writing..."
        plugins={[
          Paragraph,
          Heading,
          Blockquote,
          Code,
          YooptaImage.extend({
            options: {
              onUpload: handleImageUpload,
            }
          }),
        ]}
      />
    </div>
  );
}
```

### 4.3 Hooks

**useBoards.ts**
```tsx
export function useBoards(projectId: string) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [activeBoard, setActiveBoard] = useState<Board | null>(null);
  
  const loadBoards = useCallback(async () => {
    const data = await fetchBoards(projectId);
    setBoards(data);
    if (!activeBoard && data.length > 0) {
      setActiveBoard(data[0]);
    }
  }, [projectId]);
  
  const createBoard = useCallback(async (name: string) => {
    const newBoard = await createBoardApi(projectId, { name });
    setBoards(prev => [...prev, newBoard]);
    setActiveBoard(newBoard);
  }, [projectId]);
  
  const deleteBoard = useCallback(async (boardId: string) => {
    await deleteBoardApi(boardId);
    setBoards(prev => prev.filter(b => b.id !== boardId));
    if (activeBoard?.id === boardId) {
      setActiveBoard(boards[0] || null);
    }
  }, [activeBoard, boards]);
  
  useEffect(() => {
    if (projectId) {
      void loadBoards();
    }
  }, [projectId, loadBoards]);
  
  return { boards, activeBoard, setActiveBoard, createBoard, deleteBoard, loadBoards };
}
```

**useBoardQuery.ts**
```tsx
export function useBoardQuery(queryId?: string) {
  const [data, setData] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const executeQuery = useCallback(async (itemId: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await executeQueryApi(itemId);
      setData(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  
  const refresh = useCallback(() => {
    if (queryId) {
      void executeQuery(queryId);
    }
  }, [queryId, executeQuery]);
  
  // Auto-fetch cached result on mount
  useEffect(() => {
    if (queryId) {
      void getCachedResult(queryId).then(setData);
    }
  }, [queryId]);
  
  return { data, loading, error, refresh, executeQuery };
}
```

---

## 5. Integration Points

### 5.1 Chat → Board Flow
When user receives analysis results in chat:
1. Add "Save to Board" button in assistant message actions
2. Open modal to:
   - Select target board (or create new)
   - Choose item type (auto-detect from response: chart/table/markdown)
   - Preview and edit before saving
3. Create board item with payload from chat response:
   - SQL results → Chart or Table item
   - Text analysis → Markdown item
   - Store reference to original chat message in metadata

### 5.2 Board → Chat Flow
When user clicks "Edit Query" or "View Context" on board item:
1. Find related chat conversation (via metadata link)
2. Open chat panel with that conversation
3. Highlight original message that created the item
4. Allow re-running query with modifications
5. Option to update board item with new results

### 5.3 Mixed Canvas Benefits
**Single unified workspace:**
- Markdown for narrative context ("Why did sales increase?")
- Charts for visual insights (trend lines, comparisons)
- Tables for detailed data inspection
- Metrics for at-a-glance KPIs
- Images for screenshots, diagrams, or reference materials

**Example use case:**
```
1. Run query in chat: "Show monthly revenue trends"
2. Review results in chat panel
3. Click "Save to Board" → Creates Chart item
4. Switch to board, add Markdown item above chart
5. Write analysis: "Revenue grew 15% due to..."
6. Add Metric item showing total YoY growth
7. Add Table item with top products breakdown
→ Complete dashboard with context + data
```

### 5.4 Project Context
- Always pass current `project_id` in API requests
- Filter boards/items by project scope
- Share data sources across boards in same project
- Conversations and boards both belong to same project (never cross-project)

---

## 6. Implementation Phases

### Phase 1: Foundation (Backend)
- [ ] Extend DuckDB schema with board tables
- [ ] Implement BoardsRepository (CRUD)
- [ ] Create basic API routes (boards, items)
- [ ] Add project ID validation middleware

### Phase 2: Query Execution
- [ ] Implement query execution service
- [ ] Add result caching mechanism
- [ ] Create refresh scheduling (manual first)
- [ ] Build query editor modal

### Phase 3: Frontend Core
- [ ] Build BoardsView layout
- [ ] Implement BoardTabs navigation
- [ ] Create BoardCanvas grid system
- [ ] Add ItemCard wrapper component

### Phase 4: Item Types (Mixed Canvas)
- [ ] ItemCard wrapper component (common actions, styling)
- [ ] Markdown item with Yoopta integration
  - [ ] Text editing with autosave
  - [ ] Image upload integration
  - [ ] Code blocks, headings, lists
- [ ] Chart item with Recharts
  - [ ] Query execution & caching
  - [ ] Refresh button
  - [ ] Chart type selector (bar, line, area, pie)
  - [ ] Axis configuration
- [ ] Table item with pagination
  - [ ] Query execution
  - [ ] Column sorting
  - [ ] Frontend filtering
- [ ] Metric KPI card
  - [ ] Large number display
  - [ ] Trend indicator (↑↓)
  - [ ] Comparison value
- [ ] Image item
  - [ ] Upload modal
  - [ ] Asset storage integration
  - [ ] Caption/alt text

### Phase 5: Advanced Features
- [ ] Drag-and-drop layout
- [ ] Item resize functionality
- [ ] Auto-refresh intervals
- [ ] Export board as PDF/image
- [ ] Board templates

### Phase 6: Polish
- [ ] Add loading states & skeletons
- [ ] Error boundaries
- [ ] Optimistic updates
- [ ] Keyboard shortcuts
- [ ] Mobile responsive layout

---

## 7. Open Questions & Decisions

### 7.1 Chart Library
**Primary: Recharts**
- React-native, declarative API
- Smaller bundle size (~100KB gzipped)
- Supports: Bar, Line, Area, Pie, Scatter, Composed charts
- Easy to style with Tailwind/CSS
- Good TypeScript support

**Secondary: ECharts (future)**
- For advanced visualizations (3D, heatmaps, graph networks)
- Larger bundle (~300KB gzipped)
- More configuration options
- Can be added later without changing data model

**Decision:** 
- MVP uses Recharts exclusively
- Chart config stored in generic JSON format
- Can add ECharts support by checking `chart_library` field in payload

### 7.2 Layout System
**Options:**
- CSS Grid (12-column, fixed rows)
- React Grid Layout (free-form drag/drop)
- Custom grid with snap-to

**Decision:** CSS Grid initially, migrate to React Grid Layout in Phase 5

### 7.3 Storage for Assets
**Decision: File Path Storage (NOT binary in DB)**

**How it works:**
1. User uploads image via API
2. Binary file saved to: `/app/storage/assets/{uuid}.{ext}`
3. Database stores: `file_path`, `file_name`, `file_size`, `mime_type`
4. Frontend requests: `GET /api/v1/boards/assets/{asset_id}/download`
5. Backend serves file from filesystem

**Storage options:**
- **MVP**: Local filesystem (`/app/storage/assets/`)
- **Production**: S3-compatible storage (configurable via `settings.asset_storage_path`)
- **NOT used**: Database BLOB storage (performance issues)

**Migration path:**
- Start with local storage
- Add S3 configuration in settings
- Update `file_path` format: `s3://bucket/key` vs `/local/path`
- Asset upload/download logic handles both

### 7.4 Query Caching Strategy
- Cache in `board_queries.last_result_snapshot`
- TTL based on `refresh_interval_seconds`
- Manual invalidation via refresh button
- Clear cache on query text change

### 7.5 Permissions Model
**For now:**
- Project-level access (all users in project see all boards)

**Future:**
- Board-level permissions (viewer/editor/owner)
- Item-level sharing
- Public board URLs

---

## 8. Dependencies

### Backend
```
# requirements.txt additions
aiofiles>=23.0.0  # For async file uploads
```

### Frontend
```json
// package.json additions
{
  "@yoopta/editor": "^4.9.0",
  "@yoopta/paragraph": "^4.9.0",
  "@yoopta/headings": "^4.9.0",
  "@yoopta/blockquote": "^4.9.0",
  "@yoopta/code": "^4.9.0",
  "@yoopta/image": "^4.9.0",
  "recharts": "^2.10.0",
  "echarts": "^5.5.0",
  "echarts-for-react": "^3.0.2",
  "react-grid-layout": "^1.4.4"
}
```

---

## 9. Testing Strategy

### Backend Tests
- Repository CRUD operations
- Query execution with mock data
- Project isolation validation
- Asset upload/download

### Frontend Tests
- Board tab navigation
- Item CRUD operations
- Query refresh flow
- Error handling

### Integration Tests
- Full board creation flow
- Chat → Board save flow
- Query execution → Chart rendering
- Multi-board switching

---

## Next Steps
1. ✅ Review and approve schema design (completed)
2. ✅ Confirm mixed canvas architecture approach (completed)
3. ✅ Decide on chart library (Recharts primary)
4. ✅ Clarify asset storage strategy (file paths, not binary)
5. Start Phase 1 implementation:
   - [ ] Extend DuckDB schema in `repository.py`
   - [ ] Create `BoardsRepository` class
   - [ ] Build basic API routes
   - [ ] Test board/item CRUD operations
6. Prepare for Phase 3 (Frontend):
   - [ ] Install dependencies (Yoopta, Recharts)
   - [ ] Create component directory structure
   - [ ] Build BoardsView container
   - [ ] Implement BoardCanvas with grid layout

## Architecture Summary

**Board Structure:**
```
Project
└── Boards (multiple tabs)
    └── Board Items (mixed canvas)
        ├── Markdown (Yoopta editor)
        ├── Chart (Recharts + query)
        ├── Table (data grid + query)
        ├── Metric (KPI card + query)
        └── Image (uploaded assets)
```

**Data Flow:**
```
Chat → "Save to Board" → Create Item → Board Canvas
                                          ↓
Board Item → Query Execution → DuckDB → Results Cache
                                          ↓
                                      Recharts Render
```

**Storage:**
- **Text/Config**: JSON in DuckDB (`boards`, `board_items`, `board_queries`)
- **Images**: Filesystem/S3 (path in `board_item_assets`)
- **Query Results**: Cached JSON in `board_queries.last_result_snapshot`

