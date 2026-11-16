import {applicationPortraitAssetIds} from '../../../electron/shared/application-generation-contract.mjs';
import {wanjuanTianjiRequest} from './tianji-api';
import {wanjuanTianjiAssetListParams,wanjuanTianjiAssetPagination,wanjuanTianjiFindArray,wanjuanTianjiPortraitAssetIdFromItem,wanjuanTianjiPortraitIsReady} from './tianji-assets';
const fail=(code:string):never=>{throw Object.assign(Error(code),{code});};

/** No preview, URL, name, credentials or caller-supplied status crosses this
 * private boundary. It is never accepted in the public operation schema. */
export function applicationTianjiPortraitMetadata(ids:any,values:any){
 const requested=applicationPortraitAssetIds(ids);
 if(!Array.isArray(values)||values.length!==requested.length)fail('OPERATION_MEDIA_INVALID');
 return values.map((value,index)=>{
  if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='assetId,groupType,status'||value.assetId!==requested[index]||value.status!=='Active'||!['AIGC','LivenessFace'].includes(value.groupType))fail('OPERATION_MEDIA_INVALID');
  return {assetId:value.assetId,groupType:value.groupType,status:'Active'};
 });
}

/** Read existing configured groups only; never ensure/create groups, refresh
 * the persistent cache, upload portraits or substitute preview images. The
 * caller invokes this only after consuming the normal paid-generation grant.
 * Active means observed at this query, not a promise about future upstream use.
 */
export async function resolveApplicationTianjiPortraits(ids:any,{config,groups,guard,request=wanjuanTianjiRequest,now=Date.now,timeoutMs=15000,maxPages=8,pageSize=100}:{config:any;groups:any;guard:()=>void;request?:typeof wanjuanTianjiRequest;now?:()=>number;timeoutMs?:number;maxPages?:number;pageSize?:number}){
 const requested=applicationPortraitAssetIds(ids);if(!requested.length)return [];
 if(typeof guard!=='function')fail('OPERATION_PERMISSION_REQUIRED');guard();
 const configured=['AIGC','LivenessFace'].filter(type=>typeof groups?.[type]==='string'&&/^[-A-Za-z0-9_]{1,512}$/.test(groups[type]));
 if(!configured.length)fail('OPERATION_CONFIGURATION_REQUIRED');
 const matches=new Map<string,any>(),wanted=new Set(requested),controller=new AbortController(),deadline=now()+timeoutMs;
 const timer=setTimeout(()=>controller.abort(),timeoutMs);let limited=false;
 const check=()=>{guard();if(controller.signal.aborted||now()>=deadline)fail('OPERATION_MEDIA_NOT_READY');};
 try{
  // Check both configured groups so an ambiguous ID cannot silently select one.
  for(const groupType of configured){for(let page=1;page<=maxPages;page++){
   check();let response;
   try{response=await request(config,'/api/cut/model/get-list-assets',{params:wanjuanTianjiAssetListParams(groupType,groups[groupType],page,pageSize),enterpriseRequestKind:'request',signal:controller.signal});}
   catch{check();fail('OPERATION_MEDIA_NOT_READY');}
   check();const items=wanjuanTianjiFindArray(response);if(items.length>pageSize)fail('OPERATION_RESULT_LIMIT');
   for(const item of items){const id=wanjuanTianjiPortraitAssetIdFromItem(item);if(!wanted.has(id))continue;
    // The existing provider request filters statuses=Active. Preserve explicit
    // failed/pending states; only an omitted status inherits that filter.
    if(!wanjuanTianjiPortraitIsReady({...item,__wanjuanTianjiListStatus:'Active'})||item?.localUploaded===true)fail('OPERATION_MEDIA_NOT_READY');
    const found=matches.get(id);if(found&&found.groupType!==groupType)fail('OPERATION_MEDIA_INVALID');matches.set(id,{assetId:id,groupType,status:'Active'});
   }
   const pagination=wanjuanTianjiAssetPagination(response,page,pageSize),knownEnd=pagination.total>0&&page*pageSize>=pagination.total;
   if(items.length<pageSize||knownEnd)break;if(page===maxPages)limited=true;
  }}
  check();if(limited)fail('OPERATION_LIMIT');if(requested.some(id=>!matches.has(id)))fail('OPERATION_MEDIA_NOT_READY');
  return applicationTianjiPortraitMetadata(requested,requested.map(id=>matches.get(id)));
 }finally{clearTimeout(timer);controller.abort();}
}
