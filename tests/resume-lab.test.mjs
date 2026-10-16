import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { captureLab, resumeLab, checkpointIdentity } from '../scripts/resume-lab.mjs';
import {spawnLabChild,stopLabChildren,installLauncherControl,requestLauncherShutdown} from '../scripts/lab-lifecycle.mjs';

const simulatorRoot=path.resolve(fileURLToPath(new URL('../../disaster-response-simulator/',import.meta.url))),
  {createLabServers}=await import(pathToFileURL(path.join(simulatorRoot,'sources/server.mjs')).href);
const json=(file,value)=>writeFile(file,JSON.stringify(value),{mode:0o600});
async function fixture(t,{continuousDemo=true,oldBuild=false,logMode='compact'}={}) {
  const rootDir=await mkdtemp(path.join(os.tmpdir(),'aidscaler-resume-')),
    actors=Object.fromEntries(Array.from({length:5},(_,i)=>[
      ['agent-'+i,{id:'agent-'+i,org:'org'+i,role:'agent'}],
      ['owner-'+i,{id:'owner-'+i,org:'org'+i,role:'commander',expiresAt:Date.now()+3600000}],
    ]).flat()),
    lab=await createLabServers({observerPort:0,sourcePort:0,persistCredentials:false,actorKeys:actors,
      config:{grid:5,organizations:5,extentKm:2,backgroundTraffic:1,postsPerHour:10,hazard:'none',policy:'none',mode:'interactive',clockLatency:'wall',continuousDemo,logMode}});
  let open=true;
  t.after(async()=>{if(open) await lab.close(); await rm(rootDir,{recursive:true,force:true});});
  const sessionId='local-resume-fixture',directory=path.join(rootDir,'.local','labs',sessionId),
    observerUrl='http://127.0.0.1:'+lab.observerPort,sourceUrl='http://127.0.0.1:'+lab.sourcePort, instances=[];
  for(let i=0;i<5;i++) {
    const org='org'+i,dir=path.join(directory,org),port=51000+i;
    await mkdir(path.join(dir,'pgdata'),{recursive:true});
    await writeFile(path.join(dir,'pgdata','PG_VERSION'),'17');
    await writeFile(path.join(dir,'server.key'),'existing-cookie-signing-key');
    await json(path.join(dir,'bootstrap.json'),{org,port,sourceUrl,sourceAgentKey:'agent-'+i,sourceHumanKey:'owner-'+i,peers:[]});
    instances.push({org,url:'http://127.0.0.1:'+port});
  }
  await json(path.join(rootDir,'.local','lab.json'),{sessionId,observerUrl,sourceUrl,observerKey:lab.observerKey,instances});
  lab.world.advance(60000);
  if(oldBuild) lab.world.manifest.engineBuild='captured-older-demo-build';
  return {rootDir,lab,directory,close:async()=>{await lab.close();open=false;}};
}

test('capture and strict resume preserve run, clock, private keys, archive data and existing database paths',async t=>{
  const f=await fixture(t), before=checkpointIdentity(f.lab.world.checkpoint()),
    originalLab=await readFile(path.join(f.rootDir,'.local','lab.json'),'utf8'),
    captured=await captureLab({rootDir:f.rootDir});
  assert.equal(captured.now,60000);
  await assert.rejects(()=>resumeLab({rootDir:f.rootDir,simulatorRoot,spawnChildren:false}),/still in use/,'resume never kills an old service');
  await f.close();
  const running=await resumeLab({rootDir:f.rootDir,simulatorRoot,spawnChildren:false});
  t.after(()=>running.close());
  assert.equal(checkpointIdentity(running.lab.world.checkpoint()),before);
  assert.equal(running.receipt.runId,captured.runId);
  assert.equal(running.receipt.migration,null);
  assert.equal(await readFile(path.join(f.rootDir,'.local','lab.json'),'utf8'),originalLab);
  assert.equal(await readFile(path.join(f.directory,'org0','server.key'),'utf8'),'existing-cookie-signing-key');
  const response=await fetch('http://127.0.0.1:'+running.lab.sourcePort+'/api/actor/state',{headers:{Authorization:'Bearer agent-0'}});
  assert.equal(response.status,200,'the original scoped source credential still works');
});

