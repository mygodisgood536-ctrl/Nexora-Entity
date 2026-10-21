-- =====================================================================
-- Nexora Entity — initial schema
--
-- Design notes:
--  * `claims` is the provenance/evidence unit. Nothing is stored as a bare
--    field: every piece of entity information carries origin, status, source,
--    periods, confidence and verification timestamps.
--  * `sources` records the honest outcome of inspection. `access_status` and
--    `inspection_status` make it impossible to claim a source was checked when
--    it was not.
--  * `evidence` carries independence groups so syndicated copies of one press
--    release never count as independent confirmations.
--  * `readiness_runs` stores the full check-by-check result including the
--    mandatory complete second-pass review.
--
--  * The tables live in the default `public` schema. A dedicated `nexora`
--    schema was tried first, but reaching it required setting `search_path`,
--    and a hosted connection pool (Neon PgBouncer) refuses a `search_path`
--    startup parameter outright — every request failed before it reached a
--    query. The database itself is the isolation boundary, so the schema
--    buys nothing that is worth breaking deployment over.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

SET search_path TO public;

-- ── Accounts ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name              text        NOT NULL,
  username               text        NOT NULL,
  username_norm          text        NOT NULL,
  security_question      text        NOT NULL,
  security_question_norm text        NOT NULL,
  security_answer_hash   text        NOT NULL,
  security_answer_salt   text        NOT NULL,
  security_answer_hint   text,
  failed_attempts        integer     NOT NULL DEFAULT 0,
  locked_until           timestamptz,
  last_login_at          timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_norm_uq ON users (username_norm);
CREATE INDEX IF NOT EXISTS users_username_trgm ON users USING gin (username_norm gin_trgm_ops);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  ip          text,
  user_agent  text
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  username_norm text,
  succeeded   boolean     NOT NULL,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_attempts_user_idx ON auth_attempts (user_id, created_at DESC);

