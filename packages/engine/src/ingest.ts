/**
 * Stage ingestion.
 *
 * Turns what the person typed into claims that carry origin, status, support strength and
 * stage attribution. Nothing is silently upgraded: everything typed here starts as
 * `user_provided` with `self_asserted` support, and is never presented as verified fact.
 */

import {
  ClaimOrigin,
  ClaimStatus,
  NodeType,
  Predicate,
  SupportStrength,
  normalizeText,
  type StageKey,
} from '@nexora/core';
import type { ClaimInsert } from '@nexora/db';

export interface ItemEntry {
  /** Free text or "Label — detail" pair. */
  text: string;
  label?: string;
  detail?: string;
  url?: string;
  organization?: string;
  periodStart?: string;
  periodEnd?: string;
  current?: boolean;
}

export interface StagePayload {
  [fieldKey: string]: unknown;
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v)) return v.map(asString).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const label = typeof o['label'] === 'string' ? o['label'] : '';
    const detail = typeof o['detail'] === 'string' ? o['detail'] : '';
    const org = typeof o['organization'] === 'string' ? o['organization'] : '';
    const start = typeof o['periodStart'] === 'string' ? o['periodStart'] : '';
    const end = typeof o['periodEnd'] === 'string' ? o['periodEnd'] : '';
    const cur = o['current'] === true ? ' (current)' : '';
    const parts = [label, detail].filter(Boolean).join(' — ');
    const period = [start, end].filter(Boolean).join(' to ') || (cur ? 'present' : '');
    return [parts, org, period].filter(Boolean).join(', ');
  }
  return String(v);
}

function asList(v: unknown): string[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => asString(x)).map((s) => s.trim()).filter(Boolean);
  const s = asString(v).trim();
  if (!s) return [];
  return s
    .split(/\n|,(?![^(]*\))/)
    .map((x) => x.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean);
}

function asUrls(v: unknown): { url: string; title: string }[] {
  const raw: string[] = [];
  if (Array.isArray(v)) {
    for (const item of v) {
      if (typeof item === 'string') raw.push(item);
      else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        const u = typeof o['url'] === 'string' ? o['url'] : typeof o === 'string' ? '' : '';
        const t = typeof o['title'] === 'string' ? o['title'] : '';
        if (u) raw.push(u);
        if (t) raw.push(t);
      }
    }
  } else if (typeof v === 'string') {
    raw.push(...v.split(/[\n,]/));
  }
  const out: { url: string; title: string }[] = [];
  for (const entry of raw) {
    const t = entry.trim();
    if (!t) continue;
    const urlMatch = /https?:\/\/[^\s,]+/i.exec(t) ?? /^[^\s,]+\.[a-z]{2,}(\/[^\s,]*)?$/i.exec(t);
    if (!urlMatch) continue;
    const url = urlMatch[0].trim();
    const title = t.replace(url, '').replace(/^[-—–|\s]+/, '').replace(/[-—–|\s]+$/, '') || url;
    if (!out.some((o) => o.url.toLowerCase() === url.toLowerCase())) out.push({ url, title });
  }
  return out;
}

function attr<K extends keyof ClaimInsert>(input: Omit<ClaimInsert, K>): ClaimInsert {
  return {
    origin: ClaimOrigin.user,
    status: ClaimStatus.userProvided,
    supportStrength: SupportStrength.selfAsserted,
    authorityTier: 2,
    confidence: 0.5,
    discovered: false,
    ...input,
  } as ClaimInsert;
}

