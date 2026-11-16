// Real assistant service and runtime verification, fake credential and model
// transport. No user data, system keychain, or provider network is accessed.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const originalLoad = Module._load;
let sessions = 0, closes = 0, releaseAnalysis, releaseChat, closeFails = false, removedWhileUnconfirmed = 0, useAccount = false, brokerNever = false, releaseBroker;
const closedSessions = [];
Module._load = function(name, parent, isMain) {
  if (parent?.filename.endsWith('assistant-service.cjs')) {
    if (name === 'node:fs/promises') {const real=originalLoad.apply(this,arguments);return {...real,rm:async(...args)=>{if(closeFails||brokerNever)removedWhileUnconfirmed++;return real.rm(...args)}};}
    if (name === './electron-refs.cjs') return {app:{isPackaged:false,getAppPath:() => root},net:{}};
    if (name === './assistant-credential-vault.cjs') return {createSystemAssistantCredentialVault:() => ({getForMainProcess:async() => useAccount?null:'synthetic-key',hasCredential:async() => !useAccount})};
    if (name === './assistant-account-vault.cjs') return {createSystemAssistantAccountVault:()=>({hasRecord:async()=>true,getForMainProcess:async()=>({token:'synthetic-grant'})})};
    if (name === './assistant-account-broker.cjs') return {createAssistantAccountBroker:()=>{let pending;return {start:async()=>({clientKey:'synthetic-local',baseURL:'http://127.0.0.1:9'}),close:()=>{if(!brokerNever)return pending||Promise.resolve();if(!pending)pending=new Promise(resolve=>{releaseBroker=resolve});return pending}}}};
    if (name === './assistant-harness-client.cjs') return {createHarnessClient:() => {
      const id = ++sessions;
      let abort;
      return {sendMessage:async (message, options) => {
        if (options?.independent && message === 'failure') throw Object.assign(new Error('synthetic'), {code:'ASSISTANT_PROVIDER_SERVER'});
        if (options?.independent) return new Promise((resolve, reject) => { releaseAnalysis = resolve; abort = reject; });
        if (message === 'SYNTHETIC_SLOW_CHAT') return new Promise((resolve,reject)=>{releaseChat=resolve;abort=reject;});
        return `session-${id}:${message}`;
      },close:async() => { if(closeFails) throw Error('synthetic unconfirmed exit');closes++; closedSessions.push(id); if (abort) { abort(new Error('closed')); abort = null; } }};
    }};
  }
  return originalLoad.apply(this, arguments);
};
const assistant = require('../electron/main/assistant-service.cjs');
Module._load = originalLoad;
(async () => {
  try {
    assert.equal(await assistant.send('first'), 'session-1:first');
    await assert.rejects(assistant.setKey('invalid\ncontrol'), {code:'ASSISTANT_INVALID_KEY'});
    assert.equal(await assistant.send('after invalid key'), 'session-1:after invalid key', 'invalid replacement cannot close the current conversation');
    await assistant.reset();
    assert.equal(closes, 1, 'reset closes the old runtime');
    assert.equal(await assistant.send('second'), 'session-2:second', 'the next turn starts a fresh runtime');
    const analysis = assistant.analyzeConfiguration('synthetic');
    analysis.catch(() => {});
    for (let i = 0; i < 500 && !releaseAnalysis; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(typeof releaseAnalysis, 'function', 'independent analysis reached the fake transport');
    await assert.rejects(assistant.reset(), {code:'ASSISTANT_BUSY'});
    assert.equal(closes, 1, 'reset cannot interrupt an independent analysis');
    releaseAnalysis('done');
    assert.equal(await analysis, 'done');
    assert.deepEqual(closedSessions, [1, 3], 'successful analysis disposes only its own runtime');
    assert.equal(await assistant.send('chat after analysis'), 'session-2:chat after analysis');
    await assert.rejects(assistant.analyzeConfiguration('failure'), {code:'ASSISTANT_PROVIDER_SERVER'});
    assert.deepEqual(closedSessions, [1, 3, 4], 'failed analysis also disposes only its own runtime');
    assert.equal(await assistant.send('chat after failure'), 'session-2:chat after failure', 'failed analysis cannot silently reset chat');
    await assistant.reset();
    assert.deepEqual(closedSessions, [1, 3, 4, 2]);
    assert.equal(await assistant.send('before cancel'), 'session-5:before cancel');
    releaseAnalysis = null;
    const cancelledAnalysis = assistant.analyzeConfiguration('slow');
    cancelledAnalysis.catch(() => {});
    for (let i = 0; i < 500 && !releaseAnalysis; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(typeof releaseAnalysis, 'function');
    await assistant.cancel();
    await assert.rejects(cancelledAnalysis, {code:'ASSISTANT_CANCELLED'});
    assert.deepEqual(closedSessions.slice(-2).sort(), [5, 6], 'cancellation closes both runtime slots');
    assert.equal(await assistant.send('after cancel'), 'session-7:after cancel');
    releaseAnalysis = null;
    const independent = assistant.analyzeConfiguration('still-running');
    for (let i=0;i<500&&!releaseAnalysis;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(typeof releaseAnalysis,'function');
    await assistant.cancelChat();
    assert.ok(closedSessions.includes(7),'the stale chat is closed');
    assert.ok(!closedSessions.includes(8),'stopping chat cannot close independent configuration analysis');
    releaseAnalysis('analysis-preserved');assert.equal(await independent,'analysis-preserved');
    assert.equal(await assistant.send('new chat'),'session-9:new chat');
    const earlyChat=assistant.send('early');earlyChat.catch(()=>{});await assistant.cancelChat();
    await assert.rejects(earlyChat,{code:'ASSISTANT_CANCELLED'},'a queued chat is fenced before startup');
    const slowChat=assistant.send('SYNTHETIC_SLOW_CHAT');slowChat.catch(()=>{});
    for(let i=0;i<500&&!releaseChat;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(typeof releaseChat,'function');await assistant.cancelChat();await assert.rejects(slowChat,{code:'ASSISTANT_CANCELLED'});
    releaseChat=null;const uncertain=assistant.send('SYNTHETIC_SLOW_CHAT');uncertain.catch(()=>{});
    for(let i=0;i<500&&!releaseChat;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(typeof releaseChat,'function');closeFails=true;
    await assert.rejects(assistant.cancelChat(),{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
    releaseChat('untrusted late reply');await assert.rejects(uncertain,{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
    const countBefore=sessions;await assert.rejects(assistant.send('must not start'),{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
    assert.equal(sessions,countBefore,'no new process may start while the old exit is unconfirmed');
    assert.equal(removedWhileUnconfirmed,0,'the runtime home is retained while exit cannot be confirmed');
    closeFails=false;await assistant.reset();assert.equal(await assistant.send('after recheck'),`session-${countBefore+1}:after recheck`);
    releaseAnalysis=null;const failedAnalysis=assistant.analyzeConfiguration('synthetic pending analysis');failedAnalysis.catch(()=>{});
    for(let i=0;i<500&&!releaseAnalysis;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(typeof releaseAnalysis,'function');closeFails=true;releaseAnalysis('synthetic completed result');
    await assert.rejects(failedAnalysis,{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
    const beforeQuarantine=sessions;await assert.rejects(assistant.send('must not bypass analysis quarantine'),{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
    assert.equal(sessions,beforeQuarantine,'an unconfirmed analysis exit also blocks a new chat runtime');
    assert.equal(removedWhileUnconfirmed,0,'an unconfirmed analysis home is not deleted either');
    closeFails=false;await assistant.reset();assert.equal(await assistant.send('after analysis recheck'),`session-${beforeQuarantine+1}:after analysis recheck`);
    await assistant.reset();useAccount=true;releaseChat=null;brokerNever=true;
    const brokerBlocked=assistant.send('SYNTHETIC_SLOW_CHAT');brokerBlocked.catch(()=>{});
    for(let i=0;i<500&&!releaseChat;i++) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(typeof releaseChat,'function');const closedBefore=closes;
    await assert.rejects(assistant.cancelChat(),{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
    assert.ok(closes>closedBefore,'the child is stopped even when the account broker never finishes');
    await assert.rejects(brokerBlocked,{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
    assert.equal(removedWhileUnconfirmed,0,'a hung broker cannot cause early runtime-home deletion');
    const beforeBrokerRecheck=sessions;await assert.rejects(assistant.send('blocked while broker hangs'),{code:'ASSISTANT_RUNTIME_STOP_UNCONFIRMED'});
    assert.equal(sessions,beforeBrokerRecheck);brokerNever=false;releaseBroker();await assistant.reset();useAccount=false;
    assert.equal(await assistant.send('after broker recovery'),`session-${beforeBrokerRecheck+1}:after broker recovery`);
    console.log('PASS_ASSISTANT_RESET_SESSION_AND_BUSY');
  } finally { await assistant.shutdown(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
