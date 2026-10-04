/**
 * Nexora Entity — core vocabulary.
 *
 * These enums are the authoritative definitions of the product's concepts. They encode the
 * distinctions the platform is required to preserve (spec §11, §12, §13, §14, §17, §18, §19):
 *
 *  - information supplied by the user            -> ClaimOrigin.user
 *  - information discovered from external source -> ClaimOrigin.discovered
 *  - independently supported information         -> ClaimStatus.independentlySupported
 *  - information that remains uncertain          -> ClaimStatus.uncertain
 *  - information that conflicts                  -> ClaimStatus.conflicting
 *  - accepted as authoritative in Nexora Entity  -> ClaimStatus.acceptedAuthoritative
 *
 * Product language guard: nothing in this file refers to Google verification, Google approval
 * or a guaranteed Knowledge Panel. "Verified" always means verified against Nexora Entity's own
 * Entity Readiness Standard.
 */

export const PRODUCT_NAME = 'Nexora Entity' as const;
export const PRODUCT_TAGLINE =
  'Build a complete, connected representation of who you are online.' as const;

/** Standard disclosure shown wherever a readiness percentage is displayed. */
export const READINESS_DISCLAIMER =
  'Entity Readiness measures completeness and internal coherence against the Nexora Entity Readiness Standard. It is not Google verification, Google approval, or a guarantee of a Google Knowledge Panel. Search engines decide independently what information they show.' as const;

/** The evidence minimums are Nexora Entity internal requirements, never presented as Google's. */
export const EVIDENCE_MINIMUMS_NOTICE =
  'These are Nexora Entity internal evidence requirements. They are not requirements imposed by Google or any other search engine.' as const;

// ─────────────────────────────────────────────────────────────────────────────
// Identity, evidence and knowledge status
// ─────────────────────────────────────────────────────────────────────────────

/** Where a piece of information came from. Preserved end-to-end; never collapsed. */
export const ClaimOrigin = {
  /** Typed by the person in the guided stages. */
  user: 'user',
  /** Read from an external, inspected source. */
  discovered: 'discovered',
  /** Produced by Nexora's deterministic or AI-assisted analysis of other information. */
  derived: 'derived',
  /** Published by the platform on the public Entity Website. */
  published: 'published',
} as const;
export type ClaimOrigin = (typeof ClaimOrigin)[keyof typeof ClaimOrigin];

/**
 * Knowledge state of a claim. This is the central axis of the product:
 * it distinguishes what a person asserted, what a source says, what is independently
 * corroborated, what is uncertain, what conflicts, and what Nexora has accepted.
 */
export const ClaimStatus = {
  /** Extracted but not yet evaluated. */
  proposed: 'proposed',
  /** Supplied by the user, not corroborated. Must not be presented as verified fact. */
  userProvided: 'user_provided',
  /** Asserted by an inspected external source, not yet independently corroborated. */
  sourced: 'sourced',
  /** Supported by two or more genuinely independent sources. */
  independentlySupported: 'independently_supported',
  /** Evidence exists but is insufficient or ambiguous. */
  uncertain: 'uncertain',
  /** Another claim about the same attribute disagrees. */
  conflicting: 'conflicting',
  /** Accepted as authoritative inside Nexora Entity (user-confirmed or evidence-resolved). */
  acceptedAuthoritative: 'accepted_authoritative',
  /** Excluded by the user or by verification failure. Never published. */
  rejected: 'rejected',
  /** Superseded by a newer, temporally later authoritative statement. */
  superseded: 'superseded',
} as const;
export type ClaimStatus = (typeof ClaimStatus)[keyof typeof ClaimStatus];

/** Which allowed, independent source-groups back a claim. Drives source independence. */
export const SupportStrength = {
  none: 'none',
  /** Only what the person themselves said. */
  selfAsserted: 'self_asserted',
  /** One source, or several sources that are not independent of each other. */
  singleSource: 'single_source',
  /** Two or more independent source groups. */
  corroborated: 'corroborated',
  /** An authoritative/direct source plus independent corroboration. */
  stronglySupported: 'strongly_supported',
} as const;
export type SupportStrength = (typeof SupportStrength)[keyof typeof SupportStrength];

/** Resolution state of an identity relationship (spec §10). */
export const IdentityState = {
  confirmed: 'confirmed',
  probableNeedsReview: 'probable_needs_review',
  uncertain: 'uncertain',
  conflict: 'conflict',
  rejected: 'rejected',
  pending: 'pending',
} as const;
export type IdentityState = (typeof IdentityState)[keyof typeof IdentityState];

