import {wanjuanStripRuntimeNodeData} from './node-runtime-contract';
import {canvasNodeTaskBusy} from './canvas-generation-preflight';
import {wanjuanCollectNodeReferenceMedia,wanjuanNodeTextValue} from './reference-media';
import {createApplicationGenerationExecution} from './application-generation-execution';

const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};
// Task owner fields may change between hook start and its first submit. Content,
// output, model and input bindings may not. Signatures stay in this closure.
const taskFields=new Set(['loading','progress','taskId','seedanceTaskId','errorMessage','manuallyStopped']);
function canonical(value:any):string {
 if(value===undefined||typeof value==='function')return '';
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(v=>canonical(v)||'null').join(',')+']';
 return '{'+Object.keys(value).sort().filter(k=>value[k]!==undefined&&typeof value[k]!=='function').map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
function nodeSignature(node:any,running=false){
 const data=wanjuanStripRuntimeNodeData(node?.data||{});
 return canonical({id:node?.id,type:node?.type,data:Object.fromEntries(Object.entries(data).filter(([k])=>!running||!taskFields.has(k)))});
}
const edgeSignature=(edges:any[])=>canonical(edges.map(e=>Object.fromEntries(['id','source','target','sourceHandle','targetHandle'].map(k=>[k,e[k]??null]))));
const hasResult=(node:any)=>['imageUrl','videoUrl','resultData','images','videoVersions','imageVersions'].some(k=>{
 const v=node.data?.[k];return Array.isArray(v)?v.length>0:!!v;
});

type Owner={getNodes:()=>any[];getEdges:()=>any[];prepareNode:(type:string,position:any,data:any)=>any;
 commit:(before:any,after:any)=>void;waitForCanvasState:(value:any)=>Promise<void>;
 describe:(kind:string,args:any,node:any,referenceTypes:string[])=>Promise<any>;
 run:(nodeId:string,kind:string,args:any,guard:()=>void,execution:any)=>Promise<void>};

/** A prepared, private closure over existing canvas inputs. Only the scalar
 * review leaves the renderer owner. No serialized URL/path or config capability
 * is accepted from an Agent, and preparing does not read/upload media bytes.
 * The dispatcher separately enforces applied-plan membership and main authority.
 */
export async function prepareCanvasPlanGeneration(nodeId:string,owner:Owner){
 const nodes=owner.getNodes(),edges=owner.getEdges(),target=nodes.find(n=>n.id===nodeId);
 if(!target||!['promptNode','videoNode'].includes(target.type))fail('PLAN_NODE_UNSUPPORTED');
 if(canvasNodeTaskBusy(target))fail('PLAN_NODE_BUSY');
 if(target.data?.selectedContextResources?.length||target.data?.seedanceMode==='tianji')fail('OPERATION_MEDIA_UNSUPPORTED');
 const kind=target.type==='promptNode'?'image':'video',incoming=edges.filter(e=>e.target===nodeId);
 const references:any[]=[],types:string[]=[],text:string[]=[],sourceChecks=new Map<string,string>();
 for(const edge of incoming){
  const source=nodes.find(n=>n.id===edge.source);
  if(!source||!['textNode','imageNode','promptNode','videoNode'].includes(source.type))fail('PLAN_REFERENCE_UNAVAILABLE');
  if(canvasNodeTaskBusy(source))fail('PLAN_NODE_BUSY');
  if(source.data?.selectedContextResources?.length||['seedanceAssetId','tianjiPortraitAssetId','arkTrustedAssetId','isTianjiPortrait'].some(k=>source.data?.[k]))fail('OPERATION_MEDIA_UNSUPPORTED');
  const media=wanjuanCollectNodeReferenceMedia(source,edge.sourceHandle);
  if(source.type!=='textNode'&&!media.images.length&&!media.videos.length)fail('OPERATION_MEDIA_NOT_READY');
  // The normal video hook uses imageUrl for these source types. Refuse a
  // multi-output source it would silently narrow, rather than misreview it.
  if(kind==='video'&&['imageNode','promptNode'].includes(source.type)&&media.images.length&&(media.images.length!==1||!source.data?.imageUrl))fail('OPERATION_MEDIA_UNSUPPORTED');
  for(const type of ['image','video'])for(const _ of media[type==='image'?'images':'videos']){types.push(type);references.push({nodeId:source.id,type});}
  const content=kind==='image'?wanjuanNodeTextValue(source):source.type==='textNode'?source.data?.text:'';
  if(content)text.push(String(content));
  sourceChecks.set(source.id,nodeSignature(source));
 }
 if(types.length>15||kind==='image'&&types.includes('video'))fail('OPERATION_MEDIA_UNSUPPORTED');
 const rawPrompt=String(target.data?.prompt||''),combined=[...text,rawPrompt].join('\n');
 const prompt=kind==='image'?combined.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200d\ufeff]/g,'').trim().slice(0,6000):combined;
 if(!prompt.trim())fail('OPERATION_PARAMETER_UNAVAILABLE');
 const data=target.data,args=kind==='image'?{prompt,model:data.selectedModel||'',size:data.imageSizeMode==='resolution'?data.imageResolution:data.imageSize||'1K',aspectRatio:data.aspectRatio}:
  {prompt,model:data.selectedModel||'',resolution:data.videoParameterMode==='exact-resolution'?data.size:data.selectedVideoQuality,duration:Number(data.selectedSeconds),aspectRatio:data.selectedAspectRatio};
 const original=nodeSignature(target),originalEdges=edgeSignature(incoming),branch=hasResult(target);
 function unchangedOriginal(){
  const current=owner.getNodes(),live=current.find(n=>n.id===nodeId);
  if(!live||canvasNodeTaskBusy(live)||nodeSignature(live)!==original||edgeSignature(owner.getEdges().filter(e=>e.target===nodeId))!==originalEdges)fail('PLAN_STALE');
  for(const [id,signature]of sourceChecks)if(nodeSignature(current.find(n=>n.id===id))!==signature)fail('PLAN_STALE');
 }
 let described=await owner.describe(kind,args,target,types);unchangedOriginal();
 // The existing generic video sender joins multiple text sources with its
 // legacy newline+tab separator. Show its actual prompt, not a prettier one.
 const actualVideoPrompt=text.length?text.join(described.requestPreview?'\n\t\t':'\n')+'\n'+rawPrompt:rawPrompt;
 if(kind==='video'&&actualVideoPrompt!==prompt){described=await owner.describe(kind,{...args,prompt:actualVideoPrompt},target,types);unchangedOriginal();}
 const {nodeFields,effectiveArguments,privateBinding,privateProviderBinding,...publicReview}=described;
 const fields={...nodeFields,prompt:rawPrompt},effective={...effectiveArguments,prompt:rawPrompt};
 // Separate content-send consent from fee consent in the trusted App UI. These
 // IDs/types describe the exact existing inputs, not their filesystem locations.
 const review={...publicReview,kind:'generation',generationKind:kind,canvasNodeId:nodeId,resultBranch:branch,canvasReferences:references,sourceTextCount:text.length,contentSendRequired:true};
 let consumed=false;
 return {review,async commit(guard:(stage:string)=>unknown){
  if(consumed)fail('OPERATION_ALREADY_CONSUMED');consumed=true;
  await guard('create');unchangedOriginal();
  const before={nodes:owner.getNodes(),edges:owner.getEdges()};
  const id=branch?'assistant-result-'+crypto.randomUUID():nodeId;
  const approvedEdges=branch?incoming.map(e=>({...e,id:'assistant-result-edge-'+crypto.randomUUID(),target:id,animated:false})):incoming;
  let expected:any;
  if(branch){
   expected=owner.prepareNode(target.type,{x:target.position.x+360,y:target.position.y},{__nodeId:id,...fields});
   expected={...expected,data:{...expected.data,...fields,...(data.selectedApiConfigId?{selectedApiConfigId:data.selectedApiConfigId}:{}),...(data.apiConfigId?{apiConfigId:data.apiConfigId}:{})}};
  }else expected={...before.nodes.find(n=>n.id===id),data:{...before.nodes.find(n=>n.id===id).data,...fields,manuallyStopped:false}};
  const expectedSignature=nodeSignature(expected,true),expectedEdges=edgeSignature(approvedEdges);
  // One owner commit, with no asynchronous gap after the last scope check.
  guard('dispatch');unchangedOriginal();
  owner.commit(before,{nodes:branch?[...before.nodes,expected]:before.nodes.map(n=>n.id===id?expected:n),edges:branch?[...before.edges,...approvedEdges]:before.edges});
  await owner.waitForCanvasState({nodeId:id,sourceNodeIds:[...sourceChecks.keys()]});
  const check=(allowRunning=false)=>{
   guard('dispatch');const current=owner.getNodes(),live=current.find(n=>n.id===id);
   if(!live||live.data?.manuallyStopped||!allowRunning&&canvasNodeTaskBusy(live)||nodeSignature(live,true)!==expectedSignature||edgeSignature(owner.getEdges().filter(e=>e.target===id))!==expectedEdges)fail('PLAN_STALE');
   for(const [sourceId,signature]of sourceChecks)if(nodeSignature(current.find(n=>n.id===sourceId))!==signature)fail('PLAN_STALE');
  };
  await guard('sender');check();
  const execution=createApplicationGenerationExecution(stage=>guard(stage),()=>check(true));
  await owner.run(id,kind,effective,()=>check(),execution);
  return {ok:true,accepted:true,nodeId:id,sourceNodeId:nodeId,resultBranch:branch,submissionId:execution.submissionId};
 }};
}
