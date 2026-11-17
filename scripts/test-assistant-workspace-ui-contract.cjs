const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),Module=require('node:module');
require.extensions['.ts']=(module,file)=>module._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {jsx}=require('react/jsx-runtime'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const panelPath=path.resolve(__dirname,'../src/renderer/components/agent-config-panel.tsx'),compiled=new Module(panelPath,module);compiled.filename=panelPath;compiled.paths=module.paths;
// Static contract inspection does not mount the dialog. Native QA exercises
// its focus/Escape lifecycle; refs/effects here are deliberately inert.
const normalRequire=compiled.require.bind(compiled);compiled.require=name=>name==='react'?{...React,useSyncExternalStore:(_subscribe,_read,ssr)=>ssr(),useRef:value=>({current:value}),useEffect:()=>{}}:normalRequire(name);
compiled._compile(ts.transpileModule(fs.readFileSync(panelPath,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:panelPath}).outputText,panelPath);
const {WanJuanAgentConfigPanel}=compiled.exports;
const {assistantWorkspaceTaskLabel}=require('../src/renderer/lib/assistant-workspace-task-copy.ts');
const {exportAssistantWorkspace,readAssistantWorkspaceBackup}=require('../src/renderer/lib/assistant-workspace-backup-client.ts');
const {decryptPortableBackup}=require('../src/renderer/lib/portable-backup-crypto.ts');
function panelProps(language='en-US'){
 return {language,agentModelOptions:['other-model'],agentTheme:{},apiConfigs:[{id:'manual',name:'MANUAL_API'}],selectedAgent:{id:'private-role',name:'PRIVATE_中文',model:'retained-model',apiConfigId:'manual',systemPrompt:'PRIVATE_SYSTEM',temperature:0,knowledgeFiles:[{id:'file',name:'PRIVATE_FILE.txt',content:'PRIVATE_CONTENT',size:4096,totalChars:15,chunks:['PRIVATE_CONTENT'],importedAt:1700000000000}]},stagedSave:true,textApiConfigId:'global',textModelApiBindings:{'other-model':'global'},setAgentConfigOpen:()=>{},updateSelectedAgent:()=>{},importAgentKnowledgeFile:()=>{},removeAgentKnowledgeFile:()=>{}};
}
function descendants(element,all=[]){if(element&&typeof element==='object'&&element.props){all.push(element);for(const child of [element.props.children].flat(Infinity))descendants(child,all);}return all;}
test('role editor directly renders all three locales without translating private values',()=>{
 for(const [language,title,save,memory]of [['zh-CN','角色设置','完成并保存','仅当前会话（默认）'],['zh-TW','角色設定','完成並儲存','僅目前對話（預設）'],['en-US','Role settings','Save changes','This conversation only (default)']]){
  const html=renderToStaticMarkup(jsx(WanJuanAgentConfigPanel,panelProps(language)));assert(html.includes(title));assert(html.includes(save));assert(html.includes(memory));assert(html.includes('PRIVATE_中文'));assert(html.includes('PRIVATE_CONTENT'));assert(html.includes('retained-model'));assert(html.includes('data-wanjuan-i18n-skip="true"'));
  if(language==='en-US'){const noPrivate=html.replaceAll('PRIVATE_中文','PRIVATE');assert.doesNotMatch(noPrivate,/[\u3400-\u9fff]/);assert.match(html,/Applies after saving/);}
 }
});
test('role model changes preserve explicit API binding, missing model options and zero temperature',()=>{
 const patches=[],props=panelProps();props.updateSelectedAgent=patch=>patches.push(patch);
 const elements=descendants(WanJuanAgentConfigPanel(props)),model=elements.find(e=>e.type==='select'&&e.props.value==='retained-model');
 assert(model);assert(descendants(model).some(e=>e.type==='option'&&e.props.value==='retained-model'));model.props.onChange({target:{value:'other-model'}});assert.deepEqual(patches,[{model:'other-model'}]);assert(elements.some(e=>e.type==='input'&&e.props.value===0));
});
test('password backup writes only the existing authenticated envelope; decrypt/import is staged, not applied',async()=>{
 const password='SYNTHETIC_BACKUP_PASSWORD_12',snapshot={format:'starcanvas-assistant-workspace',version:1,roles:[{id:'role-11111111-1111-4111-8111-111111111111',archived:false,configuration:{name:'PRIVATE_BACKUP_CONTENT'}}],sessions:[],media:[]},writes=[],calls=[];
 const controller={exportBackup:async scope=>{calls.push(scope);return snapshot;}},bridge={showInputDialog:async options=>{assert.equal(options.password,true);return password;},saveDownload:async payload=>{writes.push(payload);return {ok:true};}};
 assert.equal((await exportAssistantWorkspace(controller,bridge,'all','en-US')).cancelled,false);assert.deepEqual(calls,['all']);assert.equal(writes.length,1);assert.equal(writes[0].encryptedBackup,true);assert.equal(writes[0].saveAsFolder,true);assert.doesNotMatch(writes[0].text,/PRIVATE_BACKUP_CONTENT|SYNTHETIC_BACKUP_PASSWORD/);
 const envelope=JSON.parse(writes[0].text);assert.deepEqual(await decryptPortableBackup(envelope,password),snapshot);
 const decoded=await readAssistantWorkspaceBackup(new File([writes[0].text],'encrypted.json'),bridge,'en-US');assert.deepEqual(decoded,snapshot);assert.equal(writes.length,1);
 await assert.rejects(readAssistantWorkspaceBackup(new File([writes[0].text],'encrypted.json'),{...bridge,showInputDialog:async()=> 'WRONG_PASSWORD'},'en-US'),{code:'BACKUP_DECRYPT_FAILED'});
});
test('cancel, mismatch and plaintext import never start snapshot access, save or restore',async()=>{
 let calls=0;const controller={exportBackup:async()=>{calls++;}},bridge={saveDownload:async()=>{calls++;},showInputDialog:async()=>null};
 assert.equal((await exportAssistantWorkspace(controller,bridge,'all','zh-CN')).cancelled,true);assert.equal(calls,0);
 const values=['SYNTHETIC_PASSWORD_A','SYNTHETIC_PASSWORD_B'];await assert.rejects(exportAssistantWorkspace(controller,{...bridge,showInputDialog:async()=>values.shift()},'all','zh-CN'),{code:'BACKUP_PASSWORD_MISMATCH'});assert.equal(calls,0);
 await assert.rejects(readAssistantWorkspaceBackup(new File(['{"format":"starcanvas-assistant-workspace"}'],'plain.json'),{...bridge,showInputDialog:async()=>{calls++;}},'zh-CN'),{code:'ASSISTANT_BACKUP_ENCRYPTION_REQUIRED'});assert.equal(calls,0);
});
test('queue, interruption and unavailable status labels are distinct and localized',()=>{
 for(const language of ['zh-CN','zh-TW','en-US']){
  const labels=['queued','running','interrupted','unavailable'].map(status=>assistantWorkspaceTaskLabel(status,language));assert(labels.every(Boolean));assert.equal(new Set(labels).size,4);
 }
 assert.equal(assistantWorkspaceTaskLabel('queued','en-US'),'Queued');assert.equal(assistantWorkspaceTaskLabel('unknown','en-US'),'');
});
