import { AppError,check } from './errors.mjs';
import {hash} from './store.mjs';
const decoder=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
export class SimulatorConnector {
  constructor({sourceUrl,sourceAgentKey,sourceHumanKey,fetcher=fetch}){this.url=sourceUrl.replace(/\/$/,'');this.agentKey=sourceAgentKey;this.humanKey=sourceHumanKey;this.fetcher=fetcher;}
  async request(endpoint,{method='GET',body,human=false}={}){
    check(endpoint.startsWith('/api/actor/')||['/api/feed','/api/contracts'].some(p=>endpoint.startsWith(p)),'SOURCE_SCOPE','This connector cannot access observer data.',403);
    const res=await this.fetcher(this.url+endpoint,{method,headers:{Authorization:`Bearer ${human?this.humanKey:this.agentKey}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(10000)});
    const data=await res.json();if(!res.ok)throw new AppError(data.error??'SOURCE',data.message??'Source request failed.',res.status);return data;
  }
  state(){return this.request('/api/actor/state');}
  async feed(cursor=0,limit=100){const result=await this.request('/api/feed?'+new URLSearchParams({cursor,limit}));check(Array.isArray(result.posts),'SOURCE_SCHEMA','Unexpected feed schema. The connector needs a version update.',502);return result;}
  inbox(){return this.request('/api/actor/inbox');}
  async scrape(cursor=0){const r=await this.fetcher(this.url+'/feed?cursor='+cursor,{signal:AbortSignal.timeout(10000)});check(r.ok,'SOURCE_HTTP','Timeline unavailable.',502);const html=await r.text();return {html,hash:hash(html),ids:[...html.matchAll(/data-post-id="([a-f0-9]{24})"/g)].map(m=>m[1]),nextCursor:Number(html.match(/rel="next" href="\/feed\?cursor=(\d+)"/)?.[1]??NaN)};}
  action(type,params,key,{human=false,version}={}){return this.request('/api/actor/action',{method:'POST',human,body:{type,params,idempotencyKey:key,...(version===undefined?{}:{expectedVersion:version})}});}
  ack(post,stage,reason){return this.request('/api/actor/ingestion',{method:'POST',body:{id:post.id,version:post.version,stage,reason,contentHash:hash(post)}});}
  startModel(model){return this.request('/api/actor/model/start',{method:'POST',body:{model}});}
  finishModel(id,receipt){return this.request('/api/actor/model/finish',{method:'POST',body:{id,...receipt}});}
}
export class HttpJsonConnector {
  constructor({url,token,allowedOrigin,fetcher=fetch}){check(new URL(url).origin===allowedOrigin,'CONNECTOR_ORIGIN','The connector origin must be explicitly approved.',403);Object.assign(this,{url,token,fetcher});}
  async read(){const response=await this.fetcher(this.url,{headers:this.token?{Authorization:`Bearer ${this.token}`}:{},signal:AbortSignal.timeout(10000)});check(response.ok,'CONNECTOR_HTTP','Connector is unavailable.',502);return response.json();}
}
export {decoder};
