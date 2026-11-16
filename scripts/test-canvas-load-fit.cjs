const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
require.extensions['.ts']=(m,file)=>m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},fileName:file}).outputText,file);
const {canvasViewportAreaReady,scheduleCanvasLoadFit}=require('../src/renderer/lib/canvas-load-fit.ts');
function fixture(t){
 const original={setTimeout:global.setTimeout,clearTimeout:global.clearTimeout,ResizeObserver:global.ResizeObserver},timers=new Map(),observers=[];let serial=0,area={width:1280,height:730};
 global.setTimeout=fn=>{const id=++serial;timers.set(id,fn);return id;};global.clearTimeout=id=>timers.delete(id);
 global.ResizeObserver=class {constructor(callback){this.callback=callback;this.connected=true;observers.push(this);}observe(element){this.element=element;}disconnect(){this.connected=false;}};
 t.after(()=>Object.assign(global,original));
 const element={isConnected:true,getBoundingClientRect:()=>area};
 return {element,timers,observers,setArea(value){area=value;},tick(){const current=[...timers.values()];timers.clear();for(const fn of current)fn();},resize(){for(const o of observers)if(o.connected)o.callback();}};
}
test('area readiness rejects zero, nonfinite and missing dimensions',()=>{
 for(const value of [null,undefined,{width:0,height:300},{width:100,height:0},{width:NaN,height:100},{width:100,height:Infinity},{width:-1,height:100}])assert.equal(canvasViewportAreaReady(value),false);
 assert.equal(canvasViewportAreaReady({width:820,height:650}),true);
});
test('load fit runs once and disconnects without scanning or repeated node-edit fitting',t=>{
 const f=fixture(t);let calls=0;const stop=scheduleCanvasLoadFit(f.element,()=>calls++);
 f.resize();f.resize();assert.equal(f.timers.size,1);f.tick();assert.equal(calls,1);assert(f.observers.every(o=>!o.connected));f.resize();f.tick();assert.equal(calls,1);stop();assert.equal(f.timers.size,0);
});
test('hidden zero-sized canvas waits for positive ResizeObserver dimensions rather than fitting or polling',t=>{
 const f=fixture(t);f.setArea({width:0,height:0});let calls=0;const stop=scheduleCanvasLoadFit(f.element,()=>calls++);f.tick();assert.equal(calls,0);assert.equal(f.timers.size,0);
 f.setArea({width:1280,height:730});f.resize();f.tick();assert.equal(calls,1);stop();
});
test('navigation/unmount cancels delayed fit and later observer callbacks cannot revive it',t=>{
 const f=fixture(t);let calls=0;const stop=scheduleCanvasLoadFit(f.element,()=>calls++);stop();f.tick();f.resize();f.tick();assert.equal(calls,0);assert.equal(f.timers.size,0);assert(f.observers.every(o=>!o.connected));
});
test('detached and nonfinite layout stays unfit until a real valid resize',t=>{
 const f=fixture(t);let calls=0;const stop=scheduleCanvasLoadFit(f.element,()=>calls++);f.element.isConnected=false;f.tick();assert.equal(calls,0);
 f.element.isConnected=true;f.setArea({width:NaN,height:600});f.resize();f.tick();assert.equal(calls,0);f.setArea({width:820,height:650});f.resize();f.tick();assert.equal(calls,1);stop();
});
test('actual hook fits only a loaded visible project, preserves manual viewport on tab return, and resets for a new load',t=>{
 const f=fixture(t),file=path.resolve(__dirname,'../src/renderer/hooks/useLateEffect1076.ts'),code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 let effect,cleanup,previous=[],ref={current:false};const exports={};
 vm.runInNewContext(code,{exports,require:name=>name==='react'?{useRef:()=>ref,useEffect:(fn,deps)=>{if(deps.some((v,i)=>v!==previous[i])){cleanup?.();effect=fn;previous=deps;}}}:name.includes('canvas-load-fit')?{scheduleCanvasLoadFit}:assert.fail(name)});
 const calls=[],fitView=options=>{calls.push(options);return Promise.resolve(true);},wrapperRef={current:f.element};
 function render(visible,loaded=true,count=1){effect=undefined;exports.useLateEffect1076({visible,shouldFitView:loaded,nodes:Array(count).fill({}),fitView,wrapperRef});if(effect)cleanup=effect();}
 render(true,false);f.tick();assert.equal(calls.length,0);render(true);render(false);f.tick();assert.equal(calls.length,0);
 render(true);f.tick();assert.equal(calls.length,1);assert.equal(calls[0].duration,0);assert.equal(calls[0].padding,0.2);
 render(false);render(true);f.tick();assert.equal(calls.length,1,'returning does not replace a manual viewport');
 render(true,false);render(true);f.tick();assert.equal(calls.length,2);cleanup?.();
});
