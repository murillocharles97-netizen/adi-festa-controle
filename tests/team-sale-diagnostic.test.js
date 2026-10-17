'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/firebase/sync.js','utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function runtime(){
 const packet={operationId:'op',userId:'seller',businessId:'biz',attempts:2,lastAttemptAt:'2026-10-17T14:20:09Z',lastErrorCode:'permission-denied',lastErrorMessage:'permission-denied',payload:{eventKind:'sale',writes:[{entityType:'sales',entityId:'sale',data:{businessId:'biz',operationId:'op',spaceId:'space',actorUid:'seller',actorRoleSnapshot:'seller',clienteNome:'Do not export payload',itens:[{nome:'Private product'}]}}]}};
 const context={structuredClone,String,Boolean,Object,Number,Date,PROJECT_ID:'test',currentUser:{uid:'seller'},state:{userProfile:{role:'seller',active:true},syncFailureHistory:[],sessionTrace:[]},validateUser:async()=>{},activeBusinessId:()=> 'biz',DB:{carregar:()=>({})},readQueue:()=>[packet],AUDIT_NAMES:[],now:()=> 'now',deviceId:()=> 'device',indexedDbInventory:async()=>[],queueCounts:()=>({total:1}),saleIntegrityDiagnostics:()=>({count:0}),paymentIntegrityDiagnostics:()=>({count:0}),queueSubtype:()=> 'sale',containsInvalidFirestoreValue:()=>false,checksumValue:()=> 'hash',BusinessContext:{get:()=>({role:'seller',permissions:['sales.create','inventory.view'],allowedSpaceIds:['space'],spaceAccess:'selected',member:{status:'active',spaceAccess:'selected'}})}};
 context.window=context;vm.createContext(context);vm.runInContext(section('function saleQueueRequiresReview(','const queuePreflight'),context);vm.runInContext(section('function queueOperationDiagnostic(','function downloadJsonFile('),context);return{context,packet};
}
test('export is read-only and includes technical identity, operation/sale/space/error without sale payload',async()=>{
 const {context:c,packet}=runtime(),before=JSON.stringify(packet),r=await c.exportLocalDiagnostic();
 assert.equal(JSON.stringify(packet),before);assert.equal(r.technicalIdentity.uid,'seller');assert.equal(r.technicalIdentity.role,'seller');assert.deepEqual(Array.from(r.technicalIdentity.permissions),['sales.create','inventory.view']);assert.equal(r.queue[0].technical.sales[0].saleId,'sale');assert.equal(r.queue[0].technical.sales[0].spaceId,'space');assert.equal(r.queue[0].technical.lastErrorCode,'permission-denied');assert.equal(r.queue[0].retryCount,2);assert.equal(r.queue[0].technical.eventKind,'sale');assert.equal(r.queue[0].technical.operationUserId,'seller');assert.equal(JSON.stringify(r).includes('Do not export'),false);assert.equal(JSON.stringify(r).includes('Private product'),false);
});
test('unknown first failure is null, never invented from sale creation or last attempt',()=>{
 const {context:c,packet}=runtime();packet.createdAtLocal='sale-creation';const r=c.queueOperationDiagnostic(packet);assert.equal(r.firstFailureAt,null);assert.equal(r.firstFailureRecorded,false);packet.firstFailedAt='known-first-failure';assert.equal(c.queueOperationDiagnostic(packet).firstFailureAt,'known-first-failure');
});
test('queue error export sanitizes contact, URLs, bearer and secret-shaped fields',()=>{
 const {context:c,packet}=runtime();packet.lastErrorMessage='deny user@example.test https://example.test/?token=abc Bearer hidden-secret password=12345 secret:abcdef';const r=c.queueOperationDiagnostic(packet);for(const value of ['user@example.test','https://example.test','hidden-secret','12345','abcdef'])assert.equal(r.lastErrorMessage.includes(value),false);assert.equal(r.lastErrorCode,'permission-denied');
});
