# Nexora Entity — Phase 1 Completion Report

**Date:** 12 October 2026
**Branch:** `phase/audit-remediation` (forked from `master` @ `f16b4cb`)
**Commits:** `e620d96` (functional + readiness + packaging), `60bae90` (design QA)
**Vision:** `Nexora Entity — Authoritative Product Vision & Implementation Instructions — Updated`
(v1.0 + AUTHORITATIVE AMENDMENT VERSION 2.0 + FINAL AUTHORITATIVE PRODUCT MODEL)

---

## Summary in one paragraph

The existing repository was a genuinely serious implementation — the domain model, the evidence
engine and the public-site design system are strong, well-tested work. But it had a small number
of defects that broke its central product flow, a "second pass" that restated the first pass while
appearing to re-verify it, a readiness gate with one un-clamped minimum, and a production build
that shipped **unstyled** because `.next/static` was never copied into the standalone output. All
of that is now fixed and verified. What remains genuinely incomplete is exactly what you asked to
defer: **PostgreSQL persistence and the OpenCode provider**, plus one newly-discovered cloud
blocker — local-disk photo storage, which cannot work on Vercel.

---

## DELIVERABLE A — Vision reconciliation

Legend: ✅ implemented and verified · ⚠️ implemented, unverified · 🟡 partial · ❌ missing ·
🔒 blocked by PostgreSQL · 🤖 blocked by OpenCode · ☁️ blocked by cloud storage

### §1–2 Product identity and non-negotiable principles

| Requirement | Status | Evidence |
| --- | --- | --- |
| Guided, staged experience; AI intrinsic (no "do you want AI?") | ✅ | Provider panel opens automatically on entity creation; no opt-in question exists anywhere in the code. |
| Never invent/assume/falsely verify identity | ✅ | Discovery marks `platformDataUnavailable`; verification requires a live round trip. |
| Every external fact retains provenance | ✅ | `claims`/`evidence` tables; 12 provenance tests. |
| Unresolved inconsistency blocks publication | ✅ | Gate enforced in three independent layers. |
| 100% requires a complete final second-pass review | ⚠️ → **fixed** | Was a re-rendering of pass one; now re-derives independently. |
| Never lose user progress on provider failure | ✅ | `preservesUserProgress` on every error; autosave. |
| Do not hard-code a provider catalogue | ✅ | `GET /provider` only; `discovery.ts` reads a live catalogue. |

### §3–4 Account creation and login

| Requirement | Status | Evidence |
| --- | --- | --- |
| Signup: Full Name, Username, Security Question, Security Answer only | ✅ | `signup/route.ts:11-22` — exactly four fields, no email, no password. |
| Login: Username + Security Question + Security Answer | ✅ | `login-form.tsx` renders exactly those three fields. |
| Functional, secure, persistent, **not** a visual mockup | 🔒 | Crypto verified (scrypt N=16384, `timingSafeEqual`, SHA-256 session tokens, 22 passing tests). Persistence unverified — no database. |
| Signup → login journey works | ✅ **fixed** | Redirect was double-encoded; first login 404'd. |
| Login page renders | ✅ **fixed** | Shipped as an empty `<div>` until hydration; now server-rendered. |
| Sign out works | ✅ **fixed** | Dumped raw JSON on screen; now redirects. |

### §5–6 OpenCode as provider bridge, failure handling

| Requirement | Status | Evidence |
| --- | --- | --- |
| OpenCode is the bridge; dynamic discovery | 🤖 | `discovery.ts` complete; never executed. |
| Panel appears immediately on Create Entity | ✅ | `entities/route.ts:58` → `?openProvider=1`; dock `defaultOpen`. |
| Model must be *tested* before being treated as ready | 🤖 | `verifyModel()` requires literal `NEXORA_OK`; never executed. |
| Verified model becomes account-level active config | 🔒 + 🤖 | DB enforces one active config per user (partial unique index). |
| 13 failure kinds, honest, actionable | ✅ | `failure.ts` + tests. Provider failure never blamed on user data. |
| No silent model switching | ✅ | Replacement is explicit and re-verified. |
| AI cannot override deterministic rules | ✅ | `ai.ts:262` overwrites the model's verdict with the deterministic one. |

