import type { ReactNode } from 'react';

import './globals.css';
import { Providers } from './providers';

export const metadata = {
  title: 'Pluto-Duck Agent Studio',
  description: 'Local-first analytics assistant with DuckDB, dbt, and LangGraph',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen overflow-hidden">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
