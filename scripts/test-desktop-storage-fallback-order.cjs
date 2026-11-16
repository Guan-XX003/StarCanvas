// Exercise real preload storage code with a synthetic in-memory IndexedDB and
// mirror. No real browser profile, project data or credentials are used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../electron/preload/storage.cjs'),'utf8');
function fixture(initial={}) {
 const records={...initial},warnings=[];let mirror=null,failWrites=0,afterCommit=null;
 const localStorage={getItem:()=>mirror,setItem:(_key,value)=>{mirror=value},removeItem:()=>{mirror=null}};
 const db={transaction(_store,mode){
  const changes=[],tx={error:null};tx.objectStore=()=>({
   get(key){const request={};queueMicrotask(()=>{request.result=records[key];request.onsuccess()});return request},
   put(value,key){changes.push([key,value])},delete(key){changes.push([key,undefined])},clear(){changes.push([null,null])},
  });
  setTimeout(()=>{
   if(mode==='readwrite'&&failWrites>0){failWrites--;tx.error=Error('SYNTHETIC_PRIVATE_ERROR');tx.onabort();return}
   if(mode==='readwrite'){for(const [key,value] of changes){if(key===null)for(const k of Object.keys(records))delete records[k];else if(value===undefined)delete records[key];else records[key]=value}if(afterCommit){const fn=afterCommit;afterCommit=null;fn()}}
   tx.oncomplete();
  },0);return tx;
 }};
 const window={localStorage,indexedDB:{open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess()});return request}}};
 function fresh(){const module={exports:{}};vm.runInNewContext(source,{module,window,console:{warn(...args){warnings.push(args)}},require(name){
  if(name==='./constants.cjs')return {STORAGE_KEY:'synthetic',STORAGE_DB_NAME:'synthetic',STORAGE_DB_VERSION:1,STORAGE_DB_STORE:'items'};
  if(name==='./runtime.cjs')return {ipcRenderer:{invoke:async()=>({active:false})}};
  if(name==='./boot-theme.cjs')return {mirrorBootThemeFromStore(){}};
  if(name==='./chrome-shim.cjs')return {pickStorage:(keys,store)=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,store[key]]))};
  throw Error('UNEXPECTED_REQUIRE');
 }});return module.exports}
 return {records,warnings,fresh,failNext:n=>{failWrites=n},getMirror:()=>mirror,setMirror:value=>{mirror=value},onCommit:fn=>{afterCommit=fn}};
}
(async()=>{
 // A failed write followed by a successful newer write must not replay the old
 // fallback over that newer value when another renderer starts.
 const a=fixture({manualApi:'synthetic-manual'}),s=a.fresh();await s.setDesktopStorageItems({themeMode:'original'});a.failNext(1);
 await s.setDesktopStorageItems({themeMode:'old-fallback',manualSetting:'keep'});assert.equal(JSON.parse(a.getMirror()).themeMode,'old-fallback');
 await s.setDesktopStorageItems({themeMode:'newer'});assert.equal(a.records.themeMode,'newer');assert.equal(a.records.manualSetting,'keep');assert.equal(a.records.manualApi,'synthetic-manual');
 const reread=await a.fresh().getDesktopStorageItemsWithStatus(['themeMode','manualApi']);assert.equal(reread.values.themeMode,'newer');assert.equal(reread.values.manualApi,'synthetic-manual');

 // If recovering the fallback also fails, the newer write stays in the mirror
 // until a later attempt can safely flush it; it must not revive the old value.
 const b=fixture(),t=b.fresh();await t.setDesktopStorageItems({themeMode:'original'});b.failNext(2);
 await t.setDesktopStorageItems({themeMode:'old-fallback'});await t.setDesktopStorageItems({themeMode:'newer'});
 assert.equal(JSON.parse(b.getMirror()).themeMode,'newer');assert.equal(b.records.themeMode,'original');
 await t.setDesktopStorageItems({appLanguage:'zh-TW'});assert.equal(b.records.themeMode,'newer');assert.equal(b.records.appLanguage,'zh-TW');
 assert.equal((await t.getDesktopStorageItemsWithStatus(['themeMode'])).reliable,false,'a past failed migration remains conservatively untrusted');

 // Preload callers outside the renderer write barrier can issue writes at the
 // same time. Their invocation order must survive a fallback and recovery.
 const c=fixture(),u=c.fresh();await u.setDesktopStorageItems({themeMode:'original'});c.failNext(1);
 await Promise.all([u.setDesktopStorageItems({themeMode:'old-fallback'}),u.setDesktopStorageItems({themeMode:'newer'})]);assert.equal(c.records.themeMode,'newer');
 assert.equal((await c.fresh().getDesktopStorageItemsWithStatus(['themeMode'])).values.themeMode,'newer');

 // A newer mirror written during migration must not be deleted as if it were
 // the copied snapshot. The next write can safely flush it.
 const d=fixture(),v=d.fresh();await v.setDesktopStorageItems({themeMode:'original'});d.failNext(1);await v.setDesktopStorageItems({themeMode:'old-fallback'});
 d.onCommit(()=>d.setMirror(JSON.stringify({themeMode:'other-writer',manualSetting:'preserve'})));
 await v.setDesktopStorageItems({themeMode:'newer'});assert.equal(JSON.parse(d.getMirror()).themeMode,'newer');assert.equal(JSON.parse(d.getMirror()).manualSetting,'preserve');
 await v.setDesktopStorageItems({appLanguage:'en-US'});assert.equal(d.records.themeMode,'newer');assert.equal(d.records.manualSetting,'preserve');

 const e=fixture(),w=e.fresh();e.setMirror('{not-json');await w.setDesktopStorageItems({themeMode:'newer'});
 assert.equal(e.getMirror(),'{not-json','a corrupt mirror must never be overwritten');assert.equal((await w.getDesktopStorageItemsWithStatus(['themeMode'])).reliable,false);
 const warnings=[...a.warnings,...b.warnings,...c.warnings,...d.warnings,...e.warnings];assert.ok(warnings.length);assert.ok(warnings.every(args=>args.length===1&&typeof args[0]==='string'),'fallback warnings never expose exception objects');assert.doesNotMatch(warnings.flat().join(' '),/SYNTHETIC_PRIVATE_ERROR/);
 console.log('PASS_DESKTOP_STORAGE_FALLBACK_WRITE_ORDER');
})().catch(error=>{console.error(error);process.exitCode=1});
