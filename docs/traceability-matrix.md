# Specification traceability matrix

> **Status: STALE as of the Phase 1 audit.** This matrix was written against commit `f16b4cb`.
> The audit and remediation phase that followed found and fixed defects that change the recorded
> status of a number of rows — most importantly the guided stages (which were unreachable through
> the UI), the stage autosave (which reverted completed and skipped stages), the mandatory
> whole-entity second pass (which restated the first pass instead of re-deriving it), the readiness
> gate's photo minimum (which trusted the caller), and the production build (which shipped no
> stylesheets). Several rows marked `partial` below are now complete, and rows marked `complete`
> were, in some cases, not working at all.
>
> **The authoritative current status is [`PHASE-1-COMPLETION-REPORT.md`](PHASE-1-COMPLETION-REPORT.md).**
> Treat this file as a historical snapshot until it is regenerated. It has been deliberately left
> unedited rather than partially patched, because selectively updating rows would give a document
> that appears current and is not.

The authoritative specification is
`Nexora_Entity_Product_Vision_and_Implementation_Instructions_UPDATED.docx`
(read in full, including Amendment 2.0). This file is the mechanism by which
compliance with that document is demonstrated and maintained.

## How to read this file

| Column | Meaning |
| --- | --- |
| **§** | The requirement's location in the vision document. `A2.x` = Amendment 2.0 §x. |
| **Requirement** | The requirement, condensed to its testable obligation. |
| **Module** | The code that implements it. A path, not a package name alone. |
| **Test** | The test that covers it, or `—` where none exists. |
| **Status** | `complete`, `partial`, `outstanding`, or `unverified`. |
| **Evidence** | How the status was established in this session. |

Status vocabulary is deliberately strict:

- **complete** — verified in this session against the document, with a named test or a
  named command that exercises it.
- **partial** — the mechanism exists but does not fully discharge the requirement.
- **outstanding** — not implemented.
- **unverified** — implemented or believed implemented, but not yet checked against the
  document in this session. These are **not** to be read as passing.

Per §2.2, "the main part works" is never sufficient for `complete`.

## Verification provenance

| | |
| --- | --- |
| Session | 2026-10-03 |
| Vision document read in full | Yes — 588 lines incl. Amendment 2.0 |
| Build | `npm run build` → exit 0, 22 routes |
| Browser verification | `npm run ui:audit` (harness added this session) |
| Repository | **not a git repository** — §2.4 "same commit" cannot be honoured as written |

> **Note on §2.4.** `C:\Users\adede\nexora-entity` has no `.git` directory. The matrix is
> therefore updated in the working tree, not in a commit. Initialising version control is
> recommended before further work so requirement changes can be attributed.

## Part 1 — Product vision, principles, identity and evidence (doc §1–§10)

`Doc §` is the section number in the vision document. The handover requires one row per
numbered requirement; where a document section states several obligations they are split.

