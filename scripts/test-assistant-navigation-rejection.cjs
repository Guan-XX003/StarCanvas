// Check the real app callback and the drawer's real navigation handler with
// synthetic state. A false return must occur before any view mutation.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:filename}).outputText,filename);
const shared={...require('../src/renderer/lib/assistant-onboarding.ts'),...require('../src/renderer/lib/assistant-local-operations.ts'),...require('../src/renderer/lib/assistant-local-action-copy.ts')};
const bundle=fs.readFileSync(path.join(__dirname,'../src/renderer/bundle/index.js'),'utf8');
const callback=require('./source-function.cjs')(bundle,'navigateAssistantLocal');
const source=fs.readFileSync(path.join(__dirname,'../src/renderer/components/assistant-onboarding.tsx'),'utf8'),tree=ts.createSourceFile('assistant-onboarding.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let handler;function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='requestNavigation')handler=node.getText(tree);ts.forEachChild(node,visit)}visit(tree);assert.ok(handler);
const compiled=ts.transpileModule(handler,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
(async()=>{for(const language of ['zh-CN','zh-TW','en-US']) {
 const effects=[],notices=[],messages=[];const ctx={...shared,language,isReady:true,settingsHydratedRef:{current:true},enterprise:{connected:true,mode:'client'},navigationReady:true,ready:true,settingsUnavailable:false,navigationCounter:{current:0},navigationInFlight:{current:null},
  crypto:require('node:crypto'),canNavigateLocal:true,projectId:'QA_PROJECT',workspace:{id:'A',controller:{viewFor:()=>({localAction:ctx.localState})}},localState:{phase:'idle'},
  getAssistantNavigationAccountState:()=>({enterprise:ctx.enterprise}),document:{documentElement:{classList:{remove:()=>effects.push('remove-workspace')}},querySelector:()=>null},window:{dispatchEvent:()=>effects.push('workspace')},CustomEvent:class{constructor(type){this.type=type}},setActiveSettingsTab:v=>effects.push(`tab:${v}`),setActiveView:v=>effects.push(`view:${v}`),setPendingNavigation(){},setChatError:t=>notices.push(t),setMessages:update=>{const next=typeof update==='function'?update(messages):update;messages.splice(0,messages.length,...next)},onNavigationNotice:t=>notices.push(t)};
 ctx.onNavigateLocal=vm.runInNewContext(`(${callback})`,ctx);const run=vm.runInNewContext(`${compiled}\nrequestNavigation`,ctx);
 // Behavioral boundary fixture: actual common service/nonce/DOM lifecycle is
 // independently exercised in test-application-local-actions.cjs.
 ctx.localActions={async run(_owner,_operation,_project,args,options){
  let accepted;try{accepted=ctx.onNavigateLocal(args.destination);}catch{ctx.localState={phase:'uncertain'};throw Error('partial');}
  if(!accepted){ctx.localState={phase:'failed'};ctx.setMessages(previous=>[...previous,{role:'assistant',...options.failure('OPERATION_NAVIGATION_REFUSED')}]);throw Error('refused');}
  ctx.localState={phase:'completed'};return {destination:args.destination};
 }};
 await run('api');assert.deepEqual(effects,[],'managed settings rejection does not modify a view');assert.equal(messages.at(-1).executionStatus,'rejected');assert.equal(ctx.navigationInFlight.current,null);
 ctx.enterprise={connected:false};await run('canvas');assert.deepEqual(effects,['remove-workspace','view:canvas']);
 // A callback exception might follow a partial mutation: never report it as rejected.
 ctx.navigationInFlight.current=null;ctx.onNavigateLocal=()=>{effects.push('partial');throw Error('synthetic')};await run('account');assert.equal(ctx.localState.phase,'uncertain');assert.equal(messages.filter(m=>m.executionStatus==='rejected').length,1,'partial work never produces another false rejection');assert.ok(notices.length>=1);
 // A model proposal may be confirmed while startup and settings have both
 // failed readiness. Main views wait for the app, not the settings database.
 ctx.navigationInFlight.current=null;ctx.navigationReady=false;ctx.ready=false;ctx.settingsUnavailable=true;
 const before=effects.length;await run('canvas');assert.equal(effects.length,before);
 assert.match(messages.at(-1).text,language==='en-US'?/still loading/:language==='zh-TW'?/仍在載入/:/仍在加载/);
 ctx.navigationReady=true;await run('account');assert.equal(effects.length,before);
 assert.match(messages.at(-1).text,language==='en-US'?/local settings are unavailable/:language==='zh-TW'?/本機設定無法讀取/:/本地设置无法读取/);
}
console.log('PASS_ASSISTANT_NAVIGATION_REJECTION_VS_UNCERTAINTY');
})().catch(e=>{console.error(e);process.exitCode=1});
