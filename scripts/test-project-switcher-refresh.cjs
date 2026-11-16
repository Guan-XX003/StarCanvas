const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const file=path.resolve(__dirname,'../electron/preload/desktop-patches.cjs'),source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
function actual(name,context){let code;const visit=n=>{if(ts.isVariableDeclaration(n)&&n.name.getText(tree)===name)code=n.initializer.getText(tree);ts.forEachChild(n,visit);};visit(tree);assert(code);return vm.runInNewContext('('+code+')',context);}
class Element {
 constructor(kind=''){this.kind=kind;this.classList={values:new Set(),add:(...names)=>names.forEach(n=>this.classList.values.add(n))};}
 closest(selector){if(selector.includes('head,')&&this.kind==='canvas')return this;if(selector==='.wanjuan-project-combo'&&this.kind==='own')return this;if(selector.includes('data-wanjuan-project-control')&&this.kind==='source')return this;return null;}
 matches(selector){return this.kind==='root'&&selector.includes('wanjuan-app-top-nav');}
 querySelector(){return null;}
}
class Select extends Element{}class Button extends Element{}
test('project switcher finds stable controls after their titles are translated',()=>{
 const select=new Select(),button=new Button(),add=new Button(),del=new Button(),group=new Element(),toolbar=new Element();
 select.parentElement=group;group.parentElement=toolbar;toolbar.querySelectorAll=()=>[];
 group.querySelector=selector=>selector.includes("='rename'")?button:selector.includes("='create'")?add:selector.includes("='delete'")?del:null;
 let called=0;const mark=actual('markCanvasModelToolbar',{document:{querySelector:selector=>selector.includes('data-wanjuan-project-control')?select:null},HTMLSelectElement:Select,HTMLButtonElement:Button,HTMLElement:Element,installMergedProjectSwitcher:(g,p,s)=>{assert.equal(g,group);assert.equal(p,button);assert.equal(s,select);called++;}});
 mark();assert.equal(called,1);assert(select.classList.values.has('wanjuan-canvas-model-toolbar-select'));assert(button.classList.values.has('wanjuan-canvas-model-toolbar-project'));
 const controls=actual('getProjectControls',{document:{querySelector:selector=>selector.includes("='rename'")?button:selector.includes("='switcher'")?select:null},HTMLSelectElement:Select,HTMLButtonElement:Button});assert.equal(controls().nameButton,button);assert.equal(controls().select,select);
});
test('source select/options and rename text refresh, but own combo writes and canvas updates do not',()=>{
 const relevant=actual('desktopPatchMutationIsRelevant',{Element});
 for(const target of [new Element('source'),{parentElement:new Element('source')}])assert.equal(relevant({target,addedNodes:[],removedNodes:[]}),true);
 for(const target of [new Element('own'),new Element('canvas'),new Element()])assert.equal(relevant({target,addedNodes:[],removedNodes:[]}),false);
 assert.equal(relevant({target:new Element(),addedNodes:[new Element('root')],removedNodes:[]}),true);
});
test('observer watches React text changes and renderer declares locale-independent project controls',()=>{
 assert.match(source,/mo\.observe\(patchObserveRoot, \{ subtree: true, childList: true, characterData: true \}\)/);
 const renderer=fs.readFileSync(path.resolve(__dirname,'../src/renderer/components/WanJuanSettingsSectionD.tsx'),'utf8');
 for(const name of ['rename','switcher','create','delete'])assert(renderer.includes('"data-wanjuan-project-control": `'+name+'`'));
});
