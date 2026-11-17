const {test}=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),path=require('node:path');
const {createAssistantWindowShell,installAssistantWindowShell}=require('../electron/main/assistant-window.cjs');
function windowFixture(){
 const w=new EventEmitter();w.destroyed=false;w.visible=true;w.minimized=false;w.pinned=false;w.throttled=true;
 w.isDestroyed=()=>w.destroyed;w.isVisible=()=>w.visible;w.isMinimized=()=>w.minimized;w.isMaximized=()=>false;
 w.show=()=>w.visible=true;w.hide=()=>w.visible=false;w.focus=()=>w.focused=true;w.restore=()=>w.minimized=false;
 w.setAlwaysOnTop=v=>w.pinned=v;w.isAlwaysOnTop=()=>w.pinned;w.getBounds=()=>({x:0,y:0,width:600,height:720});
 w.webContents=new EventEmitter();w.webContents.mainFrame={};w.webContents.getURL=()=>w.url;w.url='http://127.0.0.1:3210/index.html';
 w.webContents.setWindowOpenHandler=fn=>w.popup=fn;w.webContents.getBackgroundThrottling=()=>w.throttled;w.webContents.setBackgroundThrottling=v=>w.throttled=v;w.sent=[];w.webContents.send=(...args)=>w.sent.push(args);
 w.destroy=w.close=()=>{if(w.destroyed)return;w.destroyed=true;w.emit('closed');};
 return w;
}
function fixture(t){
 const owner=windowFixture(),external=[],shell=createAssistantWindowShell(owner,'http://127.0.0.1:3210',{openExternal:url=>external.push(url)});
 const event={sender:owner.webContents,senderFrame:owner.webContents.mainFrame},details={url:'http://127.0.0.1:3210/assistant-window.html',frameName:'starcanvas-assistant'};
 t.after(()=>owner.close());return {owner,shell,event,details,external};
}
test('native window is limited to exact owned origin/path/name; no inherited preload or second app',t=>{
 const {shell,owner,details}=fixture(t),options=shell.decision(details);assert.equal(options.action,'allow');
 assert.equal(options.outlivesOpener,false);assert.equal(options.overrideBrowserWindowOptions.parent,undefined);
 const p=options.overrideBrowserWindowOptions.webPreferences;assert.equal(path.basename(p.preload),'assistant-window.cjs');assert.equal(p.nodeIntegration,false);assert.equal(p.contextIsolation,true);assert.equal(p.webviewTag,false);assert.equal(p.webSecurity,true);
 for(const change of [{url:'https://example.com/assistant-window.html'},{url:details.url+'?key=x'},{url:details.url+'#x'},{frameName:'other'},{postBody:{data:[]}}])assert.equal(shell.decision({...details,...change}).action,'deny');
 owner.url='http://127.0.0.1:3210/other.html';assert.equal(shell.decision(details).action,'deny');
});
test('only one native assistant, exact-main-frame controls, pin and hidden-owner recovery',t=>{
 const {shell,owner,event,details}=fixture(t),child=windowFixture();shell.created(child,details);
 assert(shell.keepAlive());assert.equal(owner.throttled,false);assert.equal(shell.decision(details).action,'deny');assert(child.focused);
 assert.equal(shell.control({...event,senderFrame:{}},'pin').ok,false);assert.equal(shell.control({...event,sender:child.webContents},'pin').ok,false);
 assert.equal(shell.control(event,'executeJavaScript').ok,false);assert.equal(shell.control(event,'pin').value.pinned,true);assert(child.pinned);
 assert.equal(shell.control(event,'unpin').value.pinned,false);assert.equal(shell.control(event,'ready').ok,true);
 owner.hide();owner.minimized=true;child.close();assert(owner.visible);assert(!owner.minimized);assert.equal(owner.throttled,true);assert(!shell.keepAlive());assert.equal(owner.sent.length,1);
 assert.equal(shell.control(event,'pin').code,'ASSISTANT_WINDOW_CLOSED');
});
test('all child navigation and webviews are denied; reloading/destroying owner closes its presentation',t=>{
 const {shell,owner,details}=fixture(t),child=windowFixture();shell.created(child,details);
 let initialBlocked=false;child.webContents.emit('will-frame-navigate',{url:details.url,isMainFrame:true,preventDefault:()=>initialBlocked=true});assert(!initialBlocked);
 child.webContents.emit('did-finish-load');
 for(const name of ['will-navigate','will-redirect','will-frame-navigate','will-attach-webview']){let prevented=false;child.webContents.emit(name,{preventDefault:()=>prevented=true});assert(prevented,name);}
 assert.equal(child.popup({url:'https://example.com'}).action,'deny');
 owner.webContents.emit('did-start-navigation',{},'http://127.0.0.1:3210/index.html',false,true);assert(child.destroyed);
 const second=windowFixture();shell.created(second,details);owner.close();assert(second.destroyed);
});
test('mismatched or duplicate native windows are destroyed rather than gaining presentation ownership',t=>{
 const {shell,details}=fixture(t),a=windowFixture(),b=windowFixture(),bad=windowFixture();
 shell.created(bad,{...details,url:'https://example.com'});assert(bad.destroyed);shell.created(a,details);shell.created(b,details);assert(b.destroyed);assert(!a.destroyed);
});
test('script-free shell is public build input; portal does not mount another App or transmit state',()=>{
 const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'src/renderer/public/assistant-window.html'),'utf8');
 assert(!html.includes('<script'));assert(html.includes("script-src 'none'"));assert(html.includes("connect-src 'none'"));
 const hook=fs.readFileSync(path.join(root,'src/renderer/hooks/useAssistantDesktopWindow.ts'),'utf8');assert(!hook.includes('postMessage('));assert(!hook.includes('JSON.stringify('));assert(!hook.includes('createRoot('));assert(hook.includes('registerDesktopCloseDocument'));
 const ui=fs.readFileSync(path.join(root,'src/renderer/components/assistant-onboarding.tsx'),'utf8');assert(ui.includes('createPortal(surface,desktop.host)'));assert(ui.includes('workbenchRequested&&!desktop.host'));
});
test('closed owner cleanup never accesses a destroyed BrowserWindow webContents getter',()=>{
 const owner=windowFixture(),wc=owner.webContents;wc.id=9991;
 Object.defineProperty(owner,'webContents',{get(){if(owner.destroyed)throw Error('OBJECT_DESTROYED');return wc;}});
 installAssistantWindowShell(owner,'http://127.0.0.1:3210');assert.doesNotThrow(()=>owner.close());
});
