const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {resolveApplicationTianjiPortraits:resolve,applicationTianjiPortraitMetadata:metadata}=require('../src/renderer/lib/application-tianji-portraits.ts');
const {applicationPortraitReviewCopy}=require('../src/renderer/lib/application-operation-copy.ts');
const base={config:{baseUrl:'https://qa.invalid',token:'PRIVATE_SYNTHETIC_TOKEN',syncSource:'manual'},groups:{AIGC:'qa-group'},guard:()=>{}};
const asset=(id,status='Active')=>({asset_id:id,status,image_url:'https://PRIVATE_PREVIEW.invalid/a.png',name:'PRIVATE_NAME'});
test('portrait ID assertions have strict syntax/mode/count and do not accept a caller Active proof',async()=>{
 const {parseApplicationGeneration:p}=await import('../electron/shared/application-generation-contract.mjs');
 assert.equal(p('generation.tianji',{prompt:'QA',portraitAssetIds:['asset-A']}).mode,'reference-media');
 for(const extra of [{portraitAssetIds:['asset-A','asset-A']},{portraitAssetIds:['asset://A']},{portraitAssetIds:[42]},{portraitAssetIds:['asset-A'],mode:'first-frame'},{portraitAssetIds:['asset-A'],status:'Active'},{portraitAssetIds:['asset-A'],portraitMedia:[{assetId:'asset-A',status:'Active'}]}])assert.throws(()=>p('generation.tianji',{prompt:'QA',...extra}),{code:'OPERATION_INVALID_REQUEST'});
});
test('resolver requires trusted guard/configured groups before any network and does not create a group',async()=>{
 let calls=0;const request=async()=>{calls++;assert.fail('No query');};
 await assert.rejects(resolve(['asset-A'],{...base,guard:undefined,request}),{code:'OPERATION_PERMISSION_REQUIRED'});
 await assert.rejects(resolve(['asset-A'],{...base,groups:{},request}),{code:'OPERATION_CONFIGURATION_REQUIRED'});
 await assert.rejects(resolve(['asset-A'],{...base,groups:{AIGC:'https://injected.invalid'},request}),{code:'OPERATION_CONFIGURATION_REQUIRED'});assert.equal(calls,0);
});
test('actual Tianji request sends only existing read-only list parameters and returns ordered metadata without preview/key/name',async t=>{
 const original={fetch:global.fetch,window:global.window,chrome:global.chrome};t.after(()=>Object.assign(global,original));global.window={};let calls=0;
 global.fetch=async(url,init)=>{calls++;assert.equal(String(url),'https://qa.invalid/api/cut/model/get-list-assets');assert.equal(init.method,'POST');assert.deepEqual(JSON.parse(init.body),{group_ids:'qa-group',group_type:'AIGC',statuses:'Active',PageNumber:'1',PageSize:'100',SortBy:'CreateTime',SortOrder:'Desc'});return Response.json({code:200,data:{list:[asset('asset-B'),asset('asset-A')]}});};
 const result=await resolve(['asset-A','asset-B'],base);assert.deepEqual(result,[{assetId:'asset-A',groupType:'AIGC',status:'Active'},{assetId:'asset-B',groupType:'AIGC',status:'Active'}]);assert.equal(calls,1);assert(!JSON.stringify(result).includes('PRIVATE'));
});
test('provider-filtered missing status follows the existing list contract, but explicit pending/failed/local uploads never become ready',async()=>{
 const missingStatus={asset_id:'asset-A'};assert.equal((await resolve(['asset-A'],{...base,request:async()=>({list:[missingStatus]})}))[0].status,'Active');assert(!Object.hasOwn(missingStatus,'__wanjuanTianjiListStatus'));
 for(const item of [asset('asset-A','Pending'),asset('asset-A','Rejected'),{...asset('asset-A'),localUploaded:true}])await assert.rejects(resolve(['asset-A'],{...base,request:async()=>({list:[item]})}),{code:'OPERATION_MEDIA_NOT_READY'});
});
test('missing/ambiguous IDs fail rather than substituting a preview or another identity',async()=>{
 await assert.rejects(resolve(['asset-A'],{...base,request:async()=>({list:[asset('asset-B')]})}),{code:'OPERATION_MEDIA_NOT_READY'});
 await assert.rejects(resolve(['asset-A'],{...base,groups:{AIGC:'qa-group',LivenessFace:'qa-live'},request:async()=>({list:[asset('asset-A')]})}),{code:'OPERATION_MEDIA_INVALID'});
});
test('bounded pagination finds later IDs and rejects truncated or oversized list evidence',async()=>{
 const pages=[];const result=await resolve(['asset-C'],{...base,pageSize:2,request:async(_c,_path,{params})=>{pages.push(params.PageNumber);return {list:params.PageNumber==='1'?[asset('asset-A'),asset('asset-B')]:[asset('asset-C')],TotalCount:3};}});assert.deepEqual(pages,['1','2']);assert.equal(result[0].assetId,'asset-C');
 await assert.rejects(resolve(['asset-A'],{...base,pageSize:1,maxPages:2,request:async()=>({list:[asset('asset-A')],TotalCount:100})}),{code:'OPERATION_LIMIT'});
 await assert.rejects(resolve(['asset-A'],{...base,pageSize:1,request:async()=>({list:[asset('asset-A'),asset('asset-B')]})}),{code:'OPERATION_RESULT_LIMIT'});
});
test('query timeout is bounded, aborts the request and never retries or discloses provider errors',async()=>{
 let calls=0;await assert.rejects(resolve(['asset-A'],{...base,timeoutMs:5,request:async(_c,_p,{signal})=>{calls++;return new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('PRIVATE_UPSTREAM_BODY')),{once:true}));}}),{code:'OPERATION_MEDIA_NOT_READY'});assert.equal(calls,1);
 await assert.rejects(resolve(['asset-A'],{...base,request:async()=>{throw Error('PRIVATE_TOKEN_AND_BODY');}}),e=>e.code==='OPERATION_MEDIA_NOT_READY'&&!e.message.includes('PRIVATE'));
});
test('project/selection invalidation after a query stops before any next page or result capability',async()=>{
 let current=true,calls=0;await assert.rejects(resolve(['asset-A'],{...base,guard:()=>{if(!current)throw Object.assign(Error('PLAN_STALE'),{code:'PLAN_STALE'});},request:async()=>{calls++;current=false;return {list:[asset('asset-A')]};}}),{code:'PLAN_STALE'});assert.equal(calls,1);
});
test('private portrait metadata rejects IDs/order/status/extra fields from an untrusted completion',()=>{
 const valid=[{assetId:'asset-A',groupType:'AIGC',status:'Active'}];assert.deepEqual(metadata(['asset-A'],valid),valid);
 for(const values of [[],[{...valid[0],assetId:'asset-B'}],[{...valid[0],status:'Pending'}],[{...valid[0],url:'https://PRIVATE.invalid'}],[{...valid[0],groupType:'unknown'}]])assert.throws(()=>metadata(['asset-A'],values),{code:'OPERATION_MEDIA_INVALID'});
});
test('portrait review copy is complete in three locales and explains verification rather than claiming pre-approval Active status',()=>{
 for(const language of ['zh-CN','zh-TW','en-US']){const c=applicationPortraitReviewCopy(language);assert(c.ids&&c.note);}assert.match(applicationPortraitReviewCopy('en-US').note,/After approval/);assert.match(applicationPortraitReviewCopy('zh-CN').note,/不上传预览图片/);
});
