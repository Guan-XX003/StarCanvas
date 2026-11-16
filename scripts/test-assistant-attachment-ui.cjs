const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText,file);
const {jsx}=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server');
const {createAssistantMediaPreview,assistantAttachmentCopy}=require('../src/renderer/lib/assistant-attachment.ts');
const {AssistantAttachments,AssistantAttachmentStatus}=require('../src/renderer/components/assistant-attachments.tsx');
const {AssistantGettingStarted}=require('../src/renderer/components/assistant-getting-started.tsx');
const {assistantExampleRequest,assistantGettingStartedCopy,appendAssistantExample}=require('../src/renderer/lib/assistant-getting-started.ts');
const {createCanvasPlanController}=require('../src/renderer/lib/canvas-operation-plan.ts');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('late A preview cannot create or replace B URLs; close/retry revoke only owned transient URLs',async()=>{
 const gates=[],urls=[],revoked=[],states=[];const preview=createAssistantMediaPreview({read:(owner,id)=>{const d=deferred();gates.push({owner,id,...d});return d.promise;},makeUrl:()=>{const u='blob:QA_'+urls.length;urls.push(u);return u;},revokeUrl:u=>revoked.push(u),onChange:s=>states.push(s)});
 const attachment=id=>({id,mime:'image/png',size:3}),reply=id=>({...attachment(id),type:'image',bytes:new Uint8Array([1,2,3])});
 const a=preview.open('A',attachment('A_FILE')),b=preview.open('B',attachment('B_FILE'));gates[1].resolve(reply('B_FILE'));await b;const bUrl=states.at(-1).url;gates[0].resolve(reply('A_FILE'));await a;assert.equal(states.at(-1).url,bUrl);assert.equal(urls.length,1);
 const retry=preview.open('B',attachment('B_FILE'));assert.deepEqual(revoked,[bUrl]);gates[2].resolve(reply('B_FILE'));await retry;const latest=states.at(-1).url;preview.decodeFailed(bUrl);assert.equal(states.at(-1).url,latest,'stale decode errors cannot poison a newer preview');preview.close();assert.deepEqual(revoked,[bUrl,latest]);const count=states.length;preview.decodeFailed(latest);assert.equal(states.length,count);
});
test('preview failure is safe/local, decode errors revoke URLs and malformed MIME/identity never reach a media element',async()=>{
 const states=[],revoked=[];let result={id:'FILE',mime:'image/png',type:'image',bytes:new Uint8Array([1,2,3])};
 const p=createAssistantMediaPreview({read:async()=>result,makeUrl:()=> 'blob:OWNED',revokeUrl:u=>revoked.push(u),onChange:s=>states.push(s)}),file={id:'FILE',mime:'image/png',size:3};
 await p.open('A',file);p.imageSize('blob:OWNED',20000,20000);assert.equal(states.at(-1).code,'ASSISTANT_MEDIA_PREVIEW_LIMIT');assert.deepEqual(revoked,['blob:OWNED']);
 result={...result,id:'OTHER'};await p.open('A',file);assert.equal(states.at(-1).code,'ASSISTANT_MEDIA_CORRUPT');
 const failed=createAssistantMediaPreview({read:async()=>{throw Error('PRIVATE_PATH_AND_BODY');},makeUrl:()=>{throw Error('NO_URL');},revokeUrl:()=>{},onChange:s=>states.push(s)});await failed.open('A',file);assert.equal(states.at(-1).code,'ASSISTANT_MEDIA_UNAVAILABLE');assert(!JSON.stringify(states).includes('PRIVATE_'));
});
test('attachment cards and operation status are localized; type is metadata not extension, private names are plain text',()=>{
 for(const language of ['zh-CN','zh-TW','en-US']){
  const c=assistantAttachmentCopy(language),html=renderToStaticMarkup(jsx(AssistantAttachments,{items:[{id:'FILE',name:'<script>reference.mp4</script>',type:'image',mime:'image/png',size:1024}],language,onPreview:()=>{},onRemove:()=>{}}));assert(html.includes(c.image));assert(!html.includes('<script>'));assert(html.includes('1.0 KiB'));assert(html.includes(c.preview));assert(html.includes(c.remove));
  const failed=renderToStaticMarkup(jsx(AssistantAttachmentStatus,{state:{phase:'failed',code:'ASSISTANT_MEDIA_UNSUPPORTED',name:'BAD_FILE'},language}));assert(failed.includes(c.unsupported));assert(failed.includes(c.failed));if(language==='en-US')assert(!/[\u3400-\u9fff]/.test(html+failed));
 }
});
test('getting-started examples stay editable text, initial rendering does not request a model or read configuration',()=>{
 let calls=0;const unused=()=>{calls++;throw Error('UNEXPECTED_EFFECT');};
 for(const language of ['zh-CN','zh-TW','en-US']){
  const c=assistantGettingStartedCopy(language),html=renderToStaticMarkup(jsx(AssistantGettingStarted,{language,projectId:'QA',customRole:false,assistantStatus:'missing',getSummary:unused,onAssistant:unused,onApi:unused,onModels:unused,onExample:unused,disabled:false}));assert(html.includes(c.title));assert.equal(calls,0);assert(!html.includes('open=""'));
  for(const kind of ['image','video','failure']){const example=assistantExampleRequest(kind,language);assert(example.length>20);assert(!example.includes('sk-'));assert(!example.includes('https://'));if(language==='en-US')assert(!/[\u3400-\u9fff]/.test(example));}
 }
 assert.equal(appendAssistantExample('EXISTING','EXAMPLE'),'EXISTING\n\nEXAMPLE');assert.equal(appendAssistantExample('x'.repeat(16000),'EXAMPLE'),null);assert.equal(appendAssistantExample('','EXAMPLE'),'EXAMPLE');
});
test('local configuration summary grants no canvas authority and exposes no private state',()=>{
 let calls=0;const original={image:{modelCount:2,configuration:'present'},video:{modelCount:1,configuration:'missing'}};
 const controller=createCanvasPlanController({read:()=>({projectId:'QA',instanceId:'QA',ready:true,nodes:[{id:'private',data:{apiKey:'PRIVATE_KEY',prompt:'PRIVATE_CONTENT'}}],edges:[]}),capabilities:()=>({}),prepareNode:()=>{throw Error('NO_PREPARE');},commit:()=>{throw Error('NO_COMMIT');},configurationSummary:()=>{calls++;return original;}});
 const summary=controller.configurationSummary();assert.deepEqual(summary,original);summary.image.modelCount=100;assert.equal(original.image.modelCount,2);assert.equal(calls,1);assert(!JSON.stringify(summary).includes('PRIVATE_'));assert.throws(()=>controller.execute('fabricated'),{code:'PLAN_EXPIRED'});
});
test('chat composer is outside the scrollable context and has a scoped rounded-input override',()=>{
 const filename=require.resolve('../src/renderer/components/assistant-onboarding.tsx');
 const tree=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const classes=node=>ts.isJsxElement(node)?node.openingElement.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.text==='className')?.initializer?.text:null;
 let content,composer,inputs=0;
 function walk(node){const name=classes(node);if(name==='wj-assistant-scroll-content')content=node;if(name==='wj-assistant-composer')composer=node;
  if(ts.isJsxAttribute(node)&&node.name.text==='id'&&node.initializer?.text==='wj-assistant-message')inputs++;
  ts.forEachChild(node,walk);
 }walk(tree);assert(content&&composer);assert.equal(inputs,1,'the editor is not duplicated or remounted into two views');
 for(let parent=composer.parent;parent;parent=parent.parent)assert.notEqual(parent,content,'history/setup scrolling cannot move the composer off-screen');
 const css=fs.readFileSync(require.resolve('../src/renderer/styles/assistant-onboarding.css'),'utf8');
 assert(css.includes('.wj-assistant-drawer-body-chat>.wj-assistant-scroll-content'));
 assert(css.includes('textarea#wj-assistant-message { flex:none; border-radius:12px!important; }'));
 assert(css.includes('.wj-assistant-composer>.wj-assistant-attachments { flex:0 1 auto; min-height:0; max-height:76px; overflow:auto; }'));
});
