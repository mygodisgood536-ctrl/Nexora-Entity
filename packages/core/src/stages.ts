/**
 * Guided stage catalogue (Amendment §4 — stages A..W).
 *
 * Each stage declares:
 *  - the information it collects,
 *  - whether the information is materially necessary for complete entity understanding,
 *    recommended, or one of the hard Nexora Entity evidence minimums,
 *  - what the platform tells the person when they skip it,
 *  - the user-facing copy (normal language — never entity-resolution jargon).
 */

import { StageRequirement, type StageKey } from './vocabulary';

export interface StageField {
  key: string;
  label: string;
  kind:
    | 'text'
    | 'longtext'
    | 'url'
    | 'url_list'
    | 'date'
    | 'month_year'
    | 'period'
    | 'list'
    | 'tags'
    | 'photo'
    | 'file'
    | 'boolean';
  placeholder?: string;
  help?: string;
  optional?: boolean;
  /** Only meaningful for repeatable stages. */
  itemLabel?: string;
}

export interface StageDefinition {
  key: StageKey;
  letter: string;
  title: string;
  /** Short, warm description shown at the top of the stage. */
  summary: string;
  requirement: StageRequirement;
  /** Why this stage exists — used by the completeness engine when explaining a gap. */
  whyItMatters: string;
  fields: StageField[];
  /** Copy shown on the Skip button. */
  skipCopy: string;
}

const field = (
  key: string,
  label: string,
  kind: StageField['kind'],
  extra: Partial<StageField> = {},
): StageField => ({ key, label, kind, ...extra });