| Doc § | Requirement | Module | Test | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Collect, connect, inspect, verify and publish a coherent public representation of a person; not a website builder or profile generator | `engine/src/pipeline.ts`, `entity-site/src/compose.ts` | `e2e:engine`, `check:site` | **partial** | Pipeline and composer exist; publication still blocked (§19) |
| 2 | Never invent, silently assume or falsely verify identity relationships or facts | `engine/src/identity.ts`, `engine/src/conflicts.ts` | `identity.test.ts` (19), `conflicts.test.ts` (16) | **unverified** | Module and tests present; not re-checked against document this session |
| 2 | Every important externally sourced fact retains provenance, check time and verification status | `engine/src/graph.ts`, `db/src/repos-sources.ts` | — | **unverified** | No dedicated provenance test found |
| 2 | Unresolved inconsistencies, ambiguity, unsupported claims or failed minimums stop publication | `engine/src/readiness.ts`, `deploy/src/deploy.ts` | `readiness.test.ts` (29) | **complete** | Gate enforced inside `deployEntity`; `e2e:engine` reports BLOCKED at 96% |
| 2 | 100% requires a complete final second-pass review of the whole entity, not a recheck of one field | `engine/src/readiness.ts` | `readiness.test.ts` | **unverified** | Second-pass answers surfaced in the readiness report |
| 2 | User information is never lost when a provider fails, pauses, limits, times out or changes | `engine/src/ai.ts`, `opencode-bridge/src/failure.ts`, `core/src/errors.ts` | `errors.test.ts` (14) | **partial** | Error taxonomy preserves progress; failure paths not exercised in browser |
| 2 | Generated public website is beautiful, organized, responsive, accessible and is an entity hub, not a generic portfolio | `entity-site/src/design-system.css`, `components.tsx` | `compose.test.ts` (23) | **partial** | Design system and composer exist; **no browser verification has ever been performed** |
| 3 | UX is a polished guided onboarding flow, not a giant form | `web/src/app/app/stages/[slug]/page.tsx`, `core/src/stages.ts` | `product.test.ts` | **partial** | 23 stages A–W registered; skip/return journey not verified in browser |
| 4 | Signup requires exactly Full Name, Username, Security Question, Security Answer | `web/src/app/signup/page.tsx`, `db/src/auth-crypto.ts` | `auth-crypto.test.ts` (22) | **complete** | Four-field form; answers stored as salted scrypt hash |
| 4 | Login with Username, Security Question, Security Answer; functional, secure, persistent, not a mockup | `web/src/app/login/page.tsx`, `api/auth/login/route.ts` | `auth-crypto.test.ts`, `smoke` | **complete** | Exercised this session: signup → login → `/app` succeeded |
| 5 | AI provider/model interface appears immediately on Create Entity; never ask "do you want AI?" | `web/src/components/provider-panel.tsx` | `smoke` | **unverified** | Panel exists; browser verification outstanding |
| 5 | Provider/model availability obtained dynamically; no stale hard-coded provider list | `opencode-bridge/src/discovery.ts` | `check:bridge` | **complete** | Live provider list surfaced at runtime |
| 5 | Selected provider/model must actually be tested/connected before being treated as ready | `web/src/components/provider-panel.tsx`, `api/ai/verify/route.ts` | `check:bridge` | **unverified** | Verify route exists; browser confirmation outstanding |
| 5 | After Done the panel collapses; provider stays reachable at the bottom of the working screen | `web/src/components/provider-dock.tsx`, `globals.css` `.nx-dock` | — | **unverified** | Dock implemented as a fixed bottom bar; not verified in browser |
| 6 | Provider failures handled gracefully; progress preserved; provider switchable from the same screen | `opencode-bridge/src/failure.ts`, `web/src/components/provider-dock.tsx` | `core/test/errors.test.ts` | **partial** | Failure classification exists; end-to-end failure journey unverified |
| 6 | UI clearly distinguishes provider failure from an entity-data problem | `core/src/errors.ts` (domains), `readiness-board.tsx` | `core/test/errors.test.ts` | **unverified** | Error taxonomy carries a `domain`; UI separation not browser-verified |
| 7 | Progressive stages collect identity, aliases, biography, profession, career, education, skills, organisations, projects, achievements, publications, press, websites, locations, photos | `core/src/stages.ts` (A–W), `web/.../stage-form.tsx` | `core/test/product.test.ts` | **complete** | Registry test asserts A–W with no gaps |
| 7 | Never force users to understand entity-resolution terminology; use normal language | `core/src/vocabulary.ts`, `web/src/components/*` | `core/test/product.test.ts` | **unverified** | Vocabulary module exists |
| 8 | Minimum 5+ qualifying live website URLs | `inspect/src/qualify.ts`, `engine/src/readiness.ts` | `inspect/test/qualify.test.ts` (29), `readiness.test.ts` | **complete** | Counts recomputed from source records, duplicates excluded |
| 8 | Minimum 4+ qualifying press releases | `inspect/src/qualify.ts`, `engine/src/readiness.ts` | `qualify.test.ts`, `readiness.test.ts` | **complete** | Independence enforced; own site cannot count as independent press |
| 8 | Minimum 4+ qualifying uploaded photos | `inspect/src/images.ts`, `engine/src/readiness.ts` | `inspect/test/images.test.ts` (25) | **complete** | Strict decode required; truncated images rejected |
| 8 | Quality validated, not merely counted — dead, unrelated, duplicate or invalid items must not satisfy a minimum | `inspect/src/qualify.ts` | `qualify.test.ts` | **complete** | 29 tests over qualification rules |
| 8 | Simple progress shown to the user, e.g. Websites 3/5, Press Releases 2/4, Photos 4/4 | `web/src/components/readiness-board.tsx` | — | **unverified** | Minimums modelled in report; presentation unverified in browser |
| 9 | Inspect supplied/connected public platforms and websites wherever technically possible and authorised | `inspect/src/inspect.ts`, `platforms.ts`, `html.ts`, `http.ts` | `inspect/test/html.test.ts` (28), `http.test.ts` (14) | **complete** | SSRF-safe retrieval; HTML/OG/JSON-LD/microdata parsing |
| 9 | Where a platform cannot be accessed, record the limitation honestly; never claim verification | `inspect/src/inspect.ts` | `check:inspect` | **complete** | Unreadable sources rejected rather than queued as uncertain |
| 10 | Exact name matching is explicitly not the rule; aliases, reordering, nicknames, professional and stage names supported | `engine/src/identity.ts`, `core/src/names.ts` | `core/test/names.test.ts` (21), `identity.test.ts` | **complete** | Multi-signal identity evaluation |
| 10 | Never connect two profiles solely because their names are similar | `engine/src/identity.ts` | `identity.test.ts` | **complete** | Requires supporting evidence, not name similarity alone |
| 10 | States include Confirmed, Probable/Needs Review, Uncertain, Conflict | `engine/src/identity.ts`, `db/src/repos-sources.ts` | `identity.test.ts` | **unverified** | Confirmed/uncertain paths verified; full four-state range not confirmed |

