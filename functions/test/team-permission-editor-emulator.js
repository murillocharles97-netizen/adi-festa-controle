'use strict';

const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
const {teamAccessService}=require('../src/services/team-access-service');
const Model=require('../../js/team-permission-model');

async function main(){
  // Guard BEFORE initializing Admin. Never connect to real Auth or Firestore.
  if(!/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Firestore Emulator required; production is forbidden');
  const projectId=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT;
  if(projectId!=='adi-festa-variations-test'&&!/^demo-[a-z0-9-]+$/.test(projectId||''))throw Error('Explicit synthetic Emulator project required');
  const suffix=randomUUID().slice(0,8),businessId=`qa-team-editor-${suffix}`,owner=`qa-owner-${suffix}`,manager=`qa-manager-${suffix}`,
    seller=`qa-seller-${suffix}`,stock=`qa-stock-${suffix}`,spaceA=`qa-space-a-${suffix}`,spaceB=`qa-space-b-${suffix}`,foreignSpace=`qa-foreign-${suffix}`;
  const app=initializeApp({projectId},`team-editor-${suffix}`),db=getFirestore(app),service=teamAccessService(db,{FieldValue,Timestamp}),root=db.doc(`businesses/${businessId}`),checks=[];
  const memberRef=uid=>root.collection('members').doc(uid),allFalse=()=>Object.fromEntries(Model.KEYS.map(key=>[key,false]));
  const data=async ref=>(await ref.get()).data();
  const request=(actor,uid,payload)=>({auth:{uid:actor,token:{email:`${actor}@example.invalid`}},data:{businessId,uid,workspaceGeneration:0,...payload}});
  const draftOf=member=>({role:member.role,spaceAccess:member.spaceAccess,allowedSpaceIds:[...member.allowedSpaceIds],permissions:Model.explicit(member)});
  const seed=async(uid,extra={})=>{
    const member={uid,name:'Pessoa sintética QA',email:`${uid}@example.invalid`,role:'seller',status:'active',spaceAccess:'selected',allowedSpaceIds:[spaceA,spaceB],permissions:{...allFalse(),'sales.create':true,'customers.view':true,'products.view':true,'inventory.view':true},...extra};
    await memberRef(uid).set(member);await db.doc(`users/${uid}`).set({uid,businessId,active:true,role:member.role});
    await db.doc(`memberships/${businessId}_${uid}`).set({uid,businessId,role:member.role,status:member.status,active:true});
    return member;
  };
  try{
    await root.set({id:businessId,active:true,ownerId:owner,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}});
    await seed(owner,{role:'owner',spaceAccess:'all',allowedSpaceIds:[],permissions:{}});
    await seed(manager,{role:'manager',permissions:{'team.manage':true,'team.view':true,'products.view':true}});
    for(const id of[spaceA,spaceB])await db.doc(`financialSpaces/${id}`).set({id,businessId,linkedBusinessId:businessId,ownerUid:owner,active:true,type:'business',capabilities:{finance:false,products:true,sales:true,inventory:true,goals:true}});
    await db.doc(`financialSpaces/${foreignSpace}`).set({id:foreignSpace,businessId:`other-${suffix}`,linkedBusinessId:`other-${suffix}`,active:true,type:'business'});

    const protectedDocs=[
      ['sales/qa-sale',{businessId,spaceId:spaceA,valorFinal:25,status:'pago',operationId:'qa-protected-sale'}],
      ['products/qa-product',{businessId,spaceId:spaceA,estoqueAtual:6,preco:25}],
      ['productVariants/qa-variant',{businessId,spaceId:spaceA,parentProductId:'qa-product',stock:3}],
      ['stockMovements/qa-movement',{businessId,spaceId:spaceA,quantidade:-1,tipo:'saida_venda'}],
      ['clients/qa-client',{businessId,nome:'Cliente QA',saldoDevedor:59.9}],
      ['payments/qa-payment',{businessId,spaceId:spaceA,valor:10}],
      ['productFinancials/qa-product',{businessId,productId:'qa-product',custo:8}],
      ['saleFinancials/qa-sale',{businessId,saleId:'qa-sale',custoTotal:8,lucro:17}],
      ['settings/operation',{businessId,metaDiaria:1000}],
    ].map(([path,value])=>({ref:root.collection(path.split('/')[0]).doc(path.split('/')[1]),value}));
    protectedDocs.push({ref:db.doc(`financialSpaces/${spaceA}/entries/qa-entry`),value:{financialSpaceId:spaceA,amountCents:2500,type:'income'}});
    const batch=db.batch();for(const row of protectedDocs)batch.set(row.ref,row.value);await batch.commit();
    const protectedBefore=await db.getAll(...protectedDocs.map(row=>row.ref));

    const original=await seed(seller),first=draftOf(original),second=draftOf(original);
    first.permissions['customers.edit']=true;second.permissions['inventory.adjust']=true;
    const concurrent=await Promise.allSettled([
      service.updateMember(request(owner,seller,Model.serialize(original,first))),
      service.updateMember(request(owner,seller,Model.serialize(original,second))),
    ]);
    assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(concurrent.filter(result=>result.status==='rejected'&&result.reason.code==='aborted').length,1);
    const concurrentMember=await data(memberRef(seller));
    assert.notEqual(concurrentMember.permissions['customers.edit'],concurrentMember.permissions['inventory.adjust']);
    const concurrentAudits=await root.collection('auditLogs').where('targetUid','==',seller).get();
    assert.equal(concurrentAudits.size,1,'losing transaction must not leave an audit write');
    checks.push('two concurrent edits with one original snapshot: one commit, one aborted, one audit');

    const sparse=await seed(seller,{permissions:{'sales.create':false,'products.view':true}}),sparseDraft=draftOf(sparse);
    sparseDraft.permissions['inventory.view']=true;
    const sparsePayload=Model.serialize(sparse,sparseDraft);
    assert.deepEqual(sparsePayload.expectedAccess.permissions,{'sales.create':false,'products.view':true});
    await service.updateMember(request(owner,seller,sparsePayload));
    const sparseAfter=await data(memberRef(seller));
    assert.deepEqual(sparseAfter.permissions,sparsePayload.permissions);
    assert.deepEqual(Object.keys(sparseAfter.permissions).filter(key=>sparseAfter.permissions[key]).sort(),['inventory.view','products.view']);
    checks.push('real editor serialization of sparse false grants: only two intended grants, no role-preset expansion');

    const beforeForeign=await memberRef(seller).get(),foreignDraft=draftOf(beforeForeign.data());foreignDraft.allowedSpaceIds=[foreignSpace];
    const foreignAuditCount=(await root.collection('auditLogs').get()).size;
    await assert.rejects(service.updateMember(request(owner,seller,Model.serialize(beforeForeign.data(),foreignDraft))),error=>error.code==='invalid-argument');
    const afterForeign=await memberRef(seller).get();
    assert.deepEqual(afterForeign.data(),beforeForeign.data());assert(afterForeign.updateTime.isEqual(beforeForeign.updateTime));
    assert.equal((await root.collection('auditLogs').get()).size,foreignAuditCount);
    checks.push('foreign-company space rejected with unchanged membership and no audit write');

    const target=await seed(seller,{permissions:{'products.view':true}}),escalationDraft=draftOf(target);escalationDraft.permissions['financial.view']=true;
    const beforeEscalation=await memberRef(seller).get(),escalationAuditCount=(await root.collection('auditLogs').get()).size;
    await assert.rejects(service.updateMember(request(manager,seller,Model.serialize(target,escalationDraft))),error=>error.code==='permission-denied');
    const afterEscalation=await memberRef(seller).get();
    assert.deepEqual(afterEscalation.data(),beforeEscalation.data());assert(afterEscalation.updateTime.isEqual(beforeEscalation.updateTime));
    assert.equal((await root.collection('auditLogs').get()).size,escalationAuditCount);
    checks.push('manager cannot grant financial access not possessed; rejected transaction leaves no writes');

    const stockOriginal=await seed(stock,{role:'stock',permissions:{'products.view':true,'inventory.view':true,'inventory.adjust':true}}),stockDraft=draftOf(stockOriginal);
    stockDraft.allowedSpaceIds=[spaceA];await service.updateMember(request(owner,stock,Model.serialize(stockOriginal,stockDraft)));
    const stockAfter=await data(memberRef(stock));
    assert.equal(stockAfter.role,'stock');assert.deepEqual(stockAfter.allowedSpaceIds,[spaceA]);
    assert.deepEqual(Object.keys(stockAfter.permissions).filter(key=>stockAfter.permissions[key]).sort(),['inventory.adjust','inventory.view','products.view']);
    assert.equal((await data(db.doc(`users/${stock}`))).role,'stock');
    assert.equal((await data(db.doc(`memberships/${businessId}_${stock}`))).role,'stock');
    checks.push('existing stock role and three grants preserved across member/profile/membership');

    const current=await data(memberRef(stock)),orderedDraft=draftOf(current),orderedPayload=Model.serialize(current,orderedDraft);
    orderedPayload.expectedAccess.permissions=Object.fromEntries(Object.entries(orderedPayload.expectedAccess.permissions).reverse());
    await service.updateMember(request(owner,stock,orderedPayload));
    checks.push('reordered permission-map snapshot accepted against real Firestore document');

    const protectedAfter=await db.getAll(...protectedDocs.map(row=>row.ref));
    for(let index=0;index<protectedBefore.length;index++){
      assert.deepEqual(protectedAfter[index].data(),protectedBefore[index].data(),protectedDocs[index].ref.path);
      assert(protectedAfter[index].updateTime.isEqual(protectedBefore[index].updateTime),`commercial updateTime changed: ${protectedDocs[index].ref.path}`);
    }
    assert.equal((await root.collection('sales').get()).size,1);assert.equal((await root.collection('stockMovements').get()).size,1);
    assert.equal((await root.collection('processedOperations').get()).size,0);
    assert.equal((await db.collection(`financialSpaces/${spaceA}/entries`).get()).size,1);
    checks.push('sales, stock, variants, clients, payments, costs, profit, goals and financial entry unchanged byte-for-byte/updateTime; no processed operation');

    for(const[ index,check]of checks.entries())console.log(`PASS ${index+1}: ${check}`);
    console.log(`PASS ${checks.length} integrated team-permission editor scenarios; Emulator only, synthetic auth and data.`);
  }finally{
    await db.terminate();await deleteApp(app);
  }
}

main().catch(error=>{console.error(error);process.exitCode=1;});
