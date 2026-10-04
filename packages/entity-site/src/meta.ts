/**
 * Metadata + structured data for the Entity Website.
 *
 * Every value traces back to a published claim or a confirmed source. Structured data never
 * asserts anything that has not passed Nexora Entity's own verification rules, and it never
 * implies verification by any search engine.
 */

import type { EntitySiteModel, SiteLink } from './model';

export interface StructuredDataNode {
  [key: string]: unknown;
}

export interface MetaBundle {
  title: string;
  description: string;
  canonicalUrl: string;
  robots: string;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  jsonLd: StructuredDataNode[];
}

function abs(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export function buildMeta(model: EntitySiteModel): MetaBundle {
  const base = model.canonicalUrl;
  const name = model.name;
  const title = model.headline ? `${name} — ${model.headline}` : `${name} | Public entity`;
  const description =
    model.summary ??
    (model.headline
      ? `${name}. ${model.headline}. Biography, work, projects, organisations and the public sources that support them.`
      : `The public entity website of ${name}: biography, work, projects, organisations and the public sources that support them.`);

  const primaryImage = model.primaryImage ? abs(model.primaryImage.url, base) : null;

  return {
    title: title.slice(0, 110),
    description: truncate(description, 300),
    canonicalUrl: base,
    robots: model.published
      ? 'index, follow, max-image-preview:large, max-snippet:-1'
      : 'noindex, nofollow',
    openGraph: {
      'og:type': 'profile',
      'og:title': title.slice(0, 110),
      'og:description': truncate(description, 300),
      'og:url': base,
      'og:site_name': name,
      ...(primaryImage ? { 'og:image': primaryImage, 'og:image:alt': model.primaryImage?.alt ?? name } : {}),
      'profile:first_name': name.split(' ')[0] ?? name,
    },
    twitter: {
      'twitter:card': primaryImage ? 'summary_large_image' : 'summary',
      'twitter:title': title.slice(0, 110),
      'twitter:description': truncate(description, 300),
      ...(primaryImage ? { 'twitter:image': primaryImage, 'twitter:image:alt': name } : {}),
    },
    jsonLd: buildStructuredData(model),
  };
}

/**
 * Person + ProfilePage JSON-LD.
 *
 * `sameAs` contains only profiles whose identity link Nexora Entity confirmed. Profiles that
 * were merely found, or that a person has not confirmed, are never asserted as the same person.
 */
export function buildStructuredData(model: EntitySiteModel): StructuredDataNode[] {
  const base = model.canonicalUrl;
  const person: StructuredDataNode = {
    '@type': 'Person',
    '@id': `${base}#person`,
    name: model.name,
    identifier: model.entityUid,
    url: base,
  };

  if (model.fullName && model.fullName !== model.name) person.alsoKnownAs = model.fullName;
  if (model.alternateNames.length > 0) person.alternateName = model.alternateNames;
  if (model.headline) person.jobTitle = model.headline;
  if (model.summary) person.description = truncate(model.summary, 600);
  if (model.biography && model.biography !== model.summary) {
    person.disambiguatingDescription = truncate(model.biography, 1200);
  }
  if (model.location) person.homeLocation = { '@type': 'Place', address: model.location };

  const primaryImage = model.primaryImage;
  if (primaryImage) {
    person.image = { '@type': 'ImageObject', url: abs(primaryImage.url, base), caption: primaryImage.alt };
  }

  const sameAs = [...model.profiles, ...model.websites]
    .map((l: SiteLink) => abs(l.url, base))
    .filter((u) => /^https?:\/\//i.test(u));
  if (sameAs.length > 0) person.sameAs = [...new Set(sameAs)];

  // Occupations come from a dedicated list so organisation names are never emitted as job titles.
  const occupations = model.occupations.slice(0, 8).map((name) => ({ '@type': 'Occupation', name }));
  if (occupations.length > 0) person.hasOccupation = occupations;

  const expertise = sectionEntries(model, 'expertise', (t) => t.length < 60);
  if (expertise.length > 0) person.knowsAbout = expertise.slice(0, 20);

  const employers = sectionEntries(model, 'career', (t) => t.length < 120).slice(0, 10);
  if (employers.length > 0) {
    person.worksFor = employers.map((name) => ({ '@type': 'Organization', name }));
  }

  const orgs = sectionEntries(model, 'organizations', (t) => t.length < 120).slice(0, 10);
  if (orgs.length > 0) {
    person.worksFor = [...((person.worksFor as StructuredDataNode[] | undefined) ?? []), ...orgs.map((name) => ({ '@type': 'Organization', name }))];
  }

  const work = sectionEntries(model, 'work', (t) => t.length < 160).slice(0, 20);
  if (work.length > 0) person.creates = work.map((name) => ({ '@type': 'CreativeWork', name }));

  const awards = sectionEntries(model, 'achievements', (t) => t.length < 160).slice(0, 12);
  if (awards.length > 0) person.award = awards.map((name) => ({ name }));

  const education = sectionEntries(model, 'education', (t) => t.length < 160).slice(0, 8);
  if (education.length > 0) person.alumniOf = education.map((name) => ({ name }));

  const publications = sectionEntries(model, 'publications', (t) => t.length < 200).slice(0, 20);
  if (publications.length > 0) person.subjectOf = publications.map((name) => ({ '@type': 'CreativeWork', name }));

  if (model.contact?.email) {
    person.contactPoint = [
      {
        '@type': 'ContactPoint',
        contactType: 'public email',
        email: model.contact.email,
      },
    ];
  }

  const profilePage: StructuredDataNode = {
    '@type': 'ProfilePage',
    '@id': `${base}#webpage`,
    url: base,
    isPartOf: { '@type': 'WebSite', '@id': `${originOf(base)}#website`, name: model.name, url: originOf(base) },
    mainEntity: { '@id': `${base}#person` },
  };
  if (model.headline) profilePage.name = `${model.name} — ${model.headline}`;
  if (model.summary) profilePage.description = truncate(model.summary, 300);
  if (primaryImage) profilePage.primaryImageOfPage = { '@type': 'ImageObject', url: abs(primaryImage.url, base) };

  return [person, profilePage];
}

function sectionEntries(model: EntitySiteModel, sectionId: string, filter: (t: string) => boolean): string[] {
  const section = model.sections.find((s) => s.id === sectionId);
  if (!section) return [];
  return section.entries.map((e) => e.title).filter((t) => t.trim().length > 0 && filter(t));
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > n * 0.6 ? lastSpace : n).trim()}...`;
}

export function buildSitemapXml(model: EntitySiteModel): string {
  const esc = escapeXml;
  const images = [model.primaryImage, ...model.gallery]
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .map((img) => {
      const url = abs(img.url, model.canonicalUrl);
      return `    <image:image>\n      <image:loc>${esc(url)}</image:loc>\n${img.alt ? `      <image:title>${esc(img.alt)}</image:title>\n` : ''}    </image:image>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${esc(model.canonicalUrl)}</loc>
    <lastmod>${new Date(model.lastUpdated).toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
${images}
  </url>
</urlset>
`;
}

export function buildRobotsTxt(model: EntitySiteModel, sitemapUrl: string): string {
  if (!model.published) {
    return `# This Entity Website is not published yet, so it is not available to crawlers.\nUser-agent: *\nDisallow: /\n`;
  }
  return `# Public entity website\nUser-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildSecurityTxt(model: EntitySiteModel, contactEmail: string | null): string {
  const lines = ['# Nexora Entity public identity site', `Contact: ${contactEmail ? `mailto:${contactEmail}` : 'https://nexoraentity.com/contact'}`];
  return `${lines.join('\n')}\n`;
}