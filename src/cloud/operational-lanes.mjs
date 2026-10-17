const PHYSICAL = ['execute_proposal', 'continue_proposal', 'source_commitment', 'invalidate', 'expire_commitment'];
const MODEL = ['investigate', 'discover_response', 'compile_response', 'interpret_sources', 'analyze_media'];

// A large base-team refresh must not precede another team's reviewed dispatch.
// Every action still uses the ordinary durable job lease and owner checks.
export async function prioritizePhysicalWork(workers, stopAt, now = Date.now) {
  for (const worker of workers) {
    if (now() >= stopAt) break;
    await worker.once({ includeKinds: PHYSICAL });
  }
}

// Separate turns prevent a busy outbox or an ongoing trip's poll from starving
// fresh observations. These are the same leased jobs and authority checks.
export async function operationalSlice(worker, stopAt, now = Date.now) {
  if (now() >= stopAt) return;
  await worker.once({ includeKinds: PHYSICAL });
  if (now() >= stopAt) return;
  await worker.once({ includeKinds: ['ingest'] });
  for (let i = 0; i < 4 && now() < stopAt; i++) {
    if (!await worker.once({ excludeKinds: [...MODEL, ...PHYSICAL, 'ingest'], prioritizePeerResponses: true })) break;
  }
}
