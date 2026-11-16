// Main-process assistant service. A pinned bundled runtime is preferred;
// the independently installed signed macOS app is a development fallback.
const fs = require('node:fs/promises');
const {createReadStream} = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {app, net, shell} = require('./electron-refs.cjs');
const {createSystemAssistantCredentialVault} = require('./assistant-credential-vault.cjs');
const {createSystemAssistantAccountVault} = require('./assistant-account-vault.cjs');
const {createAssistantAccountBroker} = require('./assistant-account-broker.cjs');
const {createAssistantTurnProgress,validateProgressRequest} = require('./assistant-turn-progress.cjs');
const {createAssistantAccountPkce} = require('./assistant-account-pkce.cjs');
const {createAssistantAccountPost} = require('./assistant-account-transport.cjs');
const {createAssistantAccountDevice} = require('./assistant-account-device.cjs');
const {createHarnessClient} = require('./assistant-harness-client.cjs');
const {closeAssistantResources} = require('./assistant-runtime-close.cjs');
const {createAssistantConnectionProbe} = require('./assistant-connection-probe.cjs');
const {buildAssistantChatPrompt, buildAssistantAnalysisPrompt} = require('./assistant-context.cjs');
const {checkDump} = require('./assistant-harness-policy.cjs');
const runtimeSpecs = require('./assistant-runtime-specs.cjs');
const {createAssistantSessionPool} = require('./assistant-session-pool.cjs');
const {createAssistantWorkspace, buildSessionPrompt, DEFAULT_ROLE} = require('./assistant-workspace.cjs');
const {createSystemAssistantWorkspaceVault} = require('./assistant-workspace-vault.cjs');
const {isolatedCandidatePaths,candidateQaModelBaseURL}=require('../shared/isolated-candidate-qa.cjs');

