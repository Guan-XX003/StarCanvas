import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {assistantAttachmentCopy,assistantAttachmentError,createAssistantMediaPreview} from '../lib/assistant-attachment';
export function AssistantMediaPreview({ownerId,attachment,language,onClose}:{ownerId:string;attachment:any;language:string;onClose:()=>void}){
 const c=assistantAttachmentCopy(language),[state,setState]=useState<any>({phase:'loading'}),[retry,setRetry]=useState(0),close=useRef<HTMLButtonElement>(null),panel=useRef<HTMLElement>(null);
 const [preview]=useState(()=>createAssistantMediaPreview({
  read:async(owner,id)=>{const r=await window.wanjuanDesktop?.assistantWorkspacePreviewAttachment?.(owner,id);if(!r?.ok)throw Object.assign(Error(),{code:r?.code||'ASSISTANT_MEDIA_UNAVAILABLE'});return r.value;},
  makeUrl:(bytes,mime)=>URL.createObjectURL(new Blob([bytes as BlobPart],{type:mime})),revokeUrl:url=>URL.revokeObjectURL(url),onChange:setState,
 }));
 useEffect(()=>{close.current?.focus();void preview.open(ownerId,attachment);return()=>preview.close();},[ownerId,attachment.id,preview,retry]);
 // Focus guards, rather than intercepting Tab on <video>, preserve its native
 // shadow-control keyboard navigation while keeping the dialog bounded.
 const focusLast=()=>Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),video,input:not(:disabled)')||[]).at(-1)?.focus();
 return <section ref={panel} className="wj-assistant-media-preview" role="dialog" aria-modal="true" aria-label={c.title} onKeyDown={event=>{
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();onClose();}
 }}>
  <span tabIndex={0} className="wj-assistant-focus-guard" onFocus={focusLast}/>
  <header><div><strong>{c.title}</strong><p data-wanjuan-i18n-skip>{attachment.name}</p></div><button ref={close} type="button" className="wj-assistant-icon-button" aria-label={c.close} onClick={onClose}><X size={16}/></button></header>
  <p className="wj-assistant-hint">{c.hint}</p>
  {state.phase==='loading'?<p role="status">{c.loading}</p>:state.phase==='failed'?<div role="alert"><p>{assistantAttachmentError(state.code,language)}</p><button type="button" className="wj-assistant-secondary" onClick={()=>setRetry(n=>n+1)}>{c.retry}</button></div>:<div className="wj-assistant-media-preview-content">
   {state.type==='image'?<img src={state.url} alt={attachment.name} onLoad={event=>preview.imageSize(state.url,event.currentTarget.naturalWidth,event.currentTarget.naturalHeight)} onError={()=>preview.decodeFailed(state.url)}/>:<video src={state.url} controls preload="metadata" onError={()=>preview.decodeFailed(state.url)}/>}
  </div>}
  <span tabIndex={0} className="wj-assistant-focus-guard" onFocus={()=>close.current?.focus()}/>
 </section>;
}
