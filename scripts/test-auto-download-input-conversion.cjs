// Run the actual conversion branches with synthetic inputs; never contact a provider.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function findSource(file, predicate) {
  const filename=path.join(__dirname,'../src/renderer/components',file);
  const tree=ts.createSourceFile(filename,fs.readFileSync(filename,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let result;function walk(node){if(predicate(node,tree))result=node;ts.forEachChild(node,walk)}walk(tree);
  assert.ok(result,`${file}: source branch found`);return result.getText(tree);
}
function compile(source){return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText}

(async()=>{
  const selection=findSource('image-node.tsx',(node,tree)=>ts.isVariableDeclaration(node)&&node.name.getText(tree)==='applySelectedMedia'&&node.initializer);
  for(const mediaUrl of ['data:image/png;base64,synthetic','file:///synthetic/upload.png']){
    const order=[],manualSelectedDataRef={current:null};
    const ctx={manualSelectedDataRef,nodeId:'qa-node',mediaKind:'image',nativePath:'',data:{},file:{name:'input.png'},
      noteManualMediaReplacement:(_id,url)=>order.push(['notify',url]),updateNodeData:(_id,patch)=>order.push(['update',patch.imageUrl]),
      wanjuanResetTianjiPortraitBindingForImage:()=>({}),wanjuanClearProjectAssetBindingsFromData:()=>({})};
    vm.runInNewContext(compile(`const ${selection}; applySelectedMedia(${JSON.stringify(mediaUrl)});`),ctx);
    assert.deepEqual(order,[['notify',mediaUrl],['update',mediaUrl]]);
    assert.equal(manualSelectedDataRef.current,mediaUrl.startsWith('data:')?mediaUrl:null);
  }
  const effect=findSource('image-node.tsx',(node,tree)=>ts.isCallExpression(node)&&node.expression.getText(tree)==='useEffect'&&node.arguments[0]?.getText(tree).includes('wjPersistRef.current === imageUrl'));
  for(const manual of [true,false]){
    const order=[],imageUrl='data:image/png;base64,synthetic';
    const ctx={imageUrl,mediaType:'image',nodeId:'qa-node',data:{},wjPersistRef:{current:''},manualSelectedDataRef:{current:manual?imageUrl:null},
      window:{wanjuanDesktop:{persistProjectAsset:async()=>({ok:true,localPath:'/synthetic/persisted.png',thumbnailLocalPath:'/synthetic/thumbnail.png'})}},
      useEffect:fn=>fn(),buildProjectMediaFileUrl:localPath=> `file://${localPath}`,
      noteManualMediaReplacement:(_id,url)=>order.push(['notify',url]),updateNodeData:(_id,patch)=>order.push(['update',patch.imageUrl]),
      wanjuanResetTianjiPortraitBindingForImage:()=>({}),wanjuanBuildProjectAssetBinding:()=>({}),console};
    vm.runInNewContext(compile(effect),ctx);await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(order,manual?[['notify','file:///synthetic/persisted.png'],['notify','file:///synthetic/thumbnail.png'],['update','file:///synthetic/persisted.png']]:[['update','file:///synthetic/persisted.png']],manual?'manual conversion and thumbnail are tagged before replacement':'generated conversion is not tagged as manual');
    assert.equal(ctx.manualSelectedDataRef.current,null);
  }
  const branch=findSource('audio-nodes.tsx',(node,tree)=>ts.isIfStatement(node)&&node.expression.getText(tree).includes('audioUrl.startsWith(`data:audio/`)')&&node.getText(tree).includes('noteManualMediaReplacement(nodeId, audioUrl)'));
  for(const input of ['data:audio/mp3;base64,YQ==','https://fixture.invalid/audio.mp3']){
    const order=[];
    const ctx={audioUrl:input,nodeId:'qa-node',selectedFile:null,atob,Uint8Array,File:class{constructor(_data,name){this.name=name}},
      URL:{createObjectURL:()=> 'blob:synthetic-input'},fetch:async url=>{assert.equal(url,'https://fixture.invalid/audio.mp3');return {ok:true,blob:async()=>({type:'audio/mpeg'})}},
      noteManualMediaReplacement:(_id,url)=>order.push(['notify',url]),updateNodeData:(_id,patch)=>order.push(['update',patch.audioUrl])};
    await vm.runInNewContext(compile(`(async()=>{${branch}})()`),ctx);
    assert.deepEqual(order,[['notify','blob:synthetic-input'],['update','blob:synthetic-input']]);
  }
  console.log('PASS_AUTO_DOWNLOAD_INPUT_CONVERSION_PROVENANCE');
})().catch(error=>{console.error(error);process.exitCode=1});
