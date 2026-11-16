import {APPLICATION_BASIC_THEMES,APPLICATION_BASIC_LANGUAGES,APPLICATION_DESTINATIONS,parseApplicationLocalArguments} from '../../../electron/shared/application-local-contract.mjs';
import {assistantPreferenceVisuallyApplied} from './assistant-preferences';
import {assistantNavigationElementVisible} from './assistant-local-operations';

type State={ready:boolean;settingsReady:boolean;theme:string;language:string;autoDownload:boolean;activeView:string;activeSettingsTab:string};
type Kind='theme'|'language'|'autoDownload';
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};
const slot=(kind:Kind)=>kind==='theme'?'Theme':kind==='language'?'Language':'AutoDownload';
const views:Record<string,string>={canvas:'canvas',resources:'transit',agents:'agents',settings:'settings',account:'settings',appearance:'settings',api:'settings',models:'settings',generation:'settings'};
const tabs:Record<string,string>={settings:'account',account:'account',appearance:'basic',api:'api',models:'models',generation:'generation'};

/** Basic actions reuse the existing root setters/persistence and navigation.
 * Prepared closures stay private in the dispatcher; only enum/bool review and
 * actual observed outcomes cross the operation service. No generic config or
 * DOM/shell command is accepted. One observer at the host supplies change epochs.
 */
export function createApplicationLocalActions({readState,applyPreference,navigate,canNavigate,document:doc,prefersLight=()=>false,waitMs=15000,intervalMs=40}:{
 readState:()=>State;applyPreference:(kind:Kind,value:string|boolean)=>boolean;navigate:(destination:string)=>boolean;canNavigate:(destination:string)=>boolean;
 document:Document;prefersLight?:()=>boolean;waitMs?:number;intervalMs?:number;
}){
 let closed=false,navVersion=0;
 const versions={theme:0,language:0,autoDownload:0},signatures:Record<string,string>={};
 const root=doc.documentElement;
 function observe(){
  const s=readState();
  for(const kind of ['theme','language','autoDownload'] as Kind[]){
   const signature=JSON.stringify([s.ready,s.settingsReady,s[kind],root.dataset[`wanjuan${slot(kind)}PersistenceRevision`]]);
   if(signatures[kind]!==signature){versions[kind]++;signatures[kind]=signature;}
  }
  const navigation=JSON.stringify([s.ready,s.settingsReady,s.activeView,s.activeSettingsTab,root.classList.contains('wanjuan-workspace-open'),APPLICATION_DESTINATIONS.map(d=>canNavigate(d))]);
  if(signatures.navigation!==navigation){navVersion++;signatures.navigation=navigation;}
  return s;
 }
 function read(){
  const s=observe();if(closed||!s.ready||!s.settingsReady)fail('OPERATION_CONFIGURATION_REQUIRED');
  if(!APPLICATION_BASIC_THEMES.includes(s.theme)||!APPLICATION_BASIC_LANGUAGES.includes(s.language)||typeof s.autoDownload!=='boolean')fail('OPERATION_CONFIGURATION_REQUIRED');
  return {theme:s.theme,language:s.language,autoDownload:s.autoDownload};
 }
 async function wait(check:()=>boolean){
  const deadline=Date.now()+waitMs;
  for(;;){if(closed)fail('OPERATION_OUTCOME_UNKNOWN');if(check())return;if(Date.now()>=deadline)fail('OPERATION_OUTCOME_UNKNOWN');await new Promise(resolve=>setTimeout(resolve,intervalMs));}
 }
 function visibleDestination(destination:string){
  const s=readState(),workspace=root.classList.contains('wanjuan-workspace-open');
  if(destination==='workspace'){const page=doc.querySelector<HTMLElement>('.wanjuan-workspace-page');return workspace&&assistantNavigationElementVisible(page)&&!!page?.childElementCount;}
  const view=views[destination],page=doc.querySelector<HTMLElement>(`[data-wanjuan-assistant-view="${view}"]`),tab=page?.querySelector<HTMLElement>('[data-wanjuan-assistant-settings-tab]');
  return !workspace&&s.activeView===view&&assistantNavigationElementVisible(page)&&(!tabs[destination]||s.activeSettingsTab===tabs[destination]&&tab?.dataset.wanjuanAssistantSettingsTab===tabs[destination]&&assistantNavigationElementVisible(tab)&&!!tab.childElementCount);
 }
 function prepare(operation:string,input:any){
  const a=parseApplicationLocalArguments(operation,input),s=observe();if(closed||!s.ready)fail('PLAN_CANVAS_NOT_READY');
  if(operation==='app.preferences.read')return {review:{kind:'metadata'},commit:async(guard:()=>void)=>{guard();return {preferences:read()};}};
  if(operation==='app.preferences.set'){
   const before=read(),kind=a.kind as Kind,version=versions[kind];
   return {review:{kind:'app.preferences.set',preference:{kind,current:before[kind],value:a.value}},async commit(guard:()=>void){
    guard();observe();if(versions[kind]!==version)fail('OPERATION_STATE_CHANGED');
    let accepted=false;try{accepted=applyPreference(kind,a.value);}catch{fail('OPERATION_OUTCOME_UNKNOWN');}
    if(!accepted)fail('OPERATION_OUTCOME_UNKNOWN');
    const revision=root.dataset[`wanjuan${slot(kind)}PersistenceRevision`];
    if(!revision)fail('OPERATION_OUTCOME_UNKNOWN');
    await wait(()=>{
     const state=observe();
     // A manual selection or failed persistence can follow a partial change.
     // Never call that unchanged, roll it back, or submit a second write.
     if(root.dataset[`wanjuan${slot(kind)}PersistenceRevision`]!==revision||root.dataset[`wanjuan${slot(kind)}Persisted`]==='failed')fail('OPERATION_OUTCOME_UNKNOWN');
     return state[kind]===a.value&&assistantPreferenceVisuallyApplied(kind,a.value,root,prefersLight());
    });
    return {kind,value:a.value,wasAlready:before[kind]===a.value,visuallyApplied:true,saved:true,generationStarted:false};
   }};
  }
  if(operation!=='app.navigate'||!canNavigate(a.destination))fail('OPERATION_NAVIGATION_REFUSED');
  const version=navVersion;
  return {review:{kind:'app.navigate',destination:a.destination},async commit(guard:()=>void){
   guard();observe();if(navVersion!==version)fail('OPERATION_STATE_CHANGED');
   if(!canNavigate(a.destination))fail('OPERATION_NAVIGATION_REFUSED');
   // Root false is its existing preflight refusal; exceptions can follow a
   // partial navigation and must remain unconfirmed.
   let accepted=false;try{accepted=navigate(a.destination);}catch{fail('OPERATION_OUTCOME_UNKNOWN');}
   if(!accepted)fail('OPERATION_NAVIGATION_REFUSED');
   await wait(()=>visibleDestination(a.destination));return {destination:a.destination,opened:true,generationStarted:false};
  }};
 }
 return {observe,prepare,close(){closed=true;}};
}
