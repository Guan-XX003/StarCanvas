import {assistantCanDiscloseTargetUrl, containsLikelyAssistantSecret, normalizeAssistantDocumentationUrl} from './assistant-onboarding';
import {applicationTaskDiagnostic, applicationTaskStatus, applicationTaskType} from '../../../electron/shared/application-task-data.mjs';

export type AssistantServiceType = 'image'|'video'|'jimeng'|'music'|'text';
export type AssistantServiceDraft = {category:AssistantServiceType;url:string;model:string;key:string;docs:string};
export const assistantServiceTypes:AssistantServiceType[] = ['image','video','jimeng','music','text'];
export const assistantServiceCategory = (type:AssistantServiceType) => type === 'jimeng' ? 'video' : type;

/** Local input validation only; not proof of connectivity or model support. */
export function checkAssistantService(input:AssistantServiceDraft) {
  if (!assistantServiceTypes.includes(input.category)) return 'category';
  if (!input.url.trim() || !assistantCanDiscloseTargetUrl(input.url) || /[\r\n]/.test(input.url)) return 'url';
  const url = new URL(input.url.trim());
  if (url.hash || url.search) return 'url';
  if (!input.model.trim() || input.model.trim().length>256 || /[\u0000-\u001f\u007f]/.test(input.model) || containsLikelyAssistantSecret(input.model)) return 'model';
  if (!input.key.trim() || input.key.length>4096 || /[\u0000-\u001f\u007f]/.test(input.key)) return 'key';
  if (input.docs.trim() && !normalizeAssistantDocumentationUrl(input.docs)) return 'docs';
  return '';
}

/** Append a new provider, never replace a user's existing manual credential.
 * The normal app configuration owner still owns persistence and model binding. */
export function assistantServiceEntry(input:AssistantServiceDraft,id:string) {
  if (checkAssistantService(input) || !/^assistant-service-[\w-]{1,80}$/.test(id)) throw new Error('ASSISTANT_SERVICE_INVALID');
  return {id,name:new URL(input.url.trim()).hostname,url:input.url.trim().replace(/\/$/,''),key:input.key.trim(),protocolFormat:'auto'};
}
export function appendAssistantServiceBinding(current:Record<string,string>,model:string,id:string) {
  return Object.hasOwn(current,model)?current:{...current,[model]:id};
}

export function assistantFailureChoices(tasks:unknown) {
  if (!Array.isArray(tasks)) return [];
  const counts=new Map<string,number>();
  for(const task of tasks)if(typeof task?.id==='string')counts.set(task.id,(counts.get(task.id)||0)+1);
  return tasks.filter(task=>applicationTaskStatus(task)==='failed' && typeof task?.id==='string' && counts.get(task.id)===1)
    .map(task=>({id:task.id,type:applicationTaskType(task),diagnostic:applicationTaskDiagnostic(task)}));
}

export const ASSISTANT_AVATAR_KEY='wanjuan.assistant-avatar.v1';
export const ASSISTANT_AVATAR_EVENT='wanjuan:assistant-avatar';
const MAX_AVATAR_BYTES=512*1024;
export function assistantAvatarMime(bytes:Uint8Array) {
  if(bytes.length>MAX_AVATAR_BYTES)return '';
  if(bytes.length>=8 && [137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n))return 'image/png';
  if(bytes.length>=3 && bytes[0]===255 && bytes[1]===216 && bytes[2]===255)return 'image/jpeg';
  if(bytes.length>=12 && String.fromCharCode(...bytes.slice(0,4))==='RIFF' && String.fromCharCode(...bytes.slice(8,12))==='WEBP')return 'image/webp';
  return '';
}
export function readAssistantAvatar(storage:Pick<Storage,'getItem'>) {
  try {const value=storage.getItem(ASSISTANT_AVATAR_KEY)||'';return value.length<=100000 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]+$/.test(value)?value:'';}catch{return '';}
}

/** Bounded local raster decode/re-encode. SVG/remote URLs/paths are never stored
 * or loaded, and source metadata is discarded. No upload or model request. */
export async function normalizeAssistantAvatar(file:File) {
  if(file.size>MAX_AVATAR_BYTES)throw new Error('AVATAR_INVALID');
  const bytes=new Uint8Array(await file.arrayBuffer()),mime=assistantAvatarMime(bytes);
  if(!mime)throw new Error('AVATAR_INVALID');
  const blob=new Blob([bytes],{type:mime});
  const image=await createImageBitmap(blob);
  try {
    if(!image.width||!image.height||image.width>4096||image.height>4096)throw new Error('AVATAR_INVALID');
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
    const ctx=canvas.getContext('2d');if(!ctx)throw new Error('AVATAR_INVALID');
    const size=Math.min(image.width,image.height);
    ctx.drawImage(image,(image.width-size)/2,(image.height-size)/2,size,size,0,0,128,128);
    const value=canvas.toDataURL('image/png');
    if(value.length>100000)throw new Error('AVATAR_INVALID');return value;
  } finally {image.close();}
}
