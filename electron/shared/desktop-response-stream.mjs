// One explicitly requested response, delivered only to its originating frame.
// No retries, durable body cache, global response enumeration or new URL policy.
const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
export function invokeDesktopProxyFetchStream(ipc,payload,signal){
 return new Promise((resolve,reject)=>{
  let control,headers=false,finished=false,sequence=0,total=0,endResult=null,endTimer;
  const channel='wanjuan:proxy-fetch-stream';
  const error=()=>new TypeError('Streaming response unavailable');
  const abortError=()=>Object.assign(new Error('The operation was aborted.'),{name:'AbortError'});
  const cleanup=()=>{clearTimeout(endTimer);ipc.removeListener(channel,onFrame);signal?.removeEventListener('abort',onAbort);};
  const stop=e=>{if(finished)return;finished=true;cleanup();ipc.send('wanjuan:abort-fetch',payload.requestId);if(headers)control.error(e);else reject(e);};
  const body=new ReadableStream({start:c=>{control=c;},cancel:()=>{if(finished)return;finished=true;cleanup();ipc.send('wanjuan:abort-fetch',payload.requestId);}},{highWaterMark:512*1024,size:c=>c.byteLength});
  function settle(){if(!endResult||finished)return;if(sequence!==endResult.streamChunks)return;finished=true;cleanup();control.close();}
  function onFrame(_event,part){
   if(finished||part?.requestId!==payload.requestId)return;
   if(part.type==='headers'){
    if(headers||!Number.isInteger(part.status)||part.status<200||part.status>599){stop(error());return;}
    try{const response=new Response(body,{status:part.status,statusText:part.statusText||'',headers:part.headers||[]});headers=true;resolve(response);}catch{stop(error());}
   }else if(part.type==='chunk'){
    if(!headers||part.sequence!==sequence+1||typeof part.base64!=='string'||part.base64.length>90000){stop(error());return;}
    let bytes;try{bytes=decode(part.base64);}catch{stop(error());return;}total+=bytes.length;if(total>8*1024*1024||control.desiredSize< -2*1024*1024){stop(error());return;}
    sequence++;control.enqueue(new Uint8Array(bytes));settle();
   }
  }
  function onAbort(){stop(abortError());}
  if(signal?.aborted){onAbort();return;}
  ipc.on(channel,onFrame);signal?.addEventListener('abort',onAbort,{once:true});
  Promise.resolve().then(()=>ipc.invoke('wanjuan:proxy-fetch',{...payload,streamResponse:true})).then(result=>{
   if(finished)return;if(!result?.ok||result.aborted){stop(result?.aborted?abortError():error());return;}
   if(!result.streamed){if(headers){stop(error());return;}try{if(typeof result.bodyBase64!=='string'||result.bodyBase64.length>12*1024*1024)throw error();const bytes=decode(result.bodyBase64);if(bytes.length>8*1024*1024)throw error();const response=new Response(bytes,{status:result.status,statusText:result.statusText||'',headers:result.headers||[]});finished=true;cleanup();resolve(response);}catch{stop(error());}return;}
   if(!headers||!Number.isSafeInteger(result.streamChunks)||result.streamChunks<sequence){stop(error());return;}
   endResult=result;settle();if(!finished)endTimer=setTimeout(()=>stop(error()),1500);
  }).catch(()=>stop(error()));
 });
}
