import {hash} from './store.mjs';
import {check} from './errors.mjs';
export class Ingestion {
  constructor(store,connector,config){Object.assign(this,{store,connector,config});}
  async sync(){
    const org=this.config.org;let downloaded=0,changed=0;const began=performance.now();
    try{
      const state=await this.connector.state();check(state.organization.id===org,'SOURCE_ORG','The source key belongs to a different organization.',403);
      let cursor=0,pages=0;const receiptIds=[];
      do{const feed=await this.connector.feed(cursor,100);for(const p of feed.posts){downloaded++;const old=await this.store.get(org,'signal',p.id,false);if(old?.sourceVersion>=p.version)continue;
        await this.connector.ack(p,'downloaded');const group=hash(p.references?.[0]??p.text.toLowerCase().replace(/\s+/g,' ').trim());
        await this.store.transaction(async tx=>{await tx.upsert(org,'signal',p.id,{...p,sourceVersion:p.version,source:'Signal social network',sourceUrl:`${this.config.sourceUrl}/posts/${p.id}`,contentHash:hash(p),receivedAt:Date.now(),state:p.deleted?'withdrawn':'unverified',group,modality:p.attachments?.[0]?.kind??'text',permissions:'organization',originalReferences:p.references??[]});if(old)await tx.audit(org,'connector','signal.revised',p.id,{from:old.sourceVersion,to:p.version});});
        await this.connector.ack(p,'accepted');changed++;receiptIds.push(p.id);
      }cursor=feed.nextCursor??feed.next;pages++;if(cursor==null)break;}while(pages<2);
      const team=await this.connector.inbox();for(const p of team.posts??[]){const old=await this.store.get(org,'signal',p.id,false);if(old?.sourceVersion>=p.version)continue;await this.store.upsert(org,'signal',p.id,{...p,sourceVersion:p.version,source:'Authorized team channel',sourceUrl:null,contentHash:hash(p),receivedAt:Date.now(),state:'observed',group:hash(p.references?.[0]??p.text),modality:p.attachments?.[0]?.kind??'text',permissions:'organization'});changed++;receiptIds.push(p.id);}
      await this.store.transaction(async tx=>{
        await tx.upsert(org,'source','simulator',{state:'connected',lastSuccessAt:Date.now(),runId:state.runId,simulatedAt:state.now,downloaded,changed,wallMs:performance.now()-began});
        const old=await tx.get(org,'context','operational',false);if(!old||hash(old.snapshot)!==hash(state))await tx.upsert(org,'context','operational',{snapshot:state,observedAt:Date.now()});
        for(const [kind,items] of [['resource',state.known.resources],['vehicle',state.known.vehicles],['need',state.known.needs],['facility',state.known.buildings],['road',state.known.edges]])for(const [sourceId,raw] of Object.entries(items??{})){const data={...raw,id:raw.id??sourceId};const previous=await tx.get(org,kind,data.id,false);if(!previous||hash(previous.sourceSnapshot)!==hash(data)){await tx.upsert(org,kind,data.id,{...data,sourceSnapshot:data,owner:data.owner??org,sourceVersion:data.version??1,reserved:data.reserved??0,floor:data.floor??0});if(previous&&(data.version??0)>(previous.sourceVersion??0))await tx.enqueue(org,'invalidate',{dependency:data.id,reason:'Source state changed'},`change_${kind}_${data.id}_${data.version}`);}}
        for(const data of state.operations??[])await tx.upsert(org,'operation',data.id,{...data,sourceSnapshot:data,confirmedBySource:true});
        for(const i of state.inspections??[])await tx.upsert(org,'verification',i.id,i);
        const mapQuery=state.queries?.filter(q=>q.target==='map'&&q.state==='ready').at(-1);if(mapQuery?.result)await tx.upsert(org,'context','geography',{map:mapQuery.result,observedAt:mapQuery.completedAt});
        await tx.audit(org,'connector','source.synced','simulator',{downloaded,changed,simulatedAt:state.now,wallMs:performance.now()-began});
        if(changed&&this.config.autoInvestigate)await tx.enqueue(org,'investigate',{ids:receiptIds.slice(0,30)},`investigate_${state.runId}_${hash(receiptIds)}`);
      });return {downloaded,changed,now:state.now};
    }catch(e){await this.store.upsert(org,'source','simulator',{state:'degraded',lastFailureAt:Date.now(),error:e.code??'SOURCE_UNAVAILABLE'});throw e;}
  }
}
