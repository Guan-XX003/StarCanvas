const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),{EventEmitter}=require('node:events'),crypto=require('node:crypto'),ts=require('typescript');
const {createDesktopCloseCoordinator}=require('../electron/main/desktop-close-coordinator.cjs');
const oldTs=require.extensions['.ts'],oldLoad=Module._load;
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:f}).outputText,f);
const {createDesktopCloseRegistry,freezeDesktopCloseDocuments}=require('../src/renderer/lib/desktop-close.ts');
let registered;
Module._load=function(name,parent,...args){
 if(parent?.filename.endsWith('useSaveCanvasState.ts')){
  if(name==='react')return {useCallback:fn=>fn,useRef:value=>({current:value}),useEffect:fn=>fn()};
  if(name==='../lib/desktop-close')return {registerDesktopCloseParticipant:(name,fn)=>{assert.equal(name,'canvas');registered=fn;return()=>{};}};
 }
 return oldLoad.call(this,name,parent,...args);
};
const {useSaveCanvasState}=require('../src/renderer/hooks/useSaveCanvasState.ts');Module._load=oldLoad;
const gate=()=>{let release;const promise=new Promise(r=>release=r);return {promise,release};};
const tick=()=>new Promise(r=>setImmediate(r));
const until=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,2));}assert.fail('expected local close state did not settle');};
function fixture(t,{timeout=100,prepare=async()=>({ok:true}),second}={}){
 let frozen=0,thawed=0;const notices=[],reports=[];
 const registry=createDesktopCloseRegistry(()=>{frozen++;return()=>thawed++;},code=>notices.push(code));registry.register('canvas',prepare);if(second)registry.register('assistant',second);
 const app=new EventEmitter(),windows=[];app.exited=false;app.quit=()=>{
  const event={prevented:false,preventDefault(){this.prevented=true;}};app.emit('before-quit',event);if(event.prevented)return;
  for(const win of windows)if(!win.destroyed)win.close();
  if(windows.some(w=>!w.destroyed))return;app.emit('will-quit');app.exited=true;
 };
 let calls=0;
 function makeWindow(reg=registry){
  const win=new EventEmitter();win.id=windows.length+1;win.destroyed=false;win.isDestroyed=()=>win.destroyed;
  win.url='http://127.0.0.1:54321/index.html';win.beforeUnloadBlocks=false;
  win.webContents=new EventEmitter();win.webContents.isDestroyed=win.isDestroyed;win.webContents.getURL=()=>win.url;
  win.webContents.executeJavaScript=script=>{
   if(script.includes('api.prepare')){calls++;const id=script.match(/api\.prepare\("([a-f0-9-]+)"\)/)[1];return reg.prepare(id);}
   const args=script.match(/\.release\((.*)\)/);if(args){const [id,code]=JSON.parse('['+args[1]+']');reg.release(id,code);}return Promise.resolve();
  };
  win.close=()=>{if(win.destroyed)return;const e={prevented:false,preventDefault(){this.prevented=true;}};win.emit('close',e);if(e.prevented)return;if(win.beforeUnloadBlocks){win.webContents.emit('will-prevent-unload');return;}win.destroyed=true;win.emit('closed');};
  windows.push(win);return win;
 }
 const manager=createDesktopCloseCoordinator({app,getBaseUrl:()=> 'http://127.0.0.1:54321',report:code=>reports.push(code),timeoutMs:timeout});
 const win=makeWindow();manager.registerWindow(win);t.after(()=>manager.dispose());
 return {registry,app,win,manager,windows,makeWindow,notices,reports,get calls(){return calls;},get frozen(){return frozen;},get thawed(){return thawed;}};
}
function canvas(){
 const writes=[],mirror=[],refs=[],notices=[],project=crypto.randomUUID();
 global.window={wanjuanDesktop:{syncProjectReferences:async x=>refs.push(x)}};
 global.chrome={storage:{local:{set:async x=>mirror.push(x)}}};
 global.prepareProjectMediaStateForPersistence=async x=>x;global.collectProjectFileReferences=()=>[];
 delete global.__wanjuanStorageMaintenanceRunning;delete global.__wanjuanProjectMigrationLocks;
 const deps={WanJuanStripRuntimeNodeData:x=>x,canvasStateKeyPrefix:'c-',desktopCanvasMirrorPrefix:'m-',edgesRef:{current:[]},externalizeProjectCanvasState:async x=>x,historyIndexRef:{current:0},isRestoringRef:{current:true},localforageModule:{default:{getItem:async()=>({nodes:[],edges:[]}),setItem:async(k,v)=>writes.push({k,v})}},nodesRef:{current:[{id:'qa-text',type:'textNode',position:{x:0,y:0},data:{text:'SYNTHETIC_FRESH_TEXT'}}]},projectIdRef:{current:project},setHistory(){},setHistoryIndex(){},shouldFitViewRef:{current:true},showToast:x=>notices.push(x)};
 const hook=useSaveCanvasState(deps),prepare=registered;return {deps,hook,prepare,writes,mirror,refs,notices};
}
test('a normal rapid close waits for the actual fresh canvas primary commit, refs and mirror without a debounce sleep',async t=>{
 const c=canvas(),primary=gate(),mirror=gate();let writing=false,mirroring=false;
 c.deps.localforageModule.default.setItem=async(k,v)=>{writing=true;await primary.promise;c.writes.push({k,v});};
 global.chrome.storage.local.set=async x=>{mirroring=true;await mirror.promise;c.mirror.push(x);};
 const f=fixture(t,{prepare:c.prepare});f.win.close();await until(()=>writing);assert(!f.win.destroyed);assert.equal(c.writes.length,0);
 primary.release();await until(()=>mirroring);assert(!f.win.destroyed);assert.equal(c.refs.length,1);
 mirror.release();await until(()=>f.win.destroyed);assert.equal(c.writes[0].v.nodes[0].data.text,'SYNTHETIC_FRESH_TEXT');assert.equal(f.calls,1);assert.equal(f.frozen,1);
});
test('App quit and repeated close intents share the same local save, and do not quit until every local owner settles',async t=>{
 const a=gate(),b=gate();let ca=0,cb=0;
 const f=fixture(t,{prepare:async()=>{ca++;await a.promise;return {ok:true};},second:async()=>{cb++;await b.promise;return {ok:true};}});
 f.win.close();f.win.close();f.app.quit();f.app.quit();await tick();assert.equal(ca,1);assert.equal(cb,1);assert(!f.app.exited);
 a.release();await tick();assert(!f.app.exited);b.release();await until(()=>f.app.exited);assert.equal(f.calls,1);
});
test('closing a main window with an independent assistant hides its owner, but real quit still waits for saves',async t=>{
 const slow=gate(),f=fixture(t,{prepare:async()=>{await slow.promise;return {ok:true};}});let hidden=0;
 f.win.__wanjuanKeepAliveForAssistant=()=>true;f.win.hide=()=>hidden++;
 f.win.close();await tick();assert.equal(hidden,1);assert(!f.win.destroyed);assert.equal(f.calls,0);
 f.app.quit();await tick();assert.equal(f.calls,1);assert(!f.app.exited);slow.release();await until(()=>f.app.exited);
});
test('a failed local save retains the window, restores input and reports only a fixed code',async t=>{
 let fail=true;const f=fixture(t,{prepare:async()=>{if(fail)throw Error('PRIVATE_SYNTHETIC_CONTENT');return {ok:true};}});
 f.app.quit();await until(()=>f.reports.length>0);assert(!f.app.exited);assert(!f.win.destroyed);assert.equal(f.thawed,1);assert(!JSON.stringify([f.reports,f.notices]).includes('PRIVATE_'));
 fail=false;f.app.quit();await until(()=>f.app.exited);
});
test('timeout is not a completed save, late completion cannot auto-close, and retries do not duplicate a live prepare',async t=>{
 const slow=gate();let calls=0;const f=fixture(t,{timeout:15,prepare:async()=>{calls++;if(calls===1)await slow.promise;return {ok:true};}});
 f.app.quit();await until(()=>f.reports.includes('DESKTOP_CLOSE_TIMEOUT'));assert(!f.win.destroyed);
 f.app.quit();await tick();assert.equal(calls,1);slow.release();await tick();await tick();assert(!f.win.destroyed);
 f.app.quit();await until(()=>f.app.exited);assert.equal(calls,2);
});
test('same-origin index document only: no close script is evaluated in another origin or path',async t=>{
 const f=fixture(t);for(const url of ['https://example.com/index.html','http://127.0.0.1:54321/other.html']){f.win.url=url;f.app.quit();await tick();await tick();assert.equal(f.calls,0);assert(!f.app.exited);}
});
test('an existing beforeunload guard is never overridden after preparation',async t=>{
 const f=fixture(t);f.win.beforeUnloadBlocks=true;f.app.quit();await until(()=>f.reports.includes('DESKTOP_CLOSE_CHANGED'));assert(!f.win.destroyed);assert(!f.app.exited);assert.equal(f.thawed,1);
});
test('new windows appearing during a quit invalidate that preparation',async t=>{
 const slow=gate(),f=fixture(t,{prepare:async()=>{await slow.promise;return {ok:true};}});f.app.quit();await tick();const second=f.makeWindow();f.manager.registerWindow(second);slow.release();await until(()=>f.reports.includes('DESKTOP_CLOSE_CHANGED'));assert(!f.app.exited);assert(f.windows.every(w=>!w.destroyed));
});
test('a primary success followed by reference failure is not a successful close receipt',async t=>{
 const c=canvas();global.window.wanjuanDesktop.syncProjectReferences=async()=>{throw Error('SYNTHETIC_PRIVATE_PATH');};
 const f=fixture(t,{prepare:c.prepare}),old=console.error;console.error=()=>{};try{f.win.close();await until(()=>f.reports.length>0);}finally{console.error=old;}
 assert.equal(c.writes.length,1);assert(!f.win.destroyed);assert.equal(c.mirror.length,0);assert(c.notices.length);
});
test('an explicit reference-sync refusal is not mistaken for a successful save',async t=>{
 const c=canvas();global.window.wanjuanDesktop.syncProjectReferences=async()=>({ok:false,error:'PROJECT_REFERENCE_MISSING',missing:['PRIVATE_PATH']});
 const f=fixture(t,{prepare:c.prepare}),old=console.error;console.error=()=>{};try{f.win.close();await until(()=>f.reports.length>0);}finally{console.error=old;}
 assert(!f.win.destroyed);assert.equal(c.writes.length,1);assert.equal(c.mirror.length,0);assert(!JSON.stringify(c.notices).includes('PRIVATE_PATH'));
});
test('changing a registered owner during preparation invalidates its completion',async()=>{
 const slow=gate();const r=createDesktopCloseRegistry(()=>()=>{},()=>{}),remove=r.register('canvas',async()=>{await slow.promise;return {ok:true};});const p=r.prepare(crypto.randomUUID());await tick();remove();r.register('canvas',async()=>({ok:true}));slow.release();assert.equal((await p).ok,false);
});
test('changes during an asynchronous save cannot be acknowledged as the current canvas',async t=>{
 const c=canvas(),slow=gate();c.deps.localforageModule.default.setItem=async(k,v)=>{await slow.promise;c.writes.push({k,v});};
 const f=fixture(t,{prepare:c.prepare});f.win.close();await tick();c.deps.nodesRef.current[0].data.text='SYNTHETIC_NEWER_EDIT';slow.release();await until(()=>f.reports.length>0);assert(!f.win.destroyed);assert.equal(c.deps.nodesRef.current[0].data.text,'SYNTHETIC_NEWER_EDIT');
});
test('a failed or not-yet-loaded project is not overwritten by closing',async()=>{
 const c=canvas();c.deps.shouldFitViewRef.current=false;assert.equal((await c.prepare()).ok,true);assert.equal(c.writes.length,0);
});
test('renderer waits for all settled local owners after failure; duplicate registrations and stale releases cannot bypass the lease',async()=>{
 const slow=gate();let calls=0,thaws=0;const r=createDesktopCloseRegistry(()=>()=>thaws++,()=>{}),fn=async()=>{calls++;await slow.promise;return {ok:true};};
 const remove=r.register('canvas',fn);r.register('canvas',fn);remove();r.register('assistant',async()=>{throw Error('synthetic');});
 const id=crypto.randomUUID(),p=r.prepare(id);await tick();assert.equal((await r.prepare(crypto.randomUUID())).code,'DESKTOP_CLOSE_BUSY');r.release(crypto.randomUUID(),'DESKTOP_CLOSE_TIMEOUT');assert.equal(thaws,0);assert.equal(calls,1);
 slow.release();assert.equal((await p).ok,false);assert.equal(thaws,1);
});
test('cancelled quit cannot stop the static server; coordinator is installed before windows',()=>{
 const root=path.join(__dirname,'..');const server=fs.readFileSync(path.join(root,'electron/main/net/static-server.cjs'),'utf8');assert(server.includes('app.on("will-quit", () => server.close())'));assert(!server.includes('app.on("before-quit", () => server.close())'));
 const main=fs.readFileSync(path.join(root,'electron/main/index.cjs'),'utf8');assert(main.indexOf("getDesktopCloseCoordinator();")<main.indexOf('app.whenReady()'));
 const window=fs.readFileSync(path.join(root,'electron/main/window.cjs'),'utf8');assert(window.includes('registerWindow(win)'));
});
test('quit freezes both portal and owner inputs, then restores each previous state on failure',()=>{
 const main={inert:false},child={inert:true};let focus=0;
 const doc=root=>({getElementById:id=>id==='root'?root:null,activeElement:{isConnected:true,focus:()=>focus++}});
 const a=doc(main),b=doc(child),restore=freezeDesktopCloseDocuments([a,b,b]);assert(main.inert);assert(child.inert);
 restore();assert.equal(main.inert,false);assert.equal(child.inert,true);assert.equal(focus,2);
});