const execute = promisify(execFile);
const APP = '/Applications/DeepSeek Harness.app';
const LAUNCHER = `${APP}/Contents/Resources/runtime/cli/bin/dsh`;
const PATCH_HASH = 'b9659dfd07900cb35ac64a924bffa443e9ca961a4ec72e1bd3d2e817d4e3401f';
let vault, accountVault, accountAuth, queue = Promise.resolve(), shuttingDown = false, accountMutation = false, cancelGeneration = 0, taskPending = false, taskPendingSlot = null;
const chatRuntime = {client:null, home:null, broker:null};
const analysisRuntime = {client:null, home:null, broker:null};
const workspaceRuntimes = new Set();
let workspaceRepository, workspaceReady;
let workspaceCredentialMutation = 0;
const turnProgress = createAssistantTurnProgress();
const sessions = createAssistantSessionPool({
  open: async (slot, id, signal) => {
    workspaceRuntimes.add(slot); slot.opening = true;
    try {await startRuntime(slot,{signal});} finally {
      slot.opening = false;
      if (!slot.client && !slot.home && !slot.broker && !slot.closeFailed && !slot.closing) workspaceRuntimes.delete(slot);
    }
  },
  close: async slot => {if (slot) {await closeRuntime(slot); if (!slot.opening) workspaceRuntimes.delete(slot);}},
});
async function workspace() {
  workspaceRepository ||= createAssistantWorkspace({vault:createSystemAssistantWorkspaceVault()});
  // One recovery pass per process, before any new workspace task may start.
  if (!workspaceReady) workspaceReady = workspaceRepository.recoverInterrupted().catch(error => {workspaceReady = null; throw error;});
  await workspaceReady;
  return workspaceRepository;
}
async function changeCredentials(action) {
  workspaceCredentialMutation++;
  try {await closeAllRuntimes(); return await action();}
  finally {workspaceCredentialMutation--;}
}
function fail(code) { const e = new Error(code); e.code = code; return e; }
function ordered(fn) { const result = queue.then(fn); queue = result.catch(() => {}); return result; }
function runTask(work, {isolated = false} = {}) {
  if (taskPending) return Promise.reject(fail('ASSISTANT_BUSY'));
  taskPending = true;
  const generation = cancelGeneration;
  const slot = isolated ? analysisRuntime : chatRuntime;
  taskPendingSlot = slot;
  return ordered(async () => {
    try {
      if (generation !== cancelGeneration) throw fail('ASSISTANT_CANCELLED');
      const runtime = await startRuntime(slot);
      const result = await work(runtime);
      if (generation !== cancelGeneration) throw fail('ASSISTANT_CANCELLED');
      return result;
    } catch (error) {
      // A previous unsuccessful close is quarantined until an explicit reset
      // successfully rechecks it. A new request must not silently retry it.
      if (error?.code === 'ASSISTANT_RUNTIME_STOP_UNCONFIRMED') throw error;
      await closeRuntime(slot);
      if (generation !== cancelGeneration) throw fail('ASSISTANT_CANCELLED');
      throw error;
    } finally {
      // Documentation can contain unrelated private information. Its isolated
      // process and temporary session are discarded after every analysis.
      if (isolated) await closeRuntime(slot);
    }
  }).finally(() => { taskPending = false; taskPendingSlot = null; });
}
function store() { return vault ??= createSystemAssistantCredentialVault(); }
function accountStore() { return accountVault ??= createSystemAssistantAccountVault(); }
function auth() {
  if (accountAuth) return accountAuth;
  const device = createAssistantAccountDevice(app.getPath('userData'));
  const post = createAssistantAccountPost(net,{version:'0.2.1-rc.2',language:app.getLocale(),platformName:process.platform,timezoneOffsetSeconds:-new Date().getTimezoneOffset()*60});
  accountAuth = createAssistantAccountPkce({post,openExternal:url => shell.openExternal(url),getDeviceId:device.getDeviceId,
    saveGrant:grant => ordered(async () => {
      if (shuttingDown) throw fail('ASSISTANT_RUNTIME_CLOSED');
      await changeCredentials(async () => {
        if (shuttingDown) throw fail('ASSISTANT_RUNTIME_CLOSED');
        await accountStore().saveGrant(grant);
      });
    })});
  return accountAuth;
}
function bundledRuntime() {
  const target = `${process.platform}-${process.arch}`, spec = runtimeSpecs[target];
  if (!spec) return null;
  const parent = app.isPackaged ? path.join(process.resourcesPath, 'assistant-harness') : path.join(app.getAppPath(), 'tool-runtime', 'deepseek-harness');
  const root = path.join(parent, target, 'deepseek_harness_runtime', 'runtime');
  return {root, spec, launcher:path.join(root, spec.binary)};
}
function cleanEnvironment(home) {
  const env = {HOME:home, USERPROFILE:home, DSH_HOME:home, TMP:home, TEMP:home, TMPDIR:home};
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.SYSTEMROOT;
    if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw fail('ASSISTANT_RUNTIME_UNVERIFIED');
    env.SystemRoot = systemRoot; env.PATH = path.win32.join(systemRoot, 'System32');
  } else env.PATH = '/usr/bin:/bin';
  return env;
}
async function fileDigest(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw fail('ASSISTANT_RUNTIME_UNVERIFIED');
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function runtimeInstalled() {
  const bundled = bundledRuntime();
  if (bundled) { try { await fs.access(bundled.launcher); return true; } catch {} }
  if (app.isPackaged) return false;
  if (process.platform !== 'darwin') return false;
  try { await fs.access(LAUNCHER); return true; } catch { return false; }
}
async function verifiedRuntime(home) {
  if (!await runtimeInstalled()) throw fail('ASSISTANT_RUNTIME_NOT_INSTALLED');
  try {
    const bundled = bundledRuntime();
    let launcher, version, profile;
    if (bundled && await fs.access(bundled.launcher).then(() => true, () => false)) {
      for (const [name, expected] of Object.entries(bundled.spec.files)) {
        if (await fileDigest(path.join(bundled.root, name)) !== expected) throw Error();
      }
      launcher = bundled.launcher; version = bundled.spec.version; profile = 'bundled';
    } else {
      if (app.isPackaged || process.platform !== 'darwin') throw Error();
      await execute('/usr/bin/codesign', ['--verify','--deep','--strict','--test-requirement', '=anchor apple generic and identifier "com.deepseek.dsh" and certificate leaf[subject.OU] = "NAN929V4UM"', APP], {timeout:30000,maxBuffer:16384});
      launcher = LAUNCHER; version = '0.2.2-rc.1'; profile = 'installed';
    }
    const {stdout} = await execute(launcher, ['--version'], {cwd:home, env:cleanEnvironment(home),timeout:15000,maxBuffer:4096});
    if (stdout.trim() !== version) throw Error();
    return {launcher, profile};
  } catch { throw fail('ASSISTANT_RUNTIME_UNVERIFIED'); }
}
function closeRuntime(slot) {
  if (slot.closing) return slot.closing;
  slot.generation = (slot.generation || 0) + 1;
  slot.streamListener = null;
  const current = slot.client, home = slot.home, broker = slot.broker;
  const closing = (async () => {
    try {
      await closeAssistantResources({broker,client:current});
      // Do not remove a live runtime's home when its exit is unconfirmed.
      if (home && path.dirname(home) === os.tmpdir() && path.basename(home).startsWith('starcanvas-assistant-')) await fs.rm(home, {recursive:true,force:true});
      if (slot.client === current) slot.client = null;
      if (slot.home === home) slot.home = null;
      if (slot.broker === broker) slot.broker = null;
      slot.closeFailed = false;
    } catch {
      slot.closeFailed = true;
      throw fail('ASSISTANT_RUNTIME_STOP_UNCONFIRMED');
    }
  })();
  slot.closing = closing;
  return closing.finally(() => {if (slot.closing === closing) slot.closing = null;});
}
async function closeAllRuntimes() {
  await Promise.all([closeRuntime(chatRuntime), closeRuntime(analysisRuntime), sessions.closeAll()]);
}
async function startRuntime(slot, {signal} = {}) {
  if (shuttingDown) throw fail('ASSISTANT_RUNTIME_CLOSED');
  // Neither session may start while any prior runtime has an unconfirmed exit.
  if (chatRuntime.closing || chatRuntime.closeFailed || analysisRuntime.closing || analysisRuntime.closeFailed || [...workspaceRuntimes].some(item => item.closeFailed)) throw fail('ASSISTANT_RUNTIME_STOP_UNCONFIRMED');
  if (slot.client) return slot.client;
  const generation = cancelGeneration;
  const slotGeneration = slot.generation || 0;
  const checkCancelled = () => { if (signal?.aborted || (signal && workspaceCredentialMutation) || (!signal && generation !== cancelGeneration) || slotGeneration !== (slot.generation || 0)) throw fail('ASSISTANT_CANCELLED'); };
  checkCancelled();
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'starcanvas-assistant-'));
  slot.home = home;
  try {
    const {launcher, profile} = await verifiedRuntime(home);
    checkCancelled();
    if (shuttingDown) throw fail('ASSISTANT_RUNTIME_CLOSED');
    const source = path.join(app.getAppPath(), 'config/harness/sdk-restricted.patch.yml');
    const patchBytes = await fs.readFile(source);
    checkCancelled();
    if (crypto.createHash('sha256').update(patchBytes).digest('hex') !== PATCH_HASH) throw fail('ASSISTANT_RUNTIME_UNVERIFIED');
    const patch = path.join(home, 'restricted.patch.yml');
    await fs.writeFile(patch, patchBytes, {mode:0o600,flag:'wx'});
    checkCancelled();
    if (shuttingDown) throw fail('ASSISTANT_RUNTIME_CLOSED');
    // Composition is inspected without credentials, before launching an agent.
    // The pinned Windows x64 and reviewed macOS configurations use this
    // allowlist. This remains a composition check, not an OS sandbox.
    if (process.platform === 'darwin' || (process.platform === 'win32' && process.arch === 'x64')) {
      try {
        const {stdout} = await execute(launcher, ['--profile','sdk-minimal','--patch',patch,'--dump-config'], {cwd:home,env:cleanEnvironment(home),timeout:15000,maxBuffer:250000});
        if (!checkDump(stdout,profile).ok) throw Error();
      } catch { throw fail('ASSISTANT_RUNTIME_UNVERIFIED'); }
      checkCancelled();
      if (shuttingDown) throw fail('ASSISTANT_RUNTIME_CLOSED');
    }
    const storedKey = await store().getForMainProcess();
    checkCancelled();
    if (shuttingDown) throw fail('ASSISTANT_RUNTIME_CLOSED');
    if (!storedKey) {
      if (!await accountStore().hasRecord()) throw fail('ASSISTANT_KEY_REQUIRED');
      checkCancelled();
      if (shuttingDown) throw fail('ASSISTANT_RUNTIME_CLOSED');
    }
    // Production has no configurable inference target. Only the explicit,
    // isolated candidate fence maps that one pinned URL to its owned mock.
    let inferenceNet = net;
    if (isolatedCandidatePaths()) {
      const mock = candidateQaModelBaseURL();
      inferenceNet = {request(options) {
        if (options.url !== 'https://api.deepseek.com/anthropic/v1/messages') throw fail('ASSISTANT_QA_TARGET_INVALID');
        return net.request({...options,url:mock+'/v1/messages'});
      }};
    }
    const broker = createAssistantAccountBroker({net:inferenceNet,
      ...(storedKey ? {getKey:() => store().getForMainProcess()} : {getGrant:() => accountStore().getForMainProcess()}),
      onText:text => {if (!shuttingDown && slotGeneration === (slot.generation || 0)) slot.streamListener?.(text);},
    });
    slot.broker = broker;
    const {clientKey:key,baseURL:accountBaseURL} = await broker.start();
    checkCancelled();
    if (shuttingDown) throw fail('ASSISTANT_RUNTIME_CLOSED');
    const systemPrompt = 'You are the StarCanvas in-app assistant. Answer in the user language. Help users understand StarCanvas, model/API configuration, and errors. Be honest when you do not know a detail. You may receive a coarse current-page hint, but cannot inspect project contents, change settings, read files, run generation, or call tools; never claim to have done so. Give concrete safe guidance. When relevant, you may propose exactly one user-click action by adding one final line with an allowlisted marker: [[STARCANVAS_ACTION:open_api_settings]], [[STARCANVAS_ACTION:open_model_settings]], [[STARCANVAS_ACTION:open_agents]], [[STARCANVAS_ACTION:open_resources]], [[STARCANVAS_ACTION:open_canvas]], [[STARCANVAS_ACTION:open_workspace]], [[STARCANVAS_ACTION:open_account_settings]], [[STARCANVAS_ACTION:open_appearance_settings]], [[STARCANVAS_ACTION:create_text_node]], [[STARCANVAS_ACTION:create_image_node]], or [[STARCANVAS_ACTION:create_video_node]]. To propose a node with draft content instead, add exactly one final line such as [[STARCANVAS_NODE:{"type":"image","content":"A sunrise over the sea"}]], using valid single-line JSON with only type (text, image, or video) and content (at most 4000 characters). The user can edit the draft and must click to create one node in the original project; nothing is generated or configured automatically. Explain this and never imply it has happened already. Never add an action or node marker to a request asking for JSON only.';
    slot.client = createHarnessClient({launcher, patch, home, env:{...cleanEnvironment(home), DEEPSEEK_API_KEY:key, ...(accountBaseURL ? {DEEPSEEK_BASE_URL:accountBaseURL} : {}), DSH_SYSTEM_PROMPT:systemPrompt + ' The app also handles a small set of exact user-typed theme, language, automatic generated-result download, task summary, and navigation commands locally, without sending those commands to you. You cannot run or verify them, and do not see their results. For unclear navigation requests you may propose exactly one confirmation button with [[STARCANVAS_ACTION:open_settings]] or [[STARCANVAS_ACTION:open_generation_settings]] or one of the navigation actions above, never claim it has already opened. If a user clearly requests a preference change, you may instead propose ONE confirmation button, never claim the change happened: end your answer with one final line [[STARCANVAS_PREFERENCE:{"kind":"theme","value":"graphite"}]], [[STARCANVAS_PREFERENCE:{"kind":"language","value":"en-US"}]], or [[STARCANVAS_PREFERENCE:{"kind":"autoDownload","value":true}]]. The autoDownload value must be a JSON boolean and only controls automatic saving of generated results; it does not start generation. Theme values are graphite, dark (Obsidian), light (Sky blue), warm-light, chrome-rose, sage-green, system; language values are zh-CN, zh-TW, en-US. If the user explicitly asks to make the theme darker or lighter, you may suggest dark or light respectively as one option, clearly requiring confirmation; this is not a claim about the current theme. Do not propose a change when the user is asking a hypothetical question, negating it, or has not clearly chosen a value or a darker/lighter direction. For questions about current settings or tasks, explain that you cannot see their current values; suggest asking the app to show the current setting or task status.'}});
    return slot.client;
  } catch (error) {
    await closeRuntime(slot);
    throw error;
  }
}

