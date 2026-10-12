import type { MetadataRoute } from 'next';

/**
 * Platform robots.txt.
 *
 * The Nexora Entity application itself must not be indexed. What should be indexed is a
 * *published entity website*, and those are served from a different host under `/e/<slug>` by the
 * public-site host, each carrying its own generated `robots.txt` (`packages/entity-site/src/meta.ts`)
 * that withholds indexing until the entity is actually published.
 *
 * Indexing the platform — login, signup, the builder — would put an unfinished workspace in search
 * results, so it is disallowed wholesale.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}