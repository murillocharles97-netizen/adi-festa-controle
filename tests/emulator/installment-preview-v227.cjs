'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
assert.equal(process.env.GCLOUD_PROJECT,'demo-veconi-owner-v219');
for(const key of ['FIREBASE_AUTH_EMULATOR_HOST','FIRESTORE_EMULATOR_HOST'])assert.match(process.env[key]||'',/^127\.0\.0\.1:\d+$/);
const dep=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=dep('firebase-admin/app'),{getFirestore}=dep('firebase-admin/firestore');
const Plan=require('../../functions/src/shared/installment-plan');
const {operationalCommitService}=require('../../functions/src/services/operational-commit-service');
test('server read separates 247 due and 20 future, and promotes only the first 2 on its due date',async()=>{
  const app=initializeApp({projectId:'demo-veconi-owner-v219'},'preview-'+crypto.randomUUID());
  try {
    const db=getFirestore(app),id=crypto.randomUUID(),bid='qa-'+id,uid='owner-'+id,space='space-'+id;
    const root=db.doc('businesses/'+bid);
    await root.set({id:bid,ownerId:uid,active:true,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}});
    await db.doc('users/'+uid).set({uid,businessId:bid,active:true,role:'owner'});
    await root.collection('members').doc(uid).set({uid,role:'owner',status:'active',permissionsVersion:2,spaceAccess:'all',permissions:{}});
    await db.doc('financialSpaces/'+space).set({id:space,businessId:bid,linkedBusinessId:bid,type:'business',ownerUid:uid,active:true,capabilities:{sales:true}});
    const clientRef=root.collection('clients').doc('client');
    await clientRef.set({id:'client',businessId:bid,saldo:-267,legacyBalance:247,legacyBalanceRemaining:247,financialVersion:1,workspaceGeneration:0});
    await root.collection('sales').doc('plan').set({id:'plan',businessId:bid,spaceId:space,clienteId:'client',status:'fiado',formaPagamento:'fiado',valorFinal:20,creditOriginalAmount:20,creditPaidAmount:0,creditRemainingAmount:20,data:'2026-11-07T12:00:00Z',workspaceGeneration:0,installmentPlan:Plan.create({total:20,downPayment:0,count:10,firstDueDate:'2026-12-07',saleDate:'2026-11-07'})});
    let now='2026-11-07T12:00:00Z';
    const service=operationalCommitService(db,{now:()=>new Date(now)});
    const request={auth:{uid,token:{uid}},data:{kind:'fiado_account',businessId:bid,workspaceGeneration:0,clientId:'client'}};
    const before=(await clientRef.get()).updateTime.toMillis();
    const current=(await service.receipt(request)).account;
    assert.equal(current.dueCents,24700);assert.equal(current.futureCents,2000);assert.equal(current.totalCents,26700);
    now='2026-12-07T12:00:00Z';
    const due=(await service.receipt(request)).account;
    assert.equal(due.dueCents,24900);assert.equal(due.futureCents,1800);assert.equal(due.totalCents,26700);
    await service.receipt(request);
    assert.equal((await clientRef.get()).updateTime.toMillis(),before);
    assert.equal((await root.collection('payments').get()).size,0);
  } finally {await deleteApp(app);}
});
