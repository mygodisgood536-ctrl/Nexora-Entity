# Nexora Entity

Nexora Entity helps a person assemble, verify, and publish a coherent, attributable online
identity. It inspects the sources a person already controls, resolves which sources genuinely
belong to the same person, records where every fact came from, and gates publication on an
explicit internal readiness standard.

## The distinction that matters

Nexora Entity has its own verification and readiness standard. It is not a search engine, and it
does not verify, approve, endorse, or place anything with Google or any other search engine.
A Knowledge Panel, a ranking, or any search result is decided independently by that engine.

So the product never says "Google verified". It says "meets the Nexora Entity Readiness Standard",
and the public site carries that explanation. This is enforced in code by
`packages/core/src/product-language.ts`, which is applied to readiness copy and to published site
text, and covered by tests.

## Architecture

Eight packages, one dependency direction: `core` is depended on by everything, and nothing
depends on `web`.

| Package | Responsibility |
| --- | --- |
| `core` | Domain vocabulary, the 23-stage model (A–W), error taxonomy, product-language guard, name normalisation, logging, configuration. Browser-safe. |
| `db` | PostgreSQL pool, schema migrations, authentication crypto, and every repository. |
| `opencode-bridge` | Supervises the local OpenCode server, discovers real providers and models, verifies a model with a live round trip, and records attempts. |
| `inspect` | Fetches and reads sources under SSRF and size limits; parses Open Graph, JSON-LD, microdata, and platform-specific structures; qualifies evidence; decodes and de-duplicates photos. |
| `engine` | Entity graph, identity resolution, conflict detection, ambiguity detection, completeness reasoning, and the Entity Readiness gate with a mandatory whole-entity second pass. |
| `entity-site` | The single public design system and the composer that turns verified facts into a site. No second markup implementation. |
| `deploy` | Builds the static artefact, validates it, and publishes it to Vercel or to the platform's own hosting tier. |
| `web` | The Next.js platform: onboarding, guided stages, review queue, readiness board, publish console, and the published-site host. |

### Why the static renderer runs out of process

`entity-site` renders the published HTML with `renderToStaticMarkup` from the one design system.
Next 16 forbids importing `react-dom/server` into the server-component graph, so the renderer runs
as its own Node process (`entity-site/src/render-cli.ts`, driven by `deploy/src/render-process.ts`).
The live preview and the published site therefore share exactly one renderer. If it cannot start,
the deployment fails and says so; placeholder markup is never substituted.

### Why the database pool is anchored to `globalThis`

A production Next build emits one module instance per route chunk. A module-level pool would
create a separate pool per route, opening more connections than the postmaster allows; the
surplus attempts get terminated mid-handshake and surface to users as unexplained errors. The pool
is held on `globalThis` so there is exactly one per process.

## Getting started

Requirements: Node 24+, and a bundled PostgreSQL 16 (already provisioned in `.pg/`).

```bash
npm install
npm run services      # start PostgreSQL and the local OpenCode server
npm run db:status     # confirm 24 tables and 4 migrations
npm run build         # build the Next.js platform
npm run web:start     # serve it on http://127.0.0.1:4311
```

Useful commands:

```bash
npm run dev           # development server
npm run typecheck     # TypeScript across every package
npm run test          # unit tests
npm run smoke         # real HTTP end-to-end test against the running platform
npm run verify        # typecheck + test + build + smoke
npm run check:site    # render the public design system and validate the artefact
npm run e2e:engine    # real inspection and readiness run against live sources
npm run web:stop      # stop the platform and release the build directory
```

`npm run services` is safe to run repeatedly. It never restarts a healthy database, which matters
because re-registering a running scheduled task would force a crash-recovery cycle.

## Environment variables

Everything has a working default for local use; nothing is required to start.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://nexora_entity:nexora_entity@127.0.0.1:5433/nexora_entity_dev` | Application database. |
| `DATABASE_URL_TEST` | same host, `nexora_entity_test` | Test database. |
| `NEXORA_PG_PORT` | `5433` | Bundled PostgreSQL port. |
| `NEXORA_OPENCODE_PORT` | `4137` | Local OpenCode server port. |
| `NEXORA_SESSION_COOKIE` | `nexora_session` | Session cookie name. |
| `NEXORA_SESSION_TTL_DAYS` | `30` | Session lifetime. |
| `NEXORA_STORAGE_DIR` | `storage` | Site releases and other platform state. |
| `NEXORA_PHOTO_DIR` | `storage/photos` | Uploaded photos. |
| `NEXORA_PORTFOLIO_DIR` | `storage/portfolios` | Uploaded portfolio files. |
| `NEXORA_ENTITY_HOST_SUFFIX` | `localhost` | Host suffix for platform-hosted entity sites. |
| `NEXORA_LOG_LEVEL` | `info` | Server log threshold. |
| `NEXT_PUBLIC_NEXORA_LOG_LEVEL` | `info` | Client log threshold. |
| `VERCEL_TOKEN` | unset | Enables real Vercel deployment. |

With no `VERCEL_TOKEN`, publication uses the platform's own hosting tier and the interface says
so. It is never presented as a Vercel deployment.

## How verification works

1. **Inspect.** Each source is fetched with redirect, size, and content-type limits, and SSRF
   protection that resolves DNS and rejects private and link-local addresses. Unreadable sources
   are recorded as unreadable with a reason. They are never counted as evidence.
2. **Resolve identity.** Name variants, professions, locations, and co-occurring links are compared
   across sources. Each link gets a resolution state and a confidence, and anything uncertain
   becomes a review item rather than a silent assumption.
3. **Record provenance.** Every claim points at the evidence that supports it and the source that
   evidence came from. The graph holds the relationships, not just the facts.
4. **Detect conflicts and ambiguity.** Contradictions between sources become review items with
   severity. A profile that could describe more than one person raises an ambiguity item, which
   can block publication.
5. **Run readiness, then review again.** Readiness is computed across the whole entity, never per
   stage in isolation, and a mandatory second pass re-evaluates the result. AI orchestration is
   advisory: it can propose, and a person decides.

The internal evidence minimums are 5 qualifying websites, 4 qualifying press releases, and
4 qualifying photos. These are Nexora Entity's own standard, stated as such in the interface.

## Deployment

`npm run build` produces a standalone Next.js server, served by the emitted `server.js` rather
than `next start` (Next 16 does not support the combination).

Publishing is a real operation, not a simulation:

- The artefact is built from database state, validated, and only then written.
- On the platform host, a release is written to a staging directory and renamed into place, so a
  partially written release can never be served. Releases are versioned and can be rolled back.
- The published site is served with correct content types and caching: HTML is revalidated,
  immutable assets are cached for a year.
- Unpublished entities return 404 with `noindex`, so nothing leaks before publication.

Custom domains are supported through DNS verification. A domain is only reported as connected
after its records actually resolve.

## Google and search engines

Nexora Entity makes a person's online identity more coherent, connected, and attributable. It
cannot and does not guarantee how any search engine will present that information. The published
site states this, and the code refuses to let the opposite wording through.
