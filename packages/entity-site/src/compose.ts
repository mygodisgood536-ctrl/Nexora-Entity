/**
 * Entity content composer.
 *
 * Turns a verified entity snapshot into an EntitySiteModel: which sections exist, in what
 * order, with how much content. This is the whole of "website generation" in Nexora Entity.
 * The design system is fixed; only the data changes.
 *
 * Rules honoured here:
 *  - show a section only when there is verified content for it,
 *  - expand or contract a section with the amount of real content available,
 *  - never emit an empty section, a placeholder, or invented copy,
 *  - keep the page visually balanced by ordering sections by information value,
 *  - never surface a fact that has not passed Nexora Entity's own verification rules.
 */

import { STANDARD_NOTICE, type EntitySiteModel, type SiteEntry, type SiteImage, type SiteLink, type SiteSection } from './model';

export interface ComposeInput {
  entityUid: string;
  canonicalUrl: string;
  /** Every published claim value, already filtered to what may appear publicly. */
  publishedFacts: PublishedFacts;
  photos: SiteImage[];
  /** Confirmed external profiles, already filtered to confirmed identity links. */
  profiles: SiteLink[];
  /** Websites whose identity is confirmed. */
  websites: SiteLink[];
  /** Press sources that qualified toward the internal press minimum. */
  press: SiteLink[];
  contact: EntitySiteModel['contact'];
  lastUpdated: string;
  published: boolean;
  draftWarnings?: string[];
}

export interface PublishedFacts {
  primaryName: string | null;
  fullName: string | null;
  alternateNames: string[];
  headline: string | null;
  shortBio: string | null;
  biography: string | null;
  knownFor: string | null;
  expertise: string[];
  location: string | null;
  professions: string[];
  titles: string[];
  specialisations: string[];
  services: string[];
  industries: string[];
  currentCompany: string | null;
  founderStatus: string | null;
  currentFocus: string | null;
  careers: TimelineFact[];
  education: TimelineFact[];
  skills: string[];
  languages: string[];
  subjectAreas: string[];
  organizations: TimelineFact[];
  projects: TimelineFact[];
  products: TimelineFact[];
  achievements: TimelineFact[];
  publications: TimelineFact[];
  dates: string[];
  other: string[];
}

