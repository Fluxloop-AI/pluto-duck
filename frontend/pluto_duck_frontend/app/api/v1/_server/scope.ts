import { StoreHttpError } from './store.ts';

function normalizeProjectId(value: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  return normalized;
}

export function requireRouteParam(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new StoreHttpError(400, `${fieldName} is required`);
  }
  return normalized;
}

export function resolveProjectScope(request: Request): {
  project_id: string | null;
  source: 'query' | 'header' | 'none';
} {
  const url = new URL(request.url);
  const queryProjectId = normalizeProjectId(url.searchParams.get('project_id'));
  const headerProjectId = normalizeProjectId(request.headers.get('X-Project-ID'));

  if (queryProjectId && headerProjectId && queryProjectId !== headerProjectId) {
    throw new StoreHttpError(400, 'project_id query and X-Project-ID header do not match');
  }

  if (queryProjectId) {
    return {
      project_id: queryProjectId,
      source: 'query',
    };
  }

  if (headerProjectId) {
    return {
      project_id: headerProjectId,
      source: 'header',
    };
  }

  return {
    project_id: null,
    source: 'none',
  };
}

export function resolveRouteProjectId(request: Request, routeProjectId: string): string {
  const normalizedRouteProjectId = normalizeProjectId(routeProjectId);
  if (!normalizedRouteProjectId) {
    throw new StoreHttpError(400, 'Project id is required');
  }

  const scope = resolveProjectScope(request);
  if (scope.project_id && scope.project_id !== normalizedRouteProjectId) {
    throw new StoreHttpError(400, 'Project scope does not match route project id');
  }

  return normalizedRouteProjectId;
}
