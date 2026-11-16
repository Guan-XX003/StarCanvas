// Narrow, trusted-renderer-only bridge for the encrypted config store.
// The caller receives plaintext only when explicitly restoring a reference.
function registerCustomNodeConfigIpc({ipcMain,rejectUntrustedIpc,getService}) {
  if (!ipcMain?.handle || typeof rejectUntrustedIpc !== 'function' || typeof getService !== 'function') throw new Error('CONFIG_IPC_INVALID');
  for (const [channel,key,operation] of [
    ['wanjuan:custom-config-protect','config','protect'],
    ['wanjuan:custom-config-restore','reference','restore'],
  ]) {
    ipcMain.handle(channel,async (event,payload) => {
      const blocked=rejectUntrustedIpc(event,channel);
      if (blocked) return blocked;
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 1 || !Object.hasOwn(payload,key)) return {ok:false,code:'CONFIG_VAULT_INVALID_REQUEST'};
      try { return await getService()[operation](payload[key]); }
      catch { return {ok:false,code:'CONFIG_VAULT_UNAVAILABLE'}; }
    });
  }
}
module.exports={registerCustomNodeConfigIpc};
