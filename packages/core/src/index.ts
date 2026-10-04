/**
 * Browser-safe surface of `@nexora/core`.
 *
 * Client components import from this barrel, so it must never reach a Node builtin:
 * a single `node:fs` or `node:crypto` import here drags an external module into the browser
 * chunk group and fails the build. Server-only concerns — filesystem layout, storage
 * directories, the OpenCode port — live in `@nexora/core/config`, imported explicitly by
 * server code and by the Node runtime.
 */

export * from './vocabulary';
export * from './errors';
export * from './product-language';
export * from './names';
export * from './sha256';
export * from './stages';
export * from './primitives';
export * from './logging';