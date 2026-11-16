import {useState} from 'react';
import {applicationOperationCopy,applicationPortraitReviewCopy} from '../lib/application-operation-copy';
import {assistantGenerationCopy} from '../lib/assistant-generation-copy';

/** Mount keyed by request ID + review revision. Consent is local UI state,
 * never read from model arguments or reused for another immutable request. */
export function ApplicationGenerationReview({review,language,disabled,onApprove,onCancel}:{review:any;language:string;disabled:boolean;onApprove:(consent:{content:boolean;cost:boolean})=>void;onCancel?:()=>void}){
 const [cost,setCost]=useState(false),[content,setContent]=useState(false);
 const c=applicationOperationCopy(language),pc=applicationPortraitReviewCopy(language),g=assistantGenerationCopy(language),canvas=!!review.canvasNodeId;
 return <div className="wj-assistant-generation-review" data-generation-review>
  <p className="wj-assistant-hint">{canvas?g.note:c.paidNote}</p>
  {canvas&&<p className="wj-assistant-hint">{review.resultBranch?g.branch:g.reuse} <code>{review.canvasNodeId}</code></p>}
  <p>{c.model}: <code>{review.model}</code></p>
  <details open={canvas}><summary>{c.prompt}</summary><textarea aria-label={c.prompt} readOnly value={review.prompt}/></details>
  <p className="wj-assistant-hint">{c.parameters}</p><dl>{Object.entries(review.parameters||{}).map(([k,v])=><div key={k}><dt>{c[k]||k}</dt><dd>{String(v)}</dd></div>)}</dl>
  {!!review.canvasReferences?.length&&<><p className="wj-assistant-hint">{g.references}</p><ul>{review.canvasReferences.map((m:any,index:number)=><li key={index}>{g[m.type]||m.type} · <code>{m.nodeId}</code></li>)}</ul></>}
  {review.sourceTextCount>0&&<p className="wj-assistant-hint">{g.sourceText}: {review.sourceTextCount}</p>}
  {!!review.references?.length&&<><p className="wj-assistant-hint">{c.referenceNote}</p><dl>{review.references.map((m:any)=><div key={m.referenceId}><dt>{c['import'+m.type]} · <code>{m.referenceId}</code></dt><dd>{m.mime} · {m.size} B · SHA {m.sha256.slice(0,12)}</dd></div>)}</dl></>}
  {!!review.portraitAssetIds?.length&&<><p className="wj-assistant-hint">{pc.note}</p><p>{pc.ids}: {review.portraitAssetIds.map((id:string)=><code key={id}>{id} </code>)}</p></>}
  {review.requestPreview&&<details open className="wj-assistant-request-fields"><summary>{c.requestFields} · {review.requestPreview.transport}</summary>
   <p className="wj-assistant-hint">{c.requestFieldsNote}</p><dl>{review.requestPreview.fields.map(({name,value}:any,index:number)=><div key={index}><dt><code>{name}</code></dt><dd>{value===null?'null':String(value)}</dd></div>)}</dl>
   {review.requestPreview.hiddenFields>0&&<p className="wj-assistant-hint">{c.hiddenFields}: {review.requestPreview.hiddenFields}</p>}
  </details>}
  {review.contentSendRequired&&<label className="wj-assistant-plan-checkbox"><input type="checkbox" checked={content} disabled={disabled} onChange={e=>setContent(e.target.checked)}/>{g.contentConsent}</label>}
  <label className="wj-assistant-plan-checkbox"><input type="checkbox" checked={cost} disabled={disabled} onChange={e=>setCost(e.target.checked)}/>{c.costConsent}</label>
  <button type="button" className="wj-assistant-primary" disabled={disabled||!cost||review.contentSendRequired&&!content} onClick={()=>onApprove({content:!review.contentSendRequired||content,cost})}>{c.startGeneration}</button>
  {onCancel&&<button type="button" className="wj-assistant-text-button" disabled={disabled} onClick={onCancel}>{g.cancel}</button>}
 </div>;
}
