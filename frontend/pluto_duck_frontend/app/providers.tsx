'use client';

import type { ReactNode } from 'react';
import { AutoUpdateProvider } from '../hooks/useAutoUpdate';

export function Providers({ children }: { children: ReactNode }) {
  return <AutoUpdateProvider>{children}</AutoUpdateProvider>;
}