## Part 2 — Provenance, reasoning and readiness (doc §11–§19)

| Doc § | Requirement | Module | Test | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 11 | Every fact retains provenance: what, where from, when checked, how verified, user-provided vs external, conflicts, currency | `engine/src/graph.ts`, `db/src/repos-sources.ts` | — | **partial** | Provenance stored; **no test asserts it**, and §19 shows 0/67 claims carry inspected-source provenance |
| 11 | Distinguish user-provided from externally supported; never present user claims as verified | `engine/src/identity.ts`, `readiness.ts` (`support_strength`) | `readiness.test.ts` | **partial** | Distinction modelled; currently yields 48 self-asserted-only claims |
| 11 | Recognise source independence; four sites copying one release are not four confirmations | `inspect/src/qualify.ts` | `qualify.test.ts` | **complete** | Independence grouping enforced |
| 12 | Source-quality model internally; preserve source type and evidence strength | `inspect/src/qualify.ts`, `engine/src/graph.ts` | `qualify.test.ts` | **unverified** | Not re-checked against the document this session |
| 13 | Detect meaningful contradictions, not mere wording differences | `engine/src/conflicts.ts` | `conflicts.test.ts` (16) | **complete** | 16 tests over conflict classification |
| 13 | Historical differences are not automatically conflicts; understand dates and changing roles | `engine/src/conflicts.ts` | `conflicts.test.ts` | **unverified** | Temporal logic not re-verified this session |
| 14 | Assess whether the collected information could describe more than one person | `engine/src/ambiguity.ts` | — | **unverified** | Module exists; **no dedicated test** |
| 14 | If ambiguous, identify the missing distinguishing evidence and stop the gate | `engine/src/ambiguity.ts`, `readiness.ts` | — | **unverified** | Not verified against the document this session |
| 15 | Important facts support dates/periods; maintain freshness and detect possible change | `db/src/repos-sources.ts`, `deploy/src/monitoring.ts` | — | **unverified** | Monitoring module exists; freshness detection not verified |
| 15 | Detected changes presented for user review before becoming authoritative | `web/src/components/review-queue.tsx`, `api/review/route.ts` | — | **unverified** | Review queue exists; not exercised in browser |
| 16 | Model the person as a connected entity graph, not a flat field list | `engine/src/graph.ts` | — | **unverified** | Module exists; graph shape not verified this session |
| 16 | Every relationship carries provenance, status and supporting evidence | `engine/src/graph.ts` | — | **partial** | Relationship records exist; provenance attachment unverified |
| 17 | Full final analysis before publication; a hard gate over the questions listed in §17 | `engine/src/readiness.ts` | `readiness.test.ts` | **partial** | Second-pass questions surfaced in the report |
| 17 | Never tell users the platform knows Google's private Knowledge Graph state | `core/src/product-language.ts` | `product.test.ts` | **complete** | Explicitly forbidden by the guard and covered by tests |
| 18 | After corrections, re-review the entire entity from the beginning, not just the corrected field | `engine/src/readiness.ts` | `readiness.test.ts` | **partial** | Whole-entity second pass implemented; verified only by unit tests |
| 19 | 100% means complete and coherent per the Nexora Entity standard; a blocking issue means no publish and no pass | `engine/src/readiness.ts` | `readiness.test.ts` (29) | **complete** | `e2e:engine` reports 96% BLOCKED with the gate refusing to pass |
| 19 | Identify the exact blocking issue and where it came from | `engine/src/readiness.ts`, `readiness-board.tsx` | `readiness.test.ts` | **complete** | Issues carry source, detail and action |