export interface TimelineFact {
  text: string;
  period: string | null;
  current: boolean;
  url?: string | null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function clean(list: (string | null | undefined)[]): string[] {
  return [...new Set(list.map((s) => (s ?? '').trim()).filter(Boolean))];
}

const ACCEPTED = { kind: 'accepted' as const, label: 'Confirmed by you', url: null };

function entry(
  id: string,
  title: string,
  detail: string | null,
  period: string | null,
  current: boolean,
  url: string | null,
  tags: string[] = [],
): SiteEntry {
  return { id, title, detail, period, current, url, provenance: ACCEPTED, tags: clean(tags) };
}

/** Split a composite text value into a title and a trailing detail clause. */
function splitComposite(text: string): { title: string; detail: string | null } {
  const t = text.trim();
  const dash = t.indexOf(' — ');
  const em = t.indexOf(' — ');
  const idx = dash >= 0 ? dash : em;
  if (idx > 0 && idx < t.length - 3) {
    return { title: t.slice(0, idx).trim(), detail: t.slice(idx + 3).trim() || null };
  }
  const comma = t.indexOf(', ');
  if (comma > 0 && comma < 70) {
    return { title: t.slice(0, comma).trim(), detail: t.slice(comma + 2).trim() || null };
  }
  return { title: t, detail: null };
}

function toEntries(
  items: TimelineFact[],
  prefix: string,
): SiteEntry[] {
  return items.map((item, i) => {
    const { title, detail } = splitComposite(item.text);
    const extraPeriod = item.period && item.period !== detail ? item.period : null;
    return entry(`${prefix}-${i}`, title, detail, extraPeriod, item.current, item.url ?? null);
  });
}

export function composeEntitySite(input: ComposeInput): EntitySiteModel {
  const p = input.publishedFacts;
  const warnings: string[] = [...(input.draftWarnings ?? [])];
  const sections: SiteSection[] = [];

  const primaryImage = input.photos.find((i) => i.isPrimary) ?? input.photos[0] ?? null;
  const gallery = input.photos.filter((i) => i.url !== primaryImage?.url);

  // ── About ──────────────────────────────────────────────────────────────
  const aboutEntries: SiteEntry[] = [];
  if (p.biography) aboutEntries.push(entry('about-biography', 'Biography', p.biography, null, true, null));
  if (p.knownFor && p.knownFor !== p.biography) {
    aboutEntries.push(entry('about-known-for', 'Known for', p.knownFor, null, true, null));
  }
  if (p.currentFocus) {
    aboutEntries.push(entry('about-focus', 'Currently working on', p.currentFocus, null, true, null));
  }
  if (aboutEntries.length > 0) {
    sections.push({
      id: 'about',
      title: 'About',
      anchor: 'about',
      navLabel: 'About',
      headingLevel: 2,
      entries: aboutEntries,
      body: p.shortBio ?? null,
      emphasis: aboutEntries.some((e) => e.id === 'about-biography') ? 'primary' : 'standard',
    });
  }

  // ── Professional identity ──────────────────────────────────────────────
  const identityTags = clean([...p.professions, ...p.titles]);
  const identityEntries: SiteEntry[] = [];
  if (p.currentCompany) identityEntries.push(entry('id-company', p.currentCompany, null, null, true, null));
  if (p.founderStatus) identityEntries.push(entry('id-founder', p.founderStatus, null, null, true, null));
  for (const t of clean(p.specialisations)) identityEntries.push(entry(`id-spec-${t}`, t, null, null, true, null));
  for (const s of clean(p.services)) identityEntries.push(entry(`id-service-${s}`, s, null, null, true, null));
  for (const i of clean(p.industries)) identityEntries.push(entry(`id-industry-${i}`, i, null, null, true, null));
  if (identityEntries.length > 0 || identityTags.length > 0) {
    sections.push({
      id: 'professional',
      title: 'Professional identity',
      anchor: 'professional',
      navLabel: 'Work',
      headingLevel: 2,
      entries: identityEntries,
      body: null,
      emphasis: 'standard',
    });
  }

  // ── Career and education ───────────────────────────────────────────────
  const careerEntries = toEntries(p.careers, 'career');
  if (careerEntries.length > 0) {
    sections.push({
      id: 'career',
      title: 'Career',
      anchor: 'career',
      navLabel: 'Career',
      headingLevel: 2,
      entries: careerEntries,
      body: null,
      emphasis: careerEntries.length > 3 ? 'standard' : 'compact',
    });
  }
  const educationEntries = toEntries(p.education, 'edu');
  if (educationEntries.length > 0) {
    sections.push({
      id: 'education',
      title: 'Education',
      anchor: 'education',
      navLabel: 'Education',
      headingLevel: 2,
      entries: educationEntries,
      body: null,
      emphasis: 'compact',
    });
  }

  // ── Organisations, projects and products ────────────────────────────────
  const orgEntries = toEntries(p.organizations, 'org');
  if (orgEntries.length > 0) {
    sections.push({
      id: 'organizations',
      title: 'Organisations and affiliations',
      anchor: 'organizations',
      navLabel: 'Affiliations',
      headingLevel: 2,
      entries: orgEntries,
      body: null,
      emphasis: orgEntries.length > 2 ? 'standard' : 'compact',
    });
  }
  const projectEntries = toEntries(p.projects, 'proj');
  const productEntries = toEntries(p.products, 'prod');
  if (projectEntries.length > 0 || productEntries.length > 0) {
    sections.push({
      id: 'work',
      title: 'Projects, products and services',
      anchor: 'work',
      navLabel: 'Projects',
      headingLevel: 2,
      entries: [...projectEntries, ...productEntries],
      body: null,
      emphasis: projectEntries.length + productEntries.length > 2 ? 'standard' : 'compact',
    });
  }

  // ── Achievements ───────────────────────────────────────────────────────
  const achievementEntries = toEntries(p.achievements, 'ach');
  if (achievementEntries.length > 0) {
    sections.push({
      id: 'achievements',
      title: 'Achievements and recognition',
      anchor: 'achievements',
      navLabel: 'Recognition',
      headingLevel: 2,
      entries: achievementEntries,
      body: null,
      emphasis: 'standard',
    });
  }

  // ── Publications ───────────────────────────────────────────────────────
  const publicationEntries = toEntries(p.publications, 'pub');
  if (publicationEntries.length > 0) {
    sections.push({
      id: 'publications',
      title: 'Publications and media',
      anchor: 'publications',
      navLabel: 'Writing',
      headingLevel: 2,
      entries: publicationEntries,
      body: null,
      emphasis: 'compact',
    });
  }

  // ── Skills and expertise ───────────────────────────────────────────────
  const skillTags = clean([...p.skills, ...p.expertise, ...p.subjectAreas]);
  const languageTags = clean(p.languages);
  if (skillTags.length > 0 || languageTags.length > 0) {
    sections.push({
      id: 'expertise',
      title: 'Skills and expertise',
      anchor: 'expertise',
      navLabel: 'Expertise',
      headingLevel: 2,
      entries: [
        ...skillTags.map((s, i) => entry(`skill-${i}`, s, null, null, true, null)),
        ...languageTags.map((l, i) => entry(`lang-${i}`, l, 'Language', null, true, null)),
      ],
      body: null,
      emphasis: 'compact',
    });
  }

  // ── Dates and other ────────────────────────────────────────────────────
  const otherTags = clean([...p.dates, ...p.other]);
  if (otherTags.length > 0) {
    sections.push({
      id: 'other',
      title: 'Further details',
      anchor: 'other',
      navLabel: null,
      headingLevel: 2,
      entries: otherTags.map((t, i) => {
        const { title, detail } = splitComposite(t);
        return entry(`other-${i}`, title, detail, null, true, null);
      }),
      body: null,
      emphasis: 'compact',
    });
  }

  // ── Photos ─────────────────────────────────────────────────────────────
  if (input.photos.length > 0) {
    sections.push({
      id: 'photos',
      title: 'Photos',
      anchor: 'photos',
      navLabel: null,
      headingLevel: 2,
      entries: input.photos.map((img, i) =>
        entry(`photo-${i}`, img.alt || img.caption || 'Photograph', img.caption, null, i === 0, img.url),
      ),
      body: null,
      emphasis: 'standard',
    });
  }

  // ── Press and media coverage ───────────────────────────────────────────
  if (input.press.length > 0) {
    sections.push({
      id: 'press',
      title: 'Press and media coverage',
      anchor: 'press',
      navLabel: 'Press',
      headingLevel: 2,
      entries: input.press.map((l, i) =>
        entry(`press-${i}`, l.label, l.note ?? null, null, false, l.url, [l.host]),
      ),
      body: null,
      emphasis: 'standard',
    });
  }

  // ── Confirmed profiles and websites ────────────────────────────────────
  const externalLinks = [...input.profiles, ...input.websites];
  const dedupedLinks = dedupeLinks(externalLinks);
  if (dedupedLinks.length > 0) {
    sections.push({
      id: 'presence',
      title: 'Websites and confirmed profiles',
      anchor: 'presence',
      navLabel: 'Online',
      headingLevel: 2,
      entries: dedupedLinks.map((l, i) =>
        entry(`link-${i}`, l.label, l.note ?? null, null, true, l.url, [l.host]),
      ),
      body: null,
      emphasis: dedupedLinks.length > 6 ? 'standard' : 'compact',
    });
  }

  // ── Public contact ─────────────────────────────────────────────────────
  const c = input.contact;
  if (c && (c.email || c.phone || c.whatsapp || c.bookingUrl || c.contactPageUrl || c.address)) {
    const contactEntries: SiteEntry[] = [];
    if (c.email) contactEntries.push(entry('contact-email', c.email, null, null, true, `mailto:${c.email}`));
    if (c.phone) contactEntries.push(entry('contact-phone', c.phone, null, null, true, `tel:${c.phone.replace(/[^\d+]/g, '')}`));
    if (c.whatsapp) contactEntries.push(entry('contact-whatsapp', c.whatsapp, null, null, true, `https://wa.me/${c.whatsapp.replace(/[^\d]/g, '')}`));
    if (c.bookingUrl) contactEntries.push(entry('contact-booking', 'Booking and enquiries', null, null, true, c.bookingUrl));
    if (c.contactPageUrl) contactEntries.push(entry('contact-page', 'Contact page', null, null, true, c.contactPageUrl));
    if (c.address) contactEntries.push(entry('contact-address', c.address, null, null, true, null));
    sections.push({
      id: 'contact',
      title: 'Public contact',
      anchor: 'contact',
      navLabel: 'Contact',
      headingLevel: 2,
      entries: contactEntries,
      body: null,
      emphasis: 'compact',
    });
  }

  // The public site leads with the full published name; a preferred name becomes an
  // alternate name, not the headline.
  // The public site leads with the name the person publishes under (Stage A's "Full public
  // name"), falling back to the name they gave as primary. The primary name is then kept as an
  // alternate when the two differ, so nothing recorded is hidden.
  const fullName = p.fullName?.trim() || '';
  const primaryName = p.primaryName?.trim() || '';
  const name = fullName || primaryName;
  const alternateNames = [
    ...new Set(
      [...clean(p.alternateNames), ...(primaryName && primaryName !== name ? [primaryName] : [])].filter(
        (n) => n !== name && n !== fullName,
      ),
    ),
  ];
  if (!name) warnings.push('No name has been supplied yet, so this preview has no heading.');
  if (sections.length === 0) {
    warnings.push('There is not enough verified information yet to compose any sections.');
  }

  // Navigation labels must be unique, or the masthead would show the same word twice.
  const usedLabels = new Set<string>();
  for (const s of sections) {
    if (s.navLabel === null) continue;
    if (!usedLabels.has(s.navLabel)) {
      usedLabels.add(s.navLabel);
      continue;
    }
    s.navLabel = uniqueLabel(s, usedLabels);
    usedLabels.add(s.navLabel);
  }

  // Balance: order sections by information value.
  const order = [
    'about',
    'professional',
    'work',
    'organizations',
    'career',
    'achievements',
    'publications',
    'education',
    'expertise',
    'photos',
    'press',
    'presence',
    'contact',
    'other',
  ];
  sections.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  return {
    entityUid: input.entityUid,
    canonicalUrl: input.canonicalUrl,
    name,
    fullName: p.fullName,
    alternateNames,
    headline: p.headline,
    occupations: clean([...p.professions, ...p.titles, ...p.specialisations]),
    summary: p.shortBio ?? firstSentence(p.biography),
    biography: p.biography,
    knownFor: p.knownFor,
    location: p.location,
    primaryImage,
    gallery,
    profiles: input.profiles,
    websites: input.websites,
    press: input.press,
    sections,
    contact: input.contact,
    standardNotice: STANDARD_NOTICE,
    lastUpdated: input.lastUpdated,
    published: input.published,
    draftWarnings: warnings,
  };
}

function dedupeLinks(links: SiteLink[]): SiteLink[] {
  const seen = new Set<string>();
  const out: SiteLink[] = [];
  for (const l of links) {
    const key = l.url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }
  return out;
}

/** Give a colliding navigation label a distinct name, preferring the section's own title. */
function uniqueLabel(section: SiteSection, used: Set<string>): string {
  const candidates = [section.title, `${section.title} details`, `${section.navLabel ?? ''} details`];
  for (const c of candidates) {
    const label = c.trim();
    if (label && !used.has(label)) return label;
  }
  let n = 2;
  const base = section.title || section.id;
  while (used.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

export function firstSentence(text: string | null): string | null {
  if (!text) return null;
  const t = text.trim();
  // Whitespace-only text carries no sentence: returning "" would put an empty string where a
  // caller expects either real copy or nothing.
  if (!t) return null;
  const m = /^(.+?[.!?])(\s|$)/.exec(t);
  if (!m?.[1]) return t.length > 240 ? `${t.slice(0, 237)}...` : t;
  return m[1].length <= 300 ? m[1] : `${m[1].slice(0, 297)}...`;
}

/** Navigation entries: only sections that opted in and actually have content. */
export function navigationFor(model: EntitySiteModel): { label: string; href: string }[] {
  return model.sections
    .filter((s) => s.navLabel !== null && (s.entries.length > 0 || s.body))
    .map((s) => ({ label: s.navLabel as string, href: `#${s.anchor}` }));
}

export { hostOf };