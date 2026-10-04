/** Sources, photos and portfolio file repositories. */

import type { AccessStatus, InspectionStatus, SourceType } from '@nexora/core';
import { roleFlags } from '@nexora/inspect';
import { bool, json, num, query, queryOne } from './pool';

export interface SourceRecord {
  id: string;
  entity_id: string;
  url: string;
  canonical_url: string;
  registrable_domain: string | null;
  host: string | null;
  supplied_kind: string;
  declared_as_website: boolean;
  declared_as_press: boolean;
  declared_as_profile: boolean;
  declared_as_page: boolean;
  source_type: SourceType;
  platform: string | null;
  platform_handle: string | null;
  title: string | null;
  description: string | null;
  author: string | null;
  published_date: string | null;
  http_status: number | null;
  final_url: string | null;
  redirects: { from: string; to: string; status: number }[];
  content_type: string | null;
  platform_note: string | null;
  platform_mechanism: string | null;
  access_status: AccessStatus;
  access_detail: string | null;
  inspection_status: InspectionStatus;
  inspected_at: Date | null;
  last_checked_at: Date | null;
  check_error: string | null;
  content_hash: string | null;
  text_excerpt: string | null;
  text_length: number | null;
  independence_group: string | null;
  fingerprint_tokens: number;
  extracted: ExtractedSourceData;
  qualifiers: SourceQualifiers;
  qualifies_websites: boolean;
  qualifies_press: boolean;
  subject_relevance: number;
  quality_score: number;
  is_duplicate_of: string | null;
  published: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface ExtractedSourceData {
  names?: string[];
  alternateNames?: string[];
  headline?: string | null;
  organisation?: string | null;
  location?: string | null;
  description?: string | null;
  images?: { url: string; alt?: string | null; width?: number | null; height?: number | null }[];
  links?: { rel?: string; href: string; text?: string | null }[];
  profiles?: string[];
  sameAs?: string[];
  jsonLdTypes?: string[];
  dates?: { published?: string | null; modified?: string | null } | null;
  keywords?: string[];
  emails?: string[];
  headings?: string[];
  isArticle?: boolean;
  articlePublisher?: string | null;
  loginWall?: boolean;
  challengePage?: boolean;
  platformData?: Record<string, unknown> | null;
  platformDataUnavailable?: boolean;
  excerpt?: string | null;
}

export interface SourceQualifiers {
  reachable?: boolean;
  aboutSubject?: boolean;
  liveContent?: boolean;
  distinctContent?: boolean;
  qualifiesForMinimum?: boolean;
  qualifiesWebsites?: boolean;
  qualifiesPress?: boolean;
  isPress?: boolean;
  independence?: string | null;
  reasons?: string[];
  blockers?: string[];
  checkedAt?: string;
  assessment?: string;
  /** Honest platform-access limitation, when a connector could not read a profile. */
  platformNote?: string | null;
  /** Subject relevance score recorded at inspection time. */
  subjectRelevance?: number;
  /** Duplicate/syndication assessment. */
  duplicateOf?: string | null;
  similarity?: number;
}

function mapSource(r: Record<string, unknown>): SourceRecord {
  return {
    ...(r as unknown as SourceRecord),
    redirects: json(r.redirects, [] as SourceRecord['redirects']),
    extracted: json(r.extracted, {} as ExtractedSourceData),
    qualifiers: json(r.qualifiers, {} as SourceQualifiers),
    qualifies_websites: bool(r.qualifies_websites),
    qualifies_press: bool(r.qualifies_press),
    declared_as_website: bool(r.declared_as_website),
    declared_as_press: bool(r.declared_as_press),
    declared_as_profile: bool(r.declared_as_profile),
    declared_as_page: bool(r.declared_as_page),
    subject_relevance: num(r.subject_relevance),
    quality_score: num(r.quality_score),
    fingerprint_tokens: num(r.fingerprint_tokens),
  };
}

export async function listSources(entityId: string): Promise<SourceRecord[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM sources WHERE entity_id = $1 ORDER BY created_at ASC',
    [entityId],
  );
  return rows.map(mapSource);
}

