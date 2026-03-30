import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { headers } from 'next/headers';

import { AppProviders } from '@/components/providers';
import { DebugOverlay } from '@/components/debug/DebugOverlay';
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
  // Brand icon for browser tabs across Timesheet.
  // The file lives in `public/branding/timevex-icon.png` (falls back to the default favicon if missing).
  icons: {
    icon: [{ url: '/branding/timevex-icon.png', type: 'image/png' }],
    shortcut: [{ url: '/branding/timevex-icon.png', type: 'image/png' }],
    apple: [{ url: '/branding/timevex-icon.png', type: 'image/png' }],
  },
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

  const session = await getServerAuthSession();
  if ((!headerPreset || !headerMode) && session?.tenantId) {
    const theme = await fetchTenantThemeSettings(session.tenantId);
      if (theme?.preset && !headerPreset) {
        themePreset = theme.preset;
      }
      if (theme?.mode && !headerMode) {
        themeMode = theme.mode === 'light' ? 'light' : 'auto';
      }
  }
  const debugAdmins = process.env.DEBUG_OVERLAY_ADMINS?.trim().toLowerCase() === 'true';
  const debugIps =
    process.env.DEBUG_OVERLAY_IPS?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
  const forwardedFor = hdrs.get('x-forwarded-for') ?? hdrs.get('x-real-ip') ?? '';
  const clientIp = forwardedFor.split(',')[0]?.trim();
  const allowByIp = clientIp ? debugIps.includes(clientIp) : false;
  const isAdmin = session?.user?.roleId === 2 || session?.user?.accountType === 'admin';
  const debugEnabled = Boolean(isAdmin && (debugAdmins || allowByIp));
  return (
    <html lang="de" data-theme={themePreset} data-theme-mode={themeMode}>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased backoffice-shell`}>
        <AppProviders>{children}</AppProviders>
        <DebugOverlay enabled={debugEnabled} />
      </body>
    </html>
  );
}
