// Exercise the actual renderer send handler with synthetic state and an
// in-memory assistant bridge. No Electron profile, network, or user data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename,
}).outputText, filename);
const onboarding = require('../src/renderer/lib/assistant-onboarding.ts');
const operations = require('../src/renderer/lib/assistant-local-operations.ts');
const preferences = require('../src/renderer/lib/assistant-preferences.ts');
const {createApplicationTaskReader} = require('../src/renderer/lib/application-task-records.ts');
const {assistantTaskReadFailure} = require('../src/renderer/lib/assistant-task-reader.ts');
const filename = path.join(__dirname,'../src/renderer/components/assistant-onboarding.tsx');
const source = fs.readFileSync(filename,'utf8');
const tree = ts.createSourceFile(filename,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let handler;
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'sendMessage') handler = node.getText(tree);
  ts.forEachChild(node,visit);
}
visit(tree);
assert.ok(handler,'actual assistant send handler is present');
const compiled = ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const task = {id:'fixture-task',status:'failed',type:'image',errorMsg:'HTTP 429 rate limit PRIVATE_ERROR',prompt:'PRIVATE_PROMPT',apiKey:'PRIVATE_KEY',resultUrl:'https://private.invalid/PRIVATE_MEDIA'};

function environment(text, result) {
  const calls = [], navigation = [], messages = [];
  const ctx = {...onboarding,...operations,...preferences,messages,consumedActions:{current:new WeakSet()},
    workspace:{available:false,active:false},
    customRole:false,
    message:text, busy:false,cancelling:false,accountPending:false,preferenceInFlight:{current:null},navigationInFlight:{current:null},modelSendInFlight:{current:false},modelCancellationRequested:{current:false},cancelInFlight:{current:false},resetInFlight:{current:false},pendingTaskInspection:{current:null},pendingPreference:null,pendingNavigation:null,
    diagnosticDraft:{current:true},inputRevision:{current:0},localActionSubmitted:{current:false},proposalFence:{current:false},ready:true,tasksReady:true,navigationReady:true,settingsUnavailable:false,language:'zh-CN',themeMode:'graphite',autoDownloadGeneratedResults:false,
    status:{installed:true,configured:true,authMode:'key'},requiresReset:false,activeView:'canvas',activeSettingsTab:'account',projectId:'synthetic',projectName:'fixture',tasks:[task],boundaryNotice:'new session',
    t:{chatStopped:'cancelled',runtimeMissing:'missing runtime'},accountText:{rejected:'rejected'},
    document:{documentElement:{dataset:{wanjuanAutoDownloadListener:'off',wanjuanLanguage:'zh-CN',wanjuanLanguageApplied:'zh-CN'},classList:{contains:name=>name==='theme-graphite'}}},window:{wanjuanDesktop:{assistantSend:async (message,context)=>{calls.push({message,context});return result;}}},
    canNavigateLocal:true,canSetPreference:true,onSetPreference:()=>{throw Error('UNEXPECTED_SETTING_MUTATION')},
    requestPreference:async p=>ctx.onSetPreference(p.kind,p.value),
    localActions:{read:async()=>({theme:ctx.themeMode,language:ctx.language,autoDownload:ctx.autoDownloadGeneratedResults})},
    requestNavigation:target=>navigation.push(target),
    setMessage(value){ctx.message=typeof value==='function'?value(ctx.message):value},
    setMessages(value){const next=typeof value==='function'?value(messages):value;messages.splice(0,messages.length,...next)},
    setBusy(value){ctx.busy=value},setSending(){},setCancelledTurnWaiting(){},setPendingPreference(value){ctx.pendingPreference=value},setChatError(value){ctx.chatError=value},setChatNotice(value){ctx.chatNotice=value},setRequiresReset(value){ctx.requiresReset=value},
  };
  const reader=createApplicationTaskReader(()=>ctx.tasks,new Map());
  ctx.queryTaskText=async(format,options={})=>{try{const value=options.id?await reader.task(options):await reader.tasks(options);return format(options.id?(value.task?[value.task]:[]):value.tasks);}catch(error){return assistantTaskReadFailure(error.code,ctx.language);}};
  return {ctx,calls,navigation,messages,run:()=>vm.runInNewContext(`${compiled}\nsendMessage`,ctx)()};
}

