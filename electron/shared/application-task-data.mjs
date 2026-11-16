// Shared, non-secret interpretation of the last local task records. No IO,
// generation, retry, cancellation, media location or raw error escapes here.
export const APPLICATION_TASK_FAILURE_KINDS=Object.freeze(['superseded','rate_limit','quota','authentication','timeout','network','content_policy','parameters','configuration','upstream','unknown']);
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function applicationTaskIdentifier(value){if(typeof value!=='string'||!value||value.length>512||!/^[-A-Za-z0-9_:.[\]]+$/.test(value))fail('OPERATION_INVALID_REQUEST');return value;}
export function applicationTaskStatus(task){
 const value=typeof task?.status==='string'?task.status.toLowerCase():'';
 // A retained result and stop flag do not prove their event order.
 if(task?.stoppedByUser===true&&['completed','succeeded','success'].includes(value))return 'unknown';
 if(task?.stoppedByUser===true||['stopped','cancelled','canceled'].includes(value))return 'cancelled';
 if(['succeeded','success'].includes(value))return 'completed';
 return ['pending','submitting','queued','running','processing','completed','failed','interrupted','unknown'].includes(value)?value:'unknown';
}
export function applicationTaskSummaryStatus(task){
 const status=applicationTaskStatus(task);
 return ['pending','submitting','queued'].includes(status)?'queued':['running','processing'].includes(status)?'running':status==='cancelled'?'stopped':['completed','failed'].includes(status)?status:'unknown';
}
export function applicationTaskType(task){const raw=task?.customOutputType||task?.type,value=typeof raw==='string'?raw.toLowerCase():'';return ['image','video','text','audio','music'].includes(value)?value:'unknown';}
export function applicationTaskDiagnostic(task){
 if(applicationTaskStatus(task)!=='failed')return null;
 // A public projection can be projected again, but raw stored errors take
 // precedence over any stale/forged precomputed category in a legacy record.
 if(typeof task?.errorMsg!=='string'){
  const d=task?.diagnostic;
  if(d&&APPLICATION_TASK_FAILURE_KINDS.includes(d.kind)&&(d.status==='unknown'||typeof d.status==='string'&&/^[45]\d{2}$/.test(d.status)))return {status:d.status,kind:d.kind};
 }
 const errorText=typeof task?.errorMsg==='string'?task.errorMsg.slice(0,20000):'';
 const status=errorText.match(/(?:\bHTTP(?:\/\d(?:\.\d)?)?\b|\bstatus(?:\s*code)?\b|状态码|狀態碼)\s*[:=]?\s*([45]\d{2})\b/i)?.[1]||'unknown';let kind='unknown';
 if(task?.supersededByNewRun===true&&errorText==='已被同节点的新任务替代')kind='superseded';
 else if(/rate.?limit|too many requests|限流|频率限制|頻率限制|频率受限|頻率受限/i.test(errorText))kind='rate_limit';
 else if(/insufficient (?:balance|quota)|quota exceeded|余额不足|餘額不足|额度不足|額度不足/i.test(errorText))kind='quota';
 else if(/unauthori[sz]ed|invalid (?:api.?key|token)|鉴权失败|鑑權失敗|密钥无效|金鑰無效/i.test(errorText))kind='authentication';
 else if(/timeout|timed out|超时|逾時/i.test(errorText))kind='timeout';
 else if(/network error|network request failed|网络错误|網路錯誤/i.test(errorText))kind='network';
 else if(/content.?policy|safety.?filter|内容审核|內容審核/i.test(errorText))kind='content_policy';
 else if(status==='401')kind='authentication';else if(status==='408')kind='timeout';else if(status==='429')kind='rate_limit';
 else if(['400','422'].includes(status))kind='parameters';
 else if(['404','405'].includes(status))kind='configuration';
 else if(status!=='unknown'&&Number(status)>=500)kind='upstream';
 return {status,kind};
}
export function applicationTaskTimestamp(value){
 let time;if(typeof value==='number')time=value;
 else if(typeof value==='string'&&/^\d{1,16}$/.test(value))time=Number(value);
 else if(typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value))time=Date.parse(value);
 else return null;
 if(!Number.isSafeInteger(time)||time<=0)return null;
 return {time,scale:time<1e9?'relative':time<1e11?'seconds':'milliseconds'};
}
export function selectLatestApplicationTask(items){
 if(!items.length)return null;if(items.length===1)return items[0];let scale,max=-Infinity,latest=null,ties=0;
 for(const item of items){const value=applicationTaskTimestamp(item?.createdAt);if(!value||scale!==undefined&&scale!==value.scale)return null;scale=value.scale;
  if(value.time>max){max=value.time;latest=item;ties=1;}else if(value.time===max)ties++;
 }return ties===1?latest:null;
}
