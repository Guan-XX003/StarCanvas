/** The effective legacy video profile, shared by normal generation and local
 * operation review. Resolves existing configuration only; never probes a host.
 */
export function resolveVideoRequestProfile({modelName,baseUrl,protocol,profiles,onInvalid}:{modelName:string;baseUrl:string;protocol?:any;profiles?:any;onInvalid?:()=>void}) {
 if(protocol&&typeof protocol==='object'&&(!protocol.category||protocol.category==='video'))return protocol;
 let parsed=profiles;
 if(typeof parsed==='string'){try{parsed=JSON.parse(parsed);}catch{onInvalid?.();parsed={};}}
 if(parsed&&typeof parsed==='object'&&parsed[modelName])return parsed[modelName];
 let origin=baseUrl;try{origin=new URL(baseUrl).origin;}catch{}
 if(/^MiniMax-Hailuo-2\.3$/i.test(modelName))return /xpclaw\.ai/i.test(baseUrl)?{
  requestType:'openai-video',submitPath:`${origin}/v1/video/generations`,pollPath:`${origin}/v1/video/generations/{taskId}`,
  fieldMapping:{prompt:'prompt',resolution:'size',duration:'duration',referenceImage:'first_frame_image'},
 }:{requestType:'json-video',submitPath:`${origin}/v1/video_generation`,pollPath:`${origin}/v1/query/video_generation?task_id={taskId}`,
  fieldMapping:{duration:'duration',resolution:'resolution',referenceImage:'first_frame_image'}};
 if(/^grok-video/i.test(modelName)&&/xpclaw\.ai/i.test(baseUrl))return {
  requestType:'multipart-video',submitPath:`${origin}/v1/videos`,pollPath:`${origin}/v1/videos/{taskId}`,contentPath:`${origin}/v1/videos/{taskId}/content`,
  fieldMapping:{duration:'seconds',resolution:'size',referenceImage:'input_reference'},
 };
 return {};
}
