/**
 * HTML → structured entity signals.
 *
 * Extracts, from real markup:
 *  - <title>, meta description/author, canonical link, lang
 *  - Open Graph + Twitter card metadata
 *  - every JSON-LD block (Person, ProfilePage, NewsArticle, Organization, WebSite …)
 *  - microdata items
 *  - headings, paragraphs and body text (for subject relevance and independence)
 *  - profile-ish outbound links (sameAs)
 *  - images with dimensions when the markup declares them
 */

import * as cheerio from 'cheerio';
import { normalizeText } from '@nexora/core';

export interface ExtractedPerson {
  name?: string;
  alternateName?: string[];
  jobTitle?: string;
  description?: string;
  organization?: string;
  url?: string;
  sameAs?: string[];
  address?: string;
  image?: string;
  email?: string;
  knowsAbout?: string[];
}

export interface HtmlExtraction {
  lang: string | null;
  title: string | null;
  metaDescription: string | null;
  metaAuthor: string | null;
  canonicalUrl: string | null;
  openGraph: Record<string, string>;
  twitter: Record<string, string>;
  jsonLd: Record<string, unknown>[];
  microdataPeople: ExtractedPerson[];
  headings: string[];
  text: string;
  textLength: number;
  excerpt: string;
  links: { href: string; text: string; rel: string }[];
  profileLinks: string[];
  sameAs: string[];
  images: { url: string; alt: string | null; width: number | null; height: number | null }[];
  publishedDate: string | null;
  modifiedDate: string | null;
  keywords: string[];
  isLoginWall: boolean;
  isChallengePage: boolean;
  generator: string | null;
}

const LOGIN_MARKERS = [
  'sign in to continue', 'log in to continue', 'please log in', 'you must be logged in',
  'create an account to continue', 'join to view', 'login to view', 'session expired',
  'authenticate to see this', 'this content isn\'t available',
];

const CHALLENGE_MARKERS = [
  'enable javascript and cookies to continue', 'checking your browser before accessing',
  'just a moment', 'attention required', 'access denied', 'are you a robot',
  'verify you are human', 'unusual traffic from your computer', 'ddos protection',
  'captcha', 'cf-browser-verification',
];

function flattenJsonLd(node: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(node)) {
    for (const n of node) flattenJsonLd(n, out);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  if (obj['@graph'] !== undefined) {
    flattenJsonLd(obj['@graph'], out);
    // keep the container too when it has its own @type
    if (obj['@type'] !== undefined) out.push(obj);
    return;
  }
  if (obj['@type'] !== undefined) out.push(obj);
  // Nested entity objects
  for (const key of ['mainEntity', 'mainEntityOfPage', 'author', 'publisher', 'about', 'subjectOf', 'creator']) {
    if (obj[key] !== undefined) flattenJsonLd(obj[key], out);
  }
}

function asStringArray(v: unknown): string[] {
  if (v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : extractNameFromNode(x))).filter(Boolean) as string[];
  return [typeof v === 'string' ? v : extractNameFromNode(v)].filter(Boolean) as string[];
}

function extractNameFromNode(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o['name'] === 'string') return o['name'];
  }
  return '';
}

function personFromNode(node: Record<string, unknown>): ExtractedPerson | null {
  const rawType = node['@type'];
  const types = (Array.isArray(rawType) ? rawType : [rawType]).filter(Boolean).map((t) => String(t));
  const isPerson = types.some((t) => /person|profilepage|aboutpage/i.test(t));
  if (!isPerson) return null;
  const out: ExtractedPerson = {};
  const name = extractNameFromNode(node['name']);
  if (name) out.name = name;
  const alt = asStringArray(node['alternateName']);
  if (alt.length) out.alternateName = alt;
  const title = extractNameFromNode(node['jobTitle']);
  if (title) out.jobTitle = title;
  if (typeof node['description'] === 'string') out.description = node['description'];
  const org = extractNameFromNode(node['worksFor'] ?? node['affiliation'] ?? node['memberOf']);
  if (org) out.organization = org;
  if (typeof node['url'] === 'string') out.url = node['url'];
  const sameAs = asStringArray(node['sameAs']);
  if (sameAs.length) out.sameAs = sameAs;
  const addr = node['address'];
  if (typeof addr === 'string') out.address = addr;
  else if (addr && typeof addr === 'object') {
    const a = addr as Record<string, unknown>;
    const locality = [a['addressLocality'], a['addressRegion'], a['addressCountry']]
      .map((x) => (typeof x === 'string' ? x : extractNameFromNode(x)))
      .filter(Boolean)
      .join(', ');
    if (locality) out.address = locality;
  }
  const img = node['image'];
  if (typeof img === 'string') out.image = img;
  else if (img) out.image = extractNameFromNode(img) || undefined;
  if (typeof node['email'] === 'string') out.email = node['email'];
  const knows = asStringArray(node['knowsAbout']);
  if (knows.length) out.knowsAbout = knows;
  return Object.keys(out).length ? out : null;
}

