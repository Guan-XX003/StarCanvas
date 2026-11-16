/** Local metadata inspection only. Never resolves/fetches a media URL, checks
 * a paid endpoint, starts a job or returns credentials, prompt text or paths.
 */
import {resolveModelApiBindingIdHelper} from './model-binding';
import type {CanvasPlanCapabilities,CanvasPlanState,PlanNode} from './canvas-operation-plan';
export type CanvasApiPresence='present'|'missing'|'missing-binding'|'unverified'|'not-required';
export type CanvasGenerationDefaults=Partial<Record<'text'|'image'|'video',{url?:unknown;key?:unknown}>>;
const filled=(value:unknown)=>typeof value==='string'&&!!value.trim();
export function canvasNodeTaskBusy(node:PlanNode) {
 return node.data?.loading===true||node.data?.generating===true||['pending','queued','running','processing','submitted'].includes(node.data?.taskStatus);
}
export function canvasGenerationApiPresence(node:PlanNode,defaults:CanvasGenerationDefaults):CanvasApiPresence {
 const d=node.data||{},kind=node.type==='textNode'?'text':node.type==='promptNode'?'image':node.type==='videoNode'?'video':null;
 if(!kind)return 'not-required';
 const bindings=kind==='text'?d.textModelApiBindings:kind==='image'?d.imageModelApiBindings:d.videoModelApiBindings;
 // Text generation currently follows its model binding, not a per-node API
 // picker. Do not claim an ignored override is the effective configuration.
 const bound=resolveModelApiBindingIdHelper(bindings,String(d.selectedModel||''),'');
 if(kind==='text'&&(d.selectedApiConfigId||d.apiConfigId)&&String(d.selectedApiConfigId||d.apiConfigId)!==bound)return 'unverified';
 const id=kind==='text'?bound:d.selectedApiConfigId||d.apiConfigId||bound;
 const config=(Array.isArray(d.apiConfigs)?d.apiConfigs:[]).find(c=>c?.id===id);
 if(id&&!config)return 'missing-binding';
 if(config?.managed===true||String(config?.key||'').includes('__WANJUAN_MANAGED_RELAY__')||String(defaults[kind]?.key||'').includes('__WANJUAN_MANAGED_RELAY__'))return 'unverified';
 if(config&&(!filled(config.url)||!filled(config.key)))return 'missing';
 const url=config?.url||defaults[kind]?.url,key=config?.key||defaults[kind]?.key;
 return filled(url)&&/^https?:\/\//i.test(String(url).trim())&&filled(key)?'present':'missing';
}
function sourceReady(node:PlanNode|undefined) {
 if(!node)return 'missing' as const;
 const d=node.data||{};
 if(node.type==='textNode')return filled(d.text)?'ready' as const:'pending' as const;
 if(node.type==='imageNode'||node.type==='promptNode')return filled(d.imageUrl)?'ready' as const:'pending' as const;
 if(node.type==='videoNode')return filled(d.videoUrl)?'ready' as const:'pending' as const;
 return 'unverified' as const;
}
export function inspectCanvasGenerationPreflight(state:CanvasPlanState,ids:string[],capabilities:CanvasPlanCapabilities,apiPresence:(node:PlanNode)=>CanvasApiPresence=()=> 'unverified',basis:'proposal'|'current'='current') {
 const byId=new Map(state.nodes.map(n=>[n.id,n])),incoming=new Map<string,string[]>();
 for(const edge of state.edges){const sources=incoming.get(edge.target)||[];sources.push(edge.source);incoming.set(edge.target,sources);}
 const nodes=[...new Set(ids)].map(id=>{
  const n=byId.get(id);
  if(!n)return {nodeId:id,type:'missing',mode:'missing',model:'unconfirmed',configuration:'unverified',input:false,references:'missing',taskIdle:false,locallyReady:false};
  const d=n.data||{},cap=capabilities[`node:${id}`]||capabilities[n.type||''];
  const reference=n.type==='imageNode'||n.type==='videoNode'&&filled(d.videoUrl)&&!filled(d.prompt);
  const textSource=n.type==='textNode'&&filled(d.text)&&!filled(d.prompt);
  const mode=reference?'reference':textSource?'text-source':'generation';
  const model=mode!=='generation'?'not-required':filled(d.selectedModel)&&cap?.models.includes(d.selectedModel)?'available':'unconfirmed';
  const sources=(incoming.get(id)||[]).map(source=>byId.get(source)),readiness=sources.map(sourceReady);
  const references=readiness.includes('missing')?'missing':readiness.includes('pending')?'pending':readiness.includes('unverified')?'unverified':readiness.length?'ready':'none';
  const input=mode==='reference'?sourceReady(n)==='ready':filled(d.prompt)||filled(d.text)||sources.some(source=>filled(source?.data?.text));
  const configuration=mode==='generation'?apiPresence(n):'not-required',taskIdle=!canvasNodeTaskBusy(n);
  return {nodeId:id,type:n.type,mode,model,configuration,input,references,taskIdle,
   locallyReady:taskIdle&&input&&['ready','none'].includes(references)&&['available','not-required'].includes(model)&&['present','not-required'].includes(configuration)};
 });
 return {basis,generationStarted:false as const,canGenerate:false as const,networkChecked:false as const,balanceChecked:false as const,nodes};
}
