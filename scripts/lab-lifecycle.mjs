import http from 'node:http';
import path from 'node:path';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {spawn} from 'node:child_process';

const childTokens=new WeakMap(),preload=new URL('./lab-child-control.mjs',import.meta.url).href;
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
const privateJSON=(file,value)=>writeFile(file,JSON.stringify(value,null,2),{mode:0o600});
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function currentSession(rootDir) {
  const current=await readJSON(path.join(rootDir,'.local','lab.json'));
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(current.sessionId))throw Error('Invalid local laboratory session.');
  const directory=path.join(rootDir,'.local','labs',current.sessionId);await stat(directory);
  return {current,directory};
}
export function spawnLabChild({rootDir,instanceDir,org,port,bootstrapPassword,entry=org==='org4'?'scripts/partner.mjs':'server.mjs',spawnProcess=spawn}) {
  const token=randomBytes(32).toString('hex'),child=spawnProcess(process.execPath,
    ['--env-file-if-exists=.env.local','--import',preload,entry],{
      cwd:rootDir,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],
      env:{...process.env,AIDSCALER_LOCAL_DIR:instanceDir,AIDSCALER_ORG:org,PORT:String(port),
        ...(bootstrapPassword === undefined ? {} : { AIDSCALER_BOOTSTRAP_PASSWORD: bootstrapPassword }),
        DATA_DIR:path.join(instanceDir,'pgdata'),EVIDENCE_DIR:path.join(instanceDir,'evidence'),DATABASE_URL:'',AIDSCALER_CHILD_CONTROL_TOKEN:token},
    });
  childTokens.set(child,token);return child;
}
export async function stopLabChildren(children,{timeoutMs=180000}={}) {
  await Promise.all(children.map(child=>new Promise((resolve,reject)=>{
    if(child.exitCode!==null)return child.exitCode===0?resolve():reject(Error('An owned backend exited uncleanly; no coordinated snapshot can be claimed.'));
    const token=childTokens.get(child);
    if(!token||!child.connected)return reject(Error('An owned backend has no graceful IPC channel. Stop it explicitly before capturing; it was not force-killed.'));
    const timer=setTimeout(()=>finish(Error('A backend is still finishing work. It was not force-killed and no final snapshot was captured.')),timeoutMs);
    const onExit=(code)=>finish(code===0?null:Error('An owned backend exited uncleanly; no final snapshot was captured.'));
    function finish(error){clearTimeout(timer);child.removeListener('exit',onExit);error?reject(error):resolve();}
    child.once('exit',onExit);
    try{child.send({type:'aidscaler-lab-shutdown',token},error=>{if(error)finish(Error('The backend shutdown request could not be delivered. No process was force-killed.'));});}
    catch{finish(Error('The backend shutdown channel closed before confirmation. No process was force-killed.'));}
  })));
}
/** Private localhost control; no route terminates arbitrary PIDs or services. */
export async function installLauncherControl({rootDir,onShutdown,onStopped=()=>{}}) {
  const {current,directory}=await currentSession(rootDir),token=randomBytes(32).toString('hex'),
    statusFile=path.join(directory,'launcher-status.json'),controlFile=path.join(directory,'launcher-control.json');
  let shutdownPromise=null,closed=false;
  const status={format:'aidscaler-lab-launcher-v1',sessionId:current.sessionId,pid:process.pid,state:'running',startedAt:Date.now()};
  const server=http.createServer(async(req,res)=>{
    const respond=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
    if(!equal(req.headers.authorization?.replace(/^Bearer /,''),token))return respond(401,{error:'AUTHENTICATION'});
    if(req.method!=='POST'||req.url!=='/shutdown')return respond(404,{error:'NOT_FOUND'});
    if(req.headers.origin&&!['http://127.0.0.1:'+server.address().port,'http://localhost:'+server.address().port].includes(req.headers.origin))return respond(403,{error:'ORIGIN'});
    if(!shutdownPromise)shutdownPromise=(async()=>{
      await privateJSON(statusFile,{...status,state:'stopping',requestedAt:Date.now()});
      const receipt=await onShutdown();
      if(receipt?.sessionId!==current.sessionId||!receipt.directory||!receipt.runId||!Number.isSafeInteger(receipt.now))
        throw Error('A matching final capture receipt is required before shutdown can be marked coordinated.');
      await privateJSON(statusFile,{...status,state:'stopped',stoppedAt:Date.now(),coordinatedCapture:true});
      return receipt;
    })().catch(async error=>{await privateJSON(statusFile,{...status,state:'failed',failedAt:Date.now()});shutdownPromise=null;throw error;});
    try {
      await shutdownPromise;
      respond(200,{stopped:true,coordinatedCapture:true,sessionId:current.sessionId});
      setImmediate(()=>server.close(()=>{closed=true;onStopped();}));
    } catch {respond(500,{error:'SHUTDOWN_INCOMPLETE',message:'The launcher could not finish a coordinated shutdown. No successful final snapshot is claimed. Check the owned processes.'});}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  await privateJSON(controlFile,{format:'aidscaler-lab-control-v1',sessionId:current.sessionId,pid:process.pid,url:'http://127.0.0.1:'+server.address().port,token,createdAt:Date.now()});
  await privateJSON(statusFile,status);
  return {async close(){if(closed)return;closed=true;await new Promise(resolve=>server.close(resolve));}};
}
export async function requestLauncherShutdown({rootDir}={}) {
  const {current,directory}=await currentSession(rootDir),control=await readJSON(path.join(directory,'launcher-control.json')),
    url=new URL(control.url);
  if(control.format!=='aidscaler-lab-control-v1'||control.sessionId!==current.sessionId||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port||url.pathname!=='/'||!control.token)
    throw Error('No valid private launcher control is available. No process was terminated.');
  let response;
  try {response=await fetch(control.url+'/shutdown',{method:'POST',headers:{Authorization:'Bearer '+control.token},signal:AbortSignal.timeout(240000)});}
  catch {throw Error('The private launcher is unavailable or still finishing work. No process was force-killed; verify its status before resuming.');}
  if(!response.ok)throw Error('Coordinated shutdown did not complete. No process was force-killed; inspect the launcher before resuming.');
  const result=await response.json();
  if(result.sessionId!==current.sessionId||result.coordinatedCapture!==true)throw Error('Shutdown receipt does not match this session.');
  return result;
}
