'use client';

import type { ReactNode } from 'react';
import { AutoUpdateProvider } from '../hooks/useAutoUpdate';
import { AuthProvider } from '../lib/auth';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <AutoUpdateProvider>
      <AuthProvider>{children}</AuthProvider>
    </AutoUpdateProvider>
  );
}
