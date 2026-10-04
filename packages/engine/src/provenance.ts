/**
 * Provenance: inspected source → evidence → discovered claim → support strength.
 *
 * Specification §11 requires every fact to record where it came from, how it was verified,
 * and whether it is user-provided or externally supported. §19 requires readiness to *prove*
 * it, not merely assert it.
 *
 * ── The defect this module repairs ────────────────────────────────────────────
 * The pipeline inspected every supplied source and stored the extracted content on the
 * source record, but it never converted that content into claims. Every claim in the
 * database was therefore produced by `claimsFromStage`, which hard-codes
 * `origin: user` / `support_strength: self_asserted`.
 *
 * The consequence was measurable and severe: the readiness `support_strength` check
 * measures `claims where origin !== 'user'`, which was structurally always zero. The
 * check could never pass, so the entity was permanently capped below 100%.
 *
 * ── What this module does ─────────────────────────────────────────────────────
 * It closes that link using only facts actually read out of sources we fetched and
 * stored. It never invents a fact, never infers one that a source did not state, and
 * never counts a source as independent corroboration of itself. Independent support is
 * counted by `independence_group`, so four sites copying one press release still count
 * once (§8, §11).
 */

import {
  ClaimOrigin,
  ClaimStatus,
  NodeType,
  Predicate,
  SupportStrength,
  normalizeText,
  type AuthorityTier,
} from '@nexora/core';
import {
  insertEvidence,
  listClaims,
  listEvidence,
  listSources,
  updateClaimStatus,
  upsertClaim,
  type ClaimRecord,
  type SourceRecord,
} from '@nexora/db';

export interface ExtractedFact {
  attributeKey: string;
  predicate: (typeof Predicate)[keyof typeof Predicate];
  nodeType: string;
  valueText: string;
  displayLabel: string;
  valueJson?: Record<string, unknown>;
  /** Tier describing how authoritative this kind of assertion is (§12). */
  authorityTier: AuthorityTier;
}

/** Short boilerplate is noise; a whole page is not an attribute. */
function usableText(value: string | null | undefined, min: number, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length < min || trimmed.length > max) return null;
  return trimmed;
}


/**
 * Read the facts an inspected source actually asserts.
 *
 * Returns nothing for a source that was not genuinely inspected — an unreadable or
 * failed source contributes no provenance at all, because we did not read it.
 */
export function factsFromSource(source: SourceRecord): ExtractedFact[] {
  if (source.inspection_status !== 'inspected') return [];
  const e = source.extracted ?? {};
  const out: ExtractedFact[] = [];

  const organisation = usableText(e.organisation, 2, 160);
  if (organisation) {
    out.push({
      attributeKey: 'discovered.organisation',
      predicate: Predicate.memberOf,
      nodeType: NodeType.organization,
      valueText: organisation,
      displayLabel: 'Organisation (from source)',
      authorityTier: 2,
    });
  }

  const location = usableText(e.location, 2, 160);
  if (location) {
    out.push({
      attributeKey: 'discovered.location',
      predicate: Predicate.locatedIn,
      nodeType: NodeType.location,
      valueText: location,
      displayLabel: 'Location (from source)',
      authorityTier: 3,
    });
  }

  const description = usableText(e.description, 30, 600);
  if (description) {
    out.push({
      attributeKey: 'discovered.description',
      predicate: Predicate.hasTitle,
      nodeType: NodeType.person,
      valueText: description,
      displayLabel: 'Description (from source)',
      authorityTier: 3,
    });
  }

  const headline = usableText(e.headline, 3, 200);
  if (headline) {
    out.push({
      attributeKey: 'discovered.headline',
      predicate: Predicate.hasTitle,
      nodeType: NodeType.person,
      valueText: headline,
      displayLabel: 'Headline (from source)',
      authorityTier: 3,
    });
  }

  for (const alt of e.alternateNames ?? []) {
    const name = usableText(alt, 2, 120);
    if (!name) continue;
    out.push({
      attributeKey: 'discovered.alternateName',
      predicate: Predicate.hasAlias,
      nodeType: NodeType.alias,
      valueText: name,
      displayLabel: 'Also known as (from source)',
      authorityTier: 3,
    });
  }

  // sameAs can run to hundreds of entries on a link-heavy page (nav bars, feeds, archives).
  // Only the ones that look like this person's own profiles are evidence of anything, and an
  // unbounded list would flood the claim table. Cap it, and require a plausible profile host.
  const PROFILE_HOST =
    /(^|\.)(github\.com|gitlab\.com|linkedin\.com|stackoverflow\.com|medium\.com|substack\.com|x\.com|twitter\.com|mastodon\.|bsky\.app|instagram\.com|youtube\.com|facebook\.com|reddit\.com|threads\.net|tiktok\.com|dev\.to|gitlab\.io|orcid\.org|researchgate\.net|wikipedia\.org|crunchbase\.com|behance\.net|dribbble\.com|about\.me|linktree\.io)$/i;
  let sameAsKept = 0;
  for (const href of e.sameAs ?? []) {
    if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) continue;
    if (sameAsKept >= 12) break;
    let host: string;
    try {
      host = new URL(href).hostname;
    } catch {
      continue;
    }
    if (!PROFILE_HOST.test(host)) continue;
    out.push({
      attributeKey: 'discovered.sameAs',
      predicate: Predicate.representedOn,
      nodeType: NodeType.profile,
      valueText: href,
      displayLabel: 'Linked profile (from source)',
      valueJson: { url: href, host },
      authorityTier: 3,
    });
    sameAsKept += 1;
  }

  for (const email of e.emails ?? []) {
    if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    out.push({
      attributeKey: 'discovered.email',
      predicate: Predicate.contactableAt,
      nodeType: NodeType.contact,
      valueText: email.toLowerCase(),
      displayLabel: 'Email published on source',
      valueJson: { email: email.toLowerCase(), kind: 'published_email' },
      authorityTier: 4,
    });
  }

  return out;
}