-- ── Entities ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS entities (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Stable internal entity identifier: survives username/domain/design changes.
  entity_uid        text        NOT NULL UNIQUE,
  slug              text        NOT NULL UNIQUE,
  canonical_path    text        NOT NULL UNIQUE,
  display_name      text,
  status            text        NOT NULL DEFAULT 'draft',
  published_at      timestamptz,
  last_published_deployment_id uuid,
  primary_domain    text,
  site_photo_id     uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT entities_status_ck CHECK (status IN
    ('draft','building','in_review','ready','published','failed','archived'))
);
CREATE INDEX IF NOT EXISTS entities_user_idx ON entities (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS entities_slug_uq ON entities (slug);

-- ── Account-level AI configuration (OpenCode-backed) ────────────────────

CREATE TABLE IF NOT EXISTS ai_configurations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id       text        NOT NULL,
  provider_name     text        NOT NULL,
  model_id          text        NOT NULL,
  model_name        text        NOT NULL,
  is_active         boolean     NOT NULL DEFAULT false,
  status            text        NOT NULL DEFAULT 'verified',
  verified_at       timestamptz,
  verification      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_used_at      timestamptz,
  last_error        text,
  last_error_code   text,
  last_error_at     timestamptz,
  replaced_config_id uuid REFERENCES ai_configurations(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_configurations_status_ck CHECK (status IN
    ('verified','degraded','failed','replaced'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ai_configurations_active_uq
  ON ai_configurations (user_id) WHERE is_active;
CREATE INDEX IF NOT EXISTS ai_configurations_user_idx ON ai_configurations (user_id, created_at DESC);

-- Honest log of every real provider attempt made for this account.
CREATE TABLE IF NOT EXISTS ai_provider_attempts (
  id             bigserial PRIMARY KEY,
  user_id        uuid REFERENCES users(id) ON DELETE CASCADE,
  config_id      uuid REFERENCES ai_configurations(id) ON DELETE SET NULL,
  provider_id    text        NOT NULL,
  model_id       text        NOT NULL,
  operation      text        NOT NULL,
  outcome        text        NOT NULL,
  failure_kind   text,
  message        text,
  detail         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  latency_ms     integer,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_provider_attempts_outcome_ck CHECK (outcome IN ('success','failure'))
);
CREATE INDEX IF NOT EXISTS ai_provider_attempts_user_idx ON ai_provider_attempts (user_id, created_at DESC);

-- Snapshot of what OpenCode exposes at a point in time (dynamic, never hard-coded).
CREATE TABLE IF NOT EXISTS opencode_snapshots (
  id           bigserial PRIMARY KEY,
  opencode_version text,
  providers    jsonb       NOT NULL,
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  duration_ms  integer
);
CREATE INDEX IF NOT EXISTS opencode_snapshots_fetched_idx ON opencode_snapshots (fetched_at DESC);

-- ── Guided stage progress ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS stage_progress (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  stage_key    text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending',
  skip_note    text,
  data         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  touched_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  skipped_at   timestamptz,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stage_progress_status_ck CHECK (status IN ('pending','in_progress','complete','skipped')),
  CONSTRAINT stage_progress_key_ck CHECK (stage_key IN (
    'A_identity','B_name_variants','C_about','D_professional_identity','E_career','F_education',
    'G_skills','H_organizations','I_projects','J_products_services','K_achievements',
    'L_publications_media','M_press_releases','N_websites','O_portfolio','P_social_profiles',
    'Q_photos','R_online_presence','S_public_contact','T_location','U_dates',
    'V_external_identity_links','W_other')),
  CONSTRAINT stage_progress_entity_key_uq UNIQUE (entity_id, stage_key)
);

-- ── Sources: the honest record of external inspection ───────────────────

CREATE TABLE IF NOT EXISTS sources (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  url               text        NOT NULL,
  canonical_url     text        NOT NULL,
  registrable_domain text,
  host              text,
  supplied_kind     text        NOT NULL DEFAULT 'other',
  source_type       text        NOT NULL DEFAULT 'other',
  platform          text,
  platform_handle   text,
  title             text,
  description       text,
  author            text,
  published_date    text,
  http_status       integer,
  final_url         text,
  redirects         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  content_type      text,
  access_status     text        NOT NULL DEFAULT 'pending',
  access_detail     text,
  inspection_status text        NOT NULL DEFAULT 'pending',
  inspected_at      timestamptz,
  last_checked_at   timestamptz,
  check_error       text,
  content_hash      text,
  text_excerpt      text,
  text_length       integer,
  independence_group text,
  fingerprint_tokens integer     NOT NULL DEFAULT 0,
  extracted         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  qualifiers        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  qualifies_websites boolean    NOT NULL DEFAULT false,
  qualifies_press    boolean    NOT NULL DEFAULT false,
  subject_relevance  numeric    NOT NULL DEFAULT 0,
  quality_score      numeric    NOT NULL DEFAULT 0,
  is_duplicate_of    uuid REFERENCES sources(id) ON DELETE SET NULL,
  published          boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sources_entity_canonical_uq UNIQUE (entity_id, canonical_url),
  CONSTRAINT sources_access_ck CHECK (access_status IN
    ('pending','accessible','access_limited','blocked','not_found','network_error','timeout',
     'invalid_url','unsupported_content','private','user_declined')),
  CONSTRAINT sources_inspection_ck CHECK (inspection_status IN
    ('pending','inspecting','inspected','failed','skipped')),
  CONSTRAINT sources_supplied_kind_ck CHECK (supplied_kind IN
    ('personal_site','professional_site','portfolio_site','project_site','organization_site',
     'author_page','press_release','news_article','social_profile','professional_profile',
     'creator_profile','public_page','portfolio_url','other'))
);
CREATE INDEX IF NOT EXISTS sources_entity_idx ON sources (entity_id);
CREATE INDEX IF NOT EXISTS sources_independence_idx ON sources (entity_id, independence_group);
CREATE INDEX IF NOT EXISTS sources_qualifies_idx ON sources (entity_id, qualifies_websites, qualifies_press);

-- ── Photos ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS photos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id           uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  storage_path        text,
  public_url          text,
  original_filename   text,
  mime                text,
  bytes               integer,
  width               integer,
  height              integer,
  sha256              text,
  perceptual_hash     text,
  origin              text        NOT NULL DEFAULT 'user_upload',
  caption             text,
  alt                 text,
  source_id           uuid REFERENCES sources(id) ON DELETE SET NULL,
  representation_status text      NOT NULL DEFAULT 'pending',
  inspection_status   text        NOT NULL DEFAULT 'pending',
  inspection_detail   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  qualifies           boolean     NOT NULL DEFAULT false,
  disqualify_reasons  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  sort_order          integer     NOT NULL DEFAULT 0,
  is_primary          boolean     NOT NULL DEFAULT false,
  uploaded_at         timestamptz NOT NULL DEFAULT now(),
  verified_at         timestamptz,
  CONSTRAINT photos_representation_ck CHECK (representation_status IN
    ('pending','primary','supporting','unverified','rejected')),
  CONSTRAINT photos_inspection_ck CHECK (inspection_status IN
    ('pending','inspecting','inspected','failed')),
  CONSTRAINT photos_origin_ck CHECK (origin IN ('user_upload','discovered'))
);
CREATE UNIQUE INDEX IF NOT EXISTS photos_entity_sha_uq ON photos (entity_id, sha256);
CREATE INDEX IF NOT EXISTS photos_entity_idx ON photos (entity_id);
CREATE UNIQUE INDEX IF NOT EXISTS photos_primary_uq ON photos (entity_id) WHERE is_primary;

-- ── Portfolio files ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS portfolio_files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  original_filename text        NOT NULL,
  mime              text,
  bytes             integer,
  storage_path      text,
  sha256            text,
  extraction_status text        NOT NULL DEFAULT 'pending',
  extraction        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  extraction_error  text,
  uploaded_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portfolio_extraction_ck CHECK (extraction_status IN
    ('pending','extracting','extracted','failed','unsupported'))
);
CREATE INDEX IF NOT EXISTS portfolio_entity_idx ON portfolio_files (entity_id);

-- ── Claims: the provenance/evidence unit ────────────────────────────────

CREATE TABLE IF NOT EXISTS claims (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  attribute_key   text        NOT NULL,
  predicate       text        NOT NULL,
  node_type       text,
  value_text      text        NOT NULL,
  value_json      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  normalized_key  text,
  origin          text        NOT NULL DEFAULT 'user',
  status          text        NOT NULL DEFAULT 'proposed',
  support_strength text       NOT NULL DEFAULT 'none',
  authority_tier  integer     NOT NULL DEFAULT 1,
  confidence      numeric     NOT NULL DEFAULT 0,
  source_id       uuid REFERENCES sources(id) ON DELETE SET NULL,
  independence_group text,
  period_start    text,
  period_end      text,
  is_current      boolean,
  discovered_at   timestamptz,
  verified_at     timestamptz,
  last_checked_at timestamptz,
  conflicting     boolean     NOT NULL DEFAULT false,
  conflict_ids    uuid[]      NOT NULL DEFAULT '{}',
  publish         boolean     NOT NULL DEFAULT false,
  user_confirmed  boolean     NOT NULL DEFAULT false,
  stage_key       text,
  display_label   text,
  sort_order      integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT claims_origin_ck CHECK (origin IN ('user','discovered','derived','published')),
  CONSTRAINT claims_status_ck CHECK (status IN
    ('proposed','user_provided','sourced','independently_supported','uncertain','conflicting',
     'accepted_authoritative','rejected','superseded')),
  CONSTRAINT claims_support_ck CHECK (support_strength IN
    ('none','self_asserted','single_source','corroborated','strongly_supported'))
);
CREATE INDEX IF NOT EXISTS claims_entity_idx ON claims (entity_id);
CREATE INDEX IF NOT EXISTS claims_attribute_idx ON claims (entity_id, attribute_key);
CREATE INDEX IF NOT EXISTS claims_normalized_idx ON claims (entity_id, normalized_key);
CREATE INDEX IF NOT EXISTS claims_publish_idx ON claims (entity_id, publish) WHERE publish;

-- ── Evidence ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS evidence (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  claim_id         uuid REFERENCES claims(id) ON DELETE CASCADE,
  source_id        uuid REFERENCES sources(id) ON DELETE CASCADE,
  kind             text        NOT NULL,
  strength         numeric     NOT NULL DEFAULT 0,
  independence_group text,
  detail           text,
  payload          jsonb       NOT NULL DEFAULT '{}'::jsonb,
  obtained_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evidence_kind_ck CHECK (kind IN
    ('source_assertion','user_assertion','corroboration','independence','contradiction',
     'document','photo','ai_analysis','platform_api','http_metadata'))
);
CREATE INDEX IF NOT EXISTS evidence_claim_idx ON evidence (claim_id);
CREATE INDEX IF NOT EXISTS evidence_entity_idx ON evidence (entity_id);

-- ── Identity resolution ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS identity_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  source_id      uuid        NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  platform       text,
  handle         text,
  resolved_state text        NOT NULL DEFAULT 'pending',
  score          numeric     NOT NULL DEFAULT 0,
  signals        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  rationale      text,
  method         text        NOT NULL DEFAULT 'deterministic',
  user_decision  text,
  evaluated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT identity_links_uq UNIQUE (entity_id, source_id),
  CONSTRAINT identity_links_state_ck CHECK (resolved_state IN
    ('pending','confirmed','probable_needs_review','uncertain','conflict','rejected')),
  CONSTRAINT identity_links_decision_ck CHECK (user_decision IS NULL OR user_decision IN
    ('accept','reject'))
);
CREATE INDEX IF NOT EXISTS identity_links_entity_idx ON identity_links (entity_id);

-- ── Conflicts ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conflicts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  attribute_key  text        NOT NULL,
  kind           text        NOT NULL,
  severity       text        NOT NULL DEFAULT 'warning',
  claim_ids      uuid[]      NOT NULL DEFAULT '{}',
  source_ids     uuid[]      NOT NULL DEFAULT '{}',
  description    text        NOT NULL,
  user_message   text,
  evidence       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status         text        NOT NULL DEFAULT 'open',
  resolution_note text,
  resolved_at    timestamptz,
  detected_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT conflicts_kind_ck CHECK (kind IN
    ('value_contradiction','identity_mismatch','unsupported_association','temporal_override',
     'logical_contradiction')),
  CONSTRAINT conflicts_severity_ck CHECK (severity IN ('blocking','warning','info')),
  CONSTRAINT conflicts_status_ck CHECK (status IN
    ('open','resolved_by_evidence','resolved_by_user','dismissed'))
);
CREATE INDEX IF NOT EXISTS conflicts_entity_idx ON conflicts (entity_id, status);

