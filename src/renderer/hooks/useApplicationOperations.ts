import {useLayoutEffect,useRef} from 'react';
import {createApplicationOperationDispatcher} from '../lib/application-operations';
import {sharedAssistantWorkspaceClient} from './useAssistantWorkspace';
import {createApplicationLocalActions} from '../lib/application-local-actions';
import {createApplicationTaskReader} from '../lib/application-task-records';
import {createApplicationTaskExportPlans} from '../lib/application-task-export';
import {wanjuanAutomationFileUrl} from '../lib/automation-result';

export function useApplicationOperations({projectId,projects,canvasRef,localActions,taskRecords}:{projectId:string;projects:any[];canvasRef:any;localActions?:any;taskRecords?:unknown}){
 const latest=useRef({projectId,projects,canvasRef,localActions,taskRecords});latest.current={projectId,projects,canvasRef,localActions,taskRecords};
 const localController=useRef<ReturnType<typeof createApplicationLocalActions>|null>(null);
 useLayoutEffect(()=>{if(latest.current.localActions)localController.current?.observe();});
 useLayoutEffect(()=>{
  const bridge=(window as any).wanjuanDesktop;if(typeof bridge?.applicationOperationConsume!=='function')return;
  const taskReader=createApplicationTaskReader(()=>latest.current.taskRecords);
  const taskExporter=createApplicationTaskExportPlans(()=>latest.current.taskRecords,{async resolveBlob(source,metadata){
   const response=await fetch(source),blob=await response.blob();if(!response.ok)throw Object.assign(Error('OPERATION_MEDIA_READ_FAILED'),{code:'OPERATION_MEDIA_READ_FAILED'});if(blob.size>512*1024*1024)throw Object.assign(Error('OPERATION_MEDIA_TOO_LARGE'),{code:'OPERATION_MEDIA_TOO_LARGE'});
   const result=await bridge.persistProjectAsset({url:source,projectId:metadata.projectId,nodeId:metadata.nodeId,field:metadata.type+'Url',kind:metadata.type});if(!result?.ok||!result.localPath)throw Error('OPERATION_OUTCOME_UNKNOWN');return wanjuanAutomationFileUrl(result.localPath);
  }});
  (globalThis as any).__wanjuanTaskAutomation=taskReader;
  const local=createApplicationLocalActions({document,
   readState:()=>latest.current.localActions.readState(),applyPreference:(...a)=>latest.current.localActions.applyPreference(...a),
   navigate:d=>latest.current.localActions.navigate(d),canNavigate:d=>latest.current.localActions?.canNavigate(d)===true,
   prefersLight:()=>!!window.matchMedia?.('(prefers-color-scheme: light)').matches,
  });localController.current=local;
  const observer=new MutationObserver(()=>{if(latest.current.localActions)local.observe();});
  observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','data-wanjuan-theme-persistence-revision','data-wanjuan-language-persistence-revision','data-wanjuan-auto-download-persistence-revision']});
  const dispatcher=createApplicationOperationDispatcher({
   getProjectId:()=>latest.current.projectId,getProjects:()=>latest.current.projects,
   getCanvas:()=>{const c=latest.current.canvasRef.current;return c?.projectId===latest.current.projectId?c.plans:null;},
   getAutomation:()=>(globalThis as any).__wanjuanAutomation,
   getInternalScope:owner=>sharedAssistantWorkspaceClient().operationScope(owner),
   getLocalActions:()=>latest.current.localActions?local:null,
   getTaskReader:()=>taskReader,
   getTaskExporter:()=>taskExporter,
   async consume(id,nonce){const reply=await bridge.applicationOperationConsume(id,nonce);if(!reply?.ok)throw Object.assign(new Error('Operation refused'),{code:reply?.code});return reply.value;},
  });
  (globalThis as any).__wanjuanApplicationOperations=dispatcher.bridge;
  return ()=>{observer.disconnect();local.close();if((globalThis as any).__wanjuanTaskAutomation===taskReader)delete (globalThis as any).__wanjuanTaskAutomation;if(localController.current===local)localController.current=null;if((globalThis as any).__wanjuanApplicationOperations===dispatcher.bridge)delete (globalThis as any).__wanjuanApplicationOperations;dispatcher.close();};
 },[]);
}