/** Source type used for reliability weighting (spec §12). Never all treated as equal. */
export const SourceType = {
  /** A site or profile the person controls and declared as theirs. */
  selfAuthoredSite: 'self_authored_site',
  /** An established independent publication (press, news outlet, journal). */
  independentPublication: 'independent_publication',
  /** A syndication wire or press-release distribution service. */
  pressWire: 'press_wire',
  /** A public social or professional network profile. */
  socialProfile: 'social_profile',
  /** A profile the subject declared on a platform they control. */
  selfDeclaredProfile: 'self_declared_profile',
  /** A professional network profile (LinkedIn and similar). */
  professionalProfile: 'professional_profile',
  /** A creator/portfolio platform profile. */
  creatorProfile: 'creator_profile',
  /** A personal project or product site associated with the person. */
  projectSite: 'project_site',
  /** An organization/company site the person is affiliated with. */
  organizationSite: 'organization_site',
  /** A direct, authorized first-party record (employer, registry, official org site). */
  directAuthorized: 'direct_authorized',
  /** A third-party directory or aggregator. */
  directory: 'directory',
  /** A file the user uploaded (portfolio, CV). */
  userDocument: 'user_document',
  /** A photo the user uploaded. */
  userPhoto: 'user_photo',
  /** Anything not further classified. */
  other: 'other',
} as const;
export type SourceType = (typeof SourceType)[keyof typeof SourceType];

/**
 * Authority tier. Higher = stronger evidence. Implemented as an explicit, inspectable
 * model rather than an opaque score (spec §12 permits refining the exact scoring).
 */
export const AuthorityTier = {
  /** Assertion by the subject; useful but not independent. */
  subjectAssertion: 1,
  /** Content the subject authors about themselves. */
  selfAuthored: 2,
  /** Self-declared profile on a platform. */
  selfDeclaredProfile: 3,
  /** Platform-mediated professional profile. */
  platformProfile: 4,
  /** Established independent publication. */
  independentPublication: 5,
  /** Direct, authorized first-party record (employer, registry, official org site). */
  directAuthorized: 6,
} as const;
export type AuthorityTier = (typeof AuthorityTier)[keyof typeof AuthorityTier];

/** Honest result of attempting to reach and read a source. Never claim more than happened. */
export const AccessStatus = {
  pending: 'pending',
  accessible: 'accessible',
  /** Reached, but the platform withholds the content (login wall, anti-bot). */
  accessLimited: 'access_limited',
  /** HTTP 401/403 or bot challenge. */
  blocked: 'blocked',
  notFound: 'not_found',
  networkError: 'network_error',
  timeout: 'timeout',
  invalidUrl: 'invalid_url',
  unsupportedContent: 'unsupported_content',
  private: 'private',
  userDeclined: 'user_declined',
} as const;
export type AccessStatus = (typeof AccessStatus)[keyof typeof AccessStatus];

/** Whether an inspection actually ran to completion. */
export const InspectionStatus = {
  pending: 'pending',
  inspecting: 'inspecting',
  inspected: 'inspected',
  failed: 'failed',
  skipped: 'skipped',
} as const;
export type InspectionStatus = (typeof InspectionStatus)[keyof typeof InspectionStatus];

// ─────────────────────────────────────────────────────────────────────────────
// Entity graph
// ─────────────────────────────────────────────────────────────────────────────

/** Predicates used by the internal entity relationship graph (spec §16). */
export const Predicate = {
  hasName: 'hasName',
  hasAlias: 'hasAlias',
  hasProfession: 'hasProfession',
  hasTitle: 'hasTitle',
  representedBy: 'representedBy',
  associatedWith: 'associatedWith',
  memberOf: 'memberOf',
  created: 'created',
  founded: 'founded',
  worksOn: 'worksOn',
  offersService: 'offersService',
  connectedTo: 'connectedTo',
  representedOn: 'representedOn',
  mentionedBy: 'mentionedBy',
  educatedAt: 'educatedAt',
  locatedIn: 'locatedIn',
  recognizedBy: 'recognizedBy',
  publishedBy: 'publishedBy',
  contactableAt: 'contactableAt',
} as const;
export type Predicate = (typeof Predicate)[keyof typeof Predicate];

/** Node types in the entity graph. */
export const NodeType = {
  person: 'Person',
  name: 'Name',
  alias: 'Alias',
  profession: 'Profession',
  title: 'Title',
  photo: 'ImageObject',
  organization: 'Organization',
  project: 'CreativeWork',
  product: 'Product',
  service: 'Service',
  website: 'WebSite',
  profile: 'ProfilePage',
  pressSource: 'NewsArticle',
  publication: 'Article',
  achievement: 'Thing',
  location: 'Place',
  education: 'EducationalOrganization',
  contact: 'ContactPoint',
  document: 'DigitalDocument',
} as const;
export type NodeType = (typeof NodeType)[keyof typeof NodeType];