const PROFILE_HOST_HINTS =
  /(linkedin\.com|github\.com|gitlab\.com|twitter\.com|x\.com|instagram\.com|tiktok\.com|facebook\.com|youtube\.com|threads\.net|reddit\.com|pinterest\.|snapchat\.com|medium\.com|substack\.com|dev\.to|behance\.net|dribbble\.com|soundcloud\.com|spotify\.com|bandcamp\.com|kickstarter\.com|patreon\.com|orcid\.org|researchgate\.net|wikipedia\.org|stackoverflow\.com|notion\.site|cal\.com|linktr\.ee|about\.me|t\.me|mastodon|bsky\.app)/i;

export function extractHtml(html: string, baseUrl: string): HtmlExtraction {
  const $ = cheerio.load(html);
  const clean = (s: string | undefined | null): string | null => {
    if (s === undefined || s === null) return null;
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length ? t : null;
  };

  const lang = clean($('html').attr('lang'));
  const title = clean($('title').first().text());
  const metaDescription =
    clean($('meta[name="description"]').attr('content')) ?? clean($('meta[property="og:description"]').attr('content'));
  const metaAuthor =
    clean($('meta[name="author"]').attr('content')) ??
    clean($('meta[property="article:author"]').attr('content'));
  const canonicalRaw = clean($('link[rel="canonical"]').attr('href'));
  let canonicalUrl: string | null = null;
  if (canonicalRaw) {
    try {
      canonicalUrl = new URL(canonicalRaw, baseUrl).toString();
    } catch {
      canonicalUrl = canonicalRaw;
    }
  }

  const openGraph: Record<string, string> = {};
  $('meta[property^="og:"]').each((_, el) => {
    const p = $(el).attr('property');
    const c = $(el).attr('content');
    if (p && c) openGraph[p.toLowerCase()] = c.trim();
  });
  const twitter: Record<string, string> = {};
  $('meta[name^="twitter:"]').each((_, el) => {
    const p = $(el).attr('name');
    const c = $(el).attr('content');
    if (p && c) twitter[p.toLowerCase()] = c.trim();
  });

  const jsonLd: Record<string, unknown>[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw || !raw.trim()) return;
    try {
      flattenJsonLd(JSON.parse(raw), jsonLd);
    } catch {
      /* malformed JSON-LD is common in the wild; skip it honestly */
    }
  });

  const microdataPeople: ExtractedPerson[] = [];
  $('[itemtype]').each((_, el) => {
    const t = $(el).attr('itemtype') ?? '';
    if (!/person/i.test(t)) return;
    const pick = (prop: string): string | undefined => {
      const v = $(el).find(`[itemprop="${prop}"]`).first();
      if (v.length === 0) return undefined;
      const attr = v.attr('content') ?? v.attr('href') ?? v.attr('src') ?? v.text();
      return clean(attr) ?? undefined;
    };
    const person: ExtractedPerson = {};
    const name = pick('name');
    if (name) person.name = name;
    const title = pick('jobTitle');
    if (title) person.jobTitle = title;
    const desc = pick('description');
    if (desc) person.description = desc;
    const img = pick('image');
    if (img) person.image = img;
    if (Object.keys(person).length) microdataPeople.push(person);
  });

  const headings: string[] = [];
  $('h1, h2, h3').each((_, el) => {
    const t = clean($(el).text());
    if (t) headings.push(t);
  });

  // Remove non-content nodes before extracting text.
  $('script, style, noscript, svg, iframe, nav, footer, header, form, button').remove();
  const text = normalizeText($('body').text()).slice(0, 40_000);
  const textLength = text.length;
  const excerpt = text.slice(0, 600);

  const links: { href: string; text: string; rel: string }[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    let absolute: string;
    try {
      absolute = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/i.test(absolute)) return;
    links.push({ href: absolute, text: clean($(el).text()) ?? '', rel: $(el).attr('rel') ?? '' });
  });

  const profileLinks = links
    .filter((l) => PROFILE_HOST_HINTS.test(l.href) && !l.href.startsWith(baseUrl))
    .map((l) => l.href);

  const sameAs = new Set<string>();
  for (const node of jsonLd) {
    const arr = asStringArray(node['sameAs']);
    for (const s of arr) if (/^https?:/i.test(s)) sameAs.add(s);
  }
  for (const p of microdataPeople) for (const s of p.sameAs ?? []) if (/^https?:/i.test(s)) sameAs.add(s);
  for (const l of profileLinks) sameAs.add(l);
  if (openGraph['og:url']) sameAs.add(openGraph['og:url']);

  const images: HtmlExtraction['images'] = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') || $(el).attr('data-src');
    if (!src) return;
    let absolute: string;
    try {
      absolute = new URL(src, baseUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/i.test(absolute)) return;
    const w = Number.parseInt($(el).attr('width') ?? '', 10);
    const h = Number.parseInt($(el).attr('height') ?? '', 10);
    images.push({
      url: absolute,
      alt: clean($(el).attr('alt')),
      width: Number.isFinite(w) && w > 0 ? w : null,
      height: Number.isFinite(h) && h > 0 ? h : null,
    });
    if (images.length >= 40) return false;
    return undefined;
  });

  const keywordsRaw =
    clean($('meta[name="keywords"]').attr('content')) ?? clean($('meta[name="news_keywords"]').attr('content'));
  const keywords = keywordsRaw
    ? keywordsRaw.split(',').map((k) => k.trim()).filter(Boolean)
    : [];

  const publishedDate =
    clean($('meta[property="article:published_time"]').attr('content')) ??
    clean($('meta[name="date"]').attr('content')) ??
    clean($('time[datetime]').first().attr('datetime'));
  const modifiedDate =
    clean($('meta[property="article:modified_time"]').attr('content')) ??
    clean($('meta[name="last-modified"]').attr('content'));

  const head = `${title ?? ''} ${metaDescription ?? ''} ${openGraph['og:title'] ?? ''}`.toLowerCase();
  const isLoginWall = LOGIN_MARKERS.some((m) => head.includes(m));
  const isChallengePage = CHALLENGE_MARKERS.some((m) => head.includes(m));

  return {
    lang,
    title,
    metaDescription,
    metaAuthor,
    canonicalUrl,
    openGraph,
    twitter,
    jsonLd,
    microdataPeople,
    headings,
    text,
    textLength,
    excerpt,
    links,
    profileLinks,
    sameAs: [...sameAs],
    images,
    publishedDate,
    modifiedDate,
    keywords,
    isLoginWall,
    isChallengePage,
    generator: clean($('meta[name="generator"]').attr('content')),
  };
}

