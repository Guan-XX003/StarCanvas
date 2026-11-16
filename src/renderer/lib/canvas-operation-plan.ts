/** Local, ephemeral canvas plans. Model JSON is a proposal, never authority.
 * No fetch, arbitrary file/URL input, generation, credentials or persistence here.
 * The application owns read tickets, confirmation and the normal canvas commit.
 */
import { wanjuanStripRuntimeNodeData } from './node-runtime-contract';
import { CANVAS_PLANNING_NEW_BOUNDS } from '../../../electron/shared/canvas-planning-protocol.mjs';
import {canvasNodeTaskBusy,inspectCanvasGenerationPreflight,type CanvasApiPresence} from './canvas-generation-preflight';

export type PlanNode = {id:string;type?:string;position:{x:number;y:number};data:any;[key:string]:any};
export type PlanEdge = {id:string;source:string;target:string;[key:string]:any};
export type CanvasPlanState = {projectId:string;instanceId:string;ready:boolean;nodes:PlanNode[];edges:PlanEdge[];configurationIdentity?:unknown};
export type CanvasPlanCapabilities = Record<string, {models:string[];parameters:Record<string,string[]>;modelParameters?:Record<string,Record<string,string[]>>}>;
export type CanvasConfigurationSummary=Record<'image'|'video',{modelCount:number;configuration:CanvasApiPresence}>;
export type CanvasPlanOperation =
 | {op:'create';key:string;kind:'text'|'image'|'video';position:{x:number;y:number};fields:Record<string,string>}
 | {op:'reference';key:string;source:string;position:{x:number;y:number}}
 | {op:'update';node:string;fields:Record<string,string>}
 | {op:'connect';source:string;target:string}
 | {op:'move';node:string;position:{x:number;y:number}};