// ─────────────────────────────────────────────────────────────────────────────
// Conflicts and ambiguity (spec §13, §14)
// ─────────────────────────────────────────────────────────────────────────────

export const ConflictKind = {
  /** Two sources state different values for the same current attribute. */
  valueContradiction: 'value_contradiction',
  /** A source's subject appears to be a different person. */
  identityMismatch: 'identity_mismatch',
  /** A source asserts an association nothing else supports. */
  unsupportedAssociation: 'unsupported_association',
  /** An older statement contradicts a newer authoritative one — handled by dates. */
  temporalOverride: 'temporal_override',
  /** Structural/logical contradiction (dates out of order, impossible claims). */
  logicalContradiction: 'logical_contradiction',
} as const;
export type ConflictKind = (typeof ConflictKind)[keyof typeof ConflictKind];

export const Severity = {
  blocking: 'blocking',
  warning: 'warning',
  info: 'info',
} as const;
export type Severity = (typeof Severity)[keyof typeof Severity];

export const ResolutionStatus = {
  open: 'open',
  resolvedByEvidence: 'resolved_by_evidence',
  resolvedByUser: 'resolved_by_user',
  dismissed: 'dismissed',
} as const;
export type ResolutionStatus = (typeof ResolutionStatus)[keyof typeof ResolutionStatus];

// ─────────────────────────────────────────────────────────────────────────────
// Guided stages (Amendment §4 — A..W)
// ─────────────────────────────────────────────────────────────────────────────

export const STAGE_KEYS = [
  'A_identity',
  'B_name_variants',
  'C_about',
  'D_professional_identity',
  'E_career',
  'F_education',
  'G_skills',
  'H_organizations',
  'I_projects',
  'J_products_services',
  'K_achievements',
  'L_publications_media',
  'M_press_releases',
  'N_websites',
  'O_portfolio',
  'P_social_profiles',
  'Q_photos',
  'R_online_presence',
  'S_public_contact',
  'T_location',
  'U_dates',
  'V_external_identity_links',
  'W_other',
] as const;
export type StageKey = (typeof STAGE_KEYS)[number];

export const StageStatus = {
  pending: 'pending',
  inProgress: 'in_progress',
  complete: 'complete',
  /** User chose not to provide now. Explicitly does NOT mean satisfied (Amendment §3). */
  skipped: 'skipped',
} as const;
export type StageStatus = (typeof StageStatus)[keyof typeof StageStatus];

/** Stages whose content is mandatory for a complete entity, vs optional. */
export const StageRequirement = {
  /** Needed to understand the person at all. */
  material: 'material',
  /** Improves the entity but the entity is understandable without it. */
  recommended: 'recommended',
  /** Hard Nexora Entity evidence minimum. */
  evidenceMinimum: 'evidence_minimum',
} as const;
export type StageRequirement = (typeof StageRequirement)[keyof typeof StageRequirement];

// ─────────────────────────────────────────────────────────────────────────────
// Entity Readiness (spec §17, §18, §19)
// ─────────────────────────────────────────────────────────────────────────────

/** Named checks that make up the Entity Readiness Standard. */
export const ReadinessCheckId = {
  identityCore: 'identity_core',
  distinguishability: 'distinguishability',
  nameVariants: 'name_variants',
  currentProfession: 'current_profession',
  biography: 'biography',
  careerHistory: 'career_history',
  educationHistory: 'education_history',
  organizationsProjects: 'organizations_projects',
  publicSources: 'public_sources',
  websitesMinimum: 'websites_minimum_5',
  pressMinimum: 'press_minimum_4',
  photosMinimum: 'photos_minimum_4',
  socialInspection: 'social_inspection',
  portfolioUnderstood: 'portfolio_understood',
  conflictsResolved: 'conflicts_resolved',
  ambiguityResolved: 'ambiguity_resolved',
  reviewQueueCleared: 'review_queue_cleared',
  supportStrength: 'support_strength',
  freshness: 'freshness',
  websiteAccuracy: 'website_accuracy',
  machineReadable: 'machine_readable',
  materialCompleteness: 'material_completeness',
} as const;
export type ReadinessCheckId = (typeof ReadinessCheckId)[keyof typeof ReadinessCheckId];

export const CheckOutcome = {
  pass: 'pass',
  fail: 'fail',
  warn: 'warn',
  skipped: 'skipped',
} as const;
export type CheckOutcome = (typeof CheckOutcome)[keyof typeof CheckOutcome];

export const ReadinessStatus = {
  running: 'running',
  blocked: 'blocked',
  ready: 'ready',
  error: 'error',
} as const;
export type ReadinessStatus = (typeof ReadinessStatus)[keyof typeof ReadinessStatus];

