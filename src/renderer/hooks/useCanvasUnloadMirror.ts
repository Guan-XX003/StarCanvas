import { useEffect, useRef } from 'react';
import { captureCanvasPersistenceSnapshot } from '../lib/canvas-persistence-snapshot';

/** A synchronous unload must never fall back to a plaintext custom config. */
export function createCanvasUnloadHandler(deps:any) {
  return (event:any) => {
    let blocked=false;
    const deferUnsafeClose=()=>{
      if (event?.type !== 'beforeunload') return;
      event.preventDefault?.();
      event.returnValue=false;
      blocked=true;
      deps.showToast?.('配置正在安全保存，请稍后再关闭窗口；若未完成，请检查本机安全存储。');
      // The ordinary save owns locking, ordering, encryption and errors. This
      // does not generate media or alter the user's live configuration.
      Promise.resolve().then(()=>deps.saveCanvasState()).catch(()=>{});
    };
    try {
      if (deps.shouldFitViewRef.current) {
        const id=deps.projectIdRef.current;
        if (!globalThis.__wanjuanProjectMigrationLocks?.has(id) && !globalThis.__wanjuanStorageMaintenanceRunning) {
          const state=captureCanvasPersistenceSnapshot(deps.nodesRef.current,deps.edgesRef.current,deps.WanJuanStripRuntimeNodeData);
          const protectedState=deps.getProtectedCanvasSnapshot(id,state);
          if (!protectedState) deferUnsafeClose();
          else {
            // This remains the existing best-effort mirror. A full/quota-
            // blocked mirror must not trap a window whose encrypted snapshot
            // is already ready; importantly, there is no plaintext fallback.
            try { localStorage.setItem(`${deps.canvasStateKeyPrefix}${id}`,JSON.stringify(protectedState)); } catch {}
          }
        }
      }
    } catch {
      // A malformed/unprepared config is not permission to serialize it raw.
      deferUnsafeClose();
    }
    if (blocked) return;
    deps.abortControllersRef.current.forEach((controller:any)=>controller.abort());
    deps.abortControllersRef.current.clear();
  };
}

export function useCanvasUnloadMirror(deps:any) {
  const latest=useRef(deps);
  useEffect(()=>{latest.current=deps;});
  useEffect(()=>{
    const handler=(event:Event)=>createCanvasUnloadHandler(latest.current)(event);
    window.addEventListener('beforeunload',handler);
    window.addEventListener('pagehide',handler);
    return ()=>{
      window.removeEventListener('beforeunload',handler);
      window.removeEventListener('pagehide',handler);
    };
  },[]);
}
