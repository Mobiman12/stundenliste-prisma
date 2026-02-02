import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const rawBasePath = process.env.NEXT_PUBLIC_APP_BASE_PATH?.trim();
const normalizedBasePath =
  rawBasePath && rawBasePath !== '/'
    ? rawBasePath.startsWith('/')
      ? rawBasePath
      : `/${rawBasePath}`
    : undefined;

if (normalizedBasePath) {
  console.log(`[stundenliste-next] basePath enabled: ${normalizedBasePath}`);
} else {
  console.log('[stundenliste-next] basePath disabled');
}

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  basePath: normalizedBasePath,
  output: 'standalone',
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  async redirects() {
    if (normalizedBasePath) {
      return [
        {
          source: '/',
          destination: normalizedBasePath,
          permanent: false,
          basePath: false,
        },
      ];
    }

    // Fallback: Accept old /stundenliste/* URLs and send them to the new root paths.
    return [
      {
        source: '/stundenliste',
        destination: '/',
        permanent: false,
        basePath: false,
      },
      {
        source: '/stundenliste/:path*',
        destination: '/:path*',
        permanent: false,
        basePath: false,
      },
    ];
  },
};

export default nextConfig;
