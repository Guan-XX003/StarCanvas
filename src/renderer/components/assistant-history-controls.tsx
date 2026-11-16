import {ChevronLeft,ChevronRight,Search,X} from 'lucide-react';
import {useRef} from 'react';
import {assistantHistoryCopy} from '../lib/assistant-history';
import type {AssistantHistory} from '../hooks/useAssistantHistory';
export function AssistantHistoryControls({history:h,language}:{history:AssistantHistory;language:string}){
 const c=assistantHistoryCopy(language),r=h.range;
 const toggle=useRef<HTMLButtonElement>(null);
 return <section className="wj-assistant-history-tools" aria-label={c.title}>
  <nav className="wj-assistant-history-pages" aria-label={c.title}>
   <button type="button" className="wj-assistant-text-button" aria-label={c.olderLabel} disabled={!r.older} onClick={h.earlier}><ChevronLeft size={13}/>{c.older}</button>
   <span className="wj-assistant-history-count" data-wanjuan-i18n-skip>{r.total?r.start+1:0}–{r.end} / {r.total}</span>
   <button type="button" className="wj-assistant-text-button" aria-label={c.newerLabel} disabled={!r.newer} onClick={h.later}>{c.newer}<ChevronRight size={13}/></button>
   {r.newer&&<button type="button" className="wj-assistant-text-button" onClick={h.latest}>{c.latest}</button>}
   <button ref={toggle} type="button" className="wj-assistant-icon-button" aria-label={h.searchOpen?c.close:c.find} title={h.searchOpen?c.close:c.find} aria-expanded={h.searchOpen} onClick={h.toggleSearch}>{h.searchOpen?<X size={14}/>:<Search size={14}/>}</button>
  </nav>
  {h.searchOpen&&<form className="wj-assistant-history-search" onSubmit={event=>{event.preventDefault();h.search();}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();toggle.current?.focus({preventScroll:true});h.toggleSearch();}}}>
   <input type="search" autoFocus aria-label={c.query} placeholder={c.query} value={h.draft} maxLength={120} onChange={event=>h.setDraft(event.target.value)}/>
   <button type="submit" className="wj-assistant-text-button">{c.search}</button>
   {h.query&&<><span role="status" className="wj-assistant-history-count" data-wanjuan-i18n-skip>{h.matches.length?`${h.cursor+1} / ${h.matches.length}`:c.noMatches}</span><button type="button" className="wj-assistant-icon-button" aria-label={c.previous} disabled={!h.matches.length} onClick={()=>h.moveMatch(-1)}><ChevronLeft size={14}/></button><button type="button" className="wj-assistant-icon-button" aria-label={c.next} disabled={!h.matches.length} onClick={()=>h.moveMatch(1)}><ChevronRight size={14}/></button></>}
  </form>}
 </section>;
}