module.exports = {
  workspaceList: async () => ({...await (await workspace()).list(),runtime:sessions.status()}),
  workspaceCreateSession: async input => (await workspace()).createSession(input),
  workspaceReadSession: async id => (await workspace()).readSession(id),
  workspaceProgress: (id,requestId,afterRevision) => turnProgress.read(id,requestId,afterRevision),
  workspacePatchSession: async (id, patch, revision) => (await workspace()).patchSession(id,patch,revision),
  workspaceChangeSession: async (id, patch, revision) => (await workspace()).changeSession(id,patch,revision),
  workspaceSelectSession: async id => (await workspace()).selectSession(id),
  workspaceCreateRole: async configuration => (await workspace()).createRole(configuration),
  workspaceReadRole: async id => (await workspace()).readRole(id),
  workspacePatchRole: async (id,configuration,revision) => (await workspace()).patchRole(id,configuration,revision),
  workspaceAddAttachment: async (id,input) => (await workspace()).addAttachment(id,input),
  workspaceReadTurnAttachments: async (id,turnId) => (await workspace()).readTurnAttachments(id,turnId),
  workspacePreviewAttachment: async (id,assetId) => (await workspace()).previewAttachment(id,assetId),
  workspaceExportBackup: async input => (await workspace()).exportBackup(input),
  workspaceImportBackup: async input => (await workspace()).importBackup(input),
  workspaceImportLegacyRole: async input => (await workspace()).importLegacyRole(input),
  workspaceBeginCustomTurn: async (id,text) => {
    buildAssistantChatPrompt(text);
    if(shuttingDown)throw fail('ASSISTANT_RUNTIME_CLOSED');
    return (await workspace()).beginCustomTurn(id,text);
  },
  workspaceCustomRunning: async (id,turnId) => (await workspace()).markCustomRunning(id,turnId),
  workspaceCompleteCustomTurn: async (id,turnId,result) => (await workspace()).finishCustomTurn(id,turnId,result),
  workspaceSend: async (id, text, context, requestId) => {
    // Ordinary chat retains its coarse-only context contract. Explicit canvas
    // planning uses a separate shared allowlist, with no renderer execution
    // authority or full private project/config object accepted by the model.
    buildAssistantChatPrompt(text);
    if (requestId !== undefined) validateProgressRequest(id,requestId);
    const currentPrompt = context&&Object.hasOwn(context,'canvasPlan')
      ? (await import('../shared/canvas-planning-protocol.mjs')).buildCanvasPlanningPrompt(text,context.canvasPlan,require('./assistant-context.cjs').containsLikelyAssistantSecret)
      : buildAssistantChatPrompt(text,context);
    if (shuttingDown) throw fail('ASSISTANT_RUNTIME_CLOSED');
    if (workspaceCredentialMutation) throw fail('ASSISTANT_BUSY');
    const repository = await workspace();
    const prior = await repository.readSession(id);
    // Custom-model roles remain on their working existing engine until its
    // migration is wired; never silently send those conversations to DeepSeek.
    if (prior.value.roleId !== DEFAULT_ROLE) throw fail('ASSISTANT_ENGINE_NOT_READY');
    if (prior.value.attachments.length) throw fail('ASSISTANT_ATTACHMENT_UNSUPPORTED');
    const prepared = await repository.beginTurn(id,text), turnId = prepared.value.task.id;
    let progress;
    try {
      if (requestId !== undefined && !context?.canvasPlan) progress = turnProgress.begin(id,requestId,turnId);
      if (shuttingDown) throw fail('ASSISTANT_RUNTIME_CLOSED');
      if (workspaceCredentialMutation) throw fail('ASSISTANT_CANCELLED');
      const result = await sessions.run(id,async (slot,{signal}) => {
        await repository.markRunning(id,turnId);
        if (signal.aborted) throw fail('ASSISTANT_CANCELLED');
        const {prompt,contextTruncated} = buildSessionPrompt(prepared.value,currentPrompt);
        // Every turn gets a new native session; only this encrypted session's
        // completed transcript is replayed, including after eviction/restart.
        const listener = text => {if (!signal.aborted && slot.streamListener === listener) progress?.text(text);};
        slot.streamListener = listener;
        try {
          const reply = await slot.client.sendMessage(prompt,{independent:true});
          if (signal.aborted) throw fail('ASSISTANT_CANCELLED');
          return {text:reply,contextTruncated};
        } finally {if (slot.streamListener === listener) slot.streamListener = null;}
      });
      return await repository.finishTurn(id,turnId,result);
    } catch (error) {
      try {await repository.finishTurn(id,turnId,{code:error?.code});} catch (saveError) {
        if (saveError?.code !== 'ASSISTANT_CANCELLED') throw saveError;
      }
      throw error;
    } finally {progress?.close();}
  },
  workspaceCancel: async id => {
    const repository = await workspace(), record = await repository.readSession(id);
    if (['queued','running'].includes(record.value.task.status)) await repository.finishTurn(id,record.value.task.id,{code:'ASSISTANT_CANCELLED'});
    await sessions.reset(id);
    return repository.readSession(id);
  },
  status: () => ordered(async () => {
    const key = await store().hasCredential();
    let account;
    try { account = await accountStore().hasRecord(); }
    catch (error) { if (!key) throw error; account = null; }
    return {installed:await runtimeInstalled(), configured:key || !!account, authMode:key ? 'key' : account ? 'account' : null, hasKey:key, hasAccount:account, accountPhase:accountAuth?.status().phase || 'idle', platform:process.platform};
  }),
  startAccountAuth: () => {
    if (shuttingDown) return Promise.reject(fail('ASSISTANT_RUNTIME_CLOSED'));
    if (accountMutation) return Promise.reject(fail('ASSISTANT_BUSY'));
    return auth().start({language:app.getLocale()});
  },
  // This status is deliberately independent of the model/storage queue:
  // an in-progress Keychain write must not hide the committing phase.
  accountStatus: () => accountAuth ? accountAuth.status() : {phase:'idle'},
  cancelAccountAuth: () => accountAuth ? accountAuth.cancel() : Promise.resolve({phase:'idle'}),
  clearAccount: async () => {
    if (accountMutation) throw fail('ASSISTANT_BUSY');
    accountMutation = true;
    try {
      const state = accountAuth && await accountAuth.cancel();
      if (state?.phase === 'committing') throw fail('ASSISTANT_BUSY');
      return await ordered(() => changeCredentials(() => accountStore().clear()));
    } finally { accountMutation = false; }
  },
  checkConnection: () => ordered(async () => {
    const key = await store().getForMainProcess();
    if (!key) throw fail('ASSISTANT_KEY_REQUIRED');
    return createAssistantConnectionProbe(net)(key);
  }),
  setKey: key => ordered(async () => {
    if (typeof key !== 'string' || !key.trim() || /[\u0000-\u001f\u007f]/.test(key.trim()) || Buffer.byteLength(key.trim(), 'utf8') > 8192) throw fail('ASSISTANT_INVALID_KEY');
    await changeCredentials(() => store().set(key.trim()));
  }),
  clearKey: () => ordered(() => changeCredentials(() => store().clear())),
  send: (text, context) => {
    let prompt;
    try { prompt = buildAssistantChatPrompt(text, context); } catch (error) { return Promise.reject(error); }
    return runTask(runtime => runtime.sendMessage(prompt));
  },
  analyzeConfiguration: prompt => {
    try { prompt = buildAssistantAnalysisPrompt(prompt); } catch (error) { return Promise.reject(error); }
    return runTask(runtime => runtime.sendMessage(prompt, {independent:true}), {isolated:true});
  },
  close: () => ordered(closeAllRuntimes),
  // A user-requested fresh conversation must not cancel a separate in-flight
  // configuration analysis or silently erase its context.
  reset: () => taskPending ? Promise.reject(fail('ASSISTANT_BUSY')) : ordered(async () => {
    // A failed isolated analysis may also hold a live runtime. Recheck only a
    // quarantined analysis; never disturb a healthy independent session.
    if (analysisRuntime.closeFailed) await closeRuntime(analysisRuntime);
    await closeRuntime(chatRuntime);
  }),
  // Unlike other actions this does not wait behind the running model request.
  // The epoch also invalidates an in-flight startup before a child exists.
  cancel: async () => { cancelGeneration++; await closeAllRuntimes(); },
  // The chat Stop button must not cancel an independent Configuration Butler
  // analysis that started while the chat reply was already in transit.
  cancelChat: async () => { if (taskPendingSlot !== analysisRuntime) cancelGeneration++; await closeRuntime(chatRuntime); },
  shutdown: async () => { shuttingDown = true; await accountAuth?.cancel(); await Promise.all([closeAllRuntimes(),sessions.closeAll({permanent:true})]); },
};
