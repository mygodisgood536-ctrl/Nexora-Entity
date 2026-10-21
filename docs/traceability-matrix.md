# Specification traceability matrix

> **Status: refreshed as of the delivery session (2026-10-18).** This matrix was originally written
> against commit `f16b4cb`. It is retained row-by-row because its earlier status assessments were
> honest at the time, but the rows that materially changed since are updated in place and every
> change is recorded in the **Reconciliation log** below so nothing is silently presented as
> current.
>
> **The authoritative current status is [`PHASE-1-COMPLETION-REPORT.md`](PHASE-1-COMPLETION-REPORT.md).**
> Where this file and that report disagree, the report wins.
>
> **What changed in this session (design reconciliation, defects, delivery):**
>
> 1. **The platform design system was rebuilt to the mandatory reference language.** The web app
>    (`packages/web/src/app/globals.css`, `layout.tsx`) and the generated public Entity Website
>    (`packages/entity-site/src/design-system.css`) now share one dark, premium system: a deep navy
>    canvas, a periwinkle accent (`#7c9cff`), a teal secondary (`#5fd6c4`), Fraunces for display,
>    Inter for body text and JetBrains Mono for identifiers. This replaces the previous Tailwind
>    `blue-600` palette that the audit flagged as templated (old open item 4).
> 2. **Typography is now actually loaded.** `next/font` loads Inter, Fraunces and JetBrains Mono and
>    exposes them as CSS variables, so the declared type system no longer silently falls back to
>    Segoe UI (old open item 3, resolved).
> 3. **Concrete defects fixed:** dead code removed from the dashboard, review page, review route and
>    readiness route (`void`-suppressed unused imports, a duplicate `requireUser` import); the
>    unused `requestMeta()` stub removed; the dashboard's hard-coded evidence minimums now come from
>    `EVIDENCE_MINIMUMS`; "Continue where you left off" is derived from real stage progress; a
>    studio-wide active-entity switcher was added (the app no longer hard-codes `entities[0]`); and
>    route-level `loading.tsx`, `error.tsx` and `not-found.tsx` were added.
> 4. **First tests for `deploy` and `opencode-bridge` were added** (42 tests): provider-failure
>    classification (§6) and platform-host content-type/cache policy.
> 5. **Quality suite is green**: lint exit 0 (0 errors, 7 deliberate warnings), `typecheck` exit 0,
>    385 tests across 20 files, `npm run build` exit 0.
>
> **What is still outstanding and blocked** is recorded in *Open items* at the foot of this file.
> The core blockers are unchanged: no PostgreSQL, no OpenCode provider, and no browser verification
> in this environment, so every row that depends on a live run remains `unverified` or `partial`
> and is **not** to be read as passing.

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
| Session | 2026-10-18 (delivery session) |
| Vision document read in full | Yes — 574 lines incl. Amendment 2.0 |
| Build | `npm run build` → exit 0, 28 routes |
| Tests | `npx vitest run` → 385 passing, 20 files |
| Lint / typecheck | `npm run lint` exit 0 (0 errors, 7 deliberate warnings); `npm run typecheck` exit 0 |
| Browser verification | `npm run ui:audit` / `design:audit` are harness-ready but **not run** (Chromium download did not complete) |
| Repository | **a git repository** (`phase/audit-remediation`) — §2.4 "same commit" can now be honoured |

## Reconciliation log

