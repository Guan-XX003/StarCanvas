// Exercise the application's actual task updater and the assistant's local
// summaries together, using only in-memory synthetic task records.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
const {compactGlobalTasks,supersedeActiveNodeTasks}=require('../src/renderer/lib/global-tasks.ts');
const {formatAssistantTaskSummary,selectAssistantCurrentProjectTasks}=require('../src/renderer/lib/assistant-local-operations.ts');
const {buildAssistantLocalDiagnosis,buildAssistantFailureSummary}=require('../src/renderer/lib/assistant-onboarding.ts');
const originalLoad=Module._load;
Module._load=function(name,parent){
 if(parent?.filename.endsWith('use_updateGlobalTasks.ts')&&name==='../lib/app-root-helpers')return {compactGlobalTasks};
 if(parent?.filename.endsWith('use_updateGlobalTasks.ts')&&name==='react')return {};
 return originalLoad.apply(this,arguments);
};
const {use_updateGlobalTasks}=require('../src/renderer/hooks/use_updateGlobalTasks.ts');Module._load=originalLoad;
let tasks=[{id:'synthetic-task',type:'text',status:'pending',createdAt:1,prompt:'SYNTHETIC_PRIVATE_PROMPT'}];
const update=use_updateGlobalTasks({isPluginEnv:false,globalTasks:tasks,setGlobalTasks:updater=>{tasks=updater(tasks)}}).updateGlobalTasks;
try {
 for(const [status,stopped,expected] of [['pending',false,'1 queued'],['running',false,'1 running'],['failed',false,'1 failed'],['completed',false,'1 completed'],['failed',true,'1 stopped']]) {
  update(previous=>previous.map(task=>({...task,status,stoppedByUser:stopped,errorMsg:'HTTP 429 rate limit SYNTHETIC_PRIVATE_ERROR',resultUrl:status==='completed'?'https://synthetic.invalid/private':''})));
  const reply=formatAssistantTaskSummary(tasks,'en-US');assert.ok(reply.includes(expected),`${status} is reported from the updated state`);
  for(const secret of ['SYNTHETIC_PRIVATE_PROMPT','SYNTHETIC_PRIVATE_ERROR','synthetic.invalid'])assert.equal(reply.includes(secret),false);
  if(status==='failed'&&!stopped){const diagnosis=buildAssistantLocalDiagnosis(tasks,'en-US');assert.match(diagnosis,/429/);assert.equal(diagnosis.includes('SYNTHETIC_PRIVATE_ERROR'),false)}
 }
 const superseded=supersedeActiveNodeTasks([{id:'replaced',nodeId:'synthetic-node',type:'image',status:'running',createdAt:1,prompt:'SYNTHETIC_PRIVATE_PROMPT'}],'synthetic-node',2);
 for(const [language,meaning,advice] of [['zh-CN','被同一节点的新任务替代','请查看该节点较新的任务'],['zh-TW','被同一節點的新任務取代','請查看該節點較新的任務'],['en-US','superseded by a newer task','Check the newer task']]){
  const result=buildAssistantLocalDiagnosis(superseded,language);assert.ok(result.includes(meaning));assert.ok(result.includes(advice));assert.equal(result.includes('SYNTHETIC_PRIVATE_PROMPT'),false);assert.ok(buildAssistantFailureSummary(superseded,language).includes('superseded'));
 }
 const staleFlag=[{...superseded[0],errorMsg:'HTTP 429 rate limit SYNTHETIC_PRIVATE_ERROR'}];
 assert.match(buildAssistantLocalDiagnosis(staleFlag,'en-US'),/rate limit/,'a stale superseded flag cannot mask a later failure');
 assert.equal(buildAssistantLocalDiagnosis(staleFlag,'en-US').includes('SYNTHETIC_PRIVATE_ERROR'),false);
 // Use the real update/compaction path and the same projectId field populated
 // by the image/video/text generation hooks; no generation is invoked here.
 update(()=>[{id:'qa-image',projectId:'project-one',nodeId:'node-one',type:'image',status:'failed',createdAt:1,errorMsg:'HTTP 429 PRIVATE_OWN_ERROR',prompt:'PRIVATE_OWN_PROMPT'},
             {id:'qa-video',projectId:'project-two',nodeId:'node-two',type:'video',status:'failed',createdAt:2,errorMsg:'HTTP 401 PRIVATE_OTHER_ERROR'}]);
 const projectTasks=selectAssistantCurrentProjectTasks(tasks,'project-one');assert.ok(projectTasks);assert.equal(projectTasks.length,1);
 const projectDiagnosis=buildAssistantLocalDiagnosis(projectTasks,'en-US');assert.match(projectDiagnosis,/rate limit/);assert.match(projectDiagnosis,/429/);
 for(const hidden of ['PRIVATE_OWN_ERROR','PRIVATE_OWN_PROMPT','PRIVATE_OTHER_ERROR','401','project-two'])assert.equal(projectDiagnosis.includes(hidden),false);
 update(previous=>[...previous,{id:'qa-legacy',nodeId:'node-three',type:'text',status:'failed',errorMsg:'PRIVATE_LEGACY'}]);
 assert.equal(selectAssistantCurrentProjectTasks(tasks,'project-one'),null,'unassigned tasks remain ambiguous after compaction');
 console.log('PASS_ASSISTANT_LIVE_TASK_UPDATES');
}finally{clearTimeout(globalThis.__wanjuanGlobalTasksPersistTimer);delete globalThis.__wanjuanGlobalTasksPersistTimer;}
