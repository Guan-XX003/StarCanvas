// Exercise the actual renderer handlers while React's state updates are queued.
// All state, callbacks and task data are synthetic and confined to this process.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
const modules = {...require('../src/renderer/lib/assistant-onboarding.ts'),...require('../src/renderer/lib/assistant-local-operations.ts'),...require('../src/renderer/lib/assistant-preferences.ts'),...require('../src/renderer/lib/assistant-canvas-copy.ts'),...require('../src/renderer/lib/assistant-local-action-copy.ts')};
const {createApplicationTaskReader}=require('../src/renderer/lib/application-task-records.ts');
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/renderer/components/assistant-onboarding.tsx'),'utf8');
const tree=ts.createSourceFile('assistant-onboarding.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const selected=new Map();
function visit(node) { if(ts.isFunctionDeclaration(node)&&['sendMessage','stopMessage','startNewChat','requestNavigation','requestPreference','openSuggestedAction','confirmPreference','createSuggestedNode','invalidateActionProposals','removeKey','removeAccount','saveKey'].includes(node.name?.text)) selected.set(node.name.text,node.getText(tree));ts.forEachChild(node,visit); }
visit(tree);assert.equal(selected.size,12);
const code=ts.transpileModule([...selected.values()].join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function environment(kind) {
  const preference={kind:'theme',value:'dark'};
  const item=kind==='navigation'?{role:'assistant',text:'suggestion',action:'open_canvas'}:kind==='preference'?{role:'assistant',text:'suggestion',preference}:{role:'assistant',text:'suggestion',action:'create_text_node',actionProjectId:'synthetic-project'};
  const effects=[],queued=[];
  const ctx={...modules,messages:[item],consumedActions:{current:new WeakSet()},message:'任务状态',localActionSubmitted:{current:false},busy:false,sending:false,cancelling:false,accountPending:false,preferenceInFlight:{current:null},navigationInFlight:{current:null},modelSendInFlight:{current:false},modelCancellationRequested:{current:false},cancelInFlight:{current:false},resetInFlight:{current:false},pendingTaskInspection:{current:null},pendingPreference:null,pendingNavigation:null,diagnosticDraft:{current:false},ready:true,tasksReady:true,navigationReady:true,settingsUnavailable:false,language:'zh-CN',themeMode:'graphite',autoDownloadGeneratedResults:false,status:{installed:true,configured:true},requiresReset:false,activeView:'canvas',activeSettingsTab:'account',projectId:'synthetic-project',projectName:'synthetic',tasks:[],boundaryNotice:'new session',proposalFence:{current:false},proposalBlocked:false,
    crypto:require('node:crypto'),workspace:{available:false,active:false,id:'synthetic-owner',controller:{viewFor:()=>({canvasPlan:{},localAction:{phase:'failed'}})}},getCanvasNodePlacement:()=>({x:10,y:20}),canvasPlanner:{createSingle:async()=>{effects.push('node');return {generationStarted:false};}},
    customRole:false,
    canNavigateLocal:true,canSetPreference:true,localActions:{async run(_owner,operation,_project,args){const result=operation==='app.navigate'?ctx.onNavigateLocal(args.destination):ctx.onSetPreference(args.kind,args.value);if(!result)throw Error('synthetic refusal');return {...args};}},
    navigationCounter:{current:0},onNavigationNotice:undefined,onNavigateLocal:()=>{effects.push('navigate');return true},onSetPreference:()=>{effects.push('preference');return true},
    inputRevision:{current:0},key:'SYNTHETIC_KEY',setKey(){},setPanel(){},setMessage(){},setMessages:value=>queued.push(value),setChatError(value){ctx.chatError=value},setChatNotice(){},setConnectionNotice(){},setKeyEntry(value){ctx.keyEntry=value},setStatus(value){ctx.newStatus=value},setStatusError(value){ctx.statusError=value},setPendingPreference(){},setPendingNavigation(){},setBusy(){},setSending(){},setCancelling(){},setCancelledTurnWaiting(){},setRequiresReset(value){ctx.newRequiresReset=value},refreshStatus:async()=>({configured:false}),
    window:{wanjuanDesktop:{assistantSend:()=>{throw Error('unexpected model request')}}},t:{chatStopped:'cancelled',runtimeMissing:'missing'},accountText:{rejected:'rejected'}};
  const reader=createApplicationTaskReader(()=>ctx.tasks,new Map());
  ctx.queryTaskText=async format=>format((await reader.tasks()).tasks);
  const f=vm.runInNewContext(`${code}\n({sendMessage,stopMessage,startNewChat,openSuggestedAction,confirmPreference,createSuggestedNode,removeKey,removeAccount,saveKey})`,ctx);
  const click=()=>kind==='navigation'?f.openSuggestedAction('open_canvas',0):kind==='preference'?f.confirmPreference(0,preference):f.createSuggestedNode(0,'create_text_node','synthetic-project');
  return {ctx,effects,queued,f,click};
}
(async()=>{
  for(const outcome of ['success','failure']) {
    const e=environment('navigation');let finishReply,calls=0;e.ctx.message='可以把主题换成深色吗？';
    e.ctx.setSending=value=>{e.ctx.sending=value};e.ctx.setBusy=value=>{e.ctx.busy=value};e.ctx.setMessage=value=>{e.ctx.message=typeof value==='function'?value(e.ctx.message):value};
    e.ctx.window.wanjuanDesktop.assistantSend=()=>{calls++;return new Promise(resolve=>{finishReply=resolve})};
    e.ctx.window.wanjuanDesktop.assistantCancel=async()=>{if(outcome==='failure')throw Error('synthetic stop failure');return {ok:true}};
    const pending=e.f.sendMessage();await e.f.stopMessage();assert.equal(e.ctx.modelSendInFlight.current,true,'synthetic reply remains pending');
    e.ctx.message='打开画布';e.ctx.inputRevision.current++;await e.f.sendMessage();assert.deepEqual(e.effects,['navigate'],'local command remains usable while cancelled model request is pending');
    e.ctx.localActionSubmitted.current=false;e.ctx.navigationInFlight.current=null;
    e.ctx.message='你好';e.ctx.inputRevision.current++;await e.f.sendMessage();assert.equal(calls,1,'a second model request must not start while the first is unresolved');
    finishReply({ok:true,value:'delayed synthetic reply'});await pending;assert.equal(e.ctx.modelSendInFlight.current,false);assert.equal(e.ctx.message,'你好','a late cancelled reply cannot restore an old draft over newer input');
  }
  for(const order of ['reply-first','cancel-first']) for(const outcome of ['success','failure']) {
    const e=environment('navigation');let reply,cancelResolve,cancelReject;e.ctx.message='可以把主题换成深色吗？';
    e.ctx.setSending=value=>{e.ctx.sending=value};e.ctx.setBusy=value=>{e.ctx.busy=value};
    e.ctx.window.wanjuanDesktop.assistantSend=()=>new Promise(resolve=>{reply=resolve});
    e.ctx.window.wanjuanDesktop.assistantCancel=()=>new Promise((resolve,reject)=>{cancelResolve=resolve;cancelReject=reject});
    const send=e.f.sendMessage();assert.equal(e.ctx.sending,true);const stop=e.f.stopMessage();
    const finishReply=()=>reply({ok:true,value:'Suggested.\n[[STARCANVAS_PREFERENCE:{"kind":"theme","value":"dark"}]]'});
    const finishCancel=()=>outcome==='success'?cancelResolve({ok:true}):cancelReject(Error('synthetic stop failure'));
    if(order==='reply-first'){finishReply();await send;finishCancel();await stop;}else{finishCancel();await stop;finishReply();await send;}
    const final=e.queued.reduce((state,update)=>typeof update==='function'?update(state):update,e.ctx.messages);
    assert.ok(!final.some(item=>item.preference||item.action),'a cancelled turn never exposes an old actionable proposal');
    assert.ok(!final.some(item=>item.modelReply),'a cancelled turn never exposes a delayed model reply');
    if(outcome==='failure'){assert.equal(e.ctx.proposalFence.current,true);assert.equal(e.ctx.newRequiresReset,true);assert.match(e.ctx.chatError,/无法确认/);}
    else assert.equal(e.ctx.proposalFence.current,false,'a confirmed stop can start a new conversation');
  }
  for (const invalid of [{kind:'theme',value:'__proto__'},{kind:'language',value:'invalid'},{kind:'autoDownload',value:'true'},{kind:'autoDownload',value:true,extra:'synthetic'}]) {
    const e=environment('preference');e.ctx.messages[0].preference=invalid;
    e.f.confirmPreference(0,invalid);assert.deepEqual(e.effects,[],'invalid values are rejected again at confirmation');assert.equal(e.ctx.preferenceInFlight.current,null);
  }
  for(const kind of ['navigation','preference','node']) for(const [action,method] of [['removeKey','assistantClearKey'],['removeAccount','assistantAccountClear'],['saveKey','assistantSetKey']]) {
    const e=environment(kind);let finish;
    e.ctx.window.wanjuanDesktop[method]=()=>new Promise(resolve=>{finish=resolve});
    const changing=e.f[action]();e.click();
    assert.deepEqual(e.effects,[],`${kind}: ${action} immediately invalidates the old proposal before React renders`);
    finish({ok:true});await changing;
    if(action!=='saveKey') assert.equal(e.ctx.keyEntry,false,'local commands remain reachable when the last credential is removed');
  }
  for(const [action,method] of [['removeKey','assistantClearKey'],['removeAccount','assistantAccountClear']]) {
    const e=environment('navigation');e.ctx.window.wanjuanDesktop[method]=async()=>{throw Error('synthetic credential failure')};
    await e.f[action]();assert.equal(e.ctx.proposalFence.current,true,`${action}: fence unconfirmed session synchronously`);
    assert.equal(e.ctx.newRequiresReset,true);assert.equal(e.ctx.newStatus,null);assert.equal(e.ctx.statusError,true);
    assert.match(e.ctx.chatError,/无法确认/);assert.doesNotMatch(e.ctx.chatError,/已重置/);
    e.ctx.message='你好';await e.f.sendMessage();assert.deepEqual(e.effects,[],'unconfirmed credential operation cannot send model chat before React renders');
    e.ctx.message='打开画布';await e.f.sendMessage();assert.deepEqual(e.effects,['navigate'],'local navigation remains available');
  }
  {
    const e=environment('navigation');e.ctx.window.wanjuanDesktop.assistantSetKey=async()=>{throw Error('synthetic write uncertainty')};
    await e.f.saveKey();assert.equal(e.ctx.proposalFence.current,true);assert.equal(e.ctx.newRequiresReset,true);
    assert.equal(e.ctx.newStatus,null);assert.equal(e.ctx.statusError,true);assert.match(e.ctx.chatError,/无法确认密钥是否已保存/);
  }
  {
    const e=environment('navigation');let finishReset,calls=0;
    e.ctx.window.wanjuanDesktop.assistantReset=()=>{calls++;return new Promise(resolve=>{finishReset=resolve})};
    const first=e.f.startNewChat(),second=e.f.startNewChat();assert.equal(calls,1,'only one reset may be outstanding');
    e.ctx.message='打开画布';await e.f.sendMessage();assert.deepEqual(e.effects,[],'new actions wait for reset completion');
    finishReset({ok:true});await Promise.all([first,second]);assert.equal(e.ctx.resetInFlight.current,false);
    e.ctx.window.wanjuanDesktop.assistantReset=async()=>{throw Error('synthetic')};await e.f.startNewChat();
    assert.equal(e.ctx.resetInFlight.current,false,'a failed reset releases its guard');assert.equal(e.ctx.proposalFence.current,true,'a failed reset keeps earlier proposals fenced');
  }
  {
    const e=environment('navigation');let finishCancel,calls=0;e.ctx.sending=true;e.ctx.modelSendInFlight.current=true;
    e.ctx.window.wanjuanDesktop.assistantCancel=()=>{calls++;return new Promise(resolve=>{finishCancel=resolve})};
    const first=e.f.stopMessage(),second=e.f.stopMessage();
    assert.equal(calls,1,'repeated clicks before React commits dispatch one cancellation');
    e.ctx.sending=false;e.ctx.modelSendInFlight.current=false;e.ctx.message='打开画布';await e.f.sendMessage();
    assert.deepEqual(e.effects,[],'a new action cannot overtake the outstanding cancellation');
    finishCancel({ok:true});await Promise.all([first,second]);assert.equal(e.ctx.cancelInFlight.current,false);
    e.ctx.sending=true;e.ctx.modelSendInFlight.current=true;e.ctx.modelCancellationRequested.current=false;e.ctx.window.wanjuanDesktop.assistantCancel=async()=>{throw Error('synthetic cancel failure')};
    await e.f.stopMessage();assert.equal(e.ctx.cancelInFlight.current,false,'failed cancellation releases the guard');assert.equal(e.ctx.newRequiresReset,true);
    e.ctx.modelSendInFlight.current=false;calls=0;e.ctx.window.wanjuanDesktop.assistantCancel=async()=>{calls++;return {ok:true}};
    await e.f.stopMessage();assert.equal(calls,0,'a stale stop button cannot cancel an already finished turn');
  }
  for(const kind of ['navigation','preference','node']) {
    const baseline=environment(kind);await baseline.click();assert.deepEqual(baseline.effects,[kind==='navigation'?'navigate':kind],`${kind}: a current confirmed proposal works`);
    const e=environment(kind);await e.f.sendMessage();assert.ok(e.queued.length>0,'React update remains queued');
    await e.click();assert.deepEqual(e.effects,[],`${kind}: stale proposal cannot execute before queued state commits`);
    const selected=environment(kind);selected.ctx.pendingTaskInspection.current={id:'qa-task'};await selected.click();
    assert.deepEqual(selected.effects,[],`${kind}: a just-selected task immediately blocks stale controls before React renders`);
  }
  for(const result of ['rejected','throws']) {
    const e=environment('navigation');let calls=0;e.ctx.onNavigateLocal=()=>{calls++;if(result==='throws')throw Error('synthetic');return false};
    e.click();e.click();assert.equal(calls,1,`${result}: the stale proposal cannot invoke navigation twice before render`);
    assert.equal(e.ctx.navigationInFlight.current,null,'synchronous failure releases the in-flight guard');
  }
  for(const result of ['rejected','throws']) {
    const e=environment('navigation');let calls=0;e.ctx.message='打开画布';e.ctx.onNavigateLocal=()=>{calls++;if(result==='throws')throw Error('synthetic after partial work');return false};
    await e.f.sendMessage();await e.f.sendMessage();assert.equal(calls,1,`${result}: a repeated direct command cannot invoke navigation twice before input commits`);
    e.ctx.localActionSubmitted.current=false;await e.f.sendMessage();assert.equal(calls,2,'a newly edited or cleared-and-retyped input may be submitted again');
  }
  {
    const e=environment('preference');let calls=0;e.ctx.message='把主题改成曜石黑';e.ctx.onSetPreference=()=>{calls++;throw Error('synthetic after partial work')};
    e.ctx.finishPreference=operation=>{if(e.ctx.preferenceInFlight.current!==operation)return false;e.ctx.preferenceInFlight.current=null;return true};
    await e.f.sendMessage();await e.f.sendMessage();assert.equal(calls,1,'a setting callback exception cannot make a stale direct input execute twice');
  }
  const pending=environment('navigation');pending.ctx.pendingTaskInspection.current={id:'qa-task'};pending.ctx.message='打开画布';let resets=0;
  pending.ctx.window.wanjuanDesktop.assistantReset=async()=>{resets++;return {ok:true}};await pending.f.sendMessage();await pending.f.startNewChat();
  assert.deepEqual(pending.effects,[],'a new message waits for the selected task');assert.equal(resets,0,'a reset cannot overtake a selected task');
  console.log('PASS_ASSISTANT_PROPOSAL_IMMEDIATE_INVALIDATION');
})().catch(e=>{console.error(e);process.exitCode=1});
