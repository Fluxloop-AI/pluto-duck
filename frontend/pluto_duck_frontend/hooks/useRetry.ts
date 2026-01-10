import { useState, useCallback, useRef } from 'react';

export interface RetryOptions {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
}

export interface RetryState<T> {
  data: T | null;
  isLoading: boolean;
  error: string | null;
  retryCount: number;
  isRetrying: boolean;
}

export interface UseRetryReturn<T> extends RetryState<T> {
  execute: () => Promise<T | null>;
  retry: () => Promise<T | null>;
  reset: () => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 3,
  initialDelay: 1000,
  maxDelay: 8000,
  backoffMultiplier: 2,
};

/**
 * Hook for executing async functions with automatic retry and exponential backoff
 * 
 * @example
 * const { data, isLoading, error, execute, retry } = useRetry(
 *   async () => await fetchData(id),
 *   { maxRetries: 3 }
 * );
 */
export function useRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): UseRetryReturn<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  const [state, setState] = useState<RetryState<T>>({
    data: null,
    isLoading: false,
    error: null,
    retryCount: 0,
    isRetrying: false,
  });

  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  // Calculate delay with exponential backoff
  const getDelay = useCallback((attempt: number) => {
    const delay = opts.initialDelay * Math.pow(opts.backoffMultiplier, attempt);
    return Math.min(delay, opts.maxDelay);
  }, [opts.initialDelay, opts.backoffMultiplier, opts.maxDelay]);

  // Sleep utility
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // Execute with retry logic
  const execute = useCallback(async (): Promise<T | null> => {
    // Cancel any ongoing request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    setState(prev => ({
      ...prev,
      isLoading: true,
      error: null,
      retryCount: 0,
      isRetrying: false,
    }));

    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
      try {
        // Check if aborted
        if (abortControllerRef.current?.signal.aborted) {
          return null;
        }

        // Update retry state
        if (attempt > 0) {
          if (!isMountedRef.current) return null;
          setState(prev => ({
            ...prev,
            isRetrying: true,
            retryCount: attempt,
          }));
        }

        const result = await fn();

        // Success
        if (!isMountedRef.current) return null;
        setState({
          data: result,
          isLoading: false,
          error: null,
          retryCount: attempt,
          isRetrying: false,
        });

        return result;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        
        // Don't retry on abort
        if (err instanceof Error && err.name === 'AbortError') {
          return null;
        }

        // If not last attempt, wait before retry
        if (attempt < opts.maxRetries) {
          const delay = getDelay(attempt);
          console.log(`[useRetry] Attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
          await sleep(delay);
        }
      }
    }

    // All retries exhausted
    if (!isMountedRef.current) return null;
    setState({
      data: null,
      isLoading: false,
      error: lastError?.message || 'Failed after all retries',
      retryCount: opts.maxRetries,
      isRetrying: false,
    });

    return null;
  }, [fn, opts.maxRetries, getDelay]);

  // Manual retry (resets count and tries again)
  const retry = useCallback(async (): Promise<T | null> => {
    return execute();
  }, [execute]);

  // Reset state
  const reset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setState({
      data: null,
      isLoading: false,
      error: null,
      retryCount: 0,
      isRetrying: false,
    });
  }, []);

  return {
    ...state,
    execute,
    retry,
    reset,
  };
}

/**
 * Utility function for one-off retry operations (not a hook)
 */
export async function retryAsync<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      
      if (attempt < opts.maxRetries) {
        const delay = opts.initialDelay * Math.pow(opts.backoffMultiplier, attempt);
        await new Promise(resolve => setTimeout(resolve, Math.min(delay, opts.maxDelay)));
      }
    }
  }

  throw lastError || new Error('Failed after all retries');
}

