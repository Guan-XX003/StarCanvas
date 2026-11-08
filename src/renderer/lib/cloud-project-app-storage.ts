// The root configures the same localforage object used by canvas autosave so
// cloud restores participate in the existing storage write barrier.
let canvasStorage: any = null;
export function configureCloudProjectStorage(storage: any) { canvasStorage = storage; }
export function getCloudProjectStorage() { return canvasStorage; }
