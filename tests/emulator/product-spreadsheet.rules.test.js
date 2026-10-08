const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const M=require('../../js/product-spreadsheet');
let env;const bid='spreadsheet-qa',uid='spreadsheet-owner',space='spreadsheet-space';
const scope={businessId:bid,uid,spaceId:space,allSpaces:true,allowedSpaceIds:[space],generation:0};
const product=id=>({id,businessId:bid,nome:'Produto '+id,codigo:id,barcode:'',categoria:'Teste',preco:15,estoqueAtual:5,estoque:5,ativo:true,itemKind:'product',productType:'simple',controlaEstoque:true,semControleEstoque:false,spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space,spaceScopeVersion:1});
function service(db,role='owner'){
 const context={businessId:bid,role,spaceAccess:'all',business:{workspaceGeneration:0}};
 const window={ProductSpreadsheet:M,BusinessContext:{get:()=>context},SpaceContext:{homeId:()=>space,list:()=>[{id:space,businessId:bid,active:true,capabilities:{products:true}}]},TeamAccess:{has:p=>role==='owner'||p==='products.view',actor:()=>({actorUid:uid,actorNameSnapshot:'QA',actorRoleSnapshot:role})},SyncFirebase:{getQueueDiagnostics:()=>[],pullCloudCollections:async()=>{},notifyRemoteChange:()=>{}}};
 const source=fs.readFileSync('js/firebase/product-spreadsheet-service.js','utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export async function','async function');
 const box={window,auth:{currentUser:{uid}},db,...sdk,navigator:{onLine:true},crypto:require('node:crypto'),console};
 const api=new Function(...Object.keys(box),source+';return {applyPreview};')(...Object.values(box));return{...api,window,context};
}
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await sdk.setDoc(sdk.doc(db,'businesses',bid),{ownerId:uid,active:true,sensitiveDataVersion:1,subscription:{planId:'internal',status:'active'}});
  await sdk.setDoc(sdk.doc(db,'users',uid),{uid,businessId:bid,role:'owner',active:true});
  await sdk.setDoc(sdk.doc(db,'businesses',bid,'members',uid),{uid,role:'owner',status:'active',spaceAccess:'all',permissions:{}});
  await sdk.setDoc(sdk.doc(db,'financialSpaces',space),{id:space,ownerUid:uid,type:'business',businessId:bid,linkedBusinessId:bid,active:true});
  for(let i=0;i<7;i++){
   await sdk.setDoc(sdk.doc(db,'businesses',bid,'products','item'+i),product('item'+i));
   await sdk.setDoc(sdk.doc(db,'businesses',bid,'productFinancials','item'+i),{id:'item'+i,productId:'item'+i,businessId:bid,custo:0});
  }
 });
});
test.after(()=>env?.cleanup());
test('preview zero writes; real transactions update cost projection + stock audit, chunks and replay safe',async()=>{
 const db=env.authenticatedContext(uid).firestore(),api=service(db),products=Array.from({length:7},(_,i)=>({...product('item'+i),custo:0})),catalog={scope,products};
 const table=[M.columns.map(c=>c[0]),...products.map(p=>[p.id,p.codigo,'',p.nome,p.categoria,'8,50','19.90',3])];
 const plan=M.preview(table,products,scope,{cost:true,stock:true});
 assert.equal((await sdk.getDoc(sdk.doc(db,'businesses',bid,'products','item0'))).data().preco,15);
 const progress=[],report=await api.applyPreview(catalog,plan,(n)=>progress.push(n));
 assert.equal(report.results.filter(r=>r.ok).length,7,JSON.stringify(report));assert.deepEqual(progress,[5,7]);
 const p=(await sdk.getDoc(sdk.doc(db,'businesses',bid,'products','item0'))).data();assert.equal(p.preco,19.9);assert.equal(p.estoqueAtual,3);assert.equal(p.custo,undefined);assert.equal(p.codigo,'item0');
 assert.equal((await sdk.getDoc(sdk.doc(db,'businesses',bid,'productFinancials','item0'))).data().custo,8.5);
 const movements=()=>sdk.getDocs(sdk.collection(db,'businesses',bid,'stockMovements'));
 assert.equal((await movements()).size,7);
 const replay=await api.applyPreview(catalog,plan);assert.equal(replay.results.filter(r=>r.ok).length,0);assert.equal((await movements()).size,7);
});
test('context/permission changes blocked; scope evaluated again at commit; foreign tenant rules deny',async()=>{
 const db=env.authenticatedContext(uid).firestore(),api=service(db);
 const row={id:'item0',line:2,status:'update',before:{preco:19.9},changes:{preco:20}};
 await assert.rejects(service(db,'seller').applyPreview({scope},{rows:[row]}),/permissão/);
 api.context.businessId='foreign';await assert.rejects(api.applyPreview({scope},{rows:[row]}),/mudou|espaço/);
 const other=env.authenticatedContext('outside').firestore();await assertFails(sdk.updateDoc(sdk.doc(other,'businesses',bid,'products','item0'),{preco:1}));
 await env.withSecurityRulesDisabled(c=>sdk.updateDoc(sdk.doc(c.firestore(),'businesses',bid,'products','item0'),{allowedSpaceIds:['other-space']}));
 const report=await service(db).applyPreview({scope},{rows:[row]});assert.equal(report.results[0].ok,false);assert.match(report.results[0].message,/fora/);
});
