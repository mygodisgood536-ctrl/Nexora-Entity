import { describe, expect, it } from 'vitest';
import { articleFromJsonLd, extractHtml, peopleFromJsonLd } from '../src/html';

const BASE = 'https://example.com/ada';

function page(body: string, head = ''): string {
  return `<!doctype html><html lang="en"><head>${head}</head><body>${body}</body></html>`;
}

describe('extractHtml: basics', () => {
  it('reads the title, language and description', () => {
    const r = extractHtml(
      page('<p>Hello</p>', '<title>Ada Lovelace</title><meta name="description" content="About Ada.">'),
      BASE,
    );
    expect(r.title).toBe('Ada Lovelace');
    expect(r.lang).toBe('en');
    expect(r.metaDescription).toBe('About Ada.');
  });

  it('survives a page with no head content at all', () => {
    const r = extractHtml('<p>Just a body.</p>', BASE);
    expect(r.title).toBeNull();
    expect(r.lang).toBeNull();
    expect(r.metaDescription).toBeNull();
    expect(r.text).toContain('just a body');
  });

  it('handles completely empty input without throwing', () => {
    expect(() => extractHtml('', BASE)).not.toThrow();
    expect(extractHtml('', BASE).text).toBe('');
  });

  it('resolves a relative canonical URL against the page URL', () => {
    const r = extractHtml(page('<p>x</p>', '<link rel="canonical" href="/ada/canonical">'), BASE);
    expect(r.canonicalUrl).toBe('https://example.com/ada/canonical');
  });

  it('accepts an absolute canonical URL unchanged', () => {
    const r = extractHtml(page('<p>x</p>', '<link rel="canonical" href="https://other.example/ada">'), BASE);
    expect(r.canonicalUrl).toBe('https://other.example/ada');
  });
});

describe('extractHtml: Open Graph and Twitter', () => {
  it('collects Open Graph properties', () => {
    const r = extractHtml(
      page('<p>x</p>', '<meta property="og:title" content="Ada"><meta property="og:type" content="profile">'),
      BASE,
    );
    expect(r.openGraph['og:title']).toBe('Ada');
    expect(r.openGraph['og:type']).toBe('profile');
  });

  it('collects Twitter card properties', () => {
    const r = extractHtml(page('<p>x</p>', '<meta name="twitter:card" content="summary">'), BASE);
    expect(r.twitter['twitter:card']).toBe('summary');
  });

  it('returns empty maps rather than throwing when none exist', () => {
    const r = extractHtml(page('<p>x</p>'), BASE);
    expect(r.openGraph).toEqual({});
    expect(r.twitter).toEqual({});
  });
});

describe('extractHtml: JSON-LD', () => {
  it('reads a Person node with the expected fields', () => {
    const ld = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: 'Ada Lovelace',
      jobTitle: 'Mathematician',
      description: 'Wrote the first algorithm.',
      sameAs: ['https://github.com/example'],
    });
    const r = extractHtml(page('<p>x</p>', `<script type="application/ld+json">${ld}</script>`), BASE);
    const people = peopleFromJsonLd(r.jsonLd);
    expect(people.length).toBeGreaterThan(0);
    expect(people[0]?.name).toBe('Ada Lovelace');
    expect(people[0]?.jobTitle).toBe('Mathematician');
    expect(people[0]?.sameAs).toContain('https://github.com/example');
  });

  it('skips malformed JSON-LD instead of failing the whole page', () => {
    const good = JSON.stringify({ '@type': 'Person', name: 'Ada Lovelace' });
    const r = extractHtml(
      page('<p>x</p>', `<script type="application/ld+json">{ this is not json </script><script type="application/ld+json">${good}</script>`),
      BASE,
    );
    expect(peopleFromJsonLd(r.jsonLd).length).toBe(1);
  });

  it('reads an Article node', () => {
    const ld = JSON.stringify({
      '@type': 'NewsArticle',
      headline: 'Profile of Ada Lovelace',
      author: [{ '@type': 'Person', name: 'Ada Lovelace' }],
      publisher: { '@type': 'Organization', name: 'The Daily Example' },
      datePublished: '2024-05-01',
    });
    const r = extractHtml(page('<p>x</p>', `<script type="application/ld+json">${ld}</script>`), BASE);
    const article = articleFromJsonLd(r.jsonLd);
    expect(article?.headline).toBe('Profile of Ada Lovelace');
    expect(article?.publisher).toBe('The Daily Example');
    expect(article?.isArticle).toBe(true);
  });

  it('reports no article for a page with none', () => {
    const r = extractHtml(page('<p>x</p>'), BASE);
    const article = articleFromJsonLd(r.jsonLd);
    expect(article.isArticle).toBe(false);
    expect(article.headline).toBeNull();
  });

  it('flattens @graph arrays', () => {
    const ld = JSON.stringify({ '@graph': [{ '@type': 'Person', name: 'Ada Lovelace' }] });
    const r = extractHtml(page('<p>x</p>', `<script type="application/ld+json">${ld}</script>`), BASE);
    expect(peopleFromJsonLd(r.jsonLd).length).toBe(1);
  });
});

