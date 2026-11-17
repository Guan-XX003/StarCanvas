import {useEffect,useRef,useState} from 'react';
import {ArrowLeft,RefreshCw} from 'lucide-react';
import {assistantFailureChoices} from '../lib/assistant-interface';
import {assistantInterfaceCopy} from '../lib/assistant-interface-copy';
import {buildAssistantFailureSummary,buildAssistantLocalDiagnosis} from '../lib/assistant-onboarding';
import {assistantTaskReadFailure} from '../lib/assistant-task-reader';

export function AssistantDiagnosis({language,owner,disabled,read,onBack,onApi,onAnalyze,initial,onSnapshot}:{language:string;owner:string;disabled:boolean;read:()=>Promise<any[]>;onBack:()=>void;onApi:()=>void;onAnalyze:(id:string)=>void;initial?:{tasks:any[];selected:string};onSnapshot?:(value:{tasks:any[];selected:string})=>void}) {
  const c=assistantInterfaceCopy(language),[tasks,setTasks]=useState<any[]>(()=>initial?.tasks||[]),[selected,setSelected]=useState(initial?.selected||''),[loading,setLoading]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(!!initial);
  const generation=useRef(0),running=useRef(false);
  // Local, allowlisted reads only. An old session's completion cannot replace
  // the current selection or forward content to a model.
  async function refresh(){
    if(running.current||disabled)return;running.current=true;const version=++generation.current;
    setLoading(true);setError('');setSelected('');setTasks([]);
    try{const records=await read();if(version===generation.current){setTasks(records);setLoaded(true);onSnapshot?.({tasks:records,selected:''});}}
    catch(error:any){if(version===generation.current)setError(assistantTaskReadFailure(error?.code,language));}
    finally{if(version===generation.current){setLoading(false);running.current=false;}}
  }
  useEffect(()=>{setTasks(initial?.tasks||[]);setSelected(initial?.selected||'');setLoaded(!!initial);setError('');setLoading(false);return()=>{generation.current++;running.current=false;};},[owner]);
  const choices=assistantFailureChoices(tasks),task=choices.find(item=>item.id===selected),record=task?tasks.find(item=>item.id===task.id):null;
  return <section className="wj-assistant-page wj-assistant-diagnosis-page" aria-labelledby="wj-diagnosis-title" data-wanjuan-i18n-skip>
    <header className="wj-assistant-page-title"><h2 id="wj-diagnosis-title">{c.diagnosisTitle}</h2><p>{c.diagnosisHint}</p></header>
    <button type="button" className="wj-assistant-secondary" disabled={loading||disabled} onClick={()=>void refresh()}><RefreshCw size={15}/>{loading?c.reading:c.refresh}</button>
    {error&&<p role="alert" className="wj-assistant-error">{error}</p>}
    <div className="wj-assistant-failure-list" role="group" aria-label={c.task}>
      {choices.map((item,index)=><label key={item.id} className="wj-assistant-failure-row" data-selected={item.id===selected}><input type="radio" name="assistant-failed-task" checked={item.id===selected} onChange={()=>{setSelected(item.id);onSnapshot?.({tasks,selected:item.id});}}/><span>{c[item.type as 'video']||c.task} · {index+1}</span><span>{item.diagnostic?.status==='unknown'?c.unknown:item.diagnostic?.status} · {c.failed}</span></label>)}
      {loaded&&!loading&&!choices.length&&<p role="status" className="wj-assistant-hint">{c.empty}</p>}
    </div>
    {record?<><h3>{c.possible}</h3><p className="wj-assistant-diagnosis-result">{buildAssistantLocalDiagnosis([record],language,'selected')}</p><details className="wj-assistant-advanced"><summary>{c.summary}</summary><pre>{buildAssistantFailureSummary([record],language,'selected')}</pre></details><p className="wj-assistant-hint">{c.analyzeHint}</p></>:choices.length>0?<p className="wj-assistant-hint">{c.noSelection}</p>:null}
    <footer className="wj-assistant-page-actions"><button type="button" className="wj-assistant-secondary" onClick={onBack}><ArrowLeft size={15}/>{c.back}</button><button type="button" className="wj-assistant-secondary" onClick={onApi}>{c.apiCheck}</button><button type="button" className="wj-assistant-primary" disabled={!task||loading||disabled} onClick={()=>task&&onAnalyze(task.id)}>{c.analyze}</button></footer>
  </section>;
}
