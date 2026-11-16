import {createAgentMessageSender} from '../hooks/use_sendAgentMessage';
import {buildCanvasPlanningPrompt} from '../../../electron/shared/canvas-planning-protocol.mjs';
import {containsLikelyAssistantSecret} from './assistant-onboarding';

export function completedRoleHistory(messages:any[]) {
  const pending=new Map<string,any>(),pairs:any[][]=[];
  for(const message of messages||[]){
    if(message.role==='user')pending.set(message.turnId,message);
    else if(message.role==='assistant'&&!message.failed&&pending.has(message.turnId)){
      pairs.push([pending.get(message.turnId),message]);pending.delete(message.turnId);
    }
  }
  return pairs.flat().map(item=>({role:item.role,content:item.content}));
}

// Reuses the existing model binding/protocol/media/knowledge request builder;
// virtual setters cannot mutate the original agent-keyed conversations.
export async function runWorkspaceRoleTurn({sessionId,roleId,configuration,messages,text,attachments=[],environment,signal,planningRequest,onText}:{sessionId:string;roleId?:string;configuration:any;messages:any[];text:string;attachments?:any[];environment:any;signal:AbortSignal;planningRequest?:any;onText?:(text:string)=>void}){
  const warnings:string[]=[];
  const mode=configuration.outputMode;
  const planning=planningRequest!==undefined;
  if(planning&&attachments.length)throw Object.assign(new Error('ASSISTANT_ATTACHMENT_UNSUPPORTED'),{code:'ASSISTANT_ATTACHMENT_UNSUPPORTED'});
  const instruction=planning?'Return only the requested StarCanvas JSON operation proposal, never execute.':mode==='prompt'?'Return a reusable prompt draft only.':mode==='node'?'Return a canvas-node content draft only. Do not execute or claim any app operation.':'';
  const requestText=planning?buildCanvasPlanningPrompt(text,planningRequest,containsLikelyAssistantSecret):text;
  const selectedAgent={...configuration,id:configuration.id||roleId||sessionId,systemPrompt:[configuration.systemPrompt,instruction].filter(Boolean).join('\n\n')};
  let conversations:any={[sessionId]:completedRoleHistory(messages)};
  const sender=createAgentMessageSender({
    ...environment,selectedAgent,agentComposer:requestText,agentAttachments:attachments,agentConversations:conversations,
    setAgentConversations:(update:any)=>{conversations=typeof update==='function'?update(conversations):update;},
    setAgentComposer:()=>{},setAgentAttachments:()=>{},showToast2:()=>{},
    searchAgentLongTermMemory:planning?(async()=>''):environment.searchAgentLongTermMemory|| (async()=>''),
    storeAgentLongTermMemory:planning?(async()=>{}):environment.storeAgentLongTermMemory|| (async()=>{}),
  },{conversationId:sessionId,strict:true,signal,onWarning:code=>warnings.push(code),...(!planning&&onText?{onText}:{})});
  const reply=await sender.sendAgentMessage();
  if(typeof reply!=='string'||!reply.trim())throw Object.assign(new Error('ASSISTANT_PROVIDER_REQUEST'),{code:'ASSISTANT_PROVIDER_REQUEST'});
  return {text:reply,warnings};
}

export function createRoleRequestQueue(limit=2,maxQueue=16){
  let active=0;const jobs=new Map<string,any>(),waiting:any[]=[];
  const error=(code:string)=>Object.assign(new Error(code),{code});
  function pump(){
    while(active<limit&&waiting.length){
      const job=waiting.shift();active++;job.started=true;job.signal.removeEventListener('abort',job.cancel);
      void Promise.resolve().then(()=>{if(job.signal.aborted)throw error('ASSISTANT_CANCELLED');return job.work();}).then(job.resolve,job.reject).finally(()=>{active--;jobs.delete(job.id);pump();});
    }
  }
  return {run(id:string,signal:AbortSignal,work:()=>Promise<any>){
    if(signal.aborted)return Promise.reject(error('ASSISTANT_CANCELLED'));
    if(jobs.has(id))return Promise.reject(error('ASSISTANT_BUSY'));
    if(active>=limit&&waiting.length>=maxQueue)return Promise.reject(error('ASSISTANT_QUEUE_FULL'));
    return new Promise<any>((resolve,reject)=>{
      const job={id,signal,work,resolve,reject,started:false,cancel:()=>{}};
      job.cancel=()=>{if(job.started)return;waiting.splice(waiting.indexOf(job),1);jobs.delete(id);reject(error('ASSISTANT_CANCELLED'));};
      signal.addEventListener('abort',job.cancel,{once:true});jobs.set(id,job);waiting.push(job);pump();
    });
  }};
}
