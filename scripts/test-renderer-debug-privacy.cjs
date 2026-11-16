// Run the real preload logging helper against in-memory adapters only.
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const originalLoad = Module._load, originalWindow = global.window, originalTimeout = global.setTimeout;
const handlers = {}, timers = [], writes = [];
global.window = {addEventListener:(name, handler) => {handlers[name] = handler;}};
global.setTimeout = fn => {timers.push(fn); return timers.length;};
Module._load = function(name, parent, ...rest) {
  if (parent?.filename.endsWith('boot-theme.cjs')) {
    if (name === './runtime.cjs') return {fs:{appendFile:(target, value, cb)=>{writes.push({target,value});cb();}},os:{tmpdir:()=>'/synthetic-only'},path};
    if (name === './legacy-data.cjs') return {normalizeThemeValue:value=>value};
    if (name === './storage.cjs') return {getDesktopStorageItems:async()=>({})};
  }
  return originalLoad.apply(this,[name,parent,...rest]);
};
try {
  const {appendRendererDebugLog} = require('../electron/preload/boot-theme.cjs');
  const neverRead = () => {throw Error('SYNTHETIC_PRIVATE_GETTER');};
  handlers.error({lineno:42,colno:7,get message(){return neverRead()},get filename(){return neverRead()},get error(){return neverRead()}});
  handlers.error({lineno:42,colno:7}); // Same fixed location is deduplicated.
  handlers.unhandledrejection({get reason(){return neverRead()}});
  appendRendererDebugLog('SYNTHETIC_PRIVATE_TYPE',{message:'SYNTHETIC_PRIVATE_MESSAGE',stack:'SYNTHETIC_PRIVATE_STACK'});
  appendRendererDebugLog('error',{lineno:'SYNTHETIC_PRIVATE_LINE',colno:Infinity,extra:'SYNTHETIC_PRIVATE_EXTRA'});
  assert.equal(timers.length,1);timers.shift()();
  assert.equal(writes.length,1);assert.equal(writes[0].target,path.join('/synthetic-only','wanjuan-renderer-debug.log'));
  assert.doesNotMatch(writes[0].value,/SYNTHETIC_PRIVATE/);
  const rows=writes[0].value.trim().split('\n').map(line=>JSON.parse(line));
  assert.deepEqual(rows.map(({type,payload})=>({type,payload})),[
    {type:'error',payload:{line:42,column:7}},
    {type:'unhandledrejection',payload:{}},
    {type:'other',payload:{}},
    {type:'error',payload:{line:0,column:0}},
  ]);
  console.log('PASS_RENDERER_DEBUG_PRIVACY');
} finally {
  Module._load=originalLoad;global.window=originalWindow;global.setTimeout=originalTimeout;
}
