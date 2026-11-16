// Normal close waits for acknowledged local saves. This is not a force-quit,
// renderer execution endpoint, generation permission, or power-loss guarantee.
const {randomUUID}=require('node:crypto');
const CODES=new Set(['DESKTOP_CLOSE_BUSY','DESKTOP_CLOSE_NOT_READY','DESKTOP_CLOSE_SAVE_FAILED','DESKTOP_CLOSE_CHANGED','DESKTOP_CLOSE_TIMEOUT','DESKTOP_CLOSE_UNAVAILABLE']);
const codeOf=value=>CODES.has(value)?value:'DESKTOP_CLOSE_SAVE_FAILED';
function createDesktopCloseCoordinator({app,getBaseUrl,report=()=>{},timeoutMs=10000}) {
 const windows=new Map();let quitPending=null,quitIntent=false,quitAllowed=false;
 function owned(record){
  if(record.win.isDestroyed()||record.win.webContents.isDestroyed())return false;
  try{const current=new URL(record.win.webContents.getURL()),base=new URL(getBaseUrl());return current.origin===base.origin&&current.pathname==='/index.html';}catch{return false;}
 }
 const live=()=>[...windows.values()].filter(r=>!r.win.isDestroyed());
 function release(record,id,code){
  record.permit=false;
  if(!owned(record))return;
  void record.win.webContents.executeJavaScript(`globalThis.__wanjuanDesktopClose?.release(${JSON.stringify(id)},${JSON.stringify(codeOf(code))})`).catch(()=>{});
 }
 function blocked(record,id,code){report(codeOf(code));release(record,id,code);}
 function prepare(record){
  if(record.pending)return record.pending.bounded;
  if(!owned(record))return Promise.resolve({ok:false,code:'DESKTOP_CLOSE_UNAVAILABLE'});
  const id=randomUUID(),job={id,expired:false,bounded:null};record.pending=job;record.preparedId=id;
  let timer;
  const operation=Promise.resolve().then(()=>record.win.webContents.executeJavaScript(`(async()=>{const api=globalThis.__wanjuanDesktopClose;if(api?.version!==1)return {ok:false,code:'DESKTOP_CLOSE_NOT_READY'};return api.prepare(${JSON.stringify(id)});})()`));
  // A timeout never consumes the still-live save or permits a second prepare.
  const observed=Promise.resolve(operation).then(result=>result?.ok===true?{ok:true,id}:{ok:false,id,code:codeOf(result?.code)},()=>({ok:false,id,code:'DESKTOP_CLOSE_UNAVAILABLE'})).finally(()=>{
   clearTimeout(timer);if(record.pending===job)record.pending=null;
   if(job.expired)release(record,id,'DESKTOP_CLOSE_TIMEOUT');
  });
  job.bounded=Promise.race([observed,new Promise(resolve=>{timer=setTimeout(()=>{job.expired=true;resolve({ok:false,id,code:'DESKTOP_CLOSE_TIMEOUT'});},timeoutMs);})]);
  return job.bounded;
 }
 function requestWindow(record){
  if(quitIntent)return;
  if(record.closing)return record.closing;
  record.closing=(async()=>{
   const result=await prepare(record);
   if(quitIntent||record.win.isDestroyed())return;
   if(!result.ok){blocked(record,result.id||record.preparedId,result.code);return;}
   record.permit=true;record.win.close();
  })().finally(()=>{record.closing=null;});return record.closing;
 }
 function requestQuit(){
  if(quitPending)return quitPending;
  quitIntent=true;const selected=live();
  quitPending=Promise.all(selected.map(prepare)).then(results=>{
   const current=live();
   const unchanged=current.length===selected.length&&current.every(record=>selected.includes(record));
   const failed=results.find(result=>!result.ok);
   if(failed||!unchanged){
    quitIntent=false;for(const record of selected)blocked(record,record.preparedId,failed?.code||'DESKTOP_CLOSE_CHANGED');return;
   }
   for(const record of selected)record.permit=true;
   quitAllowed=true;app.quit();
  }).catch(()=>{quitIntent=false;for(const record of selected)blocked(record,record.preparedId,'DESKTOP_CLOSE_UNAVAILABLE');}).finally(()=>{quitPending=null;});
  return quitPending;
 }
 function beforeQuit(event){
  if(quitAllowed||!live().length)return;
  event.preventDefault();void requestQuit();
 }
 app.on('before-quit',beforeQuit);
 function registerWindow(win){
  if(windows.has(win.id))return;
  const record={win,pending:null,permit:false,preparedId:''};windows.set(win.id,record);
  win.on('close',event=>{
   if(record.permit){record.permit=false;return;}
   event.preventDefault();void requestWindow(record);
  });
  win.webContents.on('will-prevent-unload',()=>{
   // Do not bypass an existing unsaved-data guard, even after preparation.
   quitAllowed=false;quitIntent=false;blocked(record,record.preparedId,'DESKTOP_CLOSE_CHANGED');
  });
  win.once('closed',()=>{windows.delete(win.id);});
 }
 return {registerWindow,requestQuit,dispose(){app.removeListener('before-quit',beforeQuit);}};
}
let installed;
function getDesktopCloseCoordinator(){
 if(!installed){const{app}=require('./electron-refs.cjs');const{getDesktopBaseUrl}=require('./runtime-state.cjs');const{appendDesktopLog}=require('./logging.cjs');installed=createDesktopCloseCoordinator({app,getBaseUrl:getDesktopBaseUrl,report:code=>appendDesktopLog('desktop-close-blocked',{code})});}
 return installed;
}
module.exports={createDesktopCloseCoordinator,getDesktopCloseCoordinator};
