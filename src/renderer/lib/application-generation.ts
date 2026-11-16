import {resolveMediaModelContract} from './media-model-contract';
import {canvasNodePlanCapability,initializeCanvasPlanNode} from './canvas-plan-capabilities';
import {parseSeedanceList} from './model-binding';
import {normalizeVideoAspectRatioValue} from './video-aspect-ratio';
import {resolveVideoRequestProfile} from './video-request-profile';
import {normalizeVideoRequestProfile,createVideoParameterContext} from './video-request-parameters';
import {createVideoBaseRequest,finalizeVideoJsonRequest,reviewVideoRequest} from './video-request-body';
import {applicationReferenceMetadata} from '../../../electron/shared/application-media-contract.mjs';
import {applicationPortraitAssetIds} from '../../../electron/shared/application-generation-contract.mjs';
import {applicationTianjiPortraitMetadata} from './application-tianji-portraits';
import {wanjuanTianjiPortraitNodeDataFromAutomation} from './tianji-portrait';
import {wanjuanCollectNodeReferenceMedia,wanjuanNodeTextValue,wanjuanNormalizeReferenceMediaUrl} from './reference-media';
const fail=(code:string):never=>{throw Object.assign(new Error(code),{code});};
/** Local configuration inspection, never a live probe or a price promise. */
export function describeApplicationGeneration(kind:string,args:any,configuration:any){
 const references=applicationReferenceMetadata(args.references||[],configuration.referenceMedia||[]),counts={image:0,video:0,audio:0};for(const r of references)counts[r.type]++;
 // Only the private canvas owner supplies these types. No source URLs, files
 // or pretend imported-reference capabilities enter the public request schema.
 const canvasTypes=configuration.canvasReferenceTypes||[];
 if(!Array.isArray(canvasTypes)||canvasTypes.length>15||canvasTypes.some(t=>!['image','video','audio'].includes(t)))fail('OPERATION_MEDIA_UNSUPPORTED');
 for(const type of canvasTypes)counts[type]++;
 const mediaTypes=[...references.map(r=>r.type),...canvasTypes];
 const portraits=kind==='tianji'?applicationPortraitAssetIds(args.portraitAssetIds):[];
 if(kind==='image'&&(counts.video||counts.audio))fail('OPERATION_MEDIA_UNSUPPORTED');
 if(kind==='tianji'){
  if(args.mode==='text-to-video'&&references.length||portraits.length&&args.mode!=='reference-media'||counts.image+portraits.length>9||references.length+portraits.length>15||args.mode==='first-frame'&&(counts.image!==1||counts.video||counts.audio)||args.mode==='first-last'&&(counts.image!==2||counts.video||counts.audio)||args.mode==='reference-media'&&!references.length&&!portraits.length)fail('OPERATION_PARAMETER_UNAVAILABLE');
  if(portraits.length&&!['AIGC','LivenessFace'].some(type=>typeof configuration.portraitGroups?.[type]==='string'&&/^[-A-Za-z0-9_]{1,512}$/.test(configuration.portraitGroups[type])))fail('OPERATION_CONFIGURATION_REQUIRED');
 }
 const category=kind==='image'?'image':'video',list=configuration.models;
 if(!Array.isArray(list)||!list.length)fail('OPERATION_MODEL_UNAVAILABLE');
 const model=args.model||configuration.preferredModel||list[0];if(!list.includes(model))fail('OPERATION_MODEL_UNAVAILABLE');
 const contract=resolveMediaModelContract({category,model,apiConfigs:configuration.apiConfigs,apiBindings:configuration.apiBindings,protocolBindings:configuration.protocolBindings,registry:configuration.registry,selectedApiConfigId:configuration.probe?.data?.selectedApiConfigId||configuration.probe?.data?.apiConfigId});
 if(contract.protocolConfigMissing||contract.protocolCategoryMismatch)fail('OPERATION_MODEL_UNAVAILABLE');
 if(contract.apiConfigId&&!contract.apiConfig)fail('OPERATION_CONFIGURATION_REQUIRED');
 const url=contract.apiConfig?.url||configuration.url,key=contract.apiConfig?.key||configuration.key;
 if(typeof url!=='string'||!/^https?:\/\//i.test(url)||typeof key!=='string'||!key.trim())fail('OPERATION_CONFIGURATION_REQUIRED');
 let genericVideoProfile:any=null,genericVideoType='';
 if(kind==='video'){
  const profile=normalizeVideoRequestProfile(resolveVideoRequestProfile({modelName:model,baseUrl:url,protocol:contract.protocol,profiles:configuration.probe?.data?.videoModelRequestProfiles}),{modelName:model,apiUrl:url,category:'video'});
  let directArk=false;try{directArk=new URL(url).hostname.toLowerCase()==='ark.cn-beijing.volces.com';}catch{}
  const specialized=/^(?:doubao-)?seedance(?:-2(?:\.|-)?0|-2-0)/i.test(model)||/^doubao-seedance-2-5(?:-|$)/i.test(model)&&directArk&&!contract.protocol;
  if(profile.blockedReason||!specialized&&!profile.requestType&&(!contract.apiConfig?.protocolFormat||contract.apiConfig.protocolFormat==='auto'))fail('OPERATION_CONFIGURATION_REQUIRED');
  if(profile.requiresReferenceImage&&!counts.image||profile.requiresReferenceVideo&&!counts.video||profile.requiresAnyReference&&!counts.image&&!counts.video)fail('OPERATION_MEDIA_SCOPE_REQUIRED');
  if(mediaTypes.length&&profile.mediaConditioningSupported===false)fail('OPERATION_MEDIA_UNSUPPORTED');
  if(!specialized){genericVideoProfile=profile;genericVideoType=profile.requestType||contract.apiConfig?.protocolFormat||'';if(!['json-video','openai-video','multipart-video'].includes(genericVideoType))fail('OPERATION_CONFIGURATION_REQUIRED');}
  // Match the normal sender: its current JSON branch sends images only and
  // sends only the first unless array mode is configured. Never silently drop
  // a supplied video/audio or an additional image after paid confirmation.
  if(genericVideoProfile){
   if(genericVideoType!=='multipart-video'&&(counts.video||counts.audio))fail('OPERATION_MEDIA_UNSUPPORTED');
   if(genericVideoType!=='multipart-video'&&counts.image>1&&profile.referenceImageAsArray!==true)fail('OPERATION_PARAMETER_UNAVAILABLE');
   if(counts.audio&&(!profile.fieldMapping?.referenceAudio||counts.audio>1))fail('OPERATION_MEDIA_UNSUPPORTED');
   if(profile.referenceMediaAggregation&&Array.isArray(profile.referenceMediaKinds)&&mediaTypes.some(type=>type!=='audio'&&!profile.referenceMediaKinds.includes(type)))fail('OPERATION_MEDIA_UNSUPPORTED');
  }
 }
 let fields:any={prompt:args.prompt,selectedModel:model,wanjuanModelManual:true,wanjuanModelAuto:false},effective={...args,model};
 const choose=(values:string[],value:string)=>{const match=values.find(v=>v.toLowerCase()===value.toLowerCase());if(!match)fail('OPERATION_PARAMETER_UNAVAILABLE');return match;};
 if(kind==='tianji'){
  fields={...fields,seedanceNode:true,seedanceMode:'tianji',tianjiSeedanceGenerationMode:args.mode||'text-to-video',tianjiSelectedModel:model,tianjiModelManual:true,
   tianjiSeedanceModel:list.join('\n'),videoModel:list.join('\n'),
   seedanceRatios:parseSeedanceList(configuration.ratios||'16:9 9:16 1:1').join('\n'),videoResolutions:parseSeedanceList(configuration.ratios||'16:9 9:16 1:1').join('\n'),
   seedanceResolutions:parseSeedanceList(configuration.resolutions||'720p 1080p').join('\n'),videoDurations:parseSeedanceList(configuration.durations||'5 10').join('\n'),
   generateAudio:configuration.generateAudio!==false,watermark:configuration.watermark===true,
   selectedResolution:choose(parseSeedanceList(configuration.resolutions||'720p 1080p'),args.resolution),
   selectedSeconds:choose(parseSeedanceList(configuration.durations||'5 10'),String(args.duration)),size:choose(parseSeedanceList(configuration.ratios||'16:9 9:16 1:1'),args.aspectRatio)};
  effective={...effective,resolution:fields.selectedResolution,duration:Number(fields.selectedSeconds),aspectRatio:fields.size,mode:fields.tianjiSeedanceGenerationMode,generateAudio:fields.generateAudio,watermark:fields.watermark};
 }else{
  const probe={...configuration.probe,data:{...configuration.probe.data,selectedModel:model}},cap=canvasNodePlanCapability(probe),options=cap.modelParameters?.[model];
  if(!options)fail('OPERATION_MODEL_UNAVAILABLE');
  const node=initializeCanvasPlanNode(probe);fields={...fields,...Object.fromEntries(Object.keys(options).map(k=>[k,node.data[k]]))};
  if(kind==='image'){
   const mode=/^\d+x\d+$/i.test(args.size)?'resolution':'quality';fields.imageSizeMode=choose(options.imageSizeMode,mode);
   if(mode==='resolution')fields.imageResolution=choose(options.imageResolution,args.size);else fields.imageSize=choose(options.imageSize,args.size);
   // Controlled generation must not silently call another paid text model to
   // infer Auto aspect ratio. Review an explicit supported ratio instead.
   if(mode==='quality'&&args.aspectRatio&&args.aspectRatio!=='Auto')fields.aspectRatio=choose(options.aspectRatio||[],args.aspectRatio);
   if(mode==='quality'&&(!fields.aspectRatio||fields.aspectRatio==='Auto'))fields.aspectRatio=choose(options.aspectRatio||[],'1:1');
   effective={...effective,size:mode==='resolution'?fields.imageResolution:fields.imageSize,...(mode==='quality'?{aspectRatio:fields.aspectRatio}:{})};
   if(mode==='resolution')delete effective.aspectRatio;
  }else{
   const mode=/^\d+x\d+$/i.test(args.resolution)?'exact-resolution':'ratio-quality';fields.videoParameterMode=choose(options.videoParameterMode,mode);
   if(mode==='exact-resolution')fields.size=choose(options.size,args.resolution);else fields.selectedVideoQuality=choose(options.selectedVideoQuality,args.resolution);
   fields.selectedSeconds=choose(options.selectedSeconds,String(args.duration??node.data.selectedSeconds));
   fields.selectedAspectRatio=choose(options.selectedAspectRatio,normalizeVideoAspectRatioValue(args.aspectRatio,args.resolution));
   effective={...effective,resolution:mode==='exact-resolution'?fields.size:fields.selectedVideoQuality,duration:Number(fields.selectedSeconds),aspectRatio:fields.selectedAspectRatio};
  }
 }
 let requestPreview:any;
 if(kind==='tianji')requestPreview={transport:'form',fields:Object.entries({duration:String(effective.duration),ratio:effective.aspectRatio,prompt:args.prompt,watermark:String(effective.watermark),model_name:model,resolution:effective.resolution,generate_audio:String(effective.generateAudio)}).map(([name,value])=>({name,value})),hiddenFields:(counts.image+portraits.length?(effective.mode==='first-last'?2:1):0)+(counts.video?1:0)+(counts.audio?1:0)};
 if(genericVideoProfile){
  const context=createVideoParameterContext({profile:genericVideoProfile,modelName:model,baseUrl:url,resolution:effective.resolution,duration:effective.duration,videoDurations:configuration.probe?.data?.videoDurations,aspectRatio:effective.aspectRatio,nodeAspectRatio:fields.selectedAspectRatio});
  const request=createVideoBaseRequest({model,prompt:args.prompt,requestType:genericVideoType,profile:genericVideoProfile,context});
  if(request.body)request.body=finalizeVideoJsonRequest(request.body,{model,profile:genericVideoProfile,context});
  requestPreview=reviewVideoRequest(request,genericVideoProfile,genericVideoType);
 }
 return {kind:'generation',generationKind:kind,model,prompt:args.prompt,parameters:Object.fromEntries(Object.entries(effective).filter(([k,v])=>['size','resolution','duration','aspectRatio','mode'].includes(k)&&v!=='')),...(requestPreview?{requestPreview}:{}),effectiveArguments:effective,nodeFields:fields,mediaCount:mediaTypes.length+portraits.length,...(references.length?{references}:{}),...(portraits.length?{portraitAssetIds:portraits,portraitStatusChecked:false}:{}),mayCharge:true,priceChecked:false,networkChecked:false};
}
/** Prepare all source nodes with the real factory before any canvas setter.
 * Main-supplied sources are durable imported CAS media, never temp paths or
 * caller-provided URLs. IDs/capabilities themselves are not project fields. */
export function prepareApplicationGenerationReferences(nodeId:string,references:any[],prepareNode:any,portraits:any[]=[]){
 const verified=applicationReferenceMetadata(references.map(r=>r.referenceId),references,true);
 const portraitMetadata=applicationTianjiPortraitMetadata(portraits.map(p=>p?.assetId),portraits);
 const checks:any[]=verified.map((r,i)=>({id:'automation-reference-'+crypto.randomUUID(),type:r.type==='image'?'imageNode':r.type==='video'?'videoNode':'audioNode',field:r.type+'Url',source:r.source,kind:r.type,index:i}));
 for(const p of portraitMetadata)checks.push({id:'automation-reference-'+crypto.randomUUID(),type:'imageNode',kind:'portrait',index:checks.length,fields:{...wanjuanTianjiPortraitNodeDataFromAutomation(p.assetId),tianjiPortraitGroupType:p.groupType}});
 const nodes=checks.map(r=>prepareNode(r.type,{x:-360,y:r.index*280},{__nodeId:r.id,...(r.kind==='portrait'?r.fields:{[r.field]:r.source,mediaKind:r.kind}),text:'',prompt:'',label:''}));
 const edges=checks.map(r=>({id:'automation-edge-'+crypto.randomUUID(),source:r.id,target:nodeId,targetHandle:null,type:'custom',animated:r.kind==='image'}));
 return {nodes,edges,checks};
}
/** Guard the actually created target before handing it to existing generators.
 * Does not grant authority; the caller must also check the private environment.
 */
export function assertApplicationGenerationTarget(nodes:any[],edges:any[],nodeId:string,type:string,prompt:string,model:string,fields:any={},references:any[]=[],referenceEdges:any[]=[],allowRunning=false){
 const node=nodes.find(n=>n.id===nodeId);if(!node||node.type!==type||node.data?.prompt!==prompt||node.data?.manuallyStopped||!allowRunning&&node.data?.loading)fail('PLAN_STALE');
 const actual=type==='seedanceNode'?node.data?.tianjiSelectedModel:node.data?.selectedModel;
 const incoming=edges.filter(e=>e.target===nodeId);
 if(actual!==model||incoming.length!==referenceEdges.length||incoming.some(e=>!referenceEdges.some(expected=>['id','source','target','sourceHandle','targetHandle'].every(k=>(expected[k]??null)===(e[k]??null)))))fail('PLAN_STALE');
 for(const [key,value]of Object.entries(fields))if(node.data?.[key]!==value)fail('PLAN_STALE');
 if(node.data?.selectedApiConfigId||node.data?.apiConfigId||node.data?.selectedContextResources?.length)fail('PLAN_STALE');
 for(const r of references){
  const source=nodes.find(n=>n.id===r.id);if(!source||source.type!==r.type||wanjuanNodeTextValue(source)||edges.some(e=>e.target===r.id))fail('PLAN_STALE');
  if(r.kind==='portrait'){
   for(const [key,value]of Object.entries(r.fields))if(source.data?.[key]!==value)fail('PLAN_STALE');
   if(['videoUrl','audioUrl','mediaUrl','localPath','filePath','path','seedanceAssetId','arkTrustedAssetId'].some(k=>source.data?.[k])||source.data?.selectedContextResources?.length)fail('PLAN_STALE');
   continue;
  }
  if(source.data?.[r.field]!==r.source||source.data?.mediaKind!==r.kind)fail('PLAN_STALE');
  if(['imageUrl','videoUrl','audioUrl','mediaUrl','localPath','filePath','path'].some(k=>k!==r.field&&source.data?.[k])||['seedanceAssetId','tianjiPortraitAssetId','arkTrustedAssetId','isTianjiPortrait'].some(k=>source.data?.[k])||source.data?.selectedContextResources?.length)fail('PLAN_STALE');
  const media=wanjuanCollectNodeReferenceMedia(source);if(r.kind==='image'&&(media.images.length!==1||media.images[0]!==wanjuanNormalizeReferenceMediaUrl(r.source)||media.videos.length)||r.kind==='video'&&(media.videos.length!==1||media.videos[0]!==wanjuanNormalizeReferenceMediaUrl(r.source)||media.images.length))fail('PLAN_STALE');
 }
 return true;
}
/** A stale task record must never stop a newer run sharing the same node. */
export function assertApplicationTaskCancellationTarget(nodes:any[],task:any,fallbackJob?:any){
 const node=nodes.find(n=>n.id===task.nodeId);
 if(!node||node.data?.manuallyStopped===true)fail('OPERATION_TASK_CHANGED');
 const current=node.data?.seedanceTaskId||node.data?.taskId||node.data?.tianjiExecuteId;
 if(current?current!==task.id:!fallbackJob||fallbackJob.id!==task.id||fallbackJob.projectId!==task.projectId)fail('OPERATION_TASK_CHANGED');
 if(node.data?.loading!==true&&!['pending','submitting'].includes(task.status))fail('OPERATION_TASK_CHANGED');
 return true;
}