export async function getSource(id: string): Promise<SourceRecord | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM sources WHERE id = $1', [id]);
  return row ? mapSource(row) : null;
}

export async function findSourceByCanonicalUrl(
  entityId: string,
  canonicalUrl: string,
): Promise<SourceRecord | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM sources WHERE entity_id = $1 AND canonical_url = $2',
    [entityId, canonicalUrl],
  );
  return row ? mapSource(row) : null;
}

export interface SourceInsert {
  entityId: string;
  url: string;
  canonicalUrl: string;
  registrableDomain: string | null;
  host: string | null;
  suppliedKind: string;
  sourceType?: SourceType;
  platform?: string | null;
  platformHandle?: string | null;
  independenceGroup?: string | null;
}

export async function insertSource(input: SourceInsert): Promise<SourceRecord> {
  // A URL can be supplied in several roles. Each role is recorded separately so qualification
  // never loses a declaration when the same address appears in more than one stage.
  const role = roleFlags(input.suppliedKind);
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO sources (entity_id, url, canonical_url, registrable_domain, host,
                          supplied_kind, source_type, platform, platform_handle, independence_group,
                          declared_as_website, declared_as_press, declared_as_profile, declared_as_page)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (entity_id, canonical_url) DO UPDATE
       SET declared_as_website = sources.declared_as_website OR EXCLUDED.declared_as_website,
           declared_as_press    = sources.declared_as_press    OR EXCLUDED.declared_as_press,
           declared_as_profile  = sources.declared_as_profile  OR EXCLUDED.declared_as_profile,
           declared_as_page     = sources.declared_as_page     OR EXCLUDED.declared_as_page,
           updated_at = now()
     RETURNING *`,
    [
      input.entityId,
      input.url,
      input.canonicalUrl,
      input.registrableDomain,
      input.host,
      input.suppliedKind,
      input.sourceType ?? 'other',
      input.platform ?? null,
      input.platformHandle ?? null,
      input.independenceGroup ?? null,
      role.website,
      role.press,
      role.profile,
      role.page,
    ],
  );
  if (!row) throw new Error('insertSource returned no row');
  return mapSource(row);
}


export async function markSourceInspecting(sourceId: string): Promise<void> {
  await query(`UPDATE sources SET inspection_status = 'inspecting', updated_at = now() WHERE id = $1`, [
    sourceId,
  ]);
}

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
  await query(
    `UPDATE sources SET
        http_status = COALESCE($2, http_status),
        final_url = COALESCE($3, final_url),
        redirects = COALESCE($4::jsonb, redirects),
        content_type = COALESCE($5, content_type),
        title = COALESCE($6, title),
        description = COALESCE($7, description),
        author = COALESCE($8, author),
        published_date = COALESCE($9, published_date),
        access_status = COALESCE($10, access_status),
        access_detail = COALESCE($11, access_detail),
        inspection_status = COALESCE($12, inspection_status),
        check_error = COALESCE($13, check_error),
        content_hash = COALESCE($14, content_hash),
        text_excerpt = COALESCE($15, text_excerpt),
        text_length = COALESCE($16, text_length),
        extracted = COALESCE($17::jsonb, extracted),
        source_type = COALESCE($18, source_type),
        platform = COALESCE($19, platform),
        platform_handle = COALESCE($20, platform_handle),
        independence_group = COALESCE($21, independence_group),
        qualifiers = COALESCE($22::jsonb, qualifiers),
        qualifies_websites = COALESCE($23, qualifies_websites),
        qualifies_press = COALESCE($24, qualifies_press),
        subject_relevance = COALESCE($25, subject_relevance),
        quality_score = COALESCE($26, quality_score),
        last_checked_at = now(),
        inspected_at = CASE WHEN $27 THEN now() ELSE inspected_at END,
        updated_at = now()
      WHERE id = $1`,
    [
      input.sourceId,
      input.httpStatus ?? null,
      input.finalUrl ?? null,
      input.redirects ? JSON.stringify(input.redirects) : null,
      input.contentType ?? null,
      input.title ?? null,
      input.description ?? null,
      input.author ?? null,
      input.publishedDate ?? null,
      input.accessStatus,
      input.accessDetail ?? null,
      input.inspectionStatus,
      input.checkError ?? null,
      input.contentHash ?? null,
      input.textExcerpt ?? null,
      input.textLength ?? null,
      input.extracted ? JSON.stringify(input.extracted) : null,
      input.sourceType ?? null,
      input.platform ?? null,
      input.platformHandle ?? null,
      input.independenceGroup ?? null,
      input.qualifiers ? JSON.stringify(input.qualifiers) : null,
      input.qualifiesWebsites ?? null,
      input.qualifiesPress ?? null,
      input.subjectRelevance ?? null,
      input.qualityScore ?? null,
      input.inspected ?? false,
    ],
  );
}

export async function setSourceDuplicate(sourceId: string, duplicateOf: string | null): Promise<void> {
  await query('UPDATE sources SET is_duplicate_of = $2, updated_at = now() WHERE id = $1', [
    sourceId,
    duplicateOf,
  ]);
}

export async function setSourcePublished(sourceId: string, published: boolean): Promise<void> {
  await query('UPDATE sources SET published = $2, updated_at = now() WHERE id = $1', [
    sourceId,
    published,
  ]);
}

export async function countQualifyingWebsites(entityId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM sources
      WHERE entity_id = $1 AND qualifies_websites AND is_duplicate_of IS NULL`,
    [entityId],
  );
  return num(row?.n);
}