/** Convert a stage's saved data into claim records. */
export function claimsFromStage(stageKey: StageKey, data: StagePayload): ClaimInsert[] {
  const out: ClaimInsert[] = [];
  const push = (c: ClaimInsert) => out.push(c);
  const s = (k: string): string => normalizeText(asString(data[k]));

  switch (stageKey) {
    case 'A_identity': {
      const first = asString(data['firstName']).trim();
      const middle = asString(data['middleNames']).trim();
      const last = asString(data['lastName']).trim();
      const full = asString(data['fullPublicName']).trim() || [first, middle, last].filter(Boolean).join(' ');
      const preferred = asString(data['preferredName']).trim();
      const headline = asString(data['headline']).trim();
      const country = asString(data['country']).trim();
      const location = asString(data['location']).trim();
      const handle = asString(data['handle']).trim();
      const birth = asString(data['birthDate']).trim();

      if (first) push(attr({ entityId: '', attributeKey: 'identity.firstName', predicate: Predicate.hasName, nodeType: NodeType.name, valueText: first, displayLabel: 'First name', stageKey, sortOrder: 1, normalizedKey: s('firstName') }));
      if (middle) push(attr({ entityId: '', attributeKey: 'identity.middleNames', predicate: Predicate.hasName, nodeType: NodeType.name, valueText: middle, displayLabel: 'Middle name(s)', stageKey, sortOrder: 2 }));
      if (last) push(attr({ entityId: '', attributeKey: 'identity.lastName', predicate: Predicate.hasName, nodeType: NodeType.name, valueText: last, displayLabel: 'Last name', stageKey, sortOrder: 3 }));
      if (full) {
        push(attr({ entityId: '', attributeKey: 'identity.fullPublicName', predicate: Predicate.hasName, nodeType: NodeType.name, valueText: full, displayLabel: 'Full public name', stageKey, sortOrder: 4, isCurrent: true }));
        push(attr({ entityId: '', attributeKey: 'identity.primaryName', predicate: Predicate.hasName, nodeType: NodeType.name, valueText: preferred || full, displayLabel: preferred ? `Preferred name (${full})` : 'Primary name', stageKey, sortOrder: 5, isCurrent: true }));
      }
      if (handle) {
        push(attr({ entityId: '', attributeKey: 'identity.handle', predicate: Predicate.hasName, nodeType: NodeType.alias, valueText: handle.replace(/^@/, ''), displayLabel: `Handle @${handle.replace(/^@/, '')}`, stageKey, valueJson: { handle: handle.replace(/^@/, '') } }));
      }
      if (headline) push(attr({ entityId: '', attributeKey: 'identity.headline', predicate: Predicate.hasTitle, nodeType: NodeType.title, valueText: headline, displayLabel: 'Headline', stageKey, isCurrent: true }));
      if (location) push(attr({ entityId: '', attributeKey: 'identity.location', predicate: Predicate.locatedIn, nodeType: NodeType.location, valueText: location, displayLabel: 'Location', stageKey, isCurrent: true }));
      if (country) push(attr({ entityId: '', attributeKey: 'location.country', predicate: Predicate.locatedIn, nodeType: NodeType.location, valueText: country, displayLabel: 'Country', stageKey }));
      if (birth) push(attr({ entityId: '', attributeKey: 'identity.birthDate', predicate: Predicate.hasTitle, nodeType: NodeType.person, valueText: birth, displayLabel: 'Date of birth', stageKey, valueJson: { publishOptIn: true } }));
      break;
    }

    case 'B_name_variants': {
      for (const alias of asList(data['aliases'])) {
        push(attr({ entityId: '', attributeKey: 'identity.alias', predicate: Predicate.hasAlias, nodeType: NodeType.alias, valueText: alias, displayLabel: 'Also known as', stageKey }));
      }
      break;
    }

    case 'C_about': {
      const shortBio = asString(data['shortBio']).trim();
      const bio = asString(data['biography']).trim();
      const knownFor = asString(data['knownFor']).trim();
      const expertise = asString(data['expertiseSummary']).trim();
      if (shortBio) push(attr({ entityId: '', attributeKey: 'about.shortBio', predicate: Predicate.hasTitle, nodeType: NodeType.person, valueText: shortBio, displayLabel: 'Short introduction', stageKey, isCurrent: true }));
      if (bio) push(attr({ entityId: '', attributeKey: 'about.biography', predicate: Predicate.hasTitle, nodeType: NodeType.person, valueText: bio, displayLabel: 'Biography', stageKey, isCurrent: true }));
      if (knownFor) push(attr({ entityId: '', attributeKey: 'about.knownFor', predicate: Predicate.hasProfession, nodeType: NodeType.profession, valueText: knownFor, displayLabel: 'Known for', stageKey }));
      if (expertise) push(attr({ entityId: '', attributeKey: 'about.expertiseSummary', predicate: Predicate.hasProfession, nodeType: NodeType.profession, valueText: expertise, displayLabel: 'Expertise', stageKey }));
      for (const i of asList(data['interests'])) {
        push(attr({ entityId: '', attributeKey: 'about.interests', predicate: Predicate.hasProfession, nodeType: NodeType.profession, valueText: i, displayLabel: 'Interest', stageKey }));
      }
      break;
    }

    case 'D_professional_identity': {
      for (const v of asList(data['professions'])) push(attr({ entityId: '', attributeKey: 'professional.profession', predicate: Predicate.hasProfession, nodeType: NodeType.profession, valueText: v, displayLabel: 'Profession', stageKey, isCurrent: true }));
      for (const v of asList(data['titles'])) push(attr({ entityId: '', attributeKey: 'professional.title', predicate: Predicate.hasTitle, nodeType: NodeType.title, valueText: v, displayLabel: 'Title', stageKey, isCurrent: true }));
      for (const v of asList(data['specialisations'])) push(attr({ entityId: '', attributeKey: 'professional.specialisation', predicate: Predicate.hasProfession, nodeType: NodeType.profession, valueText: v, displayLabel: 'Specialisation', stageKey }));
      for (const v of asList(data['services'])) push(attr({ entityId: '', attributeKey: 'professional.service', predicate: Predicate.offersService, nodeType: NodeType.service, valueText: v, displayLabel: 'Service', stageKey }));
      for (const v of asList(data['industries'])) push(attr({ entityId: '', attributeKey: 'professional.industry', predicate: Predicate.hasProfession, nodeType: NodeType.profession, valueText: v, displayLabel: 'Industry', stageKey }));
      const company = asString(data['currentCompany']).trim();
      if (company) push(attr({ entityId: '', attributeKey: 'professional.currentCompany', predicate: Predicate.associatedWith, nodeType: NodeType.organization, valueText: company, displayLabel: 'Current organisation', stageKey, isCurrent: true }));
      const founder = asString(data['founderStatus']).trim();
      if (founder) push(attr({ entityId: '', attributeKey: 'professional.founderStatus', predicate: Predicate.associatedWith, nodeType: NodeType.organization, valueText: founder, displayLabel: 'Founder status', stageKey, isCurrent: true }));
      const focus = asString(data['currentFocus']).trim();
      if (focus) push(attr({ entityId: '', attributeKey: 'professional.currentFocus', predicate: Predicate.worksOn, nodeType: NodeType.project, valueText: focus, displayLabel: 'Current focus', stageKey, isCurrent: true }));
      break;
    }

    case 'E_career': {
      for (const raw of asList(data['roles'])) {
        push(attr({ entityId: '', attributeKey: 'career.role', predicate: Predicate.memberOf, nodeType: NodeType.organization, valueText: raw, displayLabel: 'Role', stageKey }));
      }
      break;
    }

    case 'F_education': {
      for (const raw of asList(data['education'])) {
        push(attr({ entityId: '', attributeKey: 'education.qualification', predicate: Predicate.educatedAt, nodeType: NodeType.education, valueText: raw, displayLabel: 'Education', stageKey }));
      }
      break;
    }

    case 'G_skills': {
      for (const v of asList(data['skills'])) push(attr({ entityId: '', attributeKey: 'skills.skill', predicate: Predicate.hasProfession, nodeType: NodeType.profession, valueText: v, displayLabel: 'Skill', stageKey }));
      for (const v of asList(data['languages'])) push(attr({ entityId: '', attributeKey: 'skills.language', predicate: Predicate.hasProfession, nodeType: NodeType.profession, valueText: v, displayLabel: 'Language', stageKey }));
      for (const v of asList(data['subjectAreas'])) push(attr({ entityId: '', attributeKey: 'skills.subjectArea', predicate: Predicate.hasProfession, nodeType: NodeType.profession, valueText: v, displayLabel: 'Subject area', stageKey }));
      break;
    }

    case 'H_organizations': {
      for (const v of asList(data['organizations'])) {
        push(attr({ entityId: '', attributeKey: 'organizations.affiliation', predicate: Predicate.associatedWith, nodeType: NodeType.organization, valueText: v, displayLabel: 'Organisation', stageKey }));
      }
      break;
    }

    case 'I_projects': {
      for (const v of asList(data['projects'])) {
        push(attr({ entityId: '', attributeKey: 'projects.project', predicate: Predicate.created, nodeType: NodeType.project, valueText: v, displayLabel: 'Project', stageKey }));
      }
      break;
    }

    case 'J_products_services': {
      for (const v of asList(data['products'])) {
        push(attr({ entityId: '', attributeKey: 'products.product', predicate: Predicate.created, nodeType: NodeType.product, valueText: v, displayLabel: 'Product or service', stageKey }));
      }
      break;
    }

    case 'K_achievements': {
      for (const v of asList(data['achievements'])) {
        push(attr({ entityId: '', attributeKey: 'achievements.achievement', predicate: Predicate.recognizedBy, nodeType: NodeType.achievement, valueText: v, displayLabel: 'Achievement', stageKey }));
      }
      break;
    }

    case 'L_publications_media': {
      for (const v of asList(data['publications'])) {
        push(attr({ entityId: '', attributeKey: 'publications.item', predicate: Predicate.publishedBy, nodeType: NodeType.publication, valueText: v, displayLabel: 'Publication or media', stageKey }));
      }
      break;
    }

    case 'M_press_releases': {
      for (const u of asUrls(data['pressReleases'])) {
        push(attr({
          entityId: '', attributeKey: 'press.release', predicate: Predicate.mentionedBy,
          nodeType: NodeType.pressSource, valueText: u.title, displayLabel: 'Press release',
          stageKey, valueJson: { url: u.url },
        }));
      }
      break;
    }

    case 'N_websites': {
      for (const u of asUrls(data['websites'])) {
        push(attr({
          entityId: '', attributeKey: 'websites.website', predicate: Predicate.representedOn,
          nodeType: NodeType.website, valueText: u.title, displayLabel: 'Website',
          stageKey, valueJson: { url: u.url },
        }));
      }
      break;
    }

    case 'O_portfolio': {
      const u = asString(data['portfolioUrl']).trim();
      if (u) {
        push(attr({
          entityId: '', attributeKey: 'portfolio.url', predicate: Predicate.representedOn,
          nodeType: NodeType.website, valueText: u, displayLabel: 'Portfolio link',
          stageKey, valueJson: { url: u },
        }));
      }
      break;
    }

    case 'P_social_profiles': {
      for (const u of asUrls(data['profiles'])) {
        push(attr({
          entityId: '', attributeKey: 'profiles.profile', predicate: Predicate.connectedTo,
          nodeType: NodeType.profile, valueText: u.title, displayLabel: 'Profile',
          stageKey, valueJson: { url: u.url },
        }));
      }
      break;
    }

    case 'R_online_presence': {
      for (const u of asUrls(data['presencePages'])) {
        push(attr({
          entityId: '', attributeKey: 'presence.page', predicate: Predicate.representedOn,
          nodeType: NodeType.website, valueText: u.title, displayLabel: 'Public page',
          stageKey, valueJson: { url: u.url },
        }));
      }
      break;
    }

    case 'S_public_contact': {
      const email = asString(data['publicEmail']).trim();
      const phone = asString(data['publicPhone']).trim();
      const whatsapp = asString(data['whatsapp']).trim();
      const booking = asString(data['bookingUrl']).trim();
      const contactPage = asString(data['contactPageUrl']).trim();
      const address = asString(data['businessAddress']).trim();
      if (email) push(attr({ entityId: '', attributeKey: 'contact.email', predicate: Predicate.contactableAt, nodeType: NodeType.contact, valueText: email, displayLabel: 'Public email', stageKey, valueJson: { kind: 'email', publishOptIn: true } }));
      if (phone) push(attr({ entityId: '', attributeKey: 'contact.phone', predicate: Predicate.contactableAt, nodeType: NodeType.contact, valueText: phone, displayLabel: 'Public phone', stageKey, valueJson: { kind: 'phone', publishOptIn: true } }));
      if (whatsapp) push(attr({ entityId: '', attributeKey: 'contact.whatsapp', predicate: Predicate.contactableAt, nodeType: NodeType.contact, valueText: whatsapp, displayLabel: 'WhatsApp', stageKey, valueJson: { kind: 'whatsapp', publishOptIn: true } }));
      if (booking) push(attr({ entityId: '', attributeKey: 'contact.booking', predicate: Predicate.contactableAt, nodeType: NodeType.contact, valueText: booking, displayLabel: 'Booking link', stageKey, valueJson: { url: booking, kind: 'booking', publishOptIn: true } }));
      if (contactPage) push(attr({ entityId: '', attributeKey: 'contact.page', predicate: Predicate.contactableAt, nodeType: NodeType.contact, valueText: contactPage, displayLabel: 'Contact page', stageKey, valueJson: { url: contactPage, kind: 'contact_page', publishOptIn: true } }));
      if (address) push(attr({ entityId: '', attributeKey: 'contact.address', predicate: Predicate.locatedIn, nodeType: NodeType.contact, valueText: address, displayLabel: 'Business address', stageKey, valueJson: { kind: 'business_address', publishOptIn: true } }));
      break;
    }

    case 'T_location': {
      for (const v of asList(data['locations'])) {
        push(attr({ entityId: '', attributeKey: 'location.entry', predicate: Predicate.locatedIn, nodeType: NodeType.location, valueText: v, displayLabel: 'Location', stageKey }));
      }
      break;
    }

    case 'U_dates': {
      for (const v of asList(data['importantDates'])) {
        push(attr({ entityId: '', attributeKey: 'dates.event', predicate: Predicate.worksOn, nodeType: NodeType.project, valueText: v, displayLabel: 'Important date', stageKey }));
      }
      break;
    }

    case 'V_external_identity_links': {
      const official = asString(data['officialWebsite']).trim();
      if (official) {
        push(attr({ entityId: '', attributeKey: 'identity.officialWebsite', predicate: Predicate.representedOn, nodeType: NodeType.website, valueText: official, displayLabel: 'Official website', stageKey, valueJson: { url: official }, isCurrent: true }));
      }
      for (const u of asUrls(data['identityLinks'])) {
        push(attr({
          entityId: '', attributeKey: 'websites.website', predicate: Predicate.representedOn,
          nodeType: NodeType.website, valueText: u.title, displayLabel: 'Identity link',
          stageKey, valueJson: { url: u.url },
        }));
      }
      break;
    }

    case 'W_other': {
      for (const v of asList(data['otherInformation'])) {
        push(attr({ entityId: '', attributeKey: 'other.fact', predicate: Predicate.hasTitle, nodeType: NodeType.person, valueText: v, displayLabel: 'Other information', stageKey }));
      }
      break;
    }

    case 'Q_photos':
      // Photos are stored as photo records, not claims. Nothing to ingest here.
      break;
  }

  return out.filter((c) => c.valueText.trim().length > 0);
}

