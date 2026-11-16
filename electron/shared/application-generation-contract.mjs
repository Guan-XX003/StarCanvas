import {ApplicationOperationError} from './application-operation-policy.mjs';
import {applicationReferenceId} from './application-media-contract.mjs';
const fail=code=>{throw new ApplicationOperationError(code);};
const record=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const text=(x,max=512,required=false)=>{if(x===undefined)return '';if(typeof x!=='string'||x.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x)||required&&!x.trim())fail('OPERATION_INVALID_REQUEST');return x.trim();};
export function applicationGenerationMode(value,hasReferences=false){const mode=text(value,64)||(hasReferences?'reference-media':'text-to-video');if(!['text-to-video','first-frame','first-last','reference-media'].includes(mode))fail('OPERATION_INVALID_REQUEST');return mode;}
export function applicationPortraitAssetIds(value){
 const ids=value===undefined?[]:value;
 if(!Array.isArray(ids)||ids.length>9||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,511}$/.test(id)))fail('OPERATION_INVALID_REQUEST');return ids.slice();
}
/** Pure parsing only: no stat, read, fetch, upload or endpoint probing. Input
 * Raw media never grants scope. Opaque IDs are resolved by main only after a
 * separate import approval and this generation's one-shot paid approval.
 */
export function parseApplicationGeneration(operation,input={}){
 if(!record(input))fail('OPERATION_INVALID_REQUEST');
 const image=operation==='generation.image',tianji=operation==='generation.tianji';
 if(!['generation.image','generation.video','generation.tianji'].includes(operation))fail('OPERATION_UNSUPPORTED');
 const allowed=image?['prompt','model','size','referenceImage','references']:tianji?['prompt','model','resolution','duration','aspectRatio','referenceImage','mode','images','portraitAssetIds','videos','audios','callbackUrl','references']:['prompt','model','resolution','duration','aspectRatio','referenceImage','references'];
 if(Object.keys(input).some(k=>!allowed.includes(k)))fail('OPERATION_INVALID_REQUEST');
 const prompt=text(input.prompt,50000,true),model=text(input.model),referenceImage=text(input.referenceImage,4096);
 const references=input.references??[];if(!Array.isArray(references)||references.length>15||new Set(references).size!==references.length)fail('OPERATION_INVALID_REQUEST');for(const id of references)applicationReferenceId(id);const scoped=references.length?{references:references.slice()}:{};
 if(!prompt)fail('OPERATION_INVALID_REQUEST');
 if(image){if(referenceImage)fail('OPERATION_MEDIA_SCOPE_REQUIRED');return {prompt,model,size:text(input.size,64)||'1024x1024',referenceImage:'',...scoped};}
 let duration=input.duration;if(duration===undefined||duration==='')duration=tianji?5:undefined;
 else {if(!['string','number'].includes(typeof duration))fail('OPERATION_INVALID_REQUEST');duration=Number(duration);if(!Number.isFinite(duration)||duration<=0||duration>600)fail('OPERATION_INVALID_REQUEST');}
 const result={prompt,model,resolution:text(input.resolution,64)||(tianji?'720p':'1280x720'),aspectRatio:text(input.aspectRatio,32)||(tianji?'16:9':''),...(duration===undefined?{}:{duration}),referenceImage:'',...scoped};
 if(!tianji){if(referenceImage)fail('OPERATION_MEDIA_SCOPE_REQUIRED');return result;}
 const portraitAssetIds=applicationPortraitAssetIds(input.portraitAssetIds),mode=applicationGenerationMode(input.mode,!!references.length||!!portraitAssetIds.length);
 let hasMedia=!!referenceImage;
 for(const [key,max]of [['images',9],['videos',3],['audios',3]]){const values=input[key]??[];if(!Array.isArray(values)||values.length>max)fail('OPERATION_INVALID_REQUEST');for(const value of values)text(value,4096,true);if(values.length)hasMedia=true;}
 if(text(input.callbackUrl,4096))fail('OPERATION_INVALID_REQUEST');
 if(hasMedia||!references.length&&!portraitAssetIds.length&&mode!=='text-to-video')fail('OPERATION_MEDIA_SCOPE_REQUIRED');
 if(references.length&&mode==='text-to-video'||portraitAssetIds.length&&mode!=='reference-media')fail('OPERATION_INVALID_REQUEST');
 // An ID is an assertion, not an Active proof. The trusted dispatcher must
 // resolve it through the configured provider after paid consent, before nodes.
 return {...result,mode,images:[],portraitAssetIds,videos:[],audios:[]};
}
