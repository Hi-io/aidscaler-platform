import {createHash} from 'node:crypto';
export function percentile(values,p){if(!values.length)return null;const s=[...values].sort((a,b)=>a-b);return s[Math.ceil(s.length*p)-1];}
const random=(seed,i)=>Number.parseInt(createHash('sha256').update(`${seed}:${i}`).digest('hex').slice(0,8),16)/2**32;
export function pairedBootstrap(baseline,candidate,{field='uncoveredUnitMs',resource='water',iterations=2000}={}){
  const bySeed=new Map(candidate.map(r=>[r.seed,r]));const pairs=baseline.filter(r=>bySeed.has(r.seed)).map(a=>({a,b:bySeed.get(a.seed)}));if(!pairs.length)return {pairs:0,improvement:null,interval95:null};
  const differences=pairs.map(({a,b})=>(a.metrics.services[resource]?.[field]??0)-(b.metrics.services[resource]?.[field]??0));
  const deltas=Array.from({length:iterations},(_,iteration)=>differences.reduce((n,_,j)=>n+differences[Math.floor(random('paired-bootstrap',iteration*differences.length+j)*differences.length)],0)/differences.length).sort((a,b)=>a-b);
  const meanBaseline=pairs.reduce((n,{a})=>n+(a.metrics.services[resource]?.[field]??0),0)/pairs.length,meanDelta=differences.reduce((a,b)=>a+b,0)/pairs.length;
  return {pairs:pairs.length,unit:'resource units × milliseconds',baselineMean:meanBaseline,delta:meanDelta,improvement:meanBaseline?meanDelta/meanBaseline:null,interval95:[deltas[Math.floor(iterations*.025)],deltas[Math.ceil(iterations*.975)-1]],note:'Positive delta favors the candidate for unmet-demand integral only. One seed is not a statistical validation.'};
}
export function gates(metrics){return {integrity:metrics.ledgerValid,physicalReceipt:metrics.physical.arrivedNotReceived===0,noOrphanReservations:metrics.coordination.orphanReservations===0,noModelFailure:metrics.modelUsage.failed===0,safetyNote:'A passed gate describes the tested episode only.'};}
