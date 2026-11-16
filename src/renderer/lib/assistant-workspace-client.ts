// One in-memory controller for both workbench and floating chat. Only the
// trusted main-process vault persists content; no browser history mirror.
import type { AssistantMessage } from './assistant-onboarding';
import {createRoleRequestQueue,runWorkspaceRoleTurn} from './assistant-role-engine';
import {captureAssistantGenerationTask} from '../../../electron/shared/assistant-generation-task.mjs';

type Bridge = Record<string,(...args:any[])=>Promise<any>>;
type Updater<T> = T | ((previous:T)=>T);
type View = {
  messages:AssistantMessage[]; draft:string; busy:boolean; sending:boolean;
  cancelling:boolean; cancelledTurnWaiting:boolean; requiresReset:boolean;
  chatNotice:string; chatError:string; record:any; version:number; savedVersion:number;
  completedTurnId:string; presentationTurnId:string; chain:Promise<unknown>;
  importingMedia:boolean;
  mediaStatus:{phase:string;name?:string;index?:number;total?:number;code?:string};
  taskStatusUnavailable:boolean;
  stream:{text:string;active:boolean};
  canvasPlan:any;
  localAction:any;
  taskRead:any;
  timer:ReturnType<typeof setTimeout>|null; refs:Record<string,{current:any}>;
};
const problem = (code:string) => Object.assign(new Error(code),{code});
const codeOf = (error:any) => /^ASSISTANT_[A-Z_]+$/.test(error?.code || '') ? error.code : 'ASSISTANT_WORKSPACE_UNAVAILABLE';
const safePresentation = (messages:AssistantMessage[]) => messages.map(item => ({
  role:item.role,text:item.text,
  ...(item.modelReply ? {modelReply:true} : {}),
  ...(item.incomplete&&item.role==='assistant'&&item.modelReply?{incomplete:true}:{}),
  ...(item.proposalExpired || item.action || item.preference ? {proposalExpired:true} : {}),
  ...(item.executionStatus ? {executionStatus:item.executionStatus} : {}),
  ...(item.attachments?.length ? {attachments:item.attachments} : {}),
  ...(item.generationTask&&item.role==='assistant'&&item.executionStatus==='confirmed'&&!item.modelReply&&!item.proposalExpired?{generationTask:captureAssistantGenerationTask(item.generationTask)}:{}),
}));
function makeView():View {
  const refs:View['refs'] = {};
  for (const name of ['inputRevision','localActionSubmitted','diagnosticDraft','modelSendInFlight','modelCancellationRequested','resetInFlight','cancelInFlight','proposalFence']) refs[name]={current:name==='inputRevision'?0:false};
  refs.consumedActions={current:new WeakSet<object>()};
  return {messages:[],draft:'',busy:false,sending:false,cancelling:false,cancelledTurnWaiting:false,requiresReset:false,chatNotice:'',chatError:'',record:null,version:0,savedVersion:0,completedTurnId:'',presentationTurnId:'',chain:Promise.resolve(),timer:null,importingMedia:false,mediaStatus:{phase:'idle'},taskStatusUnavailable:false,stream:{text:'',active:false},canvasPlan:{phase:'idle'},localAction:{phase:'idle'},taskRead:{working:false},refs};
}
export function createAssistantWorkspaceClient(getBridge:()=>Bridge|undefined) {
  const views = new Map<string,View>([['$local',makeView()]]),listeners = new Set<()=>void>();
  const roles=new Map<string,any>(),customTurns=new Map<string,AbortController>(),customQueue=createRoleRequestQueue();
  const mediaImports=new Map<string,Promise<void>>();
  const nativeTurns=new Set<string>();
  let snapshot = {phase:'idle',errorCode:'',selectedId:'$local',switching:false,catalog:{roles:[],sessions:[]} as any,catalogRevision:0,epoch:0};
  let initializing:Promise<void>|null=null,selection=0,creating:Promise<void>|null=null,selectionVersion=0;
  const available = () => typeof getBridge()?.assistantWorkspaceList === 'function';
  const viewFor = (id:string) => {let value=views.get(id);if(!value){value=makeView();views.set(id,value);}return value;};
  const emit = () => {snapshot={...snapshot,epoch:snapshot.epoch+1};for(const listener of listeners)listener();};
  async function call(method:string,...args:any[]) {
    const fn=getBridge()?.[method];if(!fn)throw problem('ASSISTANT_WORKSPACE_UNAVAILABLE');
    const result=await fn(...args);if(!result?.ok)throw problem(codeOf(result));return result.value;
  }
  function adopt(id:string,record:any) {
    const view=viewFor(id);
    if(!record?.value || !Number.isSafeInteger(record.revision) || record.value.id!==id)throw problem('ASSISTANT_WORKSPACE_CORRUPT');
    if(!view.record || record.revision>=view.record.revision)view.record=record;
  }
  async function load(id:string) {
    if(viewFor(id).record){await loadRole(viewFor(id).record.value.roleId);return;}
    const record=await call('assistantWorkspaceReadSession',id),view=viewFor(id);adopt(id,record);
    view.draft=record.value.draft;
    view.messages=Array.isArray(record.value.presentation)?record.value.presentation:[];
    view.presentationTurnId=record.value.presentationTurnId||'';
    // A completed native reply can survive a crash before the renderer saved
    // its presentation. Recover it only as an unverified, non-actionable quote.
    if(record.value.task.status==='completed'&&record.value.task.id!==view.presentationTurnId){
      const pair=record.value.messages.filter((item:any)=>item.turnId===record.value.task.id);
      const user=pair.find((item:any)=>item.role==='user'),reply=pair.find((item:any)=>item.role==='assistant');
      if(user&&reply){
        if(view.messages.at(-1)?.role!=='user'||view.messages.at(-1)?.text!==user.content)view.messages=[...view.messages,{role:'user',text:user.content,...(user.attachments?.length?{attachments:user.attachments}:{})}];
        view.messages=[...view.messages,{role:'assistant',text:reply.content,modelReply:true}];
        view.presentationTurnId=record.value.task.id;
      }
    }
    view.completedTurnId=record.value.task.status==='completed'?record.value.task.id:'';
    await loadRole(record.value.roleId);
  }
  async function loadRole(id:string){
    if(roles.has(id))return;
    const descriptor=snapshot.catalog.roles.find((item:any)=>item.id===id);
    if(descriptor?.engine==='harness'){roles.set(id,{descriptor,configuration:null,revision:0});return;}
    roles.set(id,await call('assistantWorkspaceReadRole',id));
  }
  async function refreshCatalog() {
    const index=await call('assistantWorkspaceList');
    if(!index?.value||!Array.isArray(index.value.sessions)||!Array.isArray(index.value.roles))throw problem('ASSISTANT_WORKSPACE_CORRUPT');
    snapshot={...snapshot,catalog:index.value,catalogRevision:index.revision};return index;
  }
  function followTask(id:string){
    // Only while a native send is outstanding; no interval overlap, no model
    // retry, and no extra plaintext history cache. adopt never edits drafts.
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    const poll=async()=>{
      try{const record=await call('assistantWorkspaceReadSession',id);if(stopped)return;adopt(id,record);viewFor(id).taskStatusUnavailable=false;}
      catch{if(stopped)return;viewFor(id).taskStatusUnavailable=true;}
      emit();if(!stopped)timer=setTimeout(poll,1200);
    };
    timer=setTimeout(poll,100);
    return ()=>{stopped=true;clearTimeout(timer);viewFor(id).taskStatusUnavailable=false;};
  }
  function followAnswer(id:string,requestId:string) {
    // Volatile, revision-gated text only; never read/decrypt the whole history
    // per chunk. One non-overlapping poll belongs to this exact send, not the
    // currently selected session. Finalization awaits any in-flight read.
    let stopped=false,revision=0,timer:ReturnType<typeof setTimeout>|undefined,inFlight:Promise<void>|undefined;
    const read=async()=>{
      try {
        const next=await call('assistantWorkspaceProgress',id,requestId,revision);
        if (!next || !Number.isSafeInteger(next.revision) || next.revision <= revision) return;
        revision=next.revision;
        if (typeof next.text==='string' && next.text.length<=200000) {
          viewFor(id).stream={text:next.text,active:!!next.text};emit();
        }
      } catch {/* Preview observation failure never retries inference or fails a valid final reply. */}
    };
    const poll=async()=>{if(stopped)return;inFlight=read();await inFlight;inFlight=undefined;if(!stopped)timer=setTimeout(poll,80);};
    timer=setTimeout(poll,40);
    return async(finalRead=false)=>{stopped=true;clearTimeout(timer);await inFlight;if(finalRead)await read();};
  }
  function schedule(id:string) {
    const view=viewFor(id);if(id==='$local'||!view.record)return;
    if(view.timer)clearTimeout(view.timer);
    view.timer=setTimeout(()=>{view.timer=null;void flush(id).catch(()=>{});},250);
  }
  async function flush(id:string) {
    const view=viewFor(id);if(id==='$local'||!view.record)return;
    if(view.timer){clearTimeout(view.timer);view.timer=null;}
    const operation=view.chain.then(async()=>{
      if(view.version===view.savedVersion)return;
      const version=view.version,base=view.record;
      const patch={draft:view.draft,presentation:safePresentation(view.messages),presentationTurnId:view.presentationTurnId};
      let record;
      try {record=await call('assistantWorkspacePatchSession',id,patch,base.revision);}
      catch(error:any){
        if(error.code!=='ASSISTANT_WORKSPACE_CONFLICT')throw error;
        const fresh=await call('assistantWorkspaceReadSession',id);
        // Rebase only a task-revision change, not another writer's draft or
        // presentation edit. Never overwrite a newer field blindly.
        if(fresh.value.draft!==base.value.draft||JSON.stringify(fresh.value.presentation||[])!==JSON.stringify(base.value.presentation||[]))throw problem('ASSISTANT_WORKSPACE_CONFLICT');
        record=await call('assistantWorkspacePatchSession',id,patch,fresh.revision);
      }
      adopt(id,record);view.savedVersion=version;emit();
      if(view.version!==version)schedule(id);
    });
    view.chain=operation.catch(error=>{view.chatError=codeOf(error);emit();});
    return operation;
  }
  async function select(id:string) {
    selectionVersion++;
    const ticket=++selection,old=snapshot.selectedId;
    snapshot={...snapshot,switching:true};emit();
    try {
      await flush(old);await load(id);if(ticket!==selection)return;
      const index=await call('assistantWorkspaceSelectSession',id);if(ticket!==selection)return;
      snapshot={...snapshot,selectedId:id,catalog:index.value,catalogRevision:index.revision};emit();
    } finally {if(ticket===selection){snapshot={...snapshot,switching:false};emit();}}
  }
  async function create(projectId='',roleId?:string) {
    if(creating)return creating;
    selectionVersion++;
    snapshot={...snapshot,switching:true};emit();
    creating=(async()=>{
      await flush(snapshot.selectedId);
      const owner=roleId||viewFor(snapshot.selectedId).record?.value.roleId;
      const record=await call('assistantWorkspaceCreateSession',{projectId,...(owner?{roleId:owner}:{})});adopt(record.value.id,record);
      await select(record.value.id);
    })().finally(()=>{creating=null;snapshot={...snapshot,switching:false};emit();});
    return creating;
  }
  async function initialize(projectId='') {
    if(!available()||snapshot.phase==='ready')return;
    if(initializing)return initializing;
    snapshot={...snapshot,phase:'loading',errorCode:''};emit();
    initializing=(async()=>{
      const index=await refreshCatalog();
      const selected=index.value.sessions.find((item:any)=>item.id===index.value.selectedSessionId&&!item.archived)||index.value.sessions.find((item:any)=>!item.archived);
      if(selected)await select(selected.id);else await create(projectId);
      snapshot={...snapshot,phase:'ready',errorCode:''};emit();
    })().catch(error=>{snapshot={...snapshot,phase:'failed',errorCode:codeOf(error)};emit();}).finally(()=>{initializing=null;});
    return initializing;
  }
  return {
    available,subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};},getSnapshot:()=>snapshot,viewFor,initialize,select,create,flush,
    operationScope(id:string){const view=views.get(id);return view?.record&&snapshot.phase==='ready'?{owner:id,selected:snapshot.selectedId===id&&!snapshot.switching,selectionVersion,projectId:view.record.value.projectId||''}:null;},
    observeCanvasProject(projectId:string){
      let changed=false;
      for(const view of views.values()){
        const plan=view.canvasPlan;
        if(!plan.projectId||plan.projectId===projectId||!['scope','reading','requesting','preview','invalid','applied','uncertain'].includes(plan.phase))continue;
        // Expire every loaded session's controls, not just the visible one.
        // Returning to a project cannot make an old confirmation look valid.
        try{plan.api?.discard(plan.ticketId);}catch{}
        view.canvasPlan={...plan,phase:'expired',code:'PLAN_STALE'};changed=true;
      }
      if(changed)emit();
    },
    roleFor:(id:string)=>roles.get(viewFor(id).record?.value.roleId),
    async createRole(configuration:any,projectId=''){
      const descriptor=await call('assistantWorkspaceCreateRole',configuration);
      try{await refreshCatalog();await create(projectId,descriptor.id);emit();return {descriptor,sessionFailed:false};}
      catch{emit();return {descriptor,sessionFailed:true};}
    },
    async saveRole(id:string,configuration:any,revision:number){
      const role=await call('assistantWorkspacePatchRole',id,configuration,revision);roles.set(id,role);await refreshCatalog();emit();return role;
    },
    async importLegacy(agents:any[],conversations:any){
      let failures=0;
      for(const agent of agents||[])try{await call('assistantWorkspaceImportLegacyRole',agent,conversations?.[agent.id]||[]);}catch{failures++;}
      await refreshCatalog();emit();
      if(failures)throw problem('ASSISTANT_LEGACY_IMPORT_PARTIAL');
    },
    async bindProject(id:string,projectId:string){
      await flush(id);const view=viewFor(id);
      adopt(id,await call('assistantWorkspacePatchSession',id,{projectId},view.record.revision));emit();
    },
    async exportBackup(scope:'all'|'session'){
      const owner=snapshot.selectedId;
      await Promise.all([...mediaImports.values()]);await Promise.all([...views.keys()].filter(id=>id!=='$local').map(flush));
      return call('assistantWorkspaceExportBackup',{scope,...(scope==='session'?{id:owner}:{})});
    },
    async importBackup(value:any){
      if(customTurns.size||mediaImports.size||[...views.values()].some(view=>view.sending||view.busy))throw problem('ASSISTANT_BUSY');
      await Promise.all([...views.keys()].filter(id=>id!=='$local').map(flush));
      const receipt=await call('assistantWorkspaceImportBackup',value);
      try{
        await refreshCatalog();emit();
        const next=snapshot.catalog.sessions.find((item:any)=>receipt.sessionIds.includes(item.id)&&!item.archived&&!snapshot.catalog.roles.find((role:any)=>role.id===item.roleId)?.archived);
        if(next&&!receipt.alreadyImported)await select(next.id);return receipt;
      }catch{return {...receipt,refreshFailed:true};}
    },
    pending:()=>mediaImports.size>0||[...views.entries()].some(([id,view])=>id!=='$local'&&view.record&&view.version!==view.savedVersion),
    flushAll:async()=>{await Promise.all([...mediaImports.values()]);await Promise.all([...views.keys()].filter(id=>id!=='$local').map(flush));},
    prepareClose:async()=>{
      // Wait for every local write even if one fails, never a model send.
      const imports=await Promise.allSettled([...mediaImports.values()]);
      const writes=await Promise.allSettled([...views.keys()].filter(id=>id!=='$local').map(flush));
      if([...imports,...writes].some(result=>result.status==='rejected'))return {ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'};
      return mediaImports.size||[...views.entries()].some(([id,view])=>id!=='$local'&&view.record&&view.version!==view.savedVersion)
        ?{ok:false,code:'DESKTOP_CLOSE_CHANGED'}:{ok:true};
    },
    async addFiles(id:string,files:File[]){
      if(mediaImports.has(id)||customTurns.has(id))throw problem('ASSISTANT_BUSY');
      if(!files.length)return;
      const view=viewFor(id);view.importingMedia=true;emit();
      const operation=(async()=>{
        await flush(id);
        for(const [index,file] of files.entries()){
          view.mediaStatus={phase:'reading',name:file.name,index:index+1,total:files.length};emit();
          if(!file.size||file.size>32*1024*1024)throw problem('ASSISTANT_MEDIA_LIMIT');
          let bytes;try{bytes=await file.arrayBuffer();}catch{throw problem('ASSISTANT_MEDIA_UNAVAILABLE');}
          view.mediaStatus={...view.mediaStatus,phase:'saving'};emit();
          adopt(id,await call('assistantWorkspaceAddAttachment',id,{name:file.name,bytes}));emit();
        }
        view.mediaStatus={phase:'done'};
      })();
      mediaImports.set(id,operation);
      try{await operation;}catch(error){view.mediaStatus={...view.mediaStatus,phase:'failed',code:codeOf(error)};throw error;}finally{mediaImports.delete(id);view.importingMedia=false;emit();}
    },
    async setAttachments(id:string,attachments:any[]){
      if(mediaImports.has(id)||customTurns.has(id))throw problem('ASSISTANT_BUSY');
      await flush(id);const view=viewFor(id);
      adopt(id,await call('assistantWorkspacePatchSession',id,{attachments},view.record.revision));view.mediaStatus={phase:'idle'};emit();
    },
    set<T>(id:string,field:keyof View,value:Updater<T>) {
      const view=viewFor(id),previous=view[field] as T;
      const next=typeof value==='function'?(value as (old:T)=>T)(previous):value;
      if(Object.is(next,previous))return;
      (view as any)[field]=next;
      if(field==='messages'||field==='draft'){
        if(field==='messages'&&(next as AssistantMessage[]).at(-1)?.role==='assistant'&&view.completedTurnId)view.presentationTurnId=view.completedTurnId;
        view.version++;schedule(id);
      }
      emit();
    },
    async send(id:string,text:string,context:any) {
      if(nativeTurns.has(id))return {ok:false,code:'ASSISTANT_BUSY'};
      nativeTurns.add(id);
      const view=viewFor(id);view.stream={text:'',active:false};
      let stopFollowing=()=>{},stopAnswer:(finalRead?:boolean)=>Promise<void>=async()=>{};
      try{
        await flush(id);
        const requestId=crypto.randomUUID();
        stopFollowing=followTask(id);
        if(!context?.canvasPlan&&typeof getBridge()?.assistantWorkspaceProgress==='function')stopAnswer=followAnswer(id,requestId);
        const record=await call('assistantWorkspaceSend',id,text,context,requestId);adopt(id,record);
        const message=record.value.messages.at(-1);
        if(message?.role!=='assistant')throw problem('ASSISTANT_WORKSPACE_CORRUPT');
        view.completedTurnId=record.value.task.id;
        return {ok:true,value:message.content};
      }catch(error){
        await stopAnswer(true);
        if(view.stream.text){view.messages=[...view.messages,{role:'assistant',text:view.stream.text,modelReply:true,incomplete:true}];view.version++;schedule(id);}
        try{adopt(id,await call('assistantWorkspaceReadSession',id));}catch{}
        return {ok:false,code:codeOf(error)};
      }finally{await stopAnswer();stopFollowing();view.stream={text:'',active:false};nativeTurns.delete(id);emit();}
    },
    async cancel(id:string) {
      customTurns.get(id)?.abort();
      const record=await call('assistantWorkspaceCancel',id);adopt(id,record);emit();return {ok:true};
    },
    async sendCustom(id:string,text:string,environment:any,planningRequest?:any){
      if(customTurns.has(id)||mediaImports.has(id))return {ok:false,code:'ASSISTANT_BUSY'};
      const abort=new AbortController();customTurns.set(id,abort);let turnId='',timedOut=false,streamTimer:ReturnType<typeof setTimeout>|undefined,lastEmit=0;
      const ownerView=viewFor(id);ownerView.stream={text:'',active:false};
      const onText=(text:string)=>{if(abort.signal.aborted||customTurns.get(id)!==abort)return;ownerView.stream={text,active:true};
        if(Date.now()-lastEmit>=40){clearTimeout(streamTimer);streamTimer=undefined;lastEmit=Date.now();emit();}else if(!streamTimer)streamTimer=setTimeout(()=>{streamTimer=undefined;lastEmit=Date.now();emit();},40-(Date.now()-lastEmit));};
      const timer=setTimeout(()=>{timedOut=true;abort.abort();},180000);
      try{
        await flush(id);if(abort.signal.aborted)throw problem('ASSISTANT_CANCELLED');
        if(planningRequest!==undefined&&viewFor(id).record?.value.attachments.length)throw problem('ASSISTANT_ATTACHMENT_UNSUPPORTED');
        const prepared=await call('assistantWorkspaceBeginCustomTurn',id,text);adopt(id,prepared);ownerView.mediaStatus={phase:'idle'};turnId=prepared.value.task.id;emit();
        const result=await customQueue.run(id,abort.signal,async()=>{
          const record=await call('assistantWorkspaceCustomRunning',id,turnId);adopt(id,record);emit();
          const media=await call('assistantWorkspaceReadTurnAttachments',id,turnId);
          if(abort.signal.aborted)throw problem('ASSISTANT_CANCELLED');
          const attachments=media.map((item:any)=>({...item,file:new File([item.bytes],item.name,{type:item.mime})}));
          // beginTurn already appended the current user; the shared builder
          // appends it once itself. Pass completed earlier turns only.
          return runWorkspaceRoleTurn({sessionId:id,roleId:prepared.value.roleId,configuration:prepared.configuration,messages:prepared.value.messages.slice(0,-1),text,attachments,environment,signal:abort.signal,planningRequest,onText});
        });
        if(abort.signal.aborted)throw problem('ASSISTANT_CANCELLED');
        const record=await call('assistantWorkspaceCompleteCustomTurn',id,turnId,{text:result.text});adopt(id,record);viewFor(id).completedTurnId=turnId;
        return {ok:true,value:result.text,warnings:result.warnings};
      }catch(error){
        const code=timedOut?'ASSISTANT_PROVIDER_TIMEOUT':abort.signal.aborted?'ASSISTANT_CANCELLED':codeOf(error);
        if(ownerView.stream.text){ownerView.messages=[...ownerView.messages,{role:'assistant',text:ownerView.stream.text,modelReply:true,incomplete:true}];ownerView.version++;schedule(id);}
        if(turnId)try{adopt(id,await call('assistantWorkspaceCompleteCustomTurn',id,turnId,{code}));}catch{}
        return {ok:false,code};
      }finally{clearTimeout(timer);clearTimeout(streamTimer);ownerView.stream={text:'',active:false};customTurns.delete(id);emit();}
    },
    async change(id:string,patch:{name?:string;archived?:boolean}) {
      const owner=viewFor(id).record?.value.roleId,projectId=viewFor(id).record?.value.projectId||'';
      await flush(id);
      const index=await call('assistantWorkspaceChangeSession',id,patch,snapshot.catalogRevision);
      snapshot={...snapshot,catalog:index.value,catalogRevision:index.revision};emit();
      if(patch.archived&&snapshot.selectedId===id){
        const next=index.value.sessions.find((item:any)=>!item.archived&&item.roleId===owner);
        if(next)await select(next.id);else await create(projectId,owner);
      }
    },
  };
}
export type AssistantWorkspaceClient = ReturnType<typeof createAssistantWorkspaceClient>;
