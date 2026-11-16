import {useLayoutEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {assistantHistoryRange,assistantHistoryMatches,assistantHistoryStartAfterChange,ASSISTANT_HISTORY_PAGE_SIZE} from '../lib/assistant-history';
type Message={text:string;attachments?:readonly {name:string}[]};
const initial=(owner:string)=>({owner,start:null as number|null,draft:'',query:'',cursor:0,searchOpen:false});
export function useAssistantHistory(owner:string,messages:readonly Message[],container:RefObject<HTMLDivElement|null>,follow:RefObject<boolean>){
 const [state,setState]=useState(()=>initial(owner));
 const current=state.owner===owner?state:initial(owner),range=assistantHistoryRange(messages.length,current.start);
 const matches=useMemo(()=>assistantHistoryMatches(messages,current.query),[messages,current.query]);
 const cursor=Math.min(current.cursor,Math.max(0,matches.length-1)),match=current.query?matches[cursor]:undefined;
 const pending=useRef<{owner:string;index?:number;bottom?:boolean}|null>(null);
 const previousRange=useRef({owner,total:messages.length,start:range.start});
 function update(patch:Partial<ReturnType<typeof initial>>){setState(previous=>({...((previous.owner===owner)?previous:initial(owner)),...patch}));}
 function page(start:number|null){follow.current=start===null;pending.current={owner,bottom:start===null};update({start});}
 function locate(index:number,cursor:number,query=current.query){
  follow.current=false;pending.current={owner,index};update({query,cursor,start:Math.floor(index/ASSISTANT_HISTORY_PAGE_SIZE)*ASSISTANT_HISTORY_PAGE_SIZE});
 }
 useLayoutEffect(()=>{
  const start=assistantHistoryStartAfterChange(current.start,previousRange.current,owner,messages.length,follow.current);
  if(start!==current.start)update({start});
 },[owner,messages.length]);
 useLayoutEffect(()=>{
  previousRange.current={owner,total:messages.length,start:range.start};
  const target=pending.current,el=container.current;if(!target||target.owner!==owner||!el)return;pending.current=null;
  if(target.index!==undefined){const row=el.querySelector<HTMLElement>(`[data-assistant-history-index="${target.index}"]`);if(row){el.scrollTop+=row.getBoundingClientRect().top-el.getBoundingClientRect().top-12;row.focus({preventScroll:true});}}
  else el.scrollTop=target.bottom?el.scrollHeight:0;
 });
 return {range,draft:current.draft,query:current.query,searchOpen:current.searchOpen,matches,cursor,match,
  setDraft:(draft:string)=>update({draft:draft.slice(0,120)}),
  toggleSearch:()=>update({searchOpen:!current.searchOpen,...(current.searchOpen?{query:'',draft:'',cursor:0}:{})}),
  search(){const query=current.draft.trim(),found=assistantHistoryMatches(messages,query);if(found.length)locate(found[0],0,query);else update({query,cursor:0});},
  moveMatch(delta:number){if(!matches.length)return;const next=(cursor+delta+matches.length)%matches.length;locate(matches[next],next);},
  earlier:()=>page(Math.max(0,range.start-ASSISTANT_HISTORY_PAGE_SIZE)),
  later:()=>page(range.end>=messages.length-ASSISTANT_HISTORY_PAGE_SIZE?null:range.start+ASSISTANT_HISTORY_PAGE_SIZE),
  latest:()=>page(null),
 };
}
export type AssistantHistory=ReturnType<typeof useAssistantHistory>;
