# PostgreSQL Integration Plan — prepared, not activated

**Status: PENDING. The integration has not been activated and must not be until you approve the
next phase.** This document is the activation plan.

---

## 1. Does the existing project already assume PostgreSQL?

**Yes — completely, and it always has.** PostgreSQL is not a proposal; it is the project's
existing, chosen database. Evidence:

| Evidence | Location |
| --- | --- |
| Driver already declared | `packages/db/package.json` → `"pg": "^8.16.3"` |
| Connection contract already implemented | `packages/core/src/config.ts` → `databaseUrl` from `DATABASE_URL` |
| Pool already implemented and tuned | `packages/db/src/pool.ts` |
| Schema already written | 4 ordered migrations, `packages/db/migrations/0001_init.sql` … `0004_*.sql` |
| Repositories already written | 5 repo modules covering every table |
| Default already present | `postgres://nexora_entity:nexora_entity@127.0.0.1:5433/nexora_entity_dev` |

Nothing about the data model needs to change to move to a hosted provider.

**Required server features — deliberately minimal:**

- `pgcrypto` (for `gen_random_uuid()`) and `pg_trgm` (for one GIN index).
- Both are stock `contrib` extensions, available on every mainstream managed provider.
- **No pgvector. No PostGIS. No superuser. No `LISTEN/NOTIFY`. No advisory locks. No tablespaces.**

## 2. Which database features are fully prepared

- **24 tables** with foreign keys, CHECK constraints, partial unique indexes and composite
  indexes. Tenant isolation is enforced structurally: every pipeline table cascades from
  `entities`, which cascades from `users`.
- **Idempotent, ordered migrations** tracked in `schema_migrations`; re-running is safe.
- **Auth crypto** — scrypt N=16384, 64-byte key, 16-byte random per-account salt,
  `timingSafeEqual` comparison, SHA-256-hashed session tokens, `HttpOnly` + `SameSite=Lax` +
  `Secure` cookies. 22 unit tests, all passing, **no database required**.
- **The entire readiness engine** is a pure function over `ReadinessInput`. All of identity
  resolution, conflict detection, ambiguity detection, provenance, completeness and the second
  pass are unit-tested against fixtures with **no database required**. 324 tests pass offline.

**In short: the application logic is finished and verified. Only persistence is missing.**

## 3. Which features remain blocked

Everything that reads or writes state:

- Account registration, login, logout, session validation
- Entity creation and the `?entity=` navigation that depends on it
- All 23 guided stages (the core product journey)
- Source inspection persistence, photo uploads, portfolio uploads
- Identity links, conflicts, ambiguities, review queue
- Readiness runs and the history table
- Domain connection and publication

**No live database operation has been tested, because no database is connected.** Any claim that
signup, login or publication works would be unfounded, and none is made.

## 4. Recommended hosted option: Neon

**Why Neon fits this architecture specifically:**

| Requirement | Neon |
| --- | --- |
| Standard PostgreSQL | Yes — genuine PostgreSQL, no compatibility layer. |
| `pgcrypto` + `pg_trgm` | Both available. |
| TLS | Yes, required, with a pooled and a direct (unpooled) endpoint. |
| Works with `pg` over `DATABASE_URL` | Yes, directly. |
| Branching/preview DBs | Yes — useful for testing migrations against a throwaway copy. |
| Fits a Vercel deployment | Yes — same region/VPC options. |

**Alternatives, and when they would be better:**

- **Supabase** — if you also want managed object storage and Auth in one place. Heavier than
  needed for this project.
- **Amazon RDS / Google Cloud SQL** — if you need an existing corporate cloud agreement. More
  operational work; same code.
- **Vercel Marketplace** — **yes, Neon is available through Vercel Marketplace**, and so is
  Supabase. This means the database can be provisioned and billed through the same Vercel account
  you will use for the platform, with `DATABASE_URL` injected automatically into the deployment's
  environment variables. This is the lowest-friction path and the one I recommend.

**Connection strings and pooling — important.** Neon offers a pooled endpoint (PgBouncer in
transaction mode) and a direct endpoint. This matters because:

- `packages/db/src/pool.ts` acquires and releases a client **per statement**, with no pipelining.
  That is a poor match for transaction-mode pooling and will thrash it.
- Use the **direct (unpooled) endpoint** initially and raise `max`, **or** switch `query()` to
  hold a client for the duration of a request.

Recommendation: start on the **pooled** endpoint with `max` reduced to match the pooler, and
change `statement_timeout`. Either way, this must be decided at activation, not guessed.

## 5. What I need from you

1. **Approval** to proceed to the database phase.
2. **A Neon (or chosen provider) account.** Create it yourself; do not send credentials to me.
3. The **connection string**. Set it yourself as an environment variable in Vercel — do **not**
   paste it into chat or commit it.
4. **Confirmation of the region** (closest to your users).
5. **Authority to run the 4 migrations** against that database.

## 6. Cost and free-tier limits

Neon and Supabase both offer free tiers, sufficient for development and a small number of
entities. Free tiers typically include: a limited compute size, limited storage, and **automatic
suspension after prolonged inactivity** — after which the database pauses and resumes on the next
connection. That is fine for this product's traffic, but a paused database means the first request
after an idle period is slow.

**Verify current pricing and limits at activation time** — provider tiers change frequently and I
have not activated anything, so I have no live figure to quote. The figure I give you at that
point will be checked against the provider's own page on the day.

## 7. How activation happens without installing PostgreSQL on your PC

Nothing is installed locally. The sequence is:

1. You create the hosted database in your browser.
2. You set `DATABASE_URL` in the Vercel project's environment variables (UI, never chat, never
   the repository).
3. Migrations are applied **from a cloud runner**, not from your machine. Two options:
   - **GitHub Actions** — a workflow step runs `npm run db:migrate` against `DATABASE_URL` taken
     from a repository secret. Runs on GitHub's infrastructure.
   - **Vercel** — a build step or a one-off invoked endpoint performs the migration.
4. The application connects over TLS. No `psql`, no local server, no local install.

### Required code changes before activation (all small, all identified)

| Change | Why |
| --- | --- |
| Add explicit `ssl` handling to the `pg` Pool | Currently TLS is implied only by `?sslmode=require` in the URL. Making it explicit prevents a silent plaintext connection. |
| Make pool `max` configurable (`NEXORA_DB_POOL_MAX`) | Currently hard-coded to 12, tuned for a local postmaster. |
| Add `statement_timeout` / `query_timeout` | Prevents one pathological query from holding a pooled connection. |
| Add migration checksum comparison | An edited-and-reapplied migration is currently ignored silently. |
| Wrap `makePrimaryPhoto` / `makeDomainPrimary` in a transaction | Clear-then-set is currently two non-atomic statements. |

I recommend doing all five at activation. None changes the schema or the product behaviour.

## 8. Definition of done for this integration

- `npm run db:migrate` completes against the hosted database.
- `npm run db:status` reports 24 tables and 4 migrations.
- A real person can register, log in, create an entity, complete stages, upload evidence, reach a
  readiness verdict, and publish — on the hosted database, with no service installed on any
  personal computer.