export const ReadinessRunKind = {
  standard: 'standard',
  /** The mandatory complete whole-entity re-review (spec §18). */
  secondPass: 'second_pass',
} as const;
export type ReadinessRunKind = (typeof ReadinessRunKind)[keyof typeof ReadinessRunKind];

// ─────────────────────────────────────────────────────────────────────────────
// Publication and deployment
// ─────────────────────────────────────────────────────────────────────────────

export const EntityStatus = {
  draft: 'draft',
  building: 'building',
  inReview: 'in_review',
  ready: 'ready',
  published: 'published',
  failed: 'failed',
  archived: 'archived',
} as const;
export type EntityStatus = (typeof EntityStatus)[keyof typeof EntityStatus];

export const DeploymentTarget = {
  /** Vercel, when the platform holds an authorized Vercel token. */
  vercel: 'vercel',
  /**
   * The platform's own authorized first-party hosting tier. A real, independently
   * served multi-tenant host operated by Nexora Entity. Used when no Vercel
   * deployment credential is configured. Never presented as a Vercel deployment.
   */
  platformHost: 'platform_host',
} as const;
export type DeploymentTarget = (typeof DeploymentTarget)[keyof typeof DeploymentTarget];

export const DeploymentStatus = {
  queued: 'queued',
  building: 'building',
  validating: 'validating',
  deploying: 'deploying',
  live: 'live',
  failed: 'failed',
  superseded: 'superseded',
} as const;
export type DeploymentStatus = (typeof DeploymentStatus)[keyof typeof DeploymentStatus];

export const DomainStatus = {
  pendingDns: 'pending_dns',
  verifying: 'verifying',
  active: 'active',
  failed: 'failed',
  removed: 'removed',
} as const;
export type DomainStatus = (typeof DomainStatus)[keyof typeof DomainStatus];

export const DomainKind = {
  platformSubdomain: 'platform_subdomain',
  custom: 'custom',
} as const;
export type DomainKind = (typeof DomainKind)[keyof typeof DomainKind];

// ─────────────────────────────────────────────────────────────────────────────
// Review queue (spec §23)
// ─────────────────────────────────────────────────────────────────────────────

export const ReviewKind = {
  discoveredFact: 'discovered_fact',
  discoveredRelationship: 'discovered_relationship',
  identityVerdict: 'identity_verdict',
  conflict: 'conflict',
  ambiguity: 'ambiguity',
  changeDetected: 'change_detected',
  portfolioDiscovery: 'portfolio_discovery',
  sourceLimit: 'source_limit',
} as const;
export type ReviewKind = (typeof ReviewKind)[keyof typeof ReviewKind];

export const ReviewStatus = {
  pending: 'pending',
  accepted: 'accepted',
  rejected: 'rejected',
  applied: 'applied',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

// ─────────────────────────────────────────────────────────────────────────────
// Monitoring (spec §27)
// ─────────────────────────────────────────────────────────────────────────────

export const JobKind = {
  sourceRecheck: 'source_recheck',
  freshnessSweep: 'freshness_sweep',
  publishRefresh: 'publish_refresh',
  domainVerify: 'domain_verify',
} as const;
export type JobKind = (typeof JobKind)[keyof typeof JobKind];

export const JobStatus = {
  pending: 'pending',
  running: 'running',
  done: 'done',
  failed: 'failed',
  skipped: 'skipped',
} as const;
export type JobStatus = (typeof JobStatus)[keyof typeof JobStatus];

// ─────────────────────────────────────────────────────────────────────────────
// Mandatory evidence minimums (spec §8) — internal Nexora Entity requirements
// ─────────────────────────────────────────────────────────────────────────────

export const EVIDENCE_MINIMUMS = {
  websites: { required: 5, label: 'Websites' },
  pressReleases: { required: 4, label: 'Press releases' },
  photos: { required: 4, label: 'Photos' },
} as const;

export type EvidenceMinimumKey = keyof typeof EVIDENCE_MINIMUMS;

export const ALL_EVIDENCE_MINIMUMS: readonly EvidenceMinimumKey[] = [
  'websites',
  'pressReleases',
  'photos',
];

// ─────────────────────────────────────────────────────────────────────────────
// Contact surface
// ─────────────────────────────────────────────────────────────────────────────

export const ContactKind = {
  email: 'email',
  phone: 'phone',
  whatsapp: 'whatsapp',
  booking: 'booking',
  businessAddress: 'business_address',
  contactPage: 'contact_page',
  social: 'social',
  other: 'other',
} as const;
export type ContactKind = (typeof ContactKind)[keyof typeof ContactKind];