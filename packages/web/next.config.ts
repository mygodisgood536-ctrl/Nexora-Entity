import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: 'standalone',
  serverExternalPackages: ['pg', 'sharp', 'unpdf', 'mammoth'],
  typescript: { ignoreBuildErrors: false },
  // `design-system-css.ts` resolves its path at runtime, so the bundler cannot trace the single
  // design-system stylesheet on its own. Carry it into the standalone bundle explicitly.
  outputFileTracingIncludes: {
    '/**': ['./packages/entity-site/src/design-system.css', './packages/entity-site/src/render-cli.ts'],
  },
  // Turbopack is the default builder in Next 16. The design-system stylesheet is consumed
  // directly from the entity-site package, so no aliasing is required.
  turbopack: {},
  experimental: {
    // Uploaded photos and portfolio files can be large.
    serverActions: { bodySizeLimit: '30mb' },
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
        ],
      },
      {
        source: '/e/:path*',
        headers: [{ key: 'X-Frame-Options', value: 'DENY' }],
      },
    ];
  },
};

export default nextConfig;