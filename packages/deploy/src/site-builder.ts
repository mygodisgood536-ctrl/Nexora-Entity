/**
 * Entity site builder: database state -> composed site model -> rendered artefact.
 *
 * This is the "website generation" layer. It reads verified, published information and feeds
 * it into the pre-designed design system. It never creates facts and never fabricates copy.
 */

import type { ClaimRecord, PhotoRecord, SourceRecord } from '@nexora/db';
import { IdentityState } from '@nexora/core';
import { composeEntitySite, type ComposeInput, type TimelineFact } from '@nexora/entity-site/compose';
import type { EntitySiteModel, SiteImage, SiteLink } from '@nexora/entity-site/model';

export interface BuildSiteInput {
  entity: {
    id: string;
    entity_uid: string;
    slug: string;
    canonical_path: string;
    display_name: string | null;
    updated_at: Date;
    status: string;
  };
  canonicalUrl: string;
  claims: ClaimRecord[];
  sources: SourceRecord[];
  photos: PhotoRecord[];
  identityLinks: { source_id: string; resolved_state: IdentityState; user_decision: 'accept' | 'reject' | null }[];
  published: boolean;
  /** Absolute base for relative media URLs. */
  mediaBase: string;
  draftWarnings?: string[];
}

function texts(claims: ClaimRecord[], key: string): string[] {
  return claims.filter((c) => c.attribute_key === key && c.status !== 'rejected').map((c) => c.value_text.trim()).filter(Boolean);
}

function firstText(claims: ClaimRecord[], key: string): string | null {
  return texts(claims, key)[0] ?? null;
}

/** Split "Title, detail, 2019–present" into title/detail/period using the claim's stored fields. */
function timelineEntries(claims: ClaimRecord[], key: string): TimelineFact[] {
  return claims
    .filter((c) => c.attribute_key === key && c.status !== 'rejected')
    .map((c) => ({
      text: c.value_text.trim(),
      period: c.period_start || c.period_end ? [c.period_start, c.period_end].filter(Boolean).join(' to ') : null,
      current: c.is_current === true,
    }))
    .filter((e) => e.text.length > 0);
}

