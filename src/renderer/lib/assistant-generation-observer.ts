import {applicationOperationMetadata} from '../../../electron/shared/application-operation-policy.mjs';
import {selectAssistantGenerationTask} from '../../../electron/shared/assistant-generation-task.mjs';
/** Coalesce visible history cards' metadata reads. No provider polling,
 * operation jobs, result locations, file access or second persisted task store. */
export function createAssistantGenerationObserver(getReader:()=>any,{now=Date.now,cacheMs=400}:{now?:()=>number;cacheMs?:number}={}){
 let reader:any,records:any[]=[],until=0,pending:Promise<any>|null=null;
 async function read(reference:any){
  const current=getReader();if(!current||typeof current.tasks!=='function')throw Error('TASKS_UNAVAILABLE');
  if(current!==reader){reader=current;records=[];until=0;pending=null;}
  if(now()>=until){
   if(!pending){
    const owner=current,job=Promise.resolve().then(()=>owner.tasks({materialize:false,includeDiagnostics:false})).then(value=>{
     const projected=applicationOperationMetadata('tasks.list',value).tasks;
     if(reader===owner){records=projected;until=now()+cacheMs;}return projected;
    });pending=job;void job.finally(()=>{if(pending===job)pending=null;}).catch(()=>{});
   }
   const values=await pending;return selectAssistantGenerationTask(reference,values);
  }
  return selectAssistantGenerationTask(reference,records);
 }
 return {read};
}
export const sharedAssistantGenerationObserver=createAssistantGenerationObserver(()=>(globalThis as any).__wanjuanTaskAutomation);
