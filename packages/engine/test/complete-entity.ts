/**
 * A complete, publishable entity, built with the real attribute keys the engine reads.
 *
 * The engine is a pure function over records, so tests need a world in which nothing blocks.
 * Getting the keys right matters: a fixture using plausible-but-wrong keys produces a "blocked"
 * report for the wrong reason, and a test written against that hides real regressions.
 */

import type { ReadinessInput } from '../src/readiness';
import {
  ambiguity,
  claim,
  conflict,
  identityLink,
  photo,
  pressSource,
  source,
  stage,
} from './fixtures';

const ALL_STAGES = [
  'A_identity', 'B_name_variants', 'C_about', 'D_professional_identity', 'E_career', 'F_education',
  'G_skills', 'H_organizations', 'I_projects', 'J_products_services', 'K_achievements',
  'L_publications_media', 'M_press_releases', 'N_websites', 'O_portfolio', 'P_social_profiles',
  'Q_photos', 'R_online_presence', 'S_public_contact', 'T_location', 'U_dates',
  'V_external_identity_links', 'W_other',
];

/** Claims that satisfy identity, distinguishability, biography, and profession. */
export function completeClaims() {
  return [
    claim({ id: 'c-name', attribute_key: 'identity.primaryName', value_text: 'Ada Lovelace' }),
    claim({ id: 'c-first', attribute_key: 'identity.firstName', value_text: 'Ada' }),
    claim({ id: 'c-last', attribute_key: 'identity.lastName', value_text: 'Lovelace' }),
    claim({ id: 'c-alias', attribute_key: 'identity.alias', value_text: 'Augusta Ada King' }),
    claim({ id: 'c-loc', attribute_key: 'identity.location', value_text: 'London, United Kingdom' }),
    // The biography check requires real prose, not a fragment.
    claim({
      id: 'c-bio',
      attribute_key: 'about.biography',
      value_text:
        'Ada Lovelace was an English mathematician whose notes on the Analytical Engine included an algorithm often described as the first published computer program. She corresponded with Charles Babbage and translated his work into French.',
    }),
    claim({ id: 'c-prof', attribute_key: 'professional.profession', value_text: 'Mathematician' }),
    claim({ id: 'c-title', attribute_key: 'professional.title', value_text: 'Analyst' }),
    claim({ id: 'c-co', attribute_key: 'professional.currentCompany', value_text: 'The Analytical Engine project' }),
    claim({ id: 'c-role', attribute_key: 'career.role', value_text: '1843 — Analyst, Analytical Engine' }),
    claim({ id: 'c-edu', attribute_key: 'education.qualification', value_text: 'Private tuition in mathematics and science' }),
    claim({ id: 'c-skill', attribute_key: 'skills.skill', value_text: 'Algorithms' }),
    claim({ id: 'c-org', attribute_key: 'organizations.affiliation', value_text: 'Royal Society' }),
    claim({ id: 'c-proj', attribute_key: 'projects.project', value_text: 'Notes on the Analytical Engine' }),
    claim({ id: 'c-site', attribute_key: 'websites.website', value_text: 'https://a.example/ada' }),
    claim({ id: 'c-pub', attribute_key: 'publications.item', value_text: 'Sketch of the Analytical Engine (1843)' }),
    claim({ id: 'c-email', attribute_key: 'contact.email', value_text: 'ada@example.com' }),
  ];
}

export function completeSources() {
  return [
    source({ id: 'w1', url: 'https://a.example/ada', canonical_url: 'https://a.example/ada', host: 'a.example' }),
    source({ id: 'w2', url: 'https://b.example/ada', canonical_url: 'https://b.example/ada', host: 'b.example' }),
    source({ id: 'w3', url: 'https://c.example/ada', canonical_url: 'https://c.example/ada', host: 'c.example' }),
    source({ id: 'w4', url: 'https://d.example/ada', canonical_url: 'https://d.example/ada', host: 'd.example' }),
    source({ id: 'w5', url: 'https://e.example/ada', canonical_url: 'https://e.example/ada', host: 'e.example' }),
    pressSource('g1'),
    pressSource('g2'),
    pressSource('g3'),
    pressSource('g4'),
    source({
      id: 'pr1',
      url: 'https://social.example/ada',
      canonical_url: 'https://social.example/ada',
      host: 'social.example',
      supplied_kind: 'social_profile',
    }),
  ];
}

export function completePhotos() {
  return [photo({ id: 'ph1' }), photo({ id: 'ph2' }), photo({ id: 'ph3' }), photo({ id: 'ph4' })];
}

/** Every minimum met, nothing blocking. Individual tests degrade one thing at a time. */
export function completeEntity(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    kind: 'standard',
    entityName: 'Ada Lovelace',
    claims: completeClaims(),
    sources: completeSources(),
    photos: completePhotos(),
    stages: ALL_STAGES.map((k) => stage(k)),
    conflicts: [],
    ambiguities: [],
    identityLinks: [identityLink({ source_id: 'w1' })],
    websiteQualifying: 5,
    pressQualifying: 4,
    photosQualifying: 4,
    independentPressGroups: 4,
    portfolioFiles: [],
    portfolioDiscoveriesPending: 0,
    reviewPending: 0,
    reviewBlocking: 0,
    correctionsSinceParent: 0,
    publishableClaimCount: 17,
    structuredData: {
      hasName: true,
      alternateNames: 1,
      image: true,
      description: true,
      sameAs: 3,
      canonicalUrl: true,
      stableId: true,
    },
    liveDeployment: true,
    liveDeploymentTarget: 'platform',
    ...overrides,
  };
}

export { ALL_STAGES, ambiguity, conflict };