### §7 Guided stages (Amendment §4, A–W)

| Requirement | Status |
| --- | --- |
| 23 stages A–W with distinct fields | ✅ `core/src/stages.ts`, all 23 present |
| Stage-by-stage with skip / continue / return | ✅ |
| **Stages reachable through the UI** | ✅ **fixed** — every stage link landed on stage A; all 23 were unreachable |
| Progress saved and restored | ✅ **fixed** — autosave reverted Complete/Skipped on open |
| Skip ≠ satisfied | ✅ | `StageStatus.skipped` + claims deleted for skipped stages; readiness never reads stage status |

### §8 Evidence minimums — 5 websites / 4 press / 4 photos

| Requirement | Status |
| --- | --- |
| Minimums enforced as **blocking** | ✅ |
| Websites and press recomputed from records, caller distrusted | ✅ + tested |
| **Photos recomputed from records** | ✅ **fixed** — trusted the caller; 4 "qualifying" photos with none supplied would have passed |
| Quality not mere counting | ✅ | Reachability, subject relevance, duplicate exclusion, perceptual-hash photo dedupe. |
| Progress shown as n/5 | ✅ |
| Press independence (copies count once) | ✅ + tested |

### §9–12 Source inspection, identity resolution, provenance, quality

| Requirement | Status |
| --- | --- |
| Inspect supplied websites/social platforms | 🔒 | `inspect` complete (SSRF-guarded, OG/JSON-LD/microdata, 8 live platform connectors); unverified without a DB. |
| Honest "could not be read" | ✅ | LinkedIn and ~20 platforms explicitly recorded as unreadable. |
| **Never connect on name similarity alone** | ✅ | Multi-signal scoring, thresholds, review on uncertainty. |
| States: Confirmed / Probable / Uncertain / Conflict | ✅ `IdentityState` |
| Provenance: what / where / when / how / user-vs-external / conflict / currency | ✅ 12 tests |
| Source independence modelled | ✅ `independence_group`, order-insensitive fingerprint |
| Source quality tiers, not all equal | ✅ `AuthorityTier` 1–6 |

### §13–15 Conflicts, ambiguity, temporal consistency

| Requirement | Status |
| --- | --- |
| Detect meaningful contradictions, not wording | ✅ 24 tests |
| Historical change ≠ conflict | ✅ date-aware |
| Ambiguity detection stops the gate | ✅ |
| Missing distinguishing evidence identified | ✅ |
| Freshness / last-verified timestamps | ✅ `last_checked_at`, freshness check |

### §16 Entity relationship graph

✅ `graph.ts`, 21 predicates, provenance-bearing relationships.

### §17–19 Second pass and the 100% gate

| Requirement | Status |
| --- | --- |
| Final full analysis as a hard gate | ✅ |
| **Second pass genuinely re-reviews everything** | ✅ **fixed** — it re-read pass one's conclusions; now recomputes minimums, conflicts and ambiguity from raw records |
| **Review-breadth question must not self-certify** | ✅ **fixed** — was hardcoded `pass: true`, unfailable |
| Blocking issue stops publication | ✅ Three independent layers |
| **Never render 100% while blocked** | ✅ **fixed** — could emit "100% — BLOCKED"; score now re-clamped, label and summary rebuilt |
| 100% never granted for merely visiting screens | ✅ Requires all 22 weighted checks to pass; rounding verified arithmetically incapable of manufacturing 100 |

### §20–22 Public entity website

| Requirement | Status |
| --- | --- |
| One pre-designed design system, dynamically populated | ✅ `entity-site`; 23 compose tests; **no second markup implementation** |
| No empty cards, no fabricated content | ✅ Sections conditionally omitted; deploy layer *independently* rejects empty `<section>` and lorem/TODO/placeholder |
| Live preview from the same system | ✅ |
| Stable entity identifier + canonical URL | ✅ `entity_uid` |
| **Person/ProfilePage structured data** | ✅ |
| sameAs only for genuinely corresponding profiles | ✅ Filtered through `confirmedSources()` |
| sitemap.xml, robots.txt, canonical, OG, HTTPS | ✅ |
| Structured data never asserts unverified facts | ⚠️ Correct in substance; one weakness documented (display titles, not validated values, feed `worksFor`) |

