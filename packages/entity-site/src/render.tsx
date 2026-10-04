/**
 * Static HTML renderer for the Entity Website.
 *
 * Uses the same React components as the live preview, so the deployed artefact and the
 * preview are byte-for-byte the same design system. No per-user code is generated: this
 * renders the existing design system with a particular entity's verified data.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { EntitySite } from './components';
import type { EntitySiteModel } from './model';
import type { StructuredDataNode } from './meta';

export interface RenderOptions {
  /** Stylesheet href. Defaults to an inline copy so the artefact is self-contained. */
  stylesheetHref?: string;
  stylesheetText?: string;
  jsonLd?: StructuredDataNode[] | null;
  title: string;
  description: string;
  canonicalUrl: string;
  robots: string;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  /** Only used for the preview iframe, so the document can post its height. */
  previewBridge?: boolean;
}

function metaTags(tags: Record<string, string>): string {
  return Object.entries(tags)
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `<meta property="${escapeAttr(k)}" content="${escapeAttr(v)}" />`)
    .join('\n    ');
}

function nameTags(tags: Record<string, string>): string {
  return Object.entries(tags)
    .filter(([, v]) => typeof v === 'string' && v.length > 0)
    .map(([k, v]) => `<meta name="${escapeAttr(k)}" content="${escapeAttr(v)}" />`)
    .join('\n    ');
}

function escapeAttr(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Render a complete, crawlable HTML document for one entity. */
export function renderEntitySite(model: EntitySiteModel, options: RenderOptions): string {
  const body = renderToStaticMarkup(createElement(EntitySite, { model }));

  const styleBlock = options.stylesheetText
    ? `<style>\n${options.stylesheetText}\n</style>`
    : `<link rel="stylesheet" href="${escapeAttr(options.stylesheetHref ?? '/nexora-entity-site.css')}" />`;

  const jsonLdBlock = options.jsonLd?.length
    ? `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': options.jsonLd }).replace(
        /</g,
        '\\u003c',
      )}</script>`
    : '';

  const previewBridge = options.previewBridge
    ? `<script>
(function () {
  function send() {
    try {
      parent.postMessage({ type: 'nexora:entity-preview-height', height: document.documentElement.scrollHeight }, '*');
    } catch (e) {}
  }
  if (window.ResizeObserver) { new ResizeObserver(send).observe(document.body); }
  window.addEventListener('load', send);
  setInterval(send, 400);
})();
</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeAttr(options.title)}</title>
    <meta name="description" content="${escapeAttr(options.description)}" />
    <link rel="canonical" href="${escapeAttr(options.canonicalUrl)}" />
    <meta name="robots" content="${escapeAttr(options.robots)}" />
    ${metaTags(options.openGraph)}
    ${nameTags(options.twitter)}
    <meta property="og:type" content="profile" />
    ${styleBlock}
    ${jsonLdBlock}
  </head>
  <body>
${body}
    ${previewBridge}
  </body>
</html>
`;
}

export { renderToStaticMarkup };