type Receipt={ok:boolean;code?:string};
type Prepare=()=>Promise<Receipt>;
const problem=()=>({ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'});

/** Only main's normal-close path uses this local-save registry. No model task
 * is awaited/retried, no filesystem authority or close approval IPC is added. */
export function createDesktopCloseRegistry(freeze:()=>()=>void,notice:(code:string)=>void){
 const participants=new Map<string,Map<Prepare,number>>();
 let epoch=0;
 let active:{id:string;aborted:boolean;settled:boolean;thaw:()=>void;promise:Promise<Receipt>}|null=null;
 function release(id:string,code:string){
  if(!active||active.id!==id)return;
  active.aborted=true;active.thaw();notice(code);
  if(active.settled)active=null;
 }
 function register(name:'canvas'|'assistant'|'settings',prepare:Prepare){
  let group=participants.get(name);if(!group){group=new Map();participants.set(name,group);}
  if(!group.has(prepare))epoch++;
  group.set(prepare,(group.get(prepare)||0)+1);let removed=false;
  return()=>{if(removed)return;removed=true;const count=group!.get(prepare)||0;if(count<=1){group!.delete(prepare);epoch++;}else group!.set(prepare,count-1);if(!group!.size)participants.delete(name);};
 }
 function prepare(id:string):Promise<Receipt>{
  if(!/^[a-f0-9-]{36}$/.test(id))return Promise.resolve(problem());
  if(active)return active.id===id?active.promise:Promise.resolve({ok:false,code:'DESKTOP_CLOSE_BUSY'});
  if(!participants.get('canvas')?.size)return Promise.resolve({ok:false,code:'DESKTOP_CLOSE_NOT_READY'});
  const restore=freeze(),capturedEpoch=epoch;let thawed=false;
  const thaw=()=>{if(!thawed){thawed=true;restore();}};
  const job={id,aborted:false,settled:false,thaw,promise:null};active=job;
  const pending=[...new Set([...participants.values()].flatMap(group=>[...group.keys()]))];
  job.promise=Promise.allSettled(pending.map(run=>Promise.resolve().then(run))).then(results=>{
   job.settled=true;
   if(job.aborted){if(active===job)active=null;return {ok:false,code:'DESKTOP_CLOSE_TIMEOUT'};}
   const failed=epoch!==capturedEpoch||results.some(result=>result.status==='rejected'||result.value?.ok!==true);
   if(failed){thaw();notice('DESKTOP_CLOSE_SAVE_FAILED');if(active===job)active=null;return problem();}
   // Keep input frozen until main closes this document or releases this lease.
   return {ok:true};
  });
  return job.promise;
 }
 return {register,prepare,release};
}

function copy(){
 const lang=(globalThis as any).wanjuanI18nRuntime?.getLanguage?.();
 return lang==='en-US'?{saving:'Saving local changes…',blocked:'Could not confirm all local changes were saved. The window stays open; check storage and try closing again.',continue:'Keep working'}:lang==='zh-TW'?{saving:'正在儲存本機變更…',blocked:'無法確認本機變更已完整儲存，視窗已保留。請檢查儲存狀態後再關閉。',continue:'繼續使用'}:{saving:'正在保存本地更改…',blocked:'无法确认本地更改已完整保存，窗口已保留。请检查存储状态后再关闭。',continue:'继续使用'};
}
let registry:ReturnType<typeof createDesktopCloseRegistry>;
const presentationDocuments=new Set<Document>();
export function registerDesktopCloseDocument(doc:Document){presentationDocuments.add(doc);return()=>{presentationDocuments.delete(doc);};}
export function freezeDesktopCloseDocuments(documents:Document[]){
 const roots=[...new Set(documents)].map(doc=>({root:doc.getElementById('root'),focused:doc.activeElement as HTMLElement,oldInert:doc.getElementById('root')?.inert}));
 for(const item of roots)if(item.root)item.root.inert=true;
 return()=>{for(const {root,oldInert,focused} of roots){if(root)root.inert=!!oldInert;if(focused?.isConnected)focused.focus?.();}};
}
export function registerDesktopCloseParticipant(name:'canvas'|'assistant'|'settings',prepare:Prepare){
 if(typeof document==='undefined')return()=>{};
 if(!registry){
  let banners:HTMLElement[]=[];
  const panels=()=>{
   banners.forEach(element=>element.remove());banners=[];
   for(const doc of new Set([document,...presentationDocuments])){
    if(doc.defaultView?.closed||!doc.body)continue;
    const element=doc.createElement('div');element.dataset.wanjuanI18nSkip='';element.style.cssText='position:fixed;z-index:2147483646;left:50%;bottom:28px;transform:translateX(-50%);width:min(420px,calc(100% - 32px));box-sizing:border-box;padding:18px;border-radius:18px;background:var(--wj-surface,#23262d);color:var(--wj-text,#eee);border:1px solid var(--wj-control-border,#555);box-shadow:0 12px 42px #0004;font:13px/1.6 system-ui,sans-serif';doc.body.append(element);banners.push(element);
   }
   return banners;
  };
  registry=createDesktopCloseRegistry(()=>{
   const restoreDocuments=freezeDesktopCloseDocuments([document,...presentationDocuments]);
   const elements=panels();for(const element of elements){element.setAttribute('role','status');element.textContent=copy().saving;}
   const block=document.createElement('div');block.style.cssText='position:fixed;inset:0;z-index:2147483645;cursor:progress';document.body.append(block);
   let thawed=false;return()=>{if(thawed)return;thawed=true;block.remove();elements.forEach(element=>element.remove());restoreDocuments();};
  },()=>{
   const text=copy();for(const element of panels()){
    const doc=element.ownerDocument;element.setAttribute('role','alert');element.append(doc.createTextNode(text.blocked));
    const button=doc.createElement('button');button.textContent=text.continue;button.style.cssText='display:block;margin-top:12px;border-radius:12px;padding:6px 12px;border:1px solid var(--wj-control-border,#555);background:var(--wj-control-bg,#333);color:inherit;font:inherit';button.onclick=()=>element.remove();element.append(button);
   }
  });
  Object.defineProperty(globalThis,'__wanjuanDesktopClose',{value:Object.freeze({version:1,prepare:registry.prepare,release:registry.release}),writable:false,configurable:false});
 }
 return registry.register(name,prepare);
}
