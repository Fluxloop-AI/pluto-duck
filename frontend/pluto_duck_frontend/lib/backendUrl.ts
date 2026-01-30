const DEFAULT_BACKEND_URL = 'http://127.0.0.1:8123';

export function getBackendUrl(): string {
  const base = process.env.NEXT_PUBLIC_BACKEND_URL?.trim();
  return base && base.length > 0 ? base.replace(/\/$/, '') : DEFAULT_BACKEND_URL;
}
