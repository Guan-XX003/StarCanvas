import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {AssistantMessage} from '../lib/assistant-onboarding';
import {assistantHistoryCopy} from '../lib/assistant-history';
import {useAssistantHistory} from '../hooks/useAssistantHistory';
import {AssistantHistoryControls} from './assistant-history-controls';
import {AssistantModelQuote} from './assistant-model-quote';
const empty:AssistantMessage[]=[];
// Read-only archive access must not unarchive/select a session, revive a saved
// approval or observe a paid task. No model request or file materialization.
export function AssistantArchivePreview({id,name,language,onClose}:{id:string;name:string;language:string;onClose:()=>void}){
 const c=assistantHistoryCopy(language),[loaded,setLoaded]=useState<{id:string;messages:AssistantMessage[];failed:boolean}|null>(null);
 const ref=useRef<HTMLDivElement>(null),close=useRef<HTMLButtonElement>(null),follow=useRef(true);
 const owned=loaded?.id===id?loaded:null,messages=owned?.messages||empty,h=useAssistantHistory(id,messages,ref,follow);
 useEffect(()=>{let active=true;close.current?.focus();
  void window.wanjuanDesktop?.assistantWorkspaceReadSession?.(id).then(reply=>{
   if(!active)return;if(!reply?.ok||reply.value?.value?.id!==id||!Array.isArray(reply.value.value.presentation))throw Error('ARCHIVE_READ_FAILED');
   setLoaded({id,messages:reply.value.value.presentation,failed:false});
  }).catch(()=>{if(active)setLoaded({id,messages:empty,failed:true});});
  return ()=>{active=false;};
 },[id]);
 useEffect(()=>{if(follow.current&&ref.current)ref.current.scrollTop=ref.current.scrollHeight;},[messages]);
 return <section className="wj-assistant-archive-preview" role="dialog" aria-modal="true" aria-label={c.readonly} onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
  if(event.key==='Tab'){const controls=Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')),first=controls[0],last=controls.at(-1);if(!controls.includes(document.activeElement as HTMLElement)){event.preventDefault();(event.shiftKey?last:first)?.focus();}else if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
 }}>
  <header><div><strong>{c.readonly}</strong><p data-wanjuan-i18n-skip>{name}</p></div><button ref={close} type="button" className="wj-assistant-icon-button" aria-label={c.closeArchive} onClick={onClose}><X size={16}/></button></header>
  <p className="wj-assistant-hint">{c.readHint}</p>
  {!owned?<p role="status">{c.loading}</p>:owned.failed?<p role="alert">{c.error}</p>:<>
   <AssistantHistoryControls history={h} language={language}/>
   <div ref={ref} className="wj-assistant-conversation" onScroll={event=>{const el=event.currentTarget;follow.current=el.scrollHeight-el.clientHeight-el.scrollTop<48;}}>
    {messages.slice(h.range.start,h.range.end).map((item,offset)=>{const index=h.range.start+offset;return <div key={index} tabIndex={-1} data-assistant-history-index={index} data-assistant-history-match={h.match===index?'true':undefined}>
     {item.role==='assistant'&&item.modelReply?<AssistantModelQuote text={item.text} language={language} incomplete={item.incomplete}/>:<><p className="wj-assistant-hint">{item.role==='assistant'?c.past:''}</p><p className={item.role==='user'?'wj-assistant-message wj-assistant-user':'wj-assistant-message'} data-wanjuan-i18n-skip>{item.text}</p></>}
     {item.attachments?.map(file=><p key={file.id} className="wj-assistant-hint" data-wanjuan-i18n-skip>{file.name}</p>)}
    </div>;})}
   </div>
  </>}
 </section>;
}
