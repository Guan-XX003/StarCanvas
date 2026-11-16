// Exercise the actual async legacy confirmation handler, not a replacement UI.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),crypto=require('node:crypto');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
const onboarding=require('../src/renderer/lib/assistant-onboarding.ts'),canvasCopy=require('../src/renderer/lib/assistant-canvas-copy.ts');
const file=path.join(__dirname,'../src/renderer/components/assistant-onboarding.tsx'),source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);let handler;
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='createSuggestedNode')handler=node.getText(tree);ts.forEachChild(node,visit)}visit(tree);assert(handler);assert(!handler.includes('onCreateCanvasNode'));
const compiled=ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
function fixture(language,outcome){
 const item={role:'assistant',text:'proposal',action:'create_text_node',actionProjectId:'synthetic',draft:'QA_CONTENT'},messages=[item];let calls=0,notice='',release;
 const ctx={...onboarding,...canvasCopy,crypto,messages,language,projectId:'synthetic',projectName:'QA_PROJECT',activeView:'canvas',pendingTaskInspection:{current:null},proposalFence:{current:false},proposalBlocked:false,consumedActions:{current:new WeakSet()},
  workspace:{id:'owner-a',controller:{viewFor:()=>({canvasPlan:{}})}},getCanvasNodePlacement:()=>({x:40,y:60}),
  canvasPlanner:{async createSingle(owner,project,kind,content,position,options){calls++;assert.equal(owner,'owner-a');assert.equal(project,'synthetic');assert.equal(kind,'text');assert.equal(content,'QA_CONTENT');assert.equal(position.x,40);assert(options.intent);assert.equal(options.receipt,onboarding.assistantNodeSubmissionNotice(language));
   if(outcome==='rejected')throw Object.assign(Error('QA_REJECTED'),{code:'PLAN_STALE'});
   if(outcome==='unknown')throw Object.assign(Error('QA_UNKNOWN'),{code:'OPERATION_OUTCOME_UNKNOWN'});
   if(outcome==='hold')await new Promise(resolve=>release=resolve);
   ctx.setMessages(previous=>[...previous,{role:'assistant',text:options.receipt,executionStatus:'confirmed'}]);return {createdNodeIds:['QA_NODE'],generationStarted:false};}},
  setChatNotice(value){if(outcome==='display-failure'&&value==='')throw Error('QA_DISPLAY_FAILURE');notice=value;},
  setMessages(update){const next=typeof update==='function'?update(messages):update;messages.splice(0,messages.length,...next)}};
 const run=vm.runInNewContext(compiled+'\ncreateSuggestedNode',ctx);
 return {ctx,item,messages,run:()=>run(0,'create_text_node','synthetic'),get calls(){return calls;},get notice(){return notice;},release:()=>release()};
}
(async()=>{
 for(const language of ['zh-CN','zh-TW','en-US'])for(const outcome of ['accepted','unknown','rejected','display-failure']){
  const f=fixture(language,outcome);await f.run();assert.equal(f.calls,1);
  if(outcome==='accepted'){assert.equal(f.messages[0].action,null);assert.equal(f.messages[1].text,onboarding.assistantNodeSubmissionNotice(language));assert.equal(f.notice,'');assert.equal(onboarding.clearAssistantProposals(f.messages)[1].text,f.messages[1].text);}
  else if(outcome==='unknown'){assert.equal(f.messages[0].action,null);assert.equal(f.messages[1].text,onboarding.assistantNodeUncertainNotice(language));assert(f.ctx.consumedActions.current.has(f.item));}
  else if(outcome==='display-failure'){assert(f.ctx.consumedActions.current.has(f.item));assert.equal(f.messages[1].text,onboarding.assistantNodeSubmissionNotice(language));assert.equal(f.notice,canvasCopy.assistantCanvasPostCommitNotice(language));}
  else{assert.equal(f.messages[0].action,'create_text_node');assert(f.notice);assert(!f.ctx.consumedActions.current.has(f.item));}
 }
 for(const language of ['zh-CN','zh-TW','en-US']){
  const f=fixture(language,'accepted');f.item.draft='sk-1234567890abcdef';await f.run();assert.equal(f.calls,0);assert(f.notice);assert(!f.ctx.consumedActions.current.has(f.item));
  const noPosition=fixture(language,'accepted');noPosition.ctx.getCanvasNodePlacement=()=>null;await noPosition.run();assert.equal(noPosition.calls,0);assert(noPosition.notice);
  const wrong=fixture(language,'accepted');wrong.ctx.projectId='other';await wrong.run();assert.equal(wrong.calls,0);
 }
 const f=fixture('en-US','hold'),one=f.run(),two=f.run();assert.equal(f.calls,1);f.release();await Promise.all([one,two]);assert.equal(f.calls,1);assert.equal(f.messages.filter(m=>m.executionStatus==='confirmed').length,1);
 console.log('PASS_ASSISTANT_NODE_SHARED_GATEWAY_AND_ASYNC_RECEIPTS');
})().catch(e=>{console.error(e);process.exitCode=1;});
