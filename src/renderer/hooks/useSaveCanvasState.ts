/**
 * Ordered canvas saves with encrypted custom-config snapshots before persistence.
 */
import { useCallback, useEffect, useRef } from "react";
import type { Ref, SetAny, Toast, WjEdge, WjNode } from "../lib/app-types";
import { createCustomConfigSnapshotCache } from '../lib/custom-node-config-cache';
import { captureCanvasPersistenceSnapshot } from '../lib/canvas-persistence-snapshot';
import { registerDesktopCloseParticipant } from '../lib/desktop-close';
declare const chrome: any;

// Shared across remounts in this renderer: a delayed save from an old canvas
// instance must not overtake a newer instance of the same project.
const canvasSaveOrder: {latest:Map<any,number>; queues:Map<any,Promise<boolean>>} = {latest:new Map(),queues:new Map()};

interface UseSaveCanvasStateDeps {
  WanJuanStripRuntimeNodeData: any;
  canvasStateKeyPrefix: any;
  desktopCanvasMirrorPrefix: any;
  edgesRef: Ref<WjEdge[]>;
  externalizeProjectCanvasState: any;
  historyIndexRef: Ref;
  isRestoringRef: Ref;
  localforageModule: any;
  nodesRef: Ref<WjNode[]>;
  projectIdRef: Ref;
  setHistory: SetAny;
  setHistoryIndex: SetAny;
  shouldFitViewRef: Ref;
  showToast: Toast;
}

