import {Image,Film,Paperclip,X} from 'lucide-react';
import {assistantAttachmentCopy,assistantAttachmentSize,assistantAttachmentError} from '../lib/assistant-attachment';
export function AssistantAttachments({items,language,onPreview,onRemove,onAgain,attachedIds=[],disabled=false}:{items:any[];language:string;onPreview:(item:any,button:HTMLButtonElement)=>void;onRemove?:(id:string)=>void;onAgain?:(item:any)=>void;attachedIds?:string[];disabled?:boolean}){
 const c=assistantAttachmentCopy(language);
 return <div className="wj-assistant-attachments">{items.map(item=><div className="wj-assistant-attachment" key={item.id}>
  {item.type==='image'?<Image size={15}/>:item.type==='video'?<Film size={15}/>:<Paperclip size={15}/>}
  <button type="button" className="wj-assistant-attachment-preview-button" aria-label={`${c.preview}: ${item.name}`} onClick={event=>onPreview(item,event.currentTarget)}><span data-wanjuan-i18n-skip>{item.name}</span><small>{item.type==='image'?c.image:item.type==='video'?c.video:c.unknown} · {assistantAttachmentSize(item.size)}</small></button>
  {onAgain&&<button type="button" className="wj-assistant-text-button" disabled={disabled||attachedIds.includes(item.id)} onClick={()=>onAgain(item)}>{c.again}</button>}
  {onRemove&&<button type="button" className="wj-assistant-icon-button" aria-label={`${c.remove}: ${item.name}`} disabled={disabled} onClick={()=>onRemove(item.id)}><X size={13}/></button>}
 </div>)}</div>;
}
export function AssistantAttachmentStatus({state,language}:{state:any;language:string}){
 const c=assistantAttachmentCopy(language);if(!state||state.phase==='idle')return null;
 return <div className="wj-assistant-attachment-status" role={state.phase==='failed'?'alert':'status'}>
  <p className="wj-assistant-hint">{state.phase==='failed'?assistantAttachmentError(state.code,language):state.phase==='done'?c.saved:state.phase==='reading'?c.reading:c.saving}{state.phase==='reading'||state.phase==='saving'?` ${state.index}/${state.total}`:''}</p>
  {state.name&&state.phase!=='done'&&<small data-wanjuan-i18n-skip>{state.name}</small>}
  {state.phase==='failed'&&<p className="wj-assistant-hint">{c.failed}</p>}
 </div>;
}
