const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module,filename) => module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
const {parseAssistantLocalNavigation:nav,isAssistantUnsupportedOperation:unsupported,isAmbiguousAssistantOperation:ambiguousOp,isUnscopedAssistantStatusInquiry:unscoped,isAssistantDeferredOperation:deferred,isAssistantFutureTaskInquiry:futureTask,parseAssistantTaskIntent:task,classifyAssistantTypedDiagnosis:typedDiagnosis,classifyAssistantStateInquiry:inquiry,requiresAssistantLocalStateEvidence:requiresState,assistantProposalMatchesRequest:matches,requiresAssistantOperationReceipt:receipt,summarizeAssistantTasks:summary,formatAssistantTaskSummary:format,formatAssistantTaskCategory:formatCategory,formatAssistantLatestTask:latest,mayOfferAssistantAction:mayOffer,hasUnverifiedAssistantActionClaim:claim,assistantNavigationAllowed:allowed} = require('../src/renderer/lib/assistant-local-operations.ts');
const {buildAssistantLocalDiagnosis:diagnose,buildAssistantTypedDiagnosis:typedResult,parseAssistantReply:reply} = require('../src/renderer/lib/assistant-onboarding.ts');
const {parseAssistantTaskIdQuery:taskIdQuery,formatAssistantTaskById:taskById} = require('../src/renderer/lib/assistant-local-operations.ts');
const {parseAssistantTaskIdDiagnosis:taskIdDiagnosis} = require('../src/renderer/lib/assistant-local-operations.ts');
for (const text of ['任务编号abc-123为什么失败？','為什麼任務編號abc-123失敗？','why did task id abc-123 fail?']) assert.equal(taskIdDiagnosis(text),'abc-123',text);
for (const text of ['如果任务编号abc-123失败怎么办','任务编号abc-123为什么失败并重试','why did task id abc-123 fail and retry','任务编号为什么失败','任务编号abc-123状态']) assert.equal(taskIdDiagnosis(text),null,text);
const {parseAssistantPreferenceIntent:directPreference} = require('../src/renderer/lib/assistant-preferences.ts');
const {assistantNavigationElementVisible:visible} = require('../src/renderer/lib/assistant-local-operations.ts');
const {assistantTaskHydrationAvailable:taskReadAvailable} = require('../src/renderer/lib/assistant-local-operations.ts');
const {assistantSettingsHydrationAvailable:settingsReadAvailable} = require('../src/renderer/lib/assistant-local-operations.ts');
const {assistantNavigationAvailable:navigationAvailable} = require('../src/renderer/lib/assistant-local-operations.ts');
const {formatAssistantSingleTaskProgress:singleProgress} = require('../src/renderer/lib/assistant-local-operations.ts');
const {formatAssistantTypedTaskProgress:typedProgress} = require('../src/renderer/lib/assistant-local-operations.ts');
const {formatAssistantCurrentProjectTasks:projectTasks} = require('../src/renderer/lib/assistant-local-operations.ts');
for (const text of ['帮我检查失败的任务','請幫我檢查失敗的任務','任务失败，请帮我排查','我失败的任务是什么原因','check why my task failed']) assert.equal(task(text),'diagnose',text);
for (const text of ['最近的任务为什么失败','帮我检查失败的任务并重试','任务失败，请帮我排查并删除项目','if my task failed check why']) assert.notEqual(task(text),'diagnose',text);
for (const text of ['我刚才生成的视频为什么失败？','我生成的图片为什么失败？','我剛才產生的影片為什麼失敗？','why did my generated video fail?']) assert.equal(typedDiagnosis(text),'specific',text);
for (const text of ['为什么视频没生成成功？','如果我生成的视频失败怎么办','我生成的视频为什么失败并重试','why might a generated video fail?']) assert.equal(typedDiagnosis(text),null,text);
for (const text of ['我的生成还要多久？','我的任务还要多久？','我的影片任務還要多久？','how long will my generation take?']) assert.equal(inquiry(text),'indeterminate_task_eta',text);
for (const text of ['我的任务现在进度是多少？','我的任務跑到哪一步了？','what is my task progress?']) assert.equal(inquiry(text),'single_task_progress',text);
for(const [text,expected] of [['我的视频任务现在进度多少？','task_progress_video'],['我的圖片任務進度是多少？','task_progress_image'],['what is my audio task progress?','task_progress_audio']]) assert.equal(inquiry(text),expected,text);
for (const language of ['zh-CN','zh-TW','en-US']) {
  const result=singleProgress([{status:'running',progress:42,prompt:'PRIVATE_PROMPT',errorMsg:'PRIVATE_ERROR',resultUrl:'PRIVATE_URL'}],language);
  assert.match(result,/42%/);assert.doesNotMatch(result,/PRIVATE_/);
  for(const bad of [-1,101,NaN,Infinity,'42',null]) assert.doesNotMatch(singleProgress([{status:'running',progress:bad}],language),/42%|101%|-1%/);
  assert.doesNotMatch(singleProgress([{status:'running',progress:42},{status:'failed'}],language),/42%/,'multiple tasks cannot be silently narrowed');
  assert.doesNotMatch(singleProgress([{status:'failed',progress:42}],language),/42%/,'a failed task is not reported as running progress');
}
for(const language of ['zh-CN','zh-TW','en-US']) {
 const records=[{type:'video',status:'running',progress:42,prompt:'PRIVATE_PROMPT'},{type:'image',status:'running',progress:88}];
 const output=typedProgress(records,'video',language);assert.match(output,/42%/);assert.doesNotMatch(output,/88%|PRIVATE_PROMPT/);
 assert.doesNotMatch(typedProgress([...records,{status:'running',progress:99}],'video',language),/42%|99%/,'unknown task type prevents guessing');
 assert.doesNotMatch(typedProgress([...records,{type:'video',status:'running',progress:99}],'video',language),/42%|99%/,'multiple matching tasks prevent guessing');
 assert.doesNotMatch(typedProgress([{type:'image',status:'running',progress:88}],'video',language),/88%/,'a different type cannot answer the query');
}
for(const [language,text] of [['zh-CN','当前项目的任务进度是多少？'],['zh-TW','目前專案的任務進度是多少？'],['en-US','what is the current project task progress?']]) {
 const tasks=[{projectId:'p1',type:'video',status:'running',progress:42,prompt:'PRIVATE_PROMPT'},{projectId:'p2',type:'video',status:'running',progress:88}];
 const output=projectTasks(tasks,'p1',text,language);assert.match(output,/42%/);assert.doesNotMatch(output,/88%|PRIVATE_PROMPT/);
 assert.equal(projectTasks([...tasks,{type:'video',status:'running',progress:99}],'p1',text,language),null,'unassigned task blocks project scoping');
 assert.doesNotMatch(projectTasks([...tasks,{projectId:'p1',type:'image',status:'running',progress:99}],'p1',text,language),/42%|99%/,'multiple project tasks remain ambiguous');
}
assert.match(projectTasks([{projectId:'p1',type:'video',status:'running',progress:42},{projectId:'p1',type:'image',status:'running',progress:88}],'p1','当前项目的视频任务进度是多少？','zh-CN'),/42%/);
assert.equal(projectTasks([{projectId:'p1',type:'video',status:'running',progress:42}],'p1','当前项目的任务进度是多少并重试','zh-CN'),null,'compound request must not be reduced to a progress query');
for (const text of ['我刚才生成的视频到哪一步了？','我剛才產生的影片到哪一步了？']) assert.equal(inquiry(text),'specific_task',text);
for (const text of ['任务还要多久并重试','如果我的任务还要多久','how long will my generation take and retry']) assert.notEqual(inquiry(text),'indeterminate_task_eta',text);
for (const text of ['创建文字节点内容为猫并发短信','创建文字节点内容为猫并发邮件','建立文字節點內容為貓並發郵件','创建文字节点内容为猫并发布帖子','create a text node with content cat and send an email']) {
  assert.equal(mayOffer(text),false,`a compound send or publish request must not produce a partial proposal: ${text}`);
  assert.equal(matches(text,{action:'create_text_node'}),false);
}
for (const text of ['创建文字节点内容为猫并发短信','建立文字節點內容為貓並發郵件','创建文字节点内容为猫并发布帖子']) assert.equal(ambiguousOp(text),true,'recognized compound request asks for clarification locally');
for (const text of ['创建文字节点内容为猫再注销账号','建立文字節點內容為貓再登出帳號','create a text node with content cat then log out']) {
  assert.equal(mayOffer(text),false,`${text}: a sequenced account operation cannot become a partial node suggestion`);
  assert.equal(matches(text,{action:'create_text_node'}),false);assert.equal(ambiguousOp(text),true);
}
assert.equal(mayOffer('创建文字节点内容为再见'),true,'ordinary literal wording is not treated as a second operation');
assert.equal(ambiguousOp('什么是并发消息'),false,'ordinary explanations are not treated as operations');
assert.equal(mayOffer('创建文字节点内容为并发控制'),true,'ordinary concurrency wording is not itself a send action');
for (const question of ['现在我的任务怎么样','我的任务怎么了？','目前我的任務怎麼樣','how are my tasks doing?','how are the tasks going?']) assert.equal(task(question),'summary',question);
for (const question of ['这个任务怎么样','如果我的任务怎么了','我的任务怎么样然后删除项目','how are my tasks doing and delete projects']) assert.equal(task(question),null,question);
for (const [question,expected] of [['最近的任务怎么样','latest_task'],['最近的任務怎麼樣','latest_task'],['这个任务怎么样','specific_task'],['這個任務怎麼樣','specific_task'],['上一次任务怎么样','specific_task']]) assert.equal(inquiry(question),expected,question);
for (const question of ['怎么查看任务状态','最近的任务怎么样然后删除项目','如果最近的任务怎么样']) assert.equal(inquiry(question),null,question);
for (const [text,destination] of [['打开画布吧','canvas'],['請幫我打開設定一下','settings'],['打开账号设置一下吧','account'],['open canvas please','canvas']]) assert.equal(nav(text),destination,text);
for (const text of ['打开画布吧然后删除项目','不要打开画布吧','打开画布吧？','open canvas please and delete projects']) assert.equal(nav(text),null,text);
const {classifyAssistantSettingChangeQuestion:settingChangeQuestion} = require('../src/renderer/lib/assistant-local-operations.ts');
const {isAssistantProjectTaskInquiry:projectTaskInquiry} = require('../src/renderer/lib/assistant-local-operations.ts');
const {parseAssistantCurrentProjectDiagnosis:projectDiagnosis} = require('../src/renderer/lib/assistant-local-operations.ts');
for (const text of ['当前项目的任务为什么失败','為什麼目前專案任務失敗','why did the current project tasks fail?']) assert.equal(projectDiagnosis(text),'all',text);
for (const [text,type] of [['当前项目的视频任务为什么失败','video'],['為什麼目前專案圖片任務失敗','image'],['why did this project audio tasks fail?','audio'],['当前项目的文本任务为什么失败','text']]) assert.equal(projectDiagnosis(text),type,text);
for (const text of ['如果当前项目的任务失败怎么办','当前项目的图片视频任务为什么失败','另一个项目的任务为什么失败','当前项目的任务为什么失败并重试','why did this project task fail and retry','当前项目的音乐任务为什么失败']) assert.equal(projectDiagnosis(text),null,text);
for (const text of ['当前项目的任务状态','這個專案的影片任務為什麼失敗','current project task status','why did this project task fail?']) assert.equal(projectTaskInquiry(text),true,text);
for (const text of ['如何查看项目任务？当前项目的任务状态是什么？','如何查看專案任務，目前專案的任務狀態是什麼？','How do I view project tasks? What is my current project task status?']) assert.equal(projectTaskInquiry(text),true,text);
for (const text of ['如何查看项目任务以及当前项目的任务状态是什么','如何查看專案任務以及目前專案的任務狀態是什麼','How do I view project tasks and what is my current project task status?']) assert.equal(projectTaskInquiry(text),true,text);
for (const text of ['任务状态','当前项目名称','如何查看项目任务','什么是项目任务','项目任务的用途是什么？','專案任務的定義是什麼？','explain project tasks','what is the purpose of project tasks?','how do I view project tasks?']) assert.equal(projectTaskInquiry(text),false,text);
for (const [text,kind] of [['为什么我的主题变了？','preferences'],['我的語言為什麼突然變了？','preferences'],['自动下载怎么关闭了','download'],['why did my theme change?','preferences'],['why is my language different?','preferences'],['why has my auto-download changed?','download']]) assert.equal(settingChangeQuestion(text),kind,text);
for (const text of ['为什么主题没有变','如何改变我的主题','如果我的主题变了怎么办','为什么我的主题变了，打开设置','why did my theme change and delete files','why did the stock price change?','']) assert.equal(settingChangeQuestion(text),null,text);
for (const target of ['canvas','resources','agents','workspace','settings','account','appearance','api','models','generation']) {
  assert.equal(navigationAvailable(target,true,true),true,target);
  assert.equal(navigationAvailable(target,false,true),false,target);
  assert.equal(navigationAvailable(target,true,false),['canvas','resources','agents','workspace'].includes(target),target);
}
for (const target of ['__proto__','constructor','',null,undefined]) assert.equal(navigationAvailable(target,true,true),false);
assert.equal(settingsReadAvailable({},null,true),true,'missing fields are defaults after a reliable read');
assert.equal(settingsReadAvailable({apiConfigs:[]},null,false),false,'fallback cannot justify seeding defaults');
assert.equal(settingsReadAvailable({},new Error('synthetic storage error')),false);
for(const value of [null,undefined,[],false]) assert.equal(settingsReadAvailable(value,null,true),false,'invalid settings response is not hydrated');
const {isAssistantMixedHowToAction:mixedHowTo} = require('../src/renderer/lib/assistant-local-operations.ts');
for (const text of ['如何打开设置？帮我打开','怎麼切換主題？請你改好','how do I switch the theme, and then open settings','how to open settings? could you open it']) assert.equal(mixedHowTo(text),true,text);
for (const text of ['如何查看任务状态？我的任务失败了吗？','怎麼查看任務狀態？我的任務失敗了嗎？','如何查看任务状态以及当前任务状态是什么','How do I view tasks? What is my current task status?','How do I switch themes and what is my current theme?']) assert.equal(mixedHowTo(text),true,text);
for (const text of ['如何打开设置？','怎么直接打开设置？','怎么帮我学习使用这个软件？','how do I change the theme?','how can I open settings?','how do I find generation and downloads?','帮我打开设置']) assert.equal(mixedHowTo(text),false,text);
for (const text of ['如何查看任务状态？','How do I switch theme and language?','how do I check my current task status?']) assert.equal(mixedHowTo(text),false,'a standalone instructional question remains chat');
assert.equal(taskReadAvailable({},null),true,'missing key on successful read means no saved tasks');
assert.equal(taskReadAvailable({globalTasks:[]},null),true);
assert.equal(taskReadAvailable({},null,false),false,'fallback is not proof of an empty task list');
assert.equal(taskReadAvailable({globalTasks:[]},null,false),false,'fallback task values are not authoritative');
assert.equal(taskReadAvailable({globalTasks:[]},null,true),true);
assert.equal(taskReadAvailable({globalTasks:[{id:'synthetic-task',status:'running'}]},null),true);
for(const value of [null,undefined,[],{globalTasks:null},{globalTasks:'bad'},{globalTasks:{status:'failed'}},{globalTasks:[null]},{globalTasks:[{status:'failed'}]},{globalTasks:[{id:'   ',status:'failed'}]},{globalTasks:[{id:'good'},'bad']}]) assert.equal(taskReadAvailable(value,null),false,'failed or malformed read is not an empty task list');
assert.equal(taskReadAvailable({globalTasks:[]},{message:'synthetic error'}),false,'a storage error cannot prove an empty task list');
const previousComputedStyle=global.getComputedStyle;
try {
  global.getComputedStyle=element=>element.style;
  const shown=()=>({display:'block',visibility:'visible',opacity:'1',contentVisibility:'visible'});
  const rect=(left,top,right,bottom)=>({left,top,right,bottom,width:right-left,height:bottom-top});
  const parent={parentElement:null,style:shown(),getBoundingClientRect:()=>rect(0,0,300,200)};
  const content={},overlay={};const doc={defaultView:{innerWidth:800,innerHeight:600},elementFromPoint:()=>content};
  const child={isConnected:true,parentElement:parent,style:shown(),ownerDocument:doc,contains:hit=>hit===content,getBoundingClientRect:()=>rect(10,10,210,110)};
  assert.equal(visible(child),true);
  doc.elementFromPoint=()=>overlay;assert.equal(visible(child),false,'a fully covered page cannot confirm navigation');
  doc.elementFromPoint=(x,y)=>x<50&&y<50?content:overlay;assert.equal(visible(child),true,'a partially uncovered target is detectable');
  doc.elementFromPoint=()=>null;assert.equal(visible(child),false,'missing hit-test results cannot confirm navigation');doc.elementFromPoint=()=>content;
  for(const [property,value] of [['display','none'],['visibility','hidden'],['opacity','0'],['contentVisibility','hidden']]) {
    parent.style[property]=value;assert.equal(visible(child),false,`hidden parent ${property}`);parent.style=shown();
    child.style[property]=value;assert.equal(visible(child),false,`hidden target ${property}`);child.style=shown();
  }
  assert.equal(visible({...child,isConnected:false}),false);
  assert.equal(visible({...child,getBoundingClientRect:()=>({width:0,height:100})}),false);
  assert.equal(visible({...child,getBoundingClientRect:()=>rect(810,10,900,100)}),false,'a page outside the window cannot confirm navigation');
  parent.style.overflowX='hidden';
  assert.equal(visible({...child,getBoundingClientRect:()=>rect(310,10,400,100)}),false,'a page clipped by an ancestor cannot confirm navigation');
  assert.equal(visible({...child,getBoundingClientRect:()=>rect(290,10,400,100)}),true,'a partially visible page remains detectable');
  assert.equal(visible(null),false);
} finally {global.getComputedStyle=previousComputedStyle;}
const {compactGlobalTasks,updateTaskRunningProgress,failGlobalTaskRefresh} = require('../src/renderer/lib/global-tasks.ts');
// Names are taken from the real navigation and settings labels, not a second
// handwritten translation. Every supported visible destination must work.
const source=fs.readFileSync(require('node:path').join(__dirname,'../src/renderer/lib/i18n-runtime.js'),'utf8');
const ast=ts.createSourceFile('i18n-runtime.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const packsDeclaration=ast.statements.flatMap(statement=>ts.isVariableStatement(statement)?[...statement.declarationList.declarations]:[]).find(item=>item.name.getText(ast)==='LANGUAGE_PACKS');
assert.ok(packsDeclaration?.initializer,'navigation translations exist');
const packs=require('node:vm').runInNewContext(`(${packsDeclaration.initializer.getText(ast)})`);
for (const [label,target] of [['画布','canvas'],['资源','resources'],['智能体','agents'],['工作空间','workspace'],['设置','settings'],['我的账号','account'],['外观与通用','appearance'],['API 配置','api'],['模型配置','models'],['生成与下载','generation']]) for (const locale of ['zh-CN','zh-TW','en-US']) {
  const displayed=locale==='zh-CN'?label:packs[locale][label];
  assert.equal(typeof displayed,'string',`${locale} ${label} translation`);
  assert.equal(nav(locale==='en-US'?`open ${displayed}`:`打开${displayed}`),target,`${locale} ${displayed} navigation`);
}
for (const [text, target] of [['打开画布','canvas'],['請打開資源','resources'],['打开智能体','agents'],['打开工作空间','workspace'],['打开设置','settings'],['打开账号设置','account'],['打开外观设置','appearance'],['打开API配置','api'],['打开模型设置','models'],['打开生成与下载','generation'],['open the canvas page','canvas'],['go to generation settings','generation']]) assert.equal(nav(text),target,text);
for (const [text,target] of [['去画布','canvas'],['回到畫布','canvas'],['请去我的账号','account'],['回到工作空间','workspace'],['go back to canvas','canvas']]) assert.equal(nav(text),target,text);
for (const text of ['不要打开设置','如何打开设置','可以打开设置吗？','打开设置和删除项目','打开账号设置;删除','打开设置\n删除','打开__proto__','打开模型','']) assert.equal(nav(text),null,text);
for (const text of ['帮我改一下','请帮我调整一下','打开它','把这个改一下','切换语言','幫我切換語言','把主題改一下','带我去','帶我去那裡','前往','我想去','take me there','could you take me to?','please go to','please change it','could you switch the language?','open']) assert.equal(ambiguousOp(text),true,text);
for (const text of ['把主题改成石墨灰','打开设置','带我去我的账号','take me to my account','当前语言是什么','不要打开它','如果切换语言会怎样','能帮我打开生成与下载吗','why did my task fail?','hello']) assert.equal(ambiguousOp(text),false,text);
for (const text of ['把主题切换成石墨灰或曜石黑','把主题改成深色还是浅色','將語言切換為繁體中文還是英文','switch the theme to graphite or obsidian','change the theme to dark or light','change the language to English or traditional Chinese']) {
  assert.equal(ambiguousOp(text),true,`${text}: two alternatives require clarification`);
  assert.equal(mayOffer(text),false,`${text}: the model may not select an alternative`);
}
for (const text of ['石墨灰和曜石黑主题有什么区别','which theme should I choose, graphite or obsidian?','把语言改成繁體中文','switch the theme to graphite']) assert.equal(ambiguousOp(text),false,`${text}: ordinary discussion or a single target is not ambiguous`);
for (const text of ['失败了吗？','為什麼失敗了？','这个成功了吗','完成了吗','它是什么状态','它现在怎么样了？','這個目前什麼狀態？','它怎麼樣了','how is it now?','what is its current status?','did it fail?','is it done?','why did that fail?']) assert.equal(unscoped(text),true,text);
for (const text of ['你帮我处理好了吧','你幫我處理好了嗎','您已经帮我搞定了吗','have you taken care of it?','did you finish it?']) assert.equal(unscoped(text),true,text);
for (const text of ['任务失败了吗','为什么图片任务失败了','打开设置','失败是什么意思','失败了吗，打开设置','hello']) assert.equal(unscoped(text),false,text);
assert.equal(allowed('api',{connected:true,mode:'client'}),false); assert.equal(allowed('models',{connected:true,mode:'client'}),false); assert.equal(allowed('account',{connected:true,mode:'client'}),true); assert.equal(allowed('api',{connected:true,mode:'host'}),true); assert.equal(allowed('__proto__',null),false);
for (const tab of ['api','models']) { assert.equal(allowed(tab,{connected:true,mode:'member'}),false,`managed ${tab} cannot bypass sidebar restriction`); assert.equal(allowed(tab,{connected:false,mode:'member'}),true,`disconnected ${tab} remains available`); }
for (const text of ['任务状态','查看我的任务情况','任务进行中','有多少任务失败','有没有失败的任务','最近有哪些失败任务','我有正在运行中的任务吗','我的任务完成了吗','任務結束了嗎','查看我正在运行中的任务','看看已完成的任务','我的失败任务','查看正在進行中的任務','看看已完成的任務','有沒有失敗的任務','show my task status','show running tasks','how many tasks are running','how many tasks failed','how many of my tasks have stopped','are there any failed tasks','do i have running tasks']) assert.equal(task(text),'summary',text);
for (const text of ['排查最近失败任务','幫我診斷最新失敗任務','为什么任务失败了','为什么我的任务失败了？','我的任务为什么会失败','為什麼我的任務失敗了','任務為何失敗','why did my task fail?','why has the task failed','why is my task failing','diagnose my latest failed task']) assert.equal(task(text),'diagnose',text);
for (const [text,kind] of [['为什么我的视频任务失败了','video'],['视频任务为啥失败','video'],['圖片任務失敗是什麼原因','image'],['為何圖片任務失敗','image'],['why did my video task fail?','video'],['what caused my video task failure?','video'],['诊断音频任务失败','audio'],['排查文字任务报错','text'],['为什么这个视频任务失败了','specific'],['为什么第一个视频任务失败了','specific'],['视频任务123为什么失败','specific'],['why did video task 123 fail?','specific'],['为什么图片和视频任务失败了','ambiguous'],['为什么音乐任务失败了','unsupported_music']]) assert.equal(typedDiagnosis(text),kind,text);
for (const text of ['如果视频任务失败怎么办','明天为什么视频任务失败','下次為何圖片任務失敗','why will the video task fail tomorrow?','为什么视频任务失败并重新生成','不要诊断视频任务失败','为什么视频任务没有失败','为什么我的任务失败了','视频任务状态','为什么图片好看']) assert.equal(typedDiagnosis(text),null,text);
for (const text of ['重试失败任务','删除任务','任务状态并重新生成','查看我的失败任务并重新生成','为什么任务失败了并重试','为什么视频任务失败了','这次任务为什么失败了','如果任务失败了怎么办','任务状态;生成','do not show tasks']) assert.equal(task(text),null,text);
for (const [text,kind] of [['这个软件目前用什么主题？','preferences'],['這個軟體目前的語言是什麼？','preferences'],['which theme am i using right now?','preferences'],['目前的自动下载状态如何？','download'],['are any of my tasks still running?','tasks'],['我现在有哪些失败任务？','tasks'],['上一个任务完成了吗？','specific_task'],['上一次任务完成了吗？','specific_task'],['上一個任務完成了嗎？','specific_task'],['is the previous task completed?','specific_task'],['最近生成的任务完成了吗？','latest_task'],['最新任务状态是什么？','latest_task'],['is the latest task completed?','latest_task'],['check latest task status','latest_task'],['最近的失败任务状态是什么？','specific_task'],['這次任務的狀態是什麼？','specific_task'],['is this task completed?','specific_task'],['视频生成好了吗？','specific_task'],['这次图片出结果了吗？','specific_task'],['任务和主题现在是什么状态？','ambiguous'],['这个失败任务用的模型是什么？','unsupported']]) assert.equal(inquiry(text),kind,text);
for (const [text,kind] of [['我的视频任务状态','tasks_video'],['影片任務狀態如何？','tasks_video'],['show my video tasks','tasks_video'],['图片任务状态','tasks_image'],['我的音频任务状态','tasks_audio'],['文字任务状态','tasks_text'],['这个视频任务状态','specific_task'],['最新视频任务状态','specific_task'],['this video task status','specific_task'],['图片和视频任务状态','ambiguous_task_types'],['音乐任务状态','unsupported_music']]) assert.equal(inquiry(text),kind,text);
for (const text of ['这条任务状态是什么？','那個任務狀態是什麼？','第一个任务完成了吗？','第2條影片任務狀態？','任务编号123的状态是什么？','任務編號123狀態？','what is task #123 status?','what is task ID 123 status?','is the first task completed?']) assert.equal(inquiry(text),'specific_task',text);
for (const text of ['任务状态是什么？','我的视频任务状态','how many tasks are running?']) assert.notEqual(inquiry(text),'specific_task',text);
for (const text of ['任务编号abc-123的状态是什么？','任務編號abc-123狀態？','what is task #abc-123 status?','status of task id abc-123']) assert.equal(taskIdQuery(text),'abc-123',text);
assert.equal(taskIdQuery('what is task #status status?'),'status','status remains a valid ID when explicitly supplied');
for (const text of ['任务编号abc-123状态然后删除项目','不要查询任务编号abc-123状态','任务编号abc-123失败了吗','task #abc-123 status and delete data','what is task status?','task id status','what is task #status']) assert.equal(taskIdQuery(text),null,text);
for (const [status,expected] of [['pending','排队中'],['running','进行中'],['completed','已完成'],['failed','失败'],['stopped','已停止'],['bad','状态未知']]) {
 const output=taskById([{id:'abc-123',status,prompt:'PRIVATE_PROMPT',errorMsg:'PRIVATE_ERROR',resultUrl:'PRIVATE_URL'}],'abc-123','zh-CN');
 assert.ok(output.includes(expected));for(const secret of ['abc-123','PRIVATE_PROMPT','PRIVATE_ERROR','PRIVATE_URL']) assert.equal(output.includes(secret),false);
}
for(const [language,notice] of [['zh-CN','可能不是最新状态'],['zh-TW','可能不是最新狀態'],['en-US','may be out of date']]) {
 const records=[{id:'fixture',status:'running'}];assert.ok(format(records,language).includes(notice));assert.ok(taskById(records,'fixture',language).includes(notice));assert.ok(latest(records,language).includes(notice));
}
assert.match(taskById([{id:'a',status:'running'}],'b','en-US'),/No matching/);
assert.match(taskById([{id:'a'},{id:'a'}],'a','zh-TW'),/多筆/);
assert.match(taskById([{status:'failed'}],'a','zh-CN'),/无法读取/);
for (const [text,kind] of [['查看我的模型生成任务状态','tasks'],['我的視頻模型任務狀態','tasks_video'],['show my model task status','tasks'],['我的视频模型任务状态','tasks_video'],['这个任务使用的模型是什么','unsupported'],['what model did my task use?','unsupported'],['show my task model','unsupported'],['我的可灵视频模型任务状态','unsupported'],['show my alpha model task status','unsupported']]) assert.equal(inquiry(text),kind,text);
assert.equal(typedDiagnosis('为什么我的可灵视频模型任务失败了'),'model_scope','do not present all video failures as belonging to one model');
for (const text of ['帮我看下任务','看看任务','有几个任务在运行','幫我看一下任務','有幾個任務正在運行','请查询任务']) assert.equal(inquiry(text),'tasks',text);
for (const [text,kind] of [['任务跑完了没','tasks'],['完成任务没？','tasks'],['我的視頻任務跑完了沒','tasks_video'],['这个任务跑完了没','specific_task'],['這次任務結束沒','specific_task']]) assert.equal(inquiry(text),kind,text);
for (const text of ['如何切换主题？','如果任务失败怎么办？','明天任务状态是什么','what will the task status be tomorrow?','请切换主题','能否帮我关闭自动下载？','can you enable auto downloads?','删除失败任务并查询状态','帮我看下任务，清理项目','show video tasks and open settings','任务状态并打开设置','这个主题和那个有什么区别？','不要查看任务状态','不想看当前主题状态','別查任務狀態',"don't check my task status",'任务状态;生成视频','你好']) assert.equal(inquiry(text),null,text);
for (const text of ['不要打开设置','不打开设置','不是要打开设置','不想打开设置','如果打开设置会怎样','明天把主题换成石墨灰','稍後打開設定','等我回来打开设置','下个月切换主题','open settings tomorrow','open settings in 5 minutes','switch the theme to graphite next week','打开设置然后删除项目','打开设置再删掉项目','打开设置再切换主题','打开设置，选择下载目录','打开设置，复制密钥','open settings and select a folder','open settings and copy the key','show video tasks and open settings','查询任务状态，打开设置','打开生成设置并生成视频','关闭生成结果自动下载并生成视频','把主题改成石墨灰并关闭自动下载','open canvas and close settings','turn on auto downloads and open canvas','go to canvas and close settings','open settings and then delete data', '打开画布并切换主题','don\u2019t open settings',"don't open settings", "can't open settings",'no need to open settings','你好']) assert.equal(mayOffer(text),false,text);
for (const text of ['请帮我打开设置','能帮我打开生成与下载吗','能帮我打开生成设置吗','能帮我关闭生成结果自动下载吗','可以打開生成設定嗎','可以關閉生成結果自動下載嗎','please open generation settings','创建一个文字节点']) assert.equal(mayOffer(text),true,text);
for (const text of ['创建文字节点内容为猫格式化电脑','建立文字節點內容為貓解除安裝軟體','create a text node with content cat format computer','create a text node with content cat execute code','create a text node with content cat run the shell command']) {
  assert.equal(mayOffer(text),false,`a second dangerous operation cannot become a partial proposal: ${text}`);
  assert.equal(matches(text,{action:'create_text_node'}),false,text);
}
const ordinaryRunningText='create a text node with content horses run across the meadow';
assert.equal(mayOffer(ordinaryRunningText),true,'ordinary creative text containing run is not a command to execute code');
assert.equal(matches(ordinaryRunningText,{action:'create_text_node'}),true,'a safe text draft may still be offered for explicit confirmation');
for (const text of ['带我去我的账号','帶我去我的帳號','我想去看看我的账户','前往我的账号吗','take me to my account','I want to go to my account']) {
  assert.equal(nav(text),null,`${text}: inferred wording requires confirmation`);
  assert.equal(mayOffer(text),true,text);
  assert.equal(matches(text,{action:'open_account_settings'}),true,text);
  assert.equal(matches(text,{action:'open_api_settings'}),false,`${text}: cannot substitute another destination`);
}
for (const [label,action] of [['画布','open_canvas'],['资源','open_resources'],['智能体','open_agents'],['工作空间','open_workspace'],['设置','open_settings'],['我的账号','open_account_settings'],['外观设置','open_appearance_settings'],['API配置','open_api_settings'],['模型配置','open_model_settings'],['生成与下载','open_generation_settings']]) assert.equal(matches(`带我去${label}`,{action}),true,`colloquial navigation to ${label}`);
for (const text of ['不要带我去我的账号','带我去我的账号然后删除项目','带我去我的账号格式化电脑','take me to my account and delete data','I want to go to my account wipe disk']) assert.equal(matches(text,{action:'open_account_settings'}),false,text);
for (const text of ['打开画布，清理所有项目','打开画布，给我卸载软件','幫我打開畫布，順便整理專案','打开画布，导出项目','打开画布，移除项目','打开画布，修复配置','open canvas, uninstall the app','open canvas and purge files','open canvas and explain the settings','open canvas plus archive files']) {
  assert.equal(mayOffer(text),false,`${text}: multiple operations cannot yield a partial suggestion`);
  assert.equal(matches(text,{action:'open_canvas'}),false,text);
}
for (const text of ['打开画布格式化电脑','打開畫布格式化電腦','open canvas format computer','打开画布关闭电源','open canvas wipe disk']) assert.equal(matches(text,{action:'open_canvas'}),false,`${text}: an unparsed remainder must not authorize a partial navigation`);
for (const text of ['可以把主题换成深色格式化电脑吗','switch theme to dark format computer','可以把语言改成英文清空电腦吗','格式化电脑把主题换成深色','format computer switch theme to dark']) assert.equal(matches(text,{preference:text.includes('语言')?{kind:'language',value:'en-US'}:{kind:'theme',value:'dark'}}),false,`${text}: an unparsed remainder must not authorize a partial preference`);
for (const text of ['开启自动下载格式化电脑','turn on auto downloads wipe disk']) assert.equal(matches(text,{preference:{kind:'autoDownload',value:true}}),false,`${text}: an unparsed remainder must not authorize a partial toggle`);
for (const text of ['创建一个文字节点格式化电脑','create a text node wipe disk']) assert.equal(matches(text,{action:'create_text_node'}),false,`${text}: an unparsed remainder must not authorize a partial node creation`);
for (const [text,action] of [['创建一个文字节点内容是你好','create_text_node'],['create a text node with content hello','create_text_node'],['建立一個視頻節點','create_video_node']]) assert.equal(matches(text,{action}),true,text);
assert.equal(mayOffer('open generation and downloads'),true,'the single settings label is not two actions');
assert.equal(matches('open generation and downloads',{action:'open_generation_settings'}),true);
for (const text of ['你好，能帮我打开画布吗','打开画布，谢谢','hello, could you open canvas?','open canvas, thanks']) assert.equal(matches(text,{action:'open_canvas'}),true,`${text}: courtesy is not another action`);
for (const [text,proposal] of [['能帮我打开生成与下载吗',{action:'open_generation_settings'}],['could you open model settings?',{action:'open_model_settings'}],['创建一个文字节点',{action:'create_text_node'}],['把主题换成石墨灰',{preference:{kind:'theme',value:'graphite'}}],['把石墨灰主题换成深色',{preference:{kind:'theme',value:'dark'}}],['帮我把主题调成深色',{preference:{kind:'theme',value:'dark'}}],['switch the theme from graphite to dark',{preference:{kind:'theme',value:'dark'}}],['可以把主题换成深色吗？',{preference:{kind:'theme',value:'dark'}}],['can you switch the theme to light mode?',{preference:{kind:'theme',value:'light'}}],['切换成繁體中文',{preference:{kind:'language',value:'zh-TW'}}],['开启自动下载',{preference:{kind:'autoDownload',value:true}}]]) assert.equal(matches(text,proposal),true,text);
for (const [text,value] of [['把主题调暗一点','dark'],['把主題調亮一點','light'],['能帮我把主题变深一些吗','dark'],['make my theme darker','dark'],['could you make the appearance a bit lighter?','light']]) {
  assert.equal(directPreference(text),null,`${text}: comparative request needs confirmation`);
  assert.equal(mayOffer(text),true,text);
  assert.equal(matches(text,{preference:{kind:'theme',value}}),true,text);
  assert.equal(matches(text,{preference:{kind:'theme',value:value==='dark'?'light':'dark'}}),false,`${text}: opposite direction is refused`);
}
for (const text of ['不要把主题调暗一点','如果把主题调暗一点会怎样','把主题调暗一点然后删除项目','把主题调暗一点格式化电脑','make my theme darker wipe disk']) assert.equal(matches(text,{preference:{kind:'theme',value:'dark'}}),false,text);
for (const [input,value] of [['可以把主题换成石墨灰吗？',{kind:'theme',value:'graphite'}],['可以把主题换成深色吗？',{kind:'theme',value:'dark'}],['可以切换成英文吗？',{kind:'language',value:'en-US'}],['能帮我关闭生成结果自动下载吗',{kind:'autoDownload',value:false}]]) {
  assert.equal(directPreference(input),null,`${input}: inferred request cannot execute as a direct command`);
  const parsed=reply(`Please confirm.\n[[STARCANVAS_PREFERENCE:${JSON.stringify(value)}]]`);
  assert.ok(parsed.preference,`${input}: model supplies a structured proposal`);
  assert.equal(matches(input,parsed),true,`${input}: proposal matches the requested value`);
}
for (const [text,proposal] of [['如何切换主题',{action:'open_generation_settings'}],['如何把主题切换到石墨灰',{preference:{kind:'theme',value:'graphite'}}],['how do i switch the theme to graphite',{preference:{kind:'theme',value:'graphite'}}],['关闭设置',{action:'open_settings'}],['close settings',{action:'open_settings'}],['删除视频节点',{action:'create_video_node'}],['delete the text node',{action:'create_text_node'}],['删除石墨灰主题',{preference:{kind:'theme',value:'graphite'}}],['把石墨灰主题换成其他主题',{preference:{kind:'theme',value:'graphite'}}],['switch the theme from graphite',{preference:{kind:'theme',value:'graphite'}}],['switch the theme from graphite to dark',{preference:{kind:'theme',value:'graphite'}}],['把深色主题换成其他主题',{preference:{kind:'theme',value:'dark'}}],['可以把主题换成深色吗？',{preference:{kind:'theme',value:'light'}}],['把主题换成深色或浅色',{preference:{kind:'theme',value:'dark'}}],['把图片换成深色',{preference:{kind:'theme',value:'dark'}}],['打开画布和设置',{action:'open_canvas'}],['打开画布和设置',{action:'open_settings'}],['open canvas and settings',{action:'open_canvas'}],['could you open model settings?',{action:'open_settings'}],['创建文字和视频节点',{action:'create_video_node'}],['创建文字和视频节点',{action:'create_text_node'}],['创建一个文字节点',{action:'create_video_node'}],['帮我打开设置',{action:'open_api_settings'}],['把主题换成石墨灰',{preference:{kind:'theme',value:'dark'}}],['切换成繁體中文',{preference:{kind:'language',value:'en-US'}}],['开启自动下载',{preference:{kind:'autoDownload',value:false}}],['切换语言',{preference:{kind:'language',value:'en-US'}}],['告诉我笑话',{preference:{kind:'theme',value:'dark'}}],['切换语言',{preference:{kind:'autoDownload',value:true}}],['打开设置',{action:'__proto__'}]]) assert.equal(matches(text,proposal),false,text);
for (const text of ['请把主题调整得更深一些','把它改亮一点','帮我把这个弄小一些','帮我打开设置页面','我想删除项目','帮我把界面搞定','请把軟體修復好','can you fix the app','帮我把它搞定','设置完成了吗','好了吗','can you switch the theme','is it done?']) assert.equal(receipt(text),true,text);
for (const text of ['你好','给我讲个笑话','如何切换主题？','为什么任务失败了','how do i change the theme?','how do i fix the app?']) assert.equal(receipt(text),false,text);
for (const text of ['我的任务是不是卡住了','我的任務是不是卡著了','is my task stuck?','我的主题是不是出问题了','is my automatic download stuck?']) assert.equal(requiresState(text),true,text);
for (const text of ['删除所有历史记录','刪除所有專案','delete my project','清空所有项目','显示我的密钥','copy my api key','修改模型配置','帮我充值余额','重试失败任务','generate an image','打开画布，然后删除项目']) assert.equal(unsupported(text),true,text);
for (const text of ['如何删除项目','不要删除项目','if I delete my project what happens','打开模型配置','open model settings','关闭自动下载','打开生成与下载','create a video node','任务失败了吗','生成一个故事','查看视频生成任务状态','show my video task status']) assert.equal(unsupported(text),false,text);
assert.equal(inquiry('查看视频生成任务状态'),'tasks_video');
for (const text of ['什么是任务','how do i change the theme?','请把我的主题调整得更深一些','can you change my theme to dark?','给我讲个笑话']) assert.equal(requiresState(text),false,text);
for (const text of ['我的任务是不是卡住了','我的任務是不是卡著了','is my task stuck?','为什么任务卡住了']) assert.equal(inquiry(text),'indeterminate_task_stall',text);
for (const text of ['不要查看卡住的任务','retry my stuck task']) assert.notEqual(inquiry(text),'indeterminate_task_stall',text);
for (const text of ['明天把主题换成石墨灰','稍後打開設定','等我回来打开设置','下个月切换主题','open settings in 5 minutes','明天查询任务','check my tasks tomorrow']) assert.equal(deferred(text),true,text);
for (const text of ['明天天气怎么样','讲一个未来的故事','打开设置','明天有什么电影','how do i change the theme tomorrow?']) assert.equal(deferred(text),false,text);
for (const text of ['明天视频任务为什么失败','下次任務狀態是什麼','why will the video task fail tomorrow?','what will my task status be tomorrow?']) assert.equal(futureTask(text),true,text);
for (const text of ['如果明天任务失败怎么办','if a task fails tomorrow what should i do?','明天查询任务','任务跑完了没','明天天气怎么样']) assert.equal(futureTask(text),false,text);
for (const text of ['我已帮你打开设置','已成功切换主题','助手已為您修改設定','已为您调整为深色','已经将您的主题切换到深色','已把語言設定為繁體中文','设置已完成','切換成功','没问题，已经替你搞定。','已经处理好了','搞定啦！','完成啦。','我已经替您把它办妥。','您提出的操作现已妥善落实。','我已幫您辦妥。','I have opened settings','I’ve changed the theme','Your theme is now dark','settings have been updated','Done and dusted.','All taken care of.']) assert.equal(claim(text),true,text);
for (const text of ['一切都按您的要求办妥了。','都已安排好了。','你的设置已经准备就绪。','全部都處理好了。','Done!','All set.','Your settings are now ready.']) assert.equal(claim(text),true,text);
for (const text of ['已照办，请查收。','好的，已照辦。','已经按照您的要求执行了。','已遵照你的指示執行。',"As requested, it's done.",'Consider it done.','I have done as you requested.']) assert.equal(claim(text),true,text);
for (const text of ['你的设置现正生效。','您的變更現正生效。','Your requested changes are now in effect.','The configuration is now in effect.','Your theme has now been applied.']) assert.equal(claim(text),true,`passive completion claims are not local receipts: ${text}`);
for (const text of ['如果设置生效，页面会改变。','設定生效後，畫面會改變。','If your settings take effect, the page will change.']) assert.equal(claim(text),false,`ordinary explanations remain available: ${text}`);
for (const text of ['现在一切安排妥当。\n软件操作 · 已确认','軟體操作 · 已確認','App action · Confirmed']) assert.equal(claim(text),true,`model text cannot imitate local receipt labels: ${text}`);
for (const text of ['软件反馈：现已设置妥当','軟體回饋：已準備妥當','App feedback: all taken care of','建议操作 · 等待确认','建議操作 · 等待確認','Suggested action · Awaiting confirmation','软件操作 · 结果未确认','軟體操作 · 未執行','App action · Result unconfirmed']) assert.equal(claim(text),true,`trusted labels must not be reproduced by model prose: ${text}`);
for (const text of ['“软件反馈”是界面的一种消息类型。','The phrase App feedback describes a message type.']) assert.equal(claim(text),false,'ordinary explanations about labels remain available');
for (const text of ['软\u200b件操作 · 已确认','已\u200d经切换主题','Ａｐｐ ａｃｔｉｏｎ · Ｃｏｎｆｉｒｍｅｄ','App action\u202e · Confirmed']) assert.equal(claim(text),true,`invisible or compatibility characters cannot hide a known false claim: ${text}`);
for (const text of ['您可以打开设置','我无法直接修改设置','Please open the settings page.']) assert.equal(claim(text),false,text);
const data=[{status:'pending',prompt:'SECRET_PROMPT'},{status:'running',apiKey:'SECRET_KEY'},{status:'completed',resultUrl:'https://private.test/media'},{status:'succeeded'},{status:'failed',errorMsg:'HTTP 429 rate limit secret=PRIVATE',createdAt:5},{status:'failed',stoppedByUser:true},{status:'stopped'},{status:'mystery'},null];
assert.deepEqual(summary(data),{queued:1,running:1,completed:2,failed:1,stopped:2,unknown:2});
assert.equal(summary(null),null);
const typedTasks=[{type:'video',status:'running',prompt:'SECRET_PROMPT'},{type:'custom',customOutputType:'video',status:'failed',errorMsg:'SECRET_ERROR'}, {type:'image',status:'completed'}, {status:'failed',apiKey:'SECRET_KEY'}];
const typedFailures=[{type:'video',status:'failed',createdAt:1,errorMsg:'HTTP 429 rate limit token=SECRET_VIDEO',prompt:'SECRET_PROMPT'},{type:'image',status:'failed',createdAt:2,errorMsg:'HTTP 401 invalid api key SECRET_IMAGE',resultUrl:'https://private.test/SECRET_URL'}];
for(const language of ['zh-CN','zh-TW','en-US']) {
  const video=typedResult(typedFailures,'video',language), image=typedResult(typedFailures,'image',language);
  assert.match(video,/429/);assert.doesNotMatch(video,/401|SECRET_|private\.test/);
  assert.match(image,/401/);assert.doesNotMatch(image,/429|SECRET_|private\.test/);
  assert.doesNotMatch(typedResult(typedFailures,'audio',language),/401|429|SECRET_/);
}
for(const [language,label,counts] of [['zh-CN','视频任务（仅统计可识别类型）','进行中 1、已完成 0、失败 1'],['zh-TW','影片任務（僅統計可識別類型）','執行中 1、已完成 0、失敗 1'],['en-US','Video tasks (recognized types only)','1 running, 0 completed, 1 failed']]) { const result=formatCategory(typedTasks,'video',language);assert.ok(result.includes(label),result);assert.ok(result.includes(counts),result);assert.equal(result.includes('SECRET_'),false); }
for(const [language,notice] of [['zh-CN','另有 1 条任务的类型无法识别'],['zh-TW','另有 1 筆任務的類型無法識別'],['en-US','1 task(s) have an unrecognized type']]) {
  const unknown=[{type:'image',status:'completed'},{type:'custom',status:'failed',errorMsg:'SECRET_UNKNOWN_ERROR'}];
  for(const result of [formatCategory(unknown,'video',language),typedResult(unknown,'video',language)]) {assert.ok(result.includes(notice),result);assert.ok(!result.includes('SECRET_UNKNOWN_ERROR'));}
  assert.ok(!formatCategory([{type:'image',status:'completed'}],'video',language).includes(notice));
}
assert.match(formatCategory(null,'video','en-US'),/unavailable/);
for (const [lang,expected] of [['zh-CN','最近创建的任务：进行中。以上为上次本地记录，可能不是最新状态。'],['zh-TW','最近建立的任務：執行中。以上為上次本機紀錄，可能不是最新狀態。'],['en-US','Most recently created task: running. This is the last local record and may be out of date.']]) { const result=latest([{createdAt:1,status:'completed'},{createdAt:3,status:'running',prompt:'SECRET_PROMPT',apiKey:'SECRET_KEY'}],lang); assert.equal(result,expected); for(const secret of ['SECRET_PROMPT','SECRET_KEY']) assert.equal(result.includes(secret),false); }
assert.match(latest([], 'zh-CN'),/空/); assert.match(latest(null,'en-US'),/unavailable/);
assert.match(latest([{createdAt:3,status:'completed'},{createdAt:3,status:'failed'}],'zh-CN'),/无法可靠/);
assert.match(latest([{createdAt:3,status:'completed'},{status:'failed'}],'zh-CN'),/无法可靠/);
for (const language of ['zh-CN','zh-TW','en-US']) {
  const mixed=[{createdAt:1735689600000,status:'completed'}, {createdAt:1767225600,status:'failed',prompt:'PRIVATE'}];
  assert.match(latest(mixed,language),language==='en-US'?/cannot reliably/:language==='zh-TW'?/無法可靠/:/无法可靠/);
  assert.match(latest([{createdAt:'2025-01-01T00:00:00Z',status:'completed'},mixed[1]],language),language==='en-US'?/cannot reliably/:language==='zh-TW'?/無法可靠/:/无法可靠/);
}
assert.match(latest([{createdAt:1735689600000,status:'completed'}, {createdAt:1767225600000,status:'failed'}],'zh-CN'),/失败/);
assert.match(latest([{createdAt:'2025-01-01T00:00:00Z',status:'completed'}, {createdAt:1767225600000,status:'failed'}],'zh-CN'),/失败/);
assert.match(latest([{status:'failed',stoppedByUser:true}],'zh-CN'),/已停止/);
assert.match(latest([{createdAt:'2026-01-01T00:00:00Z',status:'failed'},{createdAt:'2027-01-01T00:00:00Z',status:'completed'}],'zh-CN'),/已完成/);
const knownStatusData=data.filter(item=>item&&item.status!=='mystery');
for (const [language,expected] of [['zh-CN','访问频率限制'],['zh-TW','存取頻率限制'],['en-US','rate limit']]) { const result=format(data,language)+' '+diagnose(knownStatusData,language); for(const secret of ['SECRET_PROMPT','SECRET_KEY','https://','PRIVATE','rate_limit']) assert.equal(result.includes(secret),false); assert.match(result,/429/); assert.ok(result.includes(expected)); }
for (const [language,expected] of [['zh-CN','部分任务状态无法确认'],['zh-TW','部分任務狀態無法確認'],['en-US','Some task statuses cannot be determined']]) {
  for (const records of [[null],[{status:'mystery',errorMsg:'SECRET_UNKNOWN'}],[{status:'failed',errorMsg:'HTTP 429 SECRET_FAILURE'},{status:'mystery'}],[{status:'completed',stoppedByUser:true}]]) {
    const result=diagnose(records,language);assert.ok(result.includes(expected),result);assert.doesNotMatch(result,/SECRET_|429/);
  }
  assert.match(diagnose([{status:'FAILED',type:'image',errorMsg:'HTTP 429 rate limit SECRET_FAILURE'}],language),/429/);
}
for (const [error,kind] of [['insufficient balance','余额或额度不足'],['invalid api key','鉴权或凭据问题'],['timeout','请求超时'],['network error','网络连接问题'],['content policy','内容审核限制'],['unclassified secret','暂未识别']]) { const result=diagnose([{status:'failed',type:'image',errorMsg:error}], 'zh-CN'); assert.ok(result.includes(kind),error); assert.ok(result.includes('图片')); assert.equal(result.includes('secret'),false); }
for (const [language,expected] of [['zh-CN','视频'],['zh-TW','影片'],['en-US','video']]) { const result=diagnose([{status:'failed',type:'custom',customOutputType:'video',errorMsg:'HTTP 429 SECRET_CUSTOM',prompt:'SECRET_PROMPT'}],language); assert.ok(result.includes(expected),language); assert.equal(result.includes('SECRET_'),false); }
for (const [error,expectations] of [
  ['rate limit SECRET_RAW',['限流和并发','流量限制與並發','rate and concurrency limits']],
  ['insufficient quota SECRET_RAW',['余额和可用额度','餘額和可用額度','balance and available quota']],
  ['invalid api key SECRET_RAW',['凭据是否有效','憑證是否有效','credential validity']],
  ['request timeout SECRET_RAW',['网络连接和服务状态','網路連線和服務狀態','network and service status']],
  ['network error SECRET_RAW',['网络连接和服务状态','網路連線和服務狀態','network and service status']],
  ['content policy SECRET_RAW',['内容和素材','內容和素材','content and media']],
  ['unclassified SECRET_RAW',['不要提供完整密钥','不要提供完整金鑰','never share a full key']],
]) for(const [index,language] of ['zh-CN','zh-TW','en-US'].entries()) {
  const text=diagnose([{status:'failed',type:'image',errorMsg:error,prompt:'SECRET_PROMPT',resultUrl:'https://private.invalid/SECRET_MEDIA'}],language);
  assert.ok(text.includes(expectations[index]),`${language}: category-specific safe check`);
  assert.ok(text.includes(language==='en-US'?'Nothing will be retried automatically.':language==='zh-TW'?'不會自動重試。':'不会自动重试。'));
  for(const secret of ['SECRET_RAW','SECRET_PROMPT','SECRET_MEDIA','https://']) assert.equal(text.includes(secret),false);
}
assert.doesNotMatch(diagnose([{status:'failed',type:'custom',customOutputType:'private-type-secret',errorMsg:'failed'}], 'en-US'),/private-type-secret/);
// Exercise the same compaction and transitions used by the real task list.
let lifecycle = compactGlobalTasks([
  {id:'custom-qa',nodeId:'video-node',type:'custom',customOutputType:'video',status:'pending',createdAt:3,prompt:'SECRET_PROMPT'},
  {id:'music-qa',nodeId:'audio-node',type:'audio',status:'succeeded',createdAt:2,resultUrl:'https://private.test/SECRET_MEDIA'},
  {id:'stopped-qa',nodeId:'stopped-node',type:'image',status:'failed',stoppedByUser:true,createdAt:1,errorMsg:'SECRET_STOPPED'},
]);
assert.deepEqual(summary(lifecycle),{queued:1,running:0,completed:1,failed:0,stopped:1,unknown:0});
lifecycle = lifecycle.map(item => item.id === 'custom-qa' ? updateTaskRunningProgress(item,42) : item);
assert.deepEqual(summary(lifecycle),{queued:0,running:1,completed:1,failed:0,stopped:1,unknown:0});
// This synthetic transition represents a confirmed generation failure, not a
// failed status query; the actual refresh hook tests cover lookup failures.
lifecycle = failGlobalTaskRefresh(lifecycle,'custom-qa','HTTP 429 rate limit key=SECRET_KEY');
assert.deepEqual(summary(lifecycle),{queued:0,running:0,completed:1,failed:1,stopped:1,unknown:0});
for (const language of ['zh-CN','zh-TW','en-US']) {
  const result = format(lifecycle,language) + ' ' + diagnose(lifecycle,language);
  assert.match(result,/429/);
  for (const secret of ['SECRET_PROMPT','SECRET_MEDIA','SECRET_STOPPED','SECRET_KEY','https://']) assert.equal(result.includes(secret),false,language);
}
const mergedCompletion = compactGlobalTasks([
  {id:'same-task',nodeId:'same-node',type:'video',status:'failed',stoppedByUser:true,createdAt:1,updatedAt:2},
  {id:'same-task',nodeId:'same-node',type:'video',status:'completed',createdAt:1,updatedAt:3,resultUrl:'https://private.test/SECRET_RESULT'},
]);
assert.equal(mergedCompletion.length,1);
assert.equal(mergedCompletion[0].status,'completed');
assert.equal(mergedCompletion[0].stoppedByUser,true);
assert.deepEqual(summary(mergedCompletion),{queued:0,running:0,completed:0,failed:0,stopped:0,unknown:1},'a merged result and stop flag do not establish which event won');
const stoppedAfterResult = compactGlobalTasks([
  {id:'same-task',nodeId:'same-node',type:'video',status:'completed',createdAt:1,updatedAt:2,resultUrl:'https://private.test/SECRET_RESULT'},
  {id:'same-task',nodeId:'same-node',type:'video',status:'failed',stoppedByUser:true,createdAt:1,updatedAt:3},
]);
assert.deepEqual(summary(stoppedAfterResult),{queued:0,running:0,completed:0,failed:0,stopped:0,unknown:1},'a newer stop can coexist with the older completed result after reconciliation');
assert.deepEqual(summary([{status:'completed',stoppedByUser:true}]),{queued:0,running:0,completed:0,failed:0,stopped:0,unknown:1},'a contradictory flag without a result stays unknown');
assert.doesNotMatch(format(mergedCompletion,'en-US'),/SECRET_RESULT|https:\/\//);
assert.match(diagnose([], 'en-US'),/no failed task/i); assert.match(diagnose(null,'en-US'),/unavailable/i);
for (const language of ['zh-CN','zh-TW','en-US']) { const ambiguous=diagnose([{status:'failed',createdAt:2,errorMsg:'HTTP 401 SECRET_A'},{status:'failed',createdAt:2,errorMsg:'HTTP 429 SECRET_B'}],language); assert.match(ambiguous,language==='en-US'?/cannot be determined reliably/:language==='zh-TW'?/無法可靠判斷/ : /无法可靠判断/); for(const value of ['401','429','SECRET_A','SECRET_B']) assert.equal(ambiguous.includes(value),false); }
const newestCreated=diagnose([{status:'failed',createdAt:1,updatedAt:9,type:'text',errorMsg:'HTTP 401'}, {status:'failed',createdAt:2,updatedAt:3,type:'image',errorMsg:'HTTP 429'}],'zh-CN'); assert.match(newestCreated,/最近创建的失败任务/); assert.match(newestCreated,/不一定是最近发生的失败/); assert.match(newestCreated,/图片/); assert.match(newestCreated,/429/); assert.equal(newestCreated.includes('401'),false);
for (const action of ['open_settings','open_generation_settings']) assert.deepEqual(reply(`Please confirm.\n[[STARCANVAS_ACTION:${action}]]`),{text:'Please confirm.',action});
console.log('PASS_ASSISTANT_LOCAL_NAVIGATION_AND_TASKS');
