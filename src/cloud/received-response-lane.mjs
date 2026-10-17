import { hash } from '../store.mjs';
import { responseQueue } from '../response-policy.mjs';
import { sourceConnection } from '../source-connection.mjs';

// An open-ended source inquiry must not hold already received operational facts
// hostage. This schedules the existing checked compiler, not an AI completion,
// approval, reservation or dispatch. Its own trace explicitly records zero calls.
export async function queueReceivedResponse(app) {
  if (!app.demoVisitor || app.demoEnding) return false;
  const {store,config}=app,org=config.org;
  if ((await sourceConnection(store,org))?.state==='requires_new_response') return false;
  const queue=await responseQueue(store,org,{limit:100});
  if (!queue.policy.approved || queue.openReviews>=queue.policy.maxOpenReviews ||
      !queue.rows.some(n=>n.type!=='shelter'&&(n.planningOutstanding??n.outstanding)>0)) return false;
  return store.transaction(async tx=>{
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);
    const previous=await tx.get(org,'cloud_automation','received_response',false);
    if(previous?.signature===queue.signature)return false;
    const pending=await tx.query("SELECT id FROM jobs WHERE org=$1 AND kind='compile_response' AND state IN ('queued','running','retry') LIMIT 1",[org]);
    if(pending.rows.length)return false;
    const id='received_response_'+hash([org,queue.signature]);
    await tx.upsert(org,'activity',id,{state:'queued',kind:'structured_response',model:null,calls:0,
      startedAt:Date.now(),proposalId:null,steps:[{type:'compilation',state:'pending',
        label:'Checking already received needs and capacity under the approved response policy',at:Date.now()}]});
    await tx.enqueue(org,'compile_response',{automatic:true,receivedFactsOnly:true},id);
    await tx.upsert(org,'cloud_automation','received_response',{signature:queue.signature,activityId:id});
    return true;
  });
}
