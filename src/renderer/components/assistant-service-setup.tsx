import {useRef,useState} from 'react';
import {ArrowLeft,Check,Eye,EyeOff} from 'lucide-react';
import {assistantInterfaceCopy} from '../lib/assistant-interface-copy';
import {assistantServiceTypes,checkAssistantService,type AssistantServiceDraft,type AssistantServiceType} from '../lib/assistant-interface';

export function AssistantServiceSetup({language,connected,disabled,onBack,onContinue,onManual}:{language:string;connected:boolean;disabled:boolean;onBack:()=>void;onManual:()=>void;onContinue:(input:AssistantServiceDraft)=>Promise<void>}) {
  const c=assistantInterfaceCopy(language);
  const [draft,setDraft]=useState<AssistantServiceDraft>({category:'image',url:'',model:'',key:'',docs:''});
  const [phase,setPhase]=useState<'fields'|'review'>('fields'),[invalid,setInvalid]=useState(''),[checked,setChecked]=useState(false),[visible,setVisible]=useState(false),[saving,setSaving]=useState(false),[failed,setFailed]=useState(false);
  const inFlight=useRef(false);
  function update(key:keyof AssistantServiceDraft,value:string){setDraft(previous=>({...previous,[key]:value}));setInvalid('');setChecked(false);setFailed(false);}
  function check(){const problem=checkAssistantService(draft);setInvalid(problem);setChecked(!problem);return !problem;}
  async function submit(){
    if(inFlight.current||disabled||!check())return;
    inFlight.current=true;setSaving(true);setFailed(false);setVisible(false);
    try{await onContinue({...draft});setDraft(previous=>({...previous,key:''}));setPhase('fields');setChecked(false);}
    catch{setFailed(true);}finally{inFlight.current=false;setSaving(false);}
  }
  const fields=[['docs',c.docs,c.docsPlaceholder,'url'],['url',c.url,c.urlPlaceholder,'url'],['model',c.model,c.modelPlaceholder,'text']] as const;
  return <section className="wj-assistant-page wj-assistant-service-page" aria-labelledby="wj-service-title" data-wanjuan-i18n-skip>
    <header className="wj-assistant-page-title"><h2 id="wj-service-title">{c.setup}</h2><p>{connected?c.connected:c.setupHint}</p></header>
    <fieldset disabled={saving||disabled} className="wj-assistant-service-fields">
      <legend className="wj-assistant-sr-only">{c.type}</legend>
      <div className="wj-assistant-service-types" role="group" aria-label={c.type}>{assistantServiceTypes.map(type=><button type="button" key={type} aria-pressed={draft.category===type} onClick={()=>{update('category',type as AssistantServiceType);setPhase('fields');}}>{c[type]}</button>)}</div>
      <ol className="wj-assistant-steps" aria-label={c.setup}><li><Check size={15}/>{c.type}</li><li aria-current={phase==='fields'?'step':undefined}>2 <span>{c.fields}</span></li><li aria-current={phase==='review'?'step':undefined}>3 <span>{c.review}</span></li></ol>
      {phase==='fields'?<>
        {fields.map(([key,label,placeholder,type])=><label className="wj-assistant-field" key={key}>{label}<input type={type} name={`assistant-${key}`} autoComplete="off" spellCheck={false} value={draft[key]} placeholder={placeholder} maxLength={key==='model'?256:2048} aria-invalid={invalid===key||undefined} onChange={event=>update(key,event.target.value)}/></label>)}
        <label className="wj-assistant-field">{c.key}<span className="wj-assistant-password"><input type={visible?'text':'password'} name="assistant-provider-key" autoComplete="off" spellCheck={false} value={draft.key} maxLength={4096} aria-invalid={invalid==='key'||undefined} onChange={event=>update('key',event.target.value)}/><button type="button" className="wj-assistant-icon-button" aria-label={visible?c.hideKey:c.showKey} aria-pressed={visible} onClick={()=>setVisible(value=>!value)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button></span><small>{c.keyHint}</small></label>
        <div className="wj-assistant-inline-check"><button type="button" className="wj-assistant-secondary" onClick={check}>{c.check}</button><span>{c.checkHint}</span></div>
        {checked&&<p className="wj-assistant-hint" role="status">{c.checked}</p>}
        <details className="wj-assistant-advanced"><summary>{c.advanced}</summary><p>{draft.category==='jimeng'?c.jimengHint:c.analysis}</p><button type="button" className="wj-assistant-text-button" onClick={onManual}>{c.manual}</button></details>
      </>:<>
        <dl className="wj-assistant-review"><div><dt>{c.type}</dt><dd>{c[draft.category]}</dd></div><div><dt>{c.url}</dt><dd>{draft.url}</dd></div><div><dt>{c.model}</dt><dd>{draft.model}</dd></div><div><dt>{c.key}</dt><dd>{c.masked}</dd></div></dl>
        <p className="wj-assistant-hint">{c.reviewHint}</p><p className="wj-assistant-hint">{draft.category==='jimeng'?c.jimengHint:c.analysis}</p>
      </>}
    </fieldset>
    {invalid&&<p role="alert" className="wj-assistant-error">{c.fieldError}</p>}{failed&&<p role="alert" className="wj-assistant-error">{c.saveError}</p>}{disabled&&<p role="status" className="wj-assistant-hint">{c.unavailable}</p>}
    <footer className="wj-assistant-page-actions"><button type="button" className="wj-assistant-secondary" disabled={saving} onClick={phase==='review'?()=>setPhase('fields'):onBack}><ArrowLeft size={15}/>{phase==='review'?c.edit:c.back}</button><button type="button" className="wj-assistant-primary" disabled={saving||disabled} onClick={phase==='review'?()=>void submit():()=>{if(check()){setVisible(false);setPhase('review');}}}>{saving?c.saving:phase==='review'?c.save:c.next}</button></footer>
  </section>;
}
