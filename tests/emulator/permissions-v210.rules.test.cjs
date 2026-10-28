'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore,FieldValue,Timestamp}=req('firebase-admin/firestore');
const {operationalCommitService}=require('../../functions/src/services/operational-commit-service');
const {teamAccessService}=require('../../functions/src/services/team-access-service');
const {harness,bridge}=require('../helpers/fiado-cancellation-harness.cjs');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Emulator required; production forbidden');
let env,app,db,svc,team,n=0;
test.before(async()=>{const projectId='demo-veconi-permissions-v210';env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});app=initializeApp({projectId},'permissions-v210');db=getFirestore(app);svc=operationalCommitService(db);team=teamAccessService(db,{FieldValue,Timestamp});});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
async function setup(){
 const bid='v210-'+(++n),space=bid+'-a',other=bid+'-b',owner=bid+'-owner',seller=bid+'-seller',creator=bid+'-creator',editor=bid+'-editor',archiver=bid+'-archiver',manager=bid+'-manager',root=db.doc('businesses/'+bid);
 await root.set({active:true,ownerId:owner,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
 const op={'sales.create':true,'sales.cancel':true,'customers.view':true,'customers.receiveDebt':true,'products.view':true,'inventory.view':true};
 const people=[[owner,'owner',{}],[seller,'seller',op],[creator,'seller',{'customers.view':true,'customers.create':true}],[editor,'seller',{'customers.view':true,'customers.edit':true}],[archiver,'seller',{'customers.view':true,'customers.archive':true}],[manager,'manager',{'team.view':true,'team.manage':true,'customers.view':true,'customers.create':true}]];
 for(const[uid,role,permissions]of people){await db.doc('users/'+uid).set({uid,businessId:bid,active:true,role});await root.collection('members').doc(uid).set({uid,name:'Fictício',role,status:'active',permissions,permissionsVersion:2,spaceAccess:'selected',allowedSpaceIds:[space]});}
 for(const id of [space,other])await db.doc('financialSpaces/'+id).set({id,businessId:bid,linkedBusinessId:bid,type:'business',ownerUid:owner,active:true,capabilities:{sales:true,products:true,inventory:true,finance:true}});
 const h=harness({businessId:bid,spaceId:space,uid:seller});
 for(const[col,rows]of [['clients',h.data().clientes],['products',h.data().produtos]])for(const row of rows)await root.collection(col).doc(row.id).set(bridge(row));
 const packet=(uid,writes)=>({businessId:bid,userId:uid,workspaceGeneration:0,status:'pending',operationId:crypto.randomUUID(),checksum:'preserved',attempts:0,payload:{eventKind:'simple',writes}});
 const read=async(col,id)=>(await root.collection(col).doc(id).get()).data();
 return{bid,space,other,owner,seller,creator,editor,archiver,manager,root,h,packet,read,commit:item=>svc.commit({auth:{uid:item.userId},data:{businessId:bid,item}}),w:(data,id='qa-client',operation='update')=>({entityType:'clients',entityId:id,operation,data:{businessId:bid,...data}})};
}
test('create-only creates zero-balance customer once; lost-response retry has one receipt and unchanged payload',async()=>{
 const c=await setup(),p=c.packet(c.creator,[c.w({id:'new',nome:'Fictício novo',saldo:0,financialVersion:0},'new','create')]),original=JSON.stringify(p);
 await c.commit(p);const result=await c.commit(p);assert.equal(result.replayed,true);assert.equal((await c.root.collection('processedOperations').get()).size,1);assert.equal((await c.read('clients','new')).saldo,0);assert.equal(JSON.stringify(p),original);
});
test('create-only cannot edit/archive existing, set initial debt or counters; failed transaction has no receipt',async()=>{
 const c=await setup(),original=await c.read('clients','qa-client');
 for(const w of [c.w({nome:'Negado'}),c.w({active:false}),c.w({nome:'Novo',saldo:-10},'new','create'),c.w({totalComprado:100})])await assert.rejects(c.commit(c.packet(c.creator,[w])));
 assert.deepEqual(await c.read('clients','qa-client'),original);assert.equal((await c.root.collection('processedOperations').get()).size,0);
});
test('edit-only cannot create or archive; archive-only cannot edit metadata; actual archive retains debt and history',async()=>{
 const c=await setup();await c.commit(c.packet(c.editor,[c.w({nome:'Atualizado'})]));
 for(const w of [c.w({nome:'Novo'},'new','create'),c.w({active:false})])await assert.rejects(c.commit(c.packet(c.editor,[w])));
 await assert.rejects(c.commit(c.packet(c.archiver,[c.w({nome:'Negado'})])));
 await c.commit(c.packet(c.archiver,[c.w({active:false,ativo:false,deletedAt:'2026-01-01T00:00:00Z'})]));assert.equal((await c.read('clients','qa-client')).saldo,-12);assert.equal((await c.read('clients','qa-client')).active,false);
 await c.commit(c.packet(c.archiver,[c.w({active:true,ativo:true,deletedAt:null})]));assert.equal((await c.read('clients','qa-client')).active,true);assert.equal((await c.read('clients','qa-client')).deletedAt,null);assert.equal((await c.read('clients','qa-client')).saldo,-12);
});
test('legacy explicit edit preserves prior create/metadata duties; V204-V209 protocol remains compatible',async()=>{
 const c=await setup();await c.root.collection('members').doc(c.editor).update({permissionsVersion:1});
 await c.commit(c.packet(c.editor,[c.w({nome:'Legado',saldo:0},'new','create')]));
 for(const uid of [c.owner,c.seller]){const p=await svc.receipt({auth:{uid},data:{businessId:c.bid,kind:'sync_protocol'}});assert.equal(p.protocolVersion,1);assert.equal(p.permissionsVersion,2);assert.equal(p.minClientRelease,202);}
});

test('immutable legacy cashier keeps its prior duties without accepting profile permission maps',async()=>{
 const c=await setup();await c.root.update({legacyAccessDisabled:false});await c.root.collection('members').doc(c.editor).delete();await db.doc('users/'+c.editor).update({role:'cashier',permissions:{'financial.view':true,'products.edit':true}});
 await c.commit(c.packet(c.editor,[c.w({nome:'Fictício legado',saldo:0},'legacy-new','create')]));
 await c.commit(c.packet(c.editor,[c.w({nome:'Fictício atualizado'})]));
 await assert.rejects(c.commit(c.packet(c.editor,[{entityType:'products',entityId:'qa-product',operation:'update',data:{nome:'Não permitido'}}])));
 assert.equal((await c.read('clients','legacy-new')).saldo,0);
});
test('last variable item sale updates derived availability without granting catalog edit',async()=>{
 const c=await setup(),data=c.h.data(),product=data.produtos[0];Object.assign(product,{productType:'variable',hasVariations:true,totalStock:1,estoque:1,estoqueAtual:1,hasAvailableStock:true});
 data.variacoesProdutos=[{id:'qa-variant',businessId:c.bid,parentProductId:product.id,active:true,stock:1,price:14,displayName:'Variação fictícia'}];
 await c.root.collection('products').doc(product.id).set(bridge(product));await c.root.collection('productVariants').doc('qa-variant').set(bridge(data.variacoesProdutos[0]));
 const before=structuredClone(data),sale=c.h.c.Vendas.registrar({operationId:crypto.randomUUID(),businessId:c.bid,spaceId:c.space,clienteId:'qa-client',status:'pago',formaPagamento:'dinheiro',itens:[{produtoId:product.id,variantId:'qa-variant',quantidade:1,precoOriginal:14,precoFinalUnitario:14}]});
 const p=c.packet(c.seller,bridge(c.h.c.diffWrites(before,c.h.data())));p.operationId=sale.operationId;p.payload.eventKind='sale';
 const policy=require('../../functions/src/shared/permission-policy'),guard=require('../../js/permission-mutations');guard.assertWrites(p.payload.writes,{has:key=>['sales.create','customers.view','products.view','inventory.view'].includes(key)},policy);
 await c.commit(p);await c.commit(p);assert.equal((await c.read('products',product.id)).hasAvailableStock,false);assert.equal((await c.read('productVariants','qa-variant')).stock,0);
 const forged=c.packet(c.seller,[{entityType:'products',entityId:product.id,operation:'update',data:{hasAvailableStock:true}}]);await assert.rejects(c.commit(forged));
});
test('seller denied customers and direct canonical financial/stock writes; no extra financial access',async()=>{
 const c=await setup();await assert.rejects(c.commit(c.packet(c.seller,[c.w({nome:'Negado'},'new','create')])));
 const client=env.authenticatedContext(c.creator).firestore();for(const[col,id,patch]of [['clients','qa-client',{saldo:10}],['products','qa-product',{estoqueAtual:999}],['processedOperations','forged',{id:'forged'}]])await assertFails(sdk.setDoc(sdk.doc(client,`businesses/${c.bid}/${col}/${id}`),patch,{merge:true}));
 await c.root.collection('payments').doc('financial').set({businessId:c.bid,spaceId:c.space,valor:1});await assertFails(sdk.getDoc(sdk.doc(client,`businesses/${c.bid}/payments/financial`)));
});
for(const paid of [true,false])test((paid?'cash':'Fiado')+' authorized sale and cancellation retain balances, delta stock and idempotent receipts',async()=>{
 const c=await setup(),{sale,packet}=c.h.sell({status:paid?'pago':'fiado'});await c.commit(packet);await c.commit(packet);assert.equal((await c.read('products','qa-product')).estoqueAtual,2);
 const undo=c.h.undo(sale.id);await c.commit(undo.packet);await c.commit(undo.packet);assert.equal((await c.read('products','qa-product')).estoqueAtual,3);assert.equal((await c.read('clients','qa-client')).saldo,-12);assert.equal((await c.root.collection('stockMovements').get()).size,2);
});
test('revocation before receipt/commit rejects preserved pending customer without rewriting envelope',async()=>{
 const c=await setup(),p=c.packet(c.creator,[c.w({nome:'Novo'},'new','create')]),original=JSON.stringify(p);await c.root.collection('members').doc(c.creator).update({permissions:{'customers.view':true,'customers.create':false}});await assert.rejects(c.commit(p));assert.equal(JSON.stringify(p),original);assert.equal((await c.root.collection('processedOperations').get()).size,0);
});
test('foreign business/space cannot inherit grants; archived operations cannot be replayed after grant',async()=>{
 const c=await setup(),{packet}=c.h.sell({status:'pago'});packet.payload.writes.find(w=>w.entityType==='sales').data.spaceId=c.other;await assert.rejects(c.commit(packet));
 const p=c.packet(c.creator,[c.w({nome:'Novo'},'new','create')]);await c.root.collection('syncIncidentArchives').doc(p.operationId).set({businessId:c.bid,status:'archived'});await assert.rejects(c.commit(p));p.businessId='foreign';await assert.rejects(c.commit(p));
});
test('restricted editor creates only scoped zero-stock product, never all spaces or another space',async()=>{
 const c=await setup();await c.root.collection('members').doc(c.editor).update({permissions:{'products.view':true,'products.edit':true}});
 const data={id:'scoped-new',businessId:c.bid,nome:'Produto fictício',spaceAccessMode:'single_space',defaultSpaceId:c.space,allowedSpaceIds:[c.space],estoqueAtual:0};
 const w=value=>({entityType:'products',entityId:value.id,operation:'create',data:value});
 await assert.rejects(c.commit(c.packet(c.editor,[w({...data,id:'all-new',spaceAccessMode:'all_spaces',defaultSpaceId:null,allowedSpaceIds:[]})])));
 await assert.rejects(c.commit(c.packet(c.editor,[w({...data,id:'foreign-new',defaultSpaceId:c.other,allowedSpaceIds:[c.other]})])));
 await c.commit(c.packet(c.editor,[w(data)]));assert.equal((await c.read('products','scoped-new')).estoqueAtual,0);assert.equal((await c.root.collection('stockMovements').get()).size,0);
});
test('owner saves explicit create-only V2 without migration, CAS protects concurrent save and old editor cannot erase V2',async()=>{
 const c=await setup(),ref=c.root.collection('members').doc(c.seller),original=(await ref.get()).data(),req={auth:{uid:c.owner},data:{businessId:c.bid,uid:c.seller,permissionsVersion:2,expectedAccess:original,permissions:{'customers.view':true,'customers.create':true},workspaceGeneration:0}};
 await team.updateMember(req);const actual=(await ref.get()).data();assert.equal(actual.permissions['customers.create'],true);assert.equal(actual.permissions['customers.edit'],false);assert.equal(actual.permissions['customers.archive'],false);
 await assert.rejects(team.updateMember(req),{code:'aborted'});
 await assert.rejects(team.updateMember({auth:{uid:c.owner},data:{businessId:c.bid,uid:c.seller,permissions:{'customers.view':true,'customers.edit':true}}}),{code:'failed-precondition'});
});
test('delegated manager cannot grant new spaces, financial privileges, owner role or self-escalate',async()=>{
 const c=await setup();for(const data of [{spaceAccess:'all'},{allowedSpaceIds:[c.other]},{permissions:{'financial.view':true}},{role:'owner'},{uid:c.manager,permissions:{'customers.edit':true}}])await assert.rejects(team.updateMember({auth:{uid:c.manager},data:{businessId:c.bid,uid:c.creator,...data}}));
 assert.equal((await c.read('members',c.creator)).permissions['customers.create'],true);
});

test('V2 invites require explicit grants and coherent customer view; resend preserves version',async()=>{
 const c=await setup(),request={auth:{uid:c.owner},data:{businessId:c.bid,workspaceGeneration:0,name:'Fictício convite',email:'qa@example.invalid',role:'manager',spaceAccess:'selected',allowedSpaceIds:[c.space],permissionsVersion:2}};
 await assert.rejects(team.createInvite(request),{code:'invalid-argument'});
 await assert.rejects(team.createInvite({...request,data:{...request.data,permissions:{'customers.create':true}}}),{code:'invalid-argument'});
 const result=await team.createInvite({...request,data:{...request.data,permissions:{'customers.view':true,'customers.create':true}}});
 const invite=(await c.root.collection('teamInvites').doc(result.invite.id).get()).data();assert.equal(invite.permissionsVersion,2);assert.equal(invite.permissions['customers.create'],true);assert.equal(invite.permissions['customers.edit'],false);assert.equal(invite.permissions['financial.view'],false);
});
test('minimal transition Rules deny direct client writes only for V2; V1 keeps existing path, gateway remains operational',async()=>{
 const projectId='demo-veconi-v210-transition',e=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('security/v210/firestore.transition.rules','utf8')}}),a=initializeApp({projectId},'v210-transition'),d=getFirestore(a);
 try{
  const bid='transition',uid='transition-owner',root=d.doc('businesses/'+bid),mr=root.collection('members').doc(uid);
  await root.set({active:true,ownerId:uid,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}});await d.doc('users/'+uid).set({uid,businessId:bid,active:true,role:'owner'});
  await mr.set({uid,role:'owner',status:'active',spaceAccess:'all',permissionsVersion:1,permissions:{}});
  await root.collection('clients').doc('client').set({id:'client',businessId:bid,ownerId:uid,nome:'Fictício',saldo:0,schemaVersion:3});
  const ref=sdk.doc(e.authenticatedContext(uid).firestore(),`businesses/${bid}/clients/client`);
  await sdk.updateDoc(ref,{nome:'V1 legítimo'});
  await mr.update({permissionsVersion:2});await assertFails(sdk.updateDoc(ref,{nome:'Direto negado'}));
  const service=operationalCommitService(d),item={operationId:crypto.randomUUID(),businessId:bid,userId:uid,workspaceGeneration:0,payload:{eventKind:'simple',writes:[{entityType:'clients',entityId:'client',operation:'update',data:{nome:'Gateway autorizado'}}]}};
  await service.commit({auth:{uid},data:{businessId:bid,item}});assert.equal((await root.collection('clients').doc('client').get()).data().nome,'Gateway autorizado');
 }finally{await e.cleanup();await deleteApp(a);}
});