export async function countQualifyingPress(entityId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM sources
      WHERE entity_id = $1 AND qualifies_press AND is_duplicate_of IS NULL`,
    [entityId],
  );
  return num(row?.n);
}

// ── Photos ───────────────────────────────────────────────────────────────

export interface PhotoRecord {
  id: string;
  entity_id: string;
  storage_path: string | null;
  public_url: string | null;
  original_filename: string | null;
  mime: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  sha256: string | null;
  perceptual_hash: string | null;
  origin: 'user_upload' | 'discovered';
  caption: string | null;
  alt: string | null;
  source_id: string | null;
  representation_status: 'pending' | 'primary' | 'supporting' | 'unverified' | 'rejected';
  inspection_status: 'pending' | 'inspecting' | 'inspected' | 'failed';
  inspection_detail: Record<string, unknown>;
  qualifies: boolean;
  disqualify_reasons: string[];
  sort_order: number;
  is_primary: boolean;
  uploaded_at: Date;
  verified_at: Date | null;
}

function mapPhoto(r: Record<string, unknown>): PhotoRecord {
  return {
    ...(r as unknown as PhotoRecord),
    inspection_detail: json(r.inspection_detail, {} as Record<string, unknown>),
    disqualify_reasons: json(r.disqualify_reasons, [] as string[]),
    qualifies: bool(r.qualifies),
    is_primary: bool(r.is_primary),
    bytes: r.bytes === null || r.bytes === undefined ? null : num(r.bytes),
    width: r.width === null || r.width === undefined ? null : num(r.width),
    height: r.height === null || r.height === undefined ? null : num(r.height),
    sort_order: num(r.sort_order),
  };
}

export async function listPhotos(entityId: string): Promise<PhotoRecord[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM photos WHERE entity_id = $1 ORDER BY is_primary DESC, sort_order ASC, uploaded_at ASC',
    [entityId],
  );
  return rows.map(mapPhoto);
}

export async function findPhotoBySha(entityId: string, sha: string): Promise<PhotoRecord | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM photos WHERE entity_id = $1 AND sha256 = $2',
    [entityId, sha],
  );
  return row ? mapPhoto(row) : null;
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
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO photos (entity_id, storage_path, public_url, original_filename, mime, bytes,
                          width, height, sha256, perceptual_hash, caption, alt, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (entity_id, sha256) DO UPDATE SET updated_at = now()
     RETURNING *`,
    [
      input.entityId,
      input.storagePath,
      input.publicUrl,
      input.originalFilename,
      input.mime,
      input.bytes,
      input.width,
      input.height,
      input.sha256,
      input.perceptualHash,
      input.caption ?? null,
      input.alt ?? null,
      input.sortOrder ?? 0,
    ],
  );
  if (!row) throw new Error('insertPhoto returned no row');
  return mapPhoto(row);
}

