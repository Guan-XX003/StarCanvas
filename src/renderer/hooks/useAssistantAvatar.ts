import {useEffect,useRef,useState} from 'react';
import {ASSISTANT_AVATAR_EVENT,ASSISTANT_AVATAR_KEY,normalizeAssistantAvatar,readAssistantAvatar} from '../lib/assistant-interface';
const readLocalAvatar=()=>{try{return readAssistantAvatar(window.localStorage);}catch{return '';}};

export function useAssistantAvatar(fallback:string){
  const [image,setImage]=useState(readLocalAvatar),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  const revision=useRef(0);
  useEffect(()=>{const sync=()=>setImage(readLocalAvatar());const storage=(event:StorageEvent)=>{if(event.key===ASSISTANT_AVATAR_KEY||event.key===null)sync();};window.addEventListener(ASSISTANT_AVATAR_EVENT,sync);window.addEventListener('storage',storage);return()=>{revision.current++;window.removeEventListener(ASSISTANT_AVATAR_EVENT,sync);window.removeEventListener('storage',storage);};},[]);
  function commit(value:string){if(value)window.localStorage.setItem(ASSISTANT_AVATAR_KEY,value);else window.localStorage.removeItem(ASSISTANT_AVATAR_KEY);setImage(value);window.dispatchEvent(new Event(ASSISTANT_AVATAR_EVENT));}
  async function change(file:File){if(busy)return;const version=++revision.current;setBusy(true);setError(false);try{const value=await normalizeAssistantAvatar(file);if(version===revision.current)commit(value);}catch{if(version===revision.current)setError(true);}finally{if(version===revision.current)setBusy(false);}}
  function reset(){revision.current++;setBusy(false);setError(false);try{commit('');}catch{setError(true);}}
  return {src:image||fallback,custom:!!image,busy,error,change,reset};
}