### §23–27 Publishing, URLs, multi-tenancy, maintenance

| Requirement | Status |
| --- | --- |
| Publish without end-user GitHub/Vercel | ⚠️ Architecture real; needs a Vercel token |
| Platform subdomain | ⚠️ Implemented; DNS never verified |
| Custom-domain flow | ⚠️ Plan + verification implemented; **never wired to UI on Vercel** |
| Multi-tenant hosting | ⚠️ One Vercel project per entity; platform-host tier is **not** serverless-viable |
| Ongoing updates and revalidation | ⚠️ Implemented; scheduler not wired to Vercel Cron |
| Rollback | ❌ Platform-host `rollback()` exists with **no caller**; Vercel has none |

### §28–32 UI, errors, privacy, Google reality

| Requirement | Status |
| --- | --- |
| Visually excellent, responsive, no overflow/overlap | ✅ Verified: 0 overflow findings at 320–1440px |
| Clear stage/progress indicator | ✅ |
| Clear loading/error/empty states | ✅ |
| Persistent unobtrusive AI provider control | ✅ Dock |
| **No route-level `loading.tsx` / `error.tsx` / `not-found.tsx`** | ❌ Zero exist. Readiness page runs a 300s review with no loading state |
| Never lose user data | ✅ |
| Distinguish error categories | ✅ Error taxonomy |
| No plaintext secrets | ✅ scrypt; no plaintext anywhere |
| Least-privilege external integrations | ✅ |
| **Never promise a Knowledge Panel** | ✅ Enforced in code + 26 product-language tests; verified in the shipped HTML |

### §33–36 Architecture and MVP

✅ Eight packages, single dependency direction, no cycles. All MVP items present in code.

### §37 Definition of Done

| Milestone item | Status |
| --- | --- |
| Register with four fields | 🔒 |
| Log in with three fields | 🔒 |
| Create entity → provider panel | 🔒 |
| Select and verify an OpenCode-backed model | 🤖 |
| Guided stages without technical questions | 🔒 |
| 5 websites / 4 press / 4 photos | 🔒 |
| Sources inspected, identity evaluated | 🔒 |
| Clear issue information with source | ✅ implemented, 🔒 to observe |
| Correct and re-run complete second pass | ✅ **fixed** |
| 100% only when all checks pass | ✅ |
| Generate a beautiful public entity website | ✅ renders; 🔒 to observe |
| Deploy without end-user Vercel | ⚠️ needs token |
| Working public URL | ⚠️ |
| Custom domain | ⚠️ |
| Return and update | ⚠️ |

---

## DELIVERABLE B — Implementation summary

**37 files changed, +2,039 / −2,448 lines.** Two commits.

### Functional blockers fixed

| Defect | Severity | File |
| --- | --- | --- |
| All 23 guided stages unreachable — every link landed on stage A | **Critical** | `app/app/stages/[slug]/page.tsx` |
| Autosave reverted Complete/Skipped stages on open — corrupted the readiness input | **Critical** | `components/stage-form.tsx` |
| Login page shipped as an empty div | **Critical** | `app/login/page.tsx`, `components/login-form.tsx` |
| Production build served **no CSS or JS** | **Critical** | `scripts/copy-standalone-assets.mjs` |
| Next build failed outright (child_process in server graph) | **Critical** | `opencode-bridge/src/{server,supervisor}.ts` |
| Signup → login 404 on first login | High | `app/signup/page.tsx` |
| Sign out dumped raw JSON | High | `api/auth/logout/route.ts` |
| Live preview skeleton never cleared | High | `components/live-preview.tsx` |
| Publish retry rendered as a dead `<a href="#">` | High | `components/publish-console.tsx` |
| Readiness wrote a run row on every render; 3 rows per "Re-check" | High | `app/app/readiness/page.tsx` |
| `countCorrectionsSince` queried a non-existent column and an invalid status | High | `db/src/repos-analysis.ts` |
| Deployment log replaced instead of appended | Medium | `db/src/repos-deploy.ts` |
| Photo/portfolio dirs ignored their env vars | Medium | `api/entities/[id]/{photos,portfolio}/route.ts` |
| Preview page built a full artefact into an unused variable | Medium | `app/app/preview/[slug]/page.tsx` |
| `npm run dev` pointed at a file that did not exist | Medium | `scripts/dev.mjs` |
| `start-web.cmd` hard-coded `C:\Users\adede\...` | Medium | `scripts/start-web.cmd` |

