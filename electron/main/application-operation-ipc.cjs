function registerApplicationOperationIpc({ipcMain,rejectUntrustedIpc,getService}){
 const internal=async owner=>(await import('../shared/application-operation-contract.mjs')).applicationOperationActor(owner);
 for(const [channel,run]of [
  ['list',()=>getService().list()],
  ['approve',p=>getService().approve(p?.id,p?.revision)],
  ['reject',p=>getService().reject(p?.id,p?.revision)],
  ['dismiss',p=>getService().dismiss(p?.id)],
  ['consume',p=>getService().consume(p?.id,p?.nonce)],
  ['submit-internal',async p=>getService().submit(await internal(p?.owner),p?.request,{selectionVersion:p?.selectionVersion})],
  ['read-internal',async p=>getService().readInternal(await internal(p?.owner),p?.id)],
  ['approve-internal',async p=>{getService().read(await internal(p?.owner),p?.id);return getService().approve(p?.id,p?.revision);}],
  ['cancel-internal',async p=>getService().cancel(await internal(p?.owner),p?.id)],
 ])ipcMain.handle(`wanjuan:application-operation-${channel}`,async(event,payload)=>{
  rejectUntrustedIpc(event,`application-operation-${channel}`);
  try{return {ok:true,value:await run(payload)};}
  catch(error){const {applicationOperationErrorCode}=await import('../shared/application-operation-contract.mjs');return {ok:false,code:applicationOperationErrorCode(error)};}
 });
}
module.exports={registerApplicationOperationIpc};
