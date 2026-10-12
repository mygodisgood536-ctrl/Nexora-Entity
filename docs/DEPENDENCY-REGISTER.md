# Nexora Entity — External Dependency Register

Every service, tool or external system the platform needs, what it is genuinely required for, what
its real status is today, and what it costs. Nothing is listed speculatively: each entry is
referenced by code in this repository.

**Status legend**

| Status | Meaning |
| --- | --- |
| **IMPLEMENTED** | Code exists and works without an external account. |
| **PENDING — no account** | Code is complete; activation needs an account/credential you have not supplied. |
| **PENDING — not installed** | Deliberately excluded from this phase. |
| **NOT USED** | Considered and rejected; recorded so it is not re-proposed. |

---

## 1. PostgreSQL — **PENDING (explicitly excluded this phase)**

**Required for:** accounts and sessions, entities, all 23 stage records, sources, photos, claims,
evidence, identity links, conflicts, ambiguities, review items, readiness runs, domains,
deployments, jobs, audit log. In short: the entire product.

**Does the existing project already assume PostgreSQL?** Yes, completely. It is not a new
requirement I am introducing:

- Driver: `pg` (`packages/db/package.json`), connection via `DATABASE_URL`
  (`packages/core/src/config.ts`).
- Schema: 4 ordered, idempotent migrations creating **24 tables** plus `schema_migrations`
  (`packages/db/migrations/0001_init.sql` … `0004_source_declared_roles.sql`).
- Every pipeline table carries `entity_id … REFERENCES entities(id) ON DELETE CASCADE`, and
  `entities.user_id REFERENCES users(id) ON DELETE CASCADE`, so deleting one account or entity
  removes all of its data.
- Required PostgreSQL features: `pgcrypto` and `pg_trgm` only. **No pgvector, no PostGIS**, no
  superuser, no `LISTEN/NOTIFY`, no advisory locks. This is deliberately portable.

**What is fully prepared (no database required to finish):**

- Schema, migrations, indexes, constraints, CHECK constraints, partial unique indexes — done.
- Repository layer with ownership scoping (`findEntityForUser`) — done.
- Auth crypto: scrypt N=16384, per-account salt, `timingSafeEqual`, SHA-256-hashed session
  tokens, `HttpOnly`/`SameSite=Lax`/`Secure` cookie handling — done and unit-tested (22 tests).
- The entire deterministic engine (identity, conflicts, ambiguity, provenance, completeness,
  readiness, second pass) is a pure function of `ReadinessInput` and is fully unit-tested
  **without** a database.

**What remains blocked:** anything that reads or writes persisted state — signup, login, entity
creation, all guided stages, uploads, readiness runs, review decisions, publication.

**Known work needed at activation time:**

1. `pg.Pool` sets no `ssl` option. On a provider that terminates TLS you must append
   `?sslmode=require` to `DATABASE_URL`, or add explicit `ssl` handling. **This is the single
   biggest activation gap.**
2. Pool `max: 12` is tuned for a local postmaster. On a pooler with a 5–10 connection cap, lower
   it (no env override exists yet — worth adding).
3. Migrations record a checksum but never compare it, so an edited-and-reapplied migration is
   silently ignored. Add drift detection before the first production migration.
4. `makePrimaryPhoto` and `makeDomainPrimary` clear-then-set in two statements with no
   transaction. Wrap both.

**Recommended hosted option:** Neon (see `POSTGRESQL-INTEGRATION.md` for the full plan, costs and
required actions).

---

## 2. OpenCode (AI provider/model bridge) — **PENDING (explicitly excluded this phase)**

**Required for:** dynamic provider/model discovery, model verification, and every AI-assisted
operation (source analysis, alias reasoning, completeness reasoning, readiness narration).

**Current state:** the bridge is fully written and split so the web application never touches
`node:child_process`:

| Module | Role | Imported by |
| --- | --- | --- |
| `packages/opencode-bridge/src/server.ts` | Attach-only HTTP client. Never spawns. | The web app. |
| `packages/opencode-bridge/src/supervisor.ts` | Spawns a local `opencode serve`. | Dev scripts only. |

