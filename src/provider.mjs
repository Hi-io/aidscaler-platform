import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {check,AppError} from './errors.mjs';
import {hash,uid} from './store.mjs';
export class OpenRouterProvider {
  constructor(store,config,fetcher=fetch){this.store=store;this.config=config;this.fetcher=fetcher;this.pricing=null;}
  async catalogue(){if(this.pricing)return this.pricing;const r=await this.fetcher('https://openrouter.ai/api/v1/models',{signal:AbortSignal.timeout(15000)});check(r.ok,'MODEL_CATALOGUE','Model catalogue is unavailable.',502);const entry=(await r.json()).data.find(m=>m.id===this.config.modelId);check(entry,'MODEL_UNAVAILABLE','Configured model is unavailable.',503);this.pricing={model:entry.id,at:new Date().toISOString(),rates:entry.pricing,modalities:entry.architecture.input_modalities,parameters:entry.supported_parameters};return this.pricing;}
  async complete({org,episode,messages,tools=[],signal}){
    check(this.config.apiKey,'PROVIDER_KEY','No model key is configured on the server.',503);
    const pricing=await this.catalogue(),id=uid('usage'),requestHash=hash({messages,tools,model:this.config.modelId}),maxTokens=2400;
    const approxIn=Math.ceil(JSON.stringify({messages,tools}).length/2),reserve=approxIn*Number(pricing.rates.prompt)+maxTokens*Number(pricing.rates.completion);
    await this.store.transaction(async tx=>{await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org]);const {rows}=await tx.query("SELECT COALESCE(SUM(cost_usd),0) AS spent,COALESCE(SUM(CASE WHEN state='running' THEN reserved_usd ELSE 0 END),0) AS reserved,COUNT(*) AS calls FROM usage WHERE org=$1 AND episode=$2",[org,episode]);check(Number(rows[0].spent)+Number(rows[0].reserved)+reserve<=this.config.budgetUsd,'MODEL_BUDGET','This episode has reached its model budget.',429);check(Number(rows[0].calls)<this.config.maxCalls,'MODEL_CALL_BUDGET','Investigation call limit reached.',429);await tx.query("INSERT INTO usage(id,org,episode,model,request_hash,state,started_at,reserved_usd,pricing) VALUES($1,$2,$3,$4,$5,'running',$6,$7,$8)",[id,org,episode,this.config.modelId,requestHash,Date.now(),reserve,JSON.stringify(pricing)]);});
    const start=performance.now();try{
      const response=await this.fetcher('https://openrouter.ai/api/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${this.config.apiKey}`,'Content-Type':'application/json','HTTP-Referer':'http://localhost:4400','X-Title':'NEXO local disaster-response evaluation'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(this.config.modelTimeoutMs)]):AbortSignal.timeout(this.config.modelTimeoutMs),body:JSON.stringify({model:this.config.modelId,messages,tools:tools.length?tools:undefined,temperature:0.1,max_tokens:maxTokens,provider:{require_parameters:true,sort:'throughput'},reasoning:{enabled:false}})});
      // Provider error payloads may contain echoed requests; never log them.
      check(response.ok,'PROVIDER_HTTP',`Model provider returned HTTP ${response.status}.`,response.status===429?429:502);
      const data=await response.json();check(data.choices?.[0]?.message,'PROVIDER_SCHEMA','The model returned an invalid response.',502);
      const u=data.usage??{},cost=Number.isFinite(u.cost)?u.cost:Number(u.prompt_tokens??0)*Number(pricing.rates.prompt)+Number(u.completion_tokens??0)*Number(pricing.rates.completion);
      const result={message:data.choices[0].message,usage:{promptTokens:u.prompt_tokens??0,outputTokens:u.completion_tokens??0,providerCost:cost,providerRequestId:data.id,wallMs:performance.now()-start},model:data.model??this.config.modelId,pricing,costSource:Number.isFinite(u.cost)?'provider receipt':'catalogue estimate'};
      delete result.message.reasoning;delete result.message.reasoning_details;
      await this.store.query("UPDATE usage SET state='completed',wall_ms=$2,input_tokens=$3,output_tokens=$4,cost_usd=$5,provider_id=$6,result=$7 WHERE id=$1",[id,result.usage.wallMs,result.usage.promptTokens,result.usage.outputTokens,cost,data.id,JSON.stringify(result)]);return result;
    }catch(e){await this.store.query("UPDATE usage SET state='failed',wall_ms=$2,error=$3 WHERE id=$1",[id,performance.now()-start,e.code??e.name]);throw e;}
  }
}
export class ReplayProvider {
  constructor(responses){this.responses=[...responses];this.model='recorded-fixture';}
  async complete(){check(this.responses.length,'REPLAY_EXHAUSTED','No recorded response remains.',503);return {message:this.responses.shift(),model:this.model,usage:{promptTokens:0,outputTokens:0,providerCost:0,wallMs:0},costSource:'fixture'};}
}
