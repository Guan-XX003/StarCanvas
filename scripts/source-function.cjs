// Read a named real source function for isolated behavioral tests. No edits,
// eval, app data or lifecycle side effects occur in this helper.
const ts=require('typescript'),assert=require('node:assert/strict');
module.exports=function sourceFunction(source,name,kind=ts.ScriptKind.JS){
 const tree=ts.createSourceFile('source',source,ts.ScriptTarget.Latest,true,kind),found=[];
 (function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text===name)found.push(node.getText(tree));ts.forEachChild(node,visit);})(tree);
 assert.equal(found.length,1,'exact named source function: '+name);return found[0];
};
