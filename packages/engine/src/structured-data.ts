/**
 * Structured entity representation + SEO layer (spec 21, 22, 32).
 *
 * Emits accurate schema.org JSON-LD for the published entity. Rule: structured data never
 * asserts anything that has not passed Nexora Entity's own verification rules. Values come
 * only from claims marked for publication and sources whose identity link is confirmed.
 *
 * Also produces the canonical URL, the stable identifier, sitemap entries, robots policy and
 * Open Graph metadata.
 */

import { IdentityState, SourceType } from '@nexora/core';
import type { ClaimRecord, PhotoRecord, SourceRecord } from '@nexora/db';

export interface StructuredDataInput {
  claims: ClaimRecord[];
  sources: SourceRecord[];
  /** Uploaded photos, so a representative image can be established. */
  photos?: PhotoRecord[];
  identityLinks: { source_id: string; resolved_state: IdentityState; user_decision: 'accept' | 'reject' | null }[];
}

export interface StructuredDataSummary {
  hasName: boolean;
  alternateNames: number;
  image: boolean;
  description: boolean;
  sameAs: number;
  canonicalUrl: boolean;
  stableId: boolean;
}

const SCHEMA_CONTEXT = 'https://schema.org';

/** Only claims the person has allowed to be published are ever used. */
function published(claims: ClaimRecord[]): ClaimRecord[] {
  return claims.filter((c) => c.publish && c.status !== 'rejected' && c.status !== 'conflicting');
}

function firstValue(claims: ClaimRecord[], key: string): string | null {
  const c = published(claims).find((x) => x.attribute_key === key);
  return c ? c.value_text.trim() : null;
}

function allValues(claims: ClaimRecord[], key: string): string[] {
  return published(claims)
    .filter((x) => x.attribute_key === key)
    .map((x) => x.value_text.trim())
    .filter(Boolean);
}

export function structuredDataFor(input: StructuredDataInput): StructuredDataSummary {
  return {
    hasName: Boolean(firstValue(input.claims, 'identity.primaryName')),
    alternateNames: allValues(input.claims, 'identity.alias').length,
    // A representative image must be a photo the person uploaded and that passed qualification.
    // Previously this was hardcoded false with a note that the composer would fill it in, which
    // left the machine-readable check permanently unsatisfiable.
    image: (input.photos ?? []).some((p) => p.qualifies),
    description: Boolean(firstValue(input.claims, 'about.biography') ?? firstValue(input.claims, 'about.shortBio')),
    sameAs: confirmedProfileUrls(input).length,
    canonicalUrl: true, // One canonical URL always exists per entity.
    stableId: true, // entity_uid is always present.
  };
}

/**
 * sameAs only includes external profiles whose identity link is confirmed, either
 * deterministically or by the person's explicit decision. Similar names never qualify.
 */
export function confirmedProfileUrls(input: StructuredDataInput): string[] {
  const confirmed = new Set(
    input.identityLinks
      .filter((l) => {
        // An explicit rejection by the person overrides any algorithmic state. If they have
        // said "this is not me", nothing downstream may assert otherwise — not `sameAs`,
        // not the published site. Previously a `confirmed` state short-circuited this and a
        // rejected profile was still emitted as belonging to the entity.
        if (l.user_decision === 'reject') return false;
        return l.resolved_state === IdentityState.confirmed || l.user_decision === 'accept';
      })
      .map((l) => l.source_id),
  );
  const urls = new Set<string>();
  for (const s of input.sources) {
    if (!confirmed.has(s.id)) continue;
    if (s.source_type === SourceType.selfAuthoredSite && s.registrable_domain === null) continue;
    urls.add(s.canonical_url);
  }
  return [...urls];
}

export interface PersonSchemaInput extends StructuredDataInput {
  entityUid: string;
  canonicalUrl: string;
  images: { url: string; alt: string | null; isPrimary: boolean }[];
  location: string | null;
  contact: {
    email?: string | null;
    phone?: string | null;
    bookingUrl?: string | null;
    contactPageUrl?: string | null;
  } | null;
}