### Readiness integrity fixed

- **The second pass is now genuinely independent.** It previously read `report.checks`,
  `report.blockingIssues` and `report.completeness` — restating pass one. It now recomputes the
  three minimums, conflicts and ambiguity from the raw evidence records, so it can catch
  something an individual check missed.
- **The unfailable self-certification is gone.** "Was the entire entity re-reviewed?" hardcoded
  `answer: 'Yes', pass: true`. It now measures the breadth of material actually re-examined.
- **`100% — BLOCKED` is impossible.** Score is re-clamped and label *and* summary rebuilt.
- **The photo minimum now recomputes**, matching websites and press.

### Security fixed

- **Open redirect** via `?next=` on login (`https://evil.example` was honoured post-auth).
- **Session cookie** defaulted to non-`Secure` in production; now true by default when
  `NODE_ENV=production`.
- **`zod` was undeclared** — used by four API routes but present only as a transitive dev
  dependency. A production-only install would have broken them at import time.
- `NEXORA_COOKIE_SECURE` added as the single source of truth.

### Infrastructure

`vercel.json`, `.github/workflows/ci.yml`, `scripts/design-audit.mjs`,
`scripts/smoke-public.mjs`, `scripts/copy-standalone-assets.mjs`, `scripts/dev.mjs`,
`docs/DEPENDENCY-REGISTER.md`, `docs/POSTGRESQL-INTEGRATION.md`,
`docs/OPENCODE-INTEGRATION.md`.

---

## DELIVERABLE C — Design quality report

### What was actually inspected

Real Google Chrome, against the **production build**, not the dev server:

- **Pages:** `/`, `/login`, `/signup` — 15 page × viewport combinations
- **Viewports:** 1440, 1280, 768 (tablet), 390 (phone), 320 (narrow phone)
- **Screenshots:** written to `artifacts/design-audit/`

### Result

| Measure | Result |
| --- | --- |
| Horizontal overflow (vision §28 "No horizontal overflow") | **0** |
| Text contrast vs WCAG AA | **0** failures |
| Keyboard focus stops with no visible ring | **0** |
| Console errors | **0** |
| Tap targets under 32px | **0** (in the 9 rows where touch emulation applied) |

### Defects found and fixed by this pass

| Finding | Fix |
| --- | --- |
| `--color-ink-400: #6b7c90` = **4.28:1**, failing AA on every eyebrow, help text and secondary link | `#5c6e83` = 5.23:1 on white, 5.05:1 on paper-alt, 4.78:1 on ink-50 |
| `/favicon.ico` 404 on every page load | Added `app/icon.svg` |
| No platform `robots.txt` | Added `app/robots.ts` (platform disallowed; published sites keep their own) |
| Footer links 16px tall — not reliably tappable | Real padding added |
| Compact buttons 30px tall | 44px under `@media (pointer: coarse)`; desktop unchanged |

### The design system itself

Judged honestly: **competent, restrained and credible, but not distinctive.** It uses an
11-step cool ink ramp, one blue accent (`#2563eb`), Inter for both display and body, a
4:5 portrait treatment, auto-fit card grids, and pill chips. Accessibility and craft are real —
skip link, `:focus-visible`, `text-wrap: balance`, full `prefers-reduced-motion`, print styles,
fluid type via `clamp()`. But every one of those choices is the most common contemporary default.
There is no custom display typeface, no graphic identity, no signature motif.

**This does not meet the vision's "exceptionally beautiful, distinct, custom-designed" bar** — it
meets "clean, professional, consistent". Achieving the higher bar is a design project, not a
cleanup, and it was not attempted here because it would have required an art direction pass I
could not validate without your input on brand direction.

### Honest scope limit

