const {test}=require('node:test'),assert=require('node:assert/strict');
test('canonical and legacy operations share application-owned permission classes, without wildcard authority',async()=>{
 const p=await import('../electron/shared/application-operation-policy.mjs');
 for(const [legacy,canonical,permission]of [['generateImage','generation.image','generation.paid'],['generateVideo','generation.video','generation.paid'],['generateTianjiVideo','generation.tianji','generation.paid'],['cancel','tasks.cancel','canvas.edit'],['models','models.list','read']]){
  assert.equal(p.applicationOperation(legacy),p.applicationOperation(canonical));assert.equal(p.applicationOperation(legacy).permission,permission);
  assert.equal(p.assertApplicationOperationPermission(legacy,p.applicationOperation(legacy).permissions).id,canonical);
 }
 for(const name of ['generation.image','canvas.plan.apply','data.delete','configuration.write','media.export'])assert.throws(()=>p.assertApplicationOperationPermission(name,['read']),{code:'OPERATION_PERMISSION_REQUIRED'});
 assert.throws(()=>p.assertApplicationOperationPermission('generation.image',['generation.paid']),{code:'OPERATION_PERMISSION_REQUIRED',permission:'canvas.edit'});
 for(const authority of [undefined,'read',['*'],['admin']])assert.throws(()=>p.assertApplicationOperationPermission('app.status',authority),{code:'OPERATION_INVALID_AUTHORITY'});
 for(const name of ['__proto__','constructor','exec','runShell'])assert.throws(()=>p.applicationOperation(name),{code:'OPERATION_UNSUPPORTED'});
});
test('task materialization requires separate media permission and metadata never contains prompts, keys, errors or URLs',async()=>{
 const p=await import('../electron/shared/application-operation-policy.mjs');
 assert.throws(()=>p.assertApplicationOperationPermission('task',['read'],{materialize:true}),{code:'OPERATION_PERMISSION_REQUIRED',permission:'media.export'});
 p.assertApplicationOperationPermission('task',['read','media.export'],{materialize:true});
 const task={id:'QA_TASK',nodeId:'QA_NODE',projectId:'QA_PROJECT',type:'video',status:'running',progress:35,modelName:'qa-model',createdAt:1,updatedAt:2,prompt:'PRIVATE_PROMPT',errorMsg:'PRIVATE_KEY',resultUrl:'https://PRIVATE_MEDIA.invalid',thumbnailUrl:'file:///PRIVATE_PATH',token:'PRIVATE_TOKEN'};
 const result=p.applicationOperationMetadata('tasks',{ok:true,tasks:[task]}),encoded=JSON.stringify(result);for(const sentinel of ['PRIVATE_','prompt','errorMsg','resultUrl','thumbnailUrl','token'])assert(!encoded.includes(sentinel));assert.equal(result.tasks[0].progress,35);
 assert.deepEqual(p.applicationOperationMetadata('task',{ok:true,task:null}),{ok:true,task:null});
 assert.equal(p.applicationOperationMetadata('task',{ok:true,task:{...task,status:'failed',stoppedByUser:true}}).task.status,'cancelled');
 assert.equal(p.applicationOperationMetadata('task',{ok:true,task:{...task,status:'failed',errorMsg:'已手动停止'}}).task.status,'failed','text alone is not proof of a local cancellation');
 assert.deepEqual(p.applicationOperationMetadata('models',{ok:true,image:['qa-image','sk-abcdefghijklmnop'],video:['qa-video'],text:['qa-text']}),{ok:true,image:['qa-image'],video:['qa-video'],text:['qa-text']});
 assert.throws(()=>p.applicationOperationMetadata('tasks',{tasks:Array(2001).fill(task)}),{code:'OPERATION_RESULT_LIMIT'});
 assert.deepEqual(p.applicationOperationMetadata('task',{ok:false,error:'PRIVATE_UPSTREAM'}),{ok:false,code:'OPERATION_FAILED',error:'Application operation failed'});
});