export interface JsonLdGraph {
  '@context': typeof SCHEMA_CONTEXT;
  '@graph': Record<string, unknown>[];
}

/** Build the Person / ProfilePage JSON-LD graph. */
export function buildPersonSchema(input: PersonSchemaInput): JsonLdGraph {
  const claims = input.claims;
  const name = firstValue(claims, 'identity.primaryName') ?? firstValue(claims, 'identity.fullPublicName');
  const fullName = firstValue(claims, 'identity.fullPublicName');
  const preferred = fullName ? firstValue(claims, 'identity.primaryName') : null;
  const alternateNames = [
    ...new Set(allValues(claims, 'identity.alias')),
    ...(preferred && fullName && preferred !== fullName ? [preferred] : []),
  ].filter((n) => n !== name && n !== fullName);
  const headline = firstValue(claims, 'identity.headline');
  const description = firstValue(claims, 'about.shortBio') ?? firstValue(claims, 'about.biography');
  const longDescription = firstValue(claims, 'about.biography');
  const professions = allValues(claims, 'professional.profession');
  const titles = allValues(claims, 'professional.title');
  const knowsAbout = [
    ...new Set([
      ...allValues(claims, 'professional.specialisation'),
      ...allValues(claims, 'skills.skill'),
      ...allValues(claims, 'about.expertiseSummary'),
    ]),
  ];
  const languages = allValues(claims, 'skills.language');
  const education = allValues(claims, 'education.qualification').map((q) => ({ name: q }));
  const organizations = allValues(claims, 'organizations.affiliation');
  const projects = allValues(claims, 'projects.project').map((p) => ({ '@type': 'CreativeWork', name: p }));
  const products = [...allValues(claims, 'products.product'), ...allValues(claims, 'products.service')].map((p) => ({
    name: p,
  }));
  const awards = allValues(claims, 'achievements.achievement').map((a) => ({ name: a }));
  const publications = allValues(claims, 'publications.item');
  const sameAs = confirmedProfileUrls(input);
  const primaryImage = input.images.find((i) => i.isPrimary) ?? input.images[0] ?? null;

  const person: Record<string, unknown> = {
    '@type': 'Person',
    '@id': `${input.canonicalUrl}#person`,
    name,
    identifier: input.entityUid,
    url: input.canonicalUrl,
  };
  if (alternateNames.length) person.alternateName = alternateNames;
  if (headline) person.jobTitle = headline;
  else if (titles.length) person.jobTitle = titles[0];
  if (description) person.description = truncateText(description, 600);
  if (longDescription && longDescription !== description) {
    person.disambiguatingDescription = truncateText(longDescription, 1200);
  }
  if (primaryImage) {
    person.image = {
      '@type': 'ImageObject',
      url: primaryImage.url,
      ...(primaryImage.alt ? { caption: primaryImage.alt } : {}),
    };
  }
  if (sameAs.length) person.sameAs = sameAs;

  const occupations = [
    ...professions.map((p) => ({ '@type': 'Occupation', name: p })),
    ...titles.map((t) => ({ '@type': 'Occupation', name: t })),
  ];
  if (occupations.length) person.hasOccupation = occupations;
  if (knowsAbout.length) person.knowsAbout = knowsAbout;
  if (languages.length) person.knowsLanguage = languages;
  if (organizations.length) person.worksFor = organizations.map((o) => ({ '@type': 'Organization', name: o }));
  if (projects.length) person.creates = projects;
  if (products.length) person.makes = products;
  if (awards.length) person.award = awards;
  if (publications.length) person.subjectOf = publications.map((p) => ({ '@type': 'CreativeWork', name: p }));
  if (education.length) person.alumniOf = education;
  if (input.location) person.homeLocation = { '@type': 'Place', address: input.location };

  if (input.contact) {
    const contactPoints: Record<string, unknown>[] = [];
    if (input.contact.email) {
      contactPoints.push({
        '@type': 'ContactPoint',
        contactType: 'public email',
        email: input.contact.email,
        availableLanguage: languages.length ? languages : ['en'],
      });
    }
    if (input.contact.phone) contactPoints.push({ '@type': 'ContactPoint', contactType: 'telephone', telephone: input.contact.phone });
    if (input.contact.bookingUrl) contactPoints.push({ '@type': 'ContactPoint', contactType: 'booking', url: input.contact.bookingUrl });
    if (input.contact.contactPageUrl) contactPoints.push({ '@type': 'ContactPoint', contactType: 'customer service', url: input.contact.contactPageUrl });
    if (contactPoints.length) person.contactPoint = contactPoints;
  }

  const siteUrl = originOf(input.canonicalUrl);
  const profilePage: Record<string, unknown> = {
    '@type': 'ProfilePage',
    '@id': `${input.canonicalUrl}#webpage`,
    url: input.canonicalUrl,
    isPartOf: { '@type': 'WebSite', '@id': `${siteUrl}#website`, name: name ?? 'Entity Website', url: siteUrl },
    mainEntity: { '@id': `${input.canonicalUrl}#person` },
  };
  if (headline) profilePage.name = `${name} - ${headline}`;
  if (description) profilePage.description = truncateText(description, 300);
  if (primaryImage) profilePage.primaryImageOfPage = { '@type': 'ImageObject', url: primaryImage.url };

  return { '@context': SCHEMA_CONTEXT, '@graph': [person, profilePage] };
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

function truncateText(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > n * 0.6 ? lastSpace : n)}...`;
}

export interface MetaTags {
  title: string;
  description: string;
  canonical: string;
  robots: string;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
}

export function buildMeta(input: {
  name: string;
  headline: string | null;
  description: string | null;
  canonicalUrl: string;
  imageUrl: string | null;
  published: boolean;
  alternateNames: number;
}): MetaTags {
  const title = input.headline ? `${input.name} - ${input.headline}` : `${input.name} | Entity Website`;
  const description = truncateText(
    input.description ??
      `${input.name}'s public entity website: biography, work, projects, organisations and the public sources that support them.`,
    300,
  );
  const robots = input.published ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, nofollow';

  return {
    title: title.slice(0, 95),
    description,
    canonical: input.canonicalUrl,
    robots,
    openGraph: {
      'og:type': 'profile',
      'og:title': title.slice(0, 95),
      'og:description': description,
      'og:url': input.canonicalUrl,
      'og:site_name': input.name,
      ...(input.imageUrl ? { 'og:image': input.imageUrl, 'og:image:alt': input.name } : {}),
      'profile:first_name': input.name.split(' ')[0] ?? input.name,
    },
    twitter: {
      'twitter:card': input.imageUrl ? 'summary_large_image' : 'summary',
      'twitter:title': title.slice(0, 95),
      'twitter:description': description,
      ...(input.imageUrl ? { 'twitter:image': input.imageUrl, 'twitter:image:alt': input.name } : {}),
    },
  };
}

const xmlEscape = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export function buildSitemap(input: {
  canonicalUrl: string;
  lastModified: string;
  images: { url: string; title: string | null }[];
}): string {
  const imageEntries = input.images
    .map(
      (i) =>
        `    <image:image>\n      <image:loc>${xmlEscape(i.url)}</image:loc>\n` +
        (i.title ? `      <image:title>${xmlEscape(i.title)}</image:title>\n` : '') +
        '    </image:image>',
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url>
    <loc>${xmlEscape(input.canonicalUrl)}</loc>
    <lastmod>${new Date(input.lastModified).toISOString()}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>1.0</priority>
${imageEntries}
  </url>
</urlset>
`;
}

export function buildRobots(input: { sitemapUrl: string; published: boolean }): string {
  if (!input.published) {
    return '# Not published yet. This Entity Website is not available to crawlers.\nUser-agent: *\nDisallow: /\n';
  }
  return `# Entity Website sitemap\nUser-agent: *\nAllow: /\n\nSitemap: ${input.sitemapUrl}\n`;
}

/** Breadcrumb structured data for the entity site. */
export function buildBreadcrumbs(items: { name: string; url: string }[]): Record<string, unknown> {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((i, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: i.name,
      item: i.url,
    })),
  };
}