function photoUrl(photo: PhotoRecord, mediaBase: string): string {
  const base = mediaBase.replace(/\/+$/, '');
  const url = photo.public_url;
  if (url && /^https?:\/\//i.test(url)) return url;
  if (url) {
    // public_url is normally already rooted at the platform media route. Only prefix the
    // media base when it is a bare storage path.
    return url.startsWith('/media/') ? `${base.replace(/\/media$/, '')}${url}` : `${base}${url.startsWith('/') ? '' : '/'}${url}`;
  }
  return `${base}/${photo.storage_path ?? ''}`;
}

function siteImages(photos: PhotoRecord[], mediaBase: string, entitySlug: string): SiteImage[] {
  return photos
    .filter((p) => p.representation_status !== 'rejected' && p.public_url !== null)
    .map((p) => ({
      url: photoUrl(p, mediaBase),
      alt: p.alt ?? p.caption ?? `Photograph of ${entitySlug.replace(/-/g, ' ')}`,
      isPrimary: p.is_primary,
      width: p.width,
      height: p.height,
      caption: p.caption,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}

/** Only confirmed identity links may be presented as this person's profiles. */
function confirmedSources(
  sources: SourceRecord[],
  identityLinks: BuildSiteInput['identityLinks'],
): SourceRecord[] {
  const confirmed = new Set(
    identityLinks.filter((l) => l.resolved_state === IdentityState.confirmed || l.user_decision === 'accept').map((l) => l.source_id),
  );
  return sources.filter((s) => confirmed.has(s.id));
}

function toLink(source: SourceRecord): SiteLink {
  const kind: SiteLink['kind'] =
    source.platform !== null
      ? 'profile'
      : source.supplied_kind === 'press_release' || source.supplied_kind === 'news_article'
        ? 'press'
        : 'website';
  return {
    label: source.title ?? hostOf(source.canonical_url),
    url: source.canonical_url,
    kind,
    note: source.access_status === 'access_limited' ? 'Public metadata only' : undefined,
    host: hostOf(source.canonical_url),
  };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function buildEntitySite(input: BuildSiteInput): EntitySiteModel {
  const publishedClaims = input.claims.filter((c) => c.publish && c.status !== 'rejected');
  const confirmed = confirmedSources(input.sources, input.identityLinks);

  const profileSources = confirmed.filter((s) => s.declared_as_profile || s.platform !== null);
  const websiteSources = confirmed.filter((s) => s.declared_as_website || s.declared_as_page);
  const pressSources = confirmed.filter((s) => s.declared_as_press && (s.qualifies_press || s.published));

  const contactEmail = firstText(publishedClaims, 'contact.email');
  const contactPhone = firstText(publishedClaims, 'contact.phone');
  const contactWhatsapp = firstText(publishedClaims, 'contact.whatsapp');
  const bookingUrl = (() => {
    const c = publishedClaims.find((x) => x.attribute_key === 'contact.booking');
    const u = c?.value_json['url'];
    return typeof u === 'string' ? u : null;
  })();
  const contactPageUrl = (() => {
    const c = publishedClaims.find((x) => x.attribute_key === 'contact.page');
    const u = c?.value_json['url'];
    return typeof u === 'string' ? u : null;
  })();
  const address = firstText(publishedClaims, 'contact.address');

  const composeInput: ComposeInput = {
    entityUid: input.entity.entity_uid,
    canonicalUrl: input.canonicalUrl,
    publishedFacts: {
      primaryName: firstText(publishedClaims, 'identity.primaryName'),
      fullName: firstText(publishedClaims, 'identity.fullPublicName'),
      alternateNames: texts(publishedClaims, 'identity.alias'),
      headline: firstText(publishedClaims, 'identity.headline'),
      shortBio: firstText(publishedClaims, 'about.shortBio'),
      biography: firstText(publishedClaims, 'about.biography'),
      knownFor: firstText(publishedClaims, 'about.knownFor'),
      expertise: texts(publishedClaims, 'about.expertiseSummary'),
      location:
        firstText(publishedClaims, 'identity.location') ??
        publishedClaims.filter((c) => c.attribute_key.startsWith('location.')).map((c) => c.value_text)[0] ??
        null,
      professions: texts(publishedClaims, 'professional.profession'),
      titles: texts(publishedClaims, 'professional.title'),
      specialisations: texts(publishedClaims, 'professional.specialisation'),
      services: texts(publishedClaims, 'professional.service'),
      industries: texts(publishedClaims, 'professional.industry'),
      currentCompany: firstText(publishedClaims, 'professional.currentCompany'),
      founderStatus: firstText(publishedClaims, 'professional.founderStatus'),
      currentFocus: firstText(publishedClaims, 'professional.currentFocus'),
      careers: timelineEntries(publishedClaims, 'career.role'),
      education: timelineEntries(publishedClaims, 'education.qualification'),
      skills: texts(publishedClaims, 'skills.skill'),
      languages: texts(publishedClaims, 'skills.language'),
      subjectAreas: texts(publishedClaims, 'skills.subjectArea'),
      organizations: timelineEntries(publishedClaims, 'organizations.affiliation'),
      projects: timelineEntries(publishedClaims, 'projects.project'),
      products: timelineEntries(publishedClaims, 'products.product'),
      achievements: timelineEntries(publishedClaims, 'achievements.achievement'),
      publications: timelineEntries(publishedClaims, 'publications.item'),
      dates: texts(publishedClaims, 'dates.event'),
      other: texts(publishedClaims, 'other.fact'),
    },
    photos: siteImages(input.photos, input.mediaBase, input.entity.slug),
    profiles: profileSources.map(toLink),
    websites: websiteSources.map(toLink),
    press: pressSources.map(toLink),
    contact:
      contactEmail || contactPhone || contactWhatsapp || bookingUrl || contactPageUrl || address
        ? { email: contactEmail, phone: contactPhone, whatsapp: contactWhatsapp, bookingUrl, contactPageUrl, address }
        : null,
    lastUpdated: new Date(input.entity.updated_at).toISOString(),
    published: input.published,
    draftWarnings: input.draftWarnings ?? [],
  };

  return composeEntitySite(composeInput);
}