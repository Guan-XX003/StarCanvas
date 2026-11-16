import {assistantCanvasCopy,assistantCanvasError,assistantCanvasFieldLabel} from '../lib/assistant-canvas-copy';
import {assistantPreflightCopy} from '../lib/assistant-preflight-copy';
import {applicationOperationCopy} from '../lib/application-operation-copy';
import {assistantGenerationCopy} from '../lib/assistant-generation-copy';
import {ApplicationGenerationReview} from './application-generation-review';

/** Only explicit buttons invoke the owner controller; JSON is never authority. */
export function AssistantCanvasPlanPanel({state,language,projectName,disabled,hasMessage,onConfigure,onRequest,onDismiss,onRestart,onEdit,onValidate,onApply,onUndo,onView,onPreflight,onObserve,onPrepareGeneration,onApproveGeneration,onDismissGeneration,onObserveGeneration,onViewGeneration,readOnly=false,confirmLabel,hideDismiss=false}:{
 state:any;language:string;projectName:string;disabled:boolean;hasMessage:boolean;
 onConfigure:(patch:any)=>void;onRequest:()=>void;onDismiss:()=>void;onRestart:()=>void;
 onEdit:(index:number,key:string,value:string)=>void;onValidate:()=>void;onApply:()=>void;onUndo:()=>void;onView:()=>void;onPreflight?:()=>void;
 readOnly?:boolean;confirmLabel?:string;hideDismiss?:boolean;onObserve?:()=>void;
 onPrepareGeneration?:(nodeId:string)=>void;onApproveGeneration?:(consent:{content:boolean;cost:boolean})=>void;onDismissGeneration?:()=>void;onObserveGeneration?:()=>void;onViewGeneration?:(nodeId:string)=>void;
}) {
 if(!state||state.phase==='idle')return null;
 const c=assistantCanvasCopy(language),preview=state.preview,proposal=state.draftProposal;
 const check=assistantPreflightCopy(language),preflight=preview?.generationPreflight;
 const jobCopy=applicationOperationCopy(language);
 const generationCopy=assistantGenerationCopy(language),generation=state.generation;
 const generationPending=['preparing','review','submitting','uncertain'].includes(generation?.phase);
 const types={text:'textNode',image:'promptNode',video:'videoNode'};
 function options(op:any,key:string){
  const node=state.wire?.nodes.find((n:any)=>n.id===op.node),created=proposal?.operations.find((n:any)=>n.op==='create'&&n.key===op.node);
  const type=op.op==='create'?types[op.kind]:node?.type||types[created?.kind];
  const cap=state.wire?.capabilities[`node:${op.node}`]||state.wire?.capabilities[type];
  if(key==='selectedModel')return cap?.models||[];
  const model=op.fields?.selectedModel||node?.parameters?.selectedModel||cap?.models?.[0];
  return cap?.modelParameters?.[model]?.[key]||cap?.parameters?.[key]||[];
 }
 return <section className="wj-assistant-plan-panel" aria-label={c.title} data-wanjuan-i18n-skip data-wanjuan-plan-phase={state.phase}>
  <div className="wj-assistant-plan-heading"><strong>{c.title}</strong>{!hideDismiss&&!['reading','requesting'].includes(state.phase)&&<button type="button" className="wj-assistant-text-button" disabled={state.working||generation?.phase==='uncertain'||disabled&&!state.pendingOperation} onClick={onDismiss}>{state.phase==='scope'?c.cancel:c.close}</button>}</div>
  <p className="wj-assistant-hint">{c.project}: <span>{projectName||'—'}</span></p>
  {state.phase==='scope'&&<>
   <label>{c.scope}<select value={state.scope} disabled={disabled} onChange={e=>onConfigure({scope:e.target.value})}><option value="selected">{c.selected}</option><option value="structure">{c.structure}</option></select></label>
   <label className="wj-assistant-plan-checkbox"><input type="checkbox" checked={state.includeContent} disabled={disabled} onChange={e=>onConfigure({includeContent:e.target.checked})}/>{c.content}</label>
   <p className="wj-assistant-hint">{c.privacy}</p><p className="wj-assistant-hint">{c.context}</p><p className="wj-assistant-hint">{c.cost}</p>
   <button type="button" className="wj-assistant-secondary" disabled={disabled||!hasMessage} onClick={onRequest}>{c.request}</button>
  </>}
  {['reading','requesting'].includes(state.phase)&&<p role="status" className="wj-assistant-hint">{c.working}</p>}
  {state.operationJob&&<p role="status" className="wj-assistant-hint" data-operation-status={state.operationJob.status}>{jobCopy[state.operationJob.status]||state.operationJob.status}</p>}
  {state.pendingOperation&&onObserve&&<button type="button" className="wj-assistant-secondary" disabled={state.working} onClick={onObserve}>{jobCopy.check}</button>}
  {state.pendingOperation&&<p className="wj-assistant-hint">{jobCopy.unknownNote}</p>}
  {preview&&<>
   <p className="wj-assistant-hint">{c.counts}: {Object.entries(preview.counts).filter(([,v])=>!!v).map(([key,value])=>`${c[key]||key} ${value}`).join(' · ')}</p>
   {['preview','invalid'].includes(state.phase)&&<>
    {state.phase==='preview'&&!state.dirty&&!state.working&&<p className="wj-assistant-hint">{c.ready}</p>}
    <fieldset disabled={readOnly} className="wj-assistant-plan-fields"><details className="wj-assistant-plan-operations" open><summary>{c.details}</summary><ol>{proposal.operations.map((op:any,index:number)=><li key={index}>
     <div><strong>{index+1}. {c[op.op]||op.op}</strong> <code>{op.key||op.node||`${op.source} → ${op.target}`}</code>{op.source&&op.op==='reference'&&<code> ← {op.source}</code>}{op.position&&<code> ({op.position.x}, {op.position.y})</code>}</div>
     {op.fields&&Object.entries(op.fields).map(([key,value])=>{const values=options(op,key),label=assistantCanvasFieldLabel(key,language);return <label key={key} className="wj-assistant-plan-field"><span title={key}>{label}</span>{values.length?<select data-wanjuan-plan-field={key} aria-label={`${index+1}. ${label}`} value={String(value)} disabled={disabled} onChange={e=>onEdit(index,key,e.target.value)}>{!values.includes(value)&&<option value={String(value)}>{String(value)}</option>}{values.map((v:string)=><option key={v} value={v}>{v}</option>)}</select>:<textarea data-wanjuan-plan-field={key} aria-label={`${index+1}. ${label}`} rows={['prompt','text'].includes(key)?2:1} maxLength={['prompt','text'].includes(key)?16000:512} value={String(value)} disabled={disabled} onChange={e=>onEdit(index,key,e.target.value)}/>}</label>;})}
    </li>)}</ol></details></fieldset>
    {!!preview.effectiveNodes?.length&&<details className="wj-assistant-plan-defaults"><summary>{c.effective}</summary>{preview.effectiveNodes.map((node:any)=><p key={node.id}><code>{node.type}: {JSON.stringify(node.parameters)}</code></p>)}</details>}
    {state.dirty&&<p className="wj-assistant-hint">{c.dirty}</p>}
    {state.dirty&&<button type="button" className="wj-assistant-secondary" disabled={disabled} onClick={onValidate}>{c.validate}</button>}
    <button type="button" className="wj-assistant-primary" disabled={disabled||state.dirty||state.phase!=='preview'} onClick={onApply}>{confirmLabel||c.confirm}</button>
   </>}
  </>}
  {preflight&&['preview','applied'].includes(state.phase)&&<details className="wj-assistant-plan-preflight"><summary>{check.title}</summary>
   <p className="wj-assistant-hint">{preflight.basis==='proposal'?check.proposal:check.current}</p><p className="wj-assistant-hint">{check.note}</p>
   <ul>{preflight.nodes.map((node:any,index:number)=><li key={node.nodeId}><strong title={node.nodeId}>{index+1}. {check.mode[node.mode]||node.mode}</strong><dl>
    <dt>{check.model}</dt><dd>{check.status[node.model]||node.model}</dd><dt>{check.configuration}</dt><dd>{check.status[node.configuration]||node.configuration}</dd>
    <dt>{check.input}</dt><dd>{node.input?check.yes:check.no}</dd><dt>{check.references}</dt><dd>{check.status[node.references]||node.references}</dd><dt>{check.task}</dt><dd>{node.taskIdle?check.idle:check.busy}</dd>
   </dl></li>)}</ul>{onPreflight&&<button type="button" className="wj-assistant-secondary" disabled={disabled||state.dirty} onClick={onPreflight}>{check.refresh}</button>}
  </details>}
  {state.phase==='applied'&&<><p role="status" className="wj-assistant-hint">{c.done}</p><button type="button" className="wj-assistant-secondary" disabled={disabled||generationPending||state.code==='PLAN_UNDO_CONFLICT'} onClick={onUndo}>{c.undo}</button><button type="button" className="wj-assistant-text-button" onClick={onView}>{c.view}</button>
   {onPrepareGeneration&&<section className="wj-assistant-plan-preflight" aria-label={generationCopy.title} data-generation-phase={generation?.phase||'idle'}>
    <strong>{generationCopy.title}</strong>
    {(preflight?.nodes||[]).filter((n:any)=>n.mode==='generation'&&['promptNode','videoNode'].includes(n.type)).map((n:any,index:number)=><button type="button" key={n.nodeId} title={n.nodeId} className="wj-assistant-secondary" disabled={disabled||generationPending} onClick={()=>onPrepareGeneration(n.nodeId)}>{generationCopy.review} · {generationCopy[n.type==='promptNode'?'image':'video']} {index+1}</button>)}
    {generation?.phase==='preparing'&&<p role="status" className="wj-assistant-hint">{generationCopy.prepare}</p>}
    {generation?.phase==='review'&&generation.review&&onApproveGeneration&&<ApplicationGenerationReview key={`${generation.handle.id}:${generation.revision}`} review={generation.review} language={language} disabled={disabled} onApprove={onApproveGeneration} onCancel={onDismissGeneration}/>}
    {generation?.phase==='submitting'&&<p role="status" className="wj-assistant-hint">{generationCopy.submitting}</p>}
    {generation?.phase==='uncertain'&&<><p role="status" className="wj-assistant-hint">{generationCopy.unknown}</p><button type="button" className="wj-assistant-secondary" disabled={disabled} onClick={onObserveGeneration}>{generationCopy.check}</button></>}
    {generation?.phase==='failed'&&<p role="alert" className="wj-assistant-hint">{generationCopy.failed} <code>{generation.code}</code></p>}
    {generation?.phase==='accepted'&&<><p role="status" className="wj-assistant-hint">{generationCopy.accepted}</p><button type="button" className="wj-assistant-text-button" onClick={()=>onViewGeneration?.(generation.result.nodeId)}>{c.view}</button></>}
   </section>}
  </>}
  {state.phase==='undone'&&<p role="status" className="wj-assistant-hint">{c.undone}</p>}
  {state.code&&<p role="alert" className="wj-assistant-error">{assistantCanvasError(state.code,language)}</p>}
  {['expired','failed'].includes(state.phase)&&<button type="button" className="wj-assistant-secondary" disabled={disabled} onClick={onRestart}>{c.title}</button>}
 </section>;
}
