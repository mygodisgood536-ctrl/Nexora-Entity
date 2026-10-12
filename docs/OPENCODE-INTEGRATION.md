# OpenCode Integration Plan — prepared, not activated

**Status: PENDING. OpenCode has not been installed, configured, authenticated or activated, and
must not be until you approve the next phase.**

---

## 1. How OpenCode works in this repository today

Nexora Entity never talks to a model provider directly. OpenCode is the single provider/model
bridge (vision §2, §5, §36). The chain is:

```
Nexora Entity  →  OpenCode server (HTTP)  →  selected provider/model  →  AI operation
```

The bridge is **split into two modules**, which was required for correctness rather than tidiness:

| Module | Responsibility | `node:child_process`? | Imported by |
| --- | --- | --- | --- |
| `src/server.ts` | Attach-only HTTP client: `health()`, `ensureReady()`, `baseUrl()`, `httpGet()` | **No** | The Next.js app |
| `src/supervisor.ts` | Locates the binary and spawns `opencode serve`, waits for readiness | Yes | Local dev scripts only |

**Why the split matters.** While the supervisor was in the shared module, importing the bridge
from the web app put `child_process` into the Next server-component graph. Turbopack then refused
to build:

> Static analysis determined that this filesystem access causes the whole project to be traced and
> included in the output.

Splitting it fixed the build and, more importantly, removed the platform's structural dependence on
running a process on your computer.

**The five endpoints the bridge depends on** (`discovery.ts`, `ops.ts`):

| Endpoint | Used for |
| --- | --- |
| `GET /global/health` | Liveness + version |
| `GET /provider` | Live provider/model catalogue — **no hard-coded list anywhere** |
| `GET /provider/auth` | Which providers need credentials |
| `POST /session` | A fresh session per operation, so one failure cannot contaminate the next |
| `POST /session/:id/message` | The actual model call |

## 2. Why it cannot yet be considered integrated

| Reason | Detail |
| --- | --- |
| **Not installed** | `opencode-ai` is an `optionalDependency` (`packages/opencode-bridge/package.json`). It is deliberately absent from this working tree, verified after install. |
| **Nothing runs** | No OpenCode process exists, so `/global/health` never answers. |
| **No credentials** | No model provider API key is configured anywhere. |
| **The AI layer is unwired** | `packages/engine/src/ai.ts` exports four functions (`discoverCandidatesFromSource`, `assessAmbiguity`, `narrateReadiness`, `suggestAliases`). **All four have zero call sites.** `PipelineOptions.useAi` is declared and never read. |
| **No round trip verified** | `verifyModel()` has never executed against a live server. |

**What this means in practice, stated plainly:** every deterministic capability works today, and
no AI-dependent capability exists yet. That is a true negative — because the engine never calls
the AI layer, an unavailable provider **cannot** fabricate a readiness result.

## 3. What I completed without activating it

- Provider/model **catalogue UI** (`packages/web/src/components/provider-panel.tsx`): live search,
  connected/disconnected filter, per-provider model list, explicit "needs credentials" labelling.
- **Model verification UI**: `POST /api/ai/verify` performs a real round trip and stores the
  result only on success.
- **Account-level persistence** (vision v2.0 §9): `ai_configurations` has a partial unique index
  `ON (user_id) WHERE is_active`, so exactly one verified provider/model is the account's active
  AI configuration, enforced by the database. Replacing it is a single-statement CTE
  (`upsertVerifiedAiConfiguration`) that deactivates the old row and links it as `replaced`.
- **Persistent dock** (`provider-dock.tsx`): the selected provider stays reachable at the bottom
  of the working screen without leaving the current stage (vision §28).
- **13-kind failure taxonomy** (`failure.ts`) with `retryable` / `requiresModelChange` /
  `requiresCredentials` flags, each rendered as specific, actionable remediation. Provider failure
  is never blamed on the person's data (vision §6).
- **Honest degradation**: `runStructured` throws on unparseable or schema-invalid output rather
  than substituting data; `ai.ts` overwrites any model-supplied verdict with the deterministic
  one, so AI can never override an evidence minimum or readiness gate.
- **Client/supervisor split** (above) plus a module-state fix: bridge state moved to `globalThis`
  so multiple Next route chunks share one instance.
- **Cloud-ready configuration**: `NEXORA_OPENCODE_URL` and `NEXORA_OPENCODE_TOKEN` added, so a
  hosted HTTPS bridge is a configuration change rather than a code change.

## 4. Operations that remain blocked

| Operation | Blocked because |
| --- | --- |
| Provider/model catalogue | Needs a reachable bridge. |
| Model verification | Needs a reachable bridge and a credential. |
| `discoverCandidatesFromSource` | Not wired; needs a bridge. |
| `assessAmbiguity` (AI-assisted) | Not wired; needs a bridge. |
| `narrateReadiness` (AI narration) | Not wired; needs a bridge. |
| `suggestAliases` | Not wired; needs a bridge. |

**What still works without it:** signup, login, entity creation, all 23 stages, source inspection,
photo/portfolio upload, identity resolution, conflict detection, ambiguity detection, provenance,
completeness, the readiness gate, the whole-entity second pass, site composition and static
rendering. The deterministic engine is the product's foundation, not a fallback.

