import {parseApplicationOperationRequest} from './application-operation-contract.mjs';
import {parseApplicationMediaImport} from './application-media-contract.mjs';
import {applicationGenerationMode,applicationPortraitAssetIds} from './application-generation-contract.mjs';
import {ApplicationOperationError} from './application-operation-policy.mjs';
const fail=code=>{throw new ApplicationOperationError(code);};
const record=x=>!!x&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
/** Pure legacy-intent adapter. No stat/read/fetch, keys or self-granted scope.
 * Scalar fields use the canonical parser; actual child generation receives
 * only reference IDs obtained from separately approved media.import children.
 */
export function parseApplicationGenerationWorkflow(input){
 if(!record(input)||!['generation.image','generation.video','generation.tianji'].includes(input.operation)||!record(input.arguments))return null;
 const a=input.arguments,tianji=input.operation==='generation.tianji',sources=[];
 // Reject forged authority/unknown fields through the canonical contract before
 // even interpreting a source. Clearing media here grants no input permission.
 const validation={...a,referenceImage:'',...(tianji?{images:[],videos:[],audios:[],portraitAssetIds:[],references:[],mode:'text-to-video'}:{})};
 const generation=parseApplicationOperationRequest({...input,arguments:validation});
 const add=(source,type)=>{sources.push(parseApplicationMediaImport({source,type}));};
 if(a.referenceImage!==undefined&&typeof a.referenceImage!=='string')fail('OPERATION_INVALID_REQUEST');
 if(typeof a.referenceImage==='string'&&a.referenceImage.trim())add(a.referenceImage,'image');
 if(tianji)for(const [field,type,max]of [['images','image',9],['videos','video',3],['audios','audio',3]]){
  if(a[field]!==undefined&&!Array.isArray(a[field]))fail('OPERATION_INVALID_REQUEST');
  if((a[field]?.length||0)>max)fail('OPERATION_INVALID_REQUEST');for(const source of a[field]||[])add(source,type);
 }
 if(!sources.length)return null;
 if(a.references!==undefined&&(!Array.isArray(a.references)||a.references.length))fail('OPERATION_MEDIA_SCOPE_REQUIRED');
 const portraits=tianji?applicationPortraitAssetIds(a.portraitAssetIds):[];
 if(sources.filter(s=>s.type==='image').length+portraits.length>9||sources.length+portraits.length>15||new Set(sources.map(s=>JSON.stringify(s))).size!==sources.length)fail('OPERATION_INVALID_REQUEST');
 const mode=tianji?applicationGenerationMode(a.mode,true):null;
 if(tianji&&(mode==='text-to-video'||portraits.length&&mode!=='reference-media'))fail('OPERATION_INVALID_REQUEST');
 // Validate scalar parameters through the existing canonical contract. The
 // requested media mode is restored only in private intent; after imports the
 // real reference IDs make the final canonical request valid on its own.
 if(tianji){generation.arguments.mode=mode;generation.arguments.portraitAssetIds=portraits;}
 const imageCount=sources.filter(s=>s.type==='image').length;
 if(tianji&&(mode==='first-frame'&&(sources.length!==1||imageCount!==1)||mode==='first-last'&&(sources.length!==2||imageCount!==2)))fail('OPERATION_PARAMETER_UNAVAILABLE');
 return {generation,sources};
}
