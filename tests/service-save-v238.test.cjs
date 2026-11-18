'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const {harness}=require('./helpers/owner-receipt-v219.cjs');
function setup({published=false}={}){
 const h=harness(),w=h.w;w.Utils.escapar=String;w.eval(published?cp.execFileSync('git',['show','913c81d:js/spaces.js'],{encoding:'utf8'}):fs.readFileSync('js/spaces.js','utf8'));
 const spaces=[{id:'taxi',name:'Táxi',businessId:'qa-business',ownerUid:'qa-owner',type:'other',active:true,capabilities:{sales:true,products:false,inventory:false,finance:true}},
 {id:'shop',name:'Loja',businessId:'qa-business',linkedBusinessId:'qa-business',type:'business',active:true},
 {id:'foreign',name:'Outra empresa',businessId:'foreign',linkedBusinessId:'foreign',type:'business',active:true}];
 w.SpaceContext.setSpaces(spaces);w.SpaceContext.selectActive('taxi');
 const rows=[{id:'ride',businessId:'qa-business',nome:'Corrida',itemKind:'service',spaceAccessMode:'single_space',defaultSpaceId:'taxi',allowedSpaceIds:['taxi'],preco:0,controlaEstoque:false},
 {id:'physical',businessId:'qa-business',itemKind:'product',spaceAccessMode:'all_spaces'},
 {id:'other-service',businessId:'qa-business',itemKind:'service',spaceAccessMode:'single_space',defaultSpaceId:'shop',allowedSpaceIds:['shop']},
 {id:'foreign-service',businessId:'foreign',itemKind:'service',spaceAccessMode:'all_spaces'}];return{h,w,rows};
}
test('published V238 reproduces a confirmed Corrida hidden in a sales-only Táxi space',()=>{const {h,w,rows}=setup({published:true});try{assert.deepEqual(Array.from(w.SpaceContext.productsForView(rows)),[]);}finally{h.close();}});
test('Táxi lists its service without enabling physical catalog, inventory, other spaces or other companies',()=>{const {h,w,rows}=setup();try{
 const before=JSON.stringify(rows);assert.deepEqual(Array.from(w.SpaceContext.productsForView(rows),p=>p.id),['ride']);assert.equal(w.SpaceContext.selectedSales().id,'taxi');
 w.SpaceContext.selectActive('shop');assert.deepEqual(Array.from(w.SpaceContext.productsForView(rows),p=>p.id),['physical','other-service']);
 assert.throws(()=>w.SpaceContext.selectActive('foreign'));assert.equal(JSON.stringify(rows),before);
}finally{h.close();}});
test('revoked space and session loading still deny catalog access',()=>{const {h,w,rows}=setup();try{h.setContext({role:'seller',spaceAccess:'selected',allowedSpaceIds:['shop']});assert.deepEqual(Array.from(w.SpaceContext.productsForView(rows),p=>p.id),['physical','other-service']);h.setContext({loading:true});assert.deepEqual(Array.from(w.SpaceContext.productsForView(rows)),[]);}finally{h.close();}});
test('subtitle is generic and server product status exposes only public metadata for confirmation',()=>{
 const app=fs.readFileSync('js/app.js','utf8');assert.doesNotMatch(app,/estoque dos seus doces/);assert.match(app,/Produtos, serviços.*espaço ativo/);
 const source=fs.readFileSync('js/firebase/firestore-repository.js','utf8'),block=source.slice(source.indexOf('async getProductStatusFromServer('),source.indexOf('async getProductActionSpacesFromServer('));
 assert.match(block,/getDocFromServer/);assert.match(block,/snapshot.metadata.fromCache/);assert.match(block,/"serviceConfig"/);assert.doesNotMatch(block,/"serviceCostConfig"|"serviceCostConfigs"|"serviceCostSnapshot"/);
});
