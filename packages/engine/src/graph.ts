/**
 * Entity relationship graph (spec §16).
 *
 * The person is modelled as a connected graph, not a flat list of fields. Every edge carries
 * provenance (which claim, which source), a status, and the evidence behind it.
 */

import type { ClaimRecord } from '@nexora/db';
import {
  ClaimStatus,
  NodeType,
  Predicate,
  SourceType,
  SupportStrength,
  type AuthorityTier,
} from '@nexora/core';

export interface GraphNode {
  id: string;
  /** Stable within the graph; derived from the object identity, not the claim id. */
  key: string;
  type: NodeType;
  label: string;
  attributes: Record<string, unknown>;
  /** True when this node was verified to represent the subject person. */
  linkedToSubject: boolean;
  periods: { start: string | null; end: string | null; current: boolean | null }[];
}

export interface GraphEdge {
  id: string;
  predicate: Predicate;
  fromKey: string;
  toKey: string;
  claimId: string;
  label: string;
  status: ClaimStatus;
  origin: ClaimRecord['origin'];
  supportStrength: SupportStrength;
  authorityTier: AuthorityTier;
  confidence: number;
  publish: boolean;
  source: { id: string | null; url: string | null; title: string | null; sourceType: SourceType | null; independenceGroup: string | null } | null;
  evidence: { kind: string; strength: number; detail: string | null; obtainedAt: Date }[];
  verifiedAt: Date | null;
}

export interface EntityGraph {
  subjectKey: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Adjacency for traversal and UI rendering. */
  adjacency: Record<string, string[]>;
  stats: {
    nodes: number;
    edges: number;
    verifiedEdges: number;
    corroboratedEdges: number;
    unresolvedEdges: number;
    byPredicate: Record<string, number>;
  };
}

/** Map an attribute key to the graph predicate and node type it produces. */
const ATTRIBUTE_SPEC: Record<string, { predicate: Predicate; nodeType: NodeType }> = {
  'identity.primaryName': { predicate: Predicate.hasName, nodeType: NodeType.name },
  'identity.alias': { predicate: Predicate.hasAlias, nodeType: NodeType.alias },
  'identity.handle': { predicate: Predicate.hasName, nodeType: NodeType.alias },
  'identity.location': { predicate: Predicate.locatedIn, nodeType: NodeType.location },
  'identity.headline': { predicate: Predicate.hasTitle, nodeType: NodeType.title },
  'about.biography': { predicate: Predicate.hasTitle, nodeType: NodeType.person },
  'about.knownFor': { predicate: Predicate.hasProfession, nodeType: NodeType.profession },
  'about.shortBio': { predicate: Predicate.hasTitle, nodeType: NodeType.person },
  'about.expertiseSummary': { predicate: Predicate.hasProfession, nodeType: NodeType.profession },
  'professional.profession': { predicate: Predicate.hasProfession, nodeType: NodeType.profession },
  'professional.title': { predicate: Predicate.hasTitle, nodeType: NodeType.title },
  'professional.specialisation': { predicate: Predicate.hasProfession, nodeType: NodeType.profession },
  'professional.service': { predicate: Predicate.offersService, nodeType: NodeType.service },
  'professional.industry': { predicate: Predicate.hasProfession, nodeType: NodeType.profession },
  'professional.currentCompany': { predicate: Predicate.associatedWith, nodeType: NodeType.organization },
  'professional.founderStatus': { predicate: Predicate.associatedWith, nodeType: NodeType.organization },
  'professional.currentFocus': { predicate: Predicate.worksOn, nodeType: NodeType.project },
  'career.role': { predicate: Predicate.memberOf, nodeType: NodeType.organization },
  'education.qualification': { predicate: Predicate.educatedAt, nodeType: NodeType.education },
  'skills.skill': { predicate: Predicate.hasProfession, nodeType: NodeType.profession },
  'skills.language': { predicate: Predicate.hasProfession, nodeType: NodeType.profession },
  'skills.subjectArea': { predicate: Predicate.hasProfession, nodeType: NodeType.profession },
  'organizations.affiliation': { predicate: Predicate.associatedWith, nodeType: NodeType.organization },
  'organizations.membership': { predicate: Predicate.memberOf, nodeType: NodeType.organization },
  'projects.project': { predicate: Predicate.created, nodeType: NodeType.project },
  'products.product': { predicate: Predicate.created, nodeType: NodeType.product },
  'products.service': { predicate: Predicate.offersService, nodeType: NodeType.service },
  'achievements.achievement': { predicate: Predicate.recognizedBy, nodeType: NodeType.achievement },
  'publications.item': { predicate: Predicate.publishedBy, nodeType: NodeType.publication },
  'press.release': { predicate: Predicate.mentionedBy, nodeType: NodeType.pressSource },
  'websites.website': { predicate: Predicate.representedOn, nodeType: NodeType.website },
  'profiles.profile': { predicate: Predicate.connectedTo, nodeType: NodeType.profile },
  'presence.page': { predicate: Predicate.representedOn, nodeType: NodeType.website },
  'photos.photo': { predicate: Predicate.representedBy, nodeType: NodeType.photo },
  'contact.contact': { predicate: Predicate.contactableAt, nodeType: NodeType.contact },
  'dates.event': { predicate: Predicate.worksOn, nodeType: NodeType.project },
  'other.fact': { predicate: Predicate.hasTitle, nodeType: NodeType.person },
};

export function specFor(attributeKey: string): { predicate: Predicate; nodeType: NodeType } {
  return ATTRIBUTE_SPEC[attributeKey] ?? { predicate: Predicate.hasTitle, nodeType: NodeType.person };
}