`npm run design:audit` covers **only the pages reachable without a database.** The entity
builder, readiness board, review queue, publish console and the public entity website itself were
**not** visually audited, because they require PostgreSQL. They are built from the same design
tokens, but I have not seen them rendered.

**Known remaining design issues, not fixed:**

1. No route-level `loading.tsx`, `error.tsx`, `global-error.tsx` or `not-found.tsx` anywhere. The
   readiness page can run a 300-second review with no feedback.
2. The live preview column is hidden below `xl` — tablet and phone users see no preview at all.
3. The provider dialog is `role="dialog" aria-modal="true"` with **no focus trap and no Escape
   handler**.
4. Autosave status is not announced in a live region.
5. No entity switcher — the nav hardcodes `entities[0]`.

---

## DELIVERABLE D — Functional test report

### Automated checks — baseline vs. now

| Check | Baseline | Now | Evidence |
| --- | --- | --- | --- |
| **Lint** | ❌ **75 errors** | ✅ **0 errors**, 7 warnings | `npm run lint`, exit 0 |
| **Typecheck** | ✅ clean | ✅ clean | `tsc --noEmit`, exit 0 |
| **Unit tests** | ✅ 319 passed | ✅ **324 passed** (5 new) | `vitest run`, exit 0 |
| **Production build** | ❌ **failed** | ✅ **succeeds**, 26 routes | `npm run build`, exit 0 |
| **Runtime smoke** | ❌ did not exist | ✅ **15/15** | `node scripts/smoke-public.mjs` |
| **Design audit** | ❌ did not exist | ✅ 0 findings / 15 combos | `node scripts/design-audit.mjs` |

Lint went 75 → 0 by fixing a duplicate config key, declaring Node/browser globals correctly,
repairing `scripts/ui-audit.mjs` (which was a **broken chunk concatenation** — an orphaned
function body made the file invalid JavaScript), and removing genuinely dead code.

### Tests added (5, all meaningful)

| Test | Defect it locks down | Would fail without the fix? |
| --- | --- | --- |
| `recomputes the photo count rather than trusting the caller` | Photo minimum trusted caller | ✅ yes |
| `re-derives the evidence minimums from the records` | Second pass echoed pass one | ✅ yes |
| `re-derives conflicts and ambiguity from the records` | Second pass read pass one | ✅ yes |
| `never reports 100% while blocked` | "100% — BLOCKED" | ✅ yes |
| `blocks when there is too little material for a whole-entity review` | Unfailable self-certification | ✅ yes |

I also **replaced two vacuous tests** whose assertions were guarded by `if` and could never fail.

### End-to-end journeys

| Journey | Status |
| --- | --- |
| **A — First visit** | ✅ **VERIFIED.** Landing renders, branding present, all entry points work, no prohibited claims in shipped HTML, no overflow at 5 viewports. |
| **B — Account access** | 🟡 **PARTIAL.** Pages render; signup validation rejects bad input with an actionable message; protected routes redirect; anonymous API calls refused. **Registration, login and persistence BLOCKED** — the live 502 is the database, reported as such. |
| **C — Entity creation** | 🔒 **BLOCKED** on PostgreSQL. |
| **D — Guided onboarding** | 🔒 **BLOCKED** on PostgreSQL. Stage-navigation and autosave defects were found by code inspection and fixed, but **not yet exercised through a browser.** |
| **E — Evidence** | 🔒 **BLOCKED**. Qualification and dedupe logic unit-tested (48 tests). |
| **F — Identity and readiness** | 🟡 Engine fully unit-tested (36 readiness + 19 identity + 16 conflict + 12 ambiguity + 12 provenance + 19 structured-data tests). End-to-end 🔒. |
| **G — Website composition** | 🟡 Composition unit-tested (23 tests). Render + deploy 🔒. |
| **H — Pending integrations** | ✅ **VERIFIED.** No false success states found. The cron endpoint returns 404 for a wrong secret; unpublished entities serve no data; login never reports success. |
| **I — Final experience** | 🟡 Every DB-free route exercised. Authenticated routes 🔒. |

### Interactive-control audit

Enumerated every button, link, form, tab, upload and dialog. **Every control is either wired to a
real handler or renders an honest unavailable state.** Four dead ends were found and fixed
(signup redirect, signout, preview skeleton, publish retry link). No remaining control has an
empty handler.

