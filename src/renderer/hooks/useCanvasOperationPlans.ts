import { useLayoutEffect,useRef } from 'react';
import { unstable_batchedUpdates } from 'react-dom';
import { createCanvasPlanController,canvasPlanStateSignature,CanvasPlanError,type CanvasPlanState,type PlanNode,type PlanEdge,type CanvasPlanCapabilities } from '../lib/canvas-operation-plan';
import { canvasNodePlanCapability,initializeCanvasPlanNode } from '../lib/canvas-plan-capabilities';
import {canvasGenerationApiPresence,type CanvasGenerationDefaults} from '../lib/canvas-generation-preflight';

interface Deps {
 projectId:string;nodes:PlanNode[];edges:PlanEdge[];
 projectIdRef:{current:any};nodesRef:{current:any};edgesRef:{current:any};
 loadedProjectRef:{current:any};shouldFitViewRef:{current:any};
 setNodes:(nodes:any)=>void;setEdges:(edges:any)=>void;
 prepareNodeAt:(type:string,position:{x:number;y:number},data?:any)=>PlanNode;
 generationDefaults?:CanvasGenerationDefaults;
 generationContext?:unknown;
}
export function commitCanvasPlanBatch(owner:Pick<Deps,'setNodes'|'setEdges'>,before:CanvasPlanState,after:CanvasPlanState) {
 unstable_batchedUpdates(()=>{
  try{owner.setNodes(after.nodes);owner.setEdges(after.edges);}
  catch{
   try{owner.setNodes(before.nodes);owner.setEdges(before.edges);}
   catch{throw new CanvasPlanError('PLAN_COMMIT_UNCERTAIN');}
   throw new CanvasPlanError('PLAN_COMMIT_ROLLED_BACK');
  }
 });
}
/** One controller per mounted canvas. All plans are in-memory only; neither
 * conversation restore nor project JSON can resurrect execution authority.
 */
export function useCanvasOperationPlans(deps:Deps) {
 const live=useRef(deps),instance=useRef(''),mounted=useRef(true);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 if(!instance.current)instance.current=crypto.randomUUID();
 const controller=useRef<ReturnType<typeof createCanvasPlanController>|null>(null);
 if(!controller.current) {
  const inputs=['textModel','drawingModel','videoModel','imageCompatResolutions','videoDurations','videoResolutions','videoAspectRatios','videoModelRequestProfiles','apiConfigs','imageModelApiBindings','videoModelApiBindings','imageModelProtocolBindings','videoModelProtocolBindings','modelProtocolRegistry','selectedApiConfigId','apiConfigId','selectedModel','size','qiniuConfig','tosConfig','customPublicUploadConfig','seedanceUploadMode','arkTrustedAssetConfig'];
  const cached=new Map<string,{inputs:any[];value:CanvasPlanCapabilities[string]}>();
  const capability=(key:string,node:PlanNode)=>{
   const values=inputs.map(k=>node.data?.[k]),previous=cached.get(key);
   if(previous&&values.every((v,i)=>v===previous.inputs[i]))return previous.value;
   const value=canvasNodePlanCapability(node);cached.set(key,{inputs:values,value});return value;
  };
  const probes=()=>['textNode','promptNode','videoNode'].map(type=>live.current.prepareNodeAt(type,{x:0,y:0},{__nodeId:'plan-capability-probe'}));
  const read=():CanvasPlanState=>{
   const d=live.current;
   return {projectId:d.projectId,instanceId:instance.current,ready:mounted.current&&d.projectIdRef.current===d.projectId&&d.loadedProjectRef.current===d.projectId&&d.shouldFitViewRef.current===true,nodes:d.nodes,edges:d.edges,
    // Private fence only. Even a binding/endpoint change with identical public
    // parameter choices invalidates a pending proposal; no key is emitted.
    configurationIdentity:{nodes:probes().map(n=>inputs.map(k=>n.data?.[k])),generation:d.generationDefaults,context:d.generationContext}};
  };
  controller.current=createCanvasPlanController({read,
   configurationSummary(){
    const result:any={};
    for(const node of probes().filter(n=>n.type==='promptNode'||n.type==='videoNode'))result[node.type==='promptNode'?'image':'video']={modelCount:capability(node.type!,node).models.length,configuration:canvasGenerationApiPresence(node,live.current.generationDefaults||{})};
    return result;
   },
   capabilities(){
    const d=live.current,caps:CanvasPlanCapabilities={};
    const retained=new Set<string>();
    for(const node of probes()){const key=node.type!;caps[key]=capability(key,node);retained.add(key);}
    for(const node of d.nodes)if(['textNode','promptNode','videoNode'].includes(node.type||'')){const key=`node:${node.id}`;caps[key]=capability(key,node);retained.add(key);}
    for(const key of cached.keys())if(!retained.has(key))cached.delete(key);
    return caps;
   },
   prepareNode:(type,position,data)=>initializeCanvasPlanNode(live.current.prepareNodeAt(type,position,data)),
   apiPresence:node=>canvasGenerationApiPresence(node,live.current.generationDefaults||{}),
   commit(before,after){
    if(canvasPlanStateSignature(read())!==canvasPlanStateSignature(before))throw new CanvasPlanError('PLAN_STALE');
    const d=live.current;
    // Same setters as all manual edits; existing save/history/media effects
    // remain authoritative. No parallel file or project persistence path.
    commitCanvasPlanBatch(d,before,after);
    d.nodesRef.current=after.nodes;d.edgesRef.current=after.edges;
    live.current={...d,nodes:after.nodes,edges:after.edges};
   },
  });
 }
 useLayoutEffect(()=>{live.current=deps;controller.current!.observe();});
 return controller.current;
}