/** Extract every URL a stage declared, with the source kind it belongs to. */
export function urlsFromStage(stageKey: StageKey, data: StagePayload): { url: string; suppliedKind: string }[] {
  switch (stageKey) {
    case 'M_press_releases':
      return asUrls(data['pressReleases']).map((u) => ({ url: u.url, suppliedKind: 'press_release' }));
    case 'N_websites':
      return asUrls(data['websites']).map((u) => ({ url: u.url, suppliedKind: 'personal_site' }));
    case 'P_social_profiles':
      return asUrls(data['profiles']).map((u) => ({ url: u.url, suppliedKind: 'social_profile' }));
    case 'R_online_presence':
      return asUrls(data['presencePages']).map((u) => ({ url: u.url, suppliedKind: 'public_page' }));
    case 'O_portfolio': {
      const u = asString(data['portfolioUrl']).trim();
      return u ? [{ url: u, suppliedKind: 'portfolio_url' }] : [];
    }
    case 'V_external_identity_links': {
      const out: { url: string; suppliedKind: string }[] = [];
      const official = asString(data['officialWebsite']).trim();
      if (official) out.push({ url: official, suppliedKind: 'personal_site' });
      for (const x of asUrls(data['identityLinks'])) out.push({ url: x.url, suppliedKind: 'personal_site' });
      return out;
    }
    default:
      return [];
  }
}