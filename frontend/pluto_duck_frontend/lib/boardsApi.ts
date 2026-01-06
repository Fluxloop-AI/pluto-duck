import { getBackendUrl } from './api';

// ========== Types ==========

export interface Board {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  settings?: Record<string, any>; // Added settings field
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
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/projects/${projectId}/boards`);
  if (!response.ok) {
    throw new Error('Failed to fetch boards');
  }
  return response.json();
}

export async function fetchBoardDetail(boardId: string): Promise<BoardDetail> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/${boardId}`);
  if (!response.ok) {
    throw new Error('Failed to fetch board detail');
  }
  return response.json();
}

export async function createBoard(projectId: string, data: {
  name: string;
  description?: string;
  settings?: Record<string, any>;
}): Promise<Board> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/projects/${projectId}/boards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to create board');
  }
  return response.json();
}

export async function updateBoard(boardId: string, data: {
  name?: string;
  description?: string;
  settings?: Record<string, any>;
}): Promise<Board> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/${boardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to update board');
  }
  return response.json();
}

export async function deleteBoard(boardId: string): Promise<void> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/${boardId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete board');
  }
}

// ========== Board Item CRUD ==========

export async function fetchBoardItems(boardId: string): Promise<BoardItem[]> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/${boardId}/items`);
  if (!response.ok) {
    throw new Error('Failed to fetch board items');
  }
  return response.json();
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
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/${boardId}/items`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to create board item');
  }
  return response.json();
}

export async function updateBoardItem(itemId: string, data: {
  title?: string;
  payload?: Record<string, any>;
  render_config?: Record<string, any>;
}): Promise<BoardItem> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to update board item');
  }
  return response.json();
}

export async function deleteBoardItem(itemId: string): Promise<void> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/items/${itemId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete board item');
  }
}

export async function updateBoardItemPosition(itemId: string, data: {
  position_x: number;
  position_y: number;
  width: number;
  height: number;
}): Promise<BoardItem> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/items/${itemId}/position`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to update item position');
  }
  return response.json();
}

// ========== Query Operations ==========

export async function createQuery(itemId: string, data: {
  query_text: string;
  data_source_tables?: string[];
  refresh_mode?: string;
  refresh_interval_seconds?: number;
}): Promise<{ query_id: string }> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/items/${itemId}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to create query');
  }
  return response.json();
}

export async function executeQuery(itemId: string, projectId: string): Promise<QueryResult> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/items/${itemId}/query/execute`, {
    method: 'POST',
    headers: {
      'X-Project-ID': projectId,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to execute query');
  }
  return response.json();
}

export async function getCachedQueryResult(itemId: string): Promise<QueryResult> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/items/${itemId}/query/result`);
  if (!response.ok) {
    throw new Error('Failed to get cached result');
  }
  return response.json();
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

  const response = await fetch(`${getBackendUrl()}/api/v1/boards/items/${itemId}/assets/upload`, {
    method: 'POST',
    headers: {
      'X-Project-ID': projectId,
    },
    body: formData,
  });
  if (!response.ok) {
    throw new Error('Failed to upload asset');
  }
  return response.json();
}

export function getAssetDownloadUrl(assetId: string): string {
  return `${getBackendUrl()}/api/v1/boards/assets/${assetId}/download`;
}

export async function deleteAsset(assetId: string): Promise<void> {
  const response = await fetch(`${getBackendUrl()}/api/v1/boards/assets/${assetId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete asset');
  }
}
