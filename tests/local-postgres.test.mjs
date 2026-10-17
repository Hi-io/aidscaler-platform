import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { localPostgresUrl,createLocalEvaluationDatabases } from '../evaluation/local-postgres.mjs';
import { createHarness } from '../evaluation/harness.mjs';
import { evaluate } from '../../disaster-response-simulator/evaluation/metrics.mjs';

test('native evaluation is loopback-only and cleanup may drop only generated private databases',async()=>{
  for(const url of ['https://localhost/db','postgresql://example.com/db','postgresql://10.0.0.1/db','invalid'])assert.throws(()=>localPostgresUrl(url));
  const queries=[],pool={query:async(sql)=>{queries.push(sql);return{rows:[{server_version:'17.fixture'}]};},end:async()=>{queries.push('END');}};
  const scope=await createLocalEvaluationDatabases('postgresql://fixture:private-dummy@127.0.0.1:5488/postgres',{poolFactory:()=>pool});
  const a=new URL(await scope.createDatabase()),b=new URL(await scope.createDatabase());
  assert.notEqual(a.pathname,b.pathname);assert.match(a.pathname,/^\/aid_eval_[a-f0-9]{32}$/);
  assert.equal(a.username,'fixture');assert.equal(scope.metadata().databases,2);
  const close=scope.close();assert.strictEqual(scope.close(),close);await close;
  assert.equal(queries.filter(q=>q.startsWith('DROP')).length,2);assert.equal(queries.at(-1),'END');
  assert(queries.filter(q=>q.startsWith('DROP')).every(q=>/^DROP DATABASE IF EXISTS "aid_eval_[a-f0-9]{32}" WITH \(FORCE\)$/.test(q)));
  await assert.rejects(scope.createDatabase(),/closed/);
});
test('a failed database creation still releases its reserved private name and the admin pool',async()=>{
  const queries=[],scope=await createLocalEvaluationDatabases('postgresql://127.0.0.1:5488/postgres',{poolFactory:()=>({
    query:async sql=>{queries.push(sql);if(sql.startsWith('CREATE'))throw Error('fixture transport failure');return{rows:[{server_version:'17.fixture'}]};},
    end:async()=>queries.push('END'),
  })});
  await assert.rejects(scope.createDatabase(),/fixture transport/);await scope.close();
  assert(queries.some(q=>q.startsWith('DROP')));assert.equal(queries.at(-1),'END');
});

let connection;
try{connection=JSON.parse(await readFile(new URL('../.local/native-postgres/connection.json',import.meta.url),'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;}
test('native PostgreSQL and in-memory storage preserve identical received actor values and physical outcomes with complete cleanup',
  {skip:!connection?.databaseUrl,timeout:120000},async()=>{
    const args={scenario:'S23',seed:'native-db-backend-parity',organizations:2,provider:{complete:async()=>{throw Error('PAID_CALL_FORBIDDEN');}},
      config:{grid:3,extentKm:2,topology:'grid',hazard:'none',backgroundTraffic:0,postsPerHour:0,healthReports:false,recurringNeeds:false,logMode:'full'}};
    const baseline=await createHarness(args);let native;const names=[];
    try {
      native=await createHarness({...args,evaluationDatabaseUrl:connection.databaseUrl});
      assert.equal(native.storage.backend,'postgres-native-local');assert.equal(native.storage.databases,2);
      for(const h of [baseline,native]) {
        for(const app of h.apps){for(const target of ['map','inventory','vehicles','policy'])await app.connector.action('query',{target},`${app.config.org}-${target}`);await app.ingestion.sync({sources:false});}
        h.lab.world.advance(180000);
        for(const app of h.apps)await app.ingestion.sync({sources:false});
      }
      for(let i=0;i<2;i++) {
        assert.deepEqual(await native.apps[i].connector.state(),await baseline.apps[i].connector.state());
        assert.deepEqual((await native.apps[i].store.get('org'+i,'context','operational')).snapshot,(await baseline.apps[i].store.get('org'+i,'context','operational')).snapshot);
        names.push((await native.apps[i].store.query('SELECT current_database() AS name')).rows[0].name);
      }
      assert.equal(new Set(names).size,2);
      await native.apps[0].store.organization('scope-fixture');await native.apps[1].store.organization('scope-fixture');
      await native.apps[0].store.put('scope-fixture','isolation','same-id',{value:'only-first-database'},0);
      assert.equal(await native.apps[1].store.get('scope-fixture','isolation','same-id',false),null);
      assert.deepEqual(native.lab.world.checkpoint(),baseline.lab.world.checkpoint());
      assert.deepEqual(evaluate(native.lab.world),evaluate(baseline.lab.world));
    }finally{await baseline.close();await native?.close();}
    const admin=new pg.Pool({connectionString:connection.databaseUrl});
    try{assert.equal((await admin.query('SELECT datname FROM pg_database WHERE datname=ANY($1::text[])',[names])).rows.length,0);}
    finally{await admin.end();}
  });
