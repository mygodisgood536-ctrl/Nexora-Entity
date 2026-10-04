/**
 * Nexora Entity Website Design System — the entity content model.
 *
 * This is the ONE design system used for every person's public Entity Website. It is not
 * regenerated per user: the components, layout, typography, imagery treatment, navigation and
 * responsive behaviour are fixed here, and verified entity data populates and adapts it.
 *
 * The composer decides, from verified information alone:
 *   - which sections appear,
 *   - which sections are collapsed or omitted,
 *   - how much content each section expands to,
 *   - how content is ordered and balanced.
 *
 * It never invents, stubs or pads content. If there is nothing verified to show, the section
 * is omitted rather than left as an empty card.
 */

export interface SiteImage {
  url: string;
  alt: string;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
  caption: string | null;
}

export interface SiteLink {
  label: string;
  url: string;
  kind: 'website' | 'profile' | 'press' | 'page' | 'project' | 'organisation' | 'other';
  /** Provenance note rendered as small print. */
  note?: string;
  host: string;
}

export interface SiteEntry {
  id: string;
  title: string;
  detail: string | null;
  period: string | null;
  current: boolean;
  url: string | null;
  /** Where this came from, for the transparent-provenance treatment. */
  provenance: {
    kind: 'user' | 'source' | 'accepted';
    label: string;
    url: string | null;
  };
  tags: string[];
}

export interface SiteSection {
  id: string;
  title: string;
  /** Anchor id used by navigation. Omitted sections never get a navigation entry. */
  anchor: string;
  /** Navigation label, or null when the section is contextual rather than navigable. */
  navLabel: string | null;
  /** Rendered heading level for document outline correctness. */
  headingLevel: 2 | 3;
  entries: SiteEntry[];
  body: string | null;
  /** Extra visual weight, used for the primary narrative section. */
  emphasis: 'primary' | 'standard' | 'compact';
}

export interface EntitySiteModel {
  /** Stable internal entity identifier. Appears in structured data, never as visible copy. */
  entityUid: string;
  /** One canonical public identity URL. */
  canonicalUrl: string;
  name: string;
  fullName: string | null;
  alternateNames: string[];
  headline: string | null;
  summary: string | null;
  biography: string | null;
  knownFor: string | null;
  location: string | null;
  /** Occupations for structured data. Kept separate from section entries so organisation
   *  names are never emitted as job titles. */
  occupations: string[];
  primaryImage: SiteImage | null;
  gallery: SiteImage[];
  /** Social and professional profiles whose identity link is confirmed. */
  profiles: SiteLink[];
  websites: SiteLink[];
  press: SiteLink[];
  sections: SiteSection[];
  contact: {
    email: string | null;
    phone: string | null;
    whatsapp: string | null;
    bookingUrl: string | null;
    contactPageUrl: string | null;
    address: string | null;
  } | null;
  /** Rendered verbatim in the footer so the reader knows what the standard means. */
  standardNotice: string;
  lastUpdated: string;
  /** True when the entity has passed the gate. Unpublished previews are noindex. */
  published: boolean;
  /** Set when the model was built from data that has not been fully reviewed. */
  draftWarnings: string[];
}

export const EMPTY_MODEL_INPUT = {
  entityUid: '',
  canonicalUrl: '',
  name: '',
  fullName: null,
  alternateNames: [],
  headline: null,
  occupations: [],
  summary: null,
  biography: null,
  knownFor: null,
  location: null,
  primaryImage: null,
  gallery: [],
  profiles: [],
  websites: [],
  press: [],
  sections: [],
  contact: null,
  lastUpdated: new Date(0).toISOString(),
  published: false,
  draftWarnings: [],
} satisfies Omit<EntitySiteModel, 'standardNotice'>;

export const STANDARD_NOTICE =
  'This website is a representation of one real person, assembled and checked by Nexora Entity. ' +
  '“Verified” means verified against Nexora Entity’s own Entity Readiness Standard. It does not mean that any search engine has verified, approved or endorsed this person, and it is not a guarantee of any search feature.';