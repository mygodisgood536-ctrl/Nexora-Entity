/**
 * Test fixtures for the engine.
 *
 * Every record is built to satisfy its repository type exactly. Engines are pure functions over
 * these records, so a test states the whole world the engine sees — no database, no network.
 */

import type {
  AmbiguityRecord,
  ClaimRecord,
  ConflictRecord,
  IdentityLinkRecord,
  PhotoRecord,
  SourceRecord,
  StageProgressRecord,
} from '@nexora/db';

/**
 * Recent enough that the freshness check passes. Hard-coding a date would make every fixture
 * silently decay into a warning as time passes, so it is derived from now.
 */
const NOW = new Date().toISOString();

export function claim(overrides: Partial<ClaimRecord> = {}): ClaimRecord {
  return {
    id: 'c1',
    entity_id: 'e1',
    stage_key: 'A_identity',
    attribute_key: 'name.primary',
    value_text: 'Ada Lovelace',
    value_number: null,
    value_date: null,
    confidence: 0.95,
    status: 'confirmed',
    publish: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as ClaimRecord;
}

/**
 * Field names must match `SourceRecord` exactly. The readiness engine reads `qualifiers`,
 * `qualifies_websites`, `qualifies_press` and `independence_group`; a fixture that invents
 * plausible alternatives makes every check fail for the wrong reason.
 */
export function source(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: 's1',
    entity_id: 'e1',
    url: 'https://example.com/ada',
    canonical_url: 'https://example.com/ada',
    registrable_domain: 'example.com',
    host: 'example.com',
    supplied_kind: 'website',
    declared_as_website: true,
    declared_as_press: false,
    declared_as_profile: false,
    declared_as_page: false,
    source_type: 'owned',
    platform: null,
    platform_handle: null,
    title: 'Ada Lovelace',
    description: 'About Ada Lovelace',
    author: null,
    published_date: null,
    http_status: 200,
    final_url: 'https://example.com/ada',
    redirects: [],
    content_type: 'text/html',
    platform_note: null,
    platform_mechanism: null,
    access_status: 'accessible',
    access_detail: null,
    inspection_status: 'inspected',
    inspected_at: NOW,
    last_checked_at: NOW,
    check_error: null,
    content_hash: 'h'.repeat(64),
    text_excerpt: 'Ada Lovelace was an English mathematician.',
    text_length: 2200,
    independence_group: 'example.com',
    fingerprint_tokens: 120,
    extracted: {
      names: ['Ada Lovelace'],
      headline: 'English mathematician',
      description: 'About Ada Lovelace',
    },
    qualifiers: {
      reachable: true,
      aboutSubject: true,
      liveContent: true,
      distinctContent: true,
      qualifiesForMinimum: true,
      qualifiesWebsites: true,
      qualifiesPress: false,
      isPress: false,
      independence: 'example.com',
      reasons: ['Reachable, about the subject, and distinct content.'],
      blockers: [],
      checkedAt: NOW,
    },
    qualifies_websites: true,
    qualifies_press: false,
    subject_relevance: 0.95,
    quality_score: 0.9,
    is_duplicate_of: null,
    published: true,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as unknown as SourceRecord;
}

export function pressSource(group: string, overrides: Partial<SourceRecord> = {}): SourceRecord {
  return source({
    id: `press-${group}`,
    url: `https://news-${group}.example/story`,
    canonical_url: `https://news-${group}.example/story`,
    registrable_domain: `news-${group}.example`,
    host: `news-${group}.example`,
    title: 'Profile of Ada Lovelace',
    supplied_kind: 'press_release',
    declared_as_press: true,
    declared_as_website: false,
    source_type: 'independent_publication',
    independence_group: group,
    qualifiers: {
      reachable: true,
      aboutSubject: true,
      liveContent: true,
      distinctContent: true,
      qualifiesForMinimum: true,
      qualifiesWebsites: false,
      qualifiesPress: true,
      isPress: true,
      independence: group,
      reasons: ['Published by an independent outlet, about the subject.'],
      blockers: [],
      checkedAt: NOW,
    },
    qualifies_websites: false,
    qualifies_press: true,
    ...overrides,
  });
}

export function photo(overrides: Partial<PhotoRecord> = {}): PhotoRecord {
  return {
    id: 'p1',
    entity_id: 'e1',
    source_id: null,
    url: null,
    storage_path: 'storage/photos/ada-1.jpg',
    sha256: 'a'.repeat(64),
    perceptual_hash: 'b'.repeat(16),
    width: 1200,
    height: 1600,
    bytes: 240_000,
    mime_type: 'image/jpeg',
    is_primary: false,
    is_duplicate: false,
    qualifies: true,
    caption: null,
    captured_year: null,
    created_at: NOW,
    ...overrides,
  } as PhotoRecord;
}

export function stage(key: string, overrides: Partial<StageProgressRecord> = {}): StageProgressRecord {
  return {
    id: `sp-${key}`,
    entity_id: 'e1',
    stage_key: key,
    status: 'complete',
    data: {},
    completed_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  } as StageProgressRecord;
}

/** The field names here must match `ConflictRecord` exactly, or the engine reads undefined. */
export function conflict(overrides: Partial<ConflictRecord> = {}): ConflictRecord {
  return {
    id: 'cf1',
    entity_id: 'e1',
    attribute_key: 'identity.location',
    kind: 'value_contradiction',
    severity: 'normal',
    claim_ids: ['c-loc'],
    source_ids: ['s1', 's2'],
    description: 'Sources disagree about your location',
    user_message: 'One source says London, another says Paris.',
    evidence: {},
    status: 'open',
    resolution_note: null,
    resolved_at: null,
    detected_at: NOW,
    ...overrides,
  } as unknown as ConflictRecord;
}

/** Field names must match `AmbiguityRecord` exactly. */
export function ambiguity(overrides: Partial<AmbiguityRecord> = {}): AmbiguityRecord {
  return {
    id: 'am1',
    entity_id: 'e1',
    dimension: 'identity',
    description: 'This could describe more than one person',
    candidates: [{ source_id: 's1' }, { source_id: 's2' }],
    missing_evidence: ['A distinguishing role or organisation'],
    severity: 'blocking',
    status: 'open',
    resolution_note: null,
    resolved_at: null,
    detected_at: NOW,
    ...overrides,
  } as unknown as AmbiguityRecord;
}

export function identityLink(overrides: Partial<IdentityLinkRecord> = {}): IdentityLinkRecord {
  return {
    source_id: 's1',
    resolved_state: 'confirmed',
    user_decision: null,
    ...overrides,
  } as IdentityLinkRecord;
}