export function useSaveCanvasState(deps: UseSaveCanvasStateDeps) {
  const {
    WanJuanStripRuntimeNodeData,
    canvasStateKeyPrefix,
    desktopCanvasMirrorPrefix,
    edgesRef,
    externalizeProjectCanvasState,
    historyIndexRef,
    isRestoringRef,
    localforageModule,
    nodesRef,
    projectIdRef,
    setHistory,
    setHistoryIndex,
    shouldFitViewRef,
    showToast,
  } = deps;
  // Keep a small LRU of per-project close caches. An in-flight save captures
  // its own cache before awaiting and remains valid even if the map evicts it.
  const configCaches=useRef(new Map<any,ReturnType<typeof createCustomConfigSnapshotCache>>());
  // Encryption preparation alone is not a completed project save. A normal
  // load prefers the primary project over an unload mirror, so permitting a
  // close before the primary commit could restore the previous manual config.
  // Track only the protected config references, not ReactFlow array identity:
  // layout/runtime updates replace those arrays without changing manual config.
  // This receipt does not upgrade other canvas fields' best-effort unload path.
  const committedConfigs=useRef(new Map<any,string>());
  const configSignature=(state:any)=>JSON.stringify(state.nodes.filter((node:any)=>node.type==='customNode'&&node.data?.config!=null)
    .map((node:any)=>[node.id,node.data.config]));
  const getConfigCache=useCallback((id:any)=>{
    let cache=configCaches.current.get(id);
    if (!cache) cache=createCustomConfigSnapshotCache(window.wanjuanDesktop || {});
    configCaches.current.delete(id);configCaches.current.set(id,cache);
    while (configCaches.current.size > 8) {
      const oldest=configCaches.current.keys().next().value;
      configCaches.current.delete(oldest);committedConfigs.current.delete(oldest);
    }
    return cache;
  },[]);
  const getProtectedCanvasSnapshot=useCallback((id:any,state:any)=>{
    const snapshot=getConfigCache(id).snapshot(state);
    if (!snapshot) return null;
    if (snapshot.nodes.some((node:any)=>node.type==='customNode'&&node.data?.config!=null)) {
      if (committedConfigs.current.get(id)!==configSignature(snapshot)) return null;
    }
    return snapshot;
  },[]);
  const prepareCanvasConfigs=useCallback(async()=>{
    if (!shouldFitViewRef.current) return;
    const id=projectIdRef.current,cache=getConfigCache(id);
    await cache.prepare({nodes:nodesRef.current || []});
  },[]);
  // Preparation can finish out of order. Serialize the final write per
  // project and discard prepared snapshots superseded by a later save.
  const saveCanvasState = useCallback(async () => {
	      if (!shouldFitViewRef.current) return {ok:true,status:'not-loaded'};
	      globalThis.__wanjuanLastCanvasActivityAt = Date.now();
	      try {
	        globalThis.__wanjuanProjectSafetyRetryCanvasSave = saveCanvasState;
	      } catch {}
	      let currentProjectId = projectIdRef.current,
	        savedNodes = nodesRef.current,
	        savedEdges = edgesRef.current,
	        storageKey = `${canvasStateKeyPrefix}${currentProjectId}`,
	        sequence = (canvasSaveOrder.latest.get(currentProjectId) || 0) + 1,
	        canvasState;
      const configCache=getConfigCache(currentProjectId);
      let protectedForPersistence=false;
      let preparedConfigSignature='';
      let configReferences:any[]=[];
      let committed=false;
      canvasSaveOrder.latest.set(currentProjectId, sequence);
      const isLatest = () => canvasSaveOrder.latest.get(currentProjectId) === sequence;
      if (globalThis.__wanjuanProjectMigrationLocks?.has(currentProjectId)) {
        console.warn(`Canvas save skipped while project migration is active`);
        return {ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'};
      }
      if (globalThis.__wanjuanStorageMaintenanceRunning) {
        console.warn(`Canvas save skipped while storage maintenance is active`);
        return {ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'};
      }
      try {
          canvasState=captureCanvasPersistenceSnapshot(savedNodes,savedEdges,WanJuanStripRuntimeNodeData);
          configReferences=typeof globalThis.collectProjectFileReferences === 'function'
            ? [...globalThis.collectProjectFileReferences(canvasState.nodes.filter(node=>node.type==='customNode').map(node=>node.data?.config))] : [];
          let mainMigrationLock = await window.wanjuanDesktop?.isProjectMigrationLocked?.({
            projectId: currentProjectId,
            directory: ``,
          });
          if (mainMigrationLock?.locked) {
            console.warn(`Canvas save skipped by main-process migration lock`);
            return {ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'};
          }
	        canvasState = await configCache.prepare(canvasState);
          preparedConfigSignature=configSignature(canvasState);
          protectedForPersistence=true;
          if (!isLatest()) return {ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'};
	        (canvasState = await globalThis.prepareProjectMediaStateForPersistence(
	          canvasState,
	          currentProjectId,
	          ``,
	        )),
	        (canvasState = await externalizeProjectCanvasState(canvasState, currentProjectId, {
	          persist: true,
	        }));
	        if (!isLatest()) return {ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'};
	        let safetyResult =
	          globalThis.wanjuanProjectSafety?.beforeCanvasSave ?
	          await globalThis.wanjuanProjectSafety.beforeCanvasSave({
	            projectId: currentProjectId,
	            state: canvasState,
	            previousState: await localforageModule.default.getItem(storageKey),
	          }) :
	          null;
	        if (!isLatest()) return {ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'};
	        if (safetyResult?.block) {
	          console.warn(`Suspicious canvas save blocked`);
	          let promptResult =
	            globalThis.wanjuanProjectSafety?.showBlockedSavePrompt ?
	            globalThis.wanjuanProjectSafety.showBlockedSavePrompt(safetyResult) :
	            null;
	          if (!promptResult?.dismissed) {
	            promptResult ||
	              showToast(safetyResult.message || `已拦截疑似异常保存，上一版画布已保存在安全快照。`);
	            return {ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'};
	          }
	        }
          mainMigrationLock = await window.wanjuanDesktop?.isProjectMigrationLocked?.({
            projectId: currentProjectId,
            directory: ``,
          });
          if (mainMigrationLock?.locked) {
            console.warn(`Canvas save cancelled because migration started during persistence`);
            return {ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'};
          }
          if (globalThis.__wanjuanStorageMaintenanceRunning) {
            console.warn(`Canvas save cancelled because storage maintenance started during persistence`);
            return {ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'};
          }
          const prior = canvasSaveOrder.queues.get(currentProjectId) || Promise.resolve();
          const commit = prior.catch(() => {}).then(async () => {
            if (!isLatest() || globalThis.__wanjuanStorageMaintenanceRunning || globalThis.__wanjuanProjectMigrationLocks?.has(currentProjectId)) return false;
            const lock = await window.wanjuanDesktop?.isProjectMigrationLocked?.({projectId:currentProjectId,directory:``});
            if (lock?.locked || !isLatest() || globalThis.__wanjuanStorageMaintenanceRunning || globalThis.__wanjuanProjectMigrationLocks?.has(currentProjectId)) return false;
          await localforageModule.default.setItem(storageKey, canvasState);
          if(window.wanjuanDesktop?.syncProjectReferences){
            const result=await window.wanjuanDesktop.syncProjectReferences({
              projectId:currentProjectId,directory:``,
              references:[...new Set([...globalThis.collectProjectFileReferences(canvasState),...configReferences])],complete:true,
            });
            if(result?.ok===false)throw Error('CANVAS_REFERENCE_SYNC_FAILED');
          }
          if(typeof chrome!=='undefined'&&chrome.storage?.local){
            await chrome.storage.local.set({[`${desktopCanvasMirrorPrefix}${currentProjectId}`]:canvasState});
          }
          if (isLatest() && configCaches.current.get(currentProjectId)===configCache) committedConfigs.current.set(currentProjectId,preparedConfigSignature);
          return true;
          });
          canvasSaveOrder.queues.set(currentProjectId,commit);
          try { committed=(await commit)===true; } finally { if (canvasSaveOrder.queues.get(currentProjectId) === commit) canvasSaveOrder.queues.delete(currentProjectId); }
      } catch (error) {
        // Storage errors and safety results can contain serialized user content.
        console.error(`Canvas save failed`);
        if (isLatest() && protectedForPersistence && (error?.name === `QuotaExceededError` || (typeof error?.message === `string` && error.message.includes(`quota`)))) {
          // localforage(IndexedDB) 配额不足时，兜底写 chrome.storage.local(桌面端为磁盘存储、配额更大)，尽量不丢本次画布
          try {
            const fallback=typeof chrome < `u` && chrome.storage?.local?.set?.({
              [`${desktopCanvasMirrorPrefix}${currentProjectId}`]: canvasState,
            });
            fallback?.catch?.(()=>{});
          } catch {}
          globalThis.__wanjuanLastCanvasSaveQuotaError = { projectId: currentProjectId, at: Date.now() };
          showToast(`存储空间不足，无法保存画布。请尝试清理一些不需要的节点或图片。`);
        } else if (isLatest()) {
          // The primary write might have succeeded before a later reference
          // sync failed. Report uncertainty rather than claiming either result.
          showToast(`无法确认画布已完整保存，请暂时不要关闭项目，检查存储后重试。`);
        }
        return {ok:false,code:'DESKTOP_CLOSE_SAVE_FAILED'};
      }
	      isRestoringRef.current ||
	        (setHistory((history2) => {
	            let currentSnapshot = history2[historyIndexRef.current];
	            if (currentSnapshot && currentSnapshot.nodes === savedNodes && currentSnapshot.edges === savedEdges) return history2;
	            let nextHistory = history2.slice(0, historyIndexRef.current + 1);
	            return (
	              nextHistory.push({
	                nodes: savedNodes,
	                edges: savedEdges
	              }),
              nextHistory.length > 15 && nextHistory.shift(),
              nextHistory
            );
          }),
          setHistoryIndex((prevIndex) => {
            let nextIndex = Math.min(prevIndex + 1, 14);
            return ((historyIndexRef.current = nextIndex), nextIndex);
          }));
      return committed&&isLatest()?{ok:true,status:'committed'}:{ok:false,code:'DESKTOP_CLOSE_CHANGED'};
    }, []);
  const prepareClose=useCallback(async()=>{
    if(!shouldFitViewRef.current)return {ok:true};
    const project=projectIdRef.current;
    const signature=()=>JSON.stringify(captureCanvasPersistenceSnapshot(nodesRef.current,edgesRef.current,WanJuanStripRuntimeNodeData));
    const before=signature(),receipt=await saveCanvasState();
    if(!receipt?.ok)return receipt;
    if(projectIdRef.current!==project||!shouldFitViewRef.current||signature()!==before)return {ok:false,code:'DESKTOP_CLOSE_CHANGED'};
    return {ok:true};
  },[saveCanvasState]);
  useEffect(()=>registerDesktopCloseParticipant('canvas',prepareClose),[prepareClose]);
  return { saveCanvasState, prepareCanvasConfigs, getProtectedCanvasSnapshot };
}
