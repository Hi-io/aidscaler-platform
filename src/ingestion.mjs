import { hash } from "./store.mjs";
import { check } from "./errors.mjs";
export class Ingestion {
  constructor(store, connector, config) {
    Object.assign(this, { store, connector, config });
  }
  async sync({ sources = true } = {}) {
    const org = this.config.org;
    let downloaded = 0,
      changed = 0;
    const began = performance.now();
    try {
      const state = await this.connector.state();
      check(
        state.organization.id === org,
        "SOURCE_ORG",
        "The source key belongs to a different organization.",
        403,
      );
      const priorCursor =
        (await this.store.get(org, "source", "simulator", false))
          ?.backfillCursor ?? 100;
      let backfillCursor = priorCursor;
      const receiptIds = [];
      if (sources)
        for (const cursor of [0, priorCursor]) {
          const feed = await this.connector.feed(cursor, 100);
          if (cursor !== 0)
            backfillCursor = feed.nextCursor ?? feed.next ?? 100;
          const fresh = [];
          for (const p of feed.posts) {
            downloaded++;
            if (await this.store.get(org, "erased_source", p.id, false))
              continue;
            const old = await this.store.get(org, "signal", p.id, false);
            if (old?.sourceVersion >= p.version) continue;
            fresh.push(p);
          }
          if (this.connector.ackBatch) {
            const receipts = await this.connector.ackBatch(fresh, "downloaded");
            check(
              receipts.every((r) => r.ok),
              "SOURCE_RECEIPT",
              "The source did not acknowledge every downloaded record.",
              502,
            );
          } else
            for (const p of fresh) await this.connector.ack(p, "downloaded");
          const accepted = [],
            acceptJob = `source_accept_${org}_${hash(fresh.map((p) => [p.id, p.version]))}`;
          await this.store.transaction(async (tx) => {
            for (const p of fresh) {
              if (await tx.get(org, "erased_source", p.id, false)) continue;
              const old = await tx.get(org, "signal", p.id, false);
              if (old?.sourceVersion >= p.version) continue;
              const group = hash(
                p.references?.[0] ??
                  p.text.toLowerCase().replace(/\s+/g, " ").trim(),
              );
              await tx.upsert(org, "signal", p.id, {
                ...p,
                sourceVersion: p.version,
                source: "Signal social network",
                sourceUrl: `${this.config.sourceUrl}/posts/${p.id}`,
                contentHash: hash(p),
                receivedAt: Date.now(),
                state: p.deleted ? "withdrawn" : "unverified",
                group,
                modality: p.attachments?.[0]?.kind ?? "text",
                permissions: "organization",
                originalReferences: p.references ?? [],
              });
              await tx.upsert(org, "source_version", `${p.id}_${p.version}`, {
                snapshot: p,
                sourceVersion: p.version,
                contentHash: hash(p),
                receivedAt: Date.now(),
              });
              if (this.intake)
                await this.intake.stage(
                  org,
                  { ...p, sourceVersion: p.version, group },
                  tx,
                );
              if (old)
                await tx.audit(org, "connector", "signal.revised", p.id, {
                  from: old.sourceVersion,
                  to: p.version,
                });
              if (
                old &&
                hash({
                  text: old.text,
                  deleted: old.deleted,
                  attachments: old.attachments,
                }) !==
                  hash({
                    text: p.text,
                    deleted: p.deleted,
                    attachments: p.attachments,
                  })
              )
                await tx.enqueue(
                  org,
                  "invalidate",
                  {
                    dependency: p.id,
                    reason: p.deleted
                      ? "A cited source was withdrawn"
                      : "A cited source changed; inspect the correction",
                  },
                  `signal_change_${p.id}_${p.version}`,
                );
              accepted.push(p);
            }
            if (accepted.length)
              await tx.enqueue(
                org,
                "source_accept",
                {
                  versions: accepted.map((p) => ({
                    id: p.id,
                    version: p.version,
                  })),
                },
                acceptJob,
              );
          });
          changed += accepted.length;
          receiptIds.push(...accepted.map((p) => p.id));
          try {
            if (this.connector.ackBatch) {
              const receipts = await this.connector.ackBatch(
                accepted,
                "accepted",
              );
              check(
                receipts.every((r) => r.ok),
                "SOURCE_RECEIPT",
                "The source did not acknowledge every accepted record.",
                502,
              );
            } else
              for (const p of accepted) await this.connector.ack(p, "accepted");
            if (accepted.length)
              await this.store.query(
                "UPDATE jobs SET state='completed',result=$2 WHERE id=$1 AND state='queued'",
                [
                  acceptJob,
                  JSON.stringify({
                    accepted: accepted.length,
                    confirmedBySource: true,
                  }),
                ],
              );
          } catch (e) {
            // The sources are already durable. Preserve the outbox and retry
            // the exact versions; do not roll back or claim a remote receipt.
            await this.store.audit(
              org,
              "connector",
              "source.receipt_pending",
              acceptJob,
              {
                versions: accepted.length,
                code: e.code ?? "SOURCE_UNAVAILABLE",
              },
            );
          }
        }
      const team = sources ? await this.connector.inbox() : { posts: [] };
      for (const p of team.posts ?? []) {
        if (await this.store.get(org, "erased_source", p.id, false)) continue;
        const old = await this.store.get(org, "signal", p.id, false);
        if (old?.sourceVersion >= p.version) continue;
        await this.store.upsert(org, "signal", p.id, {
          ...p,
          sourceVersion: p.version,
          source: "Authorized team channel",
          sourceUrl: null,
          contentHash: hash(p),
          receivedAt: Date.now(),
          state: "observed",
          group: hash(p.references?.[0] ?? p.text),
          modality: p.attachments?.[0]?.kind ?? "text",
          permissions: "organization",
        });
        if (this.intake)
          await this.intake.stage(org, {
            ...p,
            sourceVersion: p.version,
            group: hash(
              p.references?.[0] ?? [p.text, p.location, p.observedAt],
            ),
          });
        changed++;
        receiptIds.push(p.id);
      }
      await this.store.transaction(async (tx) => {
        await tx.upsert(org, "source", "simulator", {
          state: "connected",
          lastSuccessAt: Date.now(),
          runId: state.runId,
          simulatedAt: state.now,
          downloaded,
          changed,
          backfillCursor,
          wallMs: performance.now() - began,
        });
        const old = await tx.get(org, "context", "operational", false);
        const localHolds = (await tx.list(org, "commitment", 2000)).filter(
          (c) =>
            ["reserved", "confirmed"].includes(c.state) &&
            c.syncState === "pending",
        );
        for (const c of await tx.list(org, "commitment", 2000)) {
          if (!c.sourceId) continue;
          const remote = state.commitments?.find((r) => r.id === c.sourceId);
          if (remote && remote.state !== c.sourceState) {
            await tx.upsert(org, "commitment", c.id, {
              sourceState: remote.state,
              ...(["expired", "withdrawn", "released", "rejected"].includes(
                remote.state,
              )
                ? { state: remote.state }
                : {}),
            });
            if (
              ["expired", "withdrawn", "released", "rejected"].includes(
                remote.state,
              )
            )
              await tx.enqueue(
                org,
                "invalidate",
                {
                  dependency: c.id,
                  reason: "Source commitment " + remote.state,
                },
                "source_state_" + c.id + "_" + remote.state,
              );
          }
        }
        if (!old?.snapshot || hash(old.snapshot) !== hash(state))
          await tx.upsert(org, "context", "operational", {
            snapshot: state,
            observedAt: Date.now(),
          });
        for (const [kind, items] of [
          ["resource", state.known.resources],
          ["vehicle", state.known.vehicles],
          ["need", state.known.needs],
          ["facility", state.known.buildings],
          ["road", state.known.edges],
        ])
          for (const [sourceId, raw] of Object.entries(items ?? {})) {
            const data = { ...raw, id: raw.id ?? sourceId };
            const previous = await tx.get(org, kind, data.id, false);
            // A shared/manual record may exist before its owner's first direct
            // source snapshot. It is not evidence that the source was read.
            if (
              !previous?.sourceSnapshot ||
              hash(previous.sourceSnapshot) !== hash(data)
            ) {
              await tx.upsert(org, kind, data.id, {
                ...data,
                sourceSnapshot: data,
                owner: data.owner ?? org,
                sourceVersion: data.version ?? 1,
                reserved:
                  (data.reserved ?? 0) +
                  (kind === "resource"
                    ? localHolds
                        .filter((c) => c.resource === data.id)
                        .reduce((n, c) => n + c.quantity, 0)
                    : 0),
                floor: data.floor ?? 0,
              });
              const changedRestriction =
                (kind === "road" &&
                  data.open === false &&
                  previous?.open !== false) ||
                (kind === "facility" &&
                  previous?.safe === true &&
                  data.safe === false);
              if (previous && changedRestriction)
                await tx.enqueue(
                  org,
                  "invalidate",
                  { dependency: data.id, reason: "Source state changed" },
                  `change_${kind}_${data.id}_${data.version}`,
                );
            }
          }
        for (const data of state.operations ?? [])
          await tx.upsert(org, "operation", data.id, {
            ...data,
            sourceSnapshot: data,
            confirmedBySource: true,
          });
        for (const i of state.inspections ?? [])
          await tx.upsert(org, "verification", i.id, i);
        const mapQuery = state.queries
          ?.filter((q) => q.target === "map" && q.state === "ready")
          .at(-1);
        if (mapQuery?.result)
          await tx.upsert(org, "context", "geography", {
            map: mapQuery.result,
            observedAt: mapQuery.completedAt,
          });
        await tx.audit(org, "connector", "source.synced", "simulator", {
          downloaded,
          changed,
          simulatedAt: state.now,
          wallMs: performance.now() - began,
        });
        if (changed && this.config.autoInvestigate && !this.intake)
          await tx.enqueue(
            org,
            "investigate",
            { ids: receiptIds.slice(0, 30) },
            `investigate_${state.runId}_${hash(receiptIds)}`,
          );
      });
      if (this.afterSync) await this.afterSync();
      return { downloaded, changed, now: state.now };
    } catch (e) {
      await this.store.upsert(org, "source", "simulator", {
        state: "degraded",
        lastFailureAt: Date.now(),
        error: e.code ?? "SOURCE_UNAVAILABLE",
      });
      throw e;
    }
  }
}
