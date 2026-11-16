type Protocol='openai-chat'|'openai-responses'|'gemini';
const fail=(code='ASSISTANT_STREAM_INCOMPLETE'):never=>{throw Object.assign(new Error(code),{code});};
/** Actual network chunks only; reasoning, tool arguments and raw errors never
 * become answer text. A text delta is not proof of successful completion. */
export async function readAssistantTextResponse(response:Response,protocol:Protocol,{signal,onText}:{signal?:AbortSignal;onText?:(text:string)=>void}={}){
 let text='',complete=false,buffer='',total=0;
 const check=()=>{if(signal?.aborted)fail('ASSISTANT_CANCELLED');};
 const publish=(part:unknown)=>{if(typeof part!=='string')return;text+=part;if(text.length>200000)fail('ASSISTANT_STREAM_LIMIT');try{onText?.(text);}catch{/* A view failure cannot replay or change a network request. */}};
 if(!/text\/event-stream/i.test(response.headers?.get?.('content-type')||'')){
  const data=await response.json();check();
  if(protocol==='gemini'){if(data?.candidates?.[0]?.finishReason&&data.candidates[0].finishReason!=='STOP')fail();text=(data?.candidates?.[0]?.content?.parts||[]).filter((p:any)=>!p.thought).map((p:any)=>typeof p.text==='string'?p.text:'').join('');}
  else if(protocol==='openai-responses'){if(data?.status&&data.status!=='completed')fail();text=data?.output_text||(data?.output||[]).filter((p:any)=>(!p.type||p.type==='message')&&(!p.role||p.role==='assistant')).flatMap((p:any)=>p.content||[]).filter((p:any)=>!p.type||p.type==='output_text').map((p:any)=>p.text||'').join('');}
  else {if(data?.choices?.[0]?.finish_reason&&data.choices[0].finish_reason!=='stop')fail();const content=data?.choices?.[0]?.message?.content;text=typeof content==='string'?content:Array.isArray(content)?content.filter(p=>!p.type||p.type==='text').map(p=>p.text||'').join(''):'';}
  if(typeof text!=='string'||text.length>200000||!text.trim())fail();return text.trim();
 }
 function frame(raw:string){
  const data=raw.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
  if(!data||data==='[DONE]')return;
  let value:any;try{value=JSON.parse(data);}catch{fail();}
  if(value.error||value.type==='error'||value.type==='response.failed'||value.type==='response.incomplete')fail();
  if(protocol==='openai-chat'){
   const item=value.choices?.find((c:any)=>c.index===0||c.index===undefined);
   if(item?.delta?.content!==undefined){if(complete)fail();publish(item.delta.content);}
   if(item?.finish_reason!=null){if(item.finish_reason!=='stop')fail();complete=true;}
  }else if(protocol==='openai-responses'){
   if(value.type==='response.output_text.delta'){if(complete)fail();publish(value.delta);}
   if(value.type==='response.completed'){if(value.response?.status&&value.response.status!=='completed')fail();complete=true;}
  }else{
   const item=value.candidates?.[0];for(const part of item?.content?.parts||[]){if(part.thought)continue;if(typeof part.text==='string'){if(complete)fail();publish(part.text);}}
   if(item?.finishReason){if(item.finishReason!=='STOP')fail();complete=true;}
   if(value.promptFeedback?.blockReason)fail();
  }
 }
 if(!response.body)fail();const reader=response.body.getReader(),decoder=new TextDecoder();
 try{
  for(;;){check();const {done,value}=await reader.read();check();if(done){buffer+=decoder.decode();break;}
   total+=value.byteLength;if(total>8*1024*1024)fail('ASSISTANT_STREAM_LIMIT');buffer+=decoder.decode(value,{stream:true});buffer=buffer.replace(/\r\n/g,'\n');
   let end;while((end=buffer.indexOf('\n\n'))>=0){frame(buffer.slice(0,end));buffer=buffer.slice(end+2);}if(buffer.length>256*1024)fail('ASSISTANT_STREAM_LIMIT');
   if(complete){await reader.cancel().catch(()=>{});break;} // A terminal frame need not wait for an idle keep-alive connection.
  }
  if(!complete&&buffer.trim())frame(buffer.replace(/\r\n/g,'\n'));if(!complete||!text.trim())fail();return text.trim();
 }catch(error:any){await reader.cancel().catch(()=>{});if(signal?.aborted)fail('ASSISTANT_CANCELLED');if(!/^ASSISTANT_[A-Z_]+$/.test(error?.code||''))fail('ASSISTANT_PROVIDER_NETWORK');throw error;}
 finally{reader.releaseLock();}
}
