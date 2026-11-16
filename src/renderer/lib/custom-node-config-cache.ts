/** Prepared immutable encrypted configs for asynchronous saves and synchronous
 * close snapshots. Callers must not persist an unavailable snapshot. */
const MARKER = "$starcanvasEncryptedConfig";
const REFERENCE = /^custom-config-v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_CONFIG_BYTES = 64 * 1024;
const problem = () => Object.assign(new Error("CUSTOM_CONFIG_PROTECTION_FAILED"), {code:"CUSTOM_CONFIG_PROTECTION_FAILED"});
type State = {nodes:any[]; [key:string]:any};
type Entry = {reference?:string; promise:Promise<void>};
type Bridge = {customConfigProtect?:(config:unknown)=>Promise<any>};

/** Capture every config before awaiting encryption; never put plaintext in a
 * persisted cache, and never silently substitute an older encrypted version. */
function capture(state:State) {
  if (!state || typeof state !== "object" || !Array.isArray(state.nodes)) throw problem();
  const plans = state.nodes.map((node:any) => {
    if (node?.type !== "customNode" || node.data?.config == null) return null;
    const config=node.data.config;
    if (!config || typeof config !== "object" || Array.isArray(config) || Object.hasOwn(config,MARKER)) throw problem();
    try {
      const text=JSON.stringify(config);
      if (typeof text !== "string" || new TextEncoder().encode(text).byteLength > MAX_CONFIG_BYTES) throw problem();
      const snapshot=JSON.parse(text);
      if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) throw problem();
      return {text,snapshot,node:{...node,data:{...node.data}}};
    } catch { throw problem(); }
  });
  return plans;
}

export function createCustomConfigSnapshotCache(bridge:Bridge, maxEntries=256) {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 4096) throw problem();
  const entries=new Map<string,Entry>();
  let epoch=0;
  function start(text:string, snapshot:unknown) {
    const existing=entries.get(text);
    if (existing) return existing;
    const entry:Entry={promise:Promise.resolve()};
    entry.promise=Promise.resolve().then(async()=>{
      if (typeof bridge?.customConfigProtect !== "function") throw problem();
      let result:any;
      try { result=await bridge.customConfigProtect(snapshot); } catch { throw problem(); }
      if (result?.ok !== true || typeof result.reference !== "string" || !REFERENCE.test(result.reference)) throw problem();
      // Eviction cannot invalidate an immutable record an in-flight save has
      // already requested. The entry remains private to that caller and must
      // never be reinserted into the current synchronous-close cache.
      entry.reference=result.reference;
    }).catch(()=>{
      if (entries.get(text) === entry) entries.delete(text);
      throw problem();
    });
    entries.set(text,entry);
    return entry;
  }
  return Object.freeze({
    async prepare(state:State) {
      const capturedEpoch=epoch, plans=capture(state), nodes=[...state.nodes], unique=new Map<string,unknown>();
      for (const plan of plans) if (plan) unique.set(plan.text,plan.snapshot);
      if (unique.size > maxEntries) throw problem();
      // Evict only entries not required for this snapshot. A pending vault
      // write may finish later, but its result cannot repopulate the map.
      for (const text of entries.keys()) if (!unique.has(text)) entries.delete(text);
      const prepared=new Map([...unique].map(([text,snapshot])=>[text,start(text,snapshot)]));
      await Promise.all([...prepared.values()].map(entry=>entry.promise));
      if (epoch !== capturedEpoch) throw problem();
      for (let i=0;i<plans.length;i++) {
        const plan=plans[i];if (!plan) continue;
        const reference=prepared.get(plan.text)?.reference;
        if (!reference) throw problem();
        nodes[i]={...plan.node,data:{...plan.node.data,config:{[MARKER]:reference}}};
      }
      return {...state,nodes};
    },
    snapshot(state:State) {
      const plans=capture(state), nodes=[...state.nodes];
      for (let i=0;i<plans.length;i++) {
        const plan=plans[i];if (!plan) continue;
        const reference=entries.get(plan.text)?.reference;
        if (!reference) return null;
        nodes[i]={...nodes[i],data:{...nodes[i].data,config:{[MARKER]:reference}}};
      }
      return {...state,nodes};
    },
    clear() { epoch++;entries.clear(); },
  });
}
