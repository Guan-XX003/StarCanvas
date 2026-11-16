// Render the real task panel with synthetic records and compare its status
// labels with the assistant's shared classification; no task action is run.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
for(const ext of ['.ts','.tsx']) require.extensions[ext]=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:filename}).outputText,filename);
const {WanJuanGlobalTasksPanel}=require('../src/renderer/components/global-tasks-panel.tsx');
const {classifyAssistantTaskStatus,summarizeAssistantTasks}=require('../src/renderer/lib/assistant-local-operations.ts');
const {subscribeAssistantTaskInspection,requestAssistantTaskInspection}=require('../src/renderer/lib/assistant-task-inspection.ts');
const records=[
  [{id:'qa-pending',status:'pending'},'queued','排队中','排隊中','Queued'],
  [{id:'qa-running',status:'running'},'running','生成中','生成中','Generating'],
  [{id:'qa-done',status:'completed',resultUrl:'synthetic-result'},'completed','已完成','已完成','Completed'],
  [{id:'qa-suno-done',status:'succeeded',resultUrl:'synthetic-result'},'completed','已完成','已完成','Completed'],
  [{id:'qa-suno-stop',status:'stopped'},'stopped','已停止','已停止','Stopped'],
  [{id:'qa-suno-cancelled',status:'cancelled'},'stopped','已停止','已停止','Stopped'],
  [{id:'qa-user-stop',status:'failed',stoppedByUser:true},'stopped','已停止','已停止','Stopped'],
  [{id:'qa-failed',status:'failed'},'failed','失败','失敗','Failed'],
  [{id:'qa-conflict',status:'completed',stoppedByUser:true},'unknown','状态未知','狀態未知','Status unknown'],
  [{id:'qa-merged',status:'completed',stoppedByUser:true,resultUrl:'synthetic-result'},'unknown','状态未知','狀態未知','Status unknown'],
];
const localeSource=fs.readFileSync(require('node:path').join(__dirname,'../src/renderer/lib/i18n-runtime.js'),'utf8');
const localeTree=ts.createSourceFile('i18n-runtime.js',localeSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const packDeclaration=localeTree.statements.flatMap(statement=>ts.isVariableStatement(statement)?[...statement.declarationList.declarations]:[]).find(item=>item.name.getText(localeTree)==='LANGUAGE_PACKS');
assert.ok(packDeclaration?.initializer);const packs=vm.runInNewContext(`(${packDeclaration.initializer.getText(localeTree)})`),deep=require('../src/renderer/lib/i18n-deep-packs.json');
const old=globalThis.wanjuanI18nRuntime;
try {
 for(const language of ['zh-CN','zh-TW','en-US']) {
  globalThis.wanjuanI18nRuntime={t:text=>language==='zh-CN'?text:(deep[language]?.[text]||packs[language]?.[text]||text)};
  for(const [task,status,zh,tw,en] of records) {
   assert.equal(classifyAssistantTaskStatus(task),status);
   const html=renderToStaticMarkup(React.createElement(WanJuanGlobalTasksPanel,{globalTasks:[task],canManualRecoverImageTask:()=>false,canManuallyRefreshGlobalTask:()=>false,handleManualRecoverImageTask:()=>{throw Error('unexpected')},refreshGlobalTask:()=>{throw Error('unexpected')},setIsOpen:()=>{},updateGlobalTasks:()=>{throw Error('unexpected')}}));
   const statusText=(html.match(/class="[^"]*wanjuan-task-status[^\"]*"[^>]*>([^<]*)<\/span>/)||[])[1];
   assert.equal(statusText,language==='en-US'?en:language==='zh-TW'?tw:zh,`${task.id} ${language}`);
   assert.equal(html.includes('wanjuan-task-complete-note'),task.status==='completed' && status==='completed',`${task.id}: only unambiguous completions show the success note`);
   const withAssistant=renderToStaticMarkup(React.createElement(WanJuanGlobalTasksPanel,{globalTasks:[task],onInspectTask:()=>{},canManualRecoverImageTask:()=>false,canManuallyRefreshGlobalTask:()=>false,handleManualRecoverImageTask:()=>{},refreshGlobalTask:()=>{},setIsOpen:()=>{},updateGlobalTasks:()=>{}}));
   const label=language==='en-US'?'Diagnose this task with assistant':language==='zh-TW'?'用助手排查此任務':'用助手排查此任务';
   assert.equal(withAssistant.includes(`aria-label="${label}"`),status==='failed',`${task.id}: only failures have an assistant diagnosis button`);
  }
 }
 const counts=summarizeAssistantTasks(records.map(([task])=>task));
 assert.deepEqual(counts,{queued:1,running:1,completed:2,failed:1,stopped:3,unknown:2});
 assert.equal(requestAssistantTaskInspection('qa-task'),false,'no listener means no silent dismissal');
 const received=[],closed=[];const unsubscribe=subscribeAssistantTaskInspection(id=>received.push(id));
 try {
  assert.equal(requestAssistantTaskInspection(''),false);assert.equal(requestAssistantTaskInspection('x'.repeat(1025)),false);
  const privateHtml=renderToStaticMarkup(React.createElement(WanJuanGlobalTasksPanel,{globalTasks:[{id:'qa-task',status:'failed',createdAt:1,prompt:'设置',errorMsg:'私人任务错误PRIVATE_ERROR'}],canManualRecoverImageTask:()=>false,canManuallyRefreshGlobalTask:()=>false,setIsOpen:()=>{},updateGlobalTasks:()=>{},refreshGlobalTask:()=>{}}));
  assert.match(privateHtml, /<span data-wanjuan-i18n-skip="true" title="设置">设置<\/span>/, 'the prompt text and title are skipped by DOM translation');
  assert.match(privateHtml, /wanjuan-task-error" data-wanjuan-i18n-skip="true">私人任务错误PRIVATE_ERROR<\/div>/, 'raw task errors are skipped by DOM translation');
  const malformedHtml=renderToStaticMarkup(React.createElement(WanJuanGlobalTasksPanel,{globalTasks:[{id:'qa-invalid',status:'failed',createdAt:1,prompt:{content:'PRIVATE_OBJECT'},errorMsg:{message:'PRIVATE_OBJECT_ERROR'}}],canManualRecoverImageTask:()=>false,canManuallyRefreshGlobalTask:()=>false,setIsOpen:()=>{},updateGlobalTasks:()=>{},refreshGlobalTask:()=>{}}));
  assert.doesNotMatch(malformedHtml,/PRIVATE_OBJECT|\[object Object\]/,'a malformed legacy prompt cannot break the panel or expose an object');
  assert.match(malformedHtml,/qa-inval/, 'a safe task label remains visible');
  const panel=WanJuanGlobalTasksPanel({globalTasks:[{id:'qa-task',status:'failed',createdAt:1,prompt:'PRIVATE_PROMPT',errorMsg:'PRIVATE_ERROR'}],canManualRecoverImageTask:()=>false,canManuallyRefreshGlobalTask:()=>false,setIsOpen:value=>closed.push(value),updateGlobalTasks:()=>{throw Error('unexpected')},refreshGlobalTask:()=>{throw Error('unexpected')}});
  const buttons=[];const visit=node=>{if(!node||typeof node!=='object')return;if(node.type==='button')buttons.push(node);for(const child of React.Children.toArray(node.props?.children))visit(child)};visit(panel);
  const button=buttons.find(item=>item.props['aria-label']==='Diagnose this task with assistant');assert.ok(button);button.props.onClick();
  assert.deepEqual(received,['qa-task'],'only the local ID is handed off');assert.deepEqual(closed,[false]);
 }finally{unsubscribe()}
 assert.equal(requestAssistantTaskInspection('qa-task'),false,'unmount removes its listener');
} finally {globalThis.wanjuanI18nRuntime=old;}
console.log('PASS_ASSISTANT_TASK_PANEL_STATUS_CONSISTENCY');
