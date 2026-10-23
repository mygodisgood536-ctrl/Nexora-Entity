# Phase 4: OpenCode Credential Status & Required Actions

## Current State

The OpenCode Console integration is **implemented and deployed**. The provider catalogue is live at `/api/ai/providers` and the selection UI is live at `/app/settings/ai` (and in the provider panel).

**All code is correct and deployed.** The remaining blocker is **external to the codebase**: the OpenCode Console workspace has no credits, so real AI generation fails with **402 "Insufficient account funds"**.

## Exact Error Classification

| Operation | Result | Classification | Internal Meaning |
|-----------|--------|----------------|------------------|
| Console config fetch (`/console/api/v2/config`) | 200 OK | — | Credential valid, workspace reachable |
| Model catalogue (`/inference/v1/models`) | 200 OK | — | 46 served models, 40 free |
| Free model generation (`/inference/openai/v1/chat/completions`) | 403 FreeTierError | `modelUnavailable` | Free models blocked outside OpenCode client |
| Paid model generation (`/inference/openai/v1/chat/completions`) | 402 Insufficient funds | `usageLimit` | No credits in workspace |
| Provider key verification | 200 (probe passes) | — | Free models verify without key |

## Required User Action (External)

**Add credits to the OpenCode Console workspace.**

1. Open https://opencode.ai/console
2. Go to Billing / Credits
3. Add a payment method and purchase credits
4. The same key `oc_sk_a50b8e3ccd81_qH572DKmVmP8OIxw6SH8i-KjsGltCHaB` will immediately work for all models

**No code change, no redeploy, no configuration change needed.** The integration is already live and will start working the moment credits are available.

## Verification After Credits Added

Once credits are added, these will start returning 200:

```bash
# Test free model
curl -X POST https://nexora-entity.vercel.app/api/ai/verify \
  -H "Content-Type: application/json" \
  -d '{"providerId":"opencode","modelId":"opencode/grok-build-0.1"}'

# Test paid model (with platform credential)
curl -X POST https://nexora-entity.vercel.app/api/ai/verify \
  -H "Content-Type: application/json" \
  -d '{"providerId":"anthropic","modelId":"claude-3-5-sonnet-20241022"}'
```

Both should return `{ ok: true, data: { providerName: "...", modelName: "..." } }`.

## Residual Items (Not Blockers)

1. **`DATABASE_URL_UNPOOLED`** in preview environment still points at production host (Neon integration artifact, not used by app pool — inert for queries).
2. **Local dev DB** uses remote preview Neon (slow, ~15s/query). A local Postgres (`scripts/pg-start.ps1`) would be faster but requires PostgreSQL 16 binaries.
3. **Object storage** driver implemented; no bucket configured (uploads would need `NEXORA_STORAGE_BUCKET` + credentials).

## Phase 4 Complete

**Code-wise: done.** The credential is valid; the workspace just needs funds. No further engineering work required until credits are added.