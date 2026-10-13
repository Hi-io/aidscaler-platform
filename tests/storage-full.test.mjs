import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Store, hash } from "../src/store.mjs";

// Fault injection represents a failed storage write at the final atomic receipt,
// not a claim that the host volume was filled or that power-loss is simulated.
for (const code of ["ENOSPC", "53100"])
  test(
    `${code}: durable atomic rollback preserves prior authorization and cargo receipt; healthy retry records exactly once`,
    { timeout: 60000 },
    async (t) => {
      const base = fileURLToPath(new URL("../.local/", import.meta.url));
      await mkdir(base, { recursive: true });
      const temp = await mkdtemp(path.join(base, "storage-full-"));
      assert.ok(path.resolve(temp).startsWith(path.resolve(base) + path.sep));
      let store = await Store.open({ dataDir: path.join(temp, "pgdata") });
      t.after(async () => {
        await store?.close();
        await rm(temp, { recursive: true, force: true });
      });
      await store.organization("org0");
      const action = {
        type: "dispatch",
        owner: "org0",
        params: { resource: "r", vehicle: "v", need: "n", quantity: 300 },
        dependsOn: [],
      };
      const authorization = {
        by: "actual-operator",
        planHash: hash([action]),
        expiresAt: Date.now() + 600000,
      };
      const proposal = await store.put(
        "org0",
        "proposal",
        "p",
        {
          state: "executing",
          authorization,
          actions: [action],
          conditions: [],
          executionResults: [{ index: 0, result: { id: "physical-cargo" } }],
        },
        0,
      );
      const receipt = await store.put(
        "org0",
        "operation",
        "physical-cargo",
        {
          state: "in_transit",
          proposalId: "p",
          step: 0,
          quantity: 300,
          received: 0,
          confirmedBySource: true,
        },
        0,
      );
      const originalAuthorization = structuredClone(proposal.authorization);
      let failing = true,
        callbacks = 0;
      const command = () =>
        store.command(
          "org0",
          "complete-source-receipt",
          { operation: "physical-cargo", received: 300 },
          async (tx) => {
            callbacks++;
            const current = await tx.get("org0", "proposal", "p");
            const result = await tx.put(
              "org0",
              "proposal",
              "p",
              { ...current, state: "completed" },
              current.version,
            );
            const physical = await tx.get(
              "org0",
              "operation",
              "physical-cargo",
            );
            await tx.put(
              "org0",
              "operation",
              "physical-cargo",
              { ...physical, state: "received", received: 300 },
              physical.version,
            );
            await tx.enqueue(
              "org0",
              "publication_ready",
              { id: "p" },
              "one-source-completion",
            );
            await tx.audit(
              "org0",
              "source-monitor",
              "cargo.receipt",
              "physical-cargo",
              { received: 300 },
            );
            const query = tx.query.bind(tx);
            tx.query = (sql, values) => {
              if (failing && sql.startsWith("UPDATE idempotency SET result="))
                throw Object.assign(
                  new Error(
                    "Injected exhausted storage while committing the atomic receipt",
                  ),
                  { code },
                );
              return query(sql, values);
            };
            return result;
          },
        );
      await assert.rejects(command(), { code });
      assert.deepEqual(await store.get("org0", "proposal", "p"), proposal);
      assert.deepEqual(
        await store.get("org0", "operation", "physical-cargo"),
        receipt,
      );
      for (const sql of [
        "SELECT COUNT(*)::int AS n FROM jobs WHERE id='one-source-completion'",
        "SELECT COUNT(*)::int AS n FROM audit WHERE action='cargo.receipt'",
        "SELECT COUNT(*)::int AS n FROM idempotency WHERE key='complete-source-receipt'",
      ])
        assert.equal((await store.query(sql)).rows[0].n, 0);
      // Reopening from actual disk proves previously committed data was retained,
      // and the failed epoch did not leave a half-written success idempotency row.
      await store.close();
      store = await Store.open({ dataDir: path.join(temp, "pgdata") });
      assert.deepEqual(
        (await store.get("org0", "proposal", "p")).authorization,
        originalAuthorization,
      );
      assert.equal(
        (await store.get("org0", "operation", "physical-cargo")).received,
        0,
      );
      failing = false;
      const success = await command();
      assert.deepEqual(await command(), success);
      assert.equal(
        callbacks,
        2,
        "One failed attempt and one success, never callback on replay",
      );
      assert.equal(
        (await store.get("org0", "proposal", "p")).state,
        "completed",
      );
      assert.deepEqual(
        (await store.get("org0", "proposal", "p")).authorization,
        originalAuthorization,
      );
      assert.equal(
        (await store.get("org0", "operation", "physical-cargo")).received,
        300,
      );
      for (const sql of [
        "SELECT COUNT(*)::int AS n FROM jobs WHERE id='one-source-completion'",
        "SELECT COUNT(*)::int AS n FROM audit WHERE action='cargo.receipt'",
        "SELECT COUNT(*)::int AS n FROM idempotency WHERE key='complete-source-receipt'",
      ])
        assert.equal((await store.query(sql)).rows[0].n, 1);
      await store.close();
      store = null;
    },
  );
