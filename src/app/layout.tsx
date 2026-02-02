import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { headers } from 'next/headers';

import { AppProviders } from '@/components/providers';
import { getServerAuthSession } from '@/lib/auth/session';
import { fetchTenantThemeSettings } from '@/lib/control-plane';

import './globals.css';
import '@/styles/time-input.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Stundenliste Portal',
  description: 'Digitale Arbeitszeit- und Umsatzverwaltung für murmel creation.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const hdrs = await headers();
  const headerPreset = hdrs.get('x-tenant-theme');
  const headerMode = hdrs.get('x-tenant-theme-mode');
  let themePreset = headerPreset ?? 'emerald';
  let themeMode = headerMode === 'light' ? 'light' : 'auto';

  if (!headerPreset || !headerMode) {
    const session = await getServerAuthSession();
    if (session?.tenantId) {
      const theme = await fetchTenantThemeSettings(session.tenantId);
      if (theme?.preset && !headerPreset) {
        themePreset = theme.preset;
      }
      if (theme?.mode && !headerMode) {
        themeMode = theme.mode === 'light' ? 'light' : 'auto';
      }
    }
  }
  return (
    <html lang="de" data-theme={themePreset} data-theme-mode={themeMode}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased backoffice-shell`}>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
