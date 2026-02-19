import type { ReactNode } from 'react';
import Script from 'next/script';

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
        {/* Temporary: Figma capture script - REMOVE after capture */}
        <Script
          src="https://mcp.figma.com/mcp/html-to-design/capture.js"
          strategy="afterInteractive"
        />
      </body>
    </html>
  );
}
