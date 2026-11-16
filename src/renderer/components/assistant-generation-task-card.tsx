import {memo,useEffect,useRef,useState} from 'react';
import {applicationOperationMetadata} from '../../../electron/shared/application-operation-policy.mjs';
import {assistantCanvasCopy} from '../lib/assistant-canvas-copy';
import {sharedAssistantGenerationObserver} from '../lib/assistant-generation-observer';
import {createAssistantOperationClient} from '../lib/assistant-operation-client';

const copies={
 'zh-CN':{title:'生成任务',reading:'正在核对本机任务记录…',unavailable:'暂时无法核对任务状态，不代表生成失败。',unknown:'结果待核对，不会自动重新生成。',check:'刷新任务状态',pending:'等待处理',submitting:'正在提交',queued:'排队中',running:'生成中',processing:'生成中',completed:'生成完成',failed:'生成失败',cancelled:'已请求本机停止',interrupted:'任务已中断',result:'查看画布中的结果与保存状态',stop:'本机停止不代表上游已取消或退款。'},
 'zh-TW':{title:'生成任務',reading:'正在核對本機任務紀錄…',unavailable:'暫時無法核對任務狀態，不代表生成失敗。',unknown:'結果待核對，不會自動重新生成。',check:'重新整理任務狀態',pending:'等候處理',submitting:'正在提交',queued:'排隊中',running:'生成中',processing:'生成中',completed:'生成完成',failed:'生成失敗',cancelled:'已請求本機停止',interrupted:'任務已中斷',result:'查看畫布中的結果與儲存狀態',stop:'本機停止不代表上游已取消或退款。'},
 'en-US':{title:'Generation task',reading:'Checking local task records…',unavailable:'Task status is unavailable. This does not mean generation failed.',unknown:'Outcome unconfirmed. Nothing will be regenerated automatically.',check:'Refresh task status',pending:'Pending',submitting:'Submitting',queued:'Queued',running:'Generating',processing:'Generating',completed:'Generation completed',failed:'Generation failed',cancelled:'Local stop requested',interrupted:'Interrupted',result:'View canvas result and save status',stop:'A local stop does not confirm upstream cancellation or a refund.'},
};
const active=new Set(['pending','submitting','queued','running','processing']);
const detailCopies={
 'zh-CN':{details:'查看任务详情',diagnose:'诊断这条失败任务',preview:'预览已保存的结果',hide:'收起预览',previewError:'本机结果无法预览，请核对保存文件。'},
 'zh-TW':{details:'查看任務詳情',diagnose:'診斷這筆失敗任務',preview:'預覽已儲存的結果',hide:'收起預覽',previewError:'無法預覽本機結果，請核對儲存檔案。'},
 'en-US':{details:'View task details',diagnose:'Diagnose this failed task',preview:'Preview saved result',hide:'Hide preview',previewError:'The local result could not be previewed. Check the saved file.'},
};
const saveCopies={
 'zh-CN':{save:'保存结果',review:'保存这份结果',note:'仅下载或复制这条已完成任务的结果到应用默认媒体库，不会重新生成。',confirm:'确认保存这一份',cancel:'取消保存',saved:'已保存到本机',unknown:'保存结果尚未确认，不会自动重做。',check:'核对原保存请求',failed:'保存未完成，请核对任务和文件状态。',working:'正在保存…',mismatch:'请先切回该任务对应的项目。'},
 'zh-TW':{save:'儲存結果',review:'儲存這份結果',note:'僅下載或複製這筆已完成任務的結果到應用程式預設媒體庫，不會重新生成。',confirm:'確認儲存這一份',cancel:'取消儲存',saved:'已儲存至本機',unknown:'儲存結果尚未確認，不會自動重做。',check:'核對原儲存請求',failed:'儲存未完成，請核對任務和檔案狀態。',working:'正在儲存…',mismatch:'請先切回此任務對應的專案。'},
 'en-US':{save:'Save result',review:'Save this result',note:'Download or copy only this completed result to the app’s default media library. This never starts generation.',confirm:'Confirm saving this result',cancel:'Cancel save',saved:'Saved locally',unknown:'Save outcome is unconfirmed. Nothing will be repeated automatically.',check:'Check original save request',failed:'Save did not complete. Check task and file status.',working:'Saving…',mismatch:'Return to this task’s project first.'},
};
/** Observes the same existing metadata owner as the task panel/CLI/MCP. This
 * never polls a provider, materializes media or creates operation jobs per tick.
 * The selected chat owns this component; unmount/scope change stops observation.
 */
