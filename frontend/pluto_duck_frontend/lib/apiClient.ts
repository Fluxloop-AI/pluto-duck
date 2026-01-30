import { getBackendUrl } from './api';

// Usage: apiJson('/api/v1/projects'), apiVoid('/api/v1/boards', { method: 'DELETE' })
export type ResponseType = 'json' | 'text' | 'blob' | 'none';
export type ProjectIdLocation = 'query' | 'header' | 'none';

export interface ApiFetchOptions extends RequestInit {
  responseType?: ResponseType; // default: 'json'
  projectId?: string;
  projectIdLocation?: ProjectIdLocation; // default: 'query'
  headers?: HeadersInit;
}

export type ApiValidationItem = {
  loc: Array<string | number>;
  msg: string;
  type: string;
  [key: string]: unknown;
};

export type ApiErrorDetail =
  | string
  | ApiValidationItem[]
  | Record<string, unknown>
  | null;

export type ApiErrorKind = 'http' | 'validation' | 'network' | 'unknown';

export interface ApiError extends Error {
  name: 'ApiError';
  kind: ApiErrorKind;
  status?: number;
  detail?: ApiErrorDetail;
  message: string;
  url?: string;
  method?: string;
  raw?: unknown;
}

type ApiErrorParams = {
  kind: ApiErrorKind;
  status?: number;
  detail?: ApiErrorDetail;
  message: string;
  url?: string;
  method?: string;
  raw?: unknown;
};

class ApiErrorImpl extends Error implements ApiError {
  name: 'ApiError' = 'ApiError';
  kind: ApiErrorKind;
  status?: number;
  detail?: ApiErrorDetail;
  url?: string;
  method?: string;
  raw?: unknown;

  constructor(params: ApiErrorParams) {
    super(params.message);
    this.kind = params.kind;
    this.status = params.status;
    this.detail = params.detail;
    this.url = params.url;
    this.method = params.method;
    this.raw = params.raw;
  }
}

function isApiError(error: unknown): error is ApiError {
  return typeof error === 'object' && error !== null && (error as ApiError).name === 'ApiError';
}

function resolveApiErrorMessage(
  kind: ApiErrorKind,
  detail?: ApiErrorDetail,
  status?: number
): string {
  if (kind === 'network') {
    return 'Network error';
  }
  if (typeof detail === 'string' && detail.trim().length > 0) {
    return detail;
  }
  if (kind === 'unknown') {
    return 'Unknown error';
  }
  if (typeof status === 'number') {
    return `Request failed: ${status}`;
  }
  return 'Unknown error';
}

function buildApiError(params: Omit<ApiErrorParams, 'message'> & { message?: string }): ApiError {
  const message = params.message ?? resolveApiErrorMessage(params.kind, params.detail, params.status);
  return new ApiErrorImpl({ ...params, message });
}

function buildRequestUrl(path: string, projectId?: string, projectIdLocation?: ProjectIdLocation): URL {
  const url = new URL(path, getBackendUrl());
  if (projectId && (projectIdLocation ?? 'query') === 'query') {
    url.searchParams.set('project_id', projectId);
  }
  return url;
}

function buildHeaders(
  headersInit: HeadersInit | undefined,
  projectId?: string,
  projectIdLocation?: ProjectIdLocation
): Headers {
  const headers = new Headers(headersInit);
  if (projectId && (projectIdLocation ?? 'query') === 'header') {
    headers.set('X-Project-ID', projectId);
  }
  return headers;
}

async function parseErrorResponse(
  response: Response,
  url: string,
  method: string
): Promise<ApiError> {
  let detail: ApiErrorDetail | undefined;
  let raw: unknown;

  try {
    const parsed = await response.clone().json();
    if (parsed && typeof parsed === 'object' && 'detail' in parsed) {
      detail = (parsed as { detail?: ApiErrorDetail }).detail;
    } else {
      detail = parsed as ApiErrorDetail;
    }
  } catch (_error) {
    try {
      const text = await response.text();
      if (text.length > 0) {
        raw = text;
      }
    } catch (_innerError) {
      raw = undefined;
    }
  }

  const kind: ApiErrorKind =
    response.status === 422 && Array.isArray(detail) ? 'validation' : 'http';

  return buildApiError({
    kind,
    status: response.status,
    detail,
    url,
    method,
    raw,
  });
}

async function parseResponsePayload<T>(
  response: Response,
  responseType: ResponseType,
  url: string,
  method: string
): Promise<T> {
  if (responseType === 'none') {
    return undefined as T;
  }

  if (responseType === 'blob') {
    return (await response.blob()) as T;
  }

  if (responseType === 'text') {
    return (await response.text()) as T;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (text.length === 0) {
    return undefined as T;
  }

  try {
    return JSON.parse(text) as T;
  } catch (_error) {
    throw buildApiError({
      kind: 'unknown',
      status: response.status,
      url,
      method,
      raw: text,
    });
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {}
): Promise<T> {
  const responseType = options.responseType ?? 'json';
  const projectIdLocation = options.projectIdLocation ?? 'query';
  const url = buildRequestUrl(path, options.projectId, projectIdLocation);
  const headers = buildHeaders(options.headers, options.projectId, projectIdLocation);
  const method = (options.method ?? 'GET').toUpperCase();
  const { responseType: _responseType, projectIdLocation: _projectIdLocation, ...fetchOptions } = options;

  try {
    const response = await fetch(url.toString(), {
      ...fetchOptions,
      headers,
    });

    if (!response.ok) {
      throw await parseErrorResponse(response, url.toString(), method);
    }

    return await parseResponsePayload<T>(response, responseType, url.toString(), method);
  } catch (error) {
    if (isApiError(error)) {
      throw error;
    }
    throw buildApiError({
      kind: 'network',
      url: url.toString(),
      method,
      raw: error,
    });
  }
}

export async function apiJson<T = unknown>(
  path: string,
  options?: ApiFetchOptions
): Promise<T> {
  return apiFetch<T>(path, { ...options, responseType: 'json' });
}

export async function apiText(path: string, options?: ApiFetchOptions): Promise<string> {
  return apiFetch<string>(path, { ...options, responseType: 'text' });
}

export async function apiBlob(path: string, options?: ApiFetchOptions): Promise<Blob> {
  return apiFetch<Blob>(path, { ...options, responseType: 'blob' });
}

export async function apiVoid(path: string, options?: ApiFetchOptions): Promise<void> {
  await apiFetch<void>(path, { ...options, responseType: 'none' });
}
