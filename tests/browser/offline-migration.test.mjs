import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

test("the browser migrates legacy field reports durably without changing their ownership or command identity", async (t) => {
  const source = await readFile(
    new URL("../../ui/offline.mjs", import.meta.url),
    "utf8",
  );
  const server = createServer((request, response) => {
    response.setHeader(
      "Content-Type",
      request.url === "/offline.mjs" ? "text/javascript" : "text/html",
    );
    response.end(
      request.url === "/offline.mjs"
        ? source
        : "<!doctype html><title>Offline migration fixture</title>",
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const original = [
    {
      clientId: "report-fixed-id",
      queueOrg: "org0",
      queueActor: "field0",
      kind: "need",
      text: "Water needed",
      references: [],
      observedAt: 17,
    },
    {
      clientId: "task-fixed-id",
      queueOrg: "org1",
      queueActor: "field1",
      queueKind: "task",
      taskPayload: { id: "task1", version: 3, stage: "received", quantity: 12 },
      lastError: "Awaiting connection",
    },
  ];
  async function pageWithQueues(legacy = original, current = []) {
    const context = await browser.newContext(),
      page = await context.newPage();
    t.after(() => context.close());
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.evaluate(
      async ({ legacy, current }) => {
        window.seedQueue = async (name, rows) => {
          const database = await new Promise((resolve, reject) => {
            const request = indexedDB.open(name, 1);
            request.onupgradeneeded = () =>
              request.result.createObjectStore("queue", {
                keyPath: "clientId",
              });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          await new Promise((resolve, reject) => {
            const tx = database.transaction("queue", "readwrite");
            rows.forEach((row) => tx.objectStore("queue").put(row));
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
          });
          database.close();
        };
        window.readQueue = async (name) => {
          const database = await new Promise((resolve, reject) => {
            const request = indexedDB.open(name);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const rows = await new Promise((resolve, reject) => {
            const tx = database.transaction("queue", "readonly"),
              request = tx.objectStore("queue").getAll();
            request.onsuccess = () => resolve(request.result);
            tx.onabort = () => reject(tx.error);
          });
          database.close();
          return rows;
        };
        if (legacy !== null) await window.seedQueue("nexo-field-v1", legacy);
        if (current !== null)
          await window.seedQueue("aidscaler-field-v1", current);
        window.offlineQueue = (await import("/offline.mjs")).offlineQueue;
      },
      { legacy, current },
    );
    return page;
  }

  await t.test(
    "existing AidScaler v1 and old reports merge once, retain exact IDs/owners and do not return after sending",
    async () => {
      const extra = {
        clientId: "new-report",
        queueOrg: "org2",
        queueActor: "field2",
        text: "New report",
      };
      const page = await pageWithQueues(original, [extra]);
      const result = await page.evaluate(async () => {
        const first = await offlineQueue("all"),
          legacy = await readQueue("nexo-field-v1");
        await offlineQueue("delete", "report-fixed-id");
        const replay = await offlineQueue("all");
        return { first, legacy, replay };
      });
      assert.deepEqual(
        result.first,
        [...original, extra].sort((a, b) =>
          a.clientId.localeCompare(b.clientId),
        ),
      );
      assert.deepEqual(result.legacy, []);
      assert.equal(result.replay.length, 2);
      assert.ok(
        !result.replay.some((row) => row.clientId === "report-fixed-id"),
      );
    },
  );

  await t.test(
    "an interrupted copy rolls back all records and markers, then a healthy retry imports everything",
    async () => {
      const page = await pageWithQueues();
      const result = await page.evaluate(async () => {
        const add = IDBObjectStore.prototype.add;
        IDBObjectStore.prototype.add = function (...args) {
          const request = add.apply(this, args);
          if (this.name === "legacy_imports") this.transaction.abort();
          return request;
        };
        let rejected = false;
        try {
          await offlineQueue("all");
        } catch {
          rejected = true;
        } finally {
          IDBObjectStore.prototype.add = add;
        }
        const before = {
          legacy: await readQueue("nexo-field-v1"),
          current: await readQueue("aidscaler-field-v1"),
        };
        const retry = await offlineQueue("all");
        return { rejected, before, retry };
      });
      assert.equal(result.rejected, true);
      assert.deepEqual(result.before.legacy, original);
      assert.deepEqual(result.before.current, []);
      assert.deepEqual(result.retry, original);
    },
  );

  await t.test(
    "a crash between copy commit and legacy cleanup cannot resurrect a subsequently acknowledged report",
    async () => {
      const page = await pageWithQueues();
      const before = await page.evaluate(async () => {
        const transaction = IDBDatabase.prototype.transaction;
        IDBDatabase.prototype.transaction = function (stores, mode, ...rest) {
          if (this.name === "nexo-field-v1" && mode === "readwrite")
            throw Error("Injected crash before cleanup");
          return transaction.call(this, stores, mode, ...rest);
        };
        let rejected = false;
        try {
          await offlineQueue("all");
        } catch {
          rejected = true;
        } finally {
          IDBDatabase.prototype.transaction = transaction;
        }
        const legacy = await readQueue("nexo-field-v1"),
          current = await readQueue("aidscaler-field-v1");
        const database = await new Promise((resolve) => {
          const r = indexedDB.open("aidscaler-field-v1");
          r.onsuccess = () => resolve(r.result);
        });
        await new Promise((resolve) => {
          const tx = database.transaction("queue", "readwrite");
          tx.objectStore("queue").delete("report-fixed-id");
          tx.oncomplete = resolve;
        });
        database.close();
        return { rejected, legacy, current };
      });
      assert.equal(before.rejected, true);
      assert.deepEqual(before.legacy, original);
      assert.deepEqual(before.current, original);
      await page.reload();
      const after = await page.evaluate(async () =>
        (await import("/offline.mjs")).offlineQueue("all"),
      );
      assert.deepEqual(after, [original[1]]);
    },
  );

  await t.test(
    "a same-ID ownership collision preserves both queues and rolls back nonconflicting imports",
    async () => {
      const collision = {
        ...original[1],
        queueOrg: "other-org",
        queueActor: "other-owner",
        taskPayload: { id: "different-task" },
      };
      const page = await pageWithQueues(original, [collision]);
      const result = await page.evaluate(async () => {
        let code;
        try {
          await offlineQueue("all");
        } catch (error) {
          code = error.code;
        }
        return {
          code,
          legacy: await readQueue("nexo-field-v1"),
          current: await readQueue("aidscaler-field-v1"),
        };
      });
      assert.equal(result.code, "OFFLINE_MIGRATION_CONFLICT");
      assert.deepEqual(result.legacy, original);
      assert.deepEqual(result.current, [collision]);
    },
  );

  await t.test(
    "concurrent migration attempts and a later old-tab report do not duplicate or lose reports",
    async () => {
      const page = await pageWithQueues();
      const extra = {
        clientId: "late-legacy-id",
        queueOrg: "org1",
        queueActor: "field1",
        text: "Late report",
      };
      const result = await page.evaluate(async (extra) => {
        const concurrent = await Promise.all(
          Array.from({ length: 8 }, () => offlineQueue("all")),
        );
        await seedQueue("nexo-field-v1", [extra]);
        return { concurrent, after: await offlineQueue("all") };
      }, extra);
      result.concurrent.forEach((rows) => assert.deepEqual(rows, original));
      assert.deepEqual(result.after, [extra, ...original]);
    },
  );

  await t.test(
    "a blocked upgrade reports an actionable error and a later retry does not retain a leaked connection",
    async () => {
      const page = await pageWithQueues();
      const result = await page.evaluate(async () => {
        const held = await new Promise((resolve) => {
          const r = indexedDB.open("aidscaler-field-v1", 1);
          r.onsuccess = () => resolve(r.result);
        });
        let message;
        try {
          await offlineQueue("all");
        } catch (error) {
          message = error.message;
        }
        const legacy = await readQueue("nexo-field-v1");
        held.close();
        return { message, legacy, retry: await offlineQueue("all") };
      });
      assert.match(result.message, /Close other field-report tabs/);
      assert.deepEqual(result.legacy, original);
      assert.deepEqual(result.retry, original);
    },
  );

  await t.test(
    "a fresh installation creates only the new database and new writes stay there",
    async () => {
      const page = await pageWithQueues(null, null);
      const result = await page.evaluate(async (row) => {
        await offlineQueue("put", row);
        const rows = await offlineQueue("all"),
          databases = await indexedDB.databases();
        await offlineQueue("clear");
        return {
          rows,
          names: databases.map((d) => d.name),
          cleared: await offlineQueue("all"),
        };
      }, original[0]);
      assert.deepEqual(result.rows, [original[0]]);
      assert.deepEqual(result.names, ["aidscaler-field-v1"]);
      assert.deepEqual(result.cleared, []);
    },
  );
});