## Part 3 — Public website, hosting, UI, errors and security (doc §20–§30)

| Doc § | Requirement | Module | Test | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 20 | Generated website is polished, beautiful, responsive, accessible, logically arranged; an entity hub not a generic portfolio | `entity-site/src/design-system.css`, `components.tsx`, `compose.ts` | `compose.test.ts` (23) | **partial** | Composer omits/collapses absent sections; appearance unverified in browser |
| 21 | Person/ProfilePage structured data: name, alternateName, image, sameAs, description, stable id, canonical, sitemap, robots, metadata, OG, clean URLs, crawlable pages and images | `engine/src/structured-data.ts`, `entity-site/src/meta.ts` | — | **partial** | `structuredData.image` defect fixed; **no dedicated test file** |
| 21 | Use structured data accurately; never assert facts that failed verification | `engine/src/structured-data.ts` | — | **unverified** | Not verified against the document this session |
| 22 | Stable internal entity identifier surviving username/domain/handle changes | `db/src/repos-core.ts`, `core/src/primitives.ts` | — | **unverified** | Not verified this session |
| 22 | One canonical identity URL per entity; alternates must not compete | `entity-site/src/meta.ts`, `deploy/src/site-builder.ts` | — | **unverified** | Not verified this session |
| 23 | Discovered information is never automatically published as fact; show a review item with Accept/Reject | `web/src/components/review-queue.tsx` | — | **partial** | Review queue implemented; not exercised in browser |
| 24 | Publish after the 100% gate without the user owning GitHub or Vercel | `deploy/src/deploy.ts`, `vercel.ts`, `platform-host.ts` | — | **partial** | Gate enforced inside `deployEntity`; Vercel path unverified (no credential available) |
| 25 | A user without a domain still receives a public live website at a platform URL | `deploy/src/platform-host.ts`, `web/src/app/e/[slug]` | — | **partial** | Platform-host path exists; a live public URL has never been confirmed |
| 25 | Custom-domain connection flow offered where the user owns a domain | `deploy/src/domains.ts` | — | **unverified** | Module exists; flow not exercised |
| 26 | Multi-tenant hosting: domain routing, tenant isolation, caching, security, build failures, rollbacks, scaling | `deploy/src/platform-host.ts`, `deploy.ts`, `domains.ts` | — | **partial** | Architecture present; not proven under load |
| 27 | After publication the user can add or update jobs, projects, organisations, press, photos, websites, profiles, aliases, biography | `web/src/app/app/stages/[slug]`, `api/stages/route.ts` | — | **partial** | Stages editable; post-publication journey unverified |
| 27 | Updates trigger revalidation; connected sources periodically checked and changes flagged | `deploy/src/monitoring.ts`, `api/cron/route.ts` | — | **unverified** | Cron route exists; README does not yet document it (P3 item 8) |
| 29 | Never lose user-entered information because of an AI/provider error; autosave; safe resume | `api/stages/route.ts`, `core/src/errors.ts` | `errors.test.ts` | **partial** | Autosave implemented; interruption/resume not exercised in browser |
| 29 | Differentiate user-data, source-access, AI provider, deployment and system errors | `core/src/errors.ts` | `errors.test.ts` (14) | **complete** | Error taxonomy carries domains and non-empty remediation |
| 29 | Actionable explanations; never claim a source was checked if it could not be | `core/src/errors.ts`, `inspect/src/inspect.ts` | `errors.test.ts`, `check:inspect` | **complete** | Credentials scrubbed from detail/cause |
| 29 | Never publish a blocked entity | `deploy/src/deploy.ts` | `readiness.test.ts` | **complete** | Gate enforced inside `deployEntity`, not only in the route |
| 30 | Protect credentials and security answers; no plaintext where avoidable | `db/src/auth-crypto.ts` | `auth-crypto.test.ts` (22) | **complete** | Salted scrypt hashing; case/space-insensitive verify |
| 30 | Do not expose provider API keys client-side; protect identity data and uploaded photos | `web/src/lib/server.ts`, `core/src/config.ts` | — | **unverified** | Server-only config kept out of the browser barrel; not audited this session |

## Part 4 — Product language, architecture and verification (doc §31–§40)

