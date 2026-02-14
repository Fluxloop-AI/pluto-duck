import { NextResponse } from 'next/server';

import { DbError } from './db.ts';
import { requireRouteParam, resolveProjectScope, resolveRouteProjectId } from './scope.ts';
import { StoreHttpError } from './store.ts';

export { requireRouteParam, resolveProjectScope, resolveRouteProjectId };

const DEFAULT_JSON_BODY_MAX_BYTES = 1024 * 1024; // 1 MiB
const DEFAULT_JSON_BODY_TIMEOUT_MS = 10_000;
const DEFAULT_OPERATION_TIMEOUT_MS = 30_000;

interface ParseJsonBodyOptions {
  maxBytes?: number;
  timeoutMs?: number;
}

interface RequestTimeoutOptions {
  timeoutMs?: number;
  detail?: string;
}

export function ok<T>(body: T): NextResponse {
  return NextResponse.json(body, { status: 200 });
}

export function created<T>(body: T): NextResponse {
  return NextResponse.json(body, { status: 201 });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof StoreHttpError) {
    return NextResponse.json({ detail: error.detail }, { status: error.status });
  }

  if (error instanceof DbError) {
    console.error('Database route error', error);
    return NextResponse.json({ detail: 'Database error' }, { status: 500 });
  }

  console.error('Unhandled API route error', error);
  return NextResponse.json({ detail: 'Internal server error' }, { status: 500 });
}

function parseContentLength(request: Request): number | null {
  const raw = request.headers.get('content-length');
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.trunc(parsed);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, detail: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new StoreHttpError(504, detail));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function withRequestTimeout<T>(
  operation: () => Promise<T>,
  options?: RequestTimeoutOptions
): Promise<T> {
  const timeoutMs = Math.max(1000, options?.timeoutMs ?? DEFAULT_OPERATION_TIMEOUT_MS);
  const detail = options?.detail ?? 'Request timed out';
  return withTimeout(operation(), timeoutMs, detail);
}

export async function parseJsonBody<T>(request: Request, options?: ParseJsonBodyOptions): Promise<T> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new StoreHttpError(415, 'Content-Type must be application/json');
  }

  const maxBytes = Math.max(1024, options?.maxBytes ?? DEFAULT_JSON_BODY_MAX_BYTES);
  const timeoutMs = Math.max(1000, options?.timeoutMs ?? DEFAULT_JSON_BODY_TIMEOUT_MS);
  const contentLength = parseContentLength(request);
  if (contentLength !== null && contentLength > maxBytes) {
    throw new StoreHttpError(413, `JSON body too large (max ${maxBytes} bytes)`);
  }

  const text = await withTimeout(request.text(), timeoutMs, 'Request body read timed out');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    throw new StoreHttpError(413, `JSON body too large (max ${maxBytes} bytes)`);
  }
  if (text.trim().length === 0) {
    throw new StoreHttpError(400, 'JSON body is required');
  }

  try {
    return JSON.parse(text) as T;
  } catch (_error) {
    throw new StoreHttpError(400, 'Invalid JSON body');
  }
}
