/**
 * In-memory mirror of the source, photo and portfolio repositories.
 * See `memory.ts` for the rationale and safety rules.
 */

import type { AccessStatus, InspectionStatus, SourceType } from '@nexora/core';
import type { SourceRecord, SourceInsert, PhotoRecord, PortfolioFileRecord, ExtractedSourceData, SourceQualifiers, PortfolioExtraction } from './repos-sources';
import { mem } from './memory-store';
import { NotImplementedInMemory } from './memory';

const clone = <T,>(v: T): T => (v === null || v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const now = () => new Date();

/** The four role flags a source can carry, mirroring `roleFlags` in repos-sources. */
function roleFlags(suppliedKind: string): { website: boolean; press: boolean; profile: boolean; page: boolean } {
  return {
    website: suppliedKind === 'website',
    press: suppliedKind === 'press_release',
    profile: suppliedKind === 'profile',
    page: suppliedKind === 'page',
  };
}

function blankSource(
  entityId: string,
  input: SourceInsert,
  role: ReturnType<typeof roleFlags>,
): SourceRecord {
  return {
    id: mem.uid(),
    entity_id: entityId,
    url: input.url,
    canonical_url: input.canonicalUrl,
    registrable_domain: input.registrableDomain,
    host: input.host,
    supplied_kind: input.suppliedKind,
    source_type: input.sourceType ?? 'other',
    platform: input.platform ?? null,
    platform_handle: input.platformHandle ?? null,
    title: null,
    description: null,
    author: null,
    published_date: null,
    http_status: null,
    final_url: null,
    redirects: [],
    content_type: null,
    access_status: 'pending' as AccessStatus,
    access_detail: null,
    inspection_status: 'pending' as InspectionStatus,
    inspected_at: null,
    last_checked_at: null,
    check_error: null,
    content_hash: null,
    text_excerpt: null,
    text_length: null,
    independence_group: input.independenceGroup ?? null,
    fingerprint_tokens: 0,
    extracted: {} as ExtractedSourceData,
    qualifiers: {} as SourceQualifiers,
    qualifies_websites: false,
    qualifies_press: false,
    subject_relevance: 0,
    quality_score: 0,
    is_duplicate_of: null,
    published: false,
    declared_as_website: role.website,
    declared_as_press: role.press,
    declared_as_profile: role.profile,
    declared_as_page: role.page,
    platform_note: null,
    platform_mechanism: null,
    created_at: now(),
    updated_at: now(),
  };
}

export async function insertSource(input: SourceInsert): Promise<SourceRecord> {
  const role = roleFlags(input.suppliedKind);
  const existing = mem.table('sources').find(
    (r) => r['entity_id'] === input.entityId && r['canonical_url'] === input.canonicalUrl,
  ) as SourceRecord | undefined;

  if (existing) {
    // Roles are OR-merged: a URL supplied in several stages keeps every declaration.
    existing.declared_as_website = existing.declared_as_website || role.website;
    existing.declared_as_press = existing.declared_as_press || role.press;
    existing.declared_as_profile = existing.declared_as_profile || role.profile;
    existing.declared_as_page = existing.declared_as_page || role.page;
    existing.updated_at = now();
    return existing;
  }

  const row = blankSource(input.entityId, input, role);
  mem.table('sources').push(row as unknown as Record<string, unknown>);
  return row;
}

export async function listSources(entityId: string): Promise<SourceRecord[]> {
  return mem.table('sources').filter((r) => r['entity_id'] === entityId) as unknown as SourceRecord[];
}

export async function getSource(id: string): Promise<SourceRecord | null> {
  return (mem.table('sources').find((r) => r['id'] === id) as unknown as SourceRecord | undefined) ?? null;
}

export async function findSourceByCanonicalUrl(
  entityId: string,
  canonicalUrl: string,
): Promise<SourceRecord | null> {
  return (
    (mem
      .table('sources')
      .find((r) => r['entity_id'] === entityId && r['canonical_url'] === canonicalUrl) as
      | SourceRecord
      | undefined) ?? null
  );
}

export async function markSourceInspecting(sourceId: string): Promise<void> {
  const s = (await getSource(sourceId)) as unknown as Record<string, unknown> | null;
  if (s) {
    s['inspection_status'] = 'inspecting';
    s['updated_at'] = now();
  }
}

/** COALESCE semantics: an omitted field leaves the stored value untouched. */
export async function updateSourceInspection(input: {
  sourceId: string;
  accessStatus?: AccessStatus;
  inspectionStatus?: InspectionStatus;
  httpStatus?: number | null;
  finalUrl?: string | null;
  redirects?: { from: string; to: string; status: number }[];
  contentType?: string | null;
  title?: string | null;
  description?: string | null;
  author?: string | null;
  publishedDate?: string | null;
  accessDetail?: string | null;
  checkError?: string | null;
  contentHash?: string | null;
  textExcerpt?: string | null;
  textLength?: number | null;
  extracted?: ExtractedSourceData;
  sourceType?: SourceType;
  platform?: string | null;
  platformHandle?: string | null;
  independenceGroup?: string | null;
  qualifiers?: SourceQualifiers;
  qualifiesWebsites?: boolean;
  qualifiesPress?: boolean;
  subjectRelevance?: number;
  qualityScore?: number;
  inspected?: boolean;
}): Promise<void> {
  const s = (await getSource(input.sourceId)) as unknown as Record<string, unknown> | null;
  if (!s) return;
  const set = (k: string, v: unknown) => {
    if (v !== undefined && v !== null) s[k] = clone(v);
  };
  set('http_status', input.httpStatus);
  set('final_url', input.finalUrl);
  set('redirects', input.redirects);
  set('content_type', input.contentType);
  set('title', input.title);
  set('description', input.description);
  set('author', input.author);
  set('published_date', input.publishedDate);
  set('access_status', input.accessStatus);
  set('access_detail', input.accessDetail);
  set('inspection_status', input.inspectionStatus);
  set('check_error', input.checkError);
  set('content_hash', input.contentHash);
  set('text_excerpt', input.textExcerpt);
  set('text_length', input.textLength);
  set('extracted', input.extracted);
  set('source_type', input.sourceType);
  set('platform', input.platform);
  set('platform_handle', input.platformHandle);
  set('independence_group', input.independenceGroup);
  set('qualifiers', input.qualifiers);
  set('qualifies_websites', input.qualifiesWebsites);
  set('qualifies_press', input.qualifiesPress);
  set('subject_relevance', input.subjectRelevance);
  set('quality_score', input.qualityScore);
  s['last_checked_at'] = now();
  if (input.inspected) s['inspected_at'] = now();
  s['updated_at'] = now();
}

export async function setSourceDuplicate(sourceId: string, duplicateOf: string | null): Promise<void> {
  const s = (await getSource(sourceId)) as unknown as Record<string, unknown> | null;
  if (s) {
    s['is_duplicate_of'] = duplicateOf;
    s['updated_at'] = now();
  }
}

export async function setSourcePublished(sourceId: string, published: boolean): Promise<void> {
  const s = (await getSource(sourceId)) as unknown as Record<string, unknown> | null;
  if (s) {
    s['published'] = published;
    s['updated_at'] = now();
  }
}

export async function countQualifyingWebsites(entityId: string): Promise<number> {
  return mem
    .table('sources')
    .filter(
      (r) =>
        r['entity_id'] === entityId && r['qualifies_websites'] === true && r['is_duplicate_of'] === null,
    ).length;
}

export async function countQualifyingPress(entityId: string): Promise<number> {
  return mem
    .table('sources')
    .filter(
      (r) => r['entity_id'] === entityId && r['qualifies_press'] === true && r['is_duplicate_of'] === null,
    ).length;
}

// ── photos ──────────────────────────────────────────────────────────────────

function mapPhoto(r: Record<string, unknown>): PhotoRecord {
  return { ...(r as unknown as PhotoRecord) } as PhotoRecord;
}

export async function listPhotos(entityId: string): Promise<PhotoRecord[]> {
  return mem
    .table('photos')
    .filter((r) => r['entity_id'] === entityId)
    .map(mapPhoto)
    .sort((a, b) => {
      // ORDER BY is_primary DESC, sort_order ASC, uploaded_at ASC
      const p = Number(b.is_primary) - Number(a.is_primary);
      if (p !== 0) return p;
      const s = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (s !== 0) return s;
      return a.uploaded_at.getTime() - b.uploaded_at.getTime();
    });
}

export async function findPhotoBySha(entityId: string, sha: string): Promise<PhotoRecord | null> {
  const r = mem.table('photos').find((x) => x['entity_id'] === entityId && x['sha256'] === sha);
  return r ? mapPhoto(r) : null;
}

export async function insertPhoto(input: {
  entityId: string;
  storagePath: string;
  publicUrl: string;
  originalFilename: string;
  mime: string;
  bytes: number;
  width: number;
  height: number;
  sha256: string;
  perceptualHash: string;
  caption?: string | null;
  alt?: string | null;
  sortOrder?: number;
}): Promise<PhotoRecord> {
  const existing = await findPhotoBySha(input.entityId, input.sha256);
  if (existing) return existing;

  const row: PhotoRecord = {
    id: mem.uid(),
    entity_id: input.entityId,
    storage_path: input.storagePath,
    public_url: input.publicUrl,
    original_filename: input.originalFilename,
    mime: input.mime,
    bytes: input.bytes,
    width: input.width,
    height: input.height,
    sha256: input.sha256,
    perceptual_hash: input.perceptualHash,
    origin: 'user_upload',
    caption: input.caption ?? null,
    alt: input.alt ?? null,
    source_id: null,
    representation_status: 'pending',
    inspection_status: 'pending',
    inspection_detail: {},
    qualifies: false,
    disqualify_reasons: [],
    sort_order: input.sortOrder ?? 0,
    is_primary: false,
    uploaded_at: now(),
    verified_at: null,
  };
  mem.table('photos').push(row as unknown as Record<string, unknown>);
  return row;
}

export async function updatePhotoAssessment(input: {
  photoId: string;
  representationStatus: PhotoRecord['representation_status'];
  inspectionStatus: PhotoRecord['inspection_status'];
  inspectionDetail: Record<string, unknown>;
  qualifies: boolean;
  disqualifyReasons: string[];
}): Promise<void> {
  const r = mem.table('photos').find((x) => x['id'] === input.photoId);
  if (!r) return;
  r['representation_status'] = input.representationStatus;
  r['inspection_status'] = input.inspectionStatus;
  r['inspection_detail'] = clone(input.inspectionDetail);
  r['qualifies'] = input.qualifies;
  r['disqualify_reasons'] = clone(input.disqualifyReasons);
  r['verified_at'] = now();
}

export async function setPhotoCaption(photoId: string, caption: string | null, alt: string | null): Promise<void> {
  const r = mem.table('photos').find((x) => x['id'] === photoId);
  if (!r) return;
  r['caption'] = caption;
  if (alt !== null) r['alt'] = alt;
}

export async function makePrimaryPhoto(photoId: string, entityId: string): Promise<void> {
  for (const r of mem.table('photos')) {
    if (r['entity_id'] === entityId) r['is_primary'] = false;
  }
  const target = mem.table('photos').find((x) => x['id'] === photoId);
  if (target) {
    target['is_primary'] = true;
    target['representation_status'] = 'primary';
  }
}

export async function countQualifyingPhotos(entityId: string): Promise<number> {
  return mem
    .table('photos')
    .filter(
      (r) =>
        r['entity_id'] === entityId &&
        r['qualifies'] === true &&
        r['representation_status'] !== 'rejected',
    ).length;
}

export async function deletePhoto(photoId: string): Promise<void> {
  const t = mem.table('photos');
  const i = t.findIndex((x) => x['id'] === photoId);
  if (i >= 0) t.splice(i, 1);
}

// ── portfolio ───────────────────────────────────────────────────────────────

function mapPortfolio(r: Record<string, unknown>): PortfolioFileRecord {
  return { ...(r as unknown as PortfolioFileRecord) } as PortfolioFileRecord;
}

export async function listPortfolioFiles(entityId: string): Promise<PortfolioFileRecord[]> {
  return mem
    .table('portfolio_files')
    .filter((r) => r['entity_id'] === entityId)
    .map(mapPortfolio)
    .sort((a, b) => a.uploaded_at.getTime() - b.uploaded_at.getTime());
}

export async function insertPortfolioFile(input: {
  entityId: string;
  originalFilename: string;
  mime: string;
  bytes: number;
  storagePath: string;
  sha256: string;
}): Promise<PortfolioFileRecord> {
  const row: PortfolioFileRecord = {
    id: mem.uid(),
    entity_id: input.entityId,
    original_filename: input.originalFilename,
    mime: input.mime,
    bytes: input.bytes,
    storage_path: input.storagePath,
    sha256: input.sha256,
    extraction_status: 'pending',
    extraction: {} as PortfolioExtraction,
    extraction_error: null,
    uploaded_at: now(),
  };
  mem.table('portfolio_files').push(row as unknown as Record<string, unknown>);
  return row;
}

export async function updatePortfolioExtraction(input: {
  fileId: string;
  status: PortfolioFileRecord['extraction_status'];
  extraction: PortfolioExtraction;
  error?: string | null;
}): Promise<void> {
  const r = mem.table('portfolio_files').find((x) => x['id'] === input.fileId);
  if (!r) return;
  r['extraction_status'] = input.status;
  r['extraction'] = clone(input.extraction);
  r['extraction_error'] = input.error ?? null;
}

export { NotImplementedInMemory };