describe('extractHtml: microdata', () => {
  it('reads a Person marked up with itemprop attributes', () => {
    const r = extractHtml(
      page(`
        <div itemscope itemtype="https://schema.org/Person">
          <span itemprop="name">Ada Lovelace</span>
          <span itemprop="jobTitle">Mathematician</span>
          <img itemprop="image" src="/ada.jpg" alt="Portrait">
        </div>
      `),
      BASE,
    );
    expect(r.microdataPeople.length).toBe(1);
    expect(r.microdataPeople[0]?.name).toBe('Ada Lovelace');
    expect(r.microdataPeople[0]?.jobTitle).toBe('Mathematician');
  });
});

describe('extractHtml: links and images', () => {
  it('resolves relative links to absolute URLs', () => {
    const r = extractHtml(page('<a href="/about">About</a>'), BASE);
    expect(r.links.some((l) => l.href === 'https://example.com/about')).toBe(true);
  });

  it('drops non-http links such as mailto and javascript', () => {
    const r = extractHtml(page('<a href="mailto:a@b.c">Mail</a><a href="javascript:void(0)">JS</a>'), BASE);
    expect(r.links.filter((l) => l.href.startsWith('mailto:')).length).toBe(0);
    expect(r.links.filter((l) => l.href.startsWith('javascript:')).length).toBe(0);
  });

  it('identifies profile links on known platforms', () => {
    const r = extractHtml(page('<a href="https://github.com/example">Profile</a>'), BASE);
    expect(r.profileLinks).toContain('https://github.com/example');
  });

  it('does not treat a self-link as a separate profile', () => {
    const r = extractHtml(page('<a href="https://example.com/me">Me</a>'), 'https://example.com/me');
    expect(r.profileLinks).toEqual([]);
  });

  it('reads image dimensions when declared and null otherwise', () => {
    const r = extractHtml(
      page('<img src="/a.jpg" width="800" height="600" alt="A"><img src="/b.jpg">'),
      BASE,
    );
    const withDims = r.images.find((i) => i.url.endsWith('/a.jpg'));
    const without = r.images.find((i) => i.url.endsWith('/b.jpg'));
    expect(withDims?.width).toBe(800);
    expect(withDims?.height).toBe(600);
    expect(without?.width).toBeNull();
    expect(without?.height).toBeNull();
  });

  it('reads a lazy-loaded image source', () => {
    const r = extractHtml(page('<img data-src="/lazy.jpg" alt="Lazy">'), BASE);
    expect(r.images.some((i) => i.url.endsWith('/lazy.jpg'))).toBe(true);
  });
});

describe('extractHtml: text extraction', () => {
  it('excludes script and style content from the text', () => {
    const r = extractHtml(
      page('<script>var secret=1</script><style>.a{color:red}</style><p>Real content.</p>'),
      BASE,
    );
    expect(r.text).not.toContain('secret');
    expect(r.text).not.toContain('color:red');
    expect(r.text).toContain('real content');
  });

  it('reads headings in document order', () => {
    const r = extractHtml(page('<h1>One</h1><h2>Two</h2><h3>Three</h3>'), BASE);
    expect(r.headings).toEqual(['One', 'Two', 'Three']);
  });

  it('produces an excerpt that is a prefix of the text', () => {
    const long = 'word '.repeat(500);
    const r = extractHtml(page(`<p>${long}</p>`), BASE);
    expect(r.text.startsWith(r.excerpt)).toBe(true);
  });

  it('caps the extracted text so a huge page cannot exhaust memory', () => {
    const huge = 'a'.repeat(200_000);
    const r = extractHtml(page(`<p>${huge}</p>`), BASE);
    expect(r.text.length).toBeLessThanOrEqual(40_000);
  });
});

describe('extractHtml: hostile input', () => {
  it('does not execute or leak content from a script tag with a JSON-LD type', () => {
    const r = extractHtml(
      page('<p>x</p>', '<script type="application/ld+json">{"@type":"Person","name":"<script>alert(1)</script>"}</script>'),
      BASE,
    );
    expect(JSON.stringify(r)).not.toContain('alert(1)');
  });

  it('tolerates an unclosed tag', () => {
    expect(() => extractHtml('<div><p>unclosed', BASE)).not.toThrow();
  });

  it('tolerates mismatched nesting', () => {
    expect(() => extractHtml('<p><div>bad</p></div>', BASE)).not.toThrow();
  });

  it('never throws on arbitrary junk', () => {
    for (const junk of ['<<<>>>', ' ', '{{{{', '<!--', '"', "'"]) {
      expect(() => extractHtml(junk, BASE)).not.toThrow();
    }
  });
});