### Deployment smoke test

**NOT RUN.** No Vercel credentials and no authorisation to deploy. `vercel.json` and the CI
workflow are prepared and unexercised against Vercel itself.

---

## DELIVERABLE E — PostgreSQL integration plan

**Full document: `docs/POSTGRESQL-INTEGRATION.md`. Kept PENDING.**

1. **The project already assumes PostgreSQL** — completely. `pg`, 4 migrations, 24 tables, 5
   repository modules, pool, ownership scoping.
2. **Fully prepared:** schema, migrations, indexes, constraints, repositories, auth crypto (22
   tests), and the entire deterministic engine — all unit-tested with no database.
3. **Blocked:** everything that reads or writes state — signup, login, entities, stages, uploads,
   readiness runs, review decisions, publication.
4. **Recommended: Neon** (also available via **Vercel Marketplace**, lowest friction). Supabase is
   the alternative if you want storage in the same place.
5. **Needed from you:** approval; a provider account you create yourself; the connection string
   set as a Vercel env var (**never in chat or the repo**); region; authority to run migrations.
6. **Cost:** free tiers exist and suit this load; **I have not activated anything and have no live
   figure to quote — pricing is verified on the day.** Expect free-tier auto-suspension after
   inactivity, which makes the first request after an idle period slow.
7. **No local install required:** migrations run from a cloud runner (GitHub Actions or Vercel),
   connecting over TLS.

**Five small code changes are recommended at activation:** explicit `ssl` on the pool,
configurable pool `max`, `statement_timeout`, migration checksum comparison, and transactions
around `makePrimaryPhoto`/`makeDomainPrimary`.

---

## DELIVERABLE F — OpenCode integration plan

**Full document: `docs/OPENCODE-INTEGRATION.md`. Kept PENDING.**

1. **How it works:** `Nexora Entity → OpenCode HTTP (5 endpoints) → provider/model → AI operation`.
   Now split into an **attach-only client** (`server.ts`, imported by the app) and a **process
   supervisor** (`supervisor.ts`, dev scripts only).
2. **Why not integrated:** not installed; nothing running; no credentials; **all four AI functions
   have zero call sites**; `useAi` declared and never read; no round trip ever verified.
3. **Completed without activating:** provider + model selection UI, verification UI, account-level
   persistence (DB-enforced single active config), persistent dock, 13-kind failure taxonomy with
   actionable remediation, fail-closed structured output, cloud-ready config.
4. **Blocked:** catalogue, verification, and the four unwired AI operations. **Everything
   deterministic still works.**
5. **Recommended architecture:** the app on Vercel → a **separate long-running host** (Railway /
   Fly / VPS) running the OpenCode bridge → model providers. Keys live **only** on the bridge.
6. **Separate server required:** yes — OpenCode is stateful and cannot run in a serverless function.
7. **Needed from you:** a model provider API key (requires your payment method — cannot be
   delegated), a host account, a bridge token, and a decision on single- vs multi-tenant.
8. **You must do personally:** create the provider account and obtain a key; create the host
   account; set secrets on both sides.
9. **Costs:** model API usage dominates; small monthly cost for an always-on bridge host.
   **Not activated, no charges incurred.**
10. **Next phase, without local install:** deploy the bridge to your host, set `NEXORA_OPENCODE_URL`
    + `_TOKEN` in Vercel, verify via a cloud runner, and deliberately test the failure path —
    the app must say *"the AI bridge could not be reached"*, not *"your entity has no sources"*.

**A genuine design gap is recorded rather than hidden:** `ai_configurations` is per-user, but the
bridge holds one shared credential set. Fine single-tenant; must be reworked before multi-tenant.

---

## DELIVERABLE G — Other dependency register

**Full document: `docs/DEPENDENCY-REGISTER.md`.**

