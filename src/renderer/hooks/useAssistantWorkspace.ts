import {useEffect,useLayoutEffect,useMemo,useSyncExternalStore} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import type {AssistantMessage} from '../lib/assistant-onboarding';
import {createAssistantWorkspaceClient,type AssistantWorkspaceClient} from '../lib/assistant-workspace-client';
import {registerDesktopCloseParticipant} from '../lib/desktop-close';

let client:AssistantWorkspaceClient|undefined;
export function sharedAssistantWorkspaceClient(){return client ||= createAssistantWorkspaceClient(()=>window.wanjuanDesktop as any);}
export function useAssistantWorkspace(visible:boolean,projectId:string){
  const controller=sharedAssistantWorkspaceClient();
  const snapshot=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
  const id=snapshot.selectedId,view=controller.viewFor(id),available=controller.available();
  useLayoutEffect(()=>controller.observeCanvasProject(projectId),[controller,projectId]);
  useEffect(()=>{if(visible&&available)void controller.initialize(projectId);},[visible,available,controller,projectId]);
  useEffect(()=>registerDesktopCloseParticipant('assistant',controller.prepareClose),[controller]);
  useEffect(()=>{
    if(!available)return;
    const onClose=(event:BeforeUnloadEvent)=>{
      if(!controller.pending())return;
      event.preventDefault();event.returnValue='';void controller.flushAll().catch(()=>{});
    };
    window.addEventListener('beforeunload',onClose);return()=>window.removeEventListener('beforeunload',onClose);
  },[available,controller]);
  // Every setter closes over the OWNER id. A response arriving after selection
  // changes cannot write into the currently visible conversation.
  const setters=useMemo(()=>({
    draft:((value)=>controller.set(id,'draft',value)) as Dispatch<SetStateAction<string>>,
    messages:((value)=>controller.set(id,'messages',value)) as Dispatch<SetStateAction<AssistantMessage[]>>,
    busy:((value)=>controller.set(id,'busy',value)) as Dispatch<SetStateAction<boolean>>,
    sending:((value)=>controller.set(id,'sending',value)) as Dispatch<SetStateAction<boolean>>,
    cancelling:((value)=>controller.set(id,'cancelling',value)) as Dispatch<SetStateAction<boolean>>,
    cancelledTurnWaiting:((value)=>controller.set(id,'cancelledTurnWaiting',value)) as Dispatch<SetStateAction<boolean>>,
    requiresReset:((value)=>controller.set(id,'requiresReset',value)) as Dispatch<SetStateAction<boolean>>,
    chatNotice:((value)=>controller.set(id,'chatNotice',value)) as Dispatch<SetStateAction<string>>,
    chatError:((value)=>controller.set(id,'chatError',value)) as Dispatch<SetStateAction<string>>,
  }),[controller,id]);
  return {controller,snapshot,id,view,setters,available,role:controller.roleFor(id),active:available&&snapshot.phase==='ready'&&id!=='$local'};
}
