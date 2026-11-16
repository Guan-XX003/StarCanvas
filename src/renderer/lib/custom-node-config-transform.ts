/** Canvas transforms for local encrypted-vault references and portable backup. */
const MARKER = "$starcanvasEncryptedConfig";
const REFERENCE = /^custom-config-v1:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Bridge = {customConfigProtect?:(config:unknown)=>Promise<any>;customConfigRestore?:(reference:string)=>Promise<any>};
const invalid = () => Object.assign(new Error("CUSTOM_CONFIG_PROTECTION_FAILED"),{code:"CUSTOM_CONFIG_PROTECTION_FAILED"});
const plainObject = (value:any) => !!value && typeof value === "object" && !Array.isArray(value);

/** Device-local vault references are not portable backup data. */
export function assertCanvasHasNoLocalConfigReferences(state:any) {
  if (!plainObject(state) || !Array.isArray(state.nodes)) return;
  for (const node of state.nodes) {
    const config=node?.type === "customNode" ? node.data?.config : null;
    if (plainObject(config) && Object.hasOwn(config,MARKER)) {
      throw Object.assign(new Error("CUSTOM_CONFIG_BACKUP_NOT_PORTABLE"),{code:"CUSTOM_CONFIG_BACKUP_NOT_PORTABLE"});
    }
  }
}

/** Live/legacy custom configs also need password encryption on export. Merely
 * checking for vault references would leak an in-memory restored config. */
export function assertCanvasHasNoPlainExportCustomConfigs(state:any) {
  assertCanvasHasNoLocalConfigReferences(state);
  if (!plainObject(state) || !Array.isArray(state.nodes)) return;
  if (state.nodes.some((node:any)=>node?.type === 'customNode' && node.data?.config != null)) {
    throw Object.assign(new Error('CUSTOM_CONFIG_BACKUP_NOT_PORTABLE'),{code:'CUSTOM_CONFIG_BACKUP_NOT_PORTABLE'});
  }
}

/** All snapshots are captured before the first async call. Never mutate input. */
export async function protectCanvasCustomConfigs(state:any, bridge:Bridge) {
  if (!plainObject(state) || !Array.isArray(state.nodes)) throw invalid();
  const plans = state.nodes.map((node:any) => {
    if (node?.type !== "customNode" || node.data?.config == null) return null;
    const config = node.data.config;
    if (!plainObject(config) || Object.hasOwn(config,MARKER)) throw invalid();
    try {
      const text=JSON.stringify(config);
      const snapshot=JSON.parse(text);
      if (!plainObject(snapshot)) throw invalid();
      return snapshot;
    } catch { throw invalid(); }
  });
  if (plans.some(Boolean) && typeof bridge?.customConfigProtect !== "function") throw invalid();
  const nodes = [...state.nodes];
  for (let i=0;i<plans.length;i++) {
    if (!plans[i]) continue;
    let result:any;
    try { result=await bridge.customConfigProtect!(plans[i]); } catch { throw invalid(); }
    if (result?.ok !== true || typeof result.reference !== "string" || !REFERENCE.test(result.reference)) throw invalid();
    nodes[i]={...nodes[i],data:{...nodes[i].data,config:{[MARKER]:result.reference}}};
  }
  return {...state,nodes};
}

/** An invalid, missing or inaccessible reference fails instead of yielding an empty config. */
export async function restoreCanvasCustomConfigs(state:any, bridge:Bridge) {
  if (!plainObject(state) || !Array.isArray(state.nodes)) throw invalid();
  const nodes=[...state.nodes];
  // Validate and capture every reference before the first asynchronous vault
  // call, so an edited or replaced later node cannot redirect a pending read.
  const plans = nodes.map((node:any) => {
    const config=node?.type === "customNode" ? node.data?.config : null;
    if (!plainObject(config) || !Object.hasOwn(config,MARKER)) return null;
    const reference=config[MARKER];
    if (Object.keys(config).length !== 1 || typeof reference !== "string" || !REFERENCE.test(reference) || typeof bridge?.customConfigRestore !== "function") throw invalid();
    return {reference,node:{...node,data:{...node.data}}};
  });
  for (let i=0;i<plans.length;i++) {
    const plan=plans[i];
    if (!plan) continue;
    let result:any;
    try {result=await bridge.customConfigRestore!(plan.reference);} catch {throw invalid();}
    if (result?.ok !== true || !plainObject(result.config) || Object.hasOwn(result.config,MARKER)) throw invalid();
    nodes[i]={...plan.node,data:{...plan.node.data,config:result.config}};
  }
  return {...state,nodes};
}

/** Convert only selected canvas states, in memory, before password encryption.
 * References elsewhere are rejected: exporting one would create a backup that
 * cannot be restored on another device. Never mutate the caller's payload. */
export async function makeEncryptedBackupConfigsPortable(payload:any, bridge:Bridge) {
  const states = payload?.modules?.projects?.localforage?.canvasStates;
  let portable = payload;
  if (plainObject(states)) {
    const converted:Record<string,unknown> = {};
    for (const [id,state] of Object.entries(states)) {
      converted[id] = await restoreCanvasCustomConfigs(state, bridge);
    }
    portable = {...payload,modules:{...payload.modules,projects:{...payload.modules.projects,
      localforage:{...payload.modules.projects.localforage,canvasStates:converted}}}};
  }
  const pending:unknown[] = [portable], seen = new WeakSet<object>();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    if (Object.hasOwn(current,MARKER)) throw Object.assign(new Error("CUSTOM_CONFIG_BACKUP_NOT_PORTABLE"),{code:"CUSTOM_CONFIG_BACKUP_NOT_PORTABLE"});
    for (const value of Object.values(current)) pending.push(value);
  }
  return portable;
}