test('an explicit demo-only build migration preserves state and original checkpoint with a separate provenance receipt',async t=>{
  const f=await fixture(t,{oldBuild:true}),capture=await captureLab({rootDir:f.rootDir}),
    original=await readFile(path.join(capture.directory,'checkpoint.json'),'utf8');
  await f.close();
  await assert.rejects(()=>resumeLab({rootDir:f.rootDir,simulatorRoot,spawnChildren:false}),/Strict resume refused/);
  const running=await resumeLab({rootDir:f.rootDir,simulatorRoot,spawnChildren:false,upgradeDemoBuild:true});
  t.after(()=>running.close());
  assert.equal(running.receipt.runId,capture.runId);
  assert.equal(running.receipt.benchmarkEligible,false);
  assert.equal(running.receipt.migration.originalEngineBuild,'captured-older-demo-build');
  assert.equal(running.receipt.originalStateIdentity,running.receipt.restoredStateIdentity);
  assert.equal(running.lab.world.manifest.demoMigrations.length,1);
  assert.equal(await readFile(path.join(capture.directory,'checkpoint.json'),'utf8'),original,'original snapshot is never rewritten');
});

test('benchmark checkpoints and missing local databases cannot use demo migration or trigger fresh bootstrap',async t=>{
  const f=await fixture(t,{continuousDemo:false,oldBuild:true});
  await captureLab({rootDir:f.rootDir}); await f.close();
  await assert.rejects(()=>resumeLab({rootDir:f.rootDir,simulatorRoot,spawnChildren:false,upgradeDemoBuild:true}),/benchmark snapshots cannot be migrated/);
  await rm(path.join(f.directory,'org0','pgdata','PG_VERSION'));
  await assert.rejects(()=>resumeLab({rootDir:f.rootDir,simulatorRoot,spawnChildren:false}),/ENOENT/);
});

test('an explicit old-demo upgrade adds only the absent publication counter from public history',async t=>{
  for (const logMode of ['compact','full']) {
    const f=await fixture(t,{oldBuild:true,logMode}),w=f.lab.world,
      report=w.generateSignal('P01',{text:'Public report to retain in the count',causeEvent:'resume-public'}),
      privateReport=w.generateSignal('P01',{text:'Private team note',causeEvent:'resume-private',audience:['org0']});
    w.generateSignal('P01',{text:'Not published',causeEvent:'resume-unpublished'});
    w.publishPost(report.public.id);w.publishPost(privateReport.public.id);
    report.deleted=true;w.state.posts.persist?.(report);
    const expectedCount=w.state.statistics.publicPostsPublished;
    delete w.state.statistics.publicPostsPublished;
    const capture=await captureLab({rootDir:f.rootDir}),
      original=JSON.parse(await readFile(path.join(capture.directory,'checkpoint.json'),'utf8'));
    await f.close();
    const running=await resumeLab({rootDir:f.rootDir,simulatorRoot,spawnChildren:false,upgradeDemoBuild:true});
    try {
      const restored=running.lab.world.checkpoint();
      assert.equal(restored.state.statistics.publicPostsPublished,expectedCount,'deleted public posts count, private and unpublished reports do not');
      assert.deepEqual(running.receipt.migration.stateAdditions.map(a=>({path:a.path,value:a.value})),[{path:'state.statistics.publicPostsPublished',value:expectedCount}]);
      assert.equal(running.receipt.restoredStateIdentity,running.receipt.expectedRestoredStateIdentity);
      delete restored.state.statistics.publicPostsPublished;
      assert.equal(checkpointIdentity(restored),checkpointIdentity(original),'every other state value, event, counter, idempotency record and run field is unchanged');
      assert.equal(JSON.parse(await readFile(path.join(capture.directory,'checkpoint.json'),'utf8')).state.statistics.publicPostsPublished,undefined,'the original checkpoint remains unchanged');
    } finally {await running.close();}
  }
});

