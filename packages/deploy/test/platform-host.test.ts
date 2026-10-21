/**
 * Platform-host delivery tests.
 *
 * The first-party hosting tier serves every entity site when no Vercel credential is present. The
 * two functions exercised here decide what a browser receives: the content type (so HTML is never
 * downloaded as an opaque blob) and the cache policy (so HTML revalidates while immutable assets
 * are cached). Both are pure and are the parts of delivery most easily broken by a refactor.
 */

import { describe, expect, it } from 'vitest';

import { cacheHeadersFor, contentTypeFor } from '../src/platform-host';

describe('contentTypeFor', () => {
  const cases: { file: string; type: string }[] = [
    { file: 'index.html', type: 'text/html; charset=utf-8' },
    { file: 'assets/site.css', type: 'text/css; charset=utf-8' },
    { file: 'assets/app.js', type: 'text/javascript; charset=utf-8' },
    { file: 'data.json', type: 'application/json; charset=utf-8' },
    { file: 'sitemap.xml', type: 'application/xml; charset=utf-8' },
    { file: 'robots.txt', type: 'text/plain; charset=utf-8' },
    { file: 'logo.svg', type: 'image/svg+xml' },
    { file: 'portrait.PNG', type: 'image/png' },
    { file: 'photo.jpeg', type: 'image/jpeg' },
    { file: 'photo.webp', type: 'image/webp' },
    { file: 'photo.avif', type: 'image/avif' },
    { file: 'favicon.ico', type: 'image/x-icon' },
    { file: 'font.woff2', type: 'font/woff2' },
  ];

  for (const { file, type } of cases) {
    it(`maps ${file} to ${type}`, () => {
      expect(contentTypeFor(file)).toBe(type);
    });
  }

  it('is case-insensitive about the extension', () => {
    expect(contentTypeFor('INDEX.HTML')).toBe('text/html; charset=utf-8');
  });

  it('falls back to a binary type for anything unknown', () => {
    expect(contentTypeFor('archive.bin')).toBe('application/octet-stream');
    expect(contentTypeFor('noext')).toBe('application/octet-stream');
  });
});

describe('cacheHeadersFor', () => {
  it('revalidates HTML so a published update is picked up quickly', () => {
    const headers = cacheHeadersFor('index.html');
    expect(headers['cache-control']).toContain('s-maxage=60');
    expect(headers['cache-control']).toContain('stale-while-revalidate');
    expect(headers['cache-control']).not.toContain('immutable');
  });

  it('caches immutable assets for a year', () => {
    for (const file of ['assets/site.css', 'assets/app.js', 'photo.webp']) {
      const headers = cacheHeadersFor(file);
      expect(headers['cache-control']).toContain('immutable');
      expect(headers['cache-control']).toContain('max-age=31536000');
    }
  });

  it('always identifies the response as an entity site', () => {
    expect(cacheHeadersFor('index.html')['x-nexora-entity']).toBe('entity-site');
    expect(cacheHeadersFor('assets/app.js')['x-nexora-entity']).toBe('entity-site');
  });
});
