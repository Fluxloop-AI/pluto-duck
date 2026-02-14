const DEFAULT_BACKEND_URL = 'http://127.0.0.1:3100';

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

export function getBackendUrl(): string {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  if (base && base.length > 0) {
    return trimTrailingSlash(base);
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return trimTrailingSlash(window.location.origin);
  }

  return DEFAULT_BACKEND_URL;
}