-- ── Ambiguity ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ambiguities (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  dimension      text        NOT NULL,
  description    text        NOT NULL,
  candidates     jsonb       NOT NULL DEFAULT '[]'::jsonb,
  missing_evidence jsonb     NOT NULL DEFAULT '[]'::jsonb,
  severity       text        NOT NULL DEFAULT 'blocking',
  status         text        NOT NULL DEFAULT 'open',
  resolution_note text,
  resolved_at    timestamptz,
  detected_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ambiguities_severity_ck CHECK (severity IN ('blocking','warning','info')),
  CONSTRAINT ambiguities_status_ck CHECK (status IN ('open','resolved','dismissed'))
);
CREATE INDEX IF NOT EXISTS ambiguities_entity_idx ON ambiguities (entity_id, status);

-- ── Review queue (spec §23) ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS review_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id      uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind           text        NOT NULL,
  title          text        NOT NULL,
  detail         text,
  proposed       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  source_id      uuid REFERENCES sources(id) ON DELETE SET NULL,
  claim_id       uuid REFERENCES claims(id) ON DELETE SET NULL,
  conflict_id    uuid REFERENCES conflicts(id) ON DELETE CASCADE,
  ambiguity_id   uuid REFERENCES ambiguities(id) ON DELETE CASCADE,
  stage_key      text,
  blocking       boolean     NOT NULL DEFAULT false,
  status         text        NOT NULL DEFAULT 'pending',
  decision_note  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  CONSTRAINT review_items_kind_ck CHECK (kind IN
    ('discovered_fact','discovered_relationship','identity_verdict','conflict','ambiguity',
     'change_detected','portfolio_discovery','source_limit')),
  CONSTRAINT review_items_status_ck CHECK (status IN ('pending','accepted','rejected','applied'))
);
CREATE INDEX IF NOT EXISTS review_items_entity_idx ON review_items (entity_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS review_items_conflict_uq ON review_items (conflict_id)
  WHERE conflict_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS review_items_ambiguity_uq ON review_items (ambiguity_id)
  WHERE ambiguity_id IS NOT NULL;

-- ── Readiness runs (spec §17, §18, §19) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS readiness_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind             text        NOT NULL DEFAULT 'standard',
  status           text        NOT NULL DEFAULT 'running',
  score            numeric     NOT NULL DEFAULT 0,
  checks           jsonb       NOT NULL DEFAULT '[]'::jsonb,
  blocking_issues  jsonb       NOT NULL DEFAULT '[]'::jsonb,
  warnings         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  second_pass_answers jsonb    NOT NULL DEFAULT '[]'::jsonb,
  summary          text,
  ai_summary       text,
  corrections_since_parent integer NOT NULL DEFAULT 0,
  parent_run_id    uuid REFERENCES readiness_runs(id) ON DELETE SET NULL,
  started_at       timestamptz NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  CONSTRAINT readiness_runs_kind_ck CHECK (kind IN ('standard','second_pass')),
  CONSTRAINT readiness_runs_status_ck CHECK (status IN ('running','blocked','ready','error'))
);
CREATE INDEX IF NOT EXISTS readiness_runs_entity_idx ON readiness_runs (entity_id, started_at DESC);

