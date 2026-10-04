import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts', 'packages/**/*.test.tsx'],
    environment: 'node',
    globals: false,
    reporters: 'default',
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@nexora/core/config': path.resolve(__dirname, 'packages/core/src/config.ts'),
      '@nexora/core': path.resolve(__dirname, 'packages/core/src/index.ts'),
      '@nexora/db': path.resolve(__dirname, 'packages/db/src/index.ts'),
      '@nexora/inspect': path.resolve(__dirname, 'packages/inspect/src/index.ts'),
      '@nexora/engine': path.resolve(__dirname, 'packages/engine/src/index.ts'),
      '@nexora/entity-site/compose': path.resolve(__dirname, 'packages/entity-site/src/compose.ts'),
      '@nexora/entity-site/model': path.resolve(__dirname, 'packages/entity-site/src/model.ts'),
      '@nexora/entity-site/meta': path.resolve(__dirname, 'packages/entity-site/src/meta.ts'),
      '@nexora/entity-site': path.resolve(__dirname, 'packages/entity-site/src/index.ts'),
      '@nexora/opencode-bridge': path.resolve(__dirname, 'packages/opencode-bridge/src/index.ts'),
      '@nexora/deploy': path.resolve(__dirname, 'packages/deploy/src/index.ts'),
    },
  },
});