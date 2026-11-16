const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {createApplicationLocalActions}=require('../src/renderer/lib/application-local-actions.ts');
const {createApplicationOperationDispatcher}=require('../src/renderer/lib/application-operations.ts');
const {createAssistantLocalActionClient}=require('../src/renderer/lib/assistant-local-action-client.ts');
const {createApplicationOperationService}=require('../electron/main/application-operation-service.cjs');
const {assistantNavigationAllowed,assistantNavigationAvailable}=require('../src/renderer/lib/assistant-local-operations.ts');
const rootSource=fs.readFileSync(require('node:path').join(__dirname,'../src/renderer/bundle/index.js'),'utf8'),tree=ts.createSourceFile('index.js',rootSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),functions={};
(function visit(n){if(ts.isFunctionDeclaration(n)&&['applyAssistantPreference','navigateAssistantLocal'].includes(n.name?.text))functions[n.name.text]=n.getText(tree);ts.forEachChild(n,visit);})(tree);
assert.equal(Object.keys(functions).length,2);
global.getComputedStyle=()=>({display:'block',visibility:'visible',opacity:'1',contentVisibility:'visible',overflowX:'visible',overflowY:'visible'});
const until=async(fn)=>{const end=Date.now()+2500;while(Date.now()<end){const value=fn();if(value)return value;await new Promise(r=>setTimeout(r,2));}assert.fail('Synthetic operation did not settle');};
const input=(operation,args={},key='qa-local-operation-0001')=>({operation,arguments:args,idempotencyKey:key,...(operation==='app.preferences.read'?{}:{projectId:'QA_PROJECT'})});
function fixture(t,options={}){
 const state={ready:true,settingsReady:true,theme:'graphite',language:'zh-CN',autoDownload:false,activeView:'canvas',activeSettingsTab:'account'},memory={manualApi:'PRIVATE_MANUAL_KEY'},mirror={},writes=[],pending=[];
 let projectId='QA_PROJECT',selected='A',selectionVersion=1,service,local,consumeHeld,resolveConsume,displayFailure=false;
 const classes=new Set(['theme-graphite']),root={dataset:{wanjuanLanguage:'zh-CN',wanjuanLanguageApplied:'zh-CN',wanjuanAutoDownloadListener:'off'},classList:{contains:k=>classes.has(k),remove:k=>classes.delete(k)}};
 const doc={documentElement:root,defaultView:{innerWidth:1280,innerHeight:860},querySelector(selector){
  if(selector==='.wanjuan-workspace-nav-tab')return null;
  if(selector==='.wanjuan-workspace-page')return page;
  return selector===`[data-wanjuan-assistant-view="${state.activeView}"]`?page:null;
 }};
 const tab={isConnected:true,ownerDocument:doc,childElementCount:1,getBoundingClientRect:()=>({left:0,top:0,right:500,bottom:500,width:500,height:500}),get dataset(){return {wanjuanAssistantSettingsTab:state.activeSettingsTab};}};
 const page={...tab,querySelector:()=>tab,contains:hit=>hit===tab};doc.elementFromPoint=()=>tab;
 const context={isReady:true,settingsHydratedRef:{current:true},autoDownloadGeneratedResults:false,document:doc,localStorage:{setItem:(k,v)=>mirror[k]=v},nonModelSettingsSaveTimerRef:{current:null},saveNonModelSettings:()=>assert.fail('No unrelated batch'),
  chrome:{runtime:{lastError:null},storage:{local:{set(values,cb){writes.push({...values});const finish=()=>{Object.assign(memory,values);cb?.();};options.holdSave?pending.push(finish):queueMicrotask(finish);},get(_keys,cb){queueMicrotask(()=>cb({...memory}));}}}},
  setThemeMode:value=>{state.theme=value;classes.clear();classes.add('theme-'+(value==='system'?'dark':value));},setAppLanguage:value=>{state.language=value;root.dataset.wanjuanLanguage=value;root.dataset.wanjuanLanguageApplied=value;},setAutoDownloadGeneratedResults:value=>{state.autoDownload=value;context.autoDownloadGeneratedResults=value;},
  assistantNavigationAllowed,assistantNavigationAvailable,getAssistantNavigationAccountState:()=>({enterprise:context.enterprise}),enterprise:{connected:false},
  setActiveView:value=>state.activeView=value,setActiveSettingsTab:value=>state.activeSettingsTab=value,
  CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},window:{dispatchEvent:event=>{if(event.type==='wanjuan:workspace-open')classes.add('wanjuan-workspace-open');else root.dataset.wanjuanAutoDownloadListener=event.detail.enabled?'on':'off';return true;}},
 };
 const apply=vm.runInNewContext('('+functions.applyAssistantPreference+')',context),navigate=vm.runInNewContext('('+functions.navigateAssistantLocal+')',context);
 local=createApplicationLocalActions({document:doc,readState:()=>({...state,rawKey:'PRIVATE_STATE_KEY'}),canNavigate:d=>assistantNavigationAvailable(d,state.ready,state.settingsReady)&&assistantNavigationAllowed(d,context.enterprise),applyPreference:(...a)=>{const value=apply(...a);local.observe();return value;},navigate:d=>{const value=navigate(d);local.observe();return value;},intervalMs:2,waitMs:1000});
 const views=new Map(['A','B'].map(id=>[id,{messages:[],draft:'QA_'+id,canvasPlan:{phase:'idle'},localAction:{phase:'idle'}}]));
 const client={operationScope:owner=>({owner,selected:selected===owner,selectionVersion,projectId:'QA_PROJECT'}),viewFor:owner=>views.get(owner),set(owner,key,value){if(displayFailure&&key==='messages'){displayFailure=false;throw Error('PRIVATE_DISPLAY_ERROR');}const view=views.get(owner);view[key]=typeof value==='function'?value(view[key]):value;}};
 let activeLocal=local;
 const dispatcher=createApplicationOperationDispatcher({getProjectId:()=>projectId,getProjects:()=>[{id:projectId}],getCanvas:()=>null,getAutomation:()=>assert.fail('No model/canvas automation'),getLocalActions:()=>activeLocal,getInternalScope:owner=>client.operationScope(owner),consume:async(id,nonce)=>{const grant=service.consume(id,nonce);if(options.holdConsume){consumeHeld=true;await new Promise(r=>resolveConsume=r);}return grant;}});
 service=createApplicationOperationService({prepare:dispatcher.prepare,commit:dispatcher.commit,release:dispatcher.release,...options.service});
 const wrap=fn=>async(...a)=>{try{return {ok:true,value:await fn(...a)};}catch(e){return {ok:false,code:e.code};}},bridge={
  applicationOperationSubmitInternal:wrap((owner,r,version)=>service.submit('internal:'+owner,r,{selectionVersion:version})),
  applicationOperationReadInternal:wrap((owner,id)=>service.read('internal:'+owner,id)),
  applicationOperationApproveInternal:wrap((owner,id,revision)=>{service.read('internal:'+owner,id);return service.approve(id,revision);}),
  applicationOperationCancelInternal:wrap((owner,id)=>service.cancel('internal:'+owner,id)),
 };
 const assistant=createAssistantLocalActionClient(client,()=>bridge),submit=(op,args,key)=>service.submit('external',input(op,args,key)),read=h=>service.read('external',h.request.id,h.receipt);
 t.after(()=>{resolveConsume?.();local.close();service.close();dispatcher.close();});
 return {state,root,context,local,client,assistant,bridge,service,submit,read,writes,memory,mirror,pending,waiting:h=>until(()=>read(h).status==='awaiting_confirmation'&&read(h)),terminal:h=>until(()=>['completed','failed','outcome_unknown'].includes(read(h).status)&&read(h)),get held(){return consumeHeld;},release:()=>resolveConsume?.(),select:owner=>{selected=owner;selectionVersion++;},switchProject:()=>projectId='OTHER_PROJECT',remount:()=>activeLocal={...local},displayFailure:()=>displayFailure=true};
}
const options=intent=>({intent,receipt:()=> 'QA_CONFIRMED',failure:()=>({text:'QA_REFUSED',executionStatus:'rejected'})});
test('basic argument schema accepts only actual enum/bool settings and has distinct application-enforced permissions',async()=>{
 const c=await import('../electron/shared/application-operation-contract.mjs'),p=await import('../electron/shared/application-operation-policy.mjs'),local=await import('../electron/shared/application-local-contract.mjs');
 for(const [kind,values]of [['theme',local.APPLICATION_BASIC_THEMES],['language',local.APPLICATION_BASIC_LANGUAGES],['autoDownload',[true,false]]])for(const value of values){const r=c.parseApplicationOperationRequest(input('app.preferences.set',{kind,value}));assert(c.applicationOperationNeedsApproval(r));}
 for(const a of [{kind:'apiKey',value:'PRIVATE_KEY'},{kind:'autoDownload',value:'true'},{kind:'theme',value:'__proto__'},{kind:'theme',value:'dark',confirmed:true}])assert.throws(()=>c.parseApplicationOperationRequest(input('app.preferences.set',a)));
 for(const d of ['exec','https://PRIVATE.invalid','/PRIVATE_PATH'])assert.throws(()=>c.parseApplicationOperationRequest(input('app.navigate',{destination:d})));
 for(const op of ['app.navigate','app.preferences.set'])assert.throws(()=>p.assertApplicationOperationPermission(op,['read']),{code:'OPERATION_PERMISSION_REQUIRED'});
 assert.throws(()=>c.parseApplicationOperationRequest({...input('app.navigate',{destination:'canvas'}),projectId:''}));
});
test('external changes wait for App approval, reuse the real root persistence/readback, and do not touch manual config',async t=>{
 const f=fixture(t);for(const [i,args]of [{kind:'theme',value:'dark'},{kind:'language',value:'en-US'},{kind:'autoDownload',value:true}].entries()){
  const h=await f.submit('app.preferences.set',args,'qa-local-write-'+i+'-0001'),w=await f.waiting(h);assert.equal(f.writes.length,i);assert(!JSON.stringify(w).includes('PRIVATE'));
  const replay=await f.submit('app.preferences.set',args,'qa-local-write-'+i+'-0001');assert.equal(replay.replayed,true);assert.equal(replay.request.id,h.request.id);
  f.service.approve(h.request.id,w.revision);const done=await f.terminal(h);assert.equal(done.status,'completed');assert.equal(done.result.saved,true);assert.equal(done.result.visuallyApplied,true);assert.equal(done.result.generationStarted,false);
 }assert.equal(f.writes.length,3);assert.equal(f.memory.manualApi,'PRIVATE_MANUAL_KEY');assert.equal(f.memory.themeMode,'dark');assert.equal(f.memory.appLanguage,'en-US');assert.equal(f.memory.autoDownloadGeneratedResults,true);
 const h=await f.submit('app.preferences.read'),r=await f.terminal(h);assert.deepEqual(r.result.preferences,{theme:'dark',language:'en-US',autoDownload:true});assert(!JSON.stringify(r).includes('PRIVATE'));
});
test('rejected/cancelled setting and navigation jobs perform no root mutation',async t=>{
 const f=fixture(t);for(const [i,op]of ['app.preferences.set','app.navigate'].entries())for(const cancel of [false,true]){const h=await f.submit(op,op==='app.navigate'?{destination:'appearance'}:{kind:'theme',value:'dark'},'qa-no-write-'+i+'-'+cancel+'-0001'),w=await f.waiting(h);if(cancel)f.service.cancel('external',h.request.id,h.receipt);else f.service.reject(h.request.id,w.revision);assert.equal(f.read(h).status,cancel?'cancelled':'rejected');}
 assert.equal(f.writes.length,0);assert.equal(f.state.activeView,'canvas');
});
test('manual preference change and change-back invalidate the original review before any write',async t=>{
 const f=fixture(t),h=await f.submit('app.preferences.set',{kind:'theme',value:'dark'}),w=await f.waiting(h);f.state.theme='light';f.local.observe();f.state.theme='graphite';f.local.observe();f.service.approve(h.request.id,w.revision);assert.equal((await f.terminal(h)).code,'OPERATION_STATE_CHANGED');assert.equal(f.writes.length,0);
});
test('navigation checks real visible content, enterprise refusal and stale navigation review',async t=>{
 const f=fixture(t),h=await f.submit('app.navigate',{destination:'appearance'}),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);assert.equal((await f.terminal(h)).result.opened,true);assert.equal(f.state.activeView,'settings');assert.equal(f.state.activeSettingsTab,'basic');
 f.context.enterprise={connected:true,mode:'client'};const blocked=await f.submit('app.navigate',{destination:'api'},'qa-nav-blocked-0001'),br=await f.terminal(blocked);assert.equal(br.status,'failed',JSON.stringify(br));assert.equal(br.code,'OPERATION_NAVIGATION_REFUSED');
 f.context.enterprise={connected:false};const stale=await f.submit('app.navigate',{destination:'canvas'},'qa-nav-stale-0001'),sw=await f.waiting(stale);f.state.activeView='transit';f.local.observe();f.state.activeView='settings';f.local.observe();f.service.approve(stale.request.id,sw.revision);assert.equal((await f.terminal(stale)).code,'OPERATION_STATE_CHANGED');
});
test('wrong project or remounted local owner after grant consumption never changes settings',async t=>{
 for(const method of ['switchProject','remount']){const f=fixture(t,{holdConsume:true}),h=await f.submit('app.preferences.set',{kind:'theme',value:'dark'}),w=await f.waiting(h);f.service.approve(h.request.id,w.revision);await until(()=>f.held);f[method]();f.release();assert.equal((await f.terminal(h)).code,'PLAN_STALE');assert.equal(f.writes.length,0);}
});
test('old selected-session confirmation cannot revive after switching away and back during nonce IPC',async t=>{
 const f=fixture(t,{holdConsume:true}),pending=f.assistant.run('A','app.preferences.set','QA_PROJECT',{kind:'theme',value:'dark'},options('qa-owner-1'));await until(()=>f.held);f.select('B');f.select('A');f.release();await assert.rejects(pending,{code:'PLAN_SESSION_CHANGED'});assert.equal(f.writes.length,0);assert.equal(f.client.viewFor('B').messages.length,0);
});
test('two render coordinators share one in-flight request; late receipt belongs to A, not selected B',async t=>{
 const f=fixture(t,{holdSave:true}),o=options('qa-duplicate-1'),a=f.assistant.run('A','app.preferences.set','QA_PROJECT',{kind:'theme',value:'dark'},o),other=createAssistantLocalActionClient(f.client,()=>f.bridge),b=other.run('A','app.preferences.set','QA_PROJECT',{kind:'theme',value:'dark'},o);assert.equal(a,b);await until(()=>f.pending.length);f.select('B');f.pending.shift()();await a;assert.equal(f.writes.length,1);assert.equal(f.client.viewFor('A').messages.length,1);assert.equal(f.client.viewFor('B').messages.length,0);assert.equal(f.client.viewFor('B').draft,'QA_B');
});
test('delayed save becomes unknown, then the same job settles and read-only recovery never writes twice',async t=>{
 const f=fixture(t,{holdSave:true,service:{observationMs:10}}),pending=f.assistant.run('A','app.preferences.set','QA_PROJECT',{kind:'language',value:'en-US'},options('qa-late-1'));await assert.rejects(pending,{code:'OPERATION_OUTCOME_UNKNOWN'});assert.equal(f.client.viewFor('A').localAction.phase,'uncertain');assert.equal(f.writes.length,1);f.pending.shift()();await until(()=>f.service.read('internal:A',f.client.viewFor('A').localAction.handle.id).status==='completed');await f.assistant.recover('A');assert.equal(f.writes.length,1);assert.equal(f.client.viewFor('A').messages.length,1);assert.equal(f.client.viewFor('A').localAction.phase,'completed');
});
test('manual override after mutation and failed persistence are unconfirmed, never false rejection or rollback',async t=>{
 for(const failed of [false,true]){const f=fixture(t,{holdSave:true}),pending=f.assistant.run('A','app.preferences.set','QA_PROJECT',{kind:'theme',value:'dark'},options('qa-manual-1'));await until(()=>f.pending.length);if(failed)f.root.dataset.wanjuanThemePersisted='failed';else f.root.dataset.wanjuanThemePersistenceRevision='99';await assert.rejects(pending,{code:'OPERATION_OUTCOME_UNKNOWN'});assert.equal(f.client.viewFor('A').messages.length,0);assert.equal(f.writes.length,1);assert.equal(f.state.theme,'dark');}
});
test('receipt display failure after a real setting commit recovers the same operation and never repeats mutation',async t=>{
 const f=fixture(t);f.displayFailure();await assert.rejects(f.assistant.run('A','app.preferences.set','QA_PROJECT',{kind:'theme',value:'dark'},options('qa-display-1')),{code:'OPERATION_OUTCOME_UNKNOWN'});assert.equal(f.writes.length,1);await f.assistant.recover('A');assert.equal(f.writes.length,1);assert.equal(f.client.viewFor('A').messages.length,1);
});
test('missing shared bridge cannot silently fall back to root settings or navigation',async t=>{
 const f=fixture(t),client=createAssistantLocalActionClient(f.client,()=>null);await assert.rejects(client.run('A','app.navigate','QA_PROJECT',{destination:'appearance'},options('qa-no-bridge-1')),{code:'OPERATION_PERMISSION_REQUIRED'});assert.equal(f.state.activeView,'canvas');assert.equal(f.writes.length,0);
});