| Doc § | Requirement | Module | Test | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 31 | Must never promise or imply a Google Knowledge Panel, approval or endorsement | `core/src/product-language.ts` | `product.test.ts` (11 guard tests) | **complete** | 16 prohibited patterns with a disclaimer carve-out; assertion guard throws |
| 31 | Platform's 100% refers only to its own standard | `core/src/product-language.ts` (`readinessLabel`) | `product.test.ts` | **complete** | Label always names "ENTITY READINESS"; clamps out-of-range input |
| 32 | Designed around principles that help search engines understand the person as one entity | `engine/src/structured-data.ts`, `entity-site/src/meta.ts` | — | **partial** | Structured data present; never validated against live Google documentation |
| 33 | Modular, production-oriented architecture with clear boundaries and replaceable internals | all eight packages | `typecheck` exit 0 | **complete** | Boundaries enforced by tsconfig and the browser-safe barrel rule |
| 34 | Signup, login, entity creation, OpenCode integration, provider discovery/verification, AI operations, persistence, external checking, readiness, blocking, second pass, generation, deployment must actually function | across packages | `verify`, `smoke`, `check:bridge`, `check:inspect`, `e2e:engine` | **partial** | Signup/login verified in browser this session; **deployment cannot be closed in this environment** |
| 34 | Run lint/typecheck/tests/build **and real browser verification** before declaring completion | `package.json` | `ui:audit` | **outstanding** | Typecheck/test/build pass; **no lint config exists (P3 item 7)**; browser verification blocked on the Chromium download |
| 36 | Do not publish below 100% Entity Readiness; do not fabricate facts, sources or verification | `engine/src/readiness.ts`, `deploy/src/deploy.ts` | `readiness.test.ts` | **complete** | Gate refuses to publish below 100% |
| 37 | Definition of Done: the full end-to-end milestone | whole system | `e2e:engine` | **outstanding** | Blocked at 96% by provenance; no live public URL has ever been published |
| 39 | Audit the complete product against every section of the document | this file | — | **partial** | This matrix is that audit; it is not yet complete |

## Part 5 — Amendment 2.0

| A2 § | Requirement | Module | Test | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A2.1 | Public Entity Website uses one pre-designed, complete design system built into the platform; not newly designed per user | `entity-site/src/design-system.css`, `components.tsx`, `render.tsx` | `compose.test.ts` | **complete** | One stylesheet drives every person's site; no per-user CSS is generated |
| A2.2 | Compose dynamically: show sections with information, omit/collapse absent sections, keep the page balanced | `entity-site/src/compose.ts` | `compose.test.ts` (23) | **complete** | Composer decides which components render |
| A2.2 | Never create empty cards, awkward gaps, fake placeholder content or unfinished sections | `entity-site/src/compose.ts` | `compose.test.ts` | **complete** | Sections omitted rather than filled |
| A2.3 | Stage-by-stage flow: the user may fill, skip, continue and return | `web/src/app/app/stages/[slug]/page.tsx` | — | **partial** | Skip/return implemented; journey not verified in browser |
| A2.3 | SKIP does not mean satisfied; after skips, reason over the whole entity and identify materially necessary missing information | `engine/src/completeness.ts`, `readiness.ts` | `readiness.test.ts` | **partial** | Completeness engine reports material gaps; not verified this session |
| A2.4 | Stage content A–W complete | `core/src/stages.ts` | `product.test.ts` | **complete** | Registry test asserts A–W with no gaps |
| A2.5 | Portfolio is a first-class input: accept files, extract information, preserve provenance, let the user review | `inspect/src/portfolio.ts`, `api/entities/[id]/portfolio/route.ts` | — | **partial** | Route and parser exist; **no test file** |
| A2.5 | A portfolio does NOT satisfy the separate 5+ live website requirement | `inspect/src/qualify.ts`, `engine/src/readiness.ts` | `qualify.test.ts` | **complete** | Portfolio is user-provided evidence, not a qualifying website |
| A2.6 | Actually inspect supplied/connected websites and social/professional profiles, not merely store URLs | `inspect/src/inspect.ts`, `platforms.ts` | `html.test.ts`, `check:inspect` | **complete** | Real retrieval and parsing |
| A2.6 | Similar names alone are never sufficient to connect identities | `engine/src/identity.ts` | `identity.test.ts` | **complete** | Requires supporting evidence |
| A2.7 | Completeness engine continuously determines whether skipped information materially prevents understanding the person | `engine/src/completeness.ts` | — | **partial** | Module exists; **no dedicated test** |
| A2.8 | "Website generation" means populating the existing design system; do not ask an AI agent to invent a new site per user | `entity-site/src/compose.ts`, `deploy/src/render-process.ts` | `compose.test.ts` | **complete** | Out-of-process static renderer, shared by preview and publication |
| A2.9 | The verified provider/model becomes the account's active AI configuration until deliberately changed | `db/src/repos-ai.ts`, `engine/src/ai.ts` | — | **unverified** | Account-level AI repo exists; persistence not verified this session |
| A2.9 | Deterministic rules remain authoritative; AI cannot override evidence minimums, gates, auth, security, persistence or deployment | `engine/src/readiness.ts`, `deploy/src/deploy.ts` | `readiness.test.ts` | **complete** | Gate is deterministic code, not model output |
| A2.10 | Vercel remains the integrated deployment/hosting layer; users need no Vercel/GitHub account | `deploy/src/vercel.ts`, `platform-host.ts` | — | **unverified** | **Cannot be verified in this environment — no credential** |
| A2.11 | Live preview throughout the build, updating from the same pre-designed system, with intelligent omission | `web/src/components/live-preview.tsx`, `api/preview/[id]/route.ts` | — | **partial** | Preview route exists; **never verified in a browser at three breakpoints** |
| A2.12 | Second pass reassesses the whole entity across the listed questions | `engine/src/readiness.ts` | `readiness.test.ts` | **partial** | Questions surfaced in the report; not independently re-verified |
| A2.13 | Website quality non-negotiable: premium, not a generic template, plain profile or collection of empty cards | `entity-site/src/design-system.css` | — | **partial** | **Unverified — this is the core P0 claim and has never been seen in a browser** |
| A2.16 | Updated Definition of Done including live preview and return-to-update with revalidation | whole system | `e2e:engine`, `ui:audit` | **outstanding** | Blocked at 96%; no published live URL |

