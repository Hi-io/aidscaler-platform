import {check} from './errors.mjs';
import {uid} from './store.mjs';
export class Worker {
  constructor({store,domain,connector,ingestion,investigator,network,config}){Object.assign(this,{store,domain,connector,ingestion,investigator,network,config});this.running=false;this.timer=null;}
  async execute(id){
    const org=this.config.org,p=await this.store.get(org,'proposal',id);check(['authorized','executing','awaiting_partner'].includes(p.state)&&p.authorization&&!p.conditions.some(c=>!c.satisfied),'AUTHORIZATION_REQUIRED','A current human authorization is required.',403);
    let simId=p.simId;if(!simId){const sp=await this.connector.action('propose',{title:p.title,plan:{actions:p.actions},conditions:[],references:p.references.filter(r=>/^[a-f0-9]{24}$/.test(r))},'sim_propose_'+id);simId=sp.id;await this.store.upsert(org,'proposal',id,{simId});}
    let current=await this.connector.state();let sim=current.proposals.find(x=>x.id===simId);
    if(sim.state==='awaiting_approval'&&!sim.reviewPending)await this.connector.action('review',{id:simId,decision:'approve'},'sim_review_'+id,{human:true});
    const end=Date.now()+15000;while(sim?.state!=='authorized'&&Date.now()<end){await new Promise(r=>setTimeout(r,150));current=await this.connector.state();sim=current.proposals.find(x=>x.id===simId);}check(sim?.state==='authorized','REVIEW_PENDING','The authorized order is still awaiting delivery of the review result.',409);
    const results=p.executionResults??[];
    for(let i=0;i<p.actions.length;i++){
      if(results.some(r=>r.index===i&&r.result))continue;
      const a=p.actions[i],latest=await this.store.get(org,'proposal',id);check(['authorized','executing','awaiting_partner'].includes(latest.state)&&latest.authorization,'AUTHORIZATION_STALE','A dependency changed after authorization.',409);
      const dependencies=a.dependsOn.map(j=>results.find(r=>r.index===j));
      if(dependencies.some(d=>!d?.result||!current.operations.some(o=>o.id===d.result.id&&['received','completed','service','operating'].includes(o.state))))continue;
      if(a.owner!==org){if(!results.some(r=>r.index===i)){const request=await this.network.requestStep(p,i);results.push({index:i,state:'awaiting_partner',owner:a.owner,requestId:request.id});}continue;}
      // The simulator independently checks permissions, route, stock, vehicle and physical state.
      const result=await this.connector.action(a.type,{...a.params,...(a.type==='dispatch'?{proposal:simId}:{})},`execute_${id}_${i}`,{human:true});results.push({index:i,result});
      if(result.id)await this.store.upsert(org,'operation',result.id,{...result,proposalId:id,authorizedBy:p.authorization.by,dependencies:p.dependencies,step:i});
      await this.store.upsert(org,'proposal',id,{executionResults:results,state:'executing'});
    }
    current=await this.connector.state();
    const complete=results.filter(r=>r.result).length===p.actions.length&&results.every(r=>!r.result?.id||current.operations.some(o=>o.id===r.result.id&&['received','completed','service','operating'].includes(o.state)));
    await this.store.transaction(async tx=>{const latest=await tx.get(org,'proposal',id);await tx.put(org,'proposal',id,{...latest,state:complete?'completed':results.some(r=>r.state==='awaiting_partner')?'awaiting_partner':'executing',executionResults:results},latest.version);await tx.audit(org,p.authorization.by,'proposal.executed',id,{simId,results:results.map(r=>({index:r.index,id:r.result?.id,state:r.result?.state??r.state}))});if(!complete)await tx.enqueue(org,'continue_proposal',{id},uid('continue'),Date.now()+3000);});return {simId,results,complete};
  }
  async once(){const job=await this.store.lease(this.config.org);if(!job)return false;try{let result;
    if(job.kind==='ingest')result=await this.ingestion.sync();
    else if(job.kind==='investigate')result=await this.investigator.run(job.payload,job.id);
    else if(job.kind==='execute_proposal')result=await this.execute(job.payload.id);
    else if(job.kind==='continue_proposal')result=await this.execute(job.payload.id);
    else if(job.kind==='expire_commitment')result=await this.domain.expire(job.org,job.payload.id);
    else if(job.kind==='peer_send')result=await this.network.send(job.payload);
    else if(job.kind==='invalidate')result=await this.domain.invalidate({id:'source-monitor',org:job.org,role:'analyst'},job.payload.dependency,job.payload.reason,job.id);
    else throw new Error('Unknown durable job kind.');
    await this.store.finishJob(job.id,result);return true;
  }catch(e){await this.store.failJob(job,e);return true;}}
  start(){if(this.running)return;this.running=true;const loop=async()=>{if(!this.running)return;try{while(this.running&&await this.once()){} }finally{if(this.running)this.timer=setTimeout(loop,500);}};loop();}
  async stop(){this.running=false;clearTimeout(this.timer);}
}
