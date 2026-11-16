/** Derive plan choices from the same configured lists/protocol contract as the
 * canvas controls. Only model IDs and parameter options leave this module.
 */
import { WanJuanParseModelList } from './model-id';
import { parseSeedanceList } from './model-binding';
import { resolveMediaModelContract } from './media-model-contract';
import { wanjuanResolveVideoParameterMode } from './video-parameter-mode';
import { normalizeVideoAspectRatioValue } from './video-aspect-ratio';
import type { CanvasPlanCapabilities,PlanNode } from './canvas-operation-plan';

export const CANVAS_IMAGE_RESOLUTIONS=['1024x1024','1280x720','720x1280','2048x2048','2560x1440','1440x2560','3840x2160','2160x3840'];
export const CANVAS_IMAGE_RATIOS=['Auto','21:9','16:9','3:2','4:3','1:1','3:4','2:3','9:16'];
export const CANVAS_VIDEO_SIZE_PRESETS=[{label:'16:9',value:'1280x720'},{label:'9:16',value:'720x1280'},{label:'3:2',value:'1080x720'},{label:'2:3',value:'720x1080'},{label:'1:1',value:'720x720'}];
const strings=(value:any)=>Array.isArray(value)?value.map(String):[];
export function canvasNodePlanCapability(node:PlanNode):CanvasPlanCapabilities[string] {
 const d=node.data||{},type=node.type;
 const models=WanJuanParseModelList(type==='textNode'?d.textModel:type==='promptNode'?d.drawingModel:type==='videoNode'?d.videoModel:'');
 if(models.length>200)throw Object.assign(new Error('PLAN_MODEL_LIMIT'),{code:'PLAN_MODEL_LIMIT'});
 const modelParameters:Record<string,Record<string,string[]>>=Object.create(null);
 for(const model of models) {
  if(type==='textNode'){modelParameters[model]={};continue;}
  const category=type==='promptNode'?'image':'video';
  const contract=resolveMediaModelContract({category,model,apiConfigs:d.apiConfigs,apiBindings:category==='image'?d.imageModelApiBindings:d.videoModelApiBindings,
   protocolBindings:category==='image'?d.imageModelProtocolBindings:d.videoModelProtocolBindings,registry:d.modelProtocolRegistry,selectedApiConfigId:d.selectedApiConfigId||d.apiConfigId});
  // An explicit broken binding is not an invitation to invent a protocol.
  if(contract.protocolCategoryMismatch||contract.protocolConfigMissing)continue;
  const protocol:any=contract.protocol||{};
  if(type==='promptNode') {
   const fixed=String(protocol.parameterAdapter?.fixedImageSize||'');
   modelParameters[model]={imageSizeMode:fixed?['quality']:['quality','resolution'],imageSize:fixed?[fixed]:['1K','2K','4K'],
    aspectRatio:CANVAS_IMAGE_RATIOS.slice(),imageResolution:(d.imageCompatResolutions?parseSeedanceList(d.imageCompatResolutions):CANVAS_IMAGE_RESOLUTIONS).filter(v=>/^\d{2,5}x\d{2,5}$/i.test(v))};
  } else if(type==='videoNode') {
   const inferred=wanjuanResolveVideoParameterMode(protocol);
   modelParameters[model]={
    videoParameterMode:protocol.parameterModeLocked===true?[inferred]:[inferred,...['ratio-quality','exact-resolution'].filter(v=>v!==inferred)],
    selectedSeconds:Array.isArray(protocol.parameterOptions?.durations)?strings(protocol.parameterOptions.durations):parseSeedanceList(d.videoDurations||'10 15'),
    selectedVideoQuality:Array.isArray(protocol.parameterOptions?.qualities)?strings(protocol.parameterOptions.qualities):['480P','720P','1080P'],
    size:d.videoResolutions?parseSeedanceList(d.videoResolutions):CANVAS_VIDEO_SIZE_PRESETS.map(v=>v.value),
    selectedAspectRatio:(Array.isArray(protocol.parameterOptions?.aspectRatios)?strings(protocol.parameterOptions.aspectRatios):d.videoAspectRatios?parseSeedanceList(d.videoAspectRatios):['16:9','9:16','1:1','3:2','2:3']).map(v=>normalizeVideoAspectRatioValue(v,d.size||'1280x720')),
   };
  }
 }
 const usable=models.filter(model=>Object.hasOwn(modelParameters,model));
 const current=usable.includes(d.selectedModel)?d.selectedModel:usable[0];
 return {models:usable,parameters:modelParameters[current]||{},modelParameters};
}
export function initializeCanvasPlanNode(node:PlanNode) {
 const cap=canvasNodePlanCapability(node),data={...node.data};
 if(!data.selectedModel&&cap.models.length)data.selectedModel=cap.models[0];
 if(data.selectedModel){data.wanjuanModelManual=true;data.wanjuanModelAuto=false;}
 const parameters=cap.modelParameters&&Object.hasOwn(cap.modelParameters,data.selectedModel)?cap.modelParameters[data.selectedModel]:cap.parameters;
 for(const [key,values]of Object.entries(parameters))if(data[key]===undefined&&values.length)data[key]=values[0];
 return {...node,data};
}
