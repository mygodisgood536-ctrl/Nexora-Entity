/**
 * Real integration check for the OpenCode bridge. Uses the running OpenCode server and a real
 * provider/model — no mocks. Prints what it actually observed.
 */
import { closePool, latestOpencodeSnapshot, logAiAttempt, saveOpencodeSnapshot } from '@nexora/db';
import { ensureReady, fetchCatalogue, health, stopManaged, verifyModel } from '@nexora/opencode-bridge';

async function main() {
  console.log('--- 1. bridge health ---');
  const before = await health();
  console.log(`initial: ${JSON.stringify(before)}`);

  console.log('--- 2. ensure ready ---');
  const h = await ensureReady();
  console.log(`ready: ${JSON.stringify(h)}`);
  if (!h.healthy) throw new Error('bridge did not become ready');

  console.log('--- 3. dynamic provider/model discovery ---');
  const cat = await fetchCatalogue();
  console.log(`opencode version : ${cat.opencodeVersion}`);
  console.log(`providers        : ${cat.totals.providers}`);
  console.log(`connected        : ${cat.totals.connectedProviders}`);
  console.log(`usable models    : ${cat.totals.usableModels}`);
  console.log(`free models      : ${cat.totals.freeModels}`);
  await saveOpencodeSnapshot({
    opencodeVersion: cat.opencodeVersion,
    providers: cat.providers.map((p) => ({
      id: p.id,
      name: p.name,
      connected: p.connected,
      credentialRequirement: p.credentialRequirement,
      modelCount: p.modelCount,
      defaultModelId: p.defaultModelId,
      freeModels: p.models.filter((m) => m.isFree).slice(0, 12).map((m) => ({ id: m.id, name: m.name, context: m.contextWindow })),
    })),
    durationMs: cat.durationMs,
  });
  console.log('snapshot persisted to opencode_snapshots');

  const connected = cat.providers.filter((p) => p.connected);
  console.log('\nconnected providers (first 8):');
  for (const p of connected.slice(0, 8)) {
    console.log(
      `  ${p.id.padEnd(18)} ${String(p.models.length).padStart(4)} text models  ` +
        `free:${p.models.filter((m) => m.isFree).length}  default:${p.defaultModelId ?? '-'}`,
    );
  }

  const target = connected.find((p) => p.models.some((m) => m.isFree)) ?? connected[0];
  if (!target) {
    console.log('\nNo connected provider with a usable text model. Reporting honestly and stopping.');
    return;
  }
  const model = target.models.find((m) => m.isFree) ?? (target.models[0] as (typeof target.models)[number]);

  console.log(`\n--- 4. verify a real provider/model: ${target.name} / ${model.name} ---`);
  const v = await verifyModel({
    providerId: target.id,
    providerName: target.name,
    modelId: model.id,
    modelName: model.name,
  });
  console.log(`verified=${v.ok} latencyMs=${v.latencyMs} probe=${JSON.stringify(v.probeText)}`);
  if (v.error) console.log(`error=${JSON.stringify(v.error.toJSON(), null, 2)}`);
await logAiAttempt({
    userId: null as unknown as string,
    providerId: target.id,
    modelId: model.id,
    operation: 'bridge_integration_check',
    outcome: v.ok ? 'success' : 'failure',
    message: v.ok ? v.probeText : v.error?.message,
    latencyMs: v.latencyMs,
  });

  console.log('\n--- 5. failure path: a model OpenCode does not expose ---');
  const bogus = await verifyModel({
    providerId: target.id,
    providerName: target.name,
    modelId: 'this-model-does-not-exist-9f3a',
    modelName: 'Nonexistent',
  });
  console.log(`verified=${bogus.ok}`);
  console.log(`error code   = ${bogus.error?.code}`);
  console.log(`error domain = ${bogus.error?.domain}`);
  console.log(`user message = ${bogus.error?.message}`);

  const snap = await latestOpencodeSnapshot();
  console.log(`\nsnapshot in db: ${snap ? `${snap.opencodeVersion} @ ${snap.fetchedAt}` : 'none'}`);

  console.log('\nBRIDGE INTEGRATION OK');
}

main()
  .catch((e) => {
    console.error(`BRIDGE INTEGRATION FAILED: ${e?.message ?? e}`);
    if (e && typeof e === 'object' && 'toJSON' in e) console.error(JSON.stringify(e.toJSON(), null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.env.NEXORA_KEEP_BRIDGE !== '1') await stopManaged();
    await closePool();
  });