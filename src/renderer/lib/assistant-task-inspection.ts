/** In-memory, local-only handoff: never publish the task record or its content. */
type InspectionListener = (id:string)=>void;
const listeners = new Set<InspectionListener>();

export function subscribeAssistantTaskInspection(listener:InspectionListener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function requestAssistantTaskInspection(id:unknown):boolean {
  if (typeof id !== "string" || !id.trim() || id.length > 1024 || !listeners.size) return false;
  let delivered = false;
  for (const listener of listeners) {
    try { listener(id); delivered = true; } catch { /* No task data in logs. */ }
  }
  return delivered;
}
