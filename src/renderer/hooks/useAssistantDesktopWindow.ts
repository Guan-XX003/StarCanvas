import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {registerDesktopCloseDocument} from '../lib/desktop-close';

/** One React/controller owner renders into a script-free same-origin native
 * window. No conversation/key transfer, storage mirror or second App mount. */
export function useAssistantDesktopWindow() {
  const [host,setHost]=useState<HTMLElement|null>(null),[opening,setOpening]=useState(false);
  const [pinned,setPinned]=useState(false),[failed,setFailed]=useState(false);
  const child=useRef<Window|null>(null),cleanup=useRef<()=>void>(()=>{}),alive=useRef(true);
  const control=(command:string)=>window.wanjuanDesktop?.assistantWindowControl?.(command);
  function finish(expected:Window){
    if(child.current!==expected)return;
    cleanup.current();cleanup.current=()=>{};child.current=null;
    if(alive.current){setHost(null);setOpening(false);setPinned(false);}
  }
  useEffect(()=>{
    alive.current=true;
    const unsubscribe=window.wanjuanDesktop?.onAssistantWindowClosed?.(()=>{
      const current=child.current;if(current?.closed)finish(current);
    });
    return()=>{alive.current=false;unsubscribe?.();const current=child.current;cleanup.current();child.current=null;current?.close();};
  },[]);
  useLayoutEffect(()=>{
    if(!host)return;
    const unregister=registerDesktopCloseDocument(host.ownerDocument);
    void control('ready').then((result:any)=>{if(!result?.ok&&alive.current)setFailed(true);});
    return unregister;
  },[host]);
  function open(){
    setFailed(false);
    if(child.current&&!child.current.closed){void control('focus');return;}
    if(typeof window.wanjuanDesktop?.assistantWindowControl!=='function')return;
    setOpening(true);
    const target=new URL('/assistant-window.html',window.location.href).href;
    const next=window.open(target,'starcanvas-assistant','width=520,height=680');
    if(!next){setOpening(false);setFailed(true);return;}
    child.current=next;
    let mounted=false,observer:MutationObserver|null=null;
    function mount(){
      if(mounted||next!.closed||child.current!==next)return;
      try{
        if(next!.location.href!==target||next!.document.readyState==='loading')return;
        const doc=next!.document,root=doc.getElementById('root');if(!root)throw Error();
        mounted=true;
        // Styles only. Never copy script/preload, an API key, the canvas DOM,
        // arbitrary document attributes or application-operation authority.
        const syncTheme=()=>{
          doc.documentElement.className=document.documentElement.className;
          doc.documentElement.lang=document.documentElement.lang;
          doc.body.className=document.body.className;
          doc.body.dataset.assistantDesktop='true';
          const source=getComputedStyle(document.body);
          doc.body.style.fontFamily=source.fontFamily;
          for(const name of Array.from(doc.documentElement.style))if(name.startsWith('--wj-'))doc.documentElement.style.removeProperty(name);
          for(const name of Array.from(source))if(name.startsWith('--wj-'))doc.documentElement.style.setProperty(name,source.getPropertyValue(name));
        };
        const syncStyles=()=>{
          for(const node of doc.head.querySelectorAll('[data-assistant-shared-style]'))node.remove();
          for(const original of document.head.querySelectorAll('style,link[rel="stylesheet"]')){
            const copy=original.cloneNode(true) as HTMLElement;copy.dataset.assistantSharedStyle='';
            if(copy.tagName==='LINK')copy.setAttribute('href',(original as HTMLLinkElement).href);
            doc.head.append(copy);
          }
        };
        syncStyles();syncTheme();
        observer=new MutationObserver(records=>{if(next!.closed)return;if(records.some(record=>record.target===document.head||document.head.contains(record.target)))syncStyles();syncTheme();});
        observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','lang']});
        observer.observe(document.body,{attributes:true,attributeFilter:['class','style']});
        observer.observe(document.head,{subtree:true,childList:true,characterData:true});
        setHost(root);setOpening(false);
      }catch{setFailed(true);setOpening(false);next!.close();finish(next!);}
    }
    const closed=()=>{if(mounted)finish(next);};
    next.addEventListener('load',mount);next.addEventListener('pagehide',closed);
    cleanup.current=()=>{observer?.disconnect();next.removeEventListener('load',mount);next.removeEventListener('pagehide',closed);};
    mount();
  }
  function dock(){
    const current=child.current;if(!current)return;
    // Unmount the portal before closing its document. All chat state stays in
    // the existing owner; a model request is not cancelled or resent.
    finish(current);queueMicrotask(()=>current.close());void control('focus-main');
  }
  async function togglePin(){
    const result=await control(pinned?'unpin':'pin');if(result?.ok)setPinned(result.value.pinned);else setFailed(true);
  }
  return {host,opening,pinned,failed,available:typeof window.wanjuanDesktop?.assistantWindowControl==='function',open,dock,togglePin,focus:()=>control('focus'),focusMain:()=>control('focus-main')};
}