export function objectKeyFor(attributeKey: string, valueText: string, valueJson: Record<string, unknown>): string {
  const spec = specFor(attributeKey);
  const identityPart =
    (valueJson['url'] as string | undefined) ??
    (valueJson['handle'] as string | undefined) ??
    valueText;
  return `${spec.nodeType}:${attributeKey}:${identityPart.toLowerCase()}`;
}

export interface BuildGraphInput {
  subjectName: string;
  entityUid: string;
  claims: ClaimRecord[];
  sources: {
    id: string;
    url: string;
    canonical_url: string;
    title: string | null;
    source_type: SourceType | null;
    independence_group: string | null;
    published: boolean;
  }[];
  evidence: { claim_id: string | null; kind: string; strength: number; detail: string | null; obtained_at: Date; source_id: string | null }[];
  /** Sources whose identity link is confirmed, so discovered claims from them are trusted. */
  confirmedSourceIds: string[];
}

export function buildEntityGraph(input: BuildGraphInput): EntityGraph {
  const subjectKey = `person:${input.entityUid}`;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const sourceById = new Map(input.sources.map((s) => [s.id, s]));
  const confirmed = new Set(input.confirmedSourceIds);
  const evidenceByClaim = new Map<string, BuildGraphInput['evidence']>();
  for (const e of input.evidence) {
    if (!e.claim_id) continue;
    const list = evidenceByClaim.get(e.claim_id) ?? [];
    list.push(e);
    evidenceByClaim.set(e.claim_id, list);
  }

  nodes.set(subjectKey, {
    id: subjectKey,
    key: subjectKey,
    type: NodeType.person,
    label: input.subjectName,
    attributes: { entityUid: input.entityUid },
    linkedToSubject: true,
    periods: [],
  });

  for (const claim of input.claims) {
    if (claim.status === 'rejected') continue;
    const spec = specFor(claim.attribute_key);
    const key = objectKeyFor(claim.attribute_key, claim.value_text, claim.value_json);
    const existing = nodes.get(key);
    const trusted =
      claim.user_confirmed ||
      claim.status === 'accepted_authoritative' ||
      claim.status === 'independently_supported' ||
      (claim.source_id ? confirmed.has(claim.source_id) : claim.origin === 'user');

    if (existing) {
      existing.attributes = { ...existing.attributes, ...claim.value_json };
      existing.linkedToSubject = existing.linkedToSubject || trusted;
      existing.periods.push({ start: claim.period_start, end: claim.period_end, current: claim.is_current });
    } else {
      nodes.set(key, {
        id: key,
        key,
        type: claim.node_type ? (claim.node_type as NodeType) : spec.nodeType,
        label: claim.display_label ?? claim.value_text,
        attributes: { ...claim.value_json, attributeKey: claim.attribute_key },
        linkedToSubject: trusted,
        periods: [{ start: claim.period_start, end: claim.period_end, current: claim.is_current }],
      });
    }

    const src = claim.source_id ? sourceById.get(claim.source_id) : undefined;
    edges.push({
      id: `edge:${claim.id}`,
      predicate: claim.predicate as Predicate,
      fromKey: subjectKey,
      toKey: key,
      claimId: claim.id,
      label: claim.value_text,
      status: claim.status,
      origin: claim.origin,
      supportStrength: claim.support_strength,
      authorityTier: claim.authority_tier,
      confidence: claim.confidence,
      publish: claim.publish,
      source: src
        ? {
            id: src.id,
            url: src.canonical_url,
            title: src.title,
            sourceType: src.source_type,
            independenceGroup: src.independence_group,
          }
        : null,
      evidence: (evidenceByClaim.get(claim.id) ?? []).map((e) => ({
        kind: e.kind,
        strength: Number(e.strength),
        detail: e.detail,
        obtainedAt: e.obtained_at,
      })),
      verifiedAt: claim.verified_at,
    });
  }

  const adjacency: Record<string, string[]> = {};
  for (const e of edges) {
    (adjacency[e.fromKey] ??= []).push(e.toKey);
    (adjacency[e.toKey] ??= []).push(e.fromKey);
  }

  const byPredicate: Record<string, number> = {};
  for (const e of edges) byPredicate[e.predicate] = (byPredicate[e.predicate] ?? 0) + 1;

  return {
    subjectKey,
    nodes: [...nodes.values()],
    edges,
    adjacency,
    stats: {
      nodes: nodes.size,
      edges: edges.length,
      verifiedEdges: edges.filter((e) => e.status === 'accepted_authoritative' || e.status === 'independently_supported').length,
      corroboratedEdges: edges.filter((e) => e.supportStrength === 'corroborated' || e.supportStrength === 'strongly_supported').length,
      unresolvedEdges: edges.filter((e) => e.status === 'uncertain' || e.status === 'conflicting' || e.status === 'proposed').length,
      byPredicate,
    },
  };
}

/**
 * Adjacent nodes at distance 2 — used by the ambiguity engine to find people whose
 * descriptions could plausibly be confused with the subject.
 */
export function neighboursAtDistance(graph: EntityGraph, depth = 2): Map<string, number> {
  const distances = new Map<string, number>([[graph.subjectKey, 0]]);
  let frontier = [graph.subjectKey];
  for (let d = 1; d <= depth; d += 1) {
    const next: string[] = [];
    for (const key of frontier) {
      for (const n of graph.adjacency[key] ?? []) {
        if (!distances.has(n)) {
          distances.set(n, d);
          next.push(n);
        }
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }
  return distances;
}