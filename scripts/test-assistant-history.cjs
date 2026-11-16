const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText,file);
const {jsx}=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server');
const {assistantHistoryRange:range,assistantHistoryMatches:find,assistantHistoryStartAfterChange:afterChange,assistantSessionMatches,assistantHistoryCopy}=require('../src/renderer/lib/assistant-history.ts');
const {AssistantHistoryControls}=require('../src/renderer/components/assistant-history-controls.tsx');
test('bounded presentation pages expose every absolute message index without changing the full history',()=>{
 const messages=Array.from({length:2000},(_,i)=>({text:'RECORD_'+i,action:i===12?'original-action':undefined})),seen=new Set();let r=range(messages.length,null);
 while(true){assert(r.end-r.start<=24);messages.slice(r.start,r.end).forEach((item,offset)=>{const index=r.start+offset;assert.equal(item,messages[index]);seen.add(index);});if(!r.older)break;r=range(messages.length,Math.max(0,r.start-24));}
 assert.equal(seen.size,2000);assert.equal(messages.length,2000);assert.equal(messages[12].action,'original-action');
 assert.deepEqual(range(0,null),{start:0,end:0,total:0,older:false,newer:false});assert.equal(range(4,99).start,0);assert.equal(range(2000,0).newer,true);assert.equal(range(2001,null).end,2001);assert.equal(range(2001,24).start,24,'new arrivals do not move an earlier reading page');
});
test('literal in-memory search finds text/attachment names at original positions, not regex or executable suggestions',()=>{
 const messages=[{text:'Alpha 中文'}, {text:'[[STARCANVAS_ACTION:open_settings]]'}, {text:'Beta',attachments:[{name:'参考.PNG'}]}, {text:'.* literal'}];
 assert.deepEqual(find(messages,'alpha'),[0]);assert.deepEqual(find(messages,'中文'),[0]);assert.deepEqual(find(messages,'参考.png'),[2]);assert.deepEqual(find(messages,'.*'),[3]);assert.deepEqual(find(messages,' \n '),[]);assert.deepEqual(find(messages,'missing'),[]);assert.deepEqual(find(messages,'STARCANVAS_ACTION'),[1]);assert.equal(messages[1].action,undefined);
 assert(assistantSessionMatches('Archive Gamma','gamma','Untitled'));assert(assistantSessionMatches('','untitled','Untitled'));assert(!assistantSessionMatches('Alpha','Beta','Untitled'));
});
test('new replies freeze a latest page being read, without moving another session or a deliberate latest jump',()=>{
 const previous={owner:'A',total:240,start:216};
 assert.equal(afterChange(null,previous,'A',241,false),216);assert.equal(afterChange(null,previous,'B',241,false),null);assert.equal(afterChange(24,previous,'A',241,false),24);assert.equal(afterChange(24,previous,'A',241,true),null);assert.equal(afterChange(null,previous,'A',240,false),null);
});
test('navigation and search controls are localized, bounded and do not send model or storage requests',()=>{
 const noop=()=>{};
 for(const language of ['zh-CN','zh-TW','en-US']){
  const c=assistantHistoryCopy(language),history={range:range(240,0),draft:'SYNTHETIC_QUERY',query:'SYNTHETIC_QUERY',searchOpen:true,matches:[12],cursor:0,match:12,toggleSearch:noop,setDraft:noop,search:noop,moveMatch:noop,earlier:noop,later:noop,latest:noop};
  const html=renderToStaticMarkup(jsx(AssistantHistoryControls,{history,language}));assert(html.includes('1'));assert(html.includes(c.query));assert(html.includes(c.newerLabel));assert(html.includes(c.latest));assert(!html.includes('sendMessage'));assert(!html.includes('<script'));
  if(language==='en-US')assert(!/[\u3400-\u9fff]/.test(html));
 }
});
test('archive reader does not select/restore, materialize attachments, revive actions or observe historical task cards',()=>{
 const reader=fs.readFileSync(require.resolve('../src/renderer/components/assistant-archive-preview.tsx'),'utf8');
 assert(reader.includes('assistantWorkspaceReadSession'));for(const disallowed of ['assistantWorkspaceSend','assistantWorkspaceSelectSession','assistantWorkspacePatchSession','AssistantGenerationTaskCard','parseAssistantReply','readMediaFile','innerHTML','localStorage'])assert(!reader.includes(disallowed),disallowed);
 assert(reader.includes('if(!active)return'));assert(reader.includes('active=false'));assert(reader.includes('aria-modal="true"'));assert(reader.includes('data-assistant-history-index'));
 const surface=fs.readFileSync(require.resolve('../src/renderer/components/assistant-onboarding.tsx'),'utf8');assert(surface.includes('const index=history.range.start+offset'));assert(surface.includes('createSuggestedNode(index,'));assert(surface.includes('confirmPreference(index,'));
 const css=fs.readFileSync(require.resolve('../src/renderer/styles/assistant-onboarding.css'),'utf8');assert(css.includes('html body .wj-assistant-session-sidebar input.wj-assistant-session-filter{border-radius:var(--wj-rounded-control,12px)!important;appearance:none}'));
});
