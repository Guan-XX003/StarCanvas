const {createApplicationOperationService}=require('./application-operation-service.cjs');
let window=null,service=null,media=null;
function notify(){try{if(window&&!window.isDestroyed?.())window.webContents.send('wanjuan:application-operations-changed');}catch{}}
function getApplicationOperationService(){
 if(!service){const currentMedia=require('./application-media-broker.cjs').createApplicationMediaBroker({call,output:require('./application-media-output.cjs').createApplicationMediaOutput(),input:require('./application-media-input.cjs').createApplicationMediaInput()});media=currentMedia;service=require('./application-operation-workflow.cjs').createApplicationOperationWorkflowService(createApplicationOperationService({
  prepare:value=>currentMedia.prepare(value),commit:value=>currentMedia.commit(value),release:value=>currentMedia.release(value),
  notify,
 }),{notify});}
 return service;
}
async function call(method,value){
 const target=window;if(!target||target.isDestroyed?.()||!target.webContents)throw Object.assign(new Error('PLAN_CANVAS_NOT_READY'),{code:'PLAN_CANVAS_NOT_READY'});
 const reply=await target.webContents.executeJavaScript(`(async()=>{const api=globalThis.__wanjuanApplicationOperations;return api?await api[${JSON.stringify(method)}](${JSON.stringify(value)}):{ok:false,code:'PLAN_CANVAS_NOT_READY'};})()`,true);
 if(!reply||reply.ok!==true)throw Object.assign(new Error('Application operation failed'),{code:reply?.code||'OPERATION_FAILED'});
 return reply.value;
}
function setApplicationOperationWindow(next){
 if(next===window)return;
 service?.invalidate();media?.invalidate();window=next&&!next.isDestroyed?.()?next:null;
 if(!window)return;
 const current=window;
 current.webContents?.on?.('did-start-navigation',(_event,_url,inPlace,isMainFrame)=>{if(window===current&&isMainFrame&&!inPlace){service?.invalidate();media?.invalidate();}});
 current.webContents?.on?.('render-process-gone',()=>{if(window===current){service?.invalidate();media?.invalidate();}});
 current.once?.('closed',()=>{if(window===current){service?.invalidate();media?.invalidate();window=null;}});
}
function closeApplicationOperations(){service?.close();media?.invalidate();service=null;media=null;window=null;}
async function submitLegacyOperation(operation,payload,key){
 if(!payload||typeof payload!=='object'||Array.isArray(payload))throw Object.assign(Error('Invalid request'),{code:'OPERATION_INVALID_REQUEST'});
 const {projectId,idempotencyKey,...args}=payload;
 const requestKey=idempotencyKey||key;if(!requestKey)throw Object.assign(Error('Idempotency key required'),{code:'OPERATION_IDEMPOTENCY_REQUIRED'});
 const project=projectId||await call('activeProject',{});
 return getApplicationOperationService().submit('external',{operation,projectId:project,arguments:args,idempotencyKey:requestKey});
}
module.exports={getApplicationOperationService,setApplicationOperationWindow,closeApplicationOperations,submitLegacyOperation};
