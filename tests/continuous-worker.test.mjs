import test from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.mjs";
import { Worker } from "../src/worker.mjs";
import { Ingestion } from "../src/ingestion.mjs";

test("source ingestion and acknowledgement continue while an inference request waits", {timeout:15000}, async t => {
  const store = await Store.open();
  await store.organization("org0");
  let release, started, ingested;
  const modelGate = new Promise(resolve => { release = resolve; });
  const modelStarted = new Promise(resolve => { started = resolve; });
  const sourceReceived = new Promise(resolve => { ingested = resolve; });
  const worker = new Worker({store, config:{org:"org0"},
    investigator:{run:async()=>{ started(); await modelGate; return {state:"ready"}; }},
    ingestion:{sync:async()=>{ ingested(); return {changed:1}; }},
  });
  t.after(async()=>{ release(); await worker.stop(); await store.close(); });
  await store.enqueue("org0","investigate",{},"model");
  worker.start();
  await modelStarted;
  await store.enqueue("org0","ingest",{},"fresh-source");
  await sourceReceived;
  assert.equal((await store.query("SELECT state FROM jobs WHERE id='model'")).rows[0].state,"running");
  release();
  await worker.stop();
  assert.equal((await store.query("SELECT state FROM jobs WHERE id='fresh-source'")).rows[0].state,"completed");
});

test("partitioned leases cannot take another lane's work or lease a job twice", async t => {
  const store = await Store.open(); t.after(()=>store.close());
  await store.organization("org0");
  await store.enqueue("org0","investigate",{},"model");
  await store.enqueue("org0","ingest",{},"ingest");
  const background = await store.lease("org0",180000,Date.now(),{excludeKinds:["investigate"]});
  const model = await store.lease("org0",180000,Date.now(),{includeKinds:["investigate"]});
  assert.equal(background.id,"ingest"); assert.equal(model.id,"model");
  assert.equal(await store.lease("org0"),null);
});

test("overlapping ingestion refreshes fetch snapshots in commit order and recover after a failed fetch", async () => {
  const ingestion = new Ingestion(null,null,{}), order=[];
  let release;
  const slow = new Promise(resolve=>{release=resolve;});
  ingestion.syncSnapshot = async ({name}) => {
    order.push(`fetch ${name}`);
    if (name==="old") await slow;
    if (name==="failed") throw Error("connection interrupted");
    order.push(`commit ${name}`);
    return name;
  };
  const old=ingestion.sync({name:"old"}), fresh=ingestion.sync({name:"fresh"});
  await Promise.resolve();
  assert.deepEqual(order,["fetch old"]);
  release(); await Promise.all([old,fresh]);
  assert.deepEqual(order,["fetch old","commit old","fetch fresh","commit fresh"]);
  await assert.rejects(ingestion.sync({name:"failed"}),/interrupted/);
  assert.equal(await ingestion.sync({name:"reconnected"}),"reconnected");
});
