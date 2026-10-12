import { check } from "./errors.mjs";
/** Durable saga: local pending holds cannot become externally confirmed stock. */
export async function syncReservation(worker, { id, action }) {
  const { store, connector, config } = worker,
    org = config.org,
    c = await store.get(org, "commitment", id);
  if (action === "reserve") {
    if (c.sourceId) return { duplicate: true, id: c.sourceId };
    if (!["reserved", "confirmed"].includes(c.state))
      return { skipped: true, state: c.state };
    try {
      const receipt = await connector.action(
        "commitment",
        {
          action: "reserve",
          resource: c.resource,
          quantity: c.quantity,
          requester: c.requester,
          ttlMs: c.ttlMs ?? 900000,
          conditions: [],
        },
        "source_reserve_" + id,
        { human: true, version: c.sourceVersion },
      );
      await store.transaction(async (tx) => {
        const current = await tx.get(org, "commitment", id);
        await tx.put(
          org,
          "commitment",
          id,
          {
            ...current,
            sourceId: receipt.id,
            sourceExpiresAt: receipt.expiresAt,
            sourceState: receipt.state,
            syncState: "acknowledged",
          },
          current.version,
        );
        await tx.audit(org, "reservation-worker", "commitment.source_ack", id, {
          sourceId: receipt.id,
        });
        if (!["reserved", "confirmed"].includes(current.state))
          await tx.enqueue(
            org,
            "source_commitment",
            { id, action: "release" },
            "source_release_" + id,
          );
      });
      return receipt;
    } catch (e) {
      if (
        [
          "INSUFFICIENT_RESOURCE",
          "VERSION_CONFLICT",
          "ACCESS",
          "OWNER",
          "EXPIRED",
        ].includes(e.code)
      ) {
        await store.transaction(async (tx) => {
          const current = await tx.get(org, "commitment", id),
            r = await tx.get(org, "resource", c.resource);
          await tx.put(
            org,
            "resource",
            r.id,
            { ...r, reserved: Math.max(0, r.reserved - c.quantity) },
            r.version,
          );
          await tx.put(
            org,
            "commitment",
            id,
            {
              ...current,
              state: "failed",
              syncState: "failed",
              failure: e.code,
            },
            current.version,
          );
          await worker.domain.invalidateTx(
            tx,
            org,
            id,
            "The source rejected this reservation",
          );
          await tx.audit(
            org,
            "reservation-worker",
            "commitment.source_rejected",
            id,
            { code: e.code },
          );
        });
        return { rejected: true, code: e.code };
      }
      throw e;
    }
  }
  check(
    c.sourceId,
    "RESERVATION_PENDING",
    "Wait for the source to acknowledge the reservation.",
    409,
  );
  if (action === "release") {
    const known = (await connector.state()).commitments.find(
      (row) => row.id === c.sourceId,
    );
    if (
      known &&
      ["released", "expired", "withdrawn", "rejected", "failed"].includes(
        known.state,
      )
    ) {
      await store.upsert(org, "commitment", id, {
        sourceState: known.state,
        syncState: "acknowledged",
      });
      return { id: known.id, state: known.state, reconciled: true };
    }
  }
  const receipt = await connector.action(
    "commitment",
    { id: c.sourceId, action },
    "source_" + action + "_" + id,
    { human: true },
  );
  await store.upsert(org, "commitment", id, {
    sourceState: receipt.state,
    syncState: "acknowledged",
  });
  return receipt;
}