(async()=>{
  {
    const e=environment('任务状态',{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.diagnosticDraft.current=false;let release;
    e.ctx.workspace.view={taskRead:{working:false}};
    e.ctx.queryTaskText=()=>{e.ctx.workspace.view.taskRead.working=true;return new Promise(resolve=>release=resolve);};
    const first=e.run();assert.equal(e.ctx.message,'','the submitted draft is consumed before the async read');
    e.ctx.message='NEW_UNSENT_DRAFT';await e.run();assert.equal(e.calls.length,0,'a second submission cannot overtake the read');
    release('LOCAL_TASK_RESULT');await first;assert.equal(e.ctx.message,'NEW_UNSENT_DRAFT','a delayed task read must not clear newer input');assert.equal(e.messages.length,2);
  }
  for(const [language,text] of [['zh-CN','如何查看任务状态？我的任务失败了吗？'],['zh-TW','怎麼查看任務狀態？我的任務失敗了嗎？'],['en-US','How do I view tasks? What is my current task status?']]) {
    const e=environment(text,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,0,'mixed question never reaches a model without local state');assert.equal(e.navigation.length,0);assert.equal(e.ctx.pendingPreference,null);assert.equal(e.messages.length,2);assert.match(e.messages.at(-1).text,language==='en-US'?/separately/:language==='zh-TW'?/分開詢問/:/分开询问/);assert.doesNotMatch(e.messages.at(-1).text,/PRIVATE|MODEL_MUST_NOT_BE_USED/);
  }
  for(const language of ['zh-CN','zh-TW','en-US'])for(const text of ['My key is sk-1234567890abcdef','Authorization: Bearer 1234567890abcdef','https://fixture.invalid/?token=1234567890abcdef','s\u200bk-1234567890abcdef','https://fixture.invalid/%253Ftoken%253D1234567890abcdef']) {
    const e=environment(text,{ok:true,value:'MUST_NOT_BE_SENT'});e.ctx.language=language;await e.run();assert.equal(e.calls.length,0);assert.equal(e.ctx.message,text,'the user can edit the unsent draft');assert.ok(e.ctx.chatError);assert.equal(e.messages.length,0,'credential was not added to chat history');
  }
  for (const language of ['zh-CN','zh-TW','en-US']) {
    const e=environment('hello', {ok:false,code:'ASSISTANT_SENSITIVE_INPUT'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,1);assert.equal(e.ctx.message,'hello','a main-process rejection restores the draft');
    assert.ok(e.ctx.chatError);assert.equal(e.messages.length,0,'an unsent request is not kept in chat history or shown as a reset session');
  }
  for(const [language,text,expected] of [['zh-CN','把主题切换成石墨灰或曜石黑','请说明'],['zh-TW','將語言切換為繁體中文還是英文','請說明'],['en-US','switch the theme to graphite or obsidian','Please specify']]) {
    const e=environment(text,{ok:true,value:'[[STARCANVAS_PREFERENCE:{"kind":"theme","value":"dark"}]]'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,0);assert.equal(e.navigation.length,0);assert.equal(e.ctx.pendingPreference,null);assert.match(e.messages.at(-1).text,new RegExp(expected));
  }
  for(const [language,expected] of [['zh-CN','无法确认之前的智能助手会话已安全关闭并完成清理'],['zh-TW','無法確認先前的智慧助手工作階段已安全關閉並完成清理'],['en-US','could not be confirmed safely closed and cleaned up']]) {
    const e=environment('你好',{ok:false,code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.ok(e.ctx.chatError.includes(expected));assert.equal(e.ctx.requiresReset,true);assert.equal(e.ctx.proposalFence.current,true);
    assert.ok(!e.messages.some(item=>item.role==='notice'),'an unconfirmed process exit cannot be presented as a reset session');
  }
  for(const [language,latestQuestion,diagnosticQuestion] of [['zh-CN','最近的任务怎么样','帮我检查失败的任务'],['zh-TW','最近的任務怎麼樣','請幫我檢查失敗的任務'],['en-US','what is the latest task status?','check why my task failed']]) {
    for(const text of [latestQuestion,diagnosticQuestion]) {
      const e=environment(text,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
      e.ctx.tasks=[{id:'old',type:'image',status:'failed',createdAt:1735689600000,errorMsg:'HTTP 401 PRIVATE_OLD'}, {id:'new',type:'video',status:'failed',createdAt:1767225600,errorMsg:'HTTP 429 PRIVATE_NEW'}];
      await e.run();assert.equal(e.calls.length,0);assert.match(e.messages.at(-1).text,language==='en-US'?/cannot.*reliably/:language==='zh-TW'?/無法可靠/:/无法可靠/);assert.doesNotMatch(e.messages.at(-1).text,/401|429|PRIVATE/);
    }
  }
  for(const [language,text] of [['zh-CN','当前项目的任务进度是多少？'],['zh-TW','目前專案的任務進度是多少？'],['en-US','what is the current project task progress?']]) {
    const e=environment(text,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.diagnosticDraft.current=false;e.ctx.language=language;
    e.ctx.tasks=[{id:'local',projectId:'synthetic',type:'video',status:'running',progress:42,prompt:'PRIVATE_PROMPT'},{id:'other',projectId:'another',type:'video',status:'running',progress:88}];
    await e.run();assert.equal(e.calls.length,0);assert.match(e.messages.at(-1).text,/42%/);assert.doesNotMatch(e.messages.at(-1).text,/88%|PRIVATE_PROMPT/);
  }
  {
    const e=environment('当前项目的任务进度是多少？',{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.diagnosticDraft.current=false;
    e.ctx.tasks=[{id:'local',projectId:'synthetic',type:'video',status:'running',progress:42},{id:'unassigned',type:'video',status:'running',progress:99}];
    await e.run();assert.equal(e.calls.length,0);assert.match(e.messages.at(-1).text,/无法可靠/);assert.doesNotMatch(e.messages.at(-1).text,/42%|99%/);
  }
  for(const [language,text,expected] of [['zh-CN','我的生成还要多久？','无法可靠预估'],['zh-TW','我的影片任務還要多久？','無法可靠預估'],['en-US','how long will my generation take?','can\u0027t reliably estimate']]) {
    const e=environment(text,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.diagnosticDraft.current=false;e.ctx.language=language;
    await e.run();assert.equal(e.calls.length,0);assert.equal(e.navigation.length,0);assert.ok(e.messages.at(-1).text.toLowerCase().includes(expected));
  }
  for(const [language,text] of [['zh-CN','我的视频任务现在进度多少？'],['zh-TW','我的影片任務進度是多少？'],['en-US','what is my video task progress?']]) {
    const e=environment(text,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.diagnosticDraft.current=false;e.ctx.language=language;
    e.ctx.tasks=[{id:'video',type:'video',status:'running',progress:42,prompt:'PRIVATE_PROMPT'},{id:'image',type:'image',status:'running',progress:88}];await e.run();
    assert.equal(e.calls.length,0);assert.match(e.messages.at(-1).text,/42%/);assert.doesNotMatch(e.messages.at(-1).text,/88%|PRIVATE_PROMPT/);
  }
  for(const [language,text] of [['zh-CN','我的任务现在进度是多少？'],['zh-TW','我的任務跑到哪一步了？'],['en-US','what is my task progress?']]) {
    const e=environment(text,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.diagnosticDraft.current=false;e.ctx.language=language;
    e.ctx.tasks=[{id:'synthetic',status:'running',progress:42,prompt:'PRIVATE_PROMPT'}];await e.run();
    assert.equal(e.calls.length,0);assert.match(e.messages.at(-1).text,/42%/);assert.doesNotMatch(e.messages.at(-1).text,/PRIVATE_PROMPT/);
  }
  for(const [language,text,expected] of [['zh-CN','我刚才生成的视频为什么失败？','无法可靠定位'],['zh-TW','我剛才產生的影片為什麼失敗？','無法可靠定位'],['en-US','why did my generated video fail?','cannot reliably identify']]) {
    const e=environment(text,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.diagnosticDraft.current=false;e.ctx.language=language;
    await e.run();assert.equal(e.calls.length,0);assert.equal(e.navigation.length,0);assert.ok(e.messages.at(-1).text.includes(expected));
    assert.ok(!e.messages.at(-1).text.includes('429'),'an unrelated task is not used as a guess');
  }
  for(const [language,text,expected] of [['zh-CN','帮我检查失败的任务','访问频率限制'],['zh-TW','請幫我檢查失敗的任務','存取頻率限制'],['en-US','check why my task failed','rate limit']]) {
    const e=environment(text,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.diagnosticDraft.current=false;e.ctx.language=language;
    await e.run();assert.equal(e.calls.length,0);assert.equal(e.navigation.length,0);
    const output=e.messages.at(-1).text;assert.ok(output.includes(expected),`${language}: diagnosis uses the actual local failed-task category`);
    for(const secret of ['PRIVATE_ERROR','PRIVATE_PROMPT','PRIVATE_KEY','PRIVATE_MEDIA','fixture-task']) assert.equal(output.includes(secret),false);
  }
  for (const text of ['创建文字节点内容为猫并发短信','建立文字節點內容為貓並發郵件','创建文字节点内容为猫并发布帖子']) {
    const e=environment(text,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,0,'compound request must be clarified without a model call');
    assert.equal(e.navigation.length,0);assert.match(e.messages.at(-1).text,/请说明/);
    assert.equal(e.messages.some(item=>item.action||item.preference),false,'no partial action is offered');
  }
  for(const [language,text] of [['zh-CN','创建文字节点内容为猫再注销账号'],['zh-TW','建立文字節點內容為貓再登出帳號'],['en-US','create a text node with content cat then log out']]) {
    const e=environment(text,{ok:true,value:'Suggestion.\n[[STARCANVAS_ACTION:create_text_node]]'});e.ctx.diagnosticDraft.current=false;e.ctx.language=language;
    await e.run();assert.equal(e.calls.length,0,'a recognized mixed request asks locally before calling the model');
    assert.equal(e.navigation.length,0);assert.equal(e.messages.some(item=>item.action||item.preference),false);
    assert.match(e.messages.at(-1).text,language==='en-US'?/specify/:language==='zh-TW'?/請說明/:/请说明/);
  }
  {
    let resolveSend;
    const e=environment('你好',{ok:true,value:'unused'});e.ctx.diagnosticDraft.current=false;
    e.ctx.setMessage=()=>{};e.ctx.setBusy=()=>{}; // React state has not committed yet.
    e.ctx.window.wanjuanDesktop.assistantSend=async()=>{e.calls.push('send');return new Promise(resolve=>{resolveSend=resolve})};
    const first=e.run(),second=e.run();
    assert.equal(e.calls.length,1,'two sends before the React render must not submit two model requests');
    resolveSend({ok:true,value:'Hello!'});await Promise.all([first,second]);
    assert.equal(e.ctx.modelSendInFlight.current,false,'the guard is released after completion');
    e.ctx.navigationInFlight.current=42;e.ctx.message='打开画布';await e.run();
    assert.equal(e.navigation.length,0,'navigation already in flight prevents duplicate sends before render');
  }
  for (const [language,question,category] of [['zh-CN','为什么我的任务失败','访问频率限制'],['zh-TW','為什麼我的任務失敗','存取頻率限制'],['en-US','why did my task fail','rate limit']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_MODEL_MUST_NOT_ANSWER'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    e.ctx.tasks=[{...task,errorMsg:'HTTP 429 PRIVATE_ERROR'}];
    await e.run();assert.equal(e.calls.length,0,'status-only diagnosis is local');assert.ok(e.messages.at(-1).text.includes(category));
    for (const secret of ['PRIVATE_ERROR','PRIVATE_PROMPT','PRIVATE_KEY','PRIVATE_MEDIA']) assert.ok(!e.messages.at(-1).text.includes(secret));
    assert.equal(e.navigation.length,0);
  }
  for (const [language,question,failed] of [['zh-CN','现在我的任务怎么样','失败 1'],['zh-TW','目前我的任務怎麼樣','失敗 1'],['en-US','how are my tasks doing?','1 failed']]) {
    const e=environment(question,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;await e.run();
    assert.equal(e.calls.length,0);assert.ok(e.messages.at(-1).text.includes(failed));
    for(const secret of ['PRIVATE_ERROR','PRIVATE_PROMPT','PRIVATE_KEY','PRIVATE_MEDIA']) assert.ok(!e.messages.at(-1).text.includes(secret));
  }
  for (const [language,question,expected] of [['zh-CN','最近的任务怎么样','最近创建的任务：失败'],['zh-TW','最近的任務怎麼樣','最近建立的任務：失敗'],['zh-CN','这个任务怎么样','无法可靠定位']]) {
    const e=environment(question,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;await e.run();
    assert.equal(e.calls.length,0);assert.ok(e.messages.at(-1).text.includes(expected),e.messages.at(-1).text);
    for(const secret of ['PRIVATE_ERROR','PRIVATE_PROMPT','PRIVATE_KEY','PRIVATE_MEDIA']) assert.ok(!e.messages.at(-1).text.includes(secret));
  }
  for (const language of ['zh-CN','zh-TW','en-US']) {
    const summary=onboarding.buildAssistantFailureSummary([task],language);
    const edited=summary.split('\n').slice(1).join('\n').replace('429','503');
    const e=environment(edited,{ok:true,value:'Suggestion.\n[[STARCANVAS_ACTION:open_canvas]]'});e.ctx.language=language;
    await e.run();assert.equal(e.calls.length,1);assert.equal(e.calls[0].message,edited);
    for(const secret of ['PRIVATE_ERROR','PRIVATE_PROMPT','PRIVATE_KEY','PRIVATE_MEDIA'])assert.equal(e.calls[0].message.includes(secret),false);
    assert.equal(e.messages.at(-1).action,null,'diagnostic replies cannot offer an action');assert.equal(e.navigation.length,0);
  }
  for(const code of ['ASSISTANT_CANCELLED','ASSISTANT_BUSY','ASSISTANT_PROVIDER_TIMEOUT']) {
    const draft=onboarding.buildAssistantFailureSummary([task],'zh-CN');const e=environment(draft,{ok:false,code});
    await e.run();assert.equal(e.calls.length,1);assert.equal(e.ctx.message,draft);assert.equal(e.ctx.diagnosticDraft.current,true,'failure preserves the user-confirmed draft for a manual retry');assert.equal(e.ctx.modelSendInFlight.current,false,'failure and cancellation release the synchronous guard');
  }
  for(const code of ['ASSISTANT_CANCELLED','ASSISTANT_BUSY','ASSISTANT_PROVIDER_TIMEOUT','ASSISTANT_RUNTIME_STOP_UNCONFIRMED']) {
    for(const replacement of ['', '新的问题']) {
      let finish;
      const draft=onboarding.buildAssistantFailureSummary([task],'zh-CN'),e=environment(draft,{ok:false,code});
      e.ctx.window.wanjuanDesktop.assistantSend=()=>new Promise(resolve=>{finish=resolve});
      const pending=e.run();
      e.ctx.inputRevision.current++;e.ctx.message=replacement;e.ctx.diagnosticDraft.current=false;
      finish({ok:false,code});await pending;
      assert.equal(e.ctx.message,replacement,`${code}: late failure must not restore text over a newer edit`);
      assert.equal(e.ctx.diagnosticDraft.current,false,`${code}: a newer draft must not inherit the old diagnostic marker`);
    }
  }
  {
    let finish,queuedRestore;
    const draft=onboarding.buildAssistantFailureSummary([task],'zh-CN'),e=environment(draft,{ok:false,code:'ASSISTANT_BUSY'});
    e.ctx.window.wanjuanDesktop.assistantSend=()=>new Promise(resolve=>{finish=resolve});
    e.ctx.setMessage=value=>{if(typeof value==='function')queuedRestore=value;else e.ctx.message=value};
    const pending=e.run();finish({ok:false,code:'ASSISTANT_BUSY'});await pending;
    assert.equal(typeof queuedRestore,'function','draft restore is a deferred React updater');
    e.ctx.inputRevision.current++;e.ctx.message='';
    assert.equal(queuedRestore(e.ctx.message),'','a user edit after the reply but before React commits also wins');
  }
  const replaced=environment('打开资源',{ok:true,value:'unused'});await replaced.run();
  assert.equal(replaced.calls.length,0,'replacing a draft returns to local routing');assert.deepEqual(replaced.navigation,['resources']);
  for (const [question,kind,value] of [['把主题改成曜石黑吧','theme','dark'],['請幫我把語言切換成繁體中文一下','language','zh-TW'],['请关闭自动下载一下吧','autoDownload',false]]) {
    const e=environment(question,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.diagnosticDraft.current=false;const operations=[];e.ctx.onSetPreference=(...args)=>{operations.push(args);return true};
    await e.run();assert.deepEqual(operations,[[kind,value]]);assert.equal(e.calls.length,0);assert.equal(e.navigation.length,0);assert.equal(e.messages.some(item=>item.executionStatus==='confirmed'),false,'dispatch alone is not an applied-state receipt');
  }
  for (const [question,target] of [['打开画布吧','canvas'],['打开账号设置一下吧','account'],['open canvas please','canvas']]) {
    const e=environment(question,{ok:true,value:'MODEL_MUST_NOT_BE_USED'});e.ctx.diagnosticDraft.current=false;await e.run();assert.deepEqual(e.navigation,[target]);assert.equal(e.calls.length,0);
  }
  for (const [question,target] of [['打开画布','canvas'],['打开资源','resources'],['打开智能体','agents'],['打开工作空间','workspace']]) {
    const e=environment(question,{ok:true,value:'unused'});e.ctx.ready=false;e.ctx.navigationReady=true;e.ctx.settingsUnavailable=true;
    await e.run();assert.deepEqual(e.navigation,[target],`${target}: main view remains available`);assert.equal(e.calls.length,0);
  }
  for (const question of ['打开设置','打开账号设置','打开外观设置','打开API配置','打开模型配置','打开生成与下载']) {
    const e=environment(question,{ok:true,value:'unused'});e.ctx.ready=false;e.ctx.navigationReady=true;e.ctx.settingsUnavailable=true;
    await e.run();assert.equal(e.navigation.length,0,`${question}: unhydrated settings remain protected`);assert.match(e.messages.at(-1).text,/无法可靠读取本地设置/);
  }
  const loadingNavigation=environment('打开画布',{ok:true,value:'unused'});loadingNavigation.ctx.ready=false;loadingNavigation.ctx.navigationReady=false;
  await loadingNavigation.run();assert.equal(loadingNavigation.navigation.length,0);assert.match(loadingNavigation.messages.at(-1).text,/仍在加载/);
  for (const [language,taskQuestion,navQuestion,loading,wrong] of [['zh-CN','任务状态','打开画布','仍在加载','无法可靠读取本地设置'],['zh-TW','任務狀態','打開畫布','仍在載入','無法可靠讀取本機設定'],['en-US','show my tasks','open canvas','still loading','settings could not']]) {
    for (const question of [taskQuestion,navQuestion]) {
      const e=environment(question,{ok:true,value:'unused'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;e.ctx.tasksReady=false;e.ctx.navigationReady=false;e.ctx.ready=false;e.ctx.settingsUnavailable=true;
      await e.run();assert.ok(e.messages.at(-1).text.includes(loading));assert.ok(!e.messages.at(-1).text.includes(wrong));assert.equal(e.calls.length,0);assert.equal(e.navigation.length,0);
    }
  }
  for (const [language,question,expected] of [['zh-CN','当前项目的任务状态','无法可靠按项目筛选'],['zh-TW','這個專案的影片任務為什麼失敗','無法可靠依專案篩選'],['en-US','why did this project task fail?','cannot reliably filter tasks by project']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_MODEL_MUST_NOT_ANSWER'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,0);assert.ok(e.messages.at(-1).text.includes(expected));assert.equal(e.messages.at(-1).text.includes('1 failed'),false);assert.equal(e.navigation.length,0);
  }
  for (const [language,question,expected] of [['zh-CN','当前项目的任务状态','进行中 1'],['zh-TW','目前專案任務狀態','執行中 1'],['en-US','current project task status','1 running']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_MODEL_MUST_NOT_ANSWER'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    e.ctx.tasks=[{id:'local-one',projectId:'synthetic',status:'running',prompt:'PRIVATE_PROMPT'},{id:'other-one',projectId:'other-project',status:'failed',errorMsg:'PRIVATE_ERROR'}];
    await e.run();const reply=e.messages.at(-1).text;assert.equal(e.calls.length,0);assert.ok(reply.includes(expected));assert.ok(!reply.includes('PRIVATE_PROMPT')&&!reply.includes('PRIVATE_ERROR')&&!reply.includes('other-project'));assert.ok(!/失败 1|失敗 1|1 failed/.test(reply),'another project must not enter the scoped summary');
  }
  for (const [language,question,expected] of [['zh-CN','当前项目的视频任务状态','视频任务（仅统计可识别类型）'],['zh-TW','目前專案的影片任務狀態','影片任務（僅統計可識別類型）'],['en-US','current project video task status','Video tasks (recognized types only)']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_MODEL_MUST_NOT_ANSWER'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    e.ctx.tasks=[{id:'own-video',projectId:'synthetic',type:'custom',customOutputType:'video',status:'running',prompt:'PRIVATE_PROMPT'},
      {id:'own-image',projectId:'synthetic',type:'image',status:'failed'}, {id:'other-video',projectId:'other-project',type:'video',status:'failed'}];
    await e.run();const result=e.messages.at(-1).text;assert.equal(e.calls.length,0);assert.ok(result.includes(expected));
    assert.ok(/进行中 1|執行中 1|1 running/.test(result));assert.ok(!/失败 1|失敗 1|1 failed|PRIVATE_PROMPT/.test(result));
  }
  for (const question of ['当前项目的视频任务状态','当前项目的图片视频任务状态']) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_MODEL_MUST_NOT_ANSWER'});e.ctx.diagnosticDraft.current=false;
    e.ctx.tasks=[{id:'own',projectId:'synthetic',type:'video',status:'running'},{id:'unassigned',type:'image',status:'failed'}];
    await e.run();assert.equal(e.calls.length,0);assert.match(e.messages.at(-1).text,/无法可靠按项目筛选/);
  }
  for (const [language,question,expected] of [['zh-CN','当前项目的任务为什么失败','访问频率限制'],['zh-TW','目前專案的任務為什麼失敗','存取頻率限制'],['en-US','why did the current project tasks fail?','rate limit']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_MODEL_MUST_NOT_ANSWER'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    e.ctx.tasks=[{id:'own',projectId:'synthetic',status:'failed',type:'image',errorMsg:'HTTP 429 PRIVATE_ERROR',prompt:'PRIVATE_PROMPT'},{id:'other',projectId:'other-project',status:'failed',type:'video',errorMsg:'HTTP 401 PRIVATE_OTHER',createdAt:9}];
    await e.run();const result=e.messages.at(-1).text;assert.equal(e.calls.length,0);assert.ok(result.includes(expected));
    for(const secret of ['PRIVATE_ERROR','PRIVATE_PROMPT','PRIVATE_OTHER','other-project','401']) assert.ok(!result.includes(secret));
    assert.equal(e.navigation.length,0);
  }
  for (const [language,question,expected] of [['zh-CN','当前项目的视频任务为什么失败','访问频率限制'],['zh-TW','目前專案的影片任務為什麼失敗','存取頻率限制'],['en-US','why did the current project video tasks fail?','rate limit']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_MODEL_MUST_NOT_ANSWER'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    e.ctx.tasks=[{id:'own-video',projectId:'synthetic',type:'video',status:'failed',createdAt:1,errorMsg:'HTTP 429 PRIVATE_VIDEO'},
      {id:'own-image',projectId:'synthetic',type:'image',status:'failed',createdAt:2,errorMsg:'HTTP 401 PRIVATE_IMAGE'},
      {id:'other-video',projectId:'other-project',type:'video',status:'failed',createdAt:3,errorMsg:'HTTP 408 PRIVATE_OTHER'}];
    await e.run();const result=e.messages.at(-1).text;assert.equal(e.calls.length,0);assert.ok(result.includes(expected));assert.ok(result.includes('429'));
    for(const hidden of ['PRIVATE_VIDEO','PRIVATE_IMAGE','PRIVATE_OTHER','401','408','other-project'])assert.ok(!result.includes(hidden));
  }
  const customVideo=environment('当前项目的视频任务为什么失败',{ok:true,value:'unused'});customVideo.ctx.diagnosticDraft.current=false;
  customVideo.ctx.tasks=[{id:'own',projectId:'synthetic',type:'custom',customOutputType:'video',status:'failed',errorMsg:'HTTP 429 PRIVATE_ERROR'}];await customVideo.run();
  assert.match(customVideo.messages.at(-1).text,/访问频率限制/,'custom nodes use their actual output category');
  const unassignedVideo=environment('当前项目的视频任务为什么失败',{ok:true,value:'unused'});unassignedVideo.ctx.diagnosticDraft.current=false;
  unassignedVideo.ctx.tasks=[{id:'own',projectId:'synthetic',type:'video',status:'failed'},{id:'legacy',type:'image',status:'failed'}];await unassignedVideo.run();
  assert.match(unassignedVideo.messages.at(-1).text,/无法可靠按项目筛选/,'unassigned legacy tasks prevent a potentially incomplete project selection');
  const unknownProjectFailure=environment('当前项目的任务为什么失败',{ok:true,value:'unused'});unknownProjectFailure.ctx.diagnosticDraft.current=false;
  unknownProjectFailure.ctx.tasks=[{id:'legacy',status:'failed',errorMsg:'PRIVATE_ERROR'}];await unknownProjectFailure.run();
  assert.match(unknownProjectFailure.messages.at(-1).text,/无法可靠按项目筛选/,'an unassigned task must not be silently excluded');
  const noOwnFailure=environment('当前项目的任务为什么失败',{ok:true,value:'unused'});noOwnFailure.ctx.diagnosticDraft.current=false;
  noOwnFailure.ctx.tasks=[{id:'own',projectId:'synthetic',status:'running'},{id:'other',projectId:'other-project',status:'failed',errorMsg:'PRIVATE_ERROR'}];await noOwnFailure.run();
  assert.match(noOwnFailure.messages.at(-1).text,/没有可排查的失败记录/,'another project cannot supply a failure to this project');
  const unknownOwn=environment('当前项目的任务为什么失败',{ok:true,value:'unused'});unknownOwn.ctx.diagnosticDraft.current=false;
  unknownOwn.ctx.tasks=[{id:'own',projectId:'synthetic',status:'unknown'},{id:'other',projectId:'other-project',status:'failed'}];await unknownOwn.run();
  assert.match(unknownOwn.messages.at(-1).text,/部分任务状态无法确认/,'unknown status must not become no failures');
  const missingProject=environment('当前项目的任务为什么失败',{ok:true,value:'unused'});missingProject.ctx.diagnosticDraft.current=false;missingProject.ctx.projectId='';missingProject.ctx.tasks=[];await missingProject.run();
  assert.match(missingProject.messages.at(-1).text,/无法可靠按项目筛选/);
  for (const [language,question,expected] of [['zh-CN','任务编号qa-task为什么失败？','访问频率限制'],['zh-TW','為什麼任務編號qa-task失敗？','存取頻率限制'],['en-US','why did task id qa-task fail?','rate limit']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_MODEL_MUST_NOT_ANSWER'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    e.ctx.tasks=[{id:'qa-task',type:'image',status:'failed',errorMsg:'HTTP 429 PRIVATE_ERROR',prompt:'PRIVATE_PROMPT'}, {id:'other',type:'video',status:'failed',createdAt:50,errorMsg:'HTTP 401 PRIVATE_OTHER'}];
    await e.run();const result=e.messages.at(-1).text;assert.equal(e.calls.length,0);assert.ok(result.includes(expected));assert.ok(result.includes('429'));
    for(const hidden of ['qa-task','PRIVATE_ERROR','PRIVATE_PROMPT','PRIVATE_OTHER','401'])assert.ok(!result.includes(hidden));
  }
  for (const [tasks,expected] of [[[],/找不到相符/],[[{id:'qa-task'},{id:'qa-task'}],/多条/],[[{status:'failed'}],/无法.*读取/],[[{id:'qa-task',status:'running'}],/进行中/],[[{id:'qa-task',status:'completed'}],/已完成/],[[{id:'qa-task',status:'failed',stoppedByUser:true}],/已停止/],[[{id:'qa-task',status:'unknown'}],/状态未知/]]) {
    const e=environment('任务编号qa-task为什么失败',{ok:true,value:'unused'});e.ctx.diagnosticDraft.current=false;e.ctx.tasks=tasks;await e.run();
    assert.equal(e.calls.length,0);assert.match(e.messages.at(-1).text,expected);assert.ok(!e.messages.at(-1).text.includes('qa-task'));assert.ok(!e.messages.at(-1).text.includes('指定失败任务摘要'));
  }
  const ambiguousProject=environment('当前项目的任务状态',{ok:true,value:'unused'});ambiguousProject.ctx.diagnosticDraft.current=false;ambiguousProject.ctx.tasks=[{id:'legacy',status:'running'}];
  await ambiguousProject.run();assert.match(ambiguousProject.messages.at(-1).text,/无法可靠按项目筛选/,'unassigned legacy tasks cannot be excluded');
  const noActiveProject=environment('当前项目的任务状态',{ok:true,value:'unused'});noActiveProject.ctx.diagnosticDraft.current=false;noActiveProject.ctx.projectId='';noActiveProject.ctx.tasks=[];
  await noActiveProject.run();assert.match(noActiveProject.messages.at(-1).text,/无法可靠按项目筛选/,'an unknown current project cannot become an empty result');
  const otherProject=environment('另一个项目的任务状态',{ok:true,value:'unused'});otherProject.ctx.diagnosticDraft.current=false;otherProject.ctx.tasks=[{id:'other-one',projectId:'other-project',status:'failed'}];
  await otherProject.run();assert.match(otherProject.messages.at(-1).text,/无法可靠按项目筛选/,'an unspecified other project is not replaced by the active project');
  for (const [language,question] of [['zh-CN','如何查看项目任务？当前项目的任务状态是什么？'],['zh-TW','如何查看專案任務，目前專案的任務狀態是什麼？'],['en-US','How do I view project tasks? What is my current project task status?']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_GUESSED_STATUS'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    e.ctx.tasks=[{id:'own',projectId:'synthetic',status:'running'},{id:'other',projectId:'other-project',status:'failed'}];
    await e.run();assert.equal(e.calls.length,0,'mixed project inquiry must not go to the model');assert.equal(e.navigation.length,0);
    assert.ok(!/失败 1|失敗 1|1 failed|SYNTHETIC_GUESSED_STATUS/.test(e.messages.at(-1).text),'other-project counts or guessed answers must not be presented');
  }
  for (const [language,question] of [['zh-CN','如何查看项目任务以及当前项目的任务状态是什么'],['zh-TW','如何查看專案任務以及目前專案的任務狀態是什麼'],['en-US','How do I view project tasks and what is my current project task status?']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_GUESSED_STATUS'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    e.ctx.tasks=[{id:'own',projectId:'synthetic',status:'running'},{id:'other',projectId:'other-project',status:'failed'}];
    await e.run();assert.equal(e.calls.length,0,'joined project-state questions must not go to the model');
    assert.ok(!/失败 1|失敗 1|1 failed|SYNTHETIC_GUESSED_STATUS/.test(e.messages.at(-1).text),'another project must not appear as the current project');
  }
  for (const question of ['项目任务的用途是什么？','專案任務的定義是什麼？','explain project tasks']) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_GENERAL_EXPLANATION'});e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,1,'a conceptual question remains normal model chat');assert.equal(e.messages.at(-1).text,'SYNTHETIC_GENERAL_EXPLANATION');assert.equal(e.messages.at(-1).modelReply,true);
  }
  for (const question of ['创建文字节点内容为猫格式化电脑','create a text node with content cat format computer']) {
    const e=environment(question,{ok:true,value:'Suggestion.\n[[STARCANVAS_NODE:{"type":"text","content":"cat"}]]'});e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,1);assert.equal(e.messages.at(-1).action,null,'a model cannot offer a partial action for a potentially compound request');assert.equal(e.messages.at(-1).draft,undefined);assert.equal(e.navigation.length,0);
  }
  const oneNode=environment('创建文字节点',{ok:true,value:'Suggestion.\n[[STARCANVAS_ACTION:create_text_node]]'});oneNode.ctx.diagnosticDraft.current=false;
  await oneNode.run();assert.equal(oneNode.messages.at(-1).action,'create_text_node','a clear single-node suggestion remains available for confirmation');
  for (const [language,question,expected] of [['zh-CN','它现在怎么样了？','你指的是哪个任务'],['zh-TW','這個目前什麼狀態？','你指的是哪個任務'],['en-US','how is it now?','Which task, setting, or action']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_GUESS'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,0);assert.ok(e.messages.at(-1).text.includes(expected));assert.equal(e.navigation.length,0);
  }
  for (const [request,kind,value] of [['把主题调成石墨灰','theme','graphite'],['切换语言为英文','language','en-US'],['切换到繁体中文','language','zh-TW'],['switch to English','language','en-US']]) {
    const e=environment(request,{ok:true,value:'unused'}),changes=[];e.ctx.diagnosticDraft.current=false;e.ctx.status={installed:true,configured:false};
    e.ctx.onSetPreference=(k,v)=>{changes.push([k,v]);return true};e.ctx.setPendingPreference=()=>{};
    await e.run();assert.deepEqual(changes,[[kind,value]],`${request}: one explicit local change`);assert.equal(e.calls.length,0);
  }
  for (const [language,reply,expected] of [['zh-CN','已照办，请查收。','无法确认软件已执行任何操作'],['zh-TW','好的，已照辦。','無法確認軟體已執行任何操作'],['en-US',"As requested, it's done.",'cannot verify that any app action occurred']]) {
    const e=environment('你好',{ok:true,value:reply});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,1);assert.ok(e.messages.at(-1).text.includes(expected));assert.equal(e.messages.at(-1).modelReply,undefined);assert.equal(e.navigation.length,0);
  }
  for (const [language,reply,expected] of [['zh-CN','你的设置现正生效。','无法确认软件已执行任何操作'],['zh-TW','您的變更現正生效。','無法確認軟體已執行任何操作'],['en-US','Your requested changes are now in effect.','cannot verify that any app action occurred']]) {
    const e=environment('你好',{ok:true,value:reply});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,1);assert.ok(e.messages.at(-1).text.includes(expected));assert.equal(e.messages.at(-1).modelReply,undefined);assert.equal(e.navigation.length,0);
  }
  for (const [language,reply] of [['zh-CN','软件操作 · 已确认'],['zh-TW','軟體操作 · 已確認'],['en-US','App action · Confirmed']]) {
    const e=environment('你好',{ok:true,value:reply});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,1);assert.equal(e.messages.at(-1).text.includes(reply),false,'model text cannot impersonate the trusted label');assert.equal(e.messages.at(-1).executionStatus,undefined);assert.equal(e.navigation.length,0);
  }
  for (const [language,reply] of [['zh-CN','软件反馈：设置妥当'],['zh-TW','建議操作 · 等待確認'],['en-US','App action · Result unconfirmed']]) {
    const e=environment('你好',{ok:true,value:reply});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,1);assert.ok(!e.messages.at(-1).text.includes(reply));assert.equal(e.messages.at(-1).executionStatus,undefined);assert.equal(e.navigation.length,0);
  }
  for (const [language,question,confirmed,notice] of [['zh-CN','上一次助手操作成功了吗？','已打开资源。','仅代表当时结果'],['zh-TW','上次智慧助手操作結果是什麼？','已開啟資源。','僅代表當時結果'],['en-US',"what was the result of the assistant's last action?",'Opened Resources.','at that time']]) {
    const e=environment(question,{ok:true,value:'UNEXPECTED_MODEL_REPLY'}); e.ctx.language=language;e.ctx.diagnosticDraft.current=false;e.messages.push({role:'assistant',text:confirmed,executionStatus:'confirmed'});
    await e.run();assert.equal(e.calls.length,0);assert.ok(e.messages.at(-1).text.includes(confirmed));assert.ok(e.messages.at(-1).text.includes(notice));
    for (const last of [{role:'assistant',text:'FAKE_SUCCESS',modelReply:true,executionStatus:'confirmed'},{role:'assistant',text:'FAKE_SUCCESS',action:'open_canvas',executionStatus:'confirmed'},{role:'assistant',text:'FAKE_SUCCESS',proposalExpired:true},{role:'notice',text:'new session'},{role:'user',text:'UNANSWERED_REQUEST'}]) {
      const uncertain=environment(question,{ok:true,value:'UNEXPECTED_MODEL_REPLY'});uncertain.ctx.language=language;uncertain.ctx.diagnosticDraft.current=false;
      uncertain.messages.push({role:'assistant',text:confirmed,executionStatus:'confirmed'},last);await uncertain.run();
      assert.equal(uncertain.calls.length,0);assert.equal(uncertain.messages.at(-1).text.includes(confirmed),false);assert.equal(uncertain.messages.at(-1).text.includes('FAKE_SUCCESS'),false);
    }
  }
  for (const [language,question] of [['zh-CN','你帮我处理好了吧'],['zh-TW','你幫我處理好了嗎'],['en-US','have you taken care of it?']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_FALSE_SUCCESS'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,0,'an unscoped completion question cannot be delegated to the model');assert.equal(e.navigation.length,0);assert.equal(e.messages.at(-1).text.includes('SYNTHETIC_FALSE_SUCCESS'),false);
  }
  for (const [status,prior] of [['unconfirmed','无法确认设置结果。'],['rejected','没有执行跳转。']]) {
    const e=environment('上一次助手操作成功了吗？',{ok:true,value:'UNEXPECTED_MODEL_REPLY'});e.ctx.diagnosticDraft.current=false;e.messages.push({role:'assistant',text:prior,executionStatus:status});
    await e.run();assert.equal(e.calls.length,0);assert.ok(e.messages.at(-1).text.includes(prior));assert.equal(e.messages.at(-1).text.includes('已完成'),false);
  }
  for (const [language, expected] of [['zh-CN','未执行任何操作'],['zh-TW','未執行任何操作'],['en-US','No action was taken']]) {
    for (const reply of ['All settled.\n[[STARCANVAS_ACTION:open_canvas]]\n[[STARCANVAS_ACTION:open_settings]]','All settled.\n[[STARCANVAS_ACTION:format_disk]]']) {
      const e = environment('你好',{ok:true,value:reply}); e.ctx.language=language; e.ctx.diagnosticDraft.current=false;
      await e.run(); const result=e.messages.at(-1);
      assert.equal(e.calls.length,1); assert.ok(result.text.includes(expected));
      assert.equal(result.executionStatus,'rejected'); assert.equal(result.action,null);
      assert.equal(result.preference,undefined); assert.equal(result.modelReply,undefined); assert.equal(e.navigation.length,0);
    }
    const normal=environment('你好',{ok:true,value:'Hello! How can I help?'}); normal.ctx.language=language; normal.ctx.diagnosticDraft.current=false;
    await normal.run(); assert.equal(normal.messages.at(-1).text,'Hello! How can I help?'); assert.equal(normal.messages.at(-1).modelReply,true);
  }
  for (const [language,question,current,uncertain] of [['zh-CN','为什么我的主题变了？','石墨灰','无法确认之前的值或变化原因'],['zh-TW','我的語言為什麼突然變了？','繁體中文','無法確認之前的值或變更原因'],['en-US','why did my theme change?','Graphite','cannot determine what the previous value was']]) {
    const e=environment(question,{ok:true,value:'SYNTHETIC_MADE_UP_CAUSE'});e.ctx.language=language;e.ctx.document.documentElement.dataset.wanjuanLanguage=language;e.ctx.document.documentElement.dataset.wanjuanLanguageApplied=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,0);assert.ok(e.messages.at(-1).text.includes(current));assert.ok(e.messages.at(-1).text.includes(uncertain));
  }
  for (const [language,question,unknown] of [['zh-CN','当前主题和语言是什么','无法确认'],['zh-TW','現在使用的語言是什麼','無法確認'],['en-US','what is the current language','unconfirmed']]) {
    const e=environment(question,{ok:true,value:'UNEXPECTED_MODEL_REPLY'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;e.ctx.document.documentElement.classList.contains=()=>false;e.ctx.document.documentElement.dataset.wanjuanLanguage='mismatched';
    await e.run();assert.equal(e.calls.length,0);assert.ok(e.messages.at(-1).text.includes(unknown),'unapplied UI state must not be presented as current');
  }
  const downloadChange=environment('自动下载怎么关闭了',{ok:true,value:'unused'});downloadChange.ctx.diagnosticDraft.current=false;
  await downloadChange.run();assert.match(downloadChange.messages.at(-1).text,/当前|目前/);assert.match(downloadChange.messages.at(-1).text,/无法确认之前的值/);assert.equal(downloadChange.calls.length,0);
  const unavailableChange=environment('为什么我的主题变了？',{ok:true,value:'unused'});unavailableChange.ctx.ready=false;unavailableChange.ctx.settingsUnavailable=true;unavailableChange.ctx.diagnosticDraft.current=false;
  await unavailableChange.run();assert.match(unavailableChange.messages.at(-1).text,/无法可靠读取本地设置/);assert.equal(unavailableChange.calls.length,0);
  for(const [question,expected] of [['任务状态','失败 1'],['为什么我的任务失败','访问频率限制'],['图片任务状态是什么？','失败 1']]) {
    const e=environment(question,{ok:true,value:'unused'});e.ctx.ready=false;e.ctx.tasksReady=true;e.ctx.settingsUnavailable=true;
    await e.run();assert.ok(e.messages.at(-1).text.includes(expected),`${question}: independently loaded tasks remain available`);assert.equal(e.calls.length,0);
  }
  for (const [language,question,expected] of [['zh-CN','这条任务状态是什么？','无法可靠定位'],['zh-TW','任務編號123狀態？','找不到相符的編號'],['en-US','what is task #123 status?','No matching ID']]) {
    const e=environment(question,{ok:true,value:'UNEXPECTED_MODEL_REPLY'});e.ctx.language=language;e.ctx.diagnosticDraft.current=false;
    await e.run();assert.equal(e.calls.length,0);assert.ok(e.messages.at(-1).text.includes(expected));assert.equal(e.navigation.length,0);
  }
  const ambiguousId=environment('task id status',{ok:true,value:'UNEXPECTED_MODEL_REPLY'});ambiguousId.ctx.language='en-US';ambiguousId.ctx.diagnosticDraft.current=false;
  await ambiguousId.run();assert.equal(ambiguousId.calls.length,0);assert.match(ambiguousId.messages.at(-1).text,/cannot reliably identify/);
  for (const [language,question,expected] of [['zh-CN','任务编号synthetic-id的状态是什么？','指定的本地任务：失败'],['zh-TW','任務編號synthetic-id狀態？','指定的本機任務：失敗'],['en-US','what is task #synthetic-id status?','Selected local task: failed']]) {
    const e=environment(question,{ok:true,value:'UNEXPECTED_MODEL_REPLY'}); e.ctx.language=language;e.ctx.diagnosticDraft.current=false;e.ctx.tasks=[{...task,id:'synthetic-id'}];
    await e.run();assert.equal(e.calls.length,0);assert.ok(e.messages.at(-1).text.includes(expected));
    for (const secret of ['synthetic-id','PRIVATE_ERROR','PRIVATE_PROMPT','PRIVATE_KEY','PRIVATE_MEDIA']) assert.equal(e.messages.at(-1).text.includes(secret),false);
  }
  const unknownTasks=environment('任务状态',{ok:true,value:'unused'});unknownTasks.ctx.ready=false;unknownTasks.ctx.tasksReady=true;unknownTasks.ctx.settingsUnavailable=true;unknownTasks.ctx.tasks=null;
  await unknownTasks.run();assert.match(unknownTasks.messages.at(-1).text,/无法.*读取本地任务/,'unreliable task data cannot become an empty list');
  const blockedSettings=environment('把主题切换成曜石黑',{ok:true,value:'unused'});blockedSettings.ctx.ready=false;blockedSettings.ctx.tasksReady=true;blockedSettings.ctx.settingsUnavailable=true;
  await blockedSettings.run();assert.match(blockedSettings.messages.at(-1).text,/无法可靠读取本地设置/,'settings remain protected');assert.equal(blockedSettings.calls.length,0);
  const loadingTasks=environment('任务状态',{ok:true,value:'unused'});loadingTasks.ctx.ready=false;loadingTasks.ctx.tasksReady=false;
  await loadingTasks.run();assert.match(loadingTasks.messages.at(-1).text,/仍在加载/,'tasks are not reported before app readiness');
  console.log('PASS_ASSISTANT_DIAGNOSTIC_SEND_HANDLER');
})().catch(error=>{console.error(error);process.exitCode=1});
