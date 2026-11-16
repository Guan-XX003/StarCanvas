import {useCallback,useEffect,useRef,useState} from 'react';
import {AssistantCanvasPlanPanel} from './assistant-canvas-plan-panel';
import {ApplicationGenerationReview} from './application-generation-review';
import {applicationOperationCopy,applicationWorkflowStepCopy} from '../lib/application-operation-copy';
import {assistantPreferenceLabel} from '../lib/assistant-preferences';
import {assistantNavigationDestinationLabel} from '../lib/assistant-local-action-copy';
const noAction=()=>{};
const pending=new Set(['preparing','awaiting_confirmation','queued','running','outcome_unknown']);

/** Only trusted App interaction can approve. The external transport has no
 * approve route. Review never changes the immutable request behind the grant.
 */
export function ApplicationOperationApprovals({projectId,projects,language,onView,onApplied}:{projectId:string;projects:any[];language:string;onView:()=>void;onApplied:(projectId:string,ids:string[])=>void}){
 const [requests,setRequests]=useState<any[]>([]),[error,setError]=useState(false),[busy,setBusy]=useState('');
 const mounted=useRef(false),readRevision=useRef(0),actionPending=useRef(false),c=applicationOperationCopy(language);
 const bridge=(window as any).wanjuanDesktop;
 const refresh=useCallback(async()=>{
  const revision=++readRevision.current;
  try{const result=await bridge?.applicationOperationList?.();if(mounted.current&&revision===readRevision.current){if(!result?.ok)throw Error();setRequests(result.value);setError(false);}}
  catch{if(mounted.current&&revision===readRevision.current)setError(true);}
 },[bridge]);
 useEffect(()=>{
  if(typeof bridge?.applicationOperationList!=='function')return;
  mounted.current=true;void refresh();const unsubscribe=bridge.onApplicationOperationsChanged?.(()=>void refresh());
  return ()=>{mounted.current=false;readRevision.current++;unsubscribe?.();};
 },[bridge,refresh]);
 const hasPending=requests.some(r=>pending.has(r.status));
 useEffect(()=>{if(!hasPending)return;const timer=setInterval(()=>void refresh(),1000);return ()=>clearInterval(timer);},[hasPending,refresh]);
 async function action(request:any,kind:'Approve'|'Reject'|'Dismiss'){
  if(actionPending.current)return;actionPending.current=true;setBusy(request.id);
  try{
   const result=await bridge[`applicationOperation${kind}`](request.id,request.revision);
   if(!result?.ok)throw Error();
   // Approve returns a queued receipt, not an execution claim. Actual nodes
   // are focused only by the explicit View action after observing completion.
   await refresh();
  }catch{if(mounted.current)setError(true);}
  finally{actionPending.current=false;if(mounted.current)setBusy('');}
 }
 if(!requests.length&&!error)return null;
 return <aside className="wj-assistant-operation-approvals" data-wanjuan-i18n-skip aria-label={c.title}>
  <h2>{c.title}</h2><p className="wj-assistant-hint">{c.note}</p>
  {error&&<p role="alert">{c.unavailable} <button type="button" className="wj-assistant-text-button" onClick={()=>void refresh()}>{c.retry}</button></p>}
  {requests.map(r=>{
   const waiting=r.status==='awaiting_confirmation',mismatch=r.projectId!==projectId,disabled=!!busy||mismatch||!waiting;
   const projectName=projects.find(p=>p.id===r.projectId)?.name||r.projectId;
   const preview=r.review?.preview;
   const workflowStep=applicationWorkflowStepCopy(language,r.workflow);
   return <section key={r.id} className="wj-assistant-operation-card" data-operation-id={r.id} data-operation-status={r.status}>
    <div className="wj-assistant-plan-heading"><strong>{r.status==='completed'&&(r.operation.startsWith('generation.')||r.operation==='canvas.plan.generate')?c.submitted:r.status==='completed'&&r.operation==='tasks.cancel'?c.stopRequested:c[r.status]||r.status}</strong><code>{r.operation}</code></div>
    <p className="wj-assistant-hint">{c.project}: {projectName}</p>
    {workflowStep&&<p className="wj-assistant-hint" data-workflow-step={`${r.workflow.stepIndex}/${r.workflow.totalSteps}`} data-workflow-stage={r.workflow.stage}>{workflowStep}</p>}
    {waiting&&mismatch&&<p role="status">{c.mismatch}</p>}
    {waiting&&preview&&<AssistantCanvasPlanPanel state={{phase:'preview',preview,draftProposal:preview.proposal,dirty:false}} language={language} projectName={projectName} disabled={disabled} hasMessage={false}
     readOnly hideDismiss confirmLabel={r.operation==='canvas.plan.undo'?c.undo:c.approve}
     onConfigure={noAction} onRequest={noAction} onDismiss={noAction} onRestart={noAction} onEdit={noAction} onValidate={noAction} onApply={()=>void action(r,'Approve')} onUndo={noAction} onView={onView}/>}
    {waiting&&r.review?.kind==='canvas.read'&&<><p>{c.content}</p><p>{c.scope}: {r.review.scope==='structure'?c.structure:c.selected} · {c.nodes}: {r.review.nodeCount} · {c.edges}: {r.review.edgeCount}</p><button type="button" className="wj-assistant-primary" disabled={disabled} onClick={()=>void action(r,'Approve')}>{c.approve}</button></>}
    {waiting&&r.review?.kind==='generation'&&<ApplicationGenerationReview key={`${r.id}:${r.revision}`} review={r.review} language={language} disabled={disabled} onApprove={()=>void action(r,'Approve')}/>}
    {waiting&&r.review?.kind==='tasks.cancel'&&<><p className="wj-assistant-hint">{c.stopNote}</p><code>{r.review.task?.id}</code><button type="button" className="wj-assistant-secondary" disabled={disabled} onClick={()=>void action(r,'Approve')}>{c.stop}</button></>}
    {waiting&&r.review?.kind==='media.export'&&<><p>{c.exportNote}</p><p>{c.exportTask}: <code>{r.review.task?.id}</code> · {r.review.task?.type}</p><p className="wj-assistant-hint">{c.exportDestination}</p><button type="button" className="wj-assistant-primary" disabled={disabled} onClick={()=>void action(r,'Approve')}>{c.exportApprove}</button></>}
    {r.operation==='media.export'&&r.status==='completed'&&<p className="wj-assistant-hint">{c.exported}: <code>{r.result?.localPath}</code></p>}
    {waiting&&r.review?.kind==='media.import'&&<div className="wj-assistant-generation-review">
     <p>{c.importNote}</p><p>{c.importType}: {c['import'+r.review.type]}</p>
     <textarea aria-label={c.importSource} readOnly value={r.review.sourceLabel}/>
     {r.review.hasPrivateQuery&&<p className="wj-assistant-hint">{c.importQuery}</p>}
     <p className="wj-assistant-hint">{c.importScope}</p>
     <button type="button" className="wj-assistant-primary" disabled={disabled} onClick={()=>void action(r,'Approve')}>{c.importApprove}</button>
    </div>}
    {r.operation==='media.import'&&r.status==='completed'&&<p className="wj-assistant-hint">{c.imported}: <code>{r.result?.referenceId}</code> · {r.result?.mime} · {r.result?.size} B</p>}
    {waiting&&r.review?.kind==='app.preferences.set'&&<div className="wj-assistant-generation-review">
     <p>{c.basicSettingNote}</p><strong>{c[r.review.preference.kind]}</strong>
     <dl>{['current','value'].map(field=><div key={field}><dt>{field==='current'?c.current:c.requested}</dt><dd>{r.review.preference.kind==='autoDownload'?(r.review.preference[field]?c.on:c.off):assistantPreferenceLabel(r.review.preference.kind,r.review.preference[field],language)}</dd></div>)}</dl>
     <button type="button" className="wj-assistant-primary" disabled={disabled} onClick={()=>void action(r,'Approve')}>{c.approve}</button>
    </div>}
    {waiting&&r.review?.kind==='app.navigate'&&<><p>{c.navigationNote}</p><p>{c.destination}: {assistantNavigationDestinationLabel(r.review.destination,language)}</p><button type="button" className="wj-assistant-primary" disabled={disabled} onClick={()=>void action(r,'Approve')}>{c.approve}</button></>}
    {(r.operation.startsWith('generation.')||r.operation==='canvas.plan.generate')&&r.status==='completed'&&<><p className="wj-assistant-hint">{c.pendingResult}</p><p>{c.nodeId}: <code>{r.result?.nodeId}</code></p></>}
    {r.operation==='tasks.cancel'&&r.status==='completed'&&<p className="wj-assistant-hint">{c.stopNote}</p>}
    <div className="wj-assistant-operation-actions">
     {waiting&&<button type="button" className="wj-assistant-secondary" disabled={!!busy} onClick={()=>void action(r,'Reject')}>{c.reject}</button>}
     {r.projectId===projectId&&<button type="button" className="wj-assistant-text-button" onClick={()=>{onView();if(r.status==='completed'&&r.operation==='canvas.plan.apply')onApplied(r.projectId,r.result?.affectedNodeIds||[]);else if(r.status==='completed'&&(r.operation.startsWith('generation.')||r.operation==='canvas.plan.generate')&&r.result?.nodeId)onApplied(r.projectId,[r.result.nodeId]);}}>{c.view}</button>}
     {!pending.has(r.status)&&<button type="button" className="wj-assistant-text-button" disabled={!!busy} onClick={()=>void action(r,'Dismiss')}>{c.dismiss}</button>}
    </div>
    {r.code&&<p role="status" className="wj-assistant-hint">{r.status==='outcome_unknown'?c.outcome_unknown:c.error} <code>{r.code}</code></p>}
   </section>;
  })}
 </aside>;
}
