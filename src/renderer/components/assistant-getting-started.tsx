import {useEffect,useState} from 'react';
import {assistantGettingStartedCopy,assistantExampleRequest} from '../lib/assistant-getting-started';
export function AssistantGettingStarted({language,projectId,customRole,assistantStatus,getSummary,onAssistant,onApi,onModels,onExample,disabled}:{language:string;projectId:string;customRole:boolean;assistantStatus:'loading'|'configured'|'missing';getSummary:()=>any;onAssistant:()=>void;onApi:()=>void;onModels:()=>void;onExample:(text:string)=>void;disabled:boolean}){
 const c=assistantGettingStartedCopy(language),[expanded,setExpanded]=useState(false),[summary,setSummary]=useState<any>(null);
 function check(){try{setSummary(getSummary()||null);}catch{setSummary(null);}}
 useEffect(()=>{if(expanded)check();},[expanded,projectId]);
 const configuration=(value:string)=>value==='present'?c.present:value==='unverified'?c.unverified:value==='missing-binding'?c.missingBinding:c.needsSetup;
 return <details className="wj-assistant-getting-started" onToggle={event=>setExpanded(event.currentTarget.open)}>
  <summary>{c.title}</summary>
  {expanded&&<div className="wj-assistant-getting-started-body">
   <div><strong>{c.assistant}</strong><p className="wj-assistant-hint">{customRole?c.role:assistantStatus==='loading'?c.loading:assistantStatus==='configured'?c.connected:c.missing}</p><button type="button" className="wj-assistant-text-button" disabled={disabled} onClick={onAssistant}>{customRole?c.editRole:c.edit}</button></div>
   <div><strong>{c.models}</strong>{summary?(['image','video'] as const).map(kind=><p key={kind} className="wj-assistant-hint">{kind==='image'?c.image:c.video}: <span data-wanjuan-i18n-skip>{summary[kind]?.modelCount||0}</span> {c.listed} · {configuration(summary[kind]?.configuration)}</p>):<p className="wj-assistant-hint">{c.unknown}</p>}<div className="wj-assistant-getting-started-actions"><button type="button" className="wj-assistant-text-button" onClick={check}>{c.refresh}</button><button type="button" className="wj-assistant-text-button" disabled={disabled} onClick={onApi}>{c.api}</button><button type="button" className="wj-assistant-text-button" disabled={disabled} onClick={onModels}>{c.modelSettings}</button></div><p className="wj-assistant-hint">{c.note}</p></div>
   <div><strong>{c.examples}</strong><div className="wj-assistant-getting-started-actions">{(['image','video','failure'] as const).map(kind=><button type="button" key={kind} className="wj-assistant-text-button" disabled={disabled} onClick={()=>onExample(assistantExampleRequest(kind,language))}>{kind==='image'?c.imageExample:kind==='video'?c.videoExample:c.failureExample}</button>)}</div><p className="wj-assistant-hint">{c.exampleNote}</p></div>
  </div>}
 </details>;
}
