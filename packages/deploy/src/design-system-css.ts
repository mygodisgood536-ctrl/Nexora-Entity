/**
 * Access to the single Nexora Entity Website Design System stylesheet.
 *
 * There is exactly one copy of the design system CSS, at
 * `packages/entity-site/src/design-system.css`. The platform app imports it through the
 * bundler for live preview; the deployment layer reads the same file at build time. Nothing
 * regenerates or minifies a second copy.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Candidate locations, so this works from source, from a build output, and when bundled. */
const CANDIDATES = [
  path.resolve(here, '..', '..', 'entity-site', 'src', 'design-system.css'),
  path.resolve(here, '..', '..', '..', 'entity-site', 'src', 'design-system.css'),
  path.resolve(here, '..', 'node_modules', '@nexora', 'entity-site', 'src', 'design-system.css'),
  path.resolve(process.cwd(), 'packages', 'entity-site', 'src', 'design-system.css'),
];

let cached: string | null = null;

export function designSystemCss(): string {
  if (cached) return cached;
  const tried: string[] = [];
  for (const candidate of CANDIDATES) {
    tried.push(candidate);
    try {
      // The candidate list is resolved at runtime, so the bundler cannot trace it on its own.
      // `outputFileTracingIncludes` in packages/web/next.config.ts carries the stylesheet into
      // the standalone server bundle; this opt-out keeps file tracing from walking the entire repo.
      const text = readFileSync(/* turbopackIgnore: true */ candidate, 'utf8');
      if (text.trim().length > 0) {
        cached = text;
        return cached;
      }
    } catch {
      /* try the next candidate */
    }
  }
  throw new Error(
    `The Nexora Entity Website Design System stylesheet could not be located. Looked in:\n  ${tried.join('\n  ')}`,
  );
}

/** Drop the cache. Used by tests that rewrite the stylesheet. */
export function resetDesignSystemCss(): void {
  cached = null;
}