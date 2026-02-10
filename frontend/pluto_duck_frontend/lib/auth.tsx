'use client';

import type { Session, SupabaseClient, User } from '@supabase/supabase-js';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { getSupabaseClient } from './supabaseClient';
import { isTauriRuntime } from './tauriRuntime';

const WEB_CALLBACK_PATH = '/auth/callback';
const DEFAULT_TAURI_CALLBACK_URL = 'plutoduck://auth/callback';
const TAURI_BRIDGE_FLAG = 'tauri_bridge';

type CallbackEventPayload = { url?: string } | string;

declare global {
  interface Window {
    __plutoAuthCallbackQueue?: string[];
  }
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveProfileName(user: User | null): string | null {
  if (!user) return null;
  const metadata = user.user_metadata ?? {};
  return (
    readString(metadata.full_name) ??
    readString(metadata.name) ??
    readString(metadata.preferred_username) ??
    readString(user.email?.split('@')[0])
  );
}

function resolveAvatarUrl(user: User | null): string | null {
  if (!user) return null;
  const metadata = user.user_metadata ?? {};
  return readString(metadata.avatar_url) ?? readString(metadata.picture);
}

function resolveTauriCallbackUrl(): string {
  const configured = readString(process.env.NEXT_PUBLIC_TAURI_AUTH_CALLBACK_URL);
  return configured ?? DEFAULT_TAURI_CALLBACK_URL;
}

function resolveWebCallbackUrl(): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${WEB_CALLBACK_PATH}`;
  }
  const configured = readString(process.env.NEXT_PUBLIC_WEB_AUTH_CALLBACK_URL);
  return configured ?? `http://localhost:3000${WEB_CALLBACK_PATH}`;
}

function resolveTauriBridgeCallbackUrl(): string {
  const configured = readString(process.env.NEXT_PUBLIC_WEB_AUTH_CALLBACK_URL);
  if (configured) {
    return configured;
  }

  if (typeof window !== 'undefined') {
    const origin = window.location.origin.toLowerCase();
    if (origin.startsWith('http://') || origin.startsWith('https://')) {
      return `${window.location.origin}${WEB_CALLBACK_PATH}`;
    }
  }

  return `http://127.0.0.1:3100${WEB_CALLBACK_PATH}`;
}

function shouldUseTauriBrowserBridge(): boolean {
  if (typeof window === 'undefined') return false;
  const origin = window.location.origin.toLowerCase();
  return origin.startsWith('http://') || origin.startsWith('https://');
}

function withTauriBridgeFlag(urlString: string): string {
  try {
    const url = new URL(urlString);
    url.searchParams.set(TAURI_BRIDGE_FLAG, '1');
    return url.toString();
  } catch {
    return urlString;
  }
}

function resolveAuthErrorFromUrl(url: URL): string | null {
  const fromSearch =
    readString(url.searchParams.get('error_description')) ?? readString(url.searchParams.get('error'));
  if (fromSearch) return fromSearch;

  const hash = toHashSearchParams(url);
  return readString(hash.get('error_description')) ?? readString(hash.get('error'));
}

function toHashSearchParams(url: URL): URLSearchParams {
  return new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
}

function readAuthCodeFromUrl(url: URL): string | null {
  return readString(url.searchParams.get('code')) ?? readString(toHashSearchParams(url).get('code'));
}

function readAuthSessionFromUrl(
  url: URL
): {
  accessToken: string;
  refreshToken: string;
} | null {
  const hash = toHashSearchParams(url);
  const accessToken = readString(url.searchParams.get('access_token')) ?? readString(hash.get('access_token'));
  const refreshToken = readString(url.searchParams.get('refresh_token')) ?? readString(hash.get('refresh_token'));
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken };
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return fallback;
}