export async function updatePhotoAssessment(input: {
  photoId: string;
  representationStatus: PhotoRecord['representation_status'];
  inspectionStatus: PhotoRecord['inspection_status'];
  inspectionDetail: Record<string, unknown>;
  qualifies: boolean;
  disqualifyReasons: string[];
}): Promise<void> {
  await query(
    `UPDATE photos SET representation_status = $2, inspection_status = $3,
            inspection_detail = $4::jsonb, qualifies = $5, disqualify_reasons = $6::jsonb,
            verified_at = now(), updated_at = now()
      WHERE id = $1`,
    [
      input.photoId,
      input.representationStatus,
      input.inspectionStatus,
      JSON.stringify(input.inspectionDetail),
      input.qualifies,
      JSON.stringify(input.disqualifyReasons),
    ],
  );
}

export async function setPhotoCaption(photoId: string, caption: string | null, alt: string | null): Promise<void> {
  await query('UPDATE photos SET caption = $2, alt = COALESCE($3, alt), updated_at = now() WHERE id = $1', [
    photoId,
    caption,
    alt,
  ]);
}

export async function makePrimaryPhoto(photoId: string, entityId: string): Promise<void> {
  await query('UPDATE photos SET is_primary = false WHERE entity_id = $1', [entityId]);
  await query('UPDATE photos SET is_primary = true, representation_status = $2 WHERE id = $1', [
    photoId,
    'primary',
  ]);
}

export async function countQualifyingPhotos(entityId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM photos WHERE entity_id = $1 AND qualifies AND representation_status <> 'rejected'",
    [entityId],
  );
  return num(row?.n);
}

export async function deletePhoto(photoId: string): Promise<void> {
  await query('DELETE FROM photos WHERE id = $1', [photoId]);
}

// ── Portfolio files ─────────────────────────────────────────────────────

export interface PortfolioFileRecord {
  id: string;
  entity_id: string;
  original_filename: string;
  mime: string | null;
  bytes: number | null;
  storage_path: string | null;
  sha256: string | null;
  extraction_status: 'pending' | 'extracting' | 'extracted' | 'failed' | 'unsupported';
  extraction: PortfolioExtraction;
  extraction_error: string | null;
  uploaded_at: Date;
}

export interface PortfolioExtraction {
  kind?: string;
  textLength?: number;
  excerpt?: string;
  links?: string[];
  emails?: string[];
  names?: string[];
  organisations?: string[];
  dates?: string[];
  sections?: { heading: string; text: string }[];
  images?: { name: string; width?: number; height?: number }[];
  pageCount?: number;
  warnings?: string[];
  extractedAt?: string;
}

function mapPortfolio(r: Record<string, unknown>): PortfolioFileRecord {
  return {
    ...(r as unknown as PortfolioFileRecord),
    extraction: json(r.extraction, {} as PortfolioExtraction),
    bytes: r.bytes === null || r.bytes === undefined ? null : num(r.bytes),
  };
}

export async function listPortfolioFiles(entityId: string): Promise<PortfolioFileRecord[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM portfolio_files WHERE entity_id = $1 ORDER BY uploaded_at ASC',
    [entityId],
  );
  return rows.map(mapPortfolio);
}

export async function insertPortfolioFile(input: {
  entityId: string;
  originalFilename: string;
  mime: string;
  bytes: number;
  storagePath: string;
  sha256: string;
}): Promise<PortfolioFileRecord> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO portfolio_files (entity_id, original_filename, mime, bytes, storage_path, sha256)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [
      input.entityId,
      input.originalFilename,
      input.mime,
      input.bytes,
      input.storagePath,
      input.sha256,
    ],
  );
  if (!row) throw new Error('insertPortfolioFile returned no row');
  return mapPortfolio(row);
}

export async function updatePortfolioExtraction(input: {
  fileId: string;
  status: PortfolioFileRecord['extraction_status'];
  extraction: PortfolioExtraction;
  error?: string | null;
}): Promise<void> {
  await query(
    'UPDATE portfolio_files SET extraction_status = $2, extraction = $3::jsonb, extraction_error = $4 WHERE id = $1',
    [input.fileId, input.status, JSON.stringify(input.extraction), input.error ?? null],
  );
}