This split was required, not cosmetic: while the supervisor was in the client module, Turbopack
refused to build because `child_process` in the server graph made it trace the entire project
into the output.

**Nothing fabricates a provider result.** Discovery (`discovery.ts`) reads a live
`GET /provider`; verification (`ops.ts`) performs a real round trip and requires the literal
token `NEXORA_OK` before a model is stored as verified. `runStructured` throws on unparseable
output rather than substituting data. The deterministic engine never calls the AI layer, so an
unavailable provider cannot produce a false readiness result.

**Recommended cloud architecture:** see `OPENCODE-INTEGRATION.md`.

---

## 3. Vercel — **PENDING — no account/credential**

**Required for:** hosting the platform, and per-entity public website deployment (vision §24,
§25, §10 of the v2.0 amendment, which make Vercel the authoritative deployment layer).

**Implemented:** `packages/deploy/src/vercel.ts` performs a real deployment — project
existence probe, project creation, file upload, `POST /v13/deployments`, domain assignment.
It reads `VERCEL_TOKEN` / `NEXORA_VERCEL_TOKEN` and optionally `VERCEL_TEAM_ID`. **No secret is
ever sent to Vercel**, because the published artefact is entirely static.

**`vercel.json` added** in this phase: build command, standalone output directory, and security
headers.

**Unwired:** `vercelAssignDomain`, `vercelRemoveDomain` and `vercelAssignSubdomain` are
implemented but have **zero callers**. Custom-domain connection on Vercel is therefore
architecturally present but not yet reachable from the UI. There is also **no Vercel rollback**:
`deployments` records the previous live release, but nothing promotes an older Vercel deployment.

**Account/credential required:** a Vercel team + API token. Nothing is charged until you deploy.

---

## 4. File storage for uploaded photos — **NOT CLOUD-READY (blocking for Vercel)**

**Required for:** the 4+ qualifying photos minimum (a hard gate) and every photo on the public
site.

**Current implementation:** the local filesystem.

- Writes: `packages/web/src/app/api/entities/[id]/photos/route.ts` → `config().photoDir`
- Reads: `packages/web/src/app/media/[...path]/route.ts` → same directory
- Path traversal is correctly confined (`path.resolve` + prefix check).

**Why this is a real blocker:** on a Vercel serverless function the filesystem is read-only and
ephemeral. An uploaded photo would vanish between invocations, the 4-photo minimum could never be
satisfied, and published sites would reference images that no longer exist. **The application
cannot be honestly called production-ready on Vercel until this moves to object storage.**

**Recommendation:** Vercel Blob, or any S3-compatible store (Cloudflare R2, Supabase Storage).
The change is contained: one write path and one read path, both already isolated behind
`config().photoDir`. No engine, schema or UI logic depends on where bytes live — only the
`photos.storage_path` / `public_url` columns.

**Account required:** a storage provider account. Free tiers exist; see the integration plan.

---

## 5. Published-site hosting ("platform host" tier) — **NOT SERVERLESS-VIABLE**

**Required for:** publishing without a Vercel token.

**Current implementation:** versioned release directories on the local filesystem
(`packages/deploy/src/platform-host.ts`), with atomic staging→rename writes, 10-release retention
and a rollback function.

**Strengths:** genuinely safe writes (a partial release cannot be served), path traversal guarded,
correct cache headers, unpublished entities 404.

**Why it is not viable on Vercel:** releases live in `storage/sites/<entityId>/<releaseId>/`, which
does not exist on a fresh lambda and is destroyed between invocations. The shared `index.json`
pointer is also an unlocked read-modify-write, so concurrent deploys lose each other's entries.
This tier is correct on a long-lived Node host (VM, container, Railway, Fly.io) and **wrong** on a
serverless platform.

**Recommendation:** treat Vercel as the only publishing target for v1 (which is also what the
vision mandates), and keep the platform-host tier for self-hosted installs.

---

## 6. DNS resolution — **IMPLEMENTED, no account**

`packages/deploy/src/domains.ts` performs real `dns.resolve4` / `dns.resolveTxt` verification
before a custom domain is reported connected. Uses the Node resolver only. No provider, no
account, no cost.

