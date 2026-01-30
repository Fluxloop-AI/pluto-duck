# API Client Guide

Use `lib/apiClient.ts` for all backend requests. It normalizes URLs, adds project
context, and standardizes error handling.

## Quick start
```ts
import { apiJson, apiVoid } from './lib/apiClient';

const project = await apiJson<Project>('/api/v1/projects/123');

await apiVoid(`/api/v1/projects/${projectId}`, {
  method: 'DELETE',
  projectId,
});
```

## Project ID handling
`projectId` is optional, and defaults to the query string:
```ts
await apiJson('/api/v1/boards', {
  projectId,
  projectIdLocation: 'query', // default
});
```

If an endpoint expects `X-Project-ID`, set `projectIdLocation: 'header'`:
```ts
await apiJson('/api/v1/boards', {
  projectId,
  projectIdLocation: 'header',
});
```

## Response helpers
- `apiJson` for JSON responses.
- `apiText` for plain text.
- `apiBlob` for file downloads.
- `apiVoid` for 204/no-body responses (DELETE, some POST/PUT).
- `apiFetch` for advanced cases with `responseType`.

## Error handling
`apiClient` throws `ApiError` when the response is non-2xx or network fails.

```ts
import type { ApiError, ApiValidationItem } from './lib/apiClient';

try {
  await apiJson('/api/v1/projects');
} catch (error) {
  if (typeof error === 'object' && error !== null && (error as ApiError).name === 'ApiError') {
    const apiError = error as ApiError;
    if (apiError.kind === 'validation') {
      const details = apiError.detail as ApiValidationItem[];
      // surface field errors to the UI
    } else {
      // http/network/unknown
    }
  }
}
```

Validation errors are detected from `422` responses and expose `detail` as
`ApiValidationItem[]`. HTTP errors use `kind: 'http'` and expose status/message.