async function openInDefaultBrowser(url: string): Promise<void> {
  if (!isTauriRuntime()) {
    window.location.assign(url);
    return;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('open_external_url', { url });
}

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  authError: string | null;
  isConnected: boolean;
  profile: {
    name: string | null;
    email: string | null;
    avatarUrl: string | null;
  };
  connectWithGoogle: () => Promise<void>;
  disconnectGoogle: () => Promise<void>;
  finishOAuthCallback: (urlString: string) => Promise<boolean>;
  clearAuthError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const consumedCallbacksRef = useRef<Set<string>>(new Set());

  const finishOAuthCallback = useCallback(async (urlString: string): Promise<boolean> => {
    let parsed: URL;
    try {
      parsed = new URL(urlString);
    } catch {
      return false;
    }

    const oauthError = resolveAuthErrorFromUrl(parsed);
    if (oauthError) {
      setAuthError(oauthError);
      throw new Error(oauthError);
    }

    const code = readAuthCodeFromUrl(parsed);
    const sessionTokens = code ? null : readAuthSessionFromUrl(parsed);
    if (!code && !sessionTokens) {
      return false;
    }

    const callbackKey = code ? `code:${code}` : `session:${sessionTokens!.accessToken}`;
    if (consumedCallbacksRef.current.has(callbackKey)) {
      return true;
    }

    consumedCallbacksRef.current.add(callbackKey);
    setAuthError(null);

    let supabase: SupabaseClient;
    try {
      supabase = getSupabaseClient();
    } catch (error) {
      const message = resolveErrorMessage(error, 'Supabase is not configured');
      setAuthError(message);
      throw new Error(message);
    }

    const { error } = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : await supabase.auth.setSession({
          access_token: sessionTokens!.accessToken,
          refresh_token: sessionTokens!.refreshToken,
        });

    if (error) {
      consumedCallbacksRef.current.delete(callbackKey);
      setAuthError(error.message);
      throw error;
    }

    return true;
  }, []);

  const connectWithGoogle = useCallback(async () => {
    setAuthError(null);
    const tauriRuntime = isTauriRuntime();
    const useBridge = tauriRuntime && shouldUseTauriBrowserBridge();
    const redirectTo = tauriRuntime
      ? useBridge
        ? withTauriBridgeFlag(resolveTauriBridgeCallbackUrl())
        : resolveTauriCallbackUrl()
      : resolveWebCallbackUrl();

    let supabase: SupabaseClient;
    try {
      supabase = getSupabaseClient();
    } catch (error) {
      const message = resolveErrorMessage(error, 'Supabase is not configured');
      setAuthError(message);
      throw new Error(message);
    }
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        skipBrowserRedirect: tauriRuntime,
        queryParams: {
          prompt: 'select_account',
        },
      },
    });

    if (error) {
      setAuthError(error.message);
      throw error;
    }

    if (tauriRuntime) {
      const url = readString(data.url);
      if (!url) {
        throw new Error('Failed to start Google login');
      }
      await openInDefaultBrowser(url);
    }
  }, []);

  const disconnectGoogle = useCallback(async () => {
    setAuthError(null);
    let supabase: SupabaseClient;
    try {
      supabase = getSupabaseClient();
    } catch (error) {
      const message = resolveErrorMessage(error, 'Supabase is not configured');
      setAuthError(message);
      throw new Error(message);
    }
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthError(error.message);
      throw error;
    }
  }, []);

  const clearAuthError = useCallback(() => {
    setAuthError(null);
  }, []);

  useEffect(() => {
    let mounted = true;
    let subscription: { unsubscribe: () => void } | null = null;

    let supabase: SupabaseClient;
    try {
      supabase = getSupabaseClient();
    } catch (error) {
      if (mounted) {
        setAuthError(resolveErrorMessage(error, 'Supabase is not configured'));
        setLoading(false);
      }
      return () => {
        mounted = false;
      };
    }

    const initialize = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (!mounted) return;

      if (error) {
        setAuthError(error.message);
      } else {
        setSession(data.session ?? null);
        setUser(data.session?.user ?? null);
      }
      setLoading(false);
    };

    void initialize();

    const {
      data: { subscription: nextSubscription },
    } = supabase.auth.onAuthStateChange((_event: unknown, nextSession: Session | null) => {
      if (!mounted) return;
      setSession(nextSession ?? null);
      setUser(nextSession?.user ?? null);
    });
    subscription = nextSubscription;

    const handleWindowCallbackEvent = (event: Event) => {
      const customEvent = event as CustomEvent<CallbackEventPayload>;
      const detail = customEvent.detail;
      const url =
        typeof detail === 'string'
          ? detail
          : detail && typeof detail === 'object'
          ? readString(detail.url)
          : null;
      if (!url) return;
      void finishOAuthCallback(url).catch(() => {
        // Error state is already set in finishOAuthCallback.
      });
    };

    if (typeof window !== 'undefined') {
      const queue = window.__plutoAuthCallbackQueue ?? [];
      if (queue.length > 0) {
        const pending = [...queue];
        window.__plutoAuthCallbackQueue = [];
        for (const url of pending) {
          void finishOAuthCallback(url).catch(() => {
            // Error state is already set in finishOAuthCallback.
          });
        }
      }

      window.addEventListener('pluto-auth-callback', handleWindowCallbackEvent as EventListener);
    }

    return () => {
      mounted = false;
      subscription?.unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('pluto-auth-callback', handleWindowCallbackEvent as EventListener);
      }
    };
  }, [finishOAuthCallback]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user,
      loading,
      authError,
      isConnected: !!user,
      profile: {
        name: resolveProfileName(user),
        email: readString(user?.email),
        avatarUrl: resolveAvatarUrl(user),
      },
      connectWithGoogle,
      disconnectGoogle,
      finishOAuthCallback,
      clearAuthError,
    }),
    [
      authError,
      clearAuthError,
      connectWithGoogle,
      disconnectGoogle,
      finishOAuthCallback,
      loading,
      session,
      user,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
