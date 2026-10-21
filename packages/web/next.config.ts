import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import type { NextConfig } from 'next';

const require = createRequire(import.meta.url);
const dbSrc = dirname(require.resolve('@nexora/db/package.json'));

/**
 * Opt in to the in-memory repository double with NEXORA_DB=memory.
 *
 * This exists so the whole product can be exercised end to end before the hosted PostgreSQL
 * integration is activated. It is off unless explicitly requested, and it refuses to run in a
 * production build: `packages/db/src/memory-store.ts` throws whenever `NODE_ENV=production`, so
 * even a misconfigured production deployment cannot silently serve non-durable data.
 */
const useMemoryDb = process.env.NEXORA_DB === 'memory' && process.env.NODE_ENV !== 'production';

if (useMemoryDb) {
  console.warn(
    '[nexora] NEXORA_DB=memory — using the in-memory database double. Data is not durable. ' +
      'Never enable this outside development or test.',
  );
}

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
  // directly from the entity-site package, so it needs no aliasing. Only the optional
  // in-memory database double is redirected, and only when it was explicitly requested.
  //
  // This aliases to the `@nexora/db/memory` package subpath rather than to an absolute file
  // path. Turbopack treats a `resolveAlias` value as a module specifier, so an interpolated
  // absolute path fails to resolve on Windows ("windows imports are not implemented yet").
  // The subpath is declared in packages/db/package.json, so it resolves identically on every
  // platform and keeps working if the double is ever moved.
  turbopack: useMemoryDb
    ? {
        // A path relative to this package's root. Turbopack treats `resolveAlias` values as module
        // specifiers: an interpolated absolute path fails on Windows ("windows imports are not
        // implemented yet"), and aliasing to the `@nexora/db/memory` subpath resolves back to
        // `src/memory.ts` instead of `src/memory-index.ts`, which silently drops every export that
        // reaches the double through a re-export. This path names the barrel explicitly and is
        // portable.
        resolveAlias: {
          '@nexora/db': '../db/src/memory-index.ts',
        },
      }
    : {},
  webpack: useMemoryDb
    ? (config) => {
        config.resolve.alias = {
          ...(config.resolve?.alias ?? {}),
          '@nexora/db': resolve(dbSrc, 'memory-index.ts'),
        };
        return config;
      }
    : undefined,

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