test('private launcher shutdown rejects outsiders and closes its actual child store before the final capture',async t=>{
  const f=await fixture(t),entry=path.join(f.rootDir,'owned-child.mjs'),marker=path.join(f.rootDir,'child-closed.txt');
  await writeFile(entry,`import {DatabaseSync} from 'node:sqlite';import {writeFile} from 'node:fs/promises';
const db=new DatabaseSync('owned-child.sqlite');db.exec("CREATE TABLE status(value TEXT);INSERT INTO status VALUES('writing')");
const timer=setInterval(()=>{},1000);process.once('SIGTERM',async()=>{await new Promise(r=>setTimeout(r,30));db.exec("UPDATE status SET value='closed'");db.close();await writeFile('child-closed.txt','closed');clearInterval(timer);process.exit(0);});process.send({ready:true});`);
  const child=spawnLabChild({rootDir:f.rootDir,instanceDir:path.join(f.directory,'org0'),org:'org0',port:51000,entry});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('Fixture child exited before ready: '+code)));});
  let called=0;
  const control=await installLauncherControl({rootDir:f.rootDir,onShutdown:async()=>{
    called++;await stopLabChildren([child],{timeoutMs:10000});
    assert.equal(await readFile(marker,'utf8'),'closed');
    const captured=await captureLab({rootDir:f.rootDir});await f.close();return captured;
  }});
  t.after(()=>control.close());
  const secret=JSON.parse(await readFile(path.join(f.directory,'launcher-control.json'),'utf8')),
    refused=await fetch(secret.url+'/shutdown',{method:'POST'});
  assert.equal(refused.status,401);assert.equal(called,0);assert.equal(child.exitCode,null);
  const result=await requestLauncherShutdown({rootDir:f.rootDir});
  assert.equal(result.coordinatedCapture,true);assert.equal(called,1);assert.equal(child.exitCode,0);
  const status=JSON.parse(await readFile(path.join(f.directory,'launcher-status.json'),'utf8'));
  assert.equal(status.state,'stopped');
  const resumed=await resumeLab({rootDir:f.rootDir,simulatorRoot,spawnChildren:false});
  try{assert.equal(resumed.receipt.now,60000);}finally{await resumed.close();}
});

test('an unclean launcher marker refuses pairing an older world capture with potentially newer databases',async t=>{
  const f=await fixture(t);await captureLab({rootDir:f.rootDir});await f.close();
  await json(path.join(f.directory,'launcher-status.json'),{sessionId:'local-resume-fixture',state:'running',pid:999999});
  await assert.rejects(()=>resumeLab({rootDir:f.rootDir,simulatorRoot,spawnChildren:false}),/older world snapshot must not be paired with newer databases/);
});

test("isolated worker resume retains the exact world and can capture and resume again through materialized APIs", async (t) => {
  const f = await fixture(t),
    before = checkpointIdentity(f.lab.world.checkpoint());
  await captureLab({ rootDir: f.rootDir });
  await f.close();
  const running = await resumeLab({
    rootDir: f.rootDir,
    simulatorRoot,
    spawnChildren: false,
    isolated: true,
  });
  try {
    assert.ok(
      running.lab.runtime,
      "the connected runtime owns a separate engine worker",
    );
    assert.equal(checkpointIdentity(await running.lab.checkpoint()), before);
    const response = await fetch(
      "http://127.0.0.1:" +
        running.lab.sourcePort +
        "/api/actor/state?compact=1",
      {
        headers: { Authorization: "Bearer agent-0" },
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).compact.version, 1);
    const capture = await running.close({ capture: true });
    assert.equal(capture.now, 60000);
  } finally {
    await running.close();
  }
  const resumed = await resumeLab({
    rootDir: f.rootDir,
    simulatorRoot,
    spawnChildren: false,
    isolated: true,
  });
  try {
    assert.equal(checkpointIdentity(await resumed.lab.checkpoint()), before);
  } finally {
    await resumed.close();
  }
});
