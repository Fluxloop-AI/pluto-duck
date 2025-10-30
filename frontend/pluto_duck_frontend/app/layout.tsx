import type { ReactNode } from 'react';

import './globals.css';

export const metadata = {
  title: 'Pluto-Duck Agent Studio',
  description: 'Local-first analytics assistant with DuckDB, dbt, and LangGraph',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="h-screen overflow-hidden">
        {children}
      </body>
    </html>
  );
}
