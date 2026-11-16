/** Generic video's existing body assembly. Shared by review and the sender;
 * files/references are appended only by the normal generation owner. */
export const VIDEO_FIELD_DEFAULTS=Object.freeze({model:'model',prompt:'prompt',resolution:'size',aspectRatio:'aspect_ratio',duration:'seconds',referenceImage:'input_reference',referenceVideo:'input_video',referenceAudio:''});
export function createVideoBaseRequest({model,prompt,requestType,profile,context:c}:{model:string;prompt:string;requestType:string;profile:any;context:any}){
 const f={...VIDEO_FIELD_DEFAULTS,...profile.fieldMapping},isVeo=/^veo/i.test(model)&&!c.isLconaiVideoApi;
 if(requestType==='json-video'||requestType==='openai-video'){
  let body:any={model,prompt};
  const resolution=c.getVideoResolutionAdapterValue(c.isVectorEngineGrokVideo3?c.videoSizeValue:c.modelUsesDimensionSize||requestType==='openai-video'?c.normalizedVideoSize:f.resolution==='resolution'?c.requestAspectRatioValue||c.videoSizeValue:c.videoSizeValue);
  if(profile.omitDuration!==true&&f.duration!==''){const key=f.duration||'duration';body[key]=c.getFieldValue(key,Number(c.durationValue)||c.durationValue);}
  if(!isVeo&&f.resolution!==''&&resolution){const key=f.resolution||'resolution';body[key]=c.getFieldValue(key,resolution);}
  if(c.requestAspectRatioValue&&f.aspectRatio&&f.aspectRatio!==f.resolution){const ratio=c.getVideoAspectRatioAdapterValue();if(ratio!=='')body[f.aspectRatio]=c.getFieldValue(f.aspectRatio,ratio);}
  if(profile.extraBody&&typeof profile.extraBody==='object')body={...body,...profile.extraBody};
  return {body,multipartFields:[] as [string,string][],multipartDuration:null as [string,string]|null};
 }
 const fields:[string,string][]=[[f.model||'model',String(model)],[f.prompt||'prompt',String(prompt)]];
 const resolution=c.getVideoResolutionAdapterValue(c.modelUsesDimensionSize?c.normalizedVideoSize:profile.useAspectRatioAsSize===true?(c.requestAspectRatioValue?c.requestAspectRatioValue.replace(':','x'):'16x9'):c.videoSizeValue);
 if(!isVeo&&f.resolution!=='')fields.push([f.resolution||'size',String(resolution)]);
 if(c.requestAspectRatioValue&&profile.useAspectRatioAsSize!==true&&f.aspectRatio!==''){const ratio=c.getVideoAspectRatioAdapterValue();if(ratio!=='')fields.push([f.aspectRatio||'aspect_ratio',String(ratio)]);}
 const key=f.duration||'seconds',duration:[string,string]|null=profile.omitDuration===true||f.duration===''?null:[key,String(c.getFieldValue(key,c.durationValue))];
 return {body:null,multipartFields:fields,multipartDuration:duration};
}
export function finalizeVideoJsonRequest(body:any,{model,profile,context:c}:{model:string;profile:any;context:any}){
 if(profile.__wanjuanPreferExplicitProtocol!==true&&/^grok-imagine-video$/i.test(model)){
  const refs=body[({...VIDEO_FIELD_DEFAULTS,...profile.fieldMapping}).referenceImage||'first_frame_image'];
  body.resolution_name||(body.resolution_name=String(c.videoSizeValue||'720P').trim().toLowerCase());
  body.preset||(body.preset='custom');
  if(c.aspectRatio&&body.aspect_ratio===undefined)body.aspect_ratio=c.aspectRatio;
  if(Array.isArray(refs)){const images=refs.map(item=>item&&typeof item==='object'&&item.image_url?item.image_url:item).filter(Boolean);if(images.length&&body.image_references===undefined)body.image_references=images;}
 }
 return body;
}
/** Only non-secret scalar request fields reach the App review. Unknown extras,
 * content locations and credential-like values stay private, with a count. */
export function reviewVideoRequest({body,multipartFields,multipartDuration},profile:any,requestType:string){
 const known=new Set(['model','prompt','size','resolution','seconds','duration','aspect_ratio','quality','watermark','generate_audio','n','seed','fps','num_frames','resolution_name','preset',...Object.entries(profile.fieldMapping||{}).filter(([key])=>['model','prompt','resolution','aspectRatio','duration'].includes(key)).map(([,value])=>value)]);
 const entries:[string,any][]=body?Object.entries(JSON.parse(JSON.stringify(body))):[...multipartFields,...(multipartDuration?[multipartDuration]:[])];
 let hiddenFields=0;const fields=entries.flatMap(([name,value])=>{
  const scalar=value===null||['string','boolean','number'].includes(typeof value),text=String(value??'');
  if(!known.has(name)||!/^[-A-Za-z0-9_.]{1,80}$/.test(name)||/key|token|secret|password|authorization/i.test(name)||!scalar||text.length>50000||/https?:\/\/|file:\/\/|data:|\bBearer\s|\bsk-[a-z0-9_-]{12,}/i.test(text)){hiddenFields++;return [];}
  return [{name,value}];
 });
 return {transport:requestType==='multipart-video'?'multipart':'JSON',fields,hiddenFields};
}
