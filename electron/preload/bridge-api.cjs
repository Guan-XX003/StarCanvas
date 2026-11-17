// 渲染进程桥接 API：打开外部链接、原生输入弹窗、agent-browser 文档读取，以及 wanjuanDesktop / wanjuanProjectSafety 两个全局桥接对象的暴露（require 即触发）。
const { ipcRenderer, shell, path, execFileAsync } = require("./runtime.cjs");

// 以下两处 exposeGlobal 为顶层副作用：require 本模块时立即执行，且其暴露对象会在求值时即时引用下列跨模块函数
// （尤其 wanjuanProjectSafety 把函数作为对象值直接读取）。因此改用顶部 require 而非底部 late-require，
// 确保副作用执行时这些函数已就绪。
const { exposeGlobal } = require("./chrome-shim.cjs");
const {
  buildDesktopProxyFetchBridgePayload,
  invokeDesktopProxyFetchPayload,
} = require("./fetch-proxy.cjs");
const {
  arrayBufferFromBlobUrl,
  localPathFromFileUrl,
  localFileToDataUrl,
  uploadPayloadWithReadableBytes,
} = require("./media-utils.cjs");
const { getDesktopStorageItems, getPerformanceSettings, persistPerformanceProfile, resetEnterpriseStorageOverlay } = require("./storage.cjs");
const { showWanjuanInputDialog } = require("./input-dialog.cjs");
const { defaultCloudPromptStore } = require("./cloud-prompt-store.cjs");
const {
  beforeProjectCanvasSave,
  listProjectSafetySnapshots,
  getCurrentProjectSafetyInfo,
  getProjectSafetyConfig,
  setProjectSafetyConfig,
  restoreProjectSafetySnapshot,
  showProjectSafetyBlockedPrompt,
  removeProjectSafetyBlockedPrompt,
  maybeRunProjectSafetyAutoBackup,
} = require("./project-safety.cjs");

async function readDocumentWithAgentBrowser(url) {
  const session = `wanjuan_cfg_${Date.now()}`;
  const run = async (...args) => {
    const result = await execFileAsync(
      process.env.HOME
        ? path.join(process.env.HOME, ".npm-global/bin/agent-browser")
        : "agent-browser",
      ["--session", session, ...args],
      {
        timeout: 45000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          AGENT_BROWSER_MAX_OUTPUT: "120000",
        },
      }
    );
    return String(result.stdout || "").trim();
  };
  try {
    await run("open", String(url || ""));
    await run("wait", "--load", "networkidle");
    const bodyText = await run("get", "text", "body");
    if (!bodyText) throw new Error("agent-browser 未读取到正文内容");
    return { ok: true, text: bodyText };
  } catch (error) {
    return { ok: false, error: String(error?.message || error) };
  } finally {
    try {
      await run("close");
    } catch {}
  }
}

function isSafeExternalUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    return ["http:", "https:", "mailto:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

exposeGlobal("wanjuanDesktop", {
  customConfigProtect: async (config) => ipcRenderer.invoke('wanjuan:custom-config-protect', {config}),
  customConfigRestore: async (reference) => ipcRenderer.invoke('wanjuan:custom-config-restore', {reference}),
  applicationOperationList: () => ipcRenderer.invoke('wanjuan:application-operation-list'),
  applicationOperationApprove: (id,revision) => ipcRenderer.invoke('wanjuan:application-operation-approve',{id,revision}),
  applicationOperationReject: (id,revision) => ipcRenderer.invoke('wanjuan:application-operation-reject',{id,revision}),
  applicationOperationDismiss: (id) => ipcRenderer.invoke('wanjuan:application-operation-dismiss',{id}),
  applicationOperationConsume: (id,nonce) => ipcRenderer.invoke('wanjuan:application-operation-consume',{id,nonce}),
  applicationOperationSubmitInternal: (owner,request,selectionVersion) => ipcRenderer.invoke('wanjuan:application-operation-submit-internal',{owner,request,selectionVersion}),
  applicationOperationReadInternal: (owner,id) => ipcRenderer.invoke('wanjuan:application-operation-read-internal',{owner,id}),
  applicationOperationApproveInternal: (owner,id,revision) => ipcRenderer.invoke('wanjuan:application-operation-approve-internal',{owner,id,revision}),
  applicationOperationCancelInternal: (owner,id) => ipcRenderer.invoke('wanjuan:application-operation-cancel-internal',{owner,id}),
  onApplicationOperationsChanged: (callback) => {
    const listener=()=>callback();ipcRenderer.on('wanjuan:application-operations-changed',listener);
    return ()=>ipcRenderer.removeListener('wanjuan:application-operations-changed',listener);
  },
  assistantStatus: async () => ipcRenderer.invoke('wanjuan:assistant-status'),
  assistantWindowControl: command => ipcRenderer.invoke('wanjuan:assistant-window-control',command),
  onAssistantWindowClosed: callback => {
    const listener=()=>callback();ipcRenderer.on('wanjuan:assistant-window-closed',listener);
    return ()=>ipcRenderer.removeListener('wanjuan:assistant-window-closed',listener);
  },
  assistantAccountStart: async () => ipcRenderer.invoke('wanjuan:assistant-account-start'),
  assistantAccountStatus: async () => ipcRenderer.invoke('wanjuan:assistant-account-status'),
  assistantAccountCancel: async () => ipcRenderer.invoke('wanjuan:assistant-account-cancel'),
  assistantAccountClear: async () => ipcRenderer.invoke('wanjuan:assistant-account-clear'),
  assistantCheckConnection: async () => ipcRenderer.invoke('wanjuan:assistant-check-connection'),
  assistantSetKey: async (key) => ipcRenderer.invoke('wanjuan:assistant-set-key', {key}),
  assistantClearKey: async () => ipcRenderer.invoke('wanjuan:assistant-clear-key'),
  assistantSend: async (text, context) => ipcRenderer.invoke('wanjuan:assistant-send', {text, context}),
  assistantCancel: async () => ipcRenderer.invoke('wanjuan:assistant-cancel'),
  assistantReset: async () => ipcRenderer.invoke('wanjuan:assistant-reset'),
  assistantAnalyzeConfig: async (prompt) => ipcRenderer.invoke('wanjuan:assistant-analyze-config', {prompt}),
  assistantWorkspaceList: async () => ipcRenderer.invoke('wanjuan:assistant-workspace-list'),
  assistantWorkspaceCreateSession: async (input) => ipcRenderer.invoke('wanjuan:assistant-workspace-create-session', input),
  assistantWorkspaceReadSession: async (id) => ipcRenderer.invoke('wanjuan:assistant-workspace-read-session', {id}),
  assistantWorkspaceProgress: async (id, requestId, afterRevision) => ipcRenderer.invoke('wanjuan:assistant-workspace-progress', {id,requestId,afterRevision}),
  assistantWorkspacePatchSession: async (id, patch, revision) => ipcRenderer.invoke('wanjuan:assistant-workspace-patch-session', {id,patch,revision}),
  assistantWorkspaceChangeSession: async (id, patch, revision) => ipcRenderer.invoke('wanjuan:assistant-workspace-change-session', {id,patch,revision}),
  assistantWorkspaceSelectSession: async (id) => ipcRenderer.invoke('wanjuan:assistant-workspace-select-session', {id}),
  assistantWorkspaceCreateRole: async (configuration) => ipcRenderer.invoke('wanjuan:assistant-workspace-create-role', {configuration}),
  assistantWorkspaceReadRole: async (id) => ipcRenderer.invoke('wanjuan:assistant-workspace-read-role', {id}),
  assistantWorkspacePatchRole: async (id,configuration,revision) => ipcRenderer.invoke('wanjuan:assistant-workspace-patch-role', {id,configuration,revision}),
  assistantWorkspaceAddAttachment: async (id,attachment) => ipcRenderer.invoke('wanjuan:assistant-workspace-add-attachment', {id,attachment}),
  assistantWorkspaceReadTurnAttachments: async (id,turnId) => ipcRenderer.invoke('wanjuan:assistant-workspace-read-turn-attachments', {id,turnId}),
  assistantWorkspacePreviewAttachment: async (id,assetId) => ipcRenderer.invoke('wanjuan:assistant-workspace-preview-attachment', {id,assetId}),
  assistantWorkspaceExportBackup: async input => ipcRenderer.invoke('wanjuan:assistant-workspace-export-backup', input),
  assistantWorkspaceImportBackup: async input => ipcRenderer.invoke('wanjuan:assistant-workspace-import-backup', input),
  assistantWorkspaceImportLegacyRole: async (configuration,conversation) => ipcRenderer.invoke('wanjuan:assistant-workspace-import-legacy-role', {configuration,conversation}),
  assistantWorkspaceBeginCustomTurn: async (id,text) => ipcRenderer.invoke('wanjuan:assistant-workspace-begin-custom-turn', {id,text}),
  assistantWorkspaceCustomRunning: async (id,turnId) => ipcRenderer.invoke('wanjuan:assistant-workspace-custom-running', {id,turnId}),
  assistantWorkspaceCompleteCustomTurn: async (id,turnId,result) => ipcRenderer.invoke('wanjuan:assistant-workspace-complete-custom-turn', {id,turnId,text:result?.text,code:result?.code}),
  assistantWorkspaceSend: async (id, text, context, requestId) => ipcRenderer.invoke('wanjuan:assistant-workspace-send', {id,text,context,requestId}),
  assistantWorkspaceCancel: async (id) => ipcRenderer.invoke('wanjuan:assistant-workspace-cancel', {id}),
  checkForUpdates: async () => ipcRenderer.invoke("wanjuan:check-for-updates"),
  openExternal: async (url) => {
    try {
      if (!isSafeExternalUrl(url)) {
        return { ok: false, error: "Unsupported external URL scheme" };
      }
      await shell.openExternal(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  },
  captureWindowFrame: async () => ipcRenderer.invoke("wanjuan:capture-window-frame"),
  chooseProjectAssetFile: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:choose-project-asset-file", payload),
  chooseProjectAssetFolder: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:choose-project-asset-folder", payload),
  chooseBackupFile: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:choose-backup-file", payload),
  readKnowledgeFile: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:read-knowledge-file", payload),
  chooseDownloadDirectory: async (payload = {}) => ipcRenderer.invoke("wanjuan:choose-download-directory", payload),
  getDefaultDownloadDirectory: async () => ipcRenderer.invoke("wanjuan:get-default-download-directory"),
  getPerformanceSettings: async () => getPerformanceSettings(),
  setPerformanceProfile: async (key, settings = null) => {
    persistPerformanceProfile(key, settings);
    const next = getPerformanceSettings();
    try {
      await ipcRenderer.invoke("wanjuan:set-performance-settings", next);
    } catch {}
    return { ok: true, settings: next };
  },
  workspaceTeamStatus: async () => ipcRenderer.invoke("wanjuan:workspace-team-status"),
  workspaceTeamStart: async (payload = {}) => ipcRenderer.invoke("wanjuan:workspace-team-start", payload),
  workspaceTeamStop: async () => ipcRenderer.invoke("wanjuan:workspace-team-stop"),
  workspaceTeamUpdateTemplates: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:workspace-team-update-templates", payload),
  workspaceTeamFetchMember: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:workspace-team-fetch-member", payload),
  enterpriseTeamTemplates: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:enterprise-team-templates", payload),
  cloudPrompts: async (payload = {}) => ipcRenderer.invoke("wanjuan:cloud-prompts", payload),
  cloudProjects: async (payload = {}) => ipcRenderer.invoke("wanjuan:cloud-projects", payload),
  accountBootstrap: async () => {
    const result = await ipcRenderer.invoke("wanjuan:account-bootstrap");
    resetEnterpriseStorageOverlay();
    return result;
  },
  accountSendCode: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-send-code", payload),
  accountLogin: async (payload = {}) => {
    const result = await ipcRenderer.invoke("wanjuan:account-login", payload);
    resetEnterpriseStorageOverlay();
    if (result?.ok !== false) window.dispatchEvent(new CustomEvent("wanjuan:account-session-changed"));
    return result;
  },
  accountRefresh: async () => {
    const result = await ipcRenderer.invoke("wanjuan:account-refresh");
    resetEnterpriseStorageOverlay();
    return result;
  },
  accountMe: async () => ipcRenderer.invoke("wanjuan:account-me"),
  accountPasswordReset: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-password-reset", payload),
  accountRelay: async () => ipcRenderer.invoke("wanjuan:account-relay"),
  accountWallet: async () => ipcRenderer.invoke("wanjuan:account-wallet"),
  accountWalletTransactions: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-wallet-transactions", payload),
  accountRelayUsage: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-relay-usage", payload),
  accountRechargeStore: async () => ipcRenderer.invoke("wanjuan:account-recharge-store"),
  accountWalletRedeem: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-wallet-redeem", payload),
  accountRelayKeySendCode: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-relay-key-send-code", payload),
  accountRelayKeyReveal: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-relay-key-reveal", payload),
  accountRelayKeyRegenerate: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-relay-key-regenerate", payload),
  accountRelayLinkSendCode: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-relay-link-send-code", payload),
  accountRelayLinkVerifyLegacy: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-relay-link-verify-legacy", payload),
  accountRelayLinkVerifyMfa: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-relay-link-verify-mfa", payload),
  accountRelayLinkConfirm: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-relay-link-confirm", payload),
  accountContinueLocal: async () => {
    const result = await ipcRenderer.invoke("wanjuan:account-local-mode");
    window.dispatchEvent(new CustomEvent("wanjuan:account-session-changed"));
    return result;
  },
  accountLogout: async () => {
    const result = await ipcRenderer.invoke("wanjuan:account-logout");
    resetEnterpriseStorageOverlay();
    await defaultCloudPromptStore.clearAll().catch(() => {});
    window.dispatchEvent(new CustomEvent("wanjuan:account-session-changed"));
    return result;
  },
  accountConnectEnterprise: async (payload = {}) => {
    const result = await ipcRenderer.invoke("wanjuan:account-connect-enterprise", payload);
    resetEnterpriseStorageOverlay();
    return result;
  },
  accountCreateEnterpriseGateway: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-create-enterprise-gateway", payload),
  accountTakeoverEnterpriseGateway: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-takeover-enterprise-gateway", payload),
  accountReleaseEnterpriseGateway: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-release-enterprise-gateway", payload),
  accountPublishEnterpriseConfig: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-publish-enterprise-config", payload),
  accountRefreshEnterpriseConfig: async () => {
    const result = await ipcRenderer.invoke("wanjuan:account-refresh-enterprise-config");
    resetEnterpriseStorageOverlay();
    return result;
  },
  accountEnterpriseManagement: async () => ipcRenderer.invoke("wanjuan:account-enterprise-management"),
  accountEnterpriseMemberUpdate: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-enterprise-member-update", payload),
  accountEnterpriseMemberRemove: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-enterprise-member-remove", payload),
  accountEnterpriseQuotaDefaultUpdate: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-enterprise-quota-default-update", payload),
  accountEnterpriseQuotaMemberUpdate: async (payload = {}) => ipcRenderer.invoke("wanjuan:account-enterprise-quota-member-update", payload),
  accountDisconnectEnterprise: async () => {
    const result = await ipcRenderer.invoke("wanjuan:account-disconnect-enterprise");
    resetEnterpriseStorageOverlay();
    return result;
  },
  enterpriseGatewayStart: async () => ipcRenderer.invoke("wanjuan:enterprise-gateway-start"),
  enterpriseGatewayStop: async () => ipcRenderer.invoke("wanjuan:enterprise-gateway-stop"),
  accountResetOnboarding: async () => ipcRenderer.invoke("wanjuan:account-reset-onboarding"),
  removeLocalUserData: async (payload = {}) => ipcRenderer.invoke("wanjuan:remove-local-user-data", payload),
  showInputDialog: async (options = {}) => showWanjuanInputDialog(options),
	  saveDownload: async (payload = {}) => {
	    let nextPayload = { ...payload };
	    if (!nextPayload.directory) {
	      try {
	        const store = await getDesktopStorageItems(["downloadDirectory"]);
	        if (store?.downloadDirectory) nextPayload.directory = store.downloadDirectory;
	      } catch {}
	    }
	    if (typeof nextPayload.url === "string" && /^file:\/\//i.test(nextPayload.url)) {
	      try {
	        nextPayload = {
	          ...nextPayload,
	          localPath: localPathFromFileUrl(nextPayload.url) || nextPayload.localPath || "",
	          url: ""
	        };
	      } catch {}
	    }
	    if (typeof nextPayload.url === "string" && nextPayload.url.startsWith("blob:")) {
      const converted = await arrayBufferFromBlobUrl(nextPayload.url);
      nextPayload = {
        ...nextPayload,
        url: "",
        arrayBuffer: converted.arrayBuffer,
        mime: nextPayload.mime || converted.mime,
        size: nextPayload.size || converted.size
      };
    }
    return ipcRenderer.invoke("wanjuan:save-download", nextPayload);
  },
	  persistProjectAsset: async (payload = {}) => {
	    let nextPayload = { ...payload };
	    if (nextPayload.storageOptimizationEnabled === undefined) {
	      try {
	        const store = await getDesktopStorageItems(["storageOptimizationEnabled"]);
	        nextPayload.storageOptimizationEnabled = store?.storageOptimizationEnabled === true;
	      } catch {}
	    }
	    if (typeof nextPayload.url === "string" && /^file:\/\//i.test(nextPayload.url)) {
	      try {
	        nextPayload = {
	          ...nextPayload,
	          localPath: localPathFromFileUrl(nextPayload.url) || nextPayload.localPath || "",
	          url: ""
	        };
	      } catch {}
	    }
	    if (typeof nextPayload.url === "string" && nextPayload.url.startsWith("blob:")) {
      const converted = await arrayBufferFromBlobUrl(nextPayload.url);
      nextPayload = {
        ...nextPayload,
        url: "",
        arrayBuffer: converted.arrayBuffer,
        mime: nextPayload.mime || converted.mime,
        size: nextPayload.size || converted.size
      };
    }
    return ipcRenderer.invoke("wanjuan:persist-project-asset", nextPayload);
  },
  checkProjectAssets: async (paths = []) =>
    ipcRenderer.invoke("wanjuan:check-project-assets", { paths }),
  diagnoseProjectAssets: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:diagnose-project-assets", payload),
  beginProjectMigration: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:begin-project-migration", payload),
  getProjectMigration: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:get-project-migration", payload),
  listIncompleteMigrations: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:list-incomplete-migrations", payload),
  saveProjectMigrationSnapshot: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:save-project-migration-snapshot", payload),
  loadProjectMigrationSnapshot: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:load-project-migration-snapshot", payload),
  cancelProjectMigration: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:cancel-project-migration", payload),
  commitProjectMigration: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:commit-project-migration", payload),
  rollbackProjectMigration: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:rollback-project-migration", payload),
  cleanupUnreferencedBlobs: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:cleanup-unreferenced-blobs", payload),
  syncProjectReferences: async (payload = {}) => {
    try {
      const store = await getDesktopStorageItems(["storageOptimizationEnabled"]);
      if (store?.storageOptimizationEnabled !== true) return { ok: true, skipped: true, reason: "STORAGE_OPTIMIZATION_DISABLED" };
    } catch {}
    return ipcRenderer.invoke("wanjuan:sync-project-references", payload);
  },
  isProjectMigrationLocked: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:is-project-migration-locked", typeof payload === "string" ? { projectId: payload } : payload),
  getStorageOptimizationStatus: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:storage-optimization-status", payload),
  rebuildStorageReferenceIndex: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:rebuild-storage-reference-index", payload),
  scanStorageReclaimable: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:scan-storage-reclaimable", payload),
  moveUnreferencedMediaToTrash: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:move-unreferenced-media-to-trash", payload),
  listStorageTrash: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:list-storage-trash", payload),
  restoreStorageTrash: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:restore-storage-trash", payload),
  purgeStorageTrash: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:purge-storage-trash", payload),
  findProjectAssetsInFolder: async (payload = {}) =>
    ipcRenderer.invoke("wanjuan:find-project-assets-in-folder", payload),
	  removeProjectAssets: async (payload = {}) =>
	    ipcRenderer.invoke("wanjuan:remove-project-assets", payload),
	  readLocalFileAsDataUrl: async (payload = {}) => {
	    try {
	      return await localFileToDataUrl(payload?.url || payload?.localPath || payload?.path || "");
	    } catch (error) {
	      return { ok: false, error: String(error?.message || error) };
	    }
	  },
	  proxyFetchStream: async(payload={},onFrame)=>{
      if(typeof onFrame!=='function')return {ok:false,error:'Streaming receiver unavailable'};
      const request=require('./fetch-proxy.cjs').buildDesktopProxyFetchBridgePayload(payload);
      const listener=(_event,part)=>{if(part?.requestId!==request.requestId)return;try{onFrame(part);}catch{ipcRenderer.send('wanjuan:abort-fetch',request.requestId);}};
      ipcRenderer.on('wanjuan:proxy-fetch-stream',listener);
      try{return await ipcRenderer.invoke('wanjuan:proxy-fetch',{...request,streamResponse:true});}
      finally{ipcRenderer.removeListener('wanjuan:proxy-fetch-stream',listener);}
    },
	  proxyFetch: async (payload = {}) => {
    const nextPayload = buildDesktopProxyFetchBridgePayload(payload);
    // 透传 AbortSignal，取消时通过 wanjuan:abort-fetch 中断主进程请求（见 fetch-proxy.cjs）。
    return invokeDesktopProxyFetchPayload(nextPayload, payload?.signal || null);
  },
  abortProxyFetch: async (requestId) => {
    ipcRenderer.send("wanjuan:abort-fetch", String(requestId || ""));
    return { ok: true };
  },
			  uploadPublicMedia: async (payload = {}) => {
			    const nextPayload = await uploadPayloadWithReadableBytes(payload);
		    return ipcRenderer.invoke("wanjuan:upload-public-media", nextPayload);
		  },
			  uploadTosMedia: async (payload = {}) => {
			    const nextPayload = await uploadPayloadWithReadableBytes(payload);
		    return ipcRenderer.invoke("wanjuan:upload-tos-media", nextPayload);
		  },
			  registerArkTrustedAsset: async (payload = {}) => {
			    const nextPayload = await uploadPayloadWithReadableBytes(payload);
		    return ipcRenderer.invoke("wanjuan:ark-trusted-asset-register", nextPayload);
		  },
			  ensureArkTrustedAssetGroup: async (payload = {}) =>
		    ipcRenderer.invoke("wanjuan:ark-trusted-asset-ensure-group", payload),
			  cancelArkTrustedAssetReview: async (requestId) =>
		    ipcRenderer.invoke("wanjuan:ark-trusted-asset-cancel", String(requestId || "")),
			  clearArkTrustedAssetCache: async () =>
		    ipcRenderer.invoke("wanjuan:ark-trusted-asset-clear-cache"),
			  uploadQiniuMedia: async (payload = {}) => {
			    const nextPayload = await uploadPayloadWithReadableBytes(payload);
			    return ipcRenderer.invoke("wanjuan:upload-qiniu-media", nextPayload);
			  },
			  uploadCustomPublicMedia: async (payload = {}) => {
			    const nextPayload = await uploadPayloadWithReadableBytes(payload);
			    return ipcRenderer.invoke("wanjuan:upload-custom-public-media", nextPayload);
			  },
			  blurVideoFaces: async (payload = {}) => {
			    const nextPayload = await uploadPayloadWithReadableBytes(payload);
			    return ipcRenderer.invoke("wanjuan:blur-video-faces", nextPayload);
			  },
			  trimVideoSegment: async (payload = {}) => {
			    const nextPayload = await uploadPayloadWithReadableBytes(payload);
			    return ipcRenderer.invoke("wanjuan:trim-video-segment", nextPayload);
			  },
			  cloneVoiceWithQwenTts: async (payload = {}) => {
			    const nextPayload = await uploadPayloadWithReadableBytes(payload);
			    return ipcRenderer.invoke("wanjuan:qwen-tts-clone-voice", nextPayload);
			  },
			  upscaleVideoWithRealEsrgan: async (payload = {}) => {
			    const nextPayload = await uploadPayloadWithReadableBytes(payload);
			    return ipcRenderer.invoke("wanjuan:real-esrgan-upscale-video", nextPayload);
			  },
			  onRealEsrganProgress: (jobId, callback) => {
			    const channel = `wanjuan:real-esrgan-progress:${String(jobId || "")}`;
			    const listener = (_event, progress) => callback?.(progress || {});
			    ipcRenderer.on(channel, listener);
			    return () => ipcRenderer.removeListener(channel, listener);
			  },
			  setRealEsrganPaused: async (payload = {}) =>
			    ipcRenderer.invoke("wanjuan:real-esrgan-set-paused", payload),
			  getRealEsrganJobStatus: async (payload = {}) =>
			    ipcRenderer.invoke("wanjuan:real-esrgan-job-status", payload),
			  getExtensionToolStatus: async (payload = {}) =>
			    ipcRenderer.invoke("wanjuan:get-extension-tool-status", payload),
				  installExtensionTool: async (payload = {}) =>
				    ipcRenderer.invoke("wanjuan:install-extension-tool", payload),
				  importExtensionToolPack: async (payload = {}) =>
				    ipcRenderer.invoke("wanjuan:import-extension-tool-pack", payload),
  readDocumentWithBrowser: async (url) => readDocumentWithAgentBrowser(url)
			});

exposeGlobal("wanjuanProjectSafety", {
  beforeCanvasSave: beforeProjectCanvasSave,
  listSnapshots: listProjectSafetySnapshots,
  getCurrentInfo: getCurrentProjectSafetyInfo,
  getConfig: getProjectSafetyConfig,
  setConfig: setProjectSafetyConfig,
  restoreSnapshot: restoreProjectSafetySnapshot,
  showBlockedSavePrompt: showProjectSafetyBlockedPrompt,
  closeBlockedSavePrompt: removeProjectSafetyBlockedPrompt,
  runAutoBackup: maybeRunProjectSafetyAutoBackup
});
module.exports = {
  readDocumentWithAgentBrowser,
  isSafeExternalUrl,
  showWanjuanInputDialog,
};
