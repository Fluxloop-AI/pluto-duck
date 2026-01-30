import { getBackendUrl } from './backendUrl';
import { apiJson, apiVoid } from './apiClient';

// ========== Types ==========

// ========== Tab Types ==========

export interface BoardTab {
  id: string;
  name: string;
  content: string | null; // Lexical editor JSON content
}

export interface BoardSettings {
  tabs?: BoardTab[];
  activeTabId?: string;
  // Legacy: single content field (will migrate to tabs)
  content?: string;
}

export interface Board {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  settings?: BoardSettings;
}

export interface BoardItem {
  id: string;
  board_id: string;
  item_type: 'markdown' | 'chart' | 'table' | 'metric' | 'image';
  title: string | null;
  position_x: number;
  position_y: number;
  width: number;
  height: number;
  payload: Record<string, any>;
  render_config: Record<string, any> | null;
  created_at: string;
  updated_at: string;
}

export interface BoardDetail extends Board {
  items: BoardItem[];
}

export interface QueryResult {
  columns: string[];
  data: Record<string, any>[];
  row_count: number;
  executed_at: string;
}

// ========== Board CRUD ==========

export async function fetchBoards(projectId: string): Promise<Board[]> {
  return apiJson<Board[]>(`/api/v1/boards/projects/${projectId}/boards`);
}

export async function fetchBoardDetail(boardId: string): Promise<BoardDetail> {
  return apiJson<BoardDetail>(`/api/v1/boards/${boardId}`);
}

export async function createBoard(projectId: string, data: {
  name: string;
  description?: string;
  settings?: Record<string, any>;
}): Promise<Board> {
  return apiJson<Board>(`/api/v1/boards/projects/${projectId}/boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateBoard(boardId: string, data: {
  name?: string;
  description?: string;
  settings?: Record<string, any>;
}): Promise<Board> {
  return apiJson<Board>(`/api/v1/boards/${boardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteBoard(boardId: string): Promise<void> {
  await apiVoid(`/api/v1/boards/${boardId}`, { method: 'DELETE' });
}

// ========== Board Item CRUD ==========

export async function fetchBoardItems(boardId: string): Promise<BoardItem[]> {
  return apiJson<BoardItem[]>(`/api/v1/boards/${boardId}/items`);
}

export async function createBoardItem(boardId: string, data: {
  item_type: string;
  title?: string;
  payload: Record<string, any>;
  render_config?: Record<string, any>;
  position_x?: number;
  position_y?: number;
  width?: number;
  height?: number;
}): Promise<BoardItem> {
  return apiJson<BoardItem>(`/api/v1/boards/${boardId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function updateBoardItem(itemId: string, data: {
  title?: string;
  payload?: Record<string, any>;
  render_config?: Record<string, any>;
}): Promise<BoardItem> {
  return apiJson<BoardItem>(`/api/v1/boards/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function deleteBoardItem(itemId: string): Promise<void> {
  await apiVoid(`/api/v1/boards/items/${itemId}`, { method: 'DELETE' });
}

export async function updateBoardItemPosition(itemId: string, data: {
  position_x: number;
  position_y: number;
  width: number;
  height: number;
}): Promise<BoardItem> {
  return apiJson<BoardItem>(`/api/v1/boards/items/${itemId}/position`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

// ========== Query Operations ==========

export async function createQuery(itemId: string, data: {
  query_text: string;
  data_source_tables?: string[];
  refresh_mode?: string;
  refresh_interval_seconds?: number;
}): Promise<{ query_id: string }> {
  return apiJson<{ query_id: string }>(`/api/v1/boards/items/${itemId}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export async function executeQuery(itemId: string, projectId: string): Promise<QueryResult> {
  return apiJson<QueryResult>(`/api/v1/boards/items/${itemId}/query/execute`, {
    method: 'POST',
    projectId,
    projectIdLocation: 'header',
  });
}

export async function getCachedQueryResult(itemId: string): Promise<QueryResult> {
  return apiJson<QueryResult>(`/api/v1/boards/items/${itemId}/query/result`);
}

// ========== Asset Operations ==========

export async function uploadAsset(itemId: string, file: File, projectId: string): Promise<{
  asset_id: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  url: string;
}> {
  const formData = new FormData();
  formData.append('file', file);
  return apiJson<{
    asset_id: string;
    file_name: string;
    file_size: number;
    mime_type: string;
    url: string;
  }>(`/api/v1/boards/items/${itemId}/assets/upload`, {
    method: 'POST',
    body: formData,
    projectId,
    projectIdLocation: 'header',
  });
}

export function getAssetDownloadUrl(assetId: string): string {
  return `${getBackendUrl()}/api/v1/boards/assets/${assetId}/download`;
}

export async function deleteAsset(assetId: string): Promise<void> {
  await apiVoid(`/api/v1/boards/assets/${assetId}`, { method: 'DELETE' });
}