## 5. Recommended cloud-hosted architecture

**A separate long-running server is required.** OpenCode is a stateful process with sessions; it
cannot run inside a serverless function.

```
                    ┌──────────────────────────────┐
  Browser  ────────▶│  Nexora Entity on Vercel     │
                    │  (Next.js, stateless)        │
                    └───────────┬──────────────────┘
                                │  HTTPS + bearer token
                                │  (NEXORA_OPENCODE_URL)
                                ▼
                    ┌──────────────────────────────┐
                    │  OpenCode bridge             │
                    │  Railway / Fly.io / a VPS    │
                    │  long-running container      │
                    │  holds model provider keys   │
                    └───────────┬──────────────────┘
                                ▼
                    ┌──────────────────────────────┐
                    │  Model providers             │
                    │  (Anthropic, OpenAI, ...)    │
                    │  API keys live HERE only     │
                    └──────────────────────────────┘
```

**Hosting options for the bridge**, in order of recommendation:

1. **Railway** — deploy from the OpenCode image, private networking, persistent volume. Simplest.
2. **Fly.io** — same, with more control over regions.
3. **A small VPS** (Hetzner/Contabo/DigitalOcean) — cheapest, most control, most upkeep.

**Do not deploy OpenCode as a Vercel function.** It needs a long-lived process and a writable
session store. Vercel hosts the *application*, never the bridge.

## 6. Security and networking requirements

The bridge holds model provider credentials, so it must not be public:

- **Private networking** between the app and the bridge (Railway/Fly private services, or a VPC).
  If private networking is unavailable, the bridge **must** be HTTPS **and** bearer-authenticated.
- **A bridge authentication token is now supported** (`NEXORA_OPENCODE_TOKEN`) and is sent as
  `Authorization: Bearer …` on health checks. **All model provider API keys live only on the
  bridge** — never in the Vercel environment, never in the repository, never in the browser.
- **Least privilege**: the bridge needs only its provider keys and its own storage.
- **The bridge must not be able to reach the application database.** Separate concerns entirely.

### Known design gap — multi-tenancy

`ai_configurations` is **per user**, but the bridge currently holds **one credential set shared by
every tenant**. In a single-tenant deployment (you, your own entities) this is fine. Before
multi-tenant hosting is offered to third parties, the bridge needs a per-tenant credential path.
This is a genuine architectural gap, not a configuration item, and is recorded here rather than
deferred silently.

## 7. What I need from you

1. **Approval** for the OpenCode phase.
2. **A model provider account and API key** — e.g. an Anthropic or OpenAI key. Set it on the
   bridge host; never send it to me.
3. **A host for the bridge** — Railway/Fly account, or VPS access.
4. **A generated bridge token** for `NEXORA_OPENCODE_TOKEN`, set on both sides.
5. Confirmation of whether this is single-tenant (you) or multi-tenant.

## 8. What I must do personally — and what you must do

**You personally (unavoidable):**

- Create the model provider account and obtain an API key. This requires a payment method and
  cannot be automated or delegated.
- Create the hosting account for the bridge.
- Set the secrets on both the bridge host and Vercel.

**I can do once approved:** wire the four unwired AI functions into the pipeline with failure
isolation; make discovery failure non-fatal; add bridge retry/backoff (currently there is
`retryable` metadata but no retry); surface AI assistance state in the UI; write an integration
test against a stub bridge so the contract is verified without a live provider; and document the
activation runbook.

## 9. Likely costs and limitations

- **Model provider API key:** the dominant recurring cost. Many providers offer free tiers with
  strict rate limits; paid tiers are typically pay-per-token. Exact current pricing varies by
  provider and must be checked on the day.
- **Bridge hosting:** Railway/Fly free tiers exist but are unsuitable for a always-on process;
  expect a small monthly cost for a small always-on container.
- **Limitations to expect:**
  - Rate limits and quotas are provider-specific and will surface as `rate_limited` /
    `usage_limit` — already handled with honest, actionable messaging.
  - Structured output is not guaranteed by all models. `runStructured` fails closed on
    unparseable output, which means some operations will degrade rather than fabricate.
  - **Token costs scale with entity size**, so source inspection of large portfolios is the most
    expensive path.

I have not activated anything and have incurred no charges. Verify current pricing at activation.

## 10. How we integrate and test in the next phase — without installing OpenCode on your PC

1. **Deploy the bridge to your chosen host.** I provide a `Dockerfile` and an env contract; you
   supply the host and the provider key.
2. **Set `NEXORA_OPENCODE_URL` and `NEXORA_OPENCODE_TOKEN` in Vercel.** Never locally.
3. **Verify from a cloud runner**, not your machine — `npm run check:bridge` already exercises
   health → catalogue → verify a real model → verify a *non-existent* model to prove the failure
   taxonomy works.
4. **Test the failure path deliberately**, because that is what matters most for honesty:
   point the app at a bad URL and confirm the UI says *"the AI bridge could not be reached"*, not
   *"your entity has no sources"* (vision §6).
5. **Add a stub-bridge contract test** so the AI layer is verified in CI without any provider key.

**You will never need OpenCode installed on your personal computer.**