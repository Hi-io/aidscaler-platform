import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {buildFingerprint,evaluatorFingerprint} from '../evaluation/harness.mjs';
import {simulatorFingerprint} from '../evaluation/simulator-build.mjs';
const id=Date.now(),folder='reports/ui-verifications';await mkdir(folder,{recursive:true});await mkdir('.local/verification',{recursive:true});
const hashes=async()=>({candidateFingerprint:await buildFingerprint(),evaluatorFingerprint:await evaluatorFingerprint(),simulatorFingerprint:await simulatorFingerprint()});
const initial=await hashes(),cases=[];
const journeys=[['ui-test.mjs','ui-verification.json'],['journey-test.mjs','ui-journeys.json'],['review-journey.mjs','ui-review-journeys.json'],['response-journey.mjs','ui-response-journeys.json'],['finance-journey.mjs',null]];
for(const [script,file] of journeys){
 const started=performance.now(),at=new Date().toISOString();
 const result=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['scripts/'+script],{windowsHide:true,stdio:['ignore','pipe','pipe']});let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);p.once('error',reject);p.once('close',(exitCode,signal)=>resolve({exitCode,signal,output}));});
 await writeFile('.local/verification/'+id+'-'+script+'.log',result.output);
 const closed=result.output.trim().split(/\r?\n/).findLast(line=>line.startsWith('{'));
 const delivered=result.exitCode===0&&!file?JSON.parse(closed):null;
 const reportPath=file?'reports/'+file:delivered?.folder+'/result.json';
 const report=result.exitCode===0?JSON.parse(await readFile(reportPath,'utf8')):null;
 cases.push({script,at,exitCode:result.exitCode,signal:result.signal,wallMs:performance.now()-started,reportPath,report});
 console.log(JSON.stringify({script,exitCode:result.exitCode,wallMs:cases.at(-1).wallMs,checks:report?.checks?.length??null,summary:result.output.trim().split(/\r?\n/).slice(-2)}));
 if(result.exitCode!==0)break;
}
const final=await hashes(),unchanged=Object.entries(initial).every(([k,v])=>final[k]===v);
const report={at:new Date().toISOString(),...initial,finalFingerprints:final,unchanged,passed:unchanged&&cases.length===journeys.length&&cases.every(c=>c.exitCode===0),cases,scope:'Automated local browser journeys, including source purchase/partial receipt/financial/public review; no paid model and no human comprehension validation.'};
await writeFile(folder+'/'+id+'.json',JSON.stringify(report,null,2)+'\n');
await writeFile('reports/ui-verification-snapshot.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,unchanged,report:folder+'/'+id+'.json'}));if(!report.passed)process.exitCode=1;