export const STAGES: StageDefinition[] = [
  {
    key: 'A_identity',
    letter: 'A',
    title: 'Basic identity',
    summary: 'How you are publicly known.',
    requirement: StageRequirement.material,
    whyItMatters:
      'Your name, headline and location are the first things any reader — human or machine — uses to recognise you. Without them your entity cannot be told apart from anyone else.',
    skipCopy: 'Skip for now — we will ask for this before your site can go live.',
    fields: [
      field('firstName', 'First name', 'text', { placeholder: 'Cornelius' }),
      field('middleNames', 'Middle name(s)', 'text', { placeholder: 'Adedeji', optional: true }),
      field('lastName', 'Last name', 'text', { placeholder: 'Victor' }),
      field('fullPublicName', 'Full public name', 'text', {
        placeholder: 'The exact name you publish under',
        help: 'This is the name your public site will lead with.',
      }),
      field('preferredName', 'Preferred name', 'text', { optional: true, placeholder: 'What you like to be called' }),
      field('handle', 'Username or handle', 'text', { optional: true, placeholder: 'e.g. @yourhandle' }),
      field('headline', 'One-line headline', 'text', {
        optional: true,
        placeholder: 'Software engineer and founder of …',
      }),
      field('country', 'Country', 'text', { optional: true }),
      field('location', 'City or region', 'text', { optional: true }),
      field('birthDate', 'Date of birth', 'date', {
        optional: true,
        help: 'Only publish this if you want to. It stays off your public site unless you say so.',
      }),
    ],
  },
  {
    key: 'B_name_variants',
    letter: 'B',
    title: 'Other names people use for you',
    summary: 'Aliases, nicknames, professional names and reordered names are all legitimate.',
    requirement: StageRequirement.material,
    whyItMatters:
      'Many of your sources will not use the same name. Listing the real variants lets Nexora Entity recognise that they belong to the same person instead of treating them as different people.',
    skipCopy: 'Skip for now — without this, your other sources may look like different people.',
    fields: [
      field('aliases', 'Other names people use for you', 'list', {
        itemLabel: 'Name',
        optional: true,
        placeholder: 'e.g. C. Victor, Cornel, Victor A. C.',
        help: 'Nicknames, shortened names, reordered names, professional or stage names — all welcome.',
      }),
    ],
  },
  {
    key: 'C_about',
    letter: 'C',
    title: 'About you',
    summary: 'Your biography and what you are known for.',
    requirement: StageRequirement.material,
    whyItMatters:
      'A biography is what lets a reader and a search engine understand the person behind the name, rather than just a string of words.',
    skipCopy: 'Skip for now — we need a biography before we can describe you accurately.',
    fields: [
      field('shortBio', 'Short introduction', 'longtext', {
        optional: true,
        placeholder: 'One or two sentences.',
      }),
      field('biography', 'Full biography', 'longtext', { placeholder: 'Tell your story in your own words.' }),
      field('knownFor', 'What you are known for', 'longtext', {
        optional: true,
        placeholder: 'The work or contributions you would want attached to your name.',
      }),
      field('interests', 'Interests', 'list', { itemLabel: 'Interest', optional: true }),
      field('expertiseSummary', 'Areas of expertise', 'longtext', { optional: true }),
    ],
  },
  {
    key: 'D_professional_identity',
    letter: 'D',
    title: 'Professional identity',
    summary: 'What you do now.',
    requirement: StageRequirement.material,
    whyItMatters:
      'A current professional identity is one of the strongest signals that ties your sources to you, and one of the most common sources of contradiction.',
    skipCopy: 'Skip for now — we need to know what you currently do.',
    fields: [
      field('professions', 'Professions', 'list', { itemLabel: 'Profession', placeholder: 'e.g. Software engineer' }),
      field('titles', 'Titles and roles', 'list', { itemLabel: 'Title', optional: true }),
      field('specialisations', 'Specialisations', 'list', { itemLabel: 'Specialisation', optional: true }),
      field('services', 'Services you offer', 'list', { itemLabel: 'Service', optional: true }),
      field('industries', 'Industries', 'list', { itemLabel: 'Industry', optional: true }),
      field('currentCompany', 'Current company or organisation', 'text', { optional: true }),
      field('founderStatus', 'Founder status', 'text', {
        optional: true,
        placeholder: 'e.g. Founder and lead engineer at …',
      }),
      field('currentFocus', 'What you are working on now', 'longtext', { optional: true }),
    ],
  },
  {
    key: 'E_career',
    letter: 'E',
    title: 'Career and work history',
    summary: 'Roles, employers and periods.',
    requirement: StageRequirement.recommended,
    whyItMatters:
      'A dated work history lets Nexora Entity tell a career change apart from a contradiction — being a student in one period and a developer later is a coherent history, not a conflict.',
    skipCopy: 'Skip for now — optional, but it makes your entity much richer.',
    fields: [
      field('roles', 'Roles and employers', 'list', {
        itemLabel: 'Role',
        optional: true,
        placeholder: 'e.g. Software Engineer, Acme Labs (2021–present)',
      }),
    ],
  },
  {
    key: 'F_education',
    letter: 'F',
    title: 'Education and qualifications',
    summary: 'Schools, programmes and qualifications.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Education is a strong distinguishing signal between people with similar names.',
    skipCopy: 'Skip for now — optional.',
    fields: [
      field('education', 'Education', 'list', {
        itemLabel: 'Qualification',
        optional: true,
        placeholder: 'e.g. BSc Computer Science, University of Lagos (2014–2018)',
      }),
    ],
  },
  {
    key: 'G_skills',
    letter: 'G',
    title: 'Skills and expertise',
    summary: 'What you can do.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Skills connect you to your work and to the organisations around you.',
    skipCopy: 'Skip for now — optional.',
    fields: [
      field('skills', 'Skills', 'list', { itemLabel: 'Skill', optional: true }),
      field('languages', 'Languages', 'list', { itemLabel: 'Language', optional: true }),
      field('subjectAreas', 'Subject areas', 'list', { itemLabel: 'Subject area', optional: true }),
    ],
  },
  {
    key: 'H_organizations',
    letter: 'H',
    title: 'Organisations and affiliations',
    summary: 'Companies, communities and institutions you belong to.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Affiliations connect you to organisations, projects and other people.',
    skipCopy: 'Skip for now — optional.',
    fields: [
      field('organizations', 'Organisations', 'list', {
        itemLabel: 'Organisation',
        optional: true,
        placeholder: 'e.g. Founder at Acme Labs',
      }),
    ],
  },
  {
    key: 'I_projects',
    letter: 'I',
    title: 'Projects',
    summary: 'Things you have built.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Projects are the clearest evidence of what a person actually did.',
    skipCopy: 'Skip for now — optional.',
    fields: [
      field('projects', 'Projects', 'list', {
        itemLabel: 'Project',
        optional: true,
        placeholder: 'e.g. Nexora — an identity platform (Founder, 2023–present)',
      }),
    ],
  },
  {
    key: 'J_products_services',
    letter: 'J',
    title: 'Products and services',
    summary: 'Products you ship and services you deliver.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Products and services connect you to organisations and to customers.',
    skipCopy: 'Skip for now — optional.',
    fields: [
      field('products', 'Products and services', 'list', { itemLabel: 'Product or service', optional: true }),
    ],
  },
  {
    key: 'K_achievements',
    letter: 'K',
    title: 'Achievements and recognition',
    summary: 'Awards and legitimate accomplishments.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Recognition from independent bodies is among the strongest evidence that a person is who they say they are.',
    skipCopy: 'Skip for now — optional.',
    fields: [
      field('achievements', 'Achievements and recognition', 'list', { itemLabel: 'Achievement', optional: true }),
    ],
  },
  {
    key: 'L_publications_media',
    letter: 'L',
    title: 'Publications and media',
    summary: 'Articles, interviews, videos and other published work.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Published work you created is primary evidence, distinct from press about you.',
    skipCopy: 'Skip for now — optional.',
    fields: [
      field('publications', 'Publications, interviews and media', 'list', {
        itemLabel: 'Item',
        optional: true,
        placeholder: 'e.g. Interview on the future of identity — Tech Weekly (March 2024)',
      }),
    ],
  },
  {
    key: 'M_press_releases',
    letter: 'M',
    title: 'Press releases',
    summary: 'Independent coverage about you.',
    requirement: StageRequirement.evidenceMinimum,
    whyItMatters:
      'Nexora Entity requires at least four qualifying press releases. Each one is checked for reachability, whether it is actually about you, and whether it is genuinely independent of your other sources — four copies of the same release count as one.',
    skipCopy: 'Skip for now — four qualifying press releases are required before publication.',
    fields: [
      field('pressReleases', 'Press release or news links', 'url_list', {
        itemLabel: 'Press link',
        placeholder: 'https://…',
        help: 'Paste the link to the published article.',
      }),
    ],
  },
  {
    key: 'N_websites',
    letter: 'N',
    title: 'Websites about you',
    summary: 'Personal sites, project sites, organisation pages, author pages.',
    requirement: StageRequirement.evidenceMinimum,
    whyItMatters:
      'Nexora Entity requires at least five qualifying live websites. Each is checked for reachability and whether it is genuinely about you — dead links, unrelated pages and duplicates of the same site do not count.',
    skipCopy: 'Skip for now — five qualifying websites are required before publication.',
    fields: [
      field('websites', 'Website URLs', 'url_list', { itemLabel: 'Website', placeholder: 'https://…' }),
    ],
  },
  {
    key: 'O_portfolio',
    letter: 'O',
    title: 'Portfolio',
    summary: 'Upload your portfolio or share a portfolio link.',
    requirement: StageRequirement.recommended,
    whyItMatters:
      'A portfolio is strong first-party material. Nexora Entity reads it, extracts what it can, and always shows you what it found before anything is used. A portfolio does not replace the five-website minimum.',
    skipCopy: 'Skip for now — optional.',
    fields: [
      field('portfolioUrl', 'Portfolio link', 'url', { optional: true, placeholder: 'https://…' }),
      field('portfolioFiles', 'Portfolio files', 'file', {
        optional: true,
        help: 'PDF, Word, image, or plain-text files.',
      }),
    ],
  },
  {
    key: 'P_social_profiles',
    letter: 'P',
    title: 'Social and professional profiles',
    summary: 'Profiles Nexora Entity can read.',
    requirement: StageRequirement.material,
    whyItMatters:
      'Your public profiles are among the strongest places to confirm you are the same person across sites. Where a platform does not permit automated reading, Nexora Entity records that limitation honestly instead of claiming it checked anything.',
    skipCopy: 'Skip for now — at least one readable profile is needed to confirm your sources.',
    fields: [
      field('profiles', 'Profile links', 'url_list', {
        itemLabel: 'Profile',
        placeholder: 'LinkedIn, GitHub, YouTube, Instagram, TikTok, X, Facebook, Threads, Reddit …',
      }),
    ],
  },
  {
    key: 'Q_photos',
    letter: 'Q',
    title: 'Photos',
    summary: 'Photographs that represent you.',
    requirement: StageRequirement.evidenceMinimum,
    whyItMatters:
      'Nexora Entity requires at least four qualifying photos. Each upload is checked for validity, size, and whether it is a duplicate of another upload. Your public site displays the images you choose.',
    skipCopy: 'Skip for now — four qualifying photos are required before publication.',
    fields: [
      field('photos', 'Upload photos', 'photo', {
        help: 'A clear primary portrait plus supporting photographs work best.',
      }),
    ],
  },
  {
    key: 'R_online_presence',
    letter: 'R',
    title: 'Other public pages',
    summary: 'Speaker, event, podcast, publication and creator pages.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Additional public representations strengthen the entity and help distinguish you from others.',
    skipCopy: 'Skip for now — optional.',
    fields: [
      field('presencePages', 'Other public pages', 'url_list', { itemLabel: 'Page', optional: true }),
    ],
  },
  {
    key: 'S_public_contact',
    letter: 'S',
    title: 'Public contact',
    summary: 'How the public can reach you.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Only publish contact details you want public. Everything here appears on your site.',
    skipCopy: 'Skip for now — optional.',
    fields: [
      field('publicEmail', 'Public email', 'text', { optional: true }),
      field('publicPhone', 'Public phone', 'text', { optional: true }),
      field('whatsapp', 'WhatsApp', 'text', { optional: true }),
      field('bookingUrl', 'Booking or enquiry link', 'url', { optional: true }),
      field('contactPageUrl', 'Contact page', 'url', { optional: true }),
      field('businessAddress', 'Public business address', 'longtext', { optional: true }),
    ],
  },
  {
    key: 'T_location',
    letter: 'T',
    title: 'Places',
    summary: 'Where you are and have been.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Location history helps separate you from others and gives context to your career.',
    skipCopy: 'Skip for now — optional.',
    fields: [
      field('locations', 'Locations', 'list', {
        itemLabel: 'Location',
        optional: true,
        placeholder: 'e.g. Lagos, Nigeria (current)',
      }),
    ],
  },
  {
    key: 'U_dates',
    letter: 'U',
    title: 'Important dates',
    summary: 'Periods for your career, education, projects and recognition.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Dates are what separate a coherent history from a contradiction.',
    skipCopy: 'Skip for now — optional, but dates prevent false conflicts.',
    fields: [
      field('importantDates', 'Important dates and periods', 'list', {
        itemLabel: 'Event',
        optional: true,
        placeholder: 'e.g. Founded Acme Labs — March 2021',
      }),
    ],
  },
  {
    key: 'V_external_identity_links',
    letter: 'V',
    title: 'Official identity links',
    summary: 'The URLs you consider canonical for you.',
    requirement: StageRequirement.material,
    whyItMatters:
      'These are the links a machine reader should treat as your canonical online identity. They must match what your sources actually say.',
    skipCopy: 'Skip for now — at least one official identity link is needed.',
    fields: [
      field('officialWebsite', 'Your official website', 'url', { optional: true }),
      field('identityLinks', 'Other official identity links', 'url_list', { itemLabel: 'Link', optional: true }),
    ],
  },
  {
    key: 'W_other',
    letter: 'W',
    title: 'Anything else',
    summary: 'Open-ended — add whatever does not fit above.',
    requirement: StageRequirement.recommended,
    whyItMatters: 'Anything you add here is treated like every other piece of information: kept with its origin and checked.',
    skipCopy: 'Skip — you can always come back.',
    fields: [
      field('otherInformation', 'Other information', 'list', { itemLabel: 'Item', optional: true }),
    ],
  },
];

export const STAGE_BY_KEY: Record<StageKey, StageDefinition> = Object.fromEntries(
  STAGES.map((s) => [s.key, s]),
) as Record<StageKey, StageDefinition>;

export const STAGE_ORDER: StageKey[] = STAGES.map((s) => s.key);

/** Look up a stage by key. Returns undefined for anything not in the registry. */
export function getStage(key: string): StageDefinition | undefined {
  return STAGE_BY_KEY[key as StageKey];
}

/** Narrow an arbitrary string to a stage key. */
export function isStageKey(key: string): key is StageKey {
  return Object.prototype.hasOwnProperty.call(STAGE_BY_KEY, key);
}

/** Return the given keys in canonical stage order, ignoring anything unknown. */
export function stageOrder(keys: readonly string[]): StageKey[] {
  return keys.filter(isStageKey).sort((a, b) => stageIndex(a) - stageIndex(b));
}

/** Which stages feed which hard evidence minimum. */
export const MINIMUM_STAGE_FOR: Record<string, StageKey> = {
  websites: 'N_websites',
  pressReleases: 'M_press_releases',
  photos: 'Q_photos',
};

export function stageIndex(key: StageKey): number {
  return STAGE_ORDER.indexOf(key);
}