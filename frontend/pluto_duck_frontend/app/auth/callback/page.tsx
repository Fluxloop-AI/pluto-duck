'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useAuth } from '../../../lib/auth';

const DEFAULT_TAURI_CALLBACK_URL = 'plutoduck://auth/callback';
const TAURI_BRIDGE_FLAG = 'tauri_bridge';

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveTauriCallbackUrl(): string {
  const configured = readString(process.env.NEXT_PUBLIC_TAURI_AUTH_CALLBACK_URL);
  return configured ?? DEFAULT_TAURI_CALLBACK_URL;
}

function buildTauriCallbackUrl(sourceUrl: URL): string {
  const target = new URL(resolveTauriCallbackUrl());
  for (const [key, value] of sourceUrl.searchParams.entries()) {
    if (key === TAURI_BRIDGE_FLAG) continue;
    target.searchParams.set(key, value);
  }
  target.hash = sourceUrl.hash;
  return target.toString();
}

export default function AuthCallbackPage() {
  const router = useRouter();
  const { finishOAuthCallback } = useAuth();
  const [status, setStatus] = useState<'processing' | 'launching-app' | 'done' | 'error'>('processing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [launchUrl, setLaunchUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let doneTimer: number | null = null;

    const run = async () => {
      try {
        const currentUrl = new URL(window.location.href);
        const fromTauriBridge = currentUrl.searchParams.get(TAURI_BRIDGE_FLAG) === '1';
        if (fromTauriBridge) {
          const tauriCallbackUrl = buildTauriCallbackUrl(currentUrl);
          setLaunchUrl(tauriCallbackUrl);
          setStatus('launching-app');
          window.location.assign(tauriCallbackUrl);
          doneTimer = window.setTimeout(() => {
            if (!active) return;
            setStatus('done');
          }, 1200);
          return;
        }

        const handled = await finishOAuthCallback(window.location.href);
        if (!active) return;
        if (!handled) {
          throw new Error('Missing OAuth callback data');
        }
        router.replace('/');
      } catch (error) {
        if (!active) return;
        setStatus('error');
        setErrorMessage(error instanceof Error ? error.message : 'Failed to finish Google login');
      }
    };

    void run();

    return () => {
      active = false;
      if (doneTimer !== null) {
        window.clearTimeout(doneTimer);
      }
    };
  }, [finishOAuthCallback, router]);

  return (
    <main className="flex h-screen w-full items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        {status === 'processing' && <p className="text-sm text-muted-foreground">Signing in with Google...</p>}

        {status === 'launching-app' && (
          <p className="text-sm text-muted-foreground">
            Login succeeded. Returning to Pluto Duck...
          </p>
        )}

        {status === 'done' && (
          <>
            <p className="text-sm font-medium text-foreground">Login completed. You can close this tab.</p>
            {launchUrl && (
              <p className="mt-2 text-xs text-muted-foreground">
                If Pluto Duck did not open,{' '}
                <a className="underline underline-offset-2" href={launchUrl}>
                  open it manually
                </a>
                .
              </p>
            )}
          </>
        )}

        {status === 'error' && (
          <>
            <p className="text-sm font-medium text-destructive">Google login failed.</p>
            {errorMessage && <p className="mt-2 text-xs text-muted-foreground">{errorMessage}</p>}
          </>
        )}
      </div>
    </main>
  );
}