export type CanvasPlanProposal = {version:1;operations:CanvasPlanOperation[]};
export const CANVAS_PLAN_TYPES = {text:'textNode',image:'promptNode',video:'videoNode'} as const;
const supportedTypes = new Set(['textNode','promptNode','videoNode','imageNode']);
const textFields:Record<string,string[]> = {
 textNode:['label','prompt','text'], promptNode:['label','prompt'], videoNode:['label','prompt'], imageNode:['label'],
};
export class CanvasPlanError extends Error {
 constructor(public code:string) {super(code);this.name='CanvasPlanError';}
}
const fail = (code:string):never => {throw new CanvasPlanError(code);};
const isRecord = (x:any):x is Record<string,any> => !!x && typeof x==='object' && !Array.isArray(x) && [Object.prototype,null].includes(Object.getPrototypeOf(x));
function exact(x:any, keys:string[]) {
 if (!isRecord(x)||Object.keys(x).some(key=>!keys.includes(key))) fail('PLAN_INVALID');
}
function token(x:any) {if (typeof x!=='string'||!x||x.length>160||!/^[-A-Za-z0-9_:.[\]]+$/.test(x)) fail('PLAN_INVALID');return x as string;}
function position(x:any) {
 exact(x,['x','y']);
 if (!Number.isFinite(x.x)||!Number.isFinite(x.y)||Math.abs(x.x)>100000||Math.abs(x.y)>100000) fail('PLAN_INVALID');
 return {x:x.x,y:x.y};
}
function fields(x:any) {
 if (!isRecord(x)||Object.keys(x).length>16) fail('PLAN_INVALID');
 const out:Record<string,string>={};
 for (const [key,value] of Object.entries(x)) {
  if (typeof value!=='string'||value.length>(['prompt','text'].includes(key)?16000:512)||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('PLAN_INVALID');
  Object.defineProperty(out,key,{value,enumerable:true});
 }
 return out;
}
export function parseCanvasPlan(input:unknown):CanvasPlanProposal {
 exact(input,['version','operations']);const x=input as any;
 if (x.version!==1||!Array.isArray(x.operations)||!x.operations.length||x.operations.length>60) fail('PLAN_INVALID');
 const operations=x.operations.map((o:any):CanvasPlanOperation=>{
  if (!isRecord(o)) return fail('PLAN_INVALID');
  if (o.op==='create') {
   exact(o,['op','key','kind','position','fields']);
   if (!Object.hasOwn(CANVAS_PLAN_TYPES,o.kind)) fail('PLAN_NODE_UNSUPPORTED');
   return {op:o.op,key:token(o.key),kind:o.kind,position:position(o.position),fields:fields(o.fields)};
  }
  if (o.op==='reference') {exact(o,['op','key','source','position']);return {op:o.op,key:token(o.key),source:token(o.source),position:position(o.position)};}
  if (o.op==='update') {exact(o,['op','node','fields']);const f=fields(o.fields);if(!Object.keys(f).length)fail('PLAN_INVALID');return {op:o.op,node:token(o.node),fields:f};}
  if (o.op==='move') {exact(o,['op','node','position']);return {op:o.op,node:token(o.node),position:position(o.position)};}
  if (o.op==='connect') {exact(o,['op','source','target']);return {op:o.op,source:token(o.source),target:token(o.target)};}
  return fail('PLAN_OPERATION_UNSUPPORTED');
 });
 const proposal={version:1 as const,operations};
 if(new TextEncoder().encode(JSON.stringify(proposal)).byteLength>256*1024)fail('PLAN_INVALID');
 return proposal;
}
/** Stable comparison remains private in this controller; it may include private
 * node content but is never returned as a version token, logged or sent upstream.
 * Ignore only transient ReactFlow presentation. Task/content changes invalidate.
 */
function stable(value:any,depth=0):string {
 if (depth>30) return fail('PLAN_STATE_UNAVAILABLE');
 if (value===null) return 'null';
 if (typeof value==='function'||typeof value==='undefined') return '';
 if (typeof value==='string'||typeof value==='boolean') return JSON.stringify(value);
 if (typeof value==='number') return Number.isFinite(value)?JSON.stringify(value):'null';
 if (Array.isArray(value)) return '['+value.map(v=>stable(v,depth+1)||'null').join(',')+']';
 if (!isRecord(value)) return fail('PLAN_STATE_UNAVAILABLE');
 return '{'+Object.keys(value).sort().filter(k=>typeof value[k]!=='function'&&value[k]!==undefined).map(k=>JSON.stringify(k)+':'+stable(value[k],depth+1)).join(',')+'}';
}
const transientNodeKeys=new Set(['selected','dragging','resizing','measured','domAttributes','internals','computedPosition','positionAbsolute','zIndex']);
function durableNode(node:PlanNode) {
 const copy:any={};
 for (const [key,value] of Object.entries(node)) if(!transientNodeKeys.has(key)&&key!=='data') copy[key]=value;
 copy.data=wanjuanStripRuntimeNodeData(node.data||{});
 return copy;
}
export function canvasPlanStateSignature(state:CanvasPlanState) {
 return stable({projectId:state.projectId,instanceId:state.instanceId,ready:state.ready,configurationIdentity:state.configurationIdentity,
  nodes:state.nodes.filter(n=>n.id!=='ghost-target').map(durableNode),
  edges:state.edges.filter(e=>e.id!=='ghost-edge').map(({selected,...edge})=>edge)});
}
const busy=canvasNodeTaskBusy;
function checkFields(node:PlanNode,patch:Record<string,string>,capabilities:CanvasPlanCapabilities) {
 const cap=capabilities[`node:${node.id}`]||capabilities[node.type||''];
 const model=patch.selectedModel??node.data?.selectedModel??cap?.models[0];
 const parameters=cap?.modelParameters&&Object.hasOwn(cap.modelParameters,model)?cap.modelParameters[model]:cap?.parameters||{};
 for (const [key,value] of Object.entries(patch)) {
  if (textFields[node.type||'']?.includes(key)) continue;
  if (key==='selectedModel'&&cap?.models.includes(value)) continue;
  if (Object.hasOwn(parameters,key)&&Array.isArray(parameters[key])&&parameters[key].includes(value)) continue;
  fail('PLAN_PARAMETER_UNAVAILABLE');
 }
 const f={...node.data,...patch};
 if (Object.hasOwn(patch,'selectedModel')) {f.wanjuanModelManual=true;f.wanjuanModelAuto=false;}
  // A model change must not silently carry a now-invalid size/duration into
  // its request builder. The proposal must include a valid replacement.
  if(Object.hasOwn(patch,'selectedModel'))for(const [key,values]of Object.entries(parameters))if(typeof f[key]==='string'&&f[key]&&!values.includes(f[key]))fail('PLAN_PARAMETER_UNAVAILABLE');
 return {...node,data:f};
}
/** Connections match the existing request builders. No audio/custom/tool nodes,
 * fabricated media references, custom handles, cycles or new paid operations.
 */
function compatible(source:PlanNode,target:PlanNode) {
 if (!['textNode','promptNode','videoNode'].includes(target.type||'')) return false;
 if (target.type==='videoNode') return ['textNode','promptNode','imageNode','videoNode'].includes(source.type||'');
 return ['textNode','promptNode','imageNode'].includes(source.type||'');
}
function cyclic(edges:PlanEdge[]) {
 const adj=new Map<string,string[]>(),degree=new Map<string,number>();
 for(const e of edges){const list=adj.get(e.source)||[];list.push(e.target);adj.set(e.source,list);degree.set(e.source,degree.get(e.source)||0);degree.set(e.target,(degree.get(e.target)||0)+1);}
 const queue=[...degree].filter(([,d])=>!d).map(([id])=>id);let visited=0;
 for(let i=0;i<queue.length;i++){visited++;for(const n of adj.get(queue[i])||[]){const d=degree.get(n)!-1;degree.set(n,d);if(!d)queue.push(n);}}
 return visited!==degree.size;
}

type Ticket = {id:string;signature:string;capSignature:string;environmentSignature:string;environmentTracking?:boolean;environmentInvalid?:boolean;projectId:string;instanceId:string;nodeIds:Set<string>;expires:number;invalid:boolean};
type Prepared = {id:string;ticket:Ticket;proposal:CanvasPlanProposal;affectedNodeIds:string[];signature:string;before:CanvasPlanState;after:CanvasPlanState;status:'preview'|'applied'|'undone'|'expired';undoInvalid?:boolean;result?:any};
function copyValue(value:any,depth=0):any {
 if(depth>30)fail('PLAN_STATE_UNAVAILABLE');
 if(Array.isArray(value))return value.map(v=>copyValue(v,depth+1));
 if(isRecord(value))return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,copyValue(v,depth+1)]));
 if(value&&typeof value==='object')fail('PLAN_STATE_UNAVAILABLE');
 return value;
}
export interface CanvasPlanAdapter {
 read:()=>CanvasPlanState;
 capabilities:()=>CanvasPlanCapabilities;
 prepareNode:(type:string,position:{x:number;y:number},data:Record<string,any>)=>PlanNode;
 /** Synchronous atomic/batched mutation through the normal canvas owner. */
 commit:(before:CanvasPlanState,after:CanvasPlanState)=>void;
 apiPresence?:(node:PlanNode)=>CanvasApiPresence;
 /** Local-only summary: no tickets, content, credentials or network probe. */
 configurationSummary?:()=>CanvasConfigurationSummary;
 id?:()=>string;now?:()=>number;
}
export function createCanvasPlanController(adapter:CanvasPlanAdapter) {
 const tickets=new Map<string,Ticket>(),plans=new Map<string,Prepared>();
 const now=adapter.now||Date.now,uid=adapter.id||(()=>crypto.randomUUID());
 const state=()=>{const s=adapter.read();if(!s.ready||!s.projectId||!s.instanceId)fail('PLAN_CANVAS_NOT_READY');return s;};
 const caps=()=>adapter.capabilities();
 function prune() {
  for(const [id,t] of tickets)if(t.expires<now())tickets.delete(id);
  for(const [id,p] of plans)if(p.ticket.expires<now())plans.delete(id);
  if(tickets.size>=32||plans.size>=16)fail('PLAN_LIMIT');
 }
 function current(ticket:Ticket) {
  if(ticket.invalid||now()>ticket.expires)fail('PLAN_EXPIRED');
  const s=state();
  if(s.projectId!==ticket.projectId||s.instanceId!==ticket.instanceId||canvasPlanStateSignature(s)!==ticket.signature||stable(caps())!==ticket.capSignature){ticket.invalid=true;fail('PLAN_STALE');}
  return s;
 }
 /** Called by the canvas owner after real state changes, so change-then-undo and
  * away-then-back cannot revive old confirmations. No work without live tickets.
  */
 function observe() {
  if(!tickets.size&&!plans.size)return;
  for(const [id,t]of tickets)if(t.expires<now())tickets.delete(id);
  for(const [id,p]of plans)if(p.ticket.expires<now())plans.delete(id);
  const active=[...tickets.values()].filter(t=>!t.invalid),environments=[...tickets.values()].filter(t=>t.environmentTracking&&!t.environmentInvalid),undoable=[...plans.values()].filter(p=>p.status==='applied'&&!p.undoInvalid);
  if(!active.length&&!undoable.length&&!environments.length)return;
  const s=adapter.read(),sig=canvasPlanStateSignature(s),cap=active.length?stable(caps()):'';
  for(const t of active)if(t.signature!==sig||t.capSignature!==cap)t.invalid=true;
  for(const t of environments)if(!s.ready||s.projectId!==t.projectId||s.instanceId!==t.instanceId||stable(s.configurationIdentity)!==t.environmentSignature)t.environmentInvalid=true;
  for(const p of undoable)if(p.signature!==sig)p.undoInvalid=true;
 }
 function capture(options:{scope?:'selected'|'structure';includeContent?:boolean}={}) {
  exact(options,['scope','includeContent']);
  if(options.scope!==undefined&&!['selected','structure'].includes(options.scope)||options.includeContent!==undefined&&typeof options.includeContent!=='boolean')fail('PLAN_INVALID');
  prune();const s=state(),c=caps();
  const nodes=options.scope==='structure'?s.nodes.filter(n=>n.id!=='ghost-target'):s.nodes.filter(n=>n.selected&&n.id!=='ghost-target');
  if(nodes.length>500)fail('PLAN_SCOPE_TOO_LARGE');
  const nodeIds=new Set(nodes.map(n=>n.id));
  const ticket:Ticket={id:uid(),signature:canvasPlanStateSignature(s),capSignature:stable(c),environmentSignature:stable(s.configurationIdentity),projectId:s.projectId,instanceId:s.instanceId,nodeIds,expires:now()+10*60*1000,invalid:false};
  const scopedCapabilities=Object.fromEntries(Object.entries(c).filter(([key])=>Object.values(CANVAS_PLAN_TYPES).includes(key as any)||key.startsWith('node:')&&nodeIds.has(key.slice(5))));
  const output={ticketId:ticket.id,projectId:s.projectId,scope:options.scope||'selected',includeContent:options.includeContent===true,capabilities:structuredClone(scopedCapabilities),
   nodes:nodes.map(n=>({id:n.id,type:n.type,position:{...n.position},bounds:{
    width:Math.max(Number(n.style?.width)||Number(n.measured?.width)||224,(n.type==='textNode'?CANVAS_PLANNING_NEW_BOUNDS.text:n.type==='promptNode'?CANVAS_PLANNING_NEW_BOUNDS.image:n.type==='videoNode'?CANVAS_PLANNING_NEW_BOUNDS.video:CANVAS_PLANNING_NEW_BOUNDS.reference).width),
    height:Math.max(Number(n.style?.height)||Number(n.measured?.height)||224,(n.type==='textNode'?CANVAS_PLANNING_NEW_BOUNDS.text:n.type==='promptNode'?CANVAS_PLANNING_NEW_BOUNDS.image:n.type==='videoNode'?CANVAS_PLANNING_NEW_BOUNDS.video:CANVAS_PLANNING_NEW_BOUNDS.reference).height),
   },busy:busy(n),hasImage:!!n.data?.imageUrl,hasVideo:!!n.data?.videoUrl,
    taskStatus:busy(n)?'running':'idle',
    parameters:Object.fromEntries(['selectedModel',...Object.keys((c[`node:${n.id}`]||c[n.type||''])?.parameters||{})].filter(k=>typeof n.data?.[k]==='string').map(k=>[k,n.data[k]])),
    ...(options.includeContent?{content:Object.fromEntries((textFields[n.type||'']||[]).filter(k=>typeof n.data?.[k]==='string').map(k=>[k,n.data[k].slice(0,16000)]))}:{})})),
   edges:s.edges.filter(e=>nodeIds.has(e.source)&&nodeIds.has(e.target)).map(e=>({source:e.source,target:e.target}))};
  if(new TextEncoder().encode(JSON.stringify(output)).byteLength>256*1024)fail('PLAN_SCOPE_TOO_LARGE');
  tickets.set(ticket.id,ticket);return output;
 }
 function preview(ticketId:string,input:unknown) {
  prune();const ticket=tickets.get(ticketId);if(!ticket)fail('PLAN_EXPIRED');
  const before:CanvasPlanState=copyValue(current(ticket!)),proposal=parseCanvasPlan(input),cap=caps(),id=uid();
  const nodes=before.nodes.slice(),edges=before.edges.slice(),aliases=new Map<string,string>();
  const resolve=(key:string)=>aliases.get(key)||key;
  const existing=(key:string)=>{
   const node=nodes.find(n=>n.id===resolve(key));
   if(!node||(!aliases.has(key)&&!ticket!.nodeIds.has(key)))return fail('PLAN_NODE_OUT_OF_SCOPE');
   if(!supportedTypes.has(node.type||''))return fail('PLAN_NODE_UNSUPPORTED');
   if(busy(node))return fail('PLAN_NODE_BUSY');
   return node;
  };
  let created=0,updated=0,connected=0,moved=0,references=0;
  for(const op of proposal.operations) {
   if(op.op==='create'||op.op==='reference') {
    if(aliases.has(op.key)||nodes.some(n=>n.id===op.key))fail('PLAN_DUPLICATE_ID');
    const nodeId=`assistant-plan-${id}-${created+references}`;
    let type:string,data:Record<string,any>={__nodeId:nodeId};
    if(op.op==='create') {type=CANVAS_PLAN_TYPES[op.kind];data={...data,...op.fields};created++;}
    else {
     const source=existing(op.source),field=source.data?.videoUrl?'videoUrl':'imageUrl';
     if(!['imageNode','promptNode','videoNode'].includes(source.type||'')||typeof source.data?.[field]!=='string'||!source.data[field])fail('PLAN_REFERENCE_UNAVAILABLE');
     type=field==='videoUrl'?'videoNode':'imageNode';data[field]=source.data[field];data.mediaKind=field==='videoUrl'?'video':'image';
     if(source.data.projectAssetBindings?.[field])data.projectAssetBindings={[field]:structuredClone(source.data.projectAssetBindings[field])};
     references++;
    }
    let node=adapter.prepareNode(type,op.position,data);
    if(node.id!==nodeId||node.type!==type||nodes.some(n=>n.id===node.id))fail('PLAN_PREPARE_FAILED');
    if(op.op==='create')node=checkFields(node,op.fields,cap);
    nodes.push(node);aliases.set(op.key,node.id);
   } else if(op.op==='update') {
    const node=existing(op.node);nodes[nodes.indexOf(node)]=checkFields(node,op.fields,cap);updated++;
   } else if(op.op==='move') {
    const node=existing(op.node);if(node.parentId)fail('PLAN_GROUP_LAYOUT_UNSUPPORTED');nodes[nodes.indexOf(node)]={...node,position:{...op.position}};moved++;
   } else {
    const source=existing(op.source),target=existing(op.target);
    if(source.id===target.id||!compatible(source,target))fail('PLAN_CONNECTION_UNSUPPORTED');
    if(edges.some(e=>e.source===source.id&&e.target===target.id))fail('PLAN_CONNECTION_EXISTS');
    // useSafeEffect11 derives animation from the target's loading flag.
    // Busy targets were rejected above: initialize false now so that its normal
    // first effect is not mistaken for a later user edit by the undo fence.
    edges.push({id:`assistant-plan-edge-${id}-${connected}`,source:source.id,target:target.id,type:'custom',animated:false});connected++;
    if(cyclic(edges))fail('PLAN_CONNECTION_CYCLE');
   }
  }
  const after={...before,nodes,edges};
  const affectedNodeIds=[...new Set(proposal.operations.flatMap(op=>op.op==='create'||op.op==='reference'?[resolve(op.key)]:op.op==='connect'?[resolve(op.source),resolve(op.target)]:[resolve(op.node)]))];
  const plan:Prepared={id,ticket:ticket!,proposal,affectedNodeIds,signature:canvasPlanStateSignature(after),before,after,status:'preview'};plans.set(id,plan);
  const effectiveNodes=after.nodes.filter(n=>!before.nodes.some(b=>b.id===n.id)).map(n=>({id:n.id,type:n.type,parameters:Object.fromEntries(['selectedModel',...Object.keys(cap[n.type||'']?.modelParameters?.[n.data?.selectedModel]||cap[n.type||'']?.parameters||{})].filter(k=>typeof n.data?.[k]==='string').map(k=>[k,n.data[k]]))}));
  return {planId:id,projectId:before.projectId,status:'preview' as const,counts:{created,updated,connected,moved,references},proposal:structuredClone(proposal),effectiveNodes,
   generationPreflight:inspectCanvasGenerationPreflight(after,affectedNodeIds,cap,adapter.apiPresence,'proposal'),expiresAt:ticket!.expires};
 }
 function execute(planId:string) {
  const p=plans.get(planId);if(!p)fail('PLAN_EXPIRED');
  if(p!.status==='applied')return {...p!.result,replayed:true};
  if(p!.status!=='preview')fail('PLAN_ALREADY_CONSUMED');
  const live=current(p!.ticket);
  // No await between the last fence and the application-owned batched commit.
  try{adapter.commit(live,p!.after);}
  catch(error){
   p!.status='expired';p!.ticket.invalid=true;
   fail(error instanceof CanvasPlanError&&error.code==='PLAN_COMMIT_ROLLED_BACK'?'PLAN_COMMIT_ROLLED_BACK':'PLAN_COMMIT_UNCERTAIN');
  }
  p!.status='applied';
  p!.result={planId,status:'applied',createdNodeIds:p!.after.nodes.filter(n=>!p!.before.nodes.some(b=>b.id===n.id)).map(n=>n.id),
   affectedNodeIds:p!.affectedNodeIds.slice(),generationStarted:false};
  return {...p!.result,replayed:false};
 }
 function undo(planId:string) {
  const p=plans.get(planId);if(!p)fail('PLAN_EXPIRED');
  if(p!.status==='undone')return {planId,status:'undone',replayed:true};
  if(p!.status!=='applied')fail('PLAN_NOT_APPLIED');
  const live=state();
  if(p!.undoInvalid||canvasPlanStateSignature(live)!==p!.signature)fail('PLAN_UNDO_CONFLICT');
  try{adapter.commit(live,p!.before);}
  catch(error){
   p!.undoInvalid=true;
   fail(error instanceof CanvasPlanError&&error.code==='PLAN_COMMIT_ROLLED_BACK'?'PLAN_COMMIT_ROLLED_BACK':'PLAN_COMMIT_UNCERTAIN');
  }
  p!.status='undone';return {planId,status:'undone',replayed:false};
 }
 function discard(ticketId:string) {
  const t=tickets.get(ticketId);if(t)t.invalid=true;
  tickets.delete(ticketId);
  // An explicit release may retire a fully undone/failed plan. Keep applied
  // receipts: closing the UI must not remove a still-valid undo or its fence.
  for(const [id,p]of plans)if(p.ticket.id===ticketId&&p.status!=='applied')plans.delete(id);
 }
 function discardPreview(planId:string) {const p=plans.get(planId);if(p?.status==='preview')plans.delete(planId);}
 function preflight(planId:string) {
  const p=plans.get(planId);if(!p||now()>p.ticket.expires)fail('PLAN_EXPIRED');
  if(!['preview','applied'].includes(p!.status))fail('PLAN_ALREADY_CONSUMED');
  const live=state();if(live.projectId!==p!.before.projectId||live.instanceId!==p!.before.instanceId)fail('PLAN_STALE');
  if(p!.status==='preview')current(p!.ticket);
  return inspectCanvasGenerationPreflight(p!.status==='preview'?p!.after:live,p!.affectedNodeIds,caps(),adapter.apiPresence,p!.status==='preview'?'proposal':'current');
 }
 function validateRead(ticketId:string) {
  const ticket=tickets.get(ticketId);if(!ticket)fail('PLAN_EXPIRED');
  current(ticket);return true;
 }
 function validateEnvironment(ticketId:string){const t=tickets.get(ticketId);if(!t||t.environmentInvalid||now()>t.expires)fail('PLAN_EXPIRED');const s=state();if(s.projectId!==t.projectId||s.instanceId!==t.instanceId||stable(s.configurationIdentity)!==t.environmentSignature){t.environmentInvalid=true;fail('PLAN_STALE');}t.environmentTracking=true;return true;}
 function validateGenerationTarget(planId:string,nodeId:string){
  const p=plans.get(planId);if(!p||now()>p.ticket.expires)fail('PLAN_EXPIRED');
  if(p.status!=='applied')fail('PLAN_NOT_APPLIED');
  const live=state();if(live.projectId!==p.before.projectId||live.instanceId!==p.before.instanceId)fail('PLAN_STALE');
  if(!p.affectedNodeIds.includes(nodeId))fail('PLAN_NODE_OUT_OF_SCOPE');
  const node=live.nodes.find(n=>n.id===nodeId);if(!node||!['promptNode','videoNode'].includes(node.type||''))fail('PLAN_NODE_UNSUPPORTED');
  return true;
 }
 function configurationSummary(){state();const value=adapter.configurationSummary?.();if(!value)fail('PLAN_STATE_UNAVAILABLE');return structuredClone(value);}
 return {capture,preview,execute,undo,observe,discard,discardPreview,preflight,validateRead,validateEnvironment,validateGenerationTarget,configurationSummary};
}
