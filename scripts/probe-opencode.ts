/**
 * Poll the local OpenCode server to see whether it is genuinely stable.
 *
 * `npm run services` returning "ready" only proves one successful response. This probes
 * repeatedly so an intermittent server is visible as such, rather than surfacing later as a
 * provider-discovery failure inside the product.
 */

const PORT = Number.parseInt(process.env.NEXORA_OPENCODE_PORT ?? '4137', 10);
const ROUNDS = Number.parseInt(process.env.NEXORA_PROBE_ROUNDS ?? '8', 10);
const GAP_MS = Number.parseInt(process.env.NEXORA_PROBE_GAP_MS ?? '2500', 10);

async function probe() {
  const started = Date.now();
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}/global/health`, {
      headers: { connection: 'close' },
      signal: AbortSignal.timeout(6000),
    });
    const body = (await res.json()) as { version?: string };
    return { ok: res.ok, status: res.status, ms: Date.now() - started, version: body.version };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main() {
  const results = [];
  for (let i = 0; i < ROUNDS; i += 1) {
    const result = await probe();
    results.push(result);
    console.log(
      `  probe ${String(i + 1).padStart(2)}/${ROUNDS}  ${result.ok ? `HTTP ${result.status}` : 'FAILED '}  ${result.ms}ms${
        result.error ? `  ${result.error}` : ''
      }`,
    );
    if (i < ROUNDS - 1) await new Promise((r) => setTimeout(r, GAP_MS));
  }

  const failed = results.filter((r) => !r.ok);
  const versions = [...new Set(results.map((r) => r.version).filter(Boolean))];
  console.log('');

  if (failed.length === 0) {
    console.log(
      `OPENCODE STABLE — ${results.length}/${results.length} probes succeeded${versions.length ? `, version ${versions.join(', ')}` : ''}`,
    );
    return 0;
  }

  console.log(`OPENCODE UNSTABLE — ${failed.length}/${results.length} probes failed`);
  return 1;
}

main()
  .then((code) => {
    // Close the fetch client before exiting: a closing keep-alive handle trips a libuv
    // assertion on Windows and reports as a crash after success.
    const dispatcher = (globalThis as Record<symbol, { close?: () => Promise<void> }>)[
      Symbol.for('undici.globalDispatcher.1')
    ];
    return dispatcher?.close?.().then(() => {
      process.exit(code);
    });
  })
  .catch((err) => {
    console.error('probe failed:', err);
    process.exit(1);
  });

// A module, not a script: without this the top-level helpers share one global
// scope with every other script in the program and collide.
export {};