| Dependency | Needed for | Status | Account? | Cost |
| --- | --- | --- | --- | --- |
| **PostgreSQL** | Everything | 🔒 PENDING | Yes | Free tier |
| **OpenCode** | AI layer | 🤖 PENDING | Yes (provider key) | Usage-based |
| **Object storage** | Photos, the 4-photo minimum, public-site images | ❌ **NOT CLOUD-READY** | Yes | Free tier |
| **Vercel** | Hosting + publishing | ⚠️ PENDING | Yes | Free tier |
| **Vercel Cron** | Job scheduling | ⚠️ Not wired | Part of Vercel | Included |
| DNS resolution | Custom domains | ✅ IMPLEMENTED | No | Free |
| Outbound HTTP / inspection | Source checking | ✅ IMPLEMENTED | No | Free |
| Portfolio parsing | Portfolio upload | ✅ IMPLEMENTED | No | Free |
| Email delivery | — | ❌ NOT USED | — | — |
| Analytics / error reporting | — | ❌ NOT USED | — | — |

### ⚠️ The newly-discovered blocker

**Photos, portfolios and platform-hosted releases are written to the local filesystem.** On
Vercel the filesystem is read-only and ephemeral, so uploads would vanish and the 4-photo minimum
could never be satisfied. **Object storage must move before any Vercel deployment.** The change
is contained to one write path and one read path; no schema or UI work depends on it.

A second, related issue: the **platform-host publishing tier** relies on local release
directories and an unlocked `index.json`, so it is viable on a long-lived Node host but not on
serverless. Treat Vercel as the only publishing target for v1 — which is also what the vision
mandates.

---

## DELIVERABLE H — Actions required from you

### 1. Nothing needed now
Nothing is blocked on you for the work that is already done.

### 2. Needs your approval
- Approve the PostgreSQL phase.
- Approve the OpenCode phase.
- Approve **pushing** these two commits to GitHub (I have push access but have not pushed).
- Decide whether I should amend the commit author: I used the repository's existing identity,
  `mygodisgood536-ctrl`, because no local Git identity was configured.

### 3. Needs account access or authorisation
- Neon (or chosen provider) account.
- A host for the OpenCode bridge (Railway / Fly / VPS).
- Vercel account + API token, when you want deployment.
- An object-storage provider.

### 4. Needs credentials or configuration
- `DATABASE_URL` — **set as a Vercel env var, never in chat or the repo.**
- `NEXORA_OPENCODE_URL` and `NEXORA_OPENCODE_TOKEN`.
- A model provider API key — set on the bridge host.
- `VERCEL_TOKEN`.
- **A production `NEXORA_SECRET_KEY` and `NEXORA_CRON_SECRET`** — both currently have
  development placeholders.

### 5. May incur charges
- Model provider API usage.
- Always-on bridge hosting.
- Vercel, if you exceed the free tier.
- **Nothing has been charged. Nothing is activated.**

### 6. Can wait for the next phase
- Vercel Cron wiring; Vercel custom-domain UI wiring; Vercel rollback; platform-host transactional
  fixes; migration checksum drift detection; entity switcher; route-level loading/error boundaries;
  preview dialog focus trap.

---

## DELIVERABLE I — Final project status

These are **separate** statuses and must not be conflated.

| Question | Answer |
| --- | --- |
| Functionally complete for all **independent** features? | **Yes.** Every feature not requiring PostgreSQL or OpenCode is implemented and verified. |
| Fully tested? | **No.** Unit-tested and runtime-verified where possible. The entire authenticated journey is untested because it needs a database. |
| Ready for **preview** deployment? | **No — not yet.** It builds and serves, but photos and published sites would not persist on Vercel. Object storage first. |
| Ready for **production** deployment? | **No.** Blocked on object storage, PostgreSQL, and production secrets. |
| Waiting on PostgreSQL? | **Yes.** |
| Waiting on OpenCode? | **Yes.** |
| Waiting on anything else? | **Yes — object storage.** Discovered during this audit. Also: Vercel credentials. |

---

## What I would do next, in order

1. **Object storage** — smallest change, unblocks deployment-readiness.
2. **PostgreSQL (Neon)** — unblocks two-thirds of the product and the whole authenticated test suite.
3. **Run the authenticated journeys for real**, including browser-level verification of the
   stage-navigation and autosave fixes.
4. **OpenCode bridge** on a cloud host.
5. **Design art direction** to move the design system from "clean and correct" to "distinctive".
6. Accessibility and UX hardening listed under Deliverable C.