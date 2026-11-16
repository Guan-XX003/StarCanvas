import {invokeDesktopProxyFetchStream} from '../../../electron/shared/desktop-response-stream.mjs';
/** Keep the existing desktop URL/security/transport owner. contextBridge cannot
 * transfer a Response; a scoped callback carries frames, not public IPC access. */
export async function fetchAssistantStream(input:string,init:RequestInit){
 const bridge=(globalThis as any).wanjuanDesktop;
 if(typeof bridge?.proxyFetchStream!=='function')return fetch(input,init);
 const request=new Request(input,init),bytes=new Uint8Array(await request.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 const payload={requestId:'assistant-stream-'+crypto.randomUUID(),url:request.url,method:request.method,headers:Object.fromEntries(request.headers.entries()),bodyBase64:btoa(binary)},listeners=new Set<Function>();
 const ipc={on:(_channel:string,listener:Function)=>listeners.add(listener),removeListener:(_channel:string,listener:Function)=>listeners.delete(listener),
  send:(_channel:string,id:string)=>{try{void Promise.resolve(bridge.abortProxyFetch(id)).catch(()=>{});}catch{}},invoke:(_channel:string,value:any)=>bridge.proxyFetchStream(value,(part:any)=>{for(const listener of listeners)listener(null,part);})};
 return invokeDesktopProxyFetchStream(ipc,payload,init.signal);
}
