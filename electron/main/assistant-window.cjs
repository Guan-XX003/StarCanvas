// A native presentation of the EXISTING renderer controller. No second app,
// preload, conversation repository, canvas owner or credentials live here.
const owners = new Map();
const path=require('node:path');
const FRAME = 'starcanvas-assistant';
function createAssistantWindowShell(owner, baseUrl, {openExternal=()=>{}}={}) {
  const target = new URL('/assistant-window.html', baseUrl).href;
  let child=null, bounds=null, readyTimer=null, disposed=false, sealed=false;
  const live=()=>child&&!child.isDestroyed();
  const trusted=event=>!disposed&&!owner.isDestroyed()&&event?.sender===owner.webContents&&event.senderFrame===owner.webContents.mainFrame&&owner.webContents.getURL()===new URL('/index.html',baseUrl).href;
  function revealOwner(){if(owner.isDestroyed())return;if(owner.isMinimized())owner.restore();owner.show();owner.focus();}
  function decision(details){
    if(disposed||owner.isDestroyed()||owner.webContents.getURL()!==new URL('/index.html',baseUrl).href)return {action:'deny'};
    if(details.url!==target||details.frameName!==FRAME||details.postBody)return {action:'deny'};
    if(live()){child.show();child.focus();return {action:'deny'};}
    return {action:'allow',outlivesOpener:false,overrideBrowserWindowOptions:{
      title:'StarCanvas Assistant',width:520,height:680,minWidth:360,minHeight:360,
      frame:true,movable:true,resizable:true,minimizable:true,maximizable:true,
      ...(bounds||{}),show:false,autoHideMenuBar:true,backgroundColor:'#23262d',
      // The same-site DOM portal requires the opener's sandbox state. Neither
      // document has Node integration; the child has only an inert preload.
      webPreferences:{preload:path.join(__dirname,'../preload/assistant-window.cjs'),sandbox:false,contextIsolation:true,nodeIntegration:false,
        webviewTag:false,webSecurity:true,backgroundThrottling:false}
    }};
  }
  function created(win,details){
    if(details.url!==target||details.frameName!==FRAME||live()){win.destroy();return;}
    child=win;sealed=false;const oldThrottle=owner.webContents.getBackgroundThrottling();
    owner.webContents.setBackgroundThrottling(false);
    win.webContents.setWindowOpenHandler(({url})=>{openExternal(url);return {action:'deny'};});
    for(const name of ['will-navigate','will-frame-navigate'])win.webContents.on(name,event=>{
      // window.open's first navigation must reach the script-free shell. Once
      // loaded no navigation (even to that same shell) may replace the portal.
      if(sealed||event.url!==target||event.isMainFrame===false)event.preventDefault();
    });
    win.webContents.on('will-redirect',event=>event.preventDefault());
    win.webContents.once('did-finish-load',()=>{sealed=true;});
    win.webContents.on('will-attach-webview',event=>event.preventDefault());
    win.webContents.on('render-process-gone',()=>{if(!win.isDestroyed())win.destroy();});
    readyTimer=setTimeout(()=>{if(child===win&&!win.isDestroyed())win.close();},15000);
    win.once('closed',()=>{
      clearTimeout(readyTimer);readyTimer=null;if(child===win)child=null;
      if(owner.isDestroyed()||owner.webContents.isDestroyed?.())return;
      owner.webContents.setBackgroundThrottling(oldThrottle);
      owner.webContents.send('wanjuan:assistant-window-closed');
      // Do not leave an invisible App after the last visible native window closes.
      if(!owner.isVisible()||owner.isMinimized())revealOwner();
    });
    win.on('resize',()=>{if(!win.isDestroyed()&&!win.isMaximized()){
      const value=win.getBounds();bounds={width:value.width,height:value.height};
    }});
  }
  function control(event,command){
    if(!trusted(event))return {ok:false,code:'ASSISTANT_WINDOW_UNTRUSTED'};
    if(!['state','ready','pin','unpin','focus','focus-main'].includes(command))return {ok:false,code:'ASSISTANT_WINDOW_INVALID'};
    if(command==='focus-main')revealOwner();
    else if(command!=='state'){
      if(!live())return {ok:false,code:'ASSISTANT_WINDOW_CLOSED'};
      if(command==='ready'){clearTimeout(readyTimer);readyTimer=null;child.show();child.focus();}
      if(command==='pin'||command==='unpin')child.setAlwaysOnTop(command==='pin');
      if(command==='focus'){if(child.isMinimized())child.restore();child.show();child.focus();}
    }
    return {ok:true,value:{open:!!live(),pinned:!!live()&&child.isAlwaysOnTop()}};
  }
  const closeChild=()=>{if(live())child.destroy();};
  owner.webContents.on('did-start-navigation',(_event,_url,_inPlace,mainFrame)=>{if(mainFrame)closeChild();});
  owner.webContents.on('render-process-gone',closeChild);
  owner.once('closed',()=>{disposed=true;closeChild();clearTimeout(readyTimer);});
  return {decision,created,control,keepAlive:()=>!!live()};
}
function installAssistantWindowShell(owner,baseUrl,options){
  const shell=createAssistantWindowShell(owner,baseUrl,options),id=owner.webContents.id;owners.set(id,shell);
  owner.once('closed',()=>owners.delete(id));
  owner.webContents.on('did-create-window',shell.created);
  // Only normal window close hides the renderer owner. Real App quit still
  // passes through all existing local-save participants before destroying it.
  owner.__wanjuanKeepAliveForAssistant=shell.keepAlive;
  return shell;
}
function controlAssistantWindow(event,command){return owners.get(event?.sender?.id)?.control(event,command)||{ok:false,code:'ASSISTANT_WINDOW_UNTRUSTED'};}
module.exports={FRAME,createAssistantWindowShell,installAssistantWindowShell,controlAssistantWindow};