/** Pull every Person-ish node out of the JSON-LD graph. */
export function peopleFromJsonLd(jsonLd: Record<string, unknown>[]): ExtractedPerson[] {
  const out: ExtractedPerson[] = [];
  for (const node of jsonLd) {
    const p = personFromNode(node);
    if (p) out.push(p);
  }
  return out;
}

/** Detect a NewsArticle / BlogPosting / Article so a source can be classified as press. */
export function articleFromJsonLd(jsonLd: Record<string, unknown>[]): {
  isArticle: boolean;
  headline: string | null;
  publisher: string | null;
  author: string | null;
  datePublished: string | null;
  dateModified: string | null;
} {
  let isArticle = false;
  let headline: string | null = null;
  let publisher: string | null = null;
  let author: string | null = null;
  let datePublished: string | null = null;
  let dateModified: string | null = null;
  for (const node of jsonLd) {
    const raw = node['@type'];
    const types = (Array.isArray(raw) ? raw : [raw]).filter(Boolean).map(String);
    if (types.some((t) => /newsarticle|blogposting|article|report|pressrelease/i.test(t))) {
      isArticle = true;
    }
    if (!headline && typeof node['headline'] === 'string') headline = node['headline'];
    if (!datePublished && typeof node['datePublished'] === 'string') datePublished = node['datePublished'];
    if (!dateModified && typeof node['dateModified'] === 'string') dateModified = node['dateModified'];
    const p = extractNameFromNode(node['publisher']);
    if (!publisher && p) publisher = p;
    const a = extractNameFromNode(node['author'] ?? node['creator']);
    if (!author && a) author = a;
  }
  return { isArticle, headline, publisher, author, datePublished, dateModified };
}