/** Key used to group identical assertions across independent sources. */
export function factKey(attributeKey: string, valueText: string): string {
  return `${attributeKey}::${normalizeText(valueText)}`;
}

export interface ProvenanceOutcome {
  inspectedSources: number;
  discoveredClaims: number;
  evidenceRows: number;
  corroboratedUserClaims: number;
  upgradedClaims: number;
}

/**
 * Build the provenance chain for an entity from its persisted, inspected sources.
 *
 * Idempotent: re-running reconciles the same rows rather than duplicating them.
 */
export async function applyProvenance(entityId: string): Promise<ProvenanceOutcome> {
  const [sources, existingClaims, existingEvidence] = await Promise.all([
    listSources(entityId),
    listClaims(entityId),
    listEvidence(entityId),
  ]);

  const inspected = sources.filter((s) => s.inspection_status === 'inspected' && s.extracted);
  const evidenceSeen = new Set(
    existingEvidence.map((e) => `${e.claim_id ?? ''}|${e.source_id ?? ''}|${e.kind}`),
  );

  let discoveredClaims = 0;
  let evidenceRows = 0;
  const groupsForKey = new Map<string, Set<string>>();
  const groupsForValue = new Map<string, Set<string>>();

  for (const source of inspected) {
    // Independence is by group; an ungrouped source can only ever corroborate itself.
    const group = source.independence_group ?? source.registrable_domain ?? `source:${source.id}`;

    for (const fact of factsFromSource(source)) {
      // One claim per distinct fact, NOT one per (fact × source). A value asserted by ten
      // sources is a single fact with ten evidence rows. Keying the claim on the value alone
      // (source_id null) is what makes that collapse happen, and it is also what makes
      // support strength meaningful: the claim accumulates its sources instead of multiplying.
      const claim = await upsertClaim({
        entityId,
        attributeKey: fact.attributeKey,
        predicate: fact.predicate,
        nodeType: fact.nodeType,
        valueText: fact.valueText,
        valueJson: fact.valueJson ?? {},
        normalizedKey: normalizeText(fact.valueText),
        origin: ClaimOrigin.discovered,
        status: ClaimStatus.sourced,
        supportStrength: SupportStrength.singleSource,
        authorityTier: fact.authorityTier,
        sourceId: null,
        displayLabel: fact.displayLabel,
        // §23: discovered information is never published automatically.
        publish: false,
        discovered: true,
      });
      discoveredClaims += 1;

      const evidenceKey = `${claim.id}|${source.id}|source_assertion`;
      if (!evidenceSeen.has(evidenceKey)) {
        await insertEvidence({
          entityId,
          claimId: claim.id,
          sourceId: source.id,
          // Must be one of the values allowed by the evidence_kind_ck constraint in the
          // schema. `source_assertion` is precisely what this is: something the source states.
          kind: 'source_assertion',
          strength: source.quality_score ?? 0.5,
          independenceGroup: group,
          detail: `Read from ${source.canonical_url || source.url} during inspection.`,
          payload: {
            url: source.canonical_url || source.url,
            inspectedAt: source.inspected_at ? new Date(source.inspected_at).toISOString() : null,
            sourceType: source.source_type,
          },
        });
        evidenceSeen.add(evidenceKey);
        evidenceRows += 1;
      }

      const key = factKey(fact.attributeKey, fact.valueText);
      if (!groupsForKey.has(key)) groupsForKey.set(key, new Set());
      groupsForKey.get(key)!.add(group);

      // A second index keyed on the VALUE alone. This is what lets a claim the person typed
      // (attribute keys like "about.profession") be compared against what sources state
      // (keys like "discovered.organisation"). Matching on attribute key alone could never
      // connect the two, which is why user claims were never corroborated.
      const vkey = normalizeText(fact.valueText);
      if (!groupsForValue.has(vkey)) groupsForValue.set(vkey, new Set());
      groupsForValue.get(vkey)!.add(group);
    }
  }

  // Second sweep: promote assertions that genuinely independent sources agree on.
  let upgradedClaims = 0;
  const seenKeys = new Set<string>();
  for (const claim of await listClaims(entityId)) {
    if (claim.origin !== ClaimOrigin.discovered) continue;
    const key = factKey(claim.attribute_key, claim.value_text);
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    const groups = groupsForKey.get(key);
    if (!groups || groups.size < 2) continue;
    await updateClaimStatus(claim.id, {
      supportStrength: SupportStrength.corroborated,
      status: ClaimStatus.independentlySupported,
    });
    // Record why we believe it is corroborated: how many genuinely independent groups.
    if (!evidenceSeen.has(`${claim.id}||corroboration`)) {
      await insertEvidence({
        entityId,
        claimId: claim.id,
        kind: 'corroboration',
        strength: Math.min(1, groups.size / 3),
        independenceGroup: [...groups].sort().join('+'),
        detail: `Asserted independently by ${groups.size} separate source group(s).`,
        payload: { independentGroups: [...groups], groupCount: groups.size },
      });
      evidenceSeen.add(`${claim.id}||corroboration`);
      evidenceRows += 1;
    }
    upgradedClaims += 1;
  }

  // Third sweep: tell a user's own claim apart from an externally supported one (§11).
  // A user's statement keeps `origin: user` — we never rewrite who asserted it — but its
  // support strength reflects real external agreement.
  let corroboratedUserClaims = 0;
  for (const claim of existingClaims) {
    if (claim.origin !== ClaimOrigin.user) continue;
    if (claim.status === ClaimStatus.rejected) continue;

    // Compare by VALUE, not by attribute key: what matters for §11 is whether independent
    // sources assert the same thing the person asserted, however they label it.
    const groups = groupsForValue.get(normalizeText(claim.value_text));
    if (!groups || groups.size === 0) continue;

    if (groups.size >= 2 && claim.support_strength !== SupportStrength.corroborated) {
      await updateClaimStatus(claim.id, {
        supportStrength: SupportStrength.corroborated,
        status: ClaimStatus.independentlySupported,
      });
      corroboratedUserClaims += 1;
    } else if (groups.size === 1 && claim.support_strength === SupportStrength.selfAsserted) {
      // One external source agrees, but that is not independent corroboration.
      await updateClaimStatus(claim.id, {
        supportStrength: SupportStrength.singleSource,
        status: ClaimStatus.sourced,
      });
    }
  }

  return {
    inspectedSources: inspected.length,
    discoveredClaims,
    evidenceRows,
    corroboratedUserClaims,
    upgradedClaims,
  };
}

/** Measure the provenance chain without writing, for tests and reporting. */
export function provenanceStats(claims: ClaimRecord[]): {
  total: number;
  externallySourced: number;
  corroborated: number;
  selfAssertedOnly: number;
  withEvidenceCapableProvenance: number;
} {
  const total = claims.length;
  const externallySourced = claims.filter((c) => c.origin !== ClaimOrigin.user).length;
  const corroborated = claims.filter(
    (c) =>
      c.support_strength === SupportStrength.corroborated ||
      c.support_strength === SupportStrength.stronglySupported,
  ).length;
  const selfAssertedOnly = claims.filter(
    (c) =>
      c.origin === ClaimOrigin.user &&
      (c.support_strength === SupportStrength.selfAsserted || c.support_strength === SupportStrength.none),
  ).length;
  const withEvidenceCapableProvenance = claims.filter(
    (c) => c.source_id !== null || c.origin === ClaimOrigin.discovered,
  ).length;
  return { total, externallySourced, corroborated, selfAssertedOnly, withEvidenceCapableProvenance };
}