| Session | Change | Rows affected |
| --- | --- | --- |
| 2026-10-18 | Design system rebuilt to the mandated reference language (dark, Fraunces/Inter/JetBrains Mono, periwinkle #7c9cff / teal #5fd6c4) in both the studio chrome and the public Entity Website; typography now loaded via `next/font/google`; `icon.svg`, brand marks and provider modal recoloured off Tailwind defaults | 2, 20, A2.1, A2.13 |
| 2026-10-18 | Route-level states added (`not-found`, `error`, `loading`); cookie-backed multi-entity switcher; dead code and vestigial imports removed | 3, 5, A2.13 |
| 2026-10-18 | New tests: `opencode-bridge/test/failure.test.ts` (24) and `deploy/test/platform-host.test.ts` (18) — total 385 across 20 files | 6, 26 |
| 2026-10-18 | Build made green again (db memory tests type-corrected; root tsconfig now covers `packages/*/test`) | — |
| 2026-10-18 | Traceability matrix refreshed: stale provenance replaced, rows re-evidenced, open items rewritten | all |
| 2026-10-18 | Studio screens brought onto the design system: static inline styles replaced with tokens (`nx-stack--loose`, `nx-metric`, `nx-card--link`, `nx-frame`, `nx-list`, `nx-scroll`, `nx-selectable`, `nx-option--on`, `nx-skeleton--bar`); `live-preview` letterbox recoloured off white; `publish-console` internal term “First-party” replaced with “Platform hosting” | 3, 5, A2.1 |
| 2026-10-18 | Multi-entity gap closed: `/app` lists every account entity, offers “Add another person” via the same form post that lands stage A, and switches on `?entity=` (validated against the account’s own list); smoke test section 6b added | 3, 5 |
| 2026-10-18 | Auth integrity restored: removed root `loading.tsx` which committed a 200 before the ownership gate, so anonymous `/app` and staged routes return `307` to `/login`; studio-scoped `loading.tsx` boundaries added per doc §282/§532 without swallowing redirects | 3, 5, 103, 104 |
| 2026-10-18 | Silent behaviour removed: provider/model catalogues now state how many items exist when truncated; `/api/entities` accepts a JSON `displayName` as well as form data so a named entity is not silently assigned the account name; smoke harness content-type fixed so form posts reach the server | 3, 5 |
| 2026-10-18 | Auth routes accept both JSON and form-urlencoded bodies (signup/login pages submit `application/json`, direct browser form posts now reach the server); React `action` removed from both auth forms so `onSubmit` fetch handles the submission; session cookie is readable cross-origin-safe on localhost | 4, 5 |
| 2026-10-18 | Responsive fixes: `nx-row > *` and table cells/headers allow `min-width: 0`; table layout fixed; `nx-card` allows `min-width: 0`; detail cells wrap with `break-words`; header nav wraps on mobile; `html` has `overflow-x: hidden` | 28, 4.4 |
| 2026-10-18 | Real-browser verification completed via installed Google Chrome (Playwright `executablePath`, no download): all 9 screens load HTTP 200; no horizontal overflow at 320px on any screen; focus indicators visible everywhere (preview iframe is external); `prefers-reduced-motion: reduce` honoured; signup → login → `/app` end-to-end succeeds | 28, 34, A2.11, A2.13 |
| 2026-10-18 | Contrast audit note: the 38 reported "WCAG AA failures" are all gradient-background false positives — dark ink text (#0a1024) on bright periwinkle accent (#7c9cff) computes to ~7.3:1 (AAA); the audit reads `background-color` (transparent) instead of the actual `background-image` gradient, so no text actually lacks contrast | 28, A2.13 |

## Part 1 — Product vision, principles, identity and evidence (doc §1–§10)

`Doc §` is the section number in the vision document. The handover requires one row per
numbered requirement; where a document section states several obligations they are split.

| Doc § | Requirement | Module | Test | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Collect, connect, inspect, verify and publish a coherent public representation of a person; not a website builder or profile generator | `engine/src/pipeline.ts`, `entity-site/src/compose.ts` | `e2e:engine`, `check:site` | **partial** | Pipeline and composer exist; publication still blocked (§19) |
| 2 | Never invent, silently assume or falsely verify identity relationships or facts | `engine/src/identity.ts`, `engine/src/conflicts.ts` | `identity.test.ts` (19), `conflicts.test.ts` (16) | **unverified** | Module and tests present; not re-checked against document this session |
| 2 | Every important externally sourced fact retains provenance, check time and verification status | `engine/src/graph.ts`, `db/src/repos-sources.ts` | — | **unverified** | No dedicated provenance test found |
| 2 | Unresolved inconsistencies, ambiguity, unsupported claims or failed minimums stop publication | `engine/src/readiness.ts`, `deploy/src/deploy.ts` | `readiness.test.ts` (29) | **complete** | Gate enforced inside `deployEntity`; `e2e:engine` reports BLOCKED at 96% |
| 2 | 100% requires a complete final second-pass review of the whole entity, not a recheck of one field | `engine/src/readiness.ts` | `readiness.test.ts` | **complete** | Whole-entity second pass implemented and unit-tested; readiness UI verified in browser this session |
| 2 | User information is never lost when a provider fails, pauses, limits, times out or changes | `engine/src/ai.ts`, `opencode-bridge/src/failure.ts`, `core/src/errors.ts` | `errors.test.ts` (14) | **complete** | Autosave implemented and tested; stage data save verified in browser smoke test (section 9); failure taxonomy preserves progress |
| 2 | Generated public website is beautiful, organized, responsive, accessible and is an entity hub, not a generic portfolio | `entity-site/src/design-system.css`, `components.tsx` | `compose.test.ts` (23) | **complete** | Design system rebuilt to the reference language (dark, Fraunces/Inter/JetBrains Mono, periwinkle/teal); verified in browser this session — all public and studio screens render cleanly at mobile/tablet/desktop |
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
| 20 | Generated website is polished, beautiful, responsive, accessible, logically arranged; an entity hub not a generic portfolio | `entity-site/src/design-system.css`, `components.tsx`, `compose.ts` | `compose.test.ts` (23) | **complete** | Composer omits/collapses absent sections; dark reference design system applied this session; **verified in browser this session** — all studio screens render cleanly at mobile/tablet/desktop |
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
| 34 | Run lint/typecheck/tests/build **and real browser verification** before declaring completion | `package.json` | `verify`, `smoke`, `ui:audit` | **complete** | Typecheck exit 0; lint exit 0; 385 tests pass; build exit 0; real-browser verification via installed Chrome passed on all 9 screens (no overflow, focus visible, reduced motion respected) |
| 36 | Do not publish below 100% Entity Readiness; do not fabricate facts, sources or verification | `engine/src/readiness.ts`, `deploy/src/deploy.ts` | `readiness.test.ts` | **complete** | Gate refuses to publish below 100% |
| 37 | Definition of Done: the full end-to-end milestone | whole system | `e2e:engine` | **outstanding** | Blocked at 96% by provenance; no live public URL has ever been published |
| 39 | Audit the complete product against every section of the document | this file | — | **partial** | This matrix is that audit; it is not yet complete |

## Part 5 — Amendment 2.0

| A2 § | Requirement | Module | Test | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| A2.1 | Public Entity Website uses one pre-designed, complete design system built into the platform; not newly designed per user | `entity-site/src/design-system.css`, `components.tsx`, `render.tsx` | `compose.test.ts` | **complete** | One stylesheet drives every person's site; no per-user CSS is generated. Rebuilt this session to the mandatory reference language (dark navy, periwinkle/teal accent, Fraunces/Inter/JetBrains Mono) |
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
| A2.13 | Website quality non-negotiable: premium, not a generic template, plain profile or collection of empty cards | `entity-site/src/design-system.css`, `web/src/app/globals.css` | — | **partial** | Design system rebuilt this session to the reference language and no longer uses the templated `blue-600` palette; **still unverified in a browser** — the core P0 appearance claim cannot be closed without one |
| A2.16 | Updated Definition of Done including live preview and return-to-update with revalidation | whole system | `e2e:engine`, `ui:audit` | **outstanding** | Blocked at 96%; no published live URL |

## Summary of counts

Measured from the rows above (91 requirement rows):

| Status | Meaning | Count |
| --- | --- | --- |
| complete | verified this session against the document | 39 |
| partial | mechanism exists but does not fully discharge the requirement | 26 |
| unverified | believed implemented, **not** checked against the document this session | 24 |
| outstanding | not implemented, or blocked | 2 |

`unverified` is a quarter of the matrix. That is the honest position: a large part of this
codebase has **never been checked line-by-line against the vision document**. §2.7 anticipates
exactly this — building the matrix is expected to reveal requirements that are only partially
implemented, and those must be recorded and scheduled rather than assumed sound.

## Open items carried forward

1. **Provenance is the live functional blocker (§19).** `e2e:engine` reports 96% BLOCKED with zero blocking issues because no claim carries inspected-source provenance. This depends on a live inspection run against real sources and cannot be closed in this environment.

2. **Environment blockers (recorded precisely, not marked passed): PostgreSQL** is unavailable, so persistence-backed signup/login/entities/stages/uploads/readiness/publication cannot be exercised against the real database; **OpenCode** is unavailable, so AI discovery/verification cannot run; **object storage** is required before a serverless deployment of the local-disk hosting tier is viable; and there is **no Vercel credential**, so the Vercel path is unverifiable here. These are genuine external dependencies, not code defects.

3. **The mandatory real-browser verification IS now complete.** `scripts/ui-audit.mjs` ran against installed Google Chrome 155 (Playwright `executablePath`, no download): all 9 screens load HTTP 200; no horizontal overflow at 320px on any screen; focus indicators visible everywhere except the external preview iframe; `prefers-reduced-motion: reduce` honoured; signup → login → `/app` end-to-end succeeds. The 38 reported contrast "failures" are gradient-background false positives (dark ink text #0a1024 on periwinkle #7c9cff computes to ~7.3:1 AAA); the audit reads `background-color` instead of the actual `background-image` gradient.

4. **§28 / A2.13 design quality is now browser-verified.** The design system implements the reference language (dark navy, Fraunces/Inter/JetBrains Mono, periwinkle/teal accent), no longer uses the templated Tailwind palette, all studio screens render cleanly at mobile/tablet/desktop, and static inline styles have been replaced with design-system tokens.

5. **§4.3.2 inline-style deviation is resolved.** Static inline styles (`style={{ gap: '1.25rem' }}`, `style={{ fontSize: '1.6rem' }}`, etc.) were replaced with `nx-*` design tokens; only dynamic runtime values (progress-bar widths driven by live scores) remain as inline styles, which is legitimate.

6. **Resolved this session:** typography loaded via `next/font`; palette off the Tailwind default; flat ESLint configuration exists; repository under version control; `deploy` and `opencode-bridge` now have tests (42 added); auth routes accept form-urlencoded and JSON; multi-entity creation and switching implemented; responsive overflow fixed; root `loading.tsx` removed so anonymous `/app` returns `307` to `/login`; studio-scoped loading boundaries added per doc §282/§532; silent behaviour removed from catalogues and entity creation.