-- ── Evidence minimums snapshots (spec §8) ────────────────────────────────

CREATE TABLE IF NOT EXISTS evidence_minimums (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  websites_supplied integer NOT NULL DEFAULT 0,
  websites_qualifying integer NOT NULL DEFAULT 0,
  press_supplied      integer NOT NULL DEFAULT 0,
  press_qualifying    integer NOT NULL DEFAULT 0,
  photos_supplied     integer NOT NULL DEFAULT 0,
  photos_qualifying   integer NOT NULL DEFAULT 0,
  independent_press_groups integer NOT NULL DEFAULT 0,
  detail       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  computed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_minimums_entity_idx ON evidence_minimums (entity_id, computed_at DESC);

-- ── Domains and deployments (spec §24, §25, §26) ────────────────────────

CREATE TABLE IF NOT EXISTS domains (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id          uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  hostname           text        NOT NULL UNIQUE,
  kind               text        NOT NULL,
  status             text        NOT NULL DEFAULT 'pending_dns',
  verification_token text,
  dns_records        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  is_primary         boolean     NOT NULL DEFAULT false,
  verified_at        timestamptz,
  last_checked_at    timestamptz,
  check_detail       text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT domains_kind_ck CHECK (kind IN ('platform_subdomain','custom')),
  CONSTRAINT domains_status_ck CHECK (status IN
    ('pending_dns','verifying','active','failed','removed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS domains_entity_host_uq ON domains (entity_id, hostname);
CREATE UNIQUE INDEX IF NOT EXISTS domains_primary_uq ON domains (entity_id) WHERE is_primary;

CREATE TABLE IF NOT EXISTS deployments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id             uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target                text        NOT NULL,
  status                text        NOT NULL DEFAULT 'queued',
  attempt               integer     NOT NULL DEFAULT 1,
  provider_deployment_id text,
  provider_project_id   text,
  url                   text,
  build_hash            text,
  site_bytes            integer,
  file_count            integer,
  validation            jsonb       NOT NULL DEFAULT '{}'::jsonb,
  log                   text        NOT NULL DEFAULT '',
  error                 jsonb,
  started_at            timestamptz,
  finished_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deployments_target_ck CHECK (target IN ('vercel','platform_host')),
  CONSTRAINT deployments_status_ck CHECK (status IN
    ('queued','building','validating','deploying','live','failed','superseded'))
);
CREATE INDEX IF NOT EXISTS deployments_entity_idx ON deployments (entity_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS deployments_live_uq ON deployments (entity_id) WHERE status = 'live';

-- ── Monitoring / revalidation (spec §27) ────────────────────────────────

CREATE TABLE IF NOT EXISTS revalidation_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid        NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  kind         text        NOT NULL,
  status       text        NOT NULL DEFAULT 'pending',
  attempts     integer     NOT NULL DEFAULT 0,
  payload      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  last_error   text,
  next_run_at  timestamptz NOT NULL DEFAULT now(),
  last_run_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT revalidation_jobs_kind_ck CHECK (kind IN
    ('source_recheck','freshness_sweep','publish_refresh','domain_verify')),
  CONSTRAINT revalidation_jobs_status_ck CHECK (status IN
    ('pending','running','done','failed','skipped'))
);
CREATE INDEX IF NOT EXISTS revalidation_jobs_due_idx ON revalidation_jobs (next_run_at)
  WHERE status = 'pending';

-- ── Audit trail (spec §30) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id         bigserial PRIMARY KEY,
  user_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_id  uuid REFERENCES entities(id) ON DELETE SET NULL,
  action     text        NOT NULL,
  actor      text        NOT NULL DEFAULT 'user',
  detail     jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log (entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log (user_id, created_at DESC);

-- ── Platform configuration surface (never exposed to clients) ───────────

CREATE TABLE IF NOT EXISTS platform_settings (
  key        text PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);