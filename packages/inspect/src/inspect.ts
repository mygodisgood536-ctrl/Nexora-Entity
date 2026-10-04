/**
 * Source inspection orchestrator.
 *
 * Performs the real work: fetch → parse → platform connector → structured observations.
 * The result always states what actually happened, including limitations.
 */

import { createLogger, sha256Hex, AccessStatus, SourceType, normalizeText } from '@nexora/core';
import { fetchUrl, type FetchFailure } from './http';
import { extractHtml, peopleFromJsonLd, articleFromJsonLd, type HtmlExtraction, type ExtractedPerson } from './html';
import { detectPlatform, fetchPlatformData, type PlatformId, type PlatformData } from './platforms';

const log = createLogger('inspect:orchestrator');

interface ArticleInfo {
  isArticle: boolean;
  headline: string | null;
  publisher: string | null;
  author: string | null;
  datePublished: string | null;
  dateModified: string | null;
}

export interface InspectionResult {
  url: string;
  finalUrl: string | null;
  httpStatus: number | null;
  redirects: { from: string; to: string; status: number }[];
  contentType: string | null;
  accessStatus: AccessStatus;
  accessDetail: string | null;
  inspected: boolean;
  checkError: string | null;
  title: string | null;
  description: string | null;
  author: string | null;
  publishedDate: string | null;
  modifiedDate: string | null;
  textExcerpt: string | null;
  textLength: number;
  contentHash: string | null;
  extracted: {
    names: string[];
    alternateNames: string[];
    headline: string | null;
    organisation: string | null;
    location: string | null;
    description: string | null;
    images: { url: string; alt: string | null; width: number | null; height: number | null }[];
    profileLinks: string[];
    sameAs: string[];
    jsonLdTypes: string[];
    keywords: string[];
    emails: string[];
    isArticle: boolean;
    articlePublisher: string | null;
    loginWall: boolean;
    challengePage: boolean;
    headings: string[];
    /** Set when a platform connector could not read a profile it recognises. */
    platformDataUnavailable?: boolean;
  };
  platform: PlatformId | null;
  platformHandle: string | null;
  platformNote: string | null;
  platformData: PlatformData | null;
  isPersonalSite: boolean;
  elapsedMs: number;
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

function isPersonalSiteUrl(url: string): boolean {
  const c = detectPlatform(url);
  if (c) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const host = u.hostname.replace(/^www\./, '');
  // A single-label host like "cornelius.dev" is very likely the person's own site.
  return host.split('.').length <= 2 || /(^|\.)(me|dev|io|co|site|online|page|link|life|works|network|page|studio)([.\-/]|$)/i.test(host);
}

export async function inspectUrl(url: string): Promise<InspectionResult> {
  const started = Date.now();
  const base: InspectionResult = {
    url,
    finalUrl: null,
    httpStatus: null,
    redirects: [],
    contentType: null,
    accessStatus: 'pending',
    accessDetail: null,
    inspected: false,
    checkError: null,
    title: null,
    description: null,
    author: null,
    publishedDate: null,
    modifiedDate: null,
    textExcerpt: null,
    textLength: 0,
    contentHash: null,
    extracted: {
      names: [], alternateNames: [], headline: null, organisation: null, location: null,
      description: null, images: [], profileLinks: [], sameAs: [], jsonLdTypes: [], keywords: [],
      emails: [], isArticle: false, articlePublisher: null, loginWall: false, challengePage: false,
      headings: [],
    },
    platform: null,
    platformHandle: null,
    platformNote: null,
    platformData: null,
    isPersonalSite: false,
    elapsedMs: 0,
  };

  const res = await fetchUrl(url);
  base.redirects = res.redirects;

  if (!res.ok) {
    const f = res as FetchFailure;
    base.accessStatus = f.accessStatus;
    base.accessDetail = f.accessDetail;
    base.httpStatus = f.status ?? null;
    base.finalUrl = f.finalUrl ?? null;
    base.inspected = false;
    base.checkError = f.accessDetail;
    base.elapsedMs = Date.now() - started;
    const detected = detectPlatform(url);
    if (detected) {
      base.platform = detected.platform.id;
      base.platformHandle = detected.handle;
      base.platformNote = detected.platform.access.note;
    }
    log.info('inspection could not read source', { url, accessStatus: f.accessStatus });
    return base;
  }

  base.finalUrl = res.finalUrl;
  base.httpStatus = res.status;
  base.contentType = res.contentType || null;
  base.accessStatus = 'accessible';
  base.accessDetail = null;

  const isHtml = /html/i.test(res.contentType) || res.contentType === '';
  const bodyText = Buffer.from(res.body).toString('utf8');
  let people: ExtractedPerson[] = [];
  let article: ArticleInfo = { isArticle: false, headline: null, publisher: null, author: null, datePublished: null, dateModified: null };

  if (isHtml && bodyText.length > 0) {
    let html: HtmlExtraction;
    try {
      html = extractHtml(bodyText, res.finalUrl);
    } catch (err) {
      base.checkError = err instanceof Error ? err.message : 'HTML could not be parsed';
      base.inspected = false;
      base.elapsedMs = Date.now() - started;
      return base;
    }

    base.title = html.title ?? html.openGraph['og:title'] ?? null;
    base.description = html.metaDescription ?? html.openGraph['og:description'] ?? null;
    base.author = html.metaAuthor ?? html.openGraph['article:author'] ?? null;
    base.publishedDate = html.publishedDate;
    base.modifiedDate = html.modifiedDate;
    base.textLength = html.textLength;
    base.textExcerpt = html.excerpt || null;
    base.contentHash = sha256Hex(html.text.slice(0, 20_000));

    people = [...peopleFromJsonLd(html.jsonLd), ...html.microdataPeople];
    article = articleFromJsonLd(html.jsonLd);

    base.extracted = {
      names: people.map((p) => p.name).filter((n): n is string => !!n),
      alternateNames: people.flatMap((p) => p.alternateName ?? []),
      headline: people.find((p) => p.jobTitle)?.jobTitle ?? html.openGraph['og:title'] ?? null,
      organisation: people.find((p) => p.organization)?.organization ?? null,
      location: people.find((p) => p.address)?.address ?? null,
      description: people.find((p) => p.description)?.description ?? base.description,
      images: [
        ...html.images,
        ...(html.openGraph['og:image'] ? [{ url: html.openGraph['og:image'], alt: null, width: null, height: null }] : []),
        ...(html.twitter['twitter:image'] ? [{ url: html.twitter['twitter:image'], alt: null, width: null, height: null }] : []),
      ],
      profileLinks: html.profileLinks,
      sameAs: html.sameAs,
      jsonLdTypes: [
        ...new Set(
          html.jsonLd.flatMap((n) => {
            const t = n['@type'];
            return (Array.isArray(t) ? t : t ? [String(t)] : []).map(String);
          }),
        ),
      ],
      keywords: html.keywords,
      emails: [...new Set((`${html.text} ${bodyText.match(EMAIL_RE)?.join(' ') ?? ''}`.match(EMAIL_RE) ?? []).map((e) => e.toLowerCase()))].slice(0, 10),
      isArticle: article.isArticle,
      articlePublisher: article.publisher,
      loginWall: html.isLoginWall,
      challengePage: html.isChallengePage,
      headings: html.headings.slice(0, 30),
    };

    if (html.isChallengePage) {
      base.accessStatus = 'blocked';
      base.accessDetail =
        'The site served a bot-protection challenge page instead of the real content, so the profile could not be read.';
      base.inspected = false;
    } else if (html.isLoginWall) {
      base.accessStatus = 'access_limited';
      base.accessDetail =
        'The site asks visitors to sign in before showing content, so only public metadata was read.';
    }

    if (!base.author && article.author) base.author = article.author;
    if (!base.publishedDate && article.datePublished) base.publishedDate = article.datePublished;
    if (!base.title && article.headline) base.title = article.headline;
  } else {
    // JSON or plain text: record honestly.
    base.textLength = bodyText.length;
    base.textExcerpt = bodyText.slice(0, 600);
    base.contentHash = sha256Hex(bodyText.slice(0, 20_000));
    if (isHtml) base.inspected = true;
    else {
      base.accessDetail = `The address returns ${res.contentType}, which has no public page structure to inspect.`;
    }
  }

  const detected = detectPlatform(res.finalUrl ?? url);
  if (detected) {
    base.platform = detected.platform.id;
    base.platformHandle = detected.handle;
    base.platformNote = detected.platform.access.note;
    base.isPersonalSite = false;
    if (base.accessStatus === 'accessible') {
      const connector = await fetchPlatformData(res.finalUrl ?? url);
      base.platformData = connector.data;
      if (!connector.ok && connector.limitation) {
        base.platformNote = connector.limitation;
        // A platform connector that cannot read is not a failure of the page fetch, but the
        // profile facts are explicitly not treated as verified.
        base.extracted.platformDataUnavailable = true;
      }
    }
  } else {
    base.isPersonalSite = isPersonalSiteUrl(res.finalUrl ?? url);
  }

  base.inspected = base.accessStatus === 'accessible' || base.accessStatus === 'access_limited';
  base.elapsedMs = Date.now() - started;
  log.info('inspection complete', {
    url: res.finalUrl,
    status: res.status,
    access: base.accessStatus,
    platform: base.platform,
    names: base.extracted.names.length,
  });
  return base;
}

/** Map an inspection result to a SourceType using real signals. */
export function classifySourceType(input: {
  inspection: InspectionResult;
  declaredKind: string;
}): SourceType {
  const { inspection, declaredKind } = input;
  if (inspection.platform) {
    const p = inspection.platform;
    if (p === 'github' || p === 'gitlab' || p === 'stackoverflow') return SourceType.projectSite;
    if (p === 'linkedin' || p === 'orcid' || p === 'researchgate') return SourceType.professionalProfile;
    if (['youtube', 'instagram', 'tiktok', 'x', 'facebook', 'threads', 'pinterest', 'snapchat', 'mastodon', 'bluesky', 'reddit', 'medium', 'substack', 'devto', 'behance', 'dribbble', 'soundcloud', 'spotify', 'bandcamp', 'producthunt'].includes(p)) {
      return SourceType.creatorProfile;
    }
  }
  if (inspection.extracted.isArticle) {
    return inspection.platform ? SourceType.creatorProfile : SourceType.independentPublication;
  }
  switch (declaredKind) {
    case 'press_release':
    case 'news_article':
      return SourceType.independentPublication;
    case 'organization_site':
      return SourceType.organizationSite;
    case 'project_site':
      return SourceType.projectSite;
    case 'author_page':
      return SourceType.projectSite;
    case 'portfolio_site':
    case 'professional_site':
    case 'personal_site':
      return SourceType.selfAuthoredSite;
    case 'portfolio_url':
      return SourceType.userDocument;
    case 'social_profile':
      return SourceType.socialProfile;
    case 'professional_profile':
      return SourceType.professionalProfile;
    case 'public_page':
      return SourceType.projectSite;
    default:
      return inspection.isPersonalSite ? SourceType.selfAuthoredSite : SourceType.other;
  }
}

/** Detect obvious press-wire / syndicated distribution so independence can be judged. */
const WIRE_HOSTS = [
  'prnewswire.com', 'businesswire.com', 'globenewswire.com', 'einpresswire.com',
  'newsfilecorp.com', 'accesswire.com', 'prweb.com', 'openpr.com', 'newsfile.com',
  'marketscreener.com', 'reuters.com', 'apnews.com',
];

export function looksLikePressWire(host: string | null): boolean {
  if (!host) return false;
  return WIRE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** Build a stable fingerprint for independence grouping. */
export function contentFingerprint(input: {
  title: string | null;
  text: string | null;
  platform: PlatformId | null;
  host: string | null;
}): { group: string; tokenCount: number } {
  const titleTokens = normalizeText(input.title ?? '').split(' ').filter((t) => t.length > 3);
  const textTokens = normalizeText(input.text ?? '').split(' ').filter((t) => t.length > 4);
  const seed = [...titleTokens, ...textTokens.slice(0, 400)].join(' ');
  return { group: sha256Hex(seed).slice(0, 24), tokenCount: new Set(textTokens).size };
}