export const AssistantGenerationTaskCard=memo(function AssistantGenerationTaskCard({ownerId,projectId,nodeId,taskReference,activeProjectId=projectId,getScope,language,onView,onDiagnose}:{ownerId:string;projectId:string;nodeId:string;taskReference?:any;activeProjectId?:string;getScope?:()=>any;language:string;onView:(id:string)=>void;onDiagnose?:(id:string)=>void}){
 const [record,setRecord]=useState<any>(null),[unavailable,setUnavailable]=useState(false),[refresh,setRefresh]=useState(0);
 const [visible,setVisible]=useState(false),[saving,setSaving]=useState<any>(null),element=useRef<HTMLElement>(null),alive=useRef(false),busy=useRef(false),saveState=useRef<any>(null);
 const [preview,setPreview]=useState(false),[previewFailed,setPreviewFailed]=useState(false);
 const scope=useRef({getScope,activeProjectId});scope.current={getScope,activeProjectId};
 const gateway=useRef<ReturnType<typeof createAssistantOperationClient>|null>(null);if(!gateway.current)gateway.current=createAssistantOperationClient(()=>(globalThis as any).wanjuanDesktop);
 const c=copies[language]||copies['zh-CN'],s=saveCopies[language]||saveCopies['zh-CN'],d=detailCopies[language]||detailCopies['zh-CN'];
 const put=(value:any)=>{saveState.current=value;if(alive.current)setSaving(value);};
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;const current=saveState.current;if(current?.phase==='review'&&current.handle)void gateway.current!.cancel(current.handle).catch(()=>{});};},[ownerId,projectId,nodeId,taskReference?.submissionId]);
 useEffect(()=>{
  const el=element.current;if(!el)return;
  if(typeof IntersectionObserver==='undefined'){setVisible(true);return;}
  const observer=new IntersectionObserver(entries=>setVisible(entries.some(e=>e.isIntersecting)),{root:el.closest('.wj-assistant-conversation'),rootMargin:'120px'});observer.observe(el);return()=>observer.disconnect();
 },[ownerId,nodeId,taskReference?.submissionId]);
 useEffect(()=>{
  if(!visible)return;let cancelled=false,timer:ReturnType<typeof setTimeout>;setUnavailable(false);
  async function read(){
   try{
    const api=(globalThis as any).__wanjuanTaskAutomation;
    if(!taskReference&&typeof api?.task!=='function')throw Error('TASKS_UNAVAILABLE');
    const task=taskReference?await sharedAssistantGenerationObserver.read(taskReference):applicationOperationMetadata('tasks.get',await api.task({id:nodeId,materialize:false,includeDiagnostics:false})).task;
    if(!task||task.projectId!==projectId||task.nodeId!==nodeId)throw Error('TASK_NOT_CONFIRMED');
    if(cancelled)return;setUnavailable(false);setRecord(old=>JSON.stringify(old)===JSON.stringify(task)?old:task);
    if(active.has(task.status))timer=setTimeout(read,1500);
   }catch{if(!cancelled)setUnavailable(true);}
  }
  void read();return()=>{cancelled=true;clearTimeout(timer);};
 },[ownerId,projectId,nodeId,taskReference?.submissionId,refresh,visible]);
 const current=(version:number)=>{const value=scope.current.getScope?.();return alive.current&&scope.current.activeProjectId===projectId&&value?.selected===true&&value.selectionVersion===version;};
 async function prepareSave(){
  if(busy.current||record?.status!=='completed'||scope.current.activeProjectId!==projectId)return;
  const value=scope.current.getScope?.();if(!value?.selected)return;busy.current=true;put({phase:'preparing'});
  try{const prepared=await gateway.current!.prepare(ownerId,'media.export',projectId,{id:record.id},{selectionVersion:value.selectionVersion});
   if(!current(value.selectionVersion)){void gateway.current!.cancel(prepared.handle).catch(()=>{});return;}
   put({phase:'review',handle:prepared.handle,revision:prepared.job.revision,review:prepared.job.review,selectionVersion:value.selectionVersion,taskId:record.id});
  }catch(error:any){put({phase:error.code==='OPERATION_OUTCOME_UNKNOWN'?'uncertain':'failed',handle:error.operationHandle,selectionVersion:value.selectionVersion,taskId:record.id});}
  finally{busy.current=false;}
 }
 const acceptedSave=(result:any,original:any)=>{
  if(!result?.exported||result.taskId!==original.taskId||result.projectId!==projectId||typeof result.localPath!=='string')throw Error('SAVE_OUTCOME_UNKNOWN');
  put({...original,phase:'saved',result});
 };
 async function confirmSave(){
  const original=saveState.current;if(busy.current||original?.phase!=='review')return;busy.current=true;put({...original,phase:'saving'});
  try{acceptedSave(await gateway.current!.approve(original.handle,original.revision,{isCurrent:()=>current(original.selectionVersion)}),original);}
  catch(error:any){put({...original,phase:error.code&&error.code!=='OPERATION_OUTCOME_UNKNOWN'?'failed':'uncertain'});}finally{busy.current=false;}
 }
 async function observeSave(){
  const original=saveState.current;if(busy.current||!original?.handle)return;busy.current=true;
  try{const job=await gateway.current!.inspect(original.handle);if(job.status==='completed')acceptedSave(job.result,original);
   else if(job.status==='awaiting_confirmation'&&job.review)put({...original,phase:'review',revision:job.revision,review:job.review});
   else if(['failed','expired','cancelled','rejected'].includes(job.status))put({...original,phase:'failed'});
  }catch{put({...original,phase:'uncertain'});}finally{busy.current=false;}
 }
 async function cancelSave(){const original=saveState.current;if(busy.current||original?.phase!=='review')return;busy.current=true;try{await gateway.current!.cancel(original.handle);put(null);}catch{put({...original,phase:'uncertain'});}finally{busy.current=false;}}
 return <section ref={element} className="wj-assistant-plan-panel" data-wanjuan-i18n-skip data-generation-task={nodeId} data-generation-submission={taskReference?.submissionId} data-task-status={unavailable?'unavailable':record?.status||'reading'} data-result-save={saving?.phase||'idle'} aria-label={c.title}>
  <div className="wj-assistant-plan-heading"><strong>{c.title}</strong><span role="status">{unavailable?c.unavailable:record?c[record.status]||c.unknown:c.reading}</span></div>
  {record&&<p className="wj-assistant-hint"><code>{record.modelName||record.type}</code>{active.has(record.status)&&record.progress!==null?` · ${record.progress}%`:''}</p>}
  {record?.status==='cancelled'&&<p className="wj-assistant-hint">{c.stop}</p>}
  {record&&<details className="wj-assistant-hint"><summary>{d.details}</summary><dl><dt>ID</dt><dd><code>{record.id}</code></dd><dt>{assistantCanvasCopy(language).project}</dt><dd><code>{record.projectId}</code></dd><dt>{assistantCanvasCopy(language).view}</dt><dd><code>{record.nodeId}</code></dd></dl></details>}
  {record?.status==='failed'&&onDiagnose&&<button type="button" className="wj-assistant-secondary" disabled={activeProjectId!==projectId} onClick={()=>onDiagnose(record.id)}>{d.diagnose}</button>}
  {(unavailable||record?.status==='unknown'||record?.status==='interrupted')&&<button type="button" className="wj-assistant-secondary" onClick={()=>setRefresh(n=>n+1)}>{c.check}</button>}
  {activeProjectId!==projectId&&<p className="wj-assistant-hint">{s.mismatch}</p>}
  <button type="button" className="wj-assistant-text-button" disabled={activeProjectId!==projectId} onClick={()=>onView(nodeId)}>{record?.status==='completed'?c.result:assistantCanvasCopy(language).view}</button>
  {getScope&&record?.status==='completed'&&!['preparing','review','saving','uncertain','saved'].includes(saving?.phase)&&<button type="button" className="wj-assistant-secondary" disabled={activeProjectId!==projectId} onClick={()=>void prepareSave()}>{s.save}</button>}
  {saving?.phase==='review'&&<div className="wj-assistant-generation-review"><strong>{s.review}</strong><p className="wj-assistant-hint">{s.note}</p><code>{saving.review?.task?.id}</code><button type="button" className="wj-assistant-primary" disabled={activeProjectId!==projectId} onClick={()=>void confirmSave()}>{s.confirm}</button><button type="button" className="wj-assistant-text-button" onClick={()=>void cancelSave()}>{s.cancel}</button></div>}
  {['preparing','saving'].includes(saving?.phase)&&<p role="status" className="wj-assistant-hint">{s.working}</p>}
  {saving?.phase==='saved'&&<p role="status" className="wj-assistant-hint">{s.saved}: <code>{saving.result.localPath}</code></p>}
  {saving?.phase==='saved'&&typeof saving.result.resultUrl==='string'&&saving.result.resultUrl.startsWith('file:')&&<><button type="button" className="wj-assistant-text-button" onClick={()=>{setPreview(v=>!v);setPreviewFailed(false);}}>{preview?d.hide:d.preview}</button>{preview&&<div className="wj-assistant-saved-preview">{saving.result.type==='image'?<img src={saving.result.resultUrl} alt={d.preview} loading="lazy" onError={()=>setPreviewFailed(true)}/>:saving.result.type==='video'?<video src={saving.result.resultUrl} controls preload="metadata" onError={()=>setPreviewFailed(true)}/>:saving.result.type==='audio'?<audio src={saving.result.resultUrl} controls preload="metadata" onError={()=>setPreviewFailed(true)}/>:null}{previewFailed&&<p role="status" className="wj-assistant-hint">{d.previewError}</p>}</div>}</>}
  {saving?.phase==='uncertain'&&<><p role="status" className="wj-assistant-hint">{s.unknown}</p><button type="button" className="wj-assistant-secondary" onClick={()=>void observeSave()}>{s.check}</button></>}
  {saving?.phase==='failed'&&<p role="status" className="wj-assistant-hint">{s.failed}</p>}
 </section>;
});
