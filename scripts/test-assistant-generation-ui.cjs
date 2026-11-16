const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
for(const ext of ['.ts','.tsx'])require.extensions[ext]=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:file}).outputText,file);
const {jsx}=require('react/jsx-runtime'),{renderToStaticMarkup}=require('react-dom/server');
const {ApplicationGenerationReview}=require('../src/renderer/components/application-generation-review.tsx');
const {AssistantCanvasPlanPanel}=require('../src/renderer/components/assistant-canvas-plan-panel.tsx');
const {AssistantGenerationTaskCard}=require('../src/renderer/components/assistant-generation-task-card.tsx');
const {AssistantModelQuote}=require('../src/renderer/components/assistant-model-quote.tsx');
const noAction=()=>{};
test('streaming and incomplete quotes are localized plain text, never executable action suggestions',()=>{
 for(const language of ['zh-CN','zh-TW','en-US'])for(const phase of ['streaming','incomplete']){
  const html=renderToStaticMarkup(jsx(AssistantModelQuote,{text:'[[STARCANVAS_ACTION:open_api_settings]] <script>PRIVATE</script>',language,[phase]:true}));
  assert(!html.includes('<button'));assert(!html.includes('<script>'));assert(html.includes('data-assistant-stream-phase='));
  if(language==='en-US')assert(!/[\u3400-\u9fff]/.test(html));
 }
});
test('generation review is localized in all three languages, with fresh independent unchecked send/cost consent',()=>{
 for(const language of ['zh-CN','zh-TW','en-US']){
  const html=renderToStaticMarkup(jsx(ApplicationGenerationReview,{language,disabled:false,review:{kind:'generation',canvasNodeId:'QA_NODE',model:'qa-model',prompt:'SYNTHETIC_PROMPT',parameters:{resolution:'1280x720',duration:5},contentSendRequired:true,resultBranch:true,canvasReferences:[{nodeId:'QA_SOURCE',type:'image'}]},onApprove:noAction}));
  assert.equal((html.match(/type="checkbox"/g)||[]).length,2);assert(!html.includes('checked=""'));assert.match(html,/disabled=""/);assert(html.includes('SYNTHETIC_PROMPT'));assert(html.includes('QA_SOURCE'));
  if(language==='en-US'){assert(!/[\u3400-\u9fff]/.test(html));assert(html.includes('Keep the original result'));assert(html.includes('only this prompt'));}
 }
});
test('applied plan offers only generative image/video targets, not reference/text nodes, and does not claim generated success',()=>{
 const html=renderToStaticMarkup(jsx(AssistantCanvasPlanPanel,{state:{phase:'applied',preview:{counts:{created:1},generationPreflight:{basis:'current',nodes:[{nodeId:'IMAGE',type:'promptNode',mode:'generation'},{nodeId:'VIDEO',type:'videoNode',mode:'generation'},{nodeId:'SOURCE',type:'imageNode',mode:'reference'},{nodeId:'TEXT',type:'textNode',mode:'generation'}]}}},language:'en-US',projectName:'QA',disabled:false,hasMessage:false,onPrepareGeneration:noAction,onConfigure:noAction,onRequest:noAction,onDismiss:noAction,onRestart:noAction,onEdit:noAction,onValidate:noAction,onApply:noAction,onUndo:noAction,onView:noAction}));
 assert(html.includes('Review generation · Image 1'));assert(html.includes('Review generation · Video 2'));assert(!html.includes('Review generation · Text'));assert(!html.includes('Generation completed'));
});
test('task card begins unconfirmed, has three complete locales, and does not present task completion as proof of saving',()=>{
 for(const language of ['zh-CN','zh-TW','en-US']){
  const html=renderToStaticMarkup(jsx(AssistantGenerationTaskCard,{ownerId:'QA_OWNER',projectId:'QA_PROJECT',nodeId:'QA_NODE',language,onView:noAction}));
  assert(html.includes('data-task-status="reading"'));assert(!html.includes('data-task-status="completed"'));
  if(language==='en-US'){assert(!/[\u3400-\u9fff]/.test(html));assert(html.includes('Checking local task records'));}
 }
 const source=fs.readFileSync(require.resolve('../src/renderer/components/assistant-generation-task-card.tsx'),'utf8');
 assert(!source.includes('setInterval('));assert(source.includes('materialize:false'));assert(source.includes('task.projectId!==projectId'));assert(source.includes('clearTimeout(timer)'));
});