**Known limitation to fix before v1:** the generated A record is hard-coded to Vercel's anycast IP
`76.76.21.21` even for platform-host deployments, and the TXT check is a substring match. Both
should be tightened.

---

## 7. Outbound HTTP / source inspection — **IMPLEMENTED, no account**

`packages/inspect` fetches and parses user-supplied sources. No scraping API, no search API, no
browser automation.

- SSRF protection: DNS pre-resolution rejecting private/link-local ranges, re-checked on every
  redirect hop, scheme allow-list, byte cap, timeout, content-type allow-list
  (`packages/inspect/src/http.ts`).
- Parsing: Open Graph, Twitter cards, JSON-LD (with `@graph` flattening), microdata, headings.
- 8 of 32 known platforms have real API connectors (GitHub, GitLab, Reddit, Bluesky, ORCID,
  Wikipedia, Stack Exchange, YouTube oEmbed). These use **unauthenticated public APIs**.
- LinkedIn and most consumer platforms are explicitly recorded as unreadable rather than claimed
  as verified.

**No account required.** Rate limits may apply to the public APIs in use; nothing is purchased.

---

## 8. Portfolio parsing — **IMPLEMENTED, no account**

`packages/inspect/src/portfolio.ts` does real text extraction: PDF via `unpdf` (pdf.js), DOCX via
`mammoth`, plain text/Markdown/CSV. Images are measured only. Extracted content becomes
**review candidates, never published facts**. No OCR is performed and the limitation is stated to
the user rather than hidden.

---

## 9. Background jobs and scheduling — **IMPLEMENTED, but hosting-dependent**

`revalidation_jobs` queue with atomic compare-and-set claiming, plus `packages/deploy/src/monitoring.ts`
(source re-checks, freshness sweeps, publish refresh, domain verification).

`packages/web/src/app/api/cron/route.ts` exposes it, gated by `NEXORA_CRON_SECRET` and answering
**404** for a wrong or missing secret so the two are indistinguishable.

**Hosting-dependent:** on Vercel a route cannot be called on a schedule by itself. It needs
Vercel Cron (`crons` in `vercel.json`) or an external scheduler. Not yet wired — flagged, not
hidden.

---

## 10. Email delivery — **NOT USED**

No transactional email. Account recovery does not exist.

**Consequence you should know about:** the vision's authentication model is username + security
question + security answer, with no email address at all. There is therefore **no password reset
and no account recovery path**. This is a direct consequence of the specified account model, not
an oversight, and it is flagged in the final report as a product risk.

---

## 11. Analytics, error reporting, monitoring — **NOT USED**

No third-party analytics, no Sentry, no APM. The platform has its own structured logger
(`packages/core/src/logging.ts`) and an audit log table. Introducing a provider is not necessary
for the current scope; it would be an addition, not a requirement.

---

## 12. Rejected / not introduced

| Considered | Why not |
| --- | --- |
| A scraping/search API (SerpAPI etc.) | Inspection works directly on user-supplied URLs. A search API is a later-phase source-discovery feature (vision §35). |
| An AI model API used directly | The vision forbids it: OpenCode is the single provider bridge and provider lists must not be hard-coded. |
| A per-user Vercel Sandbox for site generation | Explicitly superseded by v2.0 §10 and §15: one pre-designed design system is populated, not code-generated per user. |
| Redis / a job queue service | `revalidation_jobs` + atomic claiming is sufficient at this scale. |
| An auth provider (Auth0/Clerk) | The vision specifies a bespoke four-field account model. |

---

## Summary — what is needed from you, and when

| # | Dependency | Needed now? | Account/credential needed | Cost |
| --- | --- | --- | --- | --- |
| 1 | Hosted PostgreSQL | Next phase | Provider account; `DATABASE_URL` with password | Free tier available |
| 2 | Object storage (photos) | **Before any Vercel deployment** | Provider account; token | Free tier available |
| 3 | OpenCode, cloud-hosted | Later phase | A server/VM; model provider API key | Provider-dependent |
| 4 | Vercel | For deployment | Vercel account + API token | Free hobby tier; Pro if needed |
| 5 | Vercel Cron (optional) | Later | Part of Vercel | Included |

Nothing on this list has been activated, and no charge has been incurred.