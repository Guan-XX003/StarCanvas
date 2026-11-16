/** One cancellable automatic fit after a project load. A hidden/zero-sized
 * canvas must not start a d3 zoom interpolation. Wait for actual size instead
 * of polling or fitting once for every node edit. No canvas data is changed.
 */
export function canvasViewportAreaReady(area:{width:number;height:number}|null|undefined) {
 return !!area&&Number.isFinite(area.width)&&Number.isFinite(area.height)&&area.width>0&&area.height>0;
}
export function scheduleCanvasLoadFit(element:HTMLElement,fit:()=>void) {
 let stopped=false,fired=false,timer:ReturnType<typeof setTimeout>|undefined;
 const cancelTimer=()=>{if(timer!==undefined){clearTimeout(timer);timer=undefined;}};
 const run=()=>{
  timer=undefined;
  if(stopped||fired||!element.isConnected||!canvasViewportAreaReady(element.getBoundingClientRect()))return;
  fired=true;observer?.disconnect();fit();
 };
 const schedule=()=>{if(!stopped&&!fired&&timer===undefined)timer=setTimeout(run,100);};
 const observer=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
 observer?.observe(element);schedule();
 return ()=>{stopped=true;cancelTimer();observer?.disconnect();};
}
