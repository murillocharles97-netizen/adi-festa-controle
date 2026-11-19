'use strict';
// "Corrigir SKU/EAN" (V239) — fictitious products only, local Firestore emulator only.
const test=require('node:test'),assert=require('node:assert/strict');
if(!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Only local Firestore emulator is allowed.');
const backendRequire=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=backendRequire('firebase-admin/app');
const {getFirestore,FieldValue}=backendRequire('firebase-admin/firestore');
const {productSpreadsheetService}=require('../../functions/src/services/product-spreadsheet-service');
const projectId='adi-festa-variations-test',suffix=Date.now().toString(36),bid='skufix-'+suffix,uid='owner-'+suffix,space='store-'+suffix;
let app,db,service,seq=0;
const opId=()=>`op${suffix}${String(++seq).padStart(12,'0')}`;
const product=(id,data)=>db.doc(`businesses/${bid}/products/${id}`).set({id,businessId:bid,nome:id,ativo:true,estoqueAtual:5,estoque:5,totalStock:5,preco:10,spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space,spaceScopeVersion:1,...data});
const get=async id=>(await db.doc(`businesses/${bid}/products/${id}`).get()).data();
const row=(id,before,next,line=2)=>({line,id,before,next});
const call=(rows,patch={})=>service.correctIdentifiers({auth:{uid},data:{businessId:bid,spaceId:space,workspaceGeneration:0,operationId:opId(),rows,...patch}});
test.before(async()=>{
 app=initializeApp({projectId},'skufix-'+suffix);db=getFirestore(app);service=productSpreadsheetService(db,{FieldValue});
 await db.doc(`businesses/${bid}`).set({ownerId:uid,active:true,subscription:{planId:'internal',status:'active'}});
 await db.doc(`users/${uid}`).set({active:true,businessId:bid,role:'owner'});
 await db.doc(`businesses/${bid}/members/${uid}`).set({status:'active',role:'owner',spaceAccess:'all'});
 await db.doc(`financialSpaces/${space}`).set({type:'business',businessId:bid,linkedBusinessId:bid,active:true,capabilities:{products:true,sales:true}});
});
test.after(async()=>{if(app)await deleteApp(app);});

test('SKU, EAN and both corrected; old code goes to history, never to alternates',async()=>{
 await product('p-sku',{codigo:'ERRADO-1',barcode:'7890000000011'});
 await product('p-ean',{codigo:'SKU-EAN',barcode:'7890000000099'});
 await product('p-both',{codigo:'X1',barcode:'111'});
 const r=await call([row('p-sku',{codigo:'ERRADO-1',barcode:'7890000000011'},{codigo:'CERTO-1',barcode:'7890000000011'},2),
  row('p-ean',{codigo:'SKU-EAN',barcode:'7890000000099'},{codigo:'SKU-EAN',barcode:'7890000000028'},3),
  row('p-both',{codigo:'X1',barcode:'111'},{codigo:'X2',barcode:'12345678'},4)]);
 assert.deepEqual(r.results.map(x=>x.state),['corrected','corrected','corrected']);
 assert.equal((await get('p-sku')).codigo,'CERTO-1');
 const ean=await get('p-ean');assert.equal(ean.barcode,'7890000000028');assert.equal(ean.barcodeType,'ean_13');
 assert.ok(!(ean.alternateBarcodes||[]).includes('7890000000099'));
 assert.deepEqual(ean.identifierHistory.at(-1).before,{codigo:'SKU-EAN',barcode:'7890000000099'});
 assert.equal(ean.identifierHistory.at(-1).previousCodesActive,false);
 const both=await get('p-both');assert.deepEqual([both.codigo,both.barcode,both.barcodeType],['X2','12345678','ean_8']);
});

test('two products with the same old EAN: only the one named by ID changes',async()=>{
 await product('dup-a',{codigo:'DA',barcode:'7891111111111'});await product('dup-b',{codigo:'DB',barcode:'7891111111111'});
 const r=await call([row('dup-a',{codigo:'DA',barcode:'7891111111111'},{codigo:'DA',barcode:'7892222222222'})]);
 assert.equal(r.results[0].state,'corrected');
 assert.equal((await get('dup-a')).barcode,'7892222222222');assert.equal((await get('dup-b')).barcode,'7891111111111');
});

test('new code already used by another product, an inactive one, a variation or an alternate is a conflict',async()=>{
 await product('owner-x',{codigo:'TAKEN',barcode:'7893333333333',alternateBarcodes:['7894444444444']});
 await product('inactive-x',{codigo:'INACT',barcode:'7895555555555',ativo:false});
 await db.doc(`businesses/${bid}/productVariants/var-x`).set({parentProductId:'owner-x',sku:'VAR-SKU',barcode:'7896666666666',active:true});
 await product('target',{codigo:'T0',barcode:'T0EAN'});
 for(const next of [{codigo:'TAKEN',barcode:'T0EAN'},{codigo:'T0',barcode:'7893333333333'},{codigo:'T0',barcode:'7894444444444'},{codigo:'INACT',barcode:'T0EAN'},{codigo:'VAR-SKU',barcode:'T0EAN'},{codigo:'T0',barcode:'7896666666666'}]){
  const r=await call([row('target',{codigo:'T0',barcode:'T0EAN'},next)]);
  assert.equal(r.results[0].ok,false,JSON.stringify(next));assert.equal(r.results[0].state,'conflict');
 }
 const t=await get('target');assert.deepEqual([t.codigo,t.barcode],['T0','T0EAN']);
 // Two rows asking for the same new code: neither is applied.
 await product('target2',{codigo:'T2',barcode:'T2EAN'});
 const r=await call([row('target',{codigo:'T0',barcode:'T0EAN'},{codigo:'SAME',barcode:'T0EAN'},2),row('target2',{codigo:'T2',barcode:'T2EAN'},{codigo:'SAME',barcode:'T2EAN'},3)]);
 assert.deepEqual(r.results.map(x=>x.ok),[false,false]);
});

test('product with sales and stock history keeps stock, cost, movements and sales',async()=>{
 await product('sold',{codigo:'OLD',barcode:'7897777777777',estoqueAtual:3,estoque:3,totalStock:3,custo:4});
 await db.doc(`businesses/${bid}/stockMovements/mv-sold`).set({produtoId:'sold',tipo:'saida_venda',quantidade:-2,estoqueAnterior:5,estoqueNovo:3});
 await db.doc(`businesses/${bid}/sales/sale-sold`).set({itens:[{produtoId:'sold',quantidade:2,codigo:'OLD'}],total:20});
 const before=await get('sold');
 const r=await call([row('sold',{codigo:'OLD',barcode:'7897777777777'},{codigo:'NEW',barcode:'7898888888888'})]);
 assert.equal(r.results[0].state,'corrected');
 const after=await get('sold');
 for(const k of ['estoqueAtual','estoque','totalStock','custo','preco','nome','allowedSpaceIds'])assert.deepEqual(after[k],before[k],k);
 assert.equal((await db.collection(`businesses/${bid}/stockMovements`).where('produtoId','==','sold').get()).size,1);
 assert.equal((await db.doc(`businesses/${bid}/sales/sale-sold`).get()).data().itens[0].codigo,'OLD');
 assert.equal((await db.collection(`businesses/${bid}/products`).get()).docs.filter(d=>d.id.startsWith('sheet_')).length,0);
});

test('two simultaneous imports: the same correction applies once; competing codes never both win',async()=>{
 await product('race',{codigo:'R0',barcode:'R0EAN'});
 const same=row('race',{codigo:'R0',barcode:'R0EAN'},{codigo:'R1',barcode:'R0EAN'});
 const both=await Promise.all([call([same]),call([same])]);
 assert.deepEqual(both.map(x=>x.results[0].state).sort(),['corrected','unchanged']);
 assert.equal((await get('race')).identifierHistory.length,1);
 await product('race-a',{codigo:'RA',barcode:'RAEAN'});await product('race-b',{codigo:'RB',barcode:'RBEAN'});
 const comp=await Promise.all([call([row('race-a',{codigo:'RA',barcode:'RAEAN'},{codigo:'RA',barcode:'7899999999999'})]),call([row('race-b',{codigo:'RB',barcode:'RBEAN'},{codigo:'RB',barcode:'7899999999999'})])]);
 assert.equal(comp.filter(x=>x.results[0].ok&&x.results[0].state==='corrected').length,1);
 const owners=(await db.collection(`businesses/${bid}/products`).where('barcode','==','7899999999999').get()).size;assert.equal(owners,1);
});

test('lost response: repeating the same operationId replays without applying twice',async()=>{
 await product('lost',{codigo:'L0',barcode:'L0EAN'});
 const data={businessId:bid,spaceId:space,workspaceGeneration:0,operationId:opId(),rows:[row('lost',{codigo:'L0',barcode:'L0EAN'},{codigo:'L1',barcode:'L0EAN'})]};
 const first=await service.correctIdentifiers({auth:{uid},data});assert.equal(first.results[0].state,'corrected');
 const replay=await service.correctIdentifiers({auth:{uid},data});assert.equal(replay.results[0].replayed,true);assert.equal(replay.results[0].state,'corrected');
 assert.equal((await get('lost')).identifierHistory.length,1);
 await assert.rejects(service.correctIdentifiers({auth:{uid},data:{...data,rows:[row('lost',{codigo:'L1',barcode:'L0EAN'},{codigo:'L2',barcode:'L0EAN'})]}}),e=>e.code==='failed-precondition');
 // Stale preview (codes changed since): conflict, nothing applied.
 const stale=await call([row('lost',{codigo:'L0',barcode:'L0EAN'},{codigo:'L9',barcode:'L0EAN'})]);
 assert.equal(stale.results[0].state,'conflict');assert.equal((await get('lost')).codigo,'L1');
});

test('missing, invalid or unknown IDs never create products; permissions and isolation enforced',async()=>{
 const count=async()=>(await db.collection(`businesses/${bid}/products`).get()).size,n=await count();
 for(const bad of [{line:2,before:{codigo:'',barcode:''},next:{codigo:'A',barcode:''}},{line:2,id:'',before:{codigo:'',barcode:''},next:{codigo:'A',barcode:''}},{line:2,id:'a/b',before:{codigo:'',barcode:''},next:{codigo:'A',barcode:''}}])
  await assert.rejects(call([bad]),e=>e.code==='invalid-argument');
 const unknown=await call([row('does-not-exist',{codigo:'',barcode:''},{codigo:'GHOST',barcode:''})]);
 assert.equal(unknown.results[0].ok,false);assert.equal(await count(),n);
 // Clearing a code is not part of this mode.
 await assert.rejects(call([row('race',{codigo:'R1',barcode:'R0EAN'},{codigo:'',barcode:'R0EAN'})]),e=>e.code==='invalid-argument');
 await assert.rejects(service.correctIdentifiers({auth:null,data:{}}),e=>e.code==='unauthenticated');
 const ok=row('race',{codigo:'R1',barcode:'R0EAN'},{codigo:'R2',barcode:'R0EAN'});
 await assert.rejects(service.correctIdentifiers({auth:{uid:'outsider'},data:{businessId:bid,spaceId:space,workspaceGeneration:0,operationId:opId(),rows:[ok]}}),e=>e.code==='permission-denied');
 const seller='seller-'+suffix;
 await db.doc(`businesses/${bid}/members/${seller}`).set({status:'active',role:'seller',spaceAccess:'selected',allowedSpaceIds:[space],permissions:{'products.view':true}});
 await assert.rejects(service.correctIdentifiers({auth:{uid:seller},data:{businessId:bid,spaceId:space,workspaceGeneration:0,operationId:opId(),rows:[ok]}}),e=>e.code==='permission-denied');
 await db.doc(`financialSpaces/foreign-${suffix}`).set({type:'business',businessId:'other-business',active:true,capabilities:{products:true}});
 await assert.rejects(call([ok],{spaceId:`foreign-${suffix}`}),e=>e.code==='permission-denied');
 await assert.rejects(call([ok],{workspaceGeneration:3}),e=>e.code==='failed-precondition');
 assert.equal((await get('race')).codigo,'R1');
});
