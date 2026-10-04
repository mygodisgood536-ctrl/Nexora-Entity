/**
 * Static renderer CLI.
 *
 * Reads an entity site model as JSON on stdin and writes the rendered HTML document to stdout.
 *
 * This runs as its own Node process rather than inside the Next.js bundle for one reason:
 * the deployment artefact must be produced by `renderToStaticMarkup` from the single design
 * system, and Next 16 forbids importing `react-dom/server` into the React Server Component
 * graph. Running it out-of-process keeps exactly one renderer, used by both the live preview
 * and the published site, with no second markup implementation to drift.
 *
 * Usage: node --import tsx render-cli.ts  < model.json > site.html
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import type { EntitySiteModel } from './model';

interface RenderPayload {
  model: EntitySiteModel;
  stylesheetText: string;
  jsonLd: unknown[] | null;
  title: string;
  description: string;
  canonicalUrl: string;
  robots: string;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  previewBridge: boolean;
}

async function main(): Promise<void> {
  const input = process.argv[2];
  const payload: RenderPayload = input
    ? (JSON.parse(readFileSync(input, 'utf8')) as RenderPayload)
    : (JSON.parse(readFileSync(0, 'utf8')) as RenderPayload);

  // Imported through a file URL so the bundler never sees this module.
  const mod = await import(pathToFileURL(new URL('./render.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href);
  const html = (mod as { renderEntitySite: (m: EntitySiteModel, o: unknown) => string }).renderEntitySite(
    payload.model,
    {
      stylesheetText: payload.stylesheetText,
      jsonLd: payload.jsonLd,
      title: payload.title,
      description: payload.description,
      canonicalUrl: payload.canonicalUrl,
      robots: payload.robots,
      openGraph: payload.openGraph,
      twitter: payload.twitter,
      previewBridge: payload.previewBridge,
    },
  );
  writeFileSync(1, html, 'utf8');
}

main().catch((err) => {
  process.stderr.write(`render-cli failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});