## Summary of counts

Measured from the rows above (91 requirement rows):

| Status | Meaning | Count |
| --- | --- | --- |
| complete | verified this session against the document | 35 |
| partial | mechanism exists but does not fully discharge the requirement | 28 |
| unverified | believed implemented, **not** checked against the document this session | 25 |
| outstanding | not implemented, or blocked | 3 |

`unverified` is a quarter of the matrix. That is the honest position: a large part of this
codebase has **never been checked line-by-line against the vision document**. §2.7 anticipates
exactly this — building the matrix is expected to reveal requirements that are only partially
implemented, and those must be recorded and scheduled rather than assumed sound.

## Open items carried forward

1. **P0 browser verification is not done.** `scripts/ui-audit.mjs` now exists and covers
   screenshots at 320/768/1440, keyboard traversal, WCAG contrast, reduced motion and 320px
   overflow, but it has **not yet been run successfully** — the Playwright Chromium download
   did not complete in this environment. Until it runs, §4.4 is unmet and no claim about
   appearance, focus order or contrast can be made.
2. **§28 / A2.13 design quality is unverified.** The design system exists and compiles
   (607-line `globals.css`, 1 100+ line `design-system.css`), which contradicts the handover's
   §4.1 claim that the application "renders as unstyled plain text" with "no design tokens of
   any kind". That claim is **not supported by the repository**. The genuine gaps found are
   narrower and are recorded in the §28 row.
3. **Typography is declared but never loaded.** `--font-sans` / `--font-display` name
   `'Inter var'` and `'Inter'`, but there is no `next/font` import and no `@font-face` anywhere
   in `packages/web` or `packages/entity-site`. The declared type system therefore silently
   falls back to Segoe UI. This is a real defect against §4.3.3 and A2.13.
4. **Palette is the Tailwind default.** `ink` mirrors Tailwind `slate` and `accent` is
   `#2563eb` (Tailwind `blue-600`). §4.3.1 asks for an original, immediately recognisable
   palette rather than a template's defaults.
5. **Hard-coded values in components.** Screens use inline styles such as
   `style={{ gap: '1.25rem' }}` and `style={{ fontSize: '1.6rem' }}`, which §4.3.2 forbids
   ("No hard-coded values in components").
6. **Provenance is the live blocker (§19).** `e2e:engine` reports 96% BLOCKED with zero
   blocking issues because no claim carries inspected-source provenance. Not investigated
   this session.
7. **No lint configuration** (P3 item 7), and the repository is **not under version control**,
   so §2.4's "same commit" rule cannot currently be honoured.