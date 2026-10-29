import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { cssDosTemas } from '../tema';
import './globals.css';

export const metadata: Metadata = {
  title: 'Plataforma RPA',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <style>{cssDosTemas()}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
