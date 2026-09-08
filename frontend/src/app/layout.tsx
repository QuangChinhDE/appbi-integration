import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { Toaster } from 'sonner';

import './globals.css';
import { LanguageProvider } from '@/providers/LanguageProvider';
import { QueryProvider } from '@/providers/QueryProvider';

const inter = Inter({
  subsets: ['latin', 'vietnamese'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AppBI Automation',
  description: 'Workflow automation — build, run and monitor automations.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" className={inter.variable}>
      <body className="font-sans antialiased">
        <QueryProvider>
          <LanguageProvider>
            {children}
            <Toaster
              position="bottom-right"
              closeButton
              toastOptions={{
                classNames: {
                  toast:
                    'rounded-lg border border-[rgb(var(--border-strong))] bg-surface-1 text-text-primary shadow-popover',
                  description: 'text-text-tertiary',
                },
              }}
            />
          </